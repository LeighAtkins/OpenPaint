/**
 * Serverless function for proxying image direct-upload to Cloudflare Worker
 * Vercel deploys this as /api/images/direct-upload
 */
module.exports = async (req, res) => {
    // Only accept POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const origin = process.env.REMBG_ORIGIN || 'https://sofapaint-api.leigh-atkins.workers.dev';
        if (!origin) {
            return res.status(500).json({ success: false, message: 'REMBG_ORIGIN is not configured' });
        }

        const response = await fetch(`${origin.replace(/\/$/, '')}/images/direct-upload`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': 'dev-secret'
            },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        console.error('Proxy /api/images/direct-upload error:', err);
        res.status(500).json({ success: false, message: 'Proxy error', error: err.message });
    }
};
