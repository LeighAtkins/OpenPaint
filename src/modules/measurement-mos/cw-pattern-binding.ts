import { detectCwPatternLines, type PatternLine } from './cw-pattern-lines';

export type PatternPoint = { x: number; y: number };
export type PatternRole =
  | 'width'
  | 'height'
  | 'thickness'
  | 'top-width'
  | 'bottom-width'
  | 'side-width';
export interface PatternMeasurement {
  id: number;
  name: string;
  value: number;
  unit: string;
}
export interface PatternBinding {
  measurement: PatternMeasurement;
  role: PatternRole;
  guideId: string;
  points: PatternPoint[];
  evidence: 'surface-mark' | 'boundary-mark' | 'surface-transition';
}

/** Semantic slots of the gallery SVGs. These refer to faces, not screen axes.
 * In the boxed guide mTcm joins front/back faces; it can appear on either side.
 * Original SVG coordinates are deliberately not copied onto catalogue images.
 */
export const CW_PATTERN_GUIDES = {
  boxed: {
    path: 'public/measurement-guides/Modular MT /Cushions/Boxed Edge/Archive/-BE (1).svg',
    slots: { width: 'mW1cm', height: 'mD1cm', thickness: 'mTcm' },
  },
  halfKnife: {
    path: 'public/measurement-guides/Modular MT /Cushions/Boxed half-knife/Archive/-HK (1).svg',
    slots: { 'top-width': 'mAcm', 'bottom-width': 'mBcm', height: 'mC1cm', thickness: 'mDcm' },
  },
} as const;

/** Local image evidence plus gallery face semantics; no product-specific coordinates. */
export function bindCwPatternMeasurements(
  rgb: Uint8Array,
  width: number,
  height: number,
  component: string,
  measurements: PatternMeasurement[]
): { bindings: PatternBinding[]; unresolved: string[]; guide: string } {
  const frame = component === 'Frame Cover';
  const knife = measurements.some(measurement => measurement.name === 'Width (Top)');
  const supported =
    frame ||
    knife ||
    ['Seat Cushion Cover', 'Back Cushion Cover', 'Side Cushion Cover'].includes(component);
  const guide = knife ? CW_PATTERN_GUIDES.halfKnife.path : CW_PATTERN_GUIDES.boxed.path;
  if (!supported || rgb.length !== width * height * 3)
    return { bindings: [], unresolved: measurements.map(m => m.name), guide };
  const pixel = (x: number, y: number) => {
    const i =
      (Math.max(0, Math.min(height - 1, Math.round(y))) * width +
        Math.max(0, Math.min(width - 1, Math.round(x)))) *
      3;
    return [rgb[i], rgb[i + 1], rgb[i + 2]];
  };
  const orange = (x: number, y: number, top = false) => {
    const [r, g, b] = pixel(x, y);
    return top ? r > 240 && g > 110 && g < 185 && b < 135 : r > 100 && r > g * 1.45 && g > b * 1.35;
  };
  const darkness = (x: number, y: number) => Math.max(...pixel(x, y));
  const all = detectCwPatternLines(rgb, width, height, {
    allFaces: true,
    minLength: 0.018,
    limit: 180,
  });
  const coordinates = (line: PatternLine) => ({
    x1: line.x1 * width,
    y1: line.y1 * height,
    x2: line.x2 * width,
    y2: line.y2 * height,
  });
  const length = (line: PatternLine) =>
    Math.hypot((line.x2 - line.x1) * width, (line.y2 - line.y1) * height);
  const interior = (line: PatternLine, top = false) => {
    const p = coordinates(line);
    const len = length(line);
    const nx = (-(p.y2 - p.y1) / len) * 5;
    const ny = ((p.x2 - p.x1) / len) * 5;
    let hits = 0;
    for (let i = 2; i <= 18; i++) {
      const t = i / 20;
      const x = p.x1 + (p.x2 - p.x1) * t;
      const y = p.y1 + (p.y2 - p.y1) * t;
      if (orange(x + nx, y + ny, top) && orange(x - nx, y - ny, top)) hits++;
    }
    return hits / 17;
  };
  const slope = (line: PatternLine) =>
    ((line.y2 - line.y1) * height) / ((line.x2 - line.x1) * width || 0.001);
  const shallow = (line: PatternLine) => Math.abs(slope(line)) < 0.5;
  // Infer reflection from long transverse marks, not L/R in an image filename.
  const transverse = all
    .filter(line => shallow(line) && interior(line) > 0.55)
    .sort((a, b) => length(b) - length(a))[0];
  const handedness = !transverse || slope(transverse) >= 0 ? 1 : -1;
  const pick = (
    filter: (line: PatternLine) => boolean,
    score = (line: PatternLine) => length(line) * (0.5 + interior(line))
  ) => all.filter(filter).sort((a, b) => score(b) - score(a))[0];

  // Track actual dark pixels through curvature and intersections. Unlike a Hough
  // segment this recovers the span beyond the seed, up to the visible endpoints.
  const trace = (seed: PatternLine, stopAtSurface = false): PatternPoint[] => {
    const p = coordinates(seed);
    const useX = Math.abs(p.x2 - p.x1) >= Math.abs(p.y2 - p.y1);
    const u1 = useX ? p.x1 : p.y1;
    const v1 = useX ? p.y1 : p.x1;
    const u2 = useX ? p.x2 : p.y2;
    const v2 = useX ? p.y2 : p.x2;
    const tangent = (v2 - v1) / (u2 - u1 || 1);
    const uMid = Math.round((u1 + u2) / 2);
    const vMid = (v1 + v2) / 2;
    const run = (direction: number): PatternPoint[] => {
      const points: PatternPoint[] = [];
      let previous = vMid;
      let misses = 0;
      let surfaceMisses = 0;
      for (let u = uMid; u >= 0 && u < (useX ? width : height); u += direction) {
        const expected = previous + tangent * direction;
        const original = vMid + (u - uMid) * tangent;
        let best = -1;
        let bestCost = Infinity;
        for (let v = Math.round(expected) - 5; v <= Math.round(expected) + 5; v++) {
          if (v < 0 || v >= (useX ? height : width) || Math.abs(v - original) > 24) continue;
          const x = useX ? u : v;
          const y = useX ? v : u;
          if (darkness(x, y) > 125) continue;
          const cost = Math.abs(v - expected) + darkness(x, y) / 150;
          if (cost < bestCost) {
            best = v;
            bestCost = cost;
          }
        }
        if (best < 0) {
          if (++misses > 5) break;
          previous = expected;
          continue;
        }
        misses = 0;
        previous = best;
        const x = useX ? u : best;
        const y = useX ? best : u;
        if (stopAtSurface) {
          const delta = 5 / Math.sqrt(1 + tangent * tangent);
          const nx = useX ? -tangent * delta : delta;
          const ny = useX ? delta : -tangent * delta;
          const onSurface = orange(x + nx, y + ny) && orange(x - nx, y - ny);
          surfaceMisses = onSurface ? 0 : surfaceMisses + 1;
          // A crossing measurement mark temporarily interrupts both side samples.
          if (surfaceMisses > 12) break;
        }
        points.push({ x: x / width, y: y / height });
        if (points.length > 8) {
          const before = points[points.length - 9];
          const du = useX ? x - before.x * width : y - before.y * height;
          const dv = useX ? y - before.y * height : x - before.x * width;
          // Stop at a corner instead of following an unrelated edge after a junction.
          if (Math.abs(dv / du - tangent) > 0.6) {
            points.splice(-8);
            break;
          }
        }
      }
      return points;
    };
    const points = [...run(-1).reverse(), ...run(1).slice(1)];
    // Retain enough samples for rounded spans while avoiding huge SVG paths.
    return points.filter((_, i) => i === 0 || i === points.length - 1 || i % 4 === 0);
  };
  const bindings: PatternBinding[] = [];
  const add = (
    name: string,
    role: PatternRole,
    guideId: string,
    seed: PatternLine | undefined,
    evidence: PatternBinding['evidence'] = 'surface-mark',
    stopAtSurface = true
  ) => {
    const measurement = measurements.find(m => m.name === name);
    if (!measurement || !seed) return;
    const points = trace(seed, stopAtSurface);
    if (points.length < 2) return;
    bindings.push({ measurement, role, guideId, points, evidence });
  };

  if (frame) {
    add(
      'Front panel width',
      'width',
      'mW1cm',
      pick(line => shallow(line) && interior(line) > 0.65)
    );
    add(
      'Front panel height',
      'height',
      'mD1cm',
      pick(line => Math.abs(slope(line)) > 5 && interior(line) > 0.65)
    );
    add(
      'Side width',
      'side-width',
      'mTcm',
      pick(line => slope(line) * handedness < -1.5 && interior(line) < 0.6),
      'boundary-mark',
      false
    );
    const frontWidth = bindings.find(b => b.role === 'width');
    const frontHeight = bindings.find(b => b.role === 'height');
    if (frontWidth && frontHeight) {
      // Front-panel height starts below the padded roll, at the width seam.
      const crossing = frontHeight.points.reduce(
        (best, point, i) => {
          const distance = Math.min(
            ...frontWidth.points.map(w =>
              Math.hypot((w.x - point.x) * width, (w.y - point.y) * height)
            )
          );
          return distance < best.distance ? { i, distance } : best;
        },
        { i: 0, distance: Infinity }
      );
      if (crossing.distance < 8) frontHeight.points = frontHeight.points.slice(crossing.i);
    }
  } else if (knife) {
    add(
      'Width (Top)',
      'top-width',
      'mAcm',
      pick(line => shallow(line) && slope(line) * handedness < -0.04),
      'boundary-mark',
      false
    );
    add('Width (Bottom)', 'bottom-width', 'mBcm', transverse);
    add(
      'Height',
      'height',
      'mC1cm',
      pick(line => slope(line) * handedness < -0.8 && interior(line, true) > 0.6)
    );
    const h = bindings.find(binding => binding.role === 'height');
    const measurement = measurements.find(m => m.name === 'Thickness (Bottom)');
    if (h && measurement) {
      // Half-knife C ends where the face bends. D follows its short continuation
      // over the bottom face. Locate the change of direction, not a fixed pixel span.
      const ordered = [...h.points].sort((a, b) => a.y - b.y);
      const bottom = bindings.find(binding => binding.role === 'bottom-width');
      const bottomY = bottom
        ? bottom.points.reduce((sum, p) => sum + p.y, 0) / bottom.points.length
        : 1;
      const bend = ordered.findIndex(
        (p, i) => i > 2 && p.y > bottomY && (p.x - ordered[i - 1].x) * handedness >= 0
      );
      if (bend > 0) {
        const end = ordered[bend - 1];
        h.points = ordered.slice(0, bend);
        const tail = [end];
        let previousX = end.x * width;
        for (
          let y = Math.round(end.y * height) + 1;
          y < Math.min(height, end.y * height + height * 0.08);
          y++
        ) {
          let best = previousX;
          let cost = Infinity;
          for (let d = 0; d <= 3; d++) {
            const x = previousX + d * handedness;
            if (darkness(x, y) < 125 && d + darkness(x, y) / 150 < cost) {
              best = x;
              cost = d + darkness(x, y) / 150;
            }
          }
          if (!Number.isFinite(cost)) break;
          previousX = best;
          tail.push({ x: best / width, y: y / height });
        }
        if (tail.length >= 3)
          bindings.push({
            measurement,
            role: 'thickness',
            guideId: 'mDcm',
            points: tail,
            evidence: 'surface-transition',
          });
      }
    }
  } else {
    add(
      'Width',
      'width',
      'mW1cm',
      pick(line => shallow(line) && interior(line, true) > 0.65)
    );
    add(
      'Height',
      'height',
      'mD1cm',
      pick(line => slope(line) * handedness < -0.8 && interior(line, true) > 0.65)
    );
    add(
      'Thickness',
      'thickness',
      'mTcm',
      pick(line => slope(line) * handedness > 0.8 && interior(line) > 0.6)
    );
  }
  return {
    bindings,
    unresolved: measurements
      .filter(m => !bindings.some(binding => binding.measurement.id === m.id))
      .map(m => m.name),
    guide,
  };
}
