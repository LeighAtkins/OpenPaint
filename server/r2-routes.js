import {
  isR2Configured,
  getR2ConfigStatus,
  createPresignedUploadUrl,
  uploadR2Object,
  createPresignedDownloadUrl,
  deleteR2Objects,
  copyR2Object,
} from './r2-storage.js';
import {
  authorizeR2Read,
  authorizeR2Upload,
  authorizeR2Write,
  getR2ErrorStatus,
  getSafeObjectHeaders,
} from './r2-access.js';

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function registerR2Routes(app, basePath) {
  app.get(`${basePath}/health`, (req, res) => {
    return res.json({
      success: true,
      provider: 'r2',
      ...getR2ConfigStatus(),
    });
  });

  app.post(`${basePath}/presign-upload`, async (req, res) => {
    try {
      if (!isR2Configured()) {
        return res.status(503).json({
          success: false,
          message: 'R2 storage is not configured',
          ...getR2ConfigStatus(),
        });
      }

      const { key, contentType, cacheControl, expiresIn } = req.body || {};
      const upload = await authorizeR2Upload(req, key, contentType);
      const result = await createPresignedUploadUrl({
        key: upload.key,
        contentType: upload.contentType,
        cacheControl,
        expiresIn: parsePositiveNumber(expiresIn, 300),
      });

      return res.json({
        success: true,
        provider: 'r2',
        key: result.key,
        uploadUrl: result.uploadUrl,
        publicUrl: result.publicUrl,
        expiresIn: parsePositiveNumber(expiresIn, 300),
      });
    } catch (error) {
      return res.status(getR2ErrorStatus(error)).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create presigned upload URL',
      });
    }
  });

  app.put(`${basePath}/upload`, async (req, res) => {
    try {
      if (!isR2Configured()) {
        return res.status(503).json({
          success: false,
          message: 'R2 storage is not configured',
          ...getR2ConfigStatus(),
        });
      }

      const key = String(req.query?.key || '').trim();
      if (!key) {
        return res.status(400).json({
          success: false,
          message: 'key query parameter is required',
        });
      }

      const body =
        Buffer.isBuffer(req.body) || typeof req.body === 'string'
          ? req.body
          : req.rawBody || Buffer.from([]);
      if (!body || body.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Upload body is empty',
        });
      }

      const upload = await authorizeR2Upload(req, key, req.get('content-type'));
      const result = await uploadR2Object({
        key: upload.key,
        body,
        contentType: upload.contentType,
        cacheControl: req.get('cache-control') || undefined,
      });

      return res.json({
        success: true,
        provider: 'r2',
        key: result.key,
        publicUrl: result.publicUrl,
      });
    } catch (error) {
      return res.status(getR2ErrorStatus(error)).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to upload object',
      });
    }
  });

  app.post(`${basePath}/signed-url`, async (req, res) => {
    try {
      if (!isR2Configured()) {
        return res.status(503).json({
          success: false,
          message: 'R2 storage is not configured',
          ...getR2ConfigStatus(),
        });
      }

      const { key, expiresIn } = req.body || {};
      const result = await createPresignedDownloadUrl({
        key: await authorizeR2Read(req, key),
        expiresIn: parsePositiveNumber(expiresIn, 3600),
      });

      return res.json({
        success: true,
        provider: 'r2',
        key: result.key,
        signedUrl: result.signedUrl,
        publicUrl: result.publicUrl,
      });
    } catch (error) {
      return res.status(getR2ErrorStatus(error)).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create signed URL',
      });
    }
  });

  app.post(`${basePath}/delete`, async (req, res) => {
    try {
      if (!isR2Configured()) {
        return res.status(503).json({
          success: false,
          message: 'R2 storage is not configured',
          ...getR2ConfigStatus(),
        });
      }

      const { key, keys } = req.body || {};
      const requestedKeys = Array.isArray(keys) ? keys : [key];
      const allowedKeys = [];
      for (const requestedKey of requestedKeys) {
        allowedKeys.push(await authorizeR2Write(req, requestedKey));
      }
      const deleted = await deleteR2Objects(allowedKeys);
      return res.json({
        success: true,
        provider: 'r2',
        deleted,
      });
    } catch (error) {
      return res.status(getR2ErrorStatus(error)).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete object(s)',
      });
    }
  });

  app.post(`${basePath}/copy`, async (req, res) => {
    try {
      if (!isR2Configured()) {
        return res.status(503).json({
          success: false,
          message: 'R2 storage is not configured',
          ...getR2ConfigStatus(),
        });
      }

      const { sourceKey, destinationKey } = req.body || {};
      const result = await copyR2Object({
        sourceKey: await authorizeR2Write(req, sourceKey),
        destinationKey: await authorizeR2Write(req, destinationKey),
      });

      return res.json({
        success: true,
        provider: 'r2',
        ...result,
      });
    } catch (error) {
      return res.status(getR2ErrorStatus(error)).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to copy object',
      });
    }
  });

  app.get(`${basePath}/object`, async (req, res) => {
    try {
      if (!isR2Configured()) {
        return res.status(503).json({
          success: false,
          message: 'R2 storage is not configured',
          ...getR2ConfigStatus(),
        });
      }

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
      const cacheControl = upstream.headers.get('cache-control') || 'private, max-age=300';
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
    } catch (error) {
      return res.status(getR2ErrorStatus(error)).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to proxy object',
      });
    }
  });
}
