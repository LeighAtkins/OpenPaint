import { getHealthPayload } from './_shared.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  return res.status(200).json(getHealthPayload());
}
