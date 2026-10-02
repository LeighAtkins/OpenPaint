import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

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
    const id = crypto.createHash('sha256').update(relative).digest('hex').slice(0, 16);
    const title = relative
      .replace(/\.svg$/i, '')
      .split(path.sep)
      .map(part => part.trim())
      .join(' / ');
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
}
await visit(root);
catalogue.sort((a, b) => a.title.localeCompare(b.title));
await fs.writeFile(path.join(target, 'catalogue.json'), JSON.stringify(catalogue, null, 2));
console.log(`Prepared ${catalogue.length} local SVG guides for MCP.`);
