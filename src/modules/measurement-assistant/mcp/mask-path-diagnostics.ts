import type { MeasurementPlacement } from '../placement-model';
import type { MaskEvidence } from './mask-service';

interface Point {
  x: number;
  y: number;
}
interface Sample {
  point: Point;
  weight: number;
  start: number;
  end: number;
}

function indexBitmap(counts: number[]) {
  const ends = new Uint32Array(counts.length);
  let end = 0;
  counts.forEach((count, index) => {
    end += count;
    ends[index] = end;
  });
  return (pixel: number) => {
    let low = 0,
      high = ends.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ends[mid] <= pixel) low = mid + 1;
      else high = mid;
    }
    return low < ends.length && low % 2 === 1;
  };
}

function samples(points: Point[], width: number, height: number) {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot((p.x - points[i].x) * width, (p.y - points[i].y) * height));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const step = Math.max(Math.max(width, height) / 512, total / (2048 - points.length));
  const result: Sample[] = [];
  let offset = 0,
    maxGap = 0;
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i],
      b = points[i + 1],
      length = lengths[i];
    if (length === 0) continue;
    const count = Math.max(1, Math.ceil(length / step));
    maxGap = Math.max(maxGap, length / count);
    for (let n = 0; n < count; n++) {
      const t = (n + 0.5) / count;
      result.push({
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        weight: length / count,
        start: (offset + (length * n) / count) / total,
        end: (offset + (length * (n + 1)) / count) / total,
      });
    }
    offset += length;
  }
  return { result, total, maxGap };
}

/** Agreement with predictions only. Never a physical-accuracy pass or an auto-correction. */
export function maskPathDiagnostics(
  plan: MeasurementPlacement,
  imageId: string,
  evidence: MaskEvidence
) {
  if (!plan.images.some(image => image.id === imageId)) throw new Error('Unknown placement photo.');
  const { width, height } = evidence.image;
  let bitmapQueries = 0;
  const boundaryTolerancePixels = Math.max(width, height) / 256;
  const queries = evidence.instances.map(instance => ({
    instance,
    contains: indexBitmap(instance.bitmap.counts),
  }));
  const pixel = (p: Point) =>
    Math.min(height - 1, Math.floor(p.y * height)) * width +
    Math.min(width - 1, Math.floor(p.x * width));
  const membership = (p: Point) =>
    queries.filter(q => {
      if (++bitmapQueries > 400000)
        throw new Error('Mask diagnostic query budget exceeded; use original-photo review.');
      return q.contains(pixel(p));
    });
  const boundedSupport = (p: Point) => {
    const exact = membership(p).map(q => q.instance.id);
    if (exact.length) return { exactInstanceIds: exact, nearInstanceIds: exact };
    const near = new Set<string>();
    // A small explicit neighbourhood limits boundary-pixel warnings, without closing holes.
    const radius = boundaryTolerancePixels;
    for (const dx of [-radius, 0, radius])
      for (const dy of [-radius, 0, radius]) {
        const point = { x: p.x + dx / width, y: p.y + dy / height };
        if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) continue;
        membership(point).forEach(q => near.add(q.instance.id));
      }
    return { exactInstanceIds: exact, nearInstanceIds: [...near] };
  };
  const rows = plan.measurements
    .filter(m => m.imageId === imageId)
    .map(measurement => {
      const endpoint = (id: string) =>
        plan.features.find(f => f.id === id)?.observations.find(o => o.imageId === imageId)?.point;
      const start = endpoint(measurement.startFeatureId),
        end = endpoint(measurement.endFeatureId);
      if (!start || !end) throw new Error('Measurement endpoints lack photo observations.');
      const points =
        measurement.path.kind === 'surface-path' ? measurement.path.points : [start, end];
      const sampled = samples(points, width, height);
      const overlaps = new Map<string, number>();
      let outside = 0,
        unsupported = 0,
        gap = 0,
        largestGap = 0,
        gapStart = 0,
        largestGapStart = 0,
        largestGapEnd = 0;
      let gapPoint: Point | undefined, largestGapPoint: Point | undefined;
      for (const sample of sampled.result) {
        const matches = membership(sample.point);
        matches.forEach(q =>
          overlaps.set(q.instance.id, (overlaps.get(q.instance.id) || 0) + sample.weight)
        );
        if (matches.length) {
          gap = 0;
          gapPoint = undefined;
          continue;
        }
        outside += sample.weight;
        if (boundedSupport(sample.point).nearInstanceIds.length) {
          gap = 0;
          gapPoint = undefined;
          continue;
        }
        unsupported += sample.weight;
        if (!gapPoint) {
          gapStart = sample.start;
          gapPoint = sample.point;
        }
        gap += sample.weight;
        if (gap > largestGap) {
          largestGap = gap;
          largestGapStart = gapStart;
          largestGapEnd = sample.end;
          largestGapPoint = {
            x: (gapPoint.x + sample.point.x) / 2,
            y: (gapPoint.y + sample.point.y) / 2,
          };
        }
      }
      const startSupport = boundedSupport(start),
        endSupport = boundedSupport(end);
      const fraction = (length: number) =>
        sampled.total ? Math.max(0, Math.min(1, length / sampled.total)) : 0;
      const outsideFraction = fraction(outside);
      const unsupportedFraction = fraction(unsupported);
      const warnings: string[] = [];
      if (queries.length && !startSupport.nearInstanceIds.length)
        warnings.push('start-outside-predicted-furniture');
      if (queries.length && !endSupport.nearInstanceIds.length)
        warnings.push('end-outside-predicted-furniture');
      if (queries.length && unsupportedFraction > 0.25 && largestGap > Math.max(width, height) / 50)
        warnings.push('long-path-outside-predicted-furniture');
      const reviewPoint = largestGapPoint || (!startSupport.nearInstanceIds.length ? start : end);
      const region = warnings.length
        ? {
            x: Math.max(0, Math.min(0.7, reviewPoint.x - 0.15)),
            y: Math.max(0, Math.min(0.7, reviewPoint.y - 0.15)),
            width: 0.3,
            height: 0.3,
          }
        : undefined;
      return {
        measurementId: measurement.id,
        label: measurement.label,
        sampleCount: sampled.result.length,
        maxSampleSpacingPixels: sampled.maxGap,
        predictedOutsideFraction: outsideFraction,
        neighbourhoodUnsupportedFraction: unsupportedFraction,
        longestNeighbourhoodUnsupportedFraction: fraction(largestGap),
        longestNeighbourhoodUnsupportedInterval: [largestGapStart, largestGapEnd],
        instanceOverlap: queries
          .map(({ instance }) => ({
            id: instance.id,
            label: instance.label,
            confidence: instance.confidence,
            pathFraction: fraction(overlaps.get(instance.id) || 0),
          }))
          .filter(overlap => overlap.pathFraction > 0),
        startSupport,
        endSupport,
        warnings,
        suggestedReviewRegion: region,
      };
    });
  return {
    imageId,
    status: queries.length ? 'checked' : 'no-predictions',
    photo: evidence.image,
    model: { id: evidence.model.id, sha256: evidence.model.sha256 },
    rows,
    advisoryOnly: true,
    claimsPhysicalAccuracy: false,
    automaticallyEditsDrawing: false,
    bitmapQueries,
    boundaryTolerancePixels,
    sampling:
      'Length-weighted midpoint samples over exact row-major bitmaps, including occlusion holes. Exact outside coverage is separate from unsupported coverage within a 3-by-3 stencil at the recorded boundary tolerance. Fractions are sampled diagnostics, not exact coverage proofs.',
    instructions:
      'Inspect flagged regions against the original photo. A valid span can cross background, and a model can miss or mislabel furniture. Empty predictions do not mean the sofa is absent. Do not snap lines to masks or infer seams, dimensions, left/right swaps or correctness from agreement.',
  };
}
