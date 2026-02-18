import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || '').trim();
const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = (process.env.R2_BUCKET || '').trim();
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').trim();

let r2Client = null;

function normalizeKey(rawKey) {
  const key = String(rawKey || '')
    .trim()
    .replace(/^\/+/, '');
  if (!key) {
    throw new Error('Object key is required');
  }
  if (key.includes('..') || key.includes('\\')) {
    throw new Error('Invalid object key');
  }
  return key;
}

export function isR2Configured() {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
}

export function getR2ConfigStatus() {
  return {
    configured: isR2Configured(),
    hasAccountId: Boolean(R2_ACCOUNT_ID),
    hasAccessKeyId: Boolean(R2_ACCESS_KEY_ID),
    hasSecretAccessKey: Boolean(R2_SECRET_ACCESS_KEY),
    hasBucket: Boolean(R2_BUCKET),
    hasPublicBaseUrl: Boolean(R2_PUBLIC_BASE_URL),
  };
}

function getR2Client() {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured');
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }

  return r2Client;
}

export function getR2PublicUrl(objectKey) {
  if (!R2_PUBLIC_BASE_URL) {
    return null;
  }
  const base = R2_PUBLIC_BASE_URL.replace(/\/+$/, '');
  const key = normalizeKey(objectKey);
  return `${base}/${key}`;
}

export async function createPresignedUploadUrl({
  key,
  contentType,
  cacheControl,
  expiresIn = 300,
}) {
  const client = getR2Client();
  const objectKey = normalizeKey(key);

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: objectKey,
    ContentType: contentType || 'application/octet-stream',
    ...(cacheControl ? { CacheControl: cacheControl } : {}),
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: Math.max(60, Math.min(3600, Number(expiresIn) || 300)),
  });

  return {
    key: objectKey,
    uploadUrl,
    publicUrl: getR2PublicUrl(objectKey),
  };
}

export async function createPresignedDownloadUrl({ key, expiresIn = 3600 }) {
  const client = getR2Client();
  const objectKey = normalizeKey(key);

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: objectKey,
  });

  const signedUrl = await getSignedUrl(client, command, {
    expiresIn: Math.max(60, Math.min(86400, Number(expiresIn) || 3600)),
  });

  return {
    key: objectKey,
    signedUrl,
    publicUrl: getR2PublicUrl(objectKey),
  };
}

export async function deleteR2Objects(keys) {
  const client = getR2Client();
  const normalizedKeys = Array.isArray(keys)
    ? keys.map(normalizeKey)
    : [normalizeKey(keys)].filter(Boolean);

  if (normalizedKeys.length === 0) {
    return [];
  }

  if (normalizedKeys.length === 1) {
    const key = normalizedKeys[0];
    await client.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    return [key];
  }

  await client.send(
    new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: {
        Objects: normalizedKeys.map(key => ({ Key: key })),
      },
    })
  );

  return normalizedKeys;
}

export async function copyR2Object({ sourceKey, destinationKey }) {
  const client = getR2Client();
  const from = normalizeKey(sourceKey);
  const to = normalizeKey(destinationKey);

  await client.send(
    new CopyObjectCommand({
      Bucket: R2_BUCKET,
      Key: to,
      CopySource: `${R2_BUCKET}/${from}`,
    })
  );

  return {
    sourceKey: from,
    destinationKey: to,
    publicUrl: getR2PublicUrl(to),
  };
}
