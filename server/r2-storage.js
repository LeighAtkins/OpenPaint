import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let r2Client = null;
let r2ClientFingerprint = '';

function getR2Env() {
  return {
    accountId: (process.env.R2_ACCOUNT_ID || '').trim(),
    accessKeyId: (process.env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    bucket: (process.env.R2_BUCKET || '').trim(),
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || '').trim(),
  };
}

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
  const env = getR2Env();
  return Boolean(env.accountId && env.accessKeyId && env.secretAccessKey && env.bucket);
}

export function getR2ConfigStatus() {
  const env = getR2Env();
  return {
    configured: isR2Configured(),
    hasAccountId: Boolean(env.accountId),
    hasAccessKeyId: Boolean(env.accessKeyId),
    hasSecretAccessKey: Boolean(env.secretAccessKey),
    hasBucket: Boolean(env.bucket),
    hasPublicBaseUrl: Boolean(env.publicBaseUrl),
  };
}

function getR2Client() {
  const env = getR2Env();
  const isConfigured = Boolean(
    env.accountId && env.accessKeyId && env.secretAccessKey && env.bucket
  );
  if (!isConfigured) {
    throw new Error('R2 is not configured');
  }

  const fingerprint = `${env.accountId}:${env.accessKeyId}:${env.bucket}`;

  if (!r2Client || r2ClientFingerprint !== fingerprint) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
    });
    r2ClientFingerprint = fingerprint;
  }

  return r2Client;
}

export function getR2PublicUrl(objectKey) {
  const env = getR2Env();
  if (!env.publicBaseUrl) {
    return null;
  }
  const base = env.publicBaseUrl.replace(/\/+$/, '');
  const key = normalizeKey(objectKey);
  return `${base}/${key}`;
}

export async function createPresignedUploadUrl({
  key,
  contentType,
  cacheControl,
  expiresIn = 300,
}) {
  const env = getR2Env();
  const client = getR2Client();
  const objectKey = normalizeKey(key);

  const command = new PutObjectCommand({
    Bucket: env.bucket,
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
  const env = getR2Env();
  const client = getR2Client();
  const objectKey = normalizeKey(key);

  const command = new GetObjectCommand({
    Bucket: env.bucket,
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
  const env = getR2Env();
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
        Bucket: env.bucket,
        Key: key,
      })
    );
    return [key];
  }

  await client.send(
    new DeleteObjectsCommand({
      Bucket: env.bucket,
      Delete: {
        Objects: normalizedKeys.map(key => ({ Key: key })),
      },
    })
  );

  return normalizedKeys;
}

export async function copyR2Object({ sourceKey, destinationKey }) {
  const env = getR2Env();
  const client = getR2Client();
  const from = normalizeKey(sourceKey);
  const to = normalizeKey(destinationKey);

  await client.send(
    new CopyObjectCommand({
      Bucket: env.bucket,
      Key: to,
      CopySource: `${env.bucket}/${from}`,
    })
  );

  return {
    sourceKey: from,
    destinationKey: to,
    publicUrl: getR2PublicUrl(to),
  };
}
