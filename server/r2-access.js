import { AuthError, requireRequestUser } from './supabase-auth.js';

// Every route requires a signed-in user. Users write under their own `<userId>/` prefix.
// Any signed-in user may read user images (so shared projects open for colleagues) and
// view images saved before keys were user-scoped.
const LEGACY_VIEW_PREFIX = 'projects/views/';
const USER_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

// SVG is deliberately excluded: it can carry script when served from our origin.
const IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
]);

export class R2AccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanKey(rawKey) {
  const key = String(rawKey || '')
    .trim()
    .replace(/^\/+/, '');
  if (!key) throw new R2AccessError(400, 'Object key is required');
  if (key.includes('..') || key.includes('\\')) throw new R2AccessError(400, 'Invalid object key');
  return key;
}

async function requireOwnedKey(req, key) {
  const user = await requireRequestUser(req);
  if (!key.startsWith(`${user.id}/`)) {
    throw new R2AccessError(403, 'Not allowed to access this object');
  }
  return key;
}

function normalizeContentType(contentType) {
  return String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

export async function authorizeR2Upload(req, rawKey, contentType) {
  const key = cleanKey(rawKey);
  const type = normalizeContentType(contentType);
  if (!IMAGE_CONTENT_TYPES.has(type)) {
    throw new R2AccessError(400, 'Only image uploads are allowed');
  }
  return { key: await requireOwnedKey(req, key), contentType: type };
}

export async function authorizeR2Read(req, rawKey) {
  const key = cleanKey(rawKey);
  await requireRequestUser(req);
  if (USER_KEY_PATTERN.test(key) || key.startsWith(LEGACY_VIEW_PREFIX)) return key;
  throw new R2AccessError(403, 'Not allowed to access this object');
}

export async function authorizeR2Write(req, rawKey) {
  return requireOwnedKey(req, cleanKey(rawKey));
}

// Headers for proxying a stored object from our own origin without letting it run as a page.
export function getSafeObjectHeaders(storedContentType) {
  const type = normalizeContentType(storedContentType);
  const isImage = IMAGE_CONTENT_TYPES.has(type);
  return {
    'Content-Type': isImage ? type : 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    ...(isImage ? {} : { 'Content-Disposition': 'attachment' }),
  };
}

export function getR2ErrorStatus(error, fallback = 400) {
  return error instanceof R2AccessError || error instanceof AuthError ? error.status : fallback;
}
