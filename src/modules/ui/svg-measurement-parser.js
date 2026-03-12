function parseNumericAttr(rawValue, fallback = 0) {
  const source = String(rawValue || '').trim();
  if (!source) return fallback;
  const match = source.match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : fallback;
}

function parseViewBox(svgRoot) {
  const viewBox = String(svgRoot?.getAttribute('viewBox') || '').trim();
  if (!viewBox) return null;
  const parts = viewBox
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
  if (parts.length !== 4) return null;
  return {
    minX: parts[0],
    minY: parts[1],
    width: parts[2],
    height: parts[3],
  };
}

function getSvgDimensions(svgRoot) {
  const viewBox = parseViewBox(svgRoot);
  const width = viewBox?.width || parseNumericAttr(svgRoot?.getAttribute('width'), 1600) || 1600;
  const height =
    viewBox?.height || parseNumericAttr(svgRoot?.getAttribute('height'), 900) || 900;
  return {
    minX: viewBox?.minX || 0,
    minY: viewBox?.minY || 0,
    width,
    height,
  };
}

function parsePoints(pointsStr) {
  if (!pointsStr) return [];
  const values = String(pointsStr)
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
  const points = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    points.push({ x: values[i], y: values[i + 1] });
  }
  return points;
}

function extractPathStartPoint(pathData) {
  const match = /[Mm]\s*([-\d.]+)[\s,]+([-\d.]+)/.exec(String(pathData || ''));
  if (!match) return null;
  return {
    x: Number(match[1]),
    y: Number(match[2]),
  };
}

function extractPathPoints(pathData) {
  if (!pathData || typeof document === 'undefined') return [];
  try {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    const totalLength = path.getTotalLength?.();
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      const start = extractPathStartPoint(pathData);
      return start ? [start] : [];
    }
    const sampleCount = Math.max(8, Math.min(32, Math.ceil(totalLength / 24)));
    const points = [];
    for (let i = 0; i <= sampleCount; i += 1) {
      const point = path.getPointAtLength((totalLength * i) / sampleCount);
      points.push({ x: point.x, y: point.y });
    }
    return points;
  } catch {
    const start = extractPathStartPoint(pathData);
    return start ? [start] : [];
  }
}

function lineFromElement(el) {
  const tagName = String(el?.tagName || '').toLowerCase();
  if (tagName === 'line') {
    return {
      x1: parseNumericAttr(el.getAttribute('x1')),
      y1: parseNumericAttr(el.getAttribute('y1')),
      x2: parseNumericAttr(el.getAttribute('x2')),
      y2: parseNumericAttr(el.getAttribute('y2')),
    };
  }
  if (tagName === 'polyline') {
    const points = parsePoints(el.getAttribute('points') || '');
    if (points.length >= 2) {
      return {
        x1: points[0].x,
        y1: points[0].y,
        x2: points[points.length - 1].x,
        y2: points[points.length - 1].y,
      };
    }
  }
  if (tagName === 'path') {
    const points = extractPathPoints(el.getAttribute('d') || '');
    if (points.length >= 2) {
      return {
        x1: points[0].x,
        y1: points[0].y,
        x2: points[points.length - 1].x,
        y2: points[points.length - 1].y,
      };
    }
    const start = extractPathStartPoint(el.getAttribute('d') || '');
    if (start) {
      return {
        x1: start.x,
        y1: start.y,
        x2: start.x,
        y2: start.y,
      };
    }
  }
  return null;
}

function normalizeMeasurementLabel(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  const collapsed = raw.replace(/\s+/g, ' ');
  const tokenized = collapsed
    .replace(/^mos\d+_/i, '')
    .replace(/_(label|text)$/i, '')
    .replace(/[^A-Za-z0-9.+\-()/ ]/g, '')
    .trim();
  return tokenized;
}

function isInternalMeasurementToken(label) {
  return /^[mbc][a-z0-9-]+(?:cm|mm|in)\d*$/i.test(String(label || '').trim());
}

function extractGuideToken(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  const stripped = raw
    .replace(/^mos\d+_/i, '')
    .replace(/^(?:m|b|c)/i, '')
    .replace(/(?:cm|mm|in)\d*$/i, '')
    .replace(/_(label|text)$/i, '')
    .trim();
  return normalizeMeasurementLabel(stripped);
}

function getElementLabel(el) {
  if (!el) return '';
  const textNode = el.querySelector?.('text');
  const textLabel = normalizeMeasurementLabel(textNode?.textContent || '');
  if (textLabel && textLabel !== '0000.00') return textLabel;

  const ownText = normalizeMeasurementLabel(el.textContent || '');
  if (ownText && ownText !== '0000.00') return ownText;

  const dataLabel = normalizeMeasurementLabel(el.getAttribute?.('data-label') || '');
  if (dataLabel) return dataLabel;

  const idLabel = normalizeMeasurementLabel(el.getAttribute?.('id') || '');
  if (isInternalMeasurementToken(idLabel)) return '';
  if (idLabel) return idLabel;

  return '';
}

function collectTokenizedMeasurements(svgRoot) {
  const labelByToken = new Map();
  const linesByToken = new Map();

  Array.from(svgRoot.querySelectorAll('g[id]')).forEach(groupEl => {
    const groupId = String(groupEl.getAttribute('id') || '').trim();
    if (!groupId) return;
    const prefix = groupId[0]?.toLowerCase();
    const token = extractGuideToken(groupId);
    if (!token) return;

    if (prefix === 'c') {
      const label = getElementLabel(groupEl) || token;
      if (label) {
        labelByToken.set(token, label);
      }
      return;
    }

    if (prefix !== 'm') return;

    const lines = Array.from(groupEl.querySelectorAll('line, polyline, path'))
      .map(lineFromElement)
      .filter(Boolean);
    if (lines.length) {
      linesByToken.set(token, lines);
    }
  });

  return Array.from(linesByToken.entries()).map(([token, lines]) => ({
    label: labelByToken.get(token) || token,
    lines,
  }));
}

function collectMeasurementFromGroup(groupEl, fallbackIndex) {
  const lines = Array.from(groupEl.querySelectorAll('line, polyline, path'))
    .map(lineFromElement)
    .filter(Boolean);
  if (!lines.length) return null;
  const label = getElementLabel(groupEl) || `Measurement ${fallbackIndex}`;
  return {
    label,
    lines,
  };
}

function collectStandaloneMeasurements(svgRoot, existingLabels) {
  const textNodes = Array.from(svgRoot.querySelectorAll('text'))
    .map(node => ({
      label: normalizeMeasurementLabel(node.textContent || ''),
      x: parseNumericAttr(node.getAttribute('x')),
      y: parseNumericAttr(node.getAttribute('y')),
    }))
    .filter(node => node.label);

  return Array.from(svgRoot.querySelectorAll('line, polyline, path'))
    .map((el, index) => {
      if (el.closest('g')) return null;
      const line = lineFromElement(el);
      if (!line) return null;

      const cx = (line.x1 + line.x2) / 2;
      const cy = (line.y1 + line.y2) / 2;
      const nearestText = textNodes.reduce(
        (best, node) => {
          const distance = Math.hypot(node.x - cx, node.y - cy);
          if (distance < best.distance) {
            return { node, distance };
          }
          return best;
        },
        { node: null, distance: Infinity }
      ).node;

      const preferredLabel = nearestText?.label || getElementLabel(el) || `Measurement ${index + 1}`;
      const label = existingLabels.has(preferredLabel)
        ? `${preferredLabel} ${index + 1}`
        : preferredLabel;
      existingLabels.add(label);
      return {
        label,
        lines: [line],
      };
    })
    .filter(Boolean);
}

export function parseSvgMeasurements(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(svgText || ''), 'image/svg+xml');
  const svgRoot = doc.querySelector('svg');
  if (!svgRoot) {
    return {
      dimensions: { minX: 0, minY: 0, width: 1600, height: 900 },
      measurements: [],
      totalMeasurements: 0,
    };
  }

  const dimensions = getSvgDimensions(svgRoot);
  const tokenizedMeasurements = collectTokenizedMeasurements(svgRoot);
  if (tokenizedMeasurements.length > 0) {
    return {
      dimensions,
      measurements: tokenizedMeasurements,
      totalMeasurements: tokenizedMeasurements.length,
    };
  }

  const groupedMeasurements = [];
  const seenLabels = new Set();

  Array.from(svgRoot.querySelectorAll('g')).forEach((groupEl, index) => {
    const measurement = collectMeasurementFromGroup(groupEl, index + 1);
    if (!measurement) return;
    if (seenLabels.has(measurement.label)) return;
    seenLabels.add(measurement.label);
    groupedMeasurements.push(measurement);
  });

  const measurements =
    groupedMeasurements.length > 0
      ? groupedMeasurements
      : collectStandaloneMeasurements(svgRoot, seenLabels);

  return {
    dimensions,
    measurements,
    totalMeasurements: measurements.length,
  };
}

export function createCoordinateTransformer(dimensions, canvasSize, bgImage) {
  const sourceMinX = Number(dimensions?.minX) || 0;
  const sourceMinY = Number(dimensions?.minY) || 0;
  const sourceWidth = Math.max(1, Number(dimensions?.width) || Number(canvasSize?.width) || 1);
  const sourceHeight = Math.max(
    1,
    Number(dimensions?.height) || Number(canvasSize?.height) || 1
  );

  let renderWidth = Number(canvasSize?.width) || sourceWidth;
  let renderHeight = Number(canvasSize?.height) || sourceHeight;

  if (bgImage) {
    if (typeof bgImage.getScaledWidth === 'function') {
      renderWidth = bgImage.getScaledWidth();
    } else if (Number.isFinite(bgImage.width) && Number.isFinite(bgImage.scaleX)) {
      renderWidth = bgImage.width * bgImage.scaleX;
    }

    if (typeof bgImage.getScaledHeight === 'function') {
      renderHeight = bgImage.getScaledHeight();
    } else if (Number.isFinite(bgImage.height) && Number.isFinite(bgImage.scaleY)) {
      renderHeight = bgImage.height * bgImage.scaleY;
    }
  }

  const centerPoint =
    bgImage && typeof bgImage.getCenterPoint === 'function'
      ? bgImage.getCenterPoint()
      : {
          x: Number(bgImage?.left) || renderWidth / 2,
          y: Number(bgImage?.top) || renderHeight / 2,
        };

  const originX = centerPoint.x - renderWidth / 2;
  const originY = centerPoint.y - renderHeight / 2;

  return (x, y) => ({
    x: originX + ((Number(x) - sourceMinX) / sourceWidth) * renderWidth,
    y: originY + ((Number(y) - sourceMinY) / sourceHeight) * renderHeight,
  });
}
