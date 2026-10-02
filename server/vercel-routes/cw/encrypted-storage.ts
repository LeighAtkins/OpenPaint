import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const magic = Buffer.from('CWARCH01');

export function archiveEncryptionKey(value = process.env.CW_ARCHIVE_ENCRYPTION_KEY): Buffer {
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error('A server-only 256-bit archive encryption key is required');
  return Buffer.from(value, 'hex');
}

/** Bind each authenticated envelope to its exact storage path; there is no plaintext fallback. */
export function encryptArchiveObject(bytes: Buffer, objectKey: string, key: Buffer): Buffer {
  const compressed = objectKey.endsWith('.json');
  const header = Buffer.concat([magic, Buffer.from([compressed ? 1 : 0])]);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.concat([header, Buffer.from(objectKey, 'utf8')]));
  const ciphertext = Buffer.concat([
    cipher.update(compressed ? gzipSync(bytes) : bytes),
    cipher.final(),
  ]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptArchiveObject(bytes: Buffer, objectKey: string, key: Buffer): Buffer {
  if (bytes.length < 37 || !bytes.subarray(0, 8).equals(magic) || bytes[8] > 1)
    throw new Error('Invalid encrypted archive envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(9, 21));
  decipher.setAAD(Buffer.concat([bytes.subarray(0, 9), Buffer.from(objectKey, 'utf8')]));
  decipher.setAuthTag(bytes.subarray(21, 37));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(37)), decipher.final()]);
  return bytes[8] === 1 ? gunzipSync(plaintext, { maxOutputLength: 64 * 1024 * 1024 }) : plaintext;
}

export function archiveR2Settings() {
  const bucket = process.env.CW_ARCHIVE_R2_BUCKET;
  const prefix = process.env.CW_ARCHIVE_R2_PREFIX;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.CW_ARCHIVE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CW_ARCHIVE_R2_SECRET_ACCESS_KEY;
  if (!bucket || !prefix || !accountId || !accessKeyId || !secretAccessKey)
    throw new Error('Encrypted archive storage is not configured');
  if (!/^private\/cw-measurements\/[a-zA-Z0-9_-]+$/.test(prefix))
    throw new Error('Invalid encrypted archive prefix');
  return { bucket, prefix, accountId, accessKeyId, secretAccessKey, key: archiveEncryptionKey() };
}

export async function readEncryptedArchiveFile(relative: string): Promise<Buffer> {
  const settings = archiveR2Settings();
  const objectKey = `${settings.prefix}/${relative}`;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: settings.bucket, Key: objectKey })
    );
    if (!response.Body) throw new Error('Archived file unavailable');
    return decryptArchiveObject(
      Buffer.from(await response.Body.transformToByteArray()),
      objectKey,
      settings.key
    );
  } finally {
    client.destroy();
  }
}
