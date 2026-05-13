import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const cwd = process.cwd();
const localNodeBin = path.resolve(cwd, '.agent/tools/node-v22.12.0-linux-x64/bin/node');
const nodeBin = fs.existsSync(localNodeBin) ? localNodeBin : process.execPath;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function spawnChild(label, args, extraEnv = {}) {
  const child = spawn(nodeBin, args, {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const forward = stream => {
    stream?.on('data', chunk => {
      process.stdout.write(`[${label}] ${chunk}`);
    });
  };
  forward(child.stdout);
  forward(child.stderr);
  return child;
}

const children = [];
let shuttingDown = false;
let apiServer = null;

function terminateAll(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach(child => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {
        // ignore
      }
    }
  });
}

process.on('SIGINT', () => {
  terminateAll('SIGINT');
  process.exit(130);
});

process.on('SIGTERM', () => {
  terminateAll('SIGTERM');
  process.exit(143);
});

process.on('exit', () => {
  terminateAll('SIGTERM');
  apiServer?.close?.();
});

const apiApp = express();

apiApp.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

apiApp.get('/api/integrations/cw/health', (_req, res) => {
  res.json({ ok: true });
});

apiApp.get('/api/measurement-guides/codes', (_req, res) => {
  res.json({
    success: true,
    count: 1,
    codes: ['TEST'],
    viewsByCode: {
      TEST: ['front', 'back', 'side'],
    },
  });
});

apiApp.get('/api/measurement-guides/svg', (req, res) => {
  const code = String(req.query.code || 'TEST')
    .trim()
    .toUpperCase();
  const view = String(req.query.view || 'front')
    .trim()
    .toLowerCase();

  if (!code || !['front', 'back', 'side'].includes(view)) {
    res.status(400).json({ success: false, message: 'Invalid code or view' });
    return;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
      <g id="mseat">
        <line x1="120" y1="220" x2="680" y2="220" stroke="#ef4444" stroke-width="4" />
      </g>
      <g id="cseat">
        <rect x="360" y="190" width="80" height="40" fill="#ffffff" stroke="#111827" />
        <text x="385" y="217">A1</text>
      </g>
      <g id="bseat">
        <rect x="500" y="190" width="110" height="40" fill="#ffffff" stroke="#111827" />
        <text x="522" y="217">0000.00</text>
      </g>
    </svg>
  `.trim();

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.send(svg);
});

await new Promise((resolve, reject) => {
  apiServer = apiApp.listen(3000, '127.0.0.1', error => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

const viteServer = spawnChild('vite', [
  'node_modules/vite/bin/vite.js',
  '--config',
  'vite.config.ts',
  '--host',
  '127.0.0.1',
]);
children.push(viteServer);

viteServer.on('exit', code => {
  if (!shuttingDown) {
    console.error(`[playwright-dev-server] vite server exited with code ${code ?? 'null'}`);
    terminateAll('SIGTERM');
    apiServer?.close?.();
    process.exit(code ?? 1);
  }
});

await new Promise(() => {});
