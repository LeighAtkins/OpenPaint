import app from '../../server/app.js';

export default function handler(req, res) {
  req.url = '/pdf/render';
  return app(req, res);
}
