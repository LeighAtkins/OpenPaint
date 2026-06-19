import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '../../public/measurement-guides/manifest.json');
const R2_PUBLIC_URL =
  process.env.R2_PUBLIC_URL || 'https://pub-0defc0e5a61842c3bc17ea19d5b651b8.r2.dev';

function localPathToR2Key(localPath) {
  if (!localPath) return null;
  const relative = localPath.replace(/^public\/measurement-guides\//, '');
  const noArchive = relative.replace(/\/Archive\//, '/');
  const normalized = noArchive.replace(/^Modular MT\s*\//, 'Modular-MT/');
  return normalized;
}

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function normalizeView(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'front' || v === 'back' || v === 'side') return v;
  return '';
}

function normalizeHideBoxes(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

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

/** Normalize a code: strip leading non-alphanumeric, uppercase, normalize spaces to hyphens */
function normalizeGuideCode(raw) {
  return String(raw || '')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, '-')
    .trim()
    .toUpperCase();
}

/**
 * Detect view suffix in filename (e.g. "-Side", "_Front") and strip it,
 * returning { baseName, view } or null if no view suffix found.
 */
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

function findLocalGuide(manifest, code, view) {
  if (!manifest) return null;
  const uc = code.toUpperCase();
  const normCode = normalizeGuideCode(code);
  const normCodeDash = normCode.replace(/\s+/g, '-');

  function searchTree(node, prefix) {
    const results = [];

    // Check files in this node for SVGs
    if (node.files) {
      for (const f of node.files) {
        if (f.type !== 'svg') continue;
        const fileName = f.name.replace(/\.[^/.]+$/, '');
        const fileUc = fileName.toUpperCase();
        const fileNameNorm = normalizeGuideCode(fileName);

        // Try to extract view suffix before matching
        let resolvedView = view || 'front';
        let matchBase = fileName;
        const viewSuffix = stripViewSuffix(fileName);
        if (viewSuffix) {
          matchBase = viewSuffix.baseName;
          resolvedView = viewSuffix.view;
        }

        // Also check Front_/Back_/Side_ prefix (takes priority over suffix)
        if (/^Front[_-]/i.test(fileName)) resolvedView = 'front';
        else if (/^Back[_-]/i.test(fileName)) resolvedView = 'back';
        else if (/^Side[_-]/i.test(fileName)) resolvedView = 'side';

        const baseNorm = normalizeGuideCode(matchBase);
        const baseNormDash = baseNorm.replace(/\s+/g, '-');

        const matches =
          fileUc === uc ||
          fileNameNorm === normCode ||
          fileUc === `-${uc}` ||
          `-${fileUc}` === uc ||
          (prefix && prefix.toUpperCase() === uc) ||
          baseNormDash === normCodeDash ||
          baseNorm === normCode ||
          fileNameNorm === normCodeDash;

        if (matches) {
          if (resolvedView === view || !view) {
            results.push({ svgPath: f.path, view: resolvedView });
          }
        }
      }
    }

    // Recurse into children
    if (node.children) {
      for (const c of node.children) {
        results.push(...searchTree(c, c.name));
      }
    }

    return results;
  }

  for (const collection of Object.values(manifest)) {
    if (collection.tree) {
      const results = searchTree(collection.tree, '');
      if (results.length > 0) {
        // Prefer exact view match
        const exact = results.find(r => r.view === view);
        return exact || results[0];
      }
    }
  }
  return null;
}

function sendSvgResponse(res, svgContent, view, hideBoxes, source) {
  // Optionally hide measurement boxes
  if (hideBoxes) {
    svgContent = svgContent.replace(
      '</svg>',
      '<style>g[id^="b"]{display:none!important;}</style></svg>'
    );
  }

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=120');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('x-guide-view-requested', view);
  res.setHeader('x-guide-view-resolved', view);
  res.setHeader('x-guide-hide-boxes', hideBoxes ? '1' : '0');
  res.setHeader('x-guide-source', source);
  return res.status(200).send(svgContent);
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

  const code = normalizeCode(req.query?.code);
  const view = normalizeView(req.query?.view);
  const hideBoxes = normalizeHideBoxes(req.query?.hideBoxes);
  if (!code || !view) {
    return res.status(400).json({ success: false, message: 'Invalid code or view' });
  }

  // Try local guides first
  const manifest = loadLocalManifest();
  const localGuide = findLocalGuide(manifest, code, view);
  if (localGuide) {
    try {
      const absolutePath = join(__dirname, '../..', localGuide.svgPath);
      // Try local disk
      if (existsSync(absolutePath)) {
        return sendSvgResponse(res, readFileSync(absolutePath, 'utf-8'), view, hideBoxes, 'local');
      }

      // Fall back to R2 (Vercel)
      const r2Key = localPathToR2Key(localGuide.svgPath);
      if (r2Key) {
        const r2Url = `${R2_PUBLIC_URL}/${r2Key}`;
        const r2Response = await fetch(r2Url, { method: 'GET' });
        if (r2Response.ok) {
          let svgContent = await r2Response.text();
          return sendSvgResponse(res, svgContent, view, hideBoxes, 'r2');
        }
      }
    } catch {
      // Fall through to cloud worker
    }
  }

  // Fall back to cloud worker
  const workerBase = getWorkerBaseUrl();
  if (!workerBase) {
    return res
      .status(404)
      .json({ success: false, message: 'Guide not found locally and no worker configured' });
  }

  const headers = {
    'x-api-key': getWorkerApiKey(),
    accept: 'image/svg+xml,application/json',
  };

  const candidateViews = Array.from(new Set([view, 'front', 'back', 'side']));
  let lastStatus = 500;
  let lastDetail = '';

  try {
    for (const candidateView of candidateViews) {
      const hideBoxesParam = hideBoxes ? '&hideBoxes=1' : '';
      const svgResponse = await fetch(
        `${workerBase}/measurement-guides/svg?code=${encodeURIComponent(code)}&view=${encodeURIComponent(candidateView)}${hideBoxesParam}`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!svgResponse.ok) {
        lastStatus = svgResponse.status;
        lastDetail = await svgResponse.text();
        continue;
      }

      const contentType = svgResponse.headers.get('content-type') || 'image/svg+xml; charset=utf-8';
      const body = Buffer.from(await svgResponse.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=120');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('x-guide-view-requested', view);
      res.setHeader('x-guide-view-resolved', candidateView);
      res.setHeader('x-guide-hide-boxes', hideBoxes ? '1' : '0');
      return res.status(200).send(body);
    }

    return res.status(lastStatus || 404).json({
      success: false,
      message: 'Failed to fetch guide SVG',
      detail: lastDetail || `Guide not found for views: ${candidateViews.join(', ')}`,
      requestedView: view,
      attemptedViews: candidateViews,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Guide proxy failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
