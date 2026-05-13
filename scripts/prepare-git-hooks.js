import fs from 'fs';
import { spawnSync } from 'child_process';

const shouldSkip =
  process.env.CI === 'true' || Boolean(process.env.VERCEL) || !fs.existsSync('.git');

if (shouldSkip) {
  process.exit(0);
}

const result = spawnSync('npx', ['husky'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 0);
