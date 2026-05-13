function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function normalizeView(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'front' || v === 'back' || v === 'side') return v;
  return '';
}

function normalizeHideBoxes(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function getWorkerBaseUrl() {
  return (
    process.env.MEASUREMENT_GUIDE_WORKER_URL ||
    process.env.CF_WORKER_URL ||
    process.env.AI_WORKER_URL ||
    ''
  )
    .toString()
    .trim()
    .replace(/\/+$/, '');
}

function getWorkerApiKey() {
  return (process.env.MEASUREMENT_GUIDE_WORKER_API_KEY || process.env.AI_WORKER_KEY || 'dev-secret')
    .toString()
    .trim();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const code = normalizeCode(req.query?.code);
  const view = normalizeView(req.query?.view);
  const hideBoxes = normalizeHideBoxes(req.query?.hideBoxes);
  if (!code || !view) {
    return res.status(400).json({ success: false, message: 'Invalid code or view' });
  }

  const workerBase = getWorkerBaseUrl();
  if (!workerBase) {
    return res.status(500).json({ success: false, message: 'Worker URL not configured' });
  }

  const headers = {
    'x-api-key': getWorkerApiKey(),
    accept: 'image/svg+xml,application/json',
  };

  const candidateViews = Array.from(new Set([view, 'front', 'back', 'side']));
  let lastStatus = 500;
  let lastDetail = '';

  try {
    for (const candidateView of candidateViews) {
      const hideBoxesParam = hideBoxes ? '&hideBoxes=1' : '';
      const svgResponse = await fetch(
        `${workerBase}/measurement-guides/svg?code=${encodeURIComponent(code)}&view=${encodeURIComponent(candidateView)}${hideBoxesParam}`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!svgResponse.ok) {
        lastStatus = svgResponse.status;
        lastDetail = await svgResponse.text();
        continue;
      }

      const contentType = svgResponse.headers.get('content-type') || 'image/svg+xml; charset=utf-8';
      const body = Buffer.from(await svgResponse.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=120');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('x-guide-view-requested', view);
      res.setHeader('x-guide-view-resolved', candidateView);
      res.setHeader('x-guide-hide-boxes', hideBoxes ? '1' : '0');
      return res.status(200).send(body);
    }

    return res.status(lastStatus || 404).json({
      success: false,
      message: 'Failed to fetch guide SVG',
      detail: lastDetail || `Guide not found for views: ${candidateViews.join(', ')}`,
      requestedView: view,
      attemptedViews: candidateViews,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Guide proxy failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
