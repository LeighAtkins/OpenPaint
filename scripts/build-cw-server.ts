import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Vercel transforms traced .ts files but legacy .js imports keep their .ts suffix.
// Bundle this server slice explicitly so production has no runtime .ts imports.
await build({
  absWorkingDir: root,
  entryPoints: {
    access: 'server/vercel-routes/cw/access.ts',
    archive: 'server/vercel-routes/cw/archive.ts',
  },
  outdir: 'server/vercel-routes/cw/generated',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: false,
});
console.log('Built the private measurement server modules.');
