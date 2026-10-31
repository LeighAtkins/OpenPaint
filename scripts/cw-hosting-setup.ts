import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

// Run this yourself in Terminal. Secret input is hidden and never written to logs,
// command arguments, the repository, or the upload state file.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let setupStage = 'checking the local Vercel connection';
process.chdir(root);
dotenv.config({ path: '.env.local', quiet: true });

class SafeSetupError extends Error {}

async function hiddenInput(label: string): Promise<string> {
  while (true) {
    const value = await readHiddenInput(label);
    const cleaned = value.replace(/\u001b?\[20[01]~/g, '').trim();
    if (cleaned) return cleaned;
    console.log(`Nothing was entered for ${label}. Paste the value, then press Enter.`);
  }
}

function readHiddenInput(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode)
    throw new SafeSetupError('Run setup in your own interactive Terminal.');
  process.stdout.write(`${label}: `);
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    function cleanup() {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    }
    function onData(chunk: string) {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          reject(new SafeSetupError('Setup was cancelled with Ctrl+C.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    }
    process.stdin.on('data', onData);
  });
}

async function run(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', result => resolve(result ?? 1));
  });
  if (code !== 0) throw new Error(`${command} did not finish successfully. Setup can be resumed.`);
}

async function main() {
  const project = JSON.parse(await fs.readFile(path.join(root, '.vercel/project.json'), 'utf8'));
  const configHome =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Application Support/com.vercel.cli')
      : path.join(
          process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'),
          'com.vercel.cli'
        );
  const auth = JSON.parse(await fs.readFile(path.join(configHome, 'auth.json'), 'utf8'));
  if (!auth.token) throw new Error('Sign in with vercel login first.');
  const directory = process.env.CW_ARCHIVE_DIR;
  if (!directory) throw new Error('CW_ARCHIVE_DIR is missing from .env.local.');
  const recoveryFile = path.join(path.dirname(directory), 'cw-product-archive-hosting-upload.env');
  let hosting: Record<string, string>;
  try {
    hosting = dotenv.parse(await fs.readFile(recoveryFile));
  } catch {
    hosting = {
      CW_ARCHIVE_R2_BUCKET: 'cw-measurement-archive',
      CW_ARCHIVE_R2_PREFIX: 'private/cw-measurements/2026-09-29',
      CW_ARCHIVE_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    };
    await fs.writeFile(
      recoveryFile,
      Object.entries(hosting)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
      { mode: 0o600, flag: 'wx' }
    );
  }
  // This recovery file contains the encryption key only, not Cloudflare credentials.
  await fs.chmod(recoveryFile, 0o600);
  console.log(
    'Create the 24-hour upload key in Cloudflare, scoped only to cw-measurement-archive.'
  );
  console.log(
    'Paste its Access Key ID and Secret Access Key below. Input stays hidden. Do not enter Token Value.'
  );
  setupStage = 'entering the upload credentials';
  const uploadId = await hiddenInput('UPLOAD Access Key ID');
  const uploadSecret = await hiddenInput('UPLOAD Secret Access Key');
  const uploadEnv = {
    ...process.env,
    ...hosting,
    CW_ARCHIVE_R2_ACCESS_KEY_ID: uploadId,
    CW_ARCHIVE_R2_SECRET_ACCESS_KEY: uploadSecret,
  };
  setupStage = 'checking the upload connection';
  console.log('\nChecking upload access with one encrypted archive record.');
  await run(process.execPath, ['scripts/cw-archive-upload.ts', '--check-connection'], uploadEnv);
  console.log('\nCreate a second key: Object Read only, specific bucket cw-measurement-archive.');
  console.log(
    'Use a long-lived expiry for the hosted app. This key will be sent directly to Vercel Preview.'
  );
  setupStage = 'entering the read-only credentials';
  let readId: string;
  while (true) {
    readId = await hiddenInput('READ-ONLY Access Key ID');
    if (readId !== uploadId) break;
    console.log(
      'That is the same Access Key ID as the upload token. Create a SECOND Cloudflare token with Object Read only permission, then paste its Access Key ID here.'
    );
  }
  const readSecret = await hiddenInput('READ-ONLY Secret Access Key');
  setupStage = 'checking the read-only connection';
  await run(process.execPath, ['scripts/cw-archive-upload.ts', '--check-read'], {
    ...process.env,
    ...hosting,
    CW_ARCHIVE_R2_ACCESS_KEY_ID: readId,
    CW_ARCHIVE_R2_SECRET_ACCESS_KEY: readSecret,
  });

  console.log(
    '\nUploading and verifying the encrypted runtime archive. Progress contains no keys.'
  );
  setupStage = 'uploading the encrypted archive';
  await run(process.execPath, ['scripts/cw-archive-upload.ts'], uploadEnv);

  const variables = {
    ...hosting,
    CW_ARCHIVE_R2_ACCESS_KEY_ID: readId,
    CW_ARCHIVE_R2_SECRET_ACCESS_KEY: readSecret,
  };
  setupStage = 'saving the server-only Vercel settings';
  for (const [key, value] of Object.entries(variables)) {
    if (!key.startsWith('CW_ARCHIVE_')) continue;
    const url = new URL(`https://api.vercel.com/v10/projects/${project.projectId}/env`);
    url.searchParams.set('teamId', project.orgId);
    url.searchParams.set('upsert', 'true');
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, type: 'sensitive', target: ['preview'] }),
    });
    if (!response.ok)
      throw new Error(
        `Vercel could not save ${key} (HTTP ${response.status}). No values were logged.`
      );
    const result = await response.json();
    if (result.failed?.length)
      throw new Error(`Vercel could not save ${key}. No values were logged.`);
    console.log(`Configured ${key} in Vercel Preview.`);
  }
  console.log('\nCreating the Vercel preview. The live site stays on its current deployment.');
  setupStage = 'deploying the Vercel preview';
  await run('vercel', ['deploy', '--yes']);
  console.log(
    '\nSetup finished. Share only the preview URL with Codex for testing. Keep the recovery encryption file secure.'
  );
}

main().catch(error => {
  // Do not print arbitrary SDK/network exceptions, which can contain credentials.
  if (error instanceof SafeSetupError) console.error(error.message);
  console.error(
    `Setup stopped while ${setupStage}. You can run it again to resume; no keys were printed.`
  );
  process.exitCode = 1;
});
