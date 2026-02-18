import {
  isR2Configured,
  getR2ConfigStatus,
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
  deleteR2Objects,
  copyR2Object,
} from './r2-storage.js';

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
      const result = await createPresignedUploadUrl({
        key,
        contentType,
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
      return res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create presigned upload URL',
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
        key,
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
      return res.status(400).json({
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
      const deleted = await deleteR2Objects(Array.isArray(keys) ? keys : key);
      return res.json({
        success: true,
        provider: 'r2',
        deleted,
      });
    } catch (error) {
      return res.status(400).json({
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
      const result = await copyR2Object({ sourceKey, destinationKey });

      return res.json({
        success: true,
        provider: 'r2',
        ...result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to copy object',
      });
    }
  });
}
