import fs from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createPresignedDownloadUrl, isR2Configured, uploadR2Object } from './r2-storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveLocalLibraryPath() {
  return process.env.CW_LINE_LIBRARY_PATH || join(__dirname, '..', 'data', 'cw-line-library.json');
}

const R2_KEY = 'cw-line-library/v1.json';

function normalizeLibraryPayload(payload) {
  const library =
    payload?.library && typeof payload.library === 'object' ? payload.library : payload;
  const recipes = library?.recipes;
  if (!recipes || typeof recipes !== 'object' || Array.isArray(recipes)) {
    return null;
  }
  const cleaned = {};
  let lineCount = 0;
  Object.entries(recipes).forEach(([key, recipe]) => {
    if (!recipe || typeof recipe !== 'object') return;
    if (!Array.isArray(recipe.lines) || recipe.lines.length === 0) return;
    const lines = recipe.lines
      .filter(
        line =>
          line &&
          typeof line.label === 'string' &&
          [line.x1, line.y1, line.x2, line.y2].every(value => Number.isFinite(Number(value)))
      )
      .slice(0, 200);
    if (!lines.length) return;
    cleaned[String(key).slice(0, 200)] = {
      key: String(recipe.key || key).slice(0, 200),
      looseKey: String(recipe.looseKey || '').slice(0, 200),
      reference: String(recipe.reference || '').slice(0, 60),
      styleCode: String(recipe.styleCode || '').slice(0, 60),
      component: String(recipe.component || '').slice(0, 60),
      sequence: String(recipe.sequence || '').slice(0, 20),
      imageUrl: String(recipe.imageUrl || '').slice(0, 1000),
      lines: lines.slice(0, 200).map(line => ({
        label: String(line.label).slice(0, 30),
        value: String(line.value ?? '').slice(0, 30),
        sourceLabel: String(line.sourceLabel ?? '').slice(0, 60),
        x1: Number(line.x1),
        y1: Number(line.y1),
        x2: Number(line.x2),
        y2: Number(line.y2),
      })),
      updatedAt: String(recipe.updatedAt || '').slice(0, 40),
    };
    lineCount += cleaned[String(key).slice(0, 200)].lines.length;
  });
  return { version: 1, recipes: cleaned, lineCount };
}

async function readLocalLibrary() {
  try {
    return await fs.readFile(resolveLocalLibraryPath(), 'utf-8');
  } catch {
    return '';
  }
}

async function fetchR2LibraryJson() {
  if (!isR2Configured()) return null;
  try {
    const { signedUrl } = await createPresignedDownloadUrl({ key: R2_KEY, expiresIn: 120 });
    const upstream = await fetch(signedUrl);
    if (!upstream.ok) return null;
    return await upstream.text();
  } catch {
    return null;
  }
}

async function writeLocalLibrary(json) {
  const target = resolveLocalLibraryPath();
  try {
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, json, 'utf-8');
    return true;
  } catch {
    // Read-only filesystem (Vercel) — R2 mirror is the persistence path there.
    return false;
  }
}

export function registerCwLineLibraryRoutes(app, basePath = '/api/cw-line-library') {
  app.get(`${basePath}`, async (req, res) => {
    try {
      const r2Json = await fetchR2LibraryJson();
      const localJson = r2Json ? '' : await readLocalLibrary();
      const source = r2Json ? 'r2' : localJson ? 'local' : 'empty';
      const json = r2Json || localJson || JSON.stringify({ version: 1, recipes: {} });
      let library;
      try {
        library = JSON.parse(json);
      } catch {
        library = { version: 1, recipes: {} };
      }
      return res.json({
        success: true,
        source,
        r2Configured: isR2Configured(),
        library,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load CW line library',
      });
    }
  });

  app.put(`${basePath}`, async (req, res) => {
    try {
      const library = normalizeLibraryPayload(req.body);
      if (!library) {
        return res.status(400).json({
          success: false,
          message: 'Body must contain library.recipes (object of line recipes)',
        });
      }
      const json = JSON.stringify(library);
      const localSaved = await writeLocalLibrary(json);
      let r2Saved = false;
      if (isR2Configured()) {
        try {
          await uploadR2Object({
            key: R2_KEY,
            body: Buffer.from(json, 'utf-8'),
            contentType: 'application/json',
            cacheControl: 'private, max-age=60',
          });
          r2Saved = true;
        } catch {
          r2Saved = false;
        }
      }
      return res.json({
        success: true,
        recipeCount: Object.keys(library.recipes).length,
        lineCount: library.lineCount,
        localSaved,
        r2Saved,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save CW line library',
      });
    }
  });
}
