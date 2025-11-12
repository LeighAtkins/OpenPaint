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
        const origin = process.env.CF_WORKER_URL || 'https://openpaint-ai-worker.sofapaint-api.workers.dev';
        const apiKey = process.env.CF_API_KEY;

        if (!origin) {
            return res.status(500).json({ success: false, message: 'CF_WORKER_URL is not configured' });
        }

        if (!apiKey) {
            return res.status(500).json({ success: false, message: 'CF_API_KEY is not configured' });
        }

        const response = await fetch(`${origin.replace(/\/$/, '')}/images/direct-upload`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey
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
