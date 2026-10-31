import type { MeasurementPlacement } from './placement-model';

export interface ReferenceMeasurement {
  view: MeasurementPlacement['images'][number]['view'];
  imageId?: string;
  componentId?: string;
  label: string;
  pathKind?: 'span' | 'surface-path';
  points: Array<{ x: number; y: number }>;
  frame?: BenchmarkImageFrame;
}

export interface BenchmarkImageFrame {
  sha256: string;
  width: number;
  height: number;
}
interface Point {
  x: number;
  y: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function pointToPath(point: Point, path: Point[]) {
  let closest = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1))
    );
    closest = Math.min(closest, distance(point, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return closest;
}

function pathSamples(path: Point[], requestedStep: number) {
  const length = path.slice(1).reduce((n, p, i) => n + distance(path[i], p), 0);
  const step = Math.max(requestedStep, length / (2048 - path.length));
  const points = [path[0]];
  let largestGap = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const length = distance(a, b);
    const count = Math.max(1, Math.ceil(length / step));
    largestGap = Math.max(largestGap, length / count);
    for (let j = 1; j <= count; j++) {
      const t = j / count;
      points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return { points, largestGap };
}

/** Symmetric geometric deviation, with an explicit bound on sampling error. */
function pathDeviation(a: Point[], b: Point[], step: number) {
  const left = pathSamples(a, step),
    right = pathSamples(b, step);
  let sampled = 0;
  for (const p of left.points) sampled = Math.max(sampled, pointToPath(p, b));
  for (const p of right.points) sampled = Math.max(sampled, pointToPath(p, a));
  return { sampled, upperBound: sampled + Math.max(left.largestGap, right.largestGap) / 2 };
}

function validPoints(points: Point[]) {
  return (
    points.length >= 2 &&
    points.length <= 128 &&
    points.every(
      p =>
        Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
    ) &&
    points.some(p => distance(points[0], p) > 1e-9)
  );
}

function validFrame(frame: BenchmarkImageFrame) {
  return (
    /^[a-f0-9]{64}$/.test(frame.sha256) &&
    Number.isInteger(frame.width) &&
    frame.width > 0 &&
    Number.isInteger(frame.height) &&
    frame.height > 0
  );
}

/** Use only the same original photo framing. Scores cannot establish physical correctness. */
export function scoreMeasurementPlacement(
  plan: MeasurementPlacement,
  reference: ReferenceMeasurement[],
  candidateFrames: Record<string, BenchmarkImageFrame> = {}
) {
  const actual = plan.measurements.map(m => {
    const point = (id: string) =>
      plan.features.find(f => f.id === id)?.observations.find(o => o.imageId === m.imageId)?.point;
    const start = point(m.startFeatureId);
    const end = point(m.endFeatureId);
    return {
      view: plan.images.find(i => i.id === m.imageId)?.view,
      imageId: m.imageId,
      componentId: m.componentId,
      label: m.label,
      pathKind: m.path.kind,
      points: m.path.kind === 'surface-path' ? m.path.points : start && end ? [start, end] : [],
    };
  });
  const matchesReference = (m: (typeof actual)[number], r: ReferenceMeasurement) =>
    m.view === r.view &&
    m.label === r.label &&
    (!r.imageId || m.imageId === r.imageId) &&
    (!r.componentId || m.componentId === r.componentId);
  const rows = reference.map(r => {
    const identity = {
      view: r.view,
      label: r.label,
      imageId: r.imageId,
      componentId: r.componentId,
    };
    if (!validPoints(r.points) || (r.pathKind === 'span' && r.points.length !== 2))
      return { ...identity, status: 'invalid-reference' };
    const matches = actual.filter(m => matchesReference(m, r));
    if (
      matches.length !== 1 ||
      reference.filter(other => matches[0] && matchesReference(matches[0], other)).length !== 1
    )
      return { ...identity, status: matches.length ? 'ambiguous' : 'missing' };
    const a = matches[0].points;
    const b = r.points;
    if (!validPoints(a)) return { ...identity, status: 'invalid' };
    const frame = candidateFrames[matches[0].imageId];
    if (r.frame && (!r.imageId || !validFrame(r.frame) || !frame || !validFrame(frame)))
      return { ...identity, status: 'unverified-framing' };
    if (
      r.frame &&
      frame &&
      (r.frame.sha256 !== frame.sha256 ||
        r.frame.width !== frame.width ||
        r.frame.height !== frame.height)
    )
      return { ...identity, status: 'framing-mismatch' };
    const direct = [distance(a[0], b[0]), distance(a.at(-1)!, b.at(-1)!)];
    const reverse = [distance(a[0], b.at(-1)!), distance(a.at(-1)!, b[0])];
    const errors = direct[0] + direct[1] <= reverse[0] + reverse[1] ? direct : reverse;
    const shape = pathDeviation(a, b, 0.002);
    const pixels =
      r.frame && frame
        ? (p: Point) => ({ x: p.x * frame.width, y: p.y * frame.height })
        : undefined;
    let pixelErrors: number[] | undefined;
    if (pixels) {
      const directPixels = [
        distance(pixels(a[0]), pixels(b[0])),
        distance(pixels(a.at(-1)!), pixels(b.at(-1)!)),
      ];
      const reversePixels = [
        distance(pixels(a[0]), pixels(b.at(-1)!)),
        distance(pixels(a.at(-1)!), pixels(b[0])),
      ];
      pixelErrors =
        directPixels[0] + directPixels[1] <= reversePixels[0] + reversePixels[1]
          ? directPixels
          : reversePixels;
    }
    const pixelShape = pixels ? pathDeviation(a.map(pixels), b.map(pixels), 1) : undefined;
    return {
      ...identity,
      status: 'matched',
      meanEndpointError: (errors[0] + errors[1]) / 2,
      maxEndpointError: Math.max(...errors),
      pathTypeMismatch:
        matches[0].pathKind !== (r.pathKind || (b.length > 2 ? 'surface-path' : 'span')),
      referencePathKindInferred: !r.pathKind,
      maxPathDeviation: shape.sampled,
      maxPathDeviationUpperBound: shape.upperBound,
      framingVerified: Boolean(r.frame && frame),
      ...(pixelErrors && pixelShape
        ? {
            maxEndpointErrorPixels: Math.max(...pixelErrors),
            maxPathDeviationPixels: pixelShape.sampled,
            maxPathDeviationUpperBoundPixels: pixelShape.upperBound,
          }
        : {}),
    };
  });
  const testedViews = new Set(reference.map(r => r.view));
  const unexpected = actual
    .filter(a => reference.some(r => r.view === a.view && (!r.imageId || r.imageId === a.imageId)))
    .filter(a => !reference.some(r => matchesReference(a, r)))
    .map(a => ({ view: a.view, label: a.label }));
  return {
    rows,
    unexpected,
    missing: rows.filter(r => r.status === 'missing').length,
    framingRequirement:
      'Reference and candidate must use the identical original photos and full-photo normalized coordinates.',
    requiresHumanReview: true,
    claimsPhysicalAccuracy: false,
    contourMetric:
      'Symmetric sampled point-to-polyline distance. The upper bound includes the maximum sampling-gap error.',
    unscoredImages: plan.images
      .filter(
        image =>
          !reference.some(r => r.view === image.view && (!r.imageId || r.imageId === image.id))
      )
      .map(image => image.id),
    unscoredViews: plan.images
      .filter(image => !testedViews.has(image.view))
      .map(image => image.view),
  };
}
