#!/usr/bin/env node
/**
 * Copies the Tesseract.js worker, its WebAssembly core and the English data
 * from node_modules into public/tesseract/, so the OCR worker loads them from
 * this app (offline, and no customer page or request goes to a CDN).
 *
 *   public/tesseract/worker.min.js
 *   public/tesseract/core/tesseract-core-*lstm.wasm.js
 *   public/tesseract/lang/eng.traineddata.gz
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/tesseract');
const require = createRequire(join(ROOT, 'package.json'));
const pkgDir = name => dirname(require.resolve(`${name}/package.json`));

export function copyTesseractAssets() {
  const files = [
    [join(pkgDir('tesseract.js'), 'dist/worker.min.js'), 'worker.min.js'],
    // LSTM-only cores (the engine runs OEM 1); the worker picks one by SIMD support.
    ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].map(
      name => [join(pkgDir('tesseract.js-core'), `${name}.wasm.js`), `core/${name}.wasm.js`]
    ),
    [join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'lang/eng.traineddata.gz'],
  ];
  let copied = 0;
  for (const [from, to] of files) {
    const target = join(OUT, to);
    if (existsSync(target) && statSync(target).size === statSync(from).size) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(from, target);
    copied += 1;
  }
  return copied;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const copied = copyTesseractAssets();
  console.log(`Tesseract assets in public/tesseract (${copied} copied)`);
}
