import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve('public/measurement-guides');
const target = path.resolve('dist/mcp-guides');
await fs.mkdir(target, { recursive: true });
await fs.copyFile('mcp/assets/Roboto.ttf', path.join(target, 'preview-font.ttf'));
await fs.copyFile('mcp/assets/OFL.txt', path.join(target, 'preview-font-license.txt'));
const catalogue: Array<{
  id: string;
  title: string;
  scope: string;
  svgPath: string;
  version: string;
}> = [];
async function visit(directory: string) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(file);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith('.svg')) continue;
    const relative = path.relative(root, file);
    const bytes = await fs.readFile(file);
    await addGuide(relative, bytes);
  }
}
async function addGuide(relative: string, bytes: Buffer) {
  const id = crypto.createHash('sha256').update(relative).digest('hex').slice(0, 16);
  const title = relative
    .replace(/\.svg$/i, '')
    .split(/[\\/]/)
    .map(part => part.trim())
    .join(' / ');
  const file = `/${relative.replaceAll('\\', '/')}`;
  const scope = /\/Cushions\//i.test(file)
    ? 'cushion'
    : /\/Arm Shape\//i.test(file)
      ? 'arm'
      : /\/Seat Shape\//i.test(file)
        ? 'seat'
        : /\/Backrest/i.test(file)
          ? 'backrest'
          : 'component';
  await fs.writeFile(path.join(target, `${id}.svg`), bytes);
  catalogue.push({
    id: `local:${id}`,
    title,
    scope,
    svgPath: `/${id}.svg`,
    version: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  });
}
if (
  await fs
    .stat(root)
    .then(() => true)
    .catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    })
)
  await visit(root);
else {
  // Windows checkouts omit guide paths containing trailing-space directories.
  // Read tracked assets directly from Git, preserving their canonical Linux IDs.
  const git = promisify(execFile);
  const prefix = 'public/measurement-guides/';
  const { stdout } = await git('git', ['ls-tree', '-rz', '--name-only', 'HEAD', '--', prefix]);
  const files = stdout.split('\0').filter(file => file.startsWith(prefix) && /\.svg$/i.test(file));
  if (!files.length) throw new Error('No measurement guide sources in the checkout or Git tree.');
  for (const file of files) {
    const { stdout: bytes } = await git('git', ['show', `HEAD:${file}`], {
      encoding: 'buffer',
      maxBuffer: 2 * 1024 * 1024,
    });
    await addGuide(file.slice(prefix.length), bytes);
  }
}
catalogue.sort((a, b) => a.title.localeCompare(b.title));
await fs.writeFile(path.join(target, 'catalogue.json'), JSON.stringify(catalogue, null, 2));
console.log(`Prepared ${catalogue.length} local SVG guides for MCP.`);
