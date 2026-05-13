import guideModelsHandler from '../../../server/vercel-routes/cw/guide-models.js';
import healthHandler from '../../../server/vercel-routes/cw/health.js';

const ACTIONS = {
  'guide-models': guideModelsHandler,
  health: healthHandler,
};

export default async function handler(req, res) {
  const action = String(req.query?.action || '').trim();
  const routeHandler = ACTIONS[action];

  if (!routeHandler) {
    return res.status(404).json({
      success: false,
      message: 'CW route not found',
    });
  }

  return routeHandler(req, res);
}
