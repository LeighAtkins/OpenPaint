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
  const height = viewBox?.height || parseNumericAttr(svgRoot?.getAttribute('height'), 900) || 900;
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

function buildClassColorMap(svgRoot) {
  const styleEl = svgRoot.querySelector('style');
  if (!styleEl) return null;
  const cssText = styleEl.textContent || '';
  const map = {};
  const classRulePattern = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = classRulePattern.exec(cssText)) !== null) {
    const className = match[1];
    const ruleBody = match[2];
    const strokeMatch = /stroke\s*:\s*(#[0-9A-Fa-f]{3,8})/.exec(ruleBody);
    if (strokeMatch) {
      map[className] = strokeMatch[1];
    }
  }
  return Object.keys(map).length ? map : null;
}

function resolveElementColor(el, classColorMap) {
  if (!el) return null;
  const inlineStroke = el.getAttribute('style');
  if (inlineStroke) {
    const m = /stroke\s*:\s*(#[0-9A-Fa-f]{3,8})/.exec(inlineStroke);
    if (m) return m[1];
  }
  const strokeAttr = el.getAttribute('stroke');
  if (strokeAttr) return strokeAttr;
  if (classColorMap) {
    const cls = el.getAttribute('class') || '';
    for (const c of cls.split(/\s+/)) {
      if (classColorMap[c]) return classColorMap[c];
    }
  }
  return null;
}

function segmentFromElement(el, classColorMap) {
  const tagName = String(el?.tagName || '').toLowerCase();
  const color = resolveElementColor(el, classColorMap);
  if (tagName === 'line') {
    const x1 = parseNumericAttr(el.getAttribute('x1'));
    const y1 = parseNumericAttr(el.getAttribute('y1'));
    const x2 = parseNumericAttr(el.getAttribute('x2'));
    const y2 = parseNumericAttr(el.getAttribute('y2'));
    if (x1 === x2 && y1 === y2) return null;
    return {
      kind: 'line',
      x1,
      y1,
      x2,
      y2,
      color,
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
    };
  }
  if (tagName === 'polyline') {
    const points = parsePoints(el.getAttribute('points') || '');
    if (points.length >= 2) {
      return {
        kind: 'curve',
        x1: points[0].x,
        y1: points[0].y,
        x2: points[points.length - 1].x,
        y2: points[points.length - 1].y,
        color,
        points,
      };
    }
  }
  if (tagName === 'path') {
    const points = extractPathPoints(el.getAttribute('d') || '');
    if (points.length >= 2) {
      const last = points[points.length - 1];
      if (Math.abs(points[0].x - last.x) < 0.5 && Math.abs(points[0].y - last.y) < 0.5) return null;
      return {
        kind: 'curve',
        x1: points[0].x,
        y1: points[0].y,
        x2: last.x,
        y2: last.y,
        color,
        points,
      };
    }
    return null;
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
  if (/_[0-9]{10,}/.test(raw)) return '';
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

function collectTokenizedMeasurements(svgRoot, classColorMap) {
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

    const directLines = Array.from(groupEl.children).reduce((acc, child) => {
      if (child.tagName === 'g') return acc;
      const seg = segmentFromElement(child, classColorMap);
      if (seg) acc.push(seg);
      return acc;
    }, []);

    const innerGroupLines = Array.from(groupEl.querySelectorAll(':scope > g')).flatMap(innerG =>
      Array.from(innerG.children)
        .map(el => segmentFromElement(el, classColorMap))
        .filter(Boolean)
    );

    const lines = directLines.length ? directLines : innerGroupLines.length ? innerGroupLines : [];
    if (lines.length && !linesByToken.has(token)) {
      linesByToken.set(token, lines);
    }
  });

  return Array.from(linesByToken.entries()).map(([token, lines]) => ({
    label: labelByToken.get(token) || token,
    lines,
  }));
}

function isSaturatedColor(hex) {
  const parts = /^#?([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/.exec(String(hex || ''));
  if (!parts) return false;
  const r = parseInt(parts[1], 16);
  const g = parseInt(parts[2], 16);
  const b = parseInt(parts[3], 16);
  return Math.max(r, g, b) - Math.min(r, g, b) > 40;
}

function getMeasurementStyleClasses(svgRoot) {
  const styleEl = svgRoot.querySelector('style');
  if (!styleEl) return null;
  const cssText = styleEl.textContent || '';
  const measurementClasses = new Set();
  const classRulePattern = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = classRulePattern.exec(cssText)) !== null) {
    const className = match[1];
    const ruleBody = match[2];
    const hasStroke = /stroke\s*:/.test(ruleBody);
    const isDashed = /stroke-dasharray/.test(ruleBody);
    if (!hasStroke && !isDashed) continue;
    if (isDashed) {
      measurementClasses.add(className);
      continue;
    }
    const strokeMatch = /stroke\s*:\s*(#[0-9A-Fa-f]{3,8})/.exec(ruleBody);
    if (strokeMatch && isSaturatedColor(strokeMatch[1])) {
      measurementClasses.add(className);
    }
  }
  return measurementClasses.size > 0 ? measurementClasses : null;
}

function isMeasurementElement(el, measurementClasses) {
  if (!measurementClasses) return true;
  const classAttr = el.getAttribute('class') || '';
  for (const cls of classAttr.split(/\s+/)) {
    if (measurementClasses.has(cls)) return true;
  }
  return false;
}

function getSegmentLength(segment) {
  const points = Array.isArray(segment?.points) ? segment.points : [];
  if (points.length >= 2) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y
      );
    }
    return total;
  }
  return Math.hypot(
    (segment?.x2 || 0) - (segment?.x1 || 0),
    (segment?.y2 || 0) - (segment?.y1 || 0)
  );
}

function distancePointToSegment(point, segment) {
  const points =
    Array.isArray(segment?.points) && segment.points.length >= 2
      ? segment.points
      : [
          { x: segment?.x1 || 0, y: segment?.y1 || 0 },
          { x: segment?.x2 || 0, y: segment?.y2 || 0 },
        ];

  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
          )
        : 0;
    const x = start.x + t * dx;
    const y = start.y + t * dy;
    best = Math.min(best, Math.hypot(point.x - x, point.y - y));
  }
  return best;
}

function getTextPosition(textEl) {
  const transform = String(textEl.getAttribute?.('transform') || '');
  const matrixMatch = /matrix\([^)]*?(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(transform);
  if (matrixMatch) {
    return {
      x: Number(matrixMatch[1]),
      y: Number(matrixMatch[2]),
    };
  }

  return {
    x: parseNumericAttr(textEl.getAttribute?.('x')),
    y: parseNumericAttr(textEl.getAttribute?.('y')),
  };
}

function collectAdjacentTextLabels(svgRoot) {
  const tokens = Array.from(svgRoot.querySelectorAll('text'))
    .map(node => {
      const position = getTextPosition(node);
      return {
        node,
        label: normalizeMeasurementLabel(node.textContent || ''),
        x: position.x,
        y: position.y,
      };
    })
    .filter(item => item.label && Number.isFinite(item.x) && Number.isFinite(item.y))
    .sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x));

  const labels = [];
  const consumed = new Set();
  tokens.forEach((token, index) => {
    if (consumed.has(index)) return;
    let label = token.label;
    let maxX = token.x;
    let count = 1;
    consumed.add(index);

    for (let nextIndex = index + 1; nextIndex < tokens.length; nextIndex += 1) {
      const next = tokens[nextIndex];
      if (consumed.has(nextIndex)) continue;
      if (Math.abs(next.y - token.y) > 3) break;
      const gap = next.x - maxX;
      if (gap < -1 || gap > 18) continue;
      const candidate = `${label}${next.label}`;
      if (!/^[A-Za-z]?\d*$/.test(candidate) && !/^[A-Za-z]\d+$/.test(candidate)) continue;
      label = candidate;
      maxX = next.x;
      count += 1;
      consumed.add(nextIndex);
    }

    const normalized = normalizeMeasurementLabel(label);
    if (/^[A-Za-z]\d+$/.test(normalized)) {
      labels.push({
        label: normalized.toUpperCase(),
        x: (token.x + maxX) / 2,
        y: token.y,
        count,
      });
    }
  });

  const byLabel = new Map();
  labels.forEach(item => {
    if (!byLabel.has(item.label)) byLabel.set(item.label, item);
  });
  return Array.from(byLabel.values());
}

function collectIllustratorStandaloneMeasurements(svgRoot, measurementClasses, classColorMap) {
  const labels = collectAdjacentTextLabels(svgRoot);
  if (labels.length < 2 || !measurementClasses) return [];

  const candidates = Array.from(svgRoot.querySelectorAll('line, polyline, path'))
    .filter(el => isMeasurementElement(el, measurementClasses))
    .map(el => {
      const segment = segmentFromElement(el, classColorMap);
      if (!segment) return null;
      const length = getSegmentLength(segment);
      if (length < 20) return null;
      return {
        segment,
        length,
      };
    })
    .filter(Boolean);

  if (!candidates.length) return [];

  const used = new Set();
  return labels
    .map(label => {
      let best = null;
      candidates.forEach((candidate, index) => {
        if (used.has(index)) return;
        const distance = distancePointToSegment(label, candidate.segment);
        if (distance > 120) return;
        const score = 1 / Math.max(1, distance);
        if (!best || score > best.score) {
          best = {
            index,
            score,
            distance,
            candidate,
          };
        }
      });
      if (!best) return null;
      used.add(best.index);
      return {
        label: label.label,
        lines: [best.candidate.segment],
      };
    })
    .filter(Boolean);
}

function collectMeasurementFromGroup(groupEl, fallbackIndex, measurementClasses, classColorMap) {
  const lines = Array.from(groupEl.querySelectorAll('line, polyline, path'))
    .filter(el => isMeasurementElement(el, measurementClasses))
    .map(el => segmentFromElement(el, classColorMap))
    .filter(Boolean);
  if (!lines.length) return null;
  const label = getElementLabel(groupEl) || `Measurement ${fallbackIndex}`;
  return {
    label,
    lines,
  };
}

function collectStandaloneMeasurements(svgRoot, existingLabels, classColorMap) {
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
      const line = segmentFromElement(el, classColorMap);
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

      const preferredLabel =
        nearestText?.label || getElementLabel(el) || `Measurement ${index + 1}`;
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
  const classColorMap = buildClassColorMap(svgRoot);
  const tokenizedMeasurements = collectTokenizedMeasurements(svgRoot, classColorMap);

  if (tokenizedMeasurements.length > 0) {
    // Also check for measurements in non-m-prefixed groups that have
    // child text labels (legacy format mixed with m-prefixed groups)
    const seenLabels = new Set(tokenizedMeasurements.map(m => m.label));
    const extraMeasurements = [];

    Array.from(svgRoot.querySelectorAll('g:not([id*="m" i])')).forEach(groupEl => {
      const hasLabel = groupEl.querySelector('text, tspan');
      if (!hasLabel) return;
      const measurement = collectMeasurementFromGroup(groupEl, 0, null, classColorMap);
      if (!measurement) return;
      if (seenLabels.has(measurement.label)) return;
      seenLabels.add(measurement.label);
      extraMeasurements.push(measurement);
    });

    if (extraMeasurements.length > 0) {
      tokenizedMeasurements.push(...extraMeasurements);
    }

    return {
      dimensions,
      measurements: tokenizedMeasurements,
      totalMeasurements: tokenizedMeasurements.length,
    };
  }

  const groupedMeasurements = [];
  const seenLabels = new Set();
  const measurementClasses = getMeasurementStyleClasses(svgRoot);
  const illustratorMeasurements = collectIllustratorStandaloneMeasurements(
    svgRoot,
    measurementClasses,
    classColorMap
  );

  if (illustratorMeasurements.length > 0) {
    return {
      dimensions,
      measurements: illustratorMeasurements,
      totalMeasurements: illustratorMeasurements.length,
    };
  }

  Array.from(svgRoot.querySelectorAll('g')).forEach((groupEl, index) => {
    const measurement = collectMeasurementFromGroup(
      groupEl,
      index + 1,
      measurementClasses,
      classColorMap
    );
    if (!measurement) return;
    if (seenLabels.has(measurement.label)) return;
    seenLabels.add(measurement.label);
    groupedMeasurements.push(measurement);
  });

  const measurements =
    groupedMeasurements.length > 0
      ? groupedMeasurements
      : collectStandaloneMeasurements(svgRoot, seenLabels, classColorMap);

  const validMeasurements = measurements.filter(m => /^[A-Za-z]\d*$/.test(m.label));

  return {
    dimensions,
    measurements: validMeasurements.length ? validMeasurements : measurements,
    totalMeasurements: validMeasurements.length || measurements.length,
  };
}

export function createCoordinateTransformer(dimensions, canvasSize, bgImage) {
  const sourceMinX = Number(dimensions?.minX) || 0;
  const sourceMinY = Number(dimensions?.minY) || 0;
  const sourceWidth = Math.max(1, Number(dimensions?.width) || Number(canvasSize?.width) || 1);
  const sourceHeight = Math.max(1, Number(dimensions?.height) || Number(canvasSize?.height) || 1);

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
