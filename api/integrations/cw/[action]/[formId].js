import measurementsHandler from '../../../../server/vercel-routes/cw/measurements.js';
import testSaveHandler from '../../../../server/vercel-routes/cw/test-save.js';

const ACTIONS = {
  measurements: measurementsHandler,
  'test-save': testSaveHandler,
};

export default async function handler(req, res) {
  const action = String(req.query?.action || '').trim();
  const routeHandler = ACTIONS[action];

  if (!routeHandler) {
    return res.status(404).json({
      success: false,
      message: 'CW form route not found',
    });
  }

  return routeHandler(req, res);
}
