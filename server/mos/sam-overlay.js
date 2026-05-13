const DEFAULT_SAM_SERVICE_URL = 'http://localhost:8090';

function clamp1000(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1000) return 1000;
  return Math.round(n * 1000) / 1000;
}

function midpoint(line) {
  return {
    x: (line.x1 + line.x2) / 2,
    y: (line.y1 + line.y2) / 2,
  };
}

function buildGuideSegments(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i] || {};
    const p2 = points[i + 1] || {};
    if (
      Number.isFinite(p1.x) &&
      Number.isFinite(p1.y) &&
      Number.isFinite(p2.x) &&
      Number.isFinite(p2.y) &&
      (p1.x !== p2.x || p1.y !== p2.y)
    ) {
      segments.push({
        x1: clamp1000(p1.x),
        y1: clamp1000(p1.y),
        x2: clamp1000(p2.x),
        y2: clamp1000(p2.y),
      });
    }
  }
  return segments;
}

function buildAnchorCross(point, size = 7) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
  const x = clamp1000(point.x);
  const y = clamp1000(point.y);
  const s = Math.max(2, Math.min(20, size));
  return [
    { x1: clamp1000(x - s), y1: y, x2: clamp1000(x + s), y2: y },
    { x1: x, y1: clamp1000(y - s), x2: x, y2: clamp1000(y + s) },
  ];
}

function buildFallbackCurve(role, line) {
  const p1 = { x: line.x1, y: line.y1 };
  const p2 = { x: line.x2, y: line.y2 };
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  let bend = Math.min(68, Math.max(14, len * 0.16));
  if (String(role).startsWith('E') || String(role).startsWith('C')) bend *= 1.35;
  if (String(role).startsWith('A') || String(role).startsWith('D')) bend *= 0.8;

  return [p1, { x: clamp1000(mx + nx * bend), y: clamp1000(my + ny * bend) }, p2];
}

function ensureRoleGeometry(roleLines, roleCurves, roleAnchors) {
  const curves = { ...(roleCurves || {}) };
  const anchors = { ...(roleAnchors || {}) };
  const fallbackCurveRoles = new Set(['E1', 'E2', 'C3', 'B1', 'B2']);

  for (const [role, line] of Object.entries(roleLines || {})) {
    const roleSafe = normalizeRoleToken(role) || role;
    if (!Array.isArray(anchors[roleSafe]) || anchors[roleSafe].length < 2) {
      anchors[roleSafe] = [
        { x: line.x1, y: line.y1 },
        { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 },
        { x: line.x2, y: line.y2 },
      ];
    }
    if (
      fallbackCurveRoles.has(roleSafe) &&
      (!Array.isArray(curves[roleSafe]) || curves[roleSafe].length < 2)
    ) {
      curves[roleSafe] = buildFallbackCurve(roleSafe, line);
    }
  }

  return { curves, anchors };
}

function normalizeRoleToken(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9-]/gi, '')
    .toUpperCase();
}

function toSvg(roleLines, roleCurves = {}, roleAnchors = {}, units = 'cm') {
  const entries = Object.entries(roleLines || {}).filter(
    ([, line]) =>
      line &&
      Number.isFinite(line.x1) &&
      Number.isFinite(line.y1) &&
      Number.isFinite(line.x2) &&
      Number.isFinite(line.y2) &&
      (line.x1 !== line.x2 || line.y1 !== line.y2)
  );

  const lineColor = '#DF6868';
  const textColor = '#DF6868';
  const guideColor = '#2CA7A3';
  const anchorColor = '#F59E0B';

  const segments = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">',
    '<rect width="100%" height="100%" fill="none"/>',
  ];

  for (const [role, raw] of entries) {
    const line = {
      x1: clamp1000(raw.x1),
      y1: clamp1000(raw.y1),
      x2: clamp1000(raw.x2),
      y2: clamp1000(raw.y2),
    };
    const center = midpoint(line);
    const roleSafe = normalizeRoleToken(role) || 'X';
    const text = `${roleSafe}${units}`;
    segments.push(
      `<line id="m${roleSafe}${units}" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${lineColor}" stroke-width="2" stroke-linecap="round"/>`
    );

    const curvePoints = Array.isArray(roleCurves?.[roleSafe])
      ? roleCurves[roleSafe]
      : Array.isArray(roleCurves?.[role])
        ? roleCurves[role]
        : [];
    const curveSegments = buildGuideSegments(curvePoints);
    curveSegments.forEach((seg, idx) => {
      segments.push(
        `<line id="g${roleSafe}_${idx}" x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="${guideColor}" stroke-width="1.2" stroke-linecap="round" opacity="0.85"/>`
      );
    });

    const anchors = Array.isArray(roleAnchors?.[roleSafe])
      ? roleAnchors[roleSafe]
      : Array.isArray(roleAnchors?.[role])
        ? roleAnchors[role]
        : [];
    anchors.forEach((anchor, idx) => {
      const anchorLines = buildAnchorCross(anchor, 3.5);
      anchorLines.forEach((seg, segIdx) => {
        segments.push(
          `<line id="a${roleSafe}_${idx}_${segIdx}" x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="${anchorColor}" stroke-width="1" stroke-linecap="round" opacity="0.9"/>`
        );
      });
    });

    segments.push(
      `<text id="t${roleSafe}${units}" x="${clamp1000(center.x + 6)}" y="${clamp1000(center.y - 6)}" fill="${textColor}" font-size="14" font-family="Arial">${text}</text>`
    );
  }

  segments.push('</svg>');
  return segments.join('');
}

function resolveSamServiceUrl() {
  return (process.env.MOS_SAM_SERVICE_URL || DEFAULT_SAM_SERVICE_URL).replace(/\/+$/, '').trim();
}

export async function generateSamOverlay(request) {
  const serviceUrl = resolveSamServiceUrl();
  if (!serviceUrl) {
    return {
      success: false,
      error: 'SAM service URL is not configured',
      debug: { stage: 'config' },
    };
  }

  if (!request?.imageDataUrl) {
    return {
      success: false,
      error: 'SAM strategy requires imageDataUrl',
      debug: { stage: 'request' },
    };
  }

  const payload = {
    imageDataUrl: request.imageDataUrl,
    imageWidth: request.imageWidth,
    imageHeight: request.imageHeight,
    requestedRoles: Array.isArray(request.requestedRoles) ? request.requestedRoles : [],
    viewId: request.viewId || 'front',
    anchorHints:
      request.anchorHints && typeof request.anchorHints === 'object' ? request.anchorHints : {},
  };

  try {
    const response = await fetch(`${serviceUrl}/v1/generate-overlay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text || `HTTP ${response.status}` };
    }

    if (!response.ok) {
      return {
        success: false,
        error: data?.message || `SAM service returned ${response.status}`,
        debug: {
          stage: 'service',
          status: response.status,
          payload: data,
        },
      };
    }

    const roleLines = data?.roleLines && typeof data.roleLines === 'object' ? data.roleLines : {};
    const roleCurves =
      data?.roleCurves && typeof data.roleCurves === 'object' ? data.roleCurves : {};
    const roleAnchors =
      data?.roleAnchors && typeof data.roleAnchors === 'object' ? data.roleAnchors : {};
    const appliedRoles = Object.keys(roleLines);
    const requested = payload.requestedRoles.map(normalizeRoleToken).filter(Boolean);
    const missingRoles = requested.filter(role => !appliedRoles.includes(role));
    const geometry = ensureRoleGeometry(roleLines, roleCurves, roleAnchors);
    const svg = toSvg(roleLines, geometry.curves, geometry.anchors, request.units || 'cm');

    return {
      success: appliedRoles.length > 0,
      svg,
      attemptMode: 'sam',
      rolesApplied: appliedRoles,
      missingRoles,
      debug: {
        strategy: 'sam',
        serviceUrl,
        roleCoverage: requested.length
          ? Math.round((appliedRoles.length / requested.length) * 100)
          : null,
        sam: data?.debug || null,
      },
      error: appliedRoles.length > 0 ? undefined : 'SAM produced no role lines',
    };
  } catch (error) {
    return {
      success: false,
      error: `SAM service request failed: ${error instanceof Error ? error.message : String(error)}`,
      debug: { stage: 'fetch' },
    };
  }
}
