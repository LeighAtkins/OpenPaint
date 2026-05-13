import net from 'node:net';
import { spawn } from 'node:child_process';

function checkPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', error => {
      if (error && error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, '0.0.0.0');
  });
}

async function isOpenPaintBackendRunning(port) {
  const candidates = [`http://127.0.0.1:${port}/health`, `http://127.0.0.1:${port}/api/test`];

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) continue;

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) continue;

      const payload = await response.json().catch(() => null);
      if (url.endsWith('/health') && payload?.status === 'ok') {
        return true;
      }
      if (url.endsWith('/api/test') && payload?.ok === true) {
        return true;
      }
    } catch {
      // Try the next probe URL.
    }
  }

  return false;
}

async function run() {
  const backendPort = Number(process.env.PORT || 3000);
  const isAvailable = await checkPortAvailable(backendPort);
  let script = 'dev:all:raw';

  if (!isAvailable) {
    const backendLooksHealthy = await isOpenPaintBackendRunning(backendPort);
    if (!backendLooksHealthy) {
      console.error(
        `[dev:all:safe] Port ${backendPort} is already in use, but it does not look like the OpenPaint backend. Stop the process on ${backendPort} or run the frontend and backend separately with "npm run dev" and "npm run dev:server".`
      );
      process.exit(1);
    }

    script = 'dev';
    console.warn(
      `[dev:all:safe] OpenPaint backend already detected on port ${backendPort}. Starting Vite only.`
    );
  }

  const child = spawn('npm', ['run', script], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  child.on('exit', code => {
    process.exit(code ?? 1);
  });
}

run().catch(error => {
  console.error('[dev:all:safe] Failed to start dev servers:', error);
  process.exit(1);
});
