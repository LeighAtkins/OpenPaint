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

async function run() {
  const backendPort = Number(process.env.PORT || 3000);
  const isAvailable = await checkPortAvailable(backendPort);

  const script = isAvailable ? 'dev:all:raw' : 'dev';
  if (!isAvailable) {
    console.warn(
      `[dev:all:safe] Port ${backendPort} is already in use; assuming backend is running. Starting Vite only.`
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
