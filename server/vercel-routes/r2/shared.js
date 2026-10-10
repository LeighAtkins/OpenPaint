import {
  isR2Configured,
  getR2ConfigStatus,
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
  deleteR2Objects,
  copyR2Object,
} from '../../../server/r2-storage.js';
import {
  authorizeR2Read,
  authorizeR2Upload,
  authorizeR2Write,
  getSafeObjectHeaders,
} from '../../../server/r2-access.js';

export function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

export function getHealthPayload() {
  return {
    success: true,
    provider: 'r2',
    ...getR2ConfigStatus(),
  };
}

export function ensureR2Configured(res) {
  if (isR2Configured()) {
    return true;
  }

  res.status(503).json({
    success: false,
    message: 'R2 storage is not configured',
    ...getR2ConfigStatus(),
  });
  return false;
}

export async function handlePresignUpload(req, res) {
  if (!ensureR2Configured(res)) return;

  const body = await readJsonBody(req);
  const { key, contentType, cacheControl, expiresIn } = body || {};
  const ttl = parsePositiveNumber(expiresIn, 300);
  const upload = await authorizeR2Upload(req, key, contentType);

  const result = await createPresignedUploadUrl({
    key: upload.key,
    contentType: upload.contentType,
    cacheControl,
    expiresIn: ttl,
  });

  return res.status(200).json({
    success: true,
    provider: 'r2',
    key: result.key,
    uploadUrl: result.uploadUrl,
    publicUrl: result.publicUrl,
    expiresIn: ttl,
  });
}

export async function handleSignedUrl(req, res) {
  if (!ensureR2Configured(res)) return;

  const body = await readJsonBody(req);
  const { key, expiresIn } = body || {};

  const result = await createPresignedDownloadUrl({
    key: await authorizeR2Read(req, key),
    expiresIn: parsePositiveNumber(expiresIn, 3600),
  });

  return res.status(200).json({
    success: true,
    provider: 'r2',
    key: result.key,
    signedUrl: result.signedUrl,
    publicUrl: result.publicUrl,
  });
}

export async function handleDelete(req, res) {
  if (!ensureR2Configured(res)) return;

  const body = await readJsonBody(req);
  const { key, keys } = body || {};
  const requestedKeys = Array.isArray(keys) ? keys : [key];
  const allowedKeys = [];
  for (const requestedKey of requestedKeys) {
    allowedKeys.push(await authorizeR2Write(req, requestedKey));
  }
  const deleted = await deleteR2Objects(allowedKeys);

  return res.status(200).json({
    success: true,
    provider: 'r2',
    deleted,
  });
}

export async function handleCopy(req, res) {
  if (!ensureR2Configured(res)) return;

  const body = await readJsonBody(req);
  const { sourceKey, destinationKey } = body || {};
  const result = await copyR2Object({
    sourceKey: await authorizeR2Write(req, sourceKey),
    destinationKey: await authorizeR2Write(req, destinationKey),
  });

  return res.status(200).json({
    success: true,
    provider: 'r2',
    ...result,
  });
}

export async function handleObject(req, res) {
  if (!ensureR2Configured(res)) return;

  const key = String(req.query?.key || '').trim();
  if (!key) {
    return res.status(400).json({
      success: false,
      message: 'key query parameter is required',
    });
  }

  const { signedUrl } = await createPresignedDownloadUrl({
    key: await authorizeR2Read(req, key),
    expiresIn: 300,
  });
  const upstream = await fetch(signedUrl);

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      success: false,
      message: `Failed to fetch object from R2 (${upstream.status})`,
    });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const upstreamCacheControl = upstream.headers.get('cache-control') || '';
  const hasMaxAgeDirective = /max-age\s*=\s*\d+/i.test(upstreamCacheControl);
  const cacheControl = hasMaxAgeDirective
    ? upstreamCacheControl
    : 'public, max-age=3600, stale-while-revalidate=60';
  const etag = upstream.headers.get('etag');
  const lastModified = upstream.headers.get('last-modified');
  const contentLength = upstream.headers.get('content-length');

  Object.entries(getSafeObjectHeaders(contentType)).forEach(([name, value]) =>
    res.setHeader(name, value)
  );
  res.setHeader('Cache-Control', cacheControl);
  if (etag) res.setHeader('ETag', etag);
  if (lastModified) res.setHeader('Last-Modified', lastModified);
  if (contentLength) res.setHeader('Content-Length', contentLength);

  const buffer = Buffer.from(await upstream.arrayBuffer());
  return res.status(200).send(buffer);
}
