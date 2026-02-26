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

  const workerBase = getWorkerBaseUrl();
  if (!workerBase) {
    return res.status(500).json({ success: false, message: 'Worker URL not configured' });
  }

  try {
    const response = await fetch(`${workerBase}/measurement-guides/codes`, {
      method: 'GET',
      headers: {
        'x-api-key': getWorkerApiKey(),
        accept: 'application/json',
      },
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Failed to fetch guide code list',
        detail: parsed || text,
      });
    }

    const rawCodes = Array.isArray(parsed?.codes) ? parsed.codes : [];
    const codes = Array.from(
      new Set(
        rawCodes
          .map(code =>
            String(code || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    const sourceViewsByCode =
      parsed?.viewsByCode && typeof parsed.viewsByCode === 'object' ? parsed.viewsByCode : {};
    const viewsByCode = {};
    for (const code of codes) {
      const rawViews = Array.isArray(sourceViewsByCode[code]) ? sourceViewsByCode[code] : ['front'];
      const normalizedViews = Array.from(
        new Set(
          rawViews
            .map(view =>
              String(view || '')
                .trim()
                .toLowerCase()
            )
            .filter(view => view === 'front' || view === 'back' || view === 'side')
        )
      ).sort((a, b) => ['front', 'back', 'side'].indexOf(a) - ['front', 'back', 'side'].indexOf(b));
      viewsByCode[code] = normalizedViews.length ? normalizedViews : ['front'];
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).json({
      success: true,
      count: codes.length,
      codes,
      viewsByCode,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Guide code list proxy failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
