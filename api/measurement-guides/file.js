import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '../../public/measurement-guides/manifest.json');
const R2_PUBLIC_URL =
  process.env.R2_PUBLIC_URL || 'https://pub-0defc0e5a61842c3bc17ea19d5b651b8.r2.dev';

/**
 * Convert a local manifest path to an R2 object key.
 * Local:  public/measurement-guides/Modular MT /Arm Shape/.../file.svg
 * R2 key: Modular-MT/Arm Shape/.../file.svg
 */
function localPathToR2Key(localPath) {
  if (!localPath) return null;
  // Strip the public/measurement-guides/ prefix
  const relative = localPath.replace(/^public\/measurement-guides\//, '');
  // Normalize collection name: space becomes hyphen for R2
  const noArchive = relative.replace(/\/Archive\//, '/');
  const normalized = noArchive.replace(/^Modular MT\s*\//, 'Modular-MT/');
  return normalized;
}

const MIME_TYPES = {
  '.svg': 'image/svg+xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function loadLocalManifest() {
  try {
    if (existsSync(MANIFEST_PATH)) {
      return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    }
  } catch {}
  return null;
}

function findFile(manifest, entryPath) {
  if (!manifest || !entryPath) return null;
  const normPath = entryPath.replace(/\\/g, '/');

  function searchTree(node) {
    if (node.files) {
      for (const f of node.files) {
        if (f.path === normPath || f.path === entryPath) return f;
      }
    }
    if (node.children) {
      for (const c of node.children) {
        const found = searchTree(c);
        if (found) return found;
      }
    }
    return null;
  }

  for (const collection of Object.values(manifest)) {
    if (collection.tree) {
      const found = searchTree(collection.tree);
      if (found) return found;
    }
  }
  return null;
}

function setCommonHeaders(res, fileName, ext, mime) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (ext === '.pdf') {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
  }
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

  const filePath = String(req.query?.path || '').trim();
  if (!filePath) {
    return res.status(400).json({ success: false, message: 'Missing path parameter' });
  }

  const manifest = loadLocalManifest();
  const fileInfo = findFile(manifest, filePath);

  if (!fileInfo) {
    return res.status(404).json({ success: false, message: 'File not found in manifest' });
  }

  const absolutePath = join(__dirname, '../..', fileInfo.path);
  const ext = extname(fileInfo.name).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  // Try local file first
  if (existsSync(absolutePath)) {
    const content = readFileSync(absolutePath);
    setCommonHeaders(res, fileInfo.name, ext, mime);
    return res.status(200).send(content);
  }

  // Fall back to R2 when file not on disk (Vercel deployment)
  const r2Key = localPathToR2Key(fileInfo.path);
  if (r2Key) {
    try {
      const r2Url = `${R2_PUBLIC_URL}/${r2Key}`;
      const r2Response = await fetch(r2Url, { method: 'GET' });
      if (r2Response.ok) {
        const buffer = Buffer.from(await r2Response.arrayBuffer());
        setCommonHeaders(res, fileInfo.name, ext, mime);
        return res.status(200).send(buffer);
      }
    } catch {}
  }

  return res.status(404).json({ success: false, message: 'File not found on disk or R2' });
}
