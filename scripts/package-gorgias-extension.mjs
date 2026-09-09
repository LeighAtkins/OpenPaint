import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const root = resolve(import.meta.dirname, '..');
const sourceDir = resolve(root, 'extensions/gorgias-sofapaint');
const outputPath = resolve(root, 'public/downloads/gorgias-sofapaint-extension.zip');
const files = (await readdir(sourceDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== 'README.md')
  .map((entry) => entry.name)
  .sort();

const archive = new JSZip();
for (const filename of files) {
  archive.file(filename, await readFile(resolve(sourceDir, filename)));
}

await writeFile(
  outputPath,
  await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })
);

const manifest = JSON.parse(await readFile(resolve(sourceDir, 'manifest.json'), 'utf8'));
console.log(`Packaged Gorgias to SofaPaint ${manifest.version} (${files.length} files)`);
