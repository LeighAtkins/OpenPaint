import { promises as fs } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, 'public');
const indexDest = path.join(publicDir, 'index.html');
const cssSrcDir = path.join(projectRoot, 'css');
const cssDestDir = path.join(publicDir, 'css');

const copyDirContents = async (srcDir, destDir) => {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await fs.mkdir(destDir, { recursive: true });
  await Promise.all(
    entries.map(async entry => {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        await copyDirContents(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    })
  );
};

const run = async () => {
  try {
    await fs.access(publicDir);
  } catch {
    console.error('[vercel] public directory not found, skipping static prep.');
    return;
  }

  const indexCandidates = [
    path.join(projectRoot, 'index.html'),
    path.join(projectRoot, 'shared.html'),
    path.join(projectRoot, 'public', 'index.html'),
  ];
  let copiedIndex = false;
  for (const candidate of indexCandidates) {
    try {
      await fs.access(candidate);
      if (candidate === indexDest) {
        console.log('[vercel] public/index.html already present.');
      } else {
        await fs.copyFile(candidate, indexDest);
        console.log(`[vercel] Copied ${path.basename(candidate)} into public/index.html.`);
      }
      copiedIndex = true;
      break;
    } catch {}
  }
  if (!copiedIndex) {
    console.error('[vercel] No index.html found to copy into public/.');
    process.exit(1);
  }

  try {
    await copyDirContents(cssSrcDir, cssDestDir);
    console.log('[vercel] Copied css/ into public/css for static hosting.');
  } catch (err) {
    console.error('[vercel] Failed to copy css/ into public/:', err);
    process.exit(1);
  }
};

run().catch(err => {
  console.error('[vercel] Failed to copy public assets:', err);
  process.exit(1);
});
