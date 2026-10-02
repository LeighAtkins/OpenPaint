import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  archiveR2Settings,
  decryptArchiveObject,
  encryptArchiveObject,
} from '../server/vercel-routes/cw/encrypted-storage.ts';
import { safeArchiveStorageError } from '../server/vercel-routes/cw/storage-errors.ts';

dotenv.config({ path: '.env.local', quiet: true });
if (process.env.CW_HOSTING_ENV_FILE)
  dotenv.config({ path: process.env.CW_HOSTING_ENV_FILE, override: true, quiet: true });

const directory = process.env.CW_ARCHIVE_DIR;
if (!directory) throw new Error('CW_ARCHIVE_DIR is required');
const settings = archiveR2Settings();
const client = new S3Client({
  region: 'auto',
  requestChecksumCalculation: 'WHEN_REQUIRED',
  endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
});
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const keyId = hash(settings.key);
const checksums = JSON.parse(
  await fs.readFile(path.join(directory, 'archive-file-checksums.json'), 'utf8')
);
const tuples = JSON.parse(
  await fs.readFile(path.join(directory, 'measurement-tuples.json'), 'utf8')
);
const files = new Set<string>(['runtime-index.json', 'measurement-tuples.json']);
for (const tuple of tuples) {
  if (!/^[a-f0-9]{64}\.json$/.test(tuple.file)) throw new Error('Invalid tuple filename');
  files.add(`measurements/${tuple.file}`);
  const mapName = `asset-maps/${tuple.file}`;
  if (!checksums[mapName]) continue;
  files.add(mapName);
  const map = JSON.parse(await fs.readFile(path.join(directory, mapName), 'utf8'));
  for (const asset of map) {
    if (!asset.localPath || asset.error) continue;
    if (!/^assets\/[a-f0-9]{64}\.[a-zA-Z0-9]{1,10}$/.test(asset.localPath))
      throw new Error('Invalid asset path');
    files.add(asset.localPath);
  }
}
const selected = [...files].sort();
for (const file of selected)
  if (!checksums[file]) throw new Error(`Missing verified checksum: ${file}`);
const totalBytes = selected.reduce((sum, file) => sum + checksums[file].bytes, 0);
console.log(
  JSON.stringify({
    files: selected.length,
    sourceBytes: totalBytes,
    encrypted: true,
    prefix: settings.prefix,
  })
);
if (process.argv.includes('--dry-run')) process.exit(0);

// Upload state contains hashes only, never credentials or plaintext records.
const statePath =
  process.env.CW_UPLOAD_STATE_FILE ||
  path.join(path.dirname(directory), `${path.basename(directory)}.r2-upload-state.json`);
let state: any = { bucket: settings.bucket, prefix: settings.prefix, keyId, completed: {} };
try {
  const saved = JSON.parse(await fs.readFile(statePath, 'utf8'));
  if (saved.bucket === settings.bucket && saved.prefix === settings.prefix && saved.keyId === keyId)
    state = saved;
} catch {
  /* first upload */
}
let saveChain = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(state);
  saveChain = saveChain.then(async () => {
    await fs.writeFile(`${statePath}.part`, snapshot, { mode: 0o600 });
    await fs.rename(`${statePath}.part`, statePath);
  });
  return saveChain;
}
let cursor = 0;
let finished = 0;
let transferred = 0;
const failures: string[] = [];
const started = Date.now();
let lastProgress = 0;
async function upload(relative: string) {
  const expected = checksums[relative];
  const objectKey = `${settings.prefix}/${relative}`;
  if (state.completed[relative]?.sourceSha256 === expected.sha256) {
    // Re-check the remote envelope identity before trusting a resumed upload.
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: settings.bucket, Key: objectKey })
      );
      if (
        head.Metadata?.['source-sha256'] === expected.sha256 &&
        head.Metadata?.['key-id'] === keyId &&
        head.ContentLength === state.completed[relative].encryptedBytes &&
        head.ETag === state.completed[relative].etag
      )
        return;
    } catch {
      /* upload again */
    }
  }
  const bytes = await fs.readFile(path.join(directory!, relative));
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256)
    throw new Error('Local archive integrity check failed');
  const encrypted = encryptArchiveObject(bytes, objectKey, settings.key);
  const response = await client.send(
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: objectKey,
      Body: encrypted,
      ContentType: 'application/octet-stream',
      ContentMD5: createHash('md5').update(encrypted).digest('base64'),
      Metadata: { 'source-sha256': expected.sha256, 'key-id': keyId, envelope: 'cwarch01' },
    })
  );
  transferred += encrypted.length;
  state.completed[relative] = {
    sourceSha256: expected.sha256,
    encryptedBytes: encrypted.length,
    etag: response.ETag,
  };
}
const concurrency = Math.min(32, Math.max(1, Number(process.env.CW_UPLOAD_CONCURRENCY || 16)));
// Validate this credential pair against one real, encrypted archive record first.
// A connection or permission failure must not trigger 21,592 doomed uploads.
try {
  const relative = 'measurement-tuples.json';
  const readCheck = process.argv.includes('--check-read');
  if (!readCheck) await upload(relative);
  const objectKey = `${settings.prefix}/${relative}`;
  const response = await client.send(
    new GetObjectCommand({ Bucket: settings.bucket, Key: objectKey })
  );
  if (!response.Body) throw new Error('Connection verification failed');
  const plaintext = decryptArchiveObject(
    Buffer.from(await response.Body.transformToByteArray()),
    objectKey,
    settings.key
  );
  if (hash(plaintext) !== checksums[relative].sha256)
    throw new Error('Connection verification failed');
  if (!readCheck) await persist();
  console.log(
    JSON.stringify({ connectionCheck: true, encryptedReadBack: true, readOnlyCheck: readCheck })
  );
} catch (error) {
  console.error(JSON.stringify({ connectionCheck: false, ...safeArchiveStorageError(error) }));
  client.destroy();
  process.exit(1);
}
if (process.argv.includes('--check-connection') || process.argv.includes('--check-read')) {
  client.destroy();
  process.exit(0);
}
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (cursor < selected.length) {
      const relative = selected[cursor++];
      let success = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await upload(relative);
          success = true;
          break;
        } catch (error) {
          if (attempt === 0 && !failures.length)
            console.error(JSON.stringify({ uploadError: true, ...safeArchiveStorageError(error) }));
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        }
      }
      if (!success) failures.push(relative);
      finished++;
      if (finished % 200 === 0) await persist();
      if (Date.now() - lastProgress > 15000) {
        lastProgress = Date.now();
        console.log(
          JSON.stringify({
            finished,
            total: selected.length,
            transferredBytes: transferred,
            failures: failures.length,
            elapsedSeconds: Math.round((Date.now() - started) / 1000),
          })
        );
      }
    }
  })
);
await persist();
if (failures.length) {
  console.error(JSON.stringify({ failedFiles: failures, resumable: true }));
  process.exitCode = 1;
} else {
  // Read back both indexes plus records and images from across the upload and authenticate their hashes.
  const samples = new Set([
    'runtime-index.json',
    'measurement-tuples.json',
    ...selected.filter((_, i) => i % 1000 === 0),
  ]);
  for (const relative of samples) {
    const objectKey = `${settings.prefix}/${relative}`;
    const response = await client.send(
      new GetObjectCommand({ Bucket: settings.bucket, Key: objectKey })
    );
    if (!response.Body) throw new Error('Uploaded object unavailable');
    const bytes = decryptArchiveObject(
      Buffer.from(await response.Body.transformToByteArray()),
      objectKey,
      settings.key
    );
    if (hash(bytes) !== checksums[relative].sha256)
      throw new Error('Remote read-back integrity check failed');
  }
  console.log(
    JSON.stringify({
      complete: true,
      files: selected.length,
      readBackVerified: samples.size,
      transferredBytes: transferred,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    })
  );
}
client.destroy();
