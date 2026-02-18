import {
  isR2Configured,
  getR2ConfigStatus,
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
  deleteR2Objects,
  copyR2Object,
} from '../../../server/r2-storage.js';

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

  const result = await createPresignedUploadUrl({
    key,
    contentType,
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
    key,
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
  const deleted = await deleteR2Objects(Array.isArray(keys) ? keys : key);

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
  const result = await copyR2Object({ sourceKey, destinationKey });

  return res.status(200).json({
    success: true,
    provider: 'r2',
    ...result,
  });
}
