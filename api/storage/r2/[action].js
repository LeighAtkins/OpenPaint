import {
  getHealthPayload,
  handleCopy,
  handleDelete,
  handleObject,
  handlePresignUpload,
  handleSignedUrl,
} from '../../../server/vercel-routes/r2/shared.js';

const ACTIONS = {
  health: {
    method: 'GET',
    handler: (_req, res) => res.status(200).json(getHealthPayload()),
  },
  'presign-upload': {
    method: 'POST',
    handler: handlePresignUpload,
  },
  'signed-url': {
    method: 'POST',
    handler: handleSignedUrl,
  },
  delete: {
    method: 'POST',
    handler: handleDelete,
  },
  copy: {
    method: 'POST',
    handler: handleCopy,
  },
  object: {
    method: 'GET',
    handler: handleObject,
  },
};

export default async function handler(req, res) {
  const action = String(req.query?.action || '').trim();
  const route = ACTIONS[action];

  if (!route) {
    return res.status(404).json({
      success: false,
      message: 'R2 route not found',
    });
  }

  if (req.method !== route.method) {
    res.setHeader('Allow', route.method);
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    return await route.handler(req, res);
  } catch (error) {
    const fallbackByAction = {
      copy: 'Failed to copy object',
      delete: 'Failed to delete object(s)',
      object: 'Failed to proxy object',
      'presign-upload': 'Failed to create presigned upload URL',
      'signed-url': 'Failed to create signed URL',
    };

    return res.status(400).json({
      success: false,
      message:
        error instanceof Error ? error.message : fallbackByAction[action] || 'R2 request failed',
    });
  }
}
