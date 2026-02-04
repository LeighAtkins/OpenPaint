import { promises as fs } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const cssDir = path.join(projectRoot, 'public', 'css');

const run = async () => {
  await fs.mkdir(cssDir, { recursive: true });
};

run().catch(err => {
  console.error('[vercel] Failed to ensure public/css directory:', err);
  process.exit(1);
});
