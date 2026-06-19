import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '../../public/measurement-guides/manifest.json');

function getWorkerBaseUrl() {
  return (
    process.env.MEASUREMENT_GUIDE_WORKER_URL ||
    process.env.CF_WORKER_URL ||
    process.env.AI_WORKER_URL ||
    ''
  )
    .toString()
    .trim()
    .replace(/\/+$/, '');
}

function getWorkerApiKey() {
  return (process.env.MEASUREMENT_GUIDE_WORKER_API_KEY || process.env.AI_WORKER_KEY || 'dev-secret')
    .toString()
    .trim();
}

function loadLocalManifest() {
  try {
    if (existsSync(MANIFEST_PATH)) {
      return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    }
  } catch {}
  return null;
}

function stripViewSuffix(fileName) {
  const match = fileName.match(/^(.+?)[-_](Side|Front|Back)$/i);
  if (match) {
    return { baseName: match[1], view: match[2].toLowerCase() };
  }
  const prefixMatch = fileName.match(/^(Front|Back|Side)[-_](.+)$/i);
  if (prefixMatch) {
    return { baseName: prefixMatch[2], view: prefixMatch[1].toLowerCase() };
  }
  return null;
}

function flattenLocalCodes(manifest) {
  const codes = [];
  const viewsByCode = {};
  const collectionsByCode = {};
  const categoriesByCode = {};

  function searchTree(node, parentCategory) {
    if (node.files) {
      for (const f of node.files) {
        if (f.type !== 'svg') continue;
        // Derive code from filename
        const fileName = f.name.replace(/\.[^/.]+$/, '');
        let code = fileName;
        // Strip Front_/Back_/Side_ prefix
        code = code.replace(/^(Front|Back|Side)[-_]/i, '');
        // Strip view suffix (e.g. -Side, _Front)
        const viewSuffix = stripViewSuffix(code);
        if (viewSuffix) {
          code = viewSuffix.baseName;
        }
        // Strip leading dash
        code = code.replace(/^[^a-zA-Z0-9]+/, '');
        // Strip trailing (N)
        code = code.replace(/\s*\([^)]*\)\s*$/, '');
        if (!code) continue;

        const normalizedCode = code.toUpperCase();
        if (!codes.includes(normalizedCode)) {
          codes.push(normalizedCode);
        }

        // Determine views for this code
        const viewMatch = fileName.match(/^(Front|Back|Side)[-_]/i);
        const view = viewSuffix?.view || (viewMatch ? viewMatch[1].toLowerCase() : 'front');
        const existing = viewsByCode[normalizedCode];
        if (existing) {
          if (!existing.includes(view)) existing.push(view);
        } else {
          viewsByCode[normalizedCode] = [view];
        }
        // Check for sibling SVGs with different views
        if (node.files) {
          for (const other of node.files) {
            if (other === f || other.type !== 'svg') continue;
            const otherName = other.name.replace(/\.[^/.]+$/, '');
            let otherCode = otherName;
            otherCode = otherCode.replace(/^(Front|Back|Side)[-_]/i, '');
            const otherViewSuffix = stripViewSuffix(otherCode);
            if (otherViewSuffix) {
              otherCode = otherViewSuffix.baseName;
            }
            otherCode = otherCode.replace(/^[^a-zA-Z0-9]+/, '').replace(/\s*\([^)]*\)\s*$/, '');
            if (otherCode.toUpperCase() === normalizedCode) {
              const otherViewPrefix = otherName.match(/^(Front|Back|Side)[-_]/i);
              const otherView =
                otherViewSuffix?.view || (otherViewPrefix ? otherViewPrefix[1].toLowerCase() : '');
              if (otherView && !viewsByCode[normalizedCode].includes(otherView)) {
                viewsByCode[normalizedCode].push(otherView);
              }
            }
          }
        }
        // Ensure sorted: front, back, side
        viewsByCode[normalizedCode] = (viewsByCode[normalizedCode] || ['front']).sort(
          (a, b) => ['front', 'back', 'side'].indexOf(a) - ['front', 'back', 'side'].indexOf(b)
        );

        collectionsByCode[normalizedCode] = 'Modular MT';
        categoriesByCode[normalizedCode] = parentCategory || 'Uncategorized';
      }
    }
    if (node.children) {
      for (const c of node.children) {
        searchTree(c, parentCategory || c.name);
      }
    }
  }

  for (const [collectionKey, collection] of Object.entries(manifest || {})) {
    if (collection.type === 'tree' && collection.tree) {
      searchTree(collection.tree, collection.displayName || collectionKey);
    } else {
      // Legacy flat format
      for (const [categoryName, category] of Object.entries(collection.categories || {})) {
        for (const [code, info] of Object.entries(category.codes || {})) {
          const normalizedCode = code.toUpperCase();
          codes.push(normalizedCode);
          viewsByCode[normalizedCode] = info.views || ['front'];
          collectionsByCode[normalizedCode] = collection.displayName || collectionKey;
          categoriesByCode[normalizedCode] = categoryName;
        }
      }
    }
  }

  return { codes, viewsByCode, collectionsByCode, categoriesByCode };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  let cloudCodes = [];
  let cloudViewsByCode = {};

  const workerBase = getWorkerBaseUrl();
  if (workerBase) {
    try {
      const response = await fetch(`${workerBase}/measurement-guides/codes`, {
        method: 'GET',
        headers: {
          'x-api-key': getWorkerApiKey(),
          accept: 'application/json',
        },
      });

      if (response.ok) {
        const parsed = await response.json();
        const rawCodes = Array.isArray(parsed?.codes) ? parsed.codes : [];
        cloudCodes = Array.from(
          new Set(
            rawCodes
              .map(code =>
                String(code || '')
                  .trim()
                  .toUpperCase()
              )
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));

        const sourceViewsByCode =
          parsed?.viewsByCode && typeof parsed.viewsByCode === 'object' ? parsed.viewsByCode : {};
        for (const code of cloudCodes) {
          const rawViews = Array.isArray(sourceViewsByCode[code])
            ? sourceViewsByCode[code]
            : ['front'];
          cloudViewsByCode[code] = Array.from(
            new Set(
              rawViews
                .map(view =>
                  String(view || '')
                    .trim()
                    .toLowerCase()
                )
                .filter(view => view === 'front' || view === 'back' || view === 'side')
            )
          ).sort(
            (a, b) => ['front', 'back', 'side'].indexOf(a) - ['front', 'back', 'side'].indexOf(b)
          );
          if (!cloudViewsByCode[code].length) cloudViewsByCode[code] = ['front'];
        }
      }
    } catch {}
  }

  const localManifest = loadLocalManifest();
  const local = flattenLocalCodes(localManifest);

  const allCodes = Array.from(new Set([...cloudCodes, ...local.codes])).sort((a, b) =>
    a.localeCompare(b)
  );
  const mergedViewsByCode = { ...cloudViewsByCode, ...local.viewsByCode };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(200).json({
    success: true,
    count: allCodes.length,
    codes: allCodes,
    viewsByCode: mergedViewsByCode,
    collectionsByCode: local.collectionsByCode,
    categoriesByCode: local.categoriesByCode,
  });
}
