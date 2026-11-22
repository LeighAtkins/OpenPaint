/**
 * Place measurement lines on CW pattern-simulation diagrams.
 *
 * The diagrams are renders on a flat blue background, so the cover silhouette is
 * easy to separate. A box-shaped cushion seen from the front-left and above has a
 * hexagonal outline; its corners give the width, depth (CW "Height") and thickness
 * edges directly. Pure geometry: no DOM, runs in the browser, Node or a Worker.
 */

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}
export interface Point {
  x: number;
  y: number;
}
export interface DiagramLine {
  measurement: string;
  from: Point;
  to: Point;
  /** The black line traced pixel by pixel from `from` to `to`, curves included. */
  path?: Point[];
  /** Share of the traced length that lies on the black line. */
  coverage?: number;
}
export interface DiagramLines {
  kind: 'box';
  /** Camera view the fit assumed. */
  view: 'front-left' | 'front-right' | 'face-on';
  lines: DiagramLine[];
  corners: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G', Point>;
  /** 0..1: how closely the outline closes into a box (parallelogram faces). */
  confidence: number;
}

/** Background is the saturated blue; everything else (cover, cream, outlines) is foreground. */
export function isBackground(r: number, g: number, b: number): boolean {
  return b > 90 && b > r + 40 && b > g + 20 && r < 120;
}

/** Outline pixels: for each row, the left- and right-most foreground pixel. */
export function silhouettePoints(img: Pixels): Point[] {
  const points: Point[] = [];
  const { width, height, data } = img;
  for (let y = 0; y < height; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (isBackground(data[i], data[i + 1], data[i + 2])) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left >= 0) points.push({ x: left, y }, { x: right, y });
  }
  return points;
}

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull, clockwise on screen (y down), starting from the left-most point. */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  // Normalise the walk: start at the left-most point and go up and round to the right.
  const ring = lower.slice(0, -1).concat(upper.slice(0, -1));
  const start = ring.reduce((best, p, i) => (p.x < ring[best].x ? i : best), 0);
  const hull = ring.slice(start).concat(ring.slice(0, start));
  // With y pointing down, a visually clockwise ring has a positive shoelace sum.
  let area = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    area += p.x * q.y - q.x * p.y;
  }
  if (area < 0) hull.splice(1, hull.length - 1, ...hull.slice(1).reverse());
  return hull;
}

const triangleArea = (a: Point, b: Point, c: Point) => Math.abs(cross(a, b, c)) / 2;

/** Reduce a closed polygon to n vertices by repeatedly dropping the least significant one. */
export function simplifyPolygon(polygon: Point[], n: number): Point[] {
  const poly = [...polygon];
  while (poly.length > n) {
    let weakest = 0;
    let weakestArea = Infinity;
    for (let i = 0; i < poly.length; i += 1) {
      const area = triangleArea(
        poly[(i - 1 + poly.length) % poly.length],
        poly[i],
        poly[(i + 1) % poly.length]
      );
      if (area < weakestArea) {
        weakestArea = area;
        weakest = i;
      }
    }
    poly.splice(weakest, 1);
  }
  return poly;
}

/** Corner where the lines through a1-a2 and b1-b2 meet. */
export function intersect(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

/**
 * Rounded corners make the 6 hull vertices sit on the bevels. Re-derive each corner
 * as the intersection of its two neighbouring straight sides, measured from the
 * middle part of each side, which the rounding does not reach.
 */
function sharpenCorners(hull: Point[], hex: Point[]): Point[] {
  const index = hex.map(v => hull.findIndex(p => p.x === v.x && p.y === v.y));
  const sides = hex.map((_, k) => {
    const i0 = index[k];
    const i1 = index[(k + 1) % hex.length];
    const span = (i1 - i0 + hull.length) % hull.length;
    const pts = Array.from({ length: span + 1 }, (_, j) => hull[(i0 + j) % hull.length]);
    // The middle half of the side, as a straight segment.
    const lo = pts[Math.floor(pts.length * 0.25)] || pts[0];
    const hi = pts[Math.floor(pts.length * 0.75)] || pts[pts.length - 1];
    return lo.x === hi.x && lo.y === hi.y ? [pts[0], pts[pts.length - 1]] : [lo, hi];
  });
  return hex.map((v, k) => {
    const prev = sides[(k - 1 + hex.length) % hex.length];
    const next = sides[k];
    const p = intersect(prev[0], prev[1], next[0], next[1]);
    // Keep the original vertex when the sharpened corner runs away (near-parallel sides).
    return p && Math.hypot(p.x - v.x, p.y - v.y) < 60 ? p : v;
  });
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const len = (a: Point) => Math.hypot(a.x, a.y);

/**
 * Box cushion seen from the front-left and above. Hull corners clockwise from the
 * left-most: A front-left-top, B back-left-top, C back-right-top, D back-right-bottom,
 * E front-right-bottom, F front-left-bottom. The hidden front-right-top corner G
 * completes the front face: G = A + (E - F).
 */
/**
 * Outline or seam pixel. Thin outlines are anti-aliased into a dark orange, but even
 * the most shaded cover keeps a strong red channel, so red alone separates them.
 */
function isInk(r: number, g: number, b: number): boolean {
  return r < 150 && !isBackground(r, g, b) && b < 120;
}

/**
 * Share of points along a segment that sit on a drawn edge: an outline/seam pixel or
 * the silhouette boundary within a few pixels. Works under strong perspective, where
 * faces are no longer parallelograms.
 */
export function edgeSupport(img: Pixels, from: Point, to: Point, radius = 4): number {
  const { width, height, data } = img;
  const samples = 40;
  let hits = 0;
  let counted = 0;
  for (let k = 0; k <= samples; k += 1) {
    const t = 0.08 + (0.84 * k) / samples;
    const cx = Math.round(from.x + (to.x - from.x) * t);
    const cy = Math.round(from.y + (to.y - from.y) * t);
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    counted += 1;
    let hit = false;
    for (let dy = -radius; dy <= radius && !hit; dy += 1) {
      for (let dx = -radius; dx <= radius && !hit; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        if (
          isInk(data[i], data[i + 1], data[i + 2]) ||
          isBackground(data[i], data[i + 1], data[i + 2])
        )
          hit = true;
      }
    }
    if (hit) hits += 1;
  }
  return counted ? hits / counted : 0;
}

/** Share of points along a segment lying on outline/seam pixels (within `radius` px). */
function inkSupport(img: Pixels, from: Point, to: Point, radius = 1): number {
  const { width, height, data } = img;
  let hits = 0;
  let counted = 0;
  for (let k = 0; k <= 30; k += 1) {
    const t = 0.1 + (0.8 * k) / 30;
    const cx = Math.round(from.x + (to.x - from.x) * t);
    const cy = Math.round(from.y + (to.y - from.y) * t);
    if (cx < 1 || cy < 1 || cx >= width - 1 || cy >= height - 1) continue;
    counted += 1;
    let hit = false;
    for (let dy = -radius; dy <= radius && !hit; dy += 1)
      for (let dx = -radius; dx <= radius && !hit; dx += 1) {
        const y = cy + dy;
        const x = cx + dx;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        if (isInk(data[i], data[i + 1], data[i + 2])) hit = true;
      }
    if (hit) hits += 1;
  }
  return counted ? hits / counted : 0;
}

/**
 * Move each end of a segment along its normal (independently, so the line can also
 * tilt) to the position that best follows a drawn edge.
 */
export function snapSegment(img: Pixels, from: Point, to: Point, reach: number): [Point, Point] {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const n = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  const step = Math.max(1, Math.round(reach / 25));
  let best: [Point, Point] = [from, to];
  let bestScore = inkSupport(img, from, to);
  // Ends may move independently so the line can tilt, but only a little: a short
  // line must not swing round onto a neighbouring seam.
  const maxTilt = length * Math.tan((12 * Math.PI) / 180);
  for (let a = -reach; a <= reach; a += step) {
    for (let b = -reach; b <= reach; b += step) {
      if (Math.abs(a - b) > maxTilt) continue;
      const f = { x: from.x + n.x * a, y: from.y + n.y * a };
      const t = { x: to.x + n.x * b, y: to.y + n.y * b };
      const score = inkSupport(img, f, t);
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = [f, t];
      }
    }
  }
  return centreOnInk(img, best[0], best[1], n, step * 2);
}

/**
 * The coarse snap lands anywhere on a stroke that is several pixels wide. Slide each
 * end across the stroke, find the band where the line still lies on ink, and move the
 * end to the middle of that band so the line runs down the centre of the black line.
 */
function centreOnInk(img: Pixels, from: Point, to: Point, n: Point, reach: number): [Point, Point] {
  let f = from;
  let t = to;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const end of ['from', 'to'] as const) {
      const at = (o: number): [Point, Point] =>
        end === 'from'
          ? [{ x: f.x + n.x * o, y: f.y + n.y * o }, t]
          : [f, { x: t.x + n.x * o, y: t.y + n.y * o }];
      const peak = inkSupport(img, ...at(0), 0);
      if (peak <= 0) continue;
      const keep = (o: number) => inkSupport(img, ...at(o), 0) >= peak * 0.85;
      let lo = 0;
      let hi = 0;
      while (lo > -reach && keep(lo - 1)) lo -= 1;
      while (hi < reach && keep(hi + 1)) hi += 1;
      [f, t] = at((lo + hi) / 2);
    }
  }
  return [f, t];
}

/** Snap the three box lines, then rebuild shared corners where snapped lines cross. */
function snapBox(img: Pixels, fit: DiagramLines): DiagramLines {
  const reach = Math.round(Math.max(img.width, img.height) * 0.03);
  const [w, d, t] = fit.lines;
  const [w0, w1] = snapSegment(img, w.from, w.to, reach);
  const [d0, d1] = snapSegment(img, d.from, d.to, reach);
  // Thickness can be shown on any vertical corner of the box. Rounded front-left
  // corners have no straight line to follow, so use whichever corner has the
  // clearest straight black line.
  const c = fit.corners;
  const tilt = (p: Point, q: Point) => Math.atan2(q.y - p.y, q.x - p.x);
  const thicknessOptions: Array<[Point, Point]> = [
    [t.from, t.to],
    [c.E, c.G],
    [c.D, c.C],
  ].filter(
    ([p, q]) =>
      Math.hypot(q.x - p.x, q.y - p.y) > 4 &&
      Math.abs(tilt(p, q) - tilt(t.from, t.to)) < (35 * Math.PI) / 180
  ) as Array<[Point, Point]>;
  const [t0, t1] = thicknessOptions
    .map(([p, q]) => snapSegment(img, p, q, reach))
    .reduce((best, seg) =>
      inkSupport(img, seg[0], seg[1], 0) > inkSupport(img, best[0], best[1], 0) ? seg : best
    );
  // Width and depth meet at their shared corner; width and thickness at theirs.
  const sharedWD = w.to === d.from || (w.to.x === d.from.x && w.to.y === d.from.y);
  const wd = sharedWD ? intersect(w0, w1, d0, d1) : null;
  const sharedWT =
    w.from.x === t.to.x &&
    w.from.y === t.to.y &&
    Math.hypot(t1.x - t.to.x, t1.y - t.to.y) < reach * 2;
  const wt = sharedWT ? intersect(w0, w1, t0, t1) : null;
  const near = (p: Point | null, q: Point) =>
    p && Math.hypot(p.x - q.x, p.y - q.y) < reach * 2 ? p : q;
  const W0 = near(wt, w0);
  const W1 = near(wd, w1);
  return {
    ...fit,
    lines: [
      { ...w, from: W0, to: W1 },
      { ...d, from: sharedWD ? W1 : d0, to: d1 },
      { ...t, from: t0, to: sharedWT ? W0 : t1 },
    ],
  };
}

const inkAt = (img: Pixels, x: number, y: number): boolean => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return false;
  const i = (yi * img.width + xi) * 4;
  return isInk(img.data[i], img.data[i + 1], img.data[i + 2]);
};

function luminance(img: Pixels, x: number, y: number): number {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const i = (yi * img.width + xi) * 4;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
}

/**
 * Follow the black line from one corner to the other. At each step across the
 * line, find the run of ink pixels nearest the expected position and take its
 * centre; the expected position follows the previous centre, so gentle curves are
 * tracked. Returns the centre-line and the share of steps that found ink.
 */
export function traceInk(
  img: Pixels,
  from: Point,
  to: Point,
  window = 6
): { path: Point[]; coverage: number } {
  const total = Math.hypot(to.x - from.x, to.y - from.y);
  if (total < 2) return { path: [from, to], coverage: 0 };
  const stepLength = 2;
  const unit = (v: Point) => {
    const l = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / l, y: v.y / l };
  };
  let pos = from;
  let dir = unit(sub(to, from));
  const path: Point[] = [from];
  let found = 0;
  let steps = 0;
  const maxSteps = Math.ceil((total * 1.5) / stepLength);
  while (steps < maxSteps && Math.hypot(to.x - pos.x, to.y - pos.y) > stepLength * 1.5) {
    steps += 1;
    const guess = { x: pos.x + dir.x * stepLength, y: pos.y + dir.y * stepLength };
    const n = { x: -dir.y, y: dir.x };
    const lumAt = (o: number) => luminance(img, guess.x + n.x * o, guess.y + n.y * o);
    // Ink, or a faint anti-aliased line: clearly darker than the cover either side.
    const at = (o: number) =>
      inkAt(img, guess.x + n.x * o, guess.y + n.y * o) ||
      lumAt(o) < Math.min(lumAt(o - 3), lumAt(o + 3)) - 14;
    let hit: number | null = null;
    for (let d = 0; d <= window && hit === null; d += 0.5) {
      if (at(-d)) hit = -d;
      else if (at(d)) hit = d;
    }
    let next = guess;
    if (hit !== null) {
      let lo = hit;
      let hi = hit;
      while (lo > hit - 12 && at(lo - 0.5)) lo -= 0.5;
      while (hi < hit + 12 && at(hi + 0.5)) hi += 0.5;
      const centre = (lo + hi) / 2;
      next = { x: guess.x + n.x * centre, y: guess.y + n.y * centre };
      found += 1;
    }
    // Follow the line's own direction, gently pulled toward the end corner.
    const heading = unit(sub(next, pos));
    const toward = unit(sub(to, next));
    dir = unit({ x: heading.x * 0.75 + toward.x * 0.25, y: heading.y * 0.75 + toward.y * 0.25 });
    pos = next;
    path.push(pos);
  }
  path.push(to);
  return { path: simplifyPath(path, 0.6), coverage: steps ? found / steps : 0 };
}

/** Drop points that add nothing to the shape (Ramer-Douglas-Peucker). */
function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  const len0 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const dist = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len0;
    if (dist > worst) {
      worst = dist;
      index = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  return simplifyPath(points.slice(0, index + 1), tolerance)
    .slice(0, -1)
    .concat(simplifyPath(points.slice(index), tolerance));
}

interface Names {
  width: string;
  depth: string;
  thickness: string;
}
const flipPoint =
  (img: Pixels) =>
  (p: Point): Point => ({ x: img.width - 1 - p.x, y: p.y });

/**
 * Lines for a box-shaped cushion. Tries the box seen from the front-left, the same
 * box mirrored (seen from the front-right), and an upright cushion seen face-on, and
 * keeps the fit whose lines best follow drawn edges.
 */
export function boxDiagramLines(img: Pixels, names: Names): DiagramLines | null {
  const points = silhouettePoints(img);
  if (points.length < 12) return null;
  const candidates: DiagramLines[] = [];
  const direct = fitBox(points, names);
  if (direct) candidates.push(direct);
  // Seen from the front-right: fit the mirror image, flip back. The long front edge is
  // then the one the mirrored fit called depth, so width and depth swap.
  const flip = flipPoint(img);
  const mirrored = fitBox(points.map(flip), {
    width: names.depth,
    depth: names.width,
    thickness: names.thickness,
  });
  if (mirrored) {
    const c = mirrored.corners;
    candidates.push({
      ...mirrored,
      view: 'front-right',
      corners: Object.fromEntries(
        Object.entries(c).map(([k, p]) => [k, flip(p)])
      ) as DiagramLines['corners'],
      lines: [
        ...mirrored.lines
          .filter(line => line.measurement !== names.thickness)
          .map(line => ({ ...line, from: flip(line.from), to: flip(line.to) })),
        // Thickness on the visible front corner rather than the back one.
        { measurement: names.thickness, from: flip(c.D), to: flip(c.C) },
      ],
    });
  }
  for (const [i, candidate] of candidates.entries()) {
    if (!candidate.confidence) continue;
    const snapped = snapBox(img, candidate);
    // Trace each line along its black line; confidence is the worst line's coverage.
    const lines = snapped.lines.map(line => {
      const { path, coverage } = traceInk(img, line.from, line.to);
      return { ...line, from: path[0], to: path[path.length - 1], path, coverage };
    });
    const support = Math.min(...lines.map(line => line.coverage));
    candidates[i] = { ...snapped, lines, confidence: Math.round(support * 100) / 100 };
  }
  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
  if (best && best.confidence >= 0.8) return best;
  const upright = fitUpright(points, names);
  return upright && (!best || upright.confidence > best.confidence) ? upright : best;
}

/**
 * Upright cushion seen face-on: the outline is close to a quadrilateral. Width runs
 * along the top of the face, height down its left side. Thickness is not placed, as
 * the side strip is too thin to measure reliably.
 */
function fitUpright(points: Point[], names: Names): DiagramLines | null {
  const hull = convexHull(points);
  if (hull.length < 4) return null;
  const quad = simplifyPolygon(hull, 4);
  const pick = (score: (p: Point) => number) =>
    quad.reduce((a, b) => (score(b) > score(a) ? b : a));
  const TL = pick(p => -p.x - p.y);
  const TR = pick(p => p.x - p.y);
  const BR = pick(p => p.x + p.y);
  const BL = pick(p => -p.x + p.y);
  if (new Set([TL, TR, BR, BL]).size < 4) return null;
  // Face-on means near-horizontal top and near-vertical sides.
  const topSlope = Math.abs(TR.y - TL.y) / Math.max(1, TR.x - TL.x);
  const sideSlope = Math.abs(BL.x - TL.x) / Math.max(1, BL.y - TL.y);
  const hullArea = polygonArea(hull);
  const quadFill = hullArea ? polygonArea([TL, TR, BR, BL]) / hullArea : 0;
  const confidence =
    topSlope < 0.25 && sideSlope < 0.35 ? Math.round(quadFill * 0.8 * 100) / 100 : 0;
  return {
    kind: 'box',
    view: 'face-on',
    corners: { A: TL, B: TR, C: BR, D: BL, E: BR, F: BL, G: TR },
    confidence,
    lines: [
      { measurement: names.width, from: TL, to: TR },
      { measurement: names.depth, from: TL, to: BL },
    ],
  };
}

function polygonArea(poly: Point[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

function fitBox(points: Point[], names: Names): DiagramLines | null {
  const hull = convexHull(points);
  if (hull.length < 6) return null;
  const [A, B, C, D, E, F] = sharpenCorners(hull, simplifyPolygon(hull, 6));
  const G = add(A, sub(E, F));
  const thickness = len(sub(A, F));
  const width = len(sub(G, A));
  const depth = len(sub(C, G));
  // Basic shape sanity; the edge check in boxDiagramLines sets the real confidence.
  const sane =
    thickness > 4 &&
    width > thickness &&
    depth > thickness &&
    F.y > A.y &&
    E.y > G.y - 1 &&
    C.y < G.y;
  return {
    kind: 'box',
    view: 'front-left',
    corners: { A, B, C, D, E, F, G },
    confidence: sane ? 1 : 0,
    lines: [
      { measurement: names.width, from: A, to: G },
      { measurement: names.depth, from: G, to: C },
      { measurement: names.thickness, from: F, to: A },
    ],
  };
}

/* ------------------------------------------------------------------------------
 * Seam-based placement. CW cushion diagrams draw the measured directions as thick
 * black seams: a cross on the top (width left-right, depth front-back) and a
 * vertical seam on the front (thickness). Measurement lines follow those seams
 * from edge to edge.
 * ---------------------------------------------------------------------------- */

export interface SeamLine {
  /** Points along the centre of the seam, edge to edge. */
  path: Point[];
  angle: number;
  length: number;
}

/** Thick seam pixels: dark, at least 3px wide, and away from the outline. */
export function seamMask(img: Pixels, outlineMargin?: number): Uint8Array {
  const { width, height, data } = img;
  const dark = new Uint8Array(width * height);
  const background = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (isBackground(r, g, b)) background[i] = 1;
    else if (r < 110 && 0.299 * r + 0.587 * g + 0.114 * b < 80) dark[i] = 1;
  }
  // Distance (in pixels, capped) to the nearest background pixel, to drop the outline.
  const near = new Uint8Array(width * height);
  const margin = outlineMargin ?? Math.max(6, Math.round(width / 150));
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (!background[y * width + x]) continue;
      for (let dy = -margin; dy <= margin; dy += 1)
        for (let dx = -margin; dx <= margin; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < width && yy < height) near[yy * width + xx] = 1;
        }
    }
  const seam = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1)
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      // Erosion: the pixel and its four neighbours are all dark, so the stroke is >= 3px.
      if (dark[i] && dark[i - 1] && dark[i + 1] && dark[i - width] && dark[i + width] && !near[i])
        seam[i] = 1;
    }
  return seam;
}

/** Cover brightness beside a seam point: median of non-ink pixels a few px either side. */
function sideBrightness(img: Pixels, p: Point, u: Point): number {
  const n = { x: -u.y, y: u.x };
  const values: number[] = [];
  for (const side of [-1, 1])
    for (let o = 5; o <= 10; o += 1) {
      const x = Math.round(p.x + n.x * o * side);
      const y = Math.round(p.y + n.y * o * side);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const i = (y * img.width + x) * 4;
      const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (isInk(r, g, b) || isBackground(r, g, b)) continue;
      values.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  values.sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : NaN;
}

/**
 * A seam crossing from the top face onto the front face is two measurements. The
 * faces are shaded differently, so cut the run where the brightness beside it steps,
 * and keep the longer part.
 */
function splitAtFaceEdge(
  img: Pixels,
  run: Array<{ r: Point; t: number }>,
  u: Point
): Array<{ r: Point; t: number }> {
  if (run.length < 20) return run;
  const t0 = run[0].t;
  const t1 = run[run.length - 1].t;
  const slice = 4;
  const centres: Array<{ t: number; lum: number }> = [];
  for (let t = t0; t <= t1; t += slice) {
    const inSlice = run.filter(m => m.t >= t && m.t < t + slice);
    if (!inSlice.length) continue;
    const c = {
      x: inSlice.reduce((s, m) => s + m.r.x, 0) / inSlice.length,
      y: inSlice.reduce((s, m) => s + m.r.y, 0) / inSlice.length,
    };
    const lum = sideBrightness(img, c, u);
    if (!Number.isNaN(lum)) centres.push({ t: t + slice / 2, lum });
  }
  const k = 4;
  let cut: number | null = null;
  let strongest = 18;
  for (let i = k; i < centres.length - k; i += 1) {
    const before = centres.slice(i - k, i).reduce((s, c) => s + c.lum, 0) / k;
    const after = centres.slice(i, i + k).reduce((s, c) => s + c.lum, 0) / k;
    if (Math.abs(after - before) > strongest) {
      strongest = Math.abs(after - before);
      cut = centres[i].t;
    }
  }
  if (cut === null) return run;
  const first = run.filter(m => m.t < cut!);
  const second = run.filter(m => m.t >= cut!);
  return first.length >= second.length ? first : second;
}

/** Follow a thick seam on from both ends of a path, allowing gentle curves. */
function growSeam(img: Pixels, mask: Uint8Array, path: Point[]): Point[] {
  const { width, height } = img;
  const onSeam = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < width && yi < height && mask[yi * width + xi] === 1;
  };
  const grow = (pts: Point[]): Point[] => {
    const out = [...pts];
    const k = Math.min(4, out.length - 1);
    let end = out[out.length - 1];
    const back = out[out.length - 1 - k];
    let l = Math.hypot(end.x - back.x, end.y - back.y) || 1;
    let dir = { x: (end.x - back.x) / l, y: (end.y - back.y) / l };
    const step = 3;
    let misses = 0;
    for (let i = 0; i < 2000 && misses < 3; i += 1) {
      const guess = { x: end.x + dir.x * step, y: end.y + dir.y * step };
      const n = { x: -dir.y, y: dir.x };
      const hits: number[] = [];
      for (let o = -4; o <= 4; o += 0.5)
        if (onSeam(guess.x + n.x * o, guess.y + n.y * o)) hits.push(o);
      if (!hits.length) {
        misses += 1;
        end = guess;
        continue;
      }
      misses = 0;
      const o = (hits[0] + hits[hits.length - 1]) / 2;
      const next = { x: guess.x + n.x * o, y: guess.y + n.y * o };
      l = Math.hypot(next.x - end.x, next.y - end.y) || 1;
      dir = {
        x: dir.x * 0.8 + ((next.x - end.x) / l) * 0.2,
        y: dir.y * 0.8 + ((next.y - end.y) / l) * 0.2,
      };
      const dl = Math.hypot(dir.x, dir.y) || 1;
      dir = { x: dir.x / dl, y: dir.y / dl };
      end = next;
      out.push(next);
    }
    return out;
  };
  const forward = grow(path);
  return grow([...forward].reverse()).reverse();
}

/**
 * Cut a seam where it passes from one face to another, detected by a step in the
 * cover brightness beside it. Keeps the longer part.
 */
function cutAtFaceEdge(img: Pixels, path: Point[], anchor?: Point): Point[] {
  if (path.length < 12) return path;
  const lums = path.map((p, i) => {
    const q = path[Math.min(path.length - 1, i + 1)];
    const r = path[Math.max(0, i - 1)];
    const l = Math.hypot(q.x - r.x, q.y - r.y) || 1;
    return sideBrightness(img, p, { x: (q.x - r.x) / l, y: (q.y - r.y) / l });
  });
  const k = 5;
  let cut = -1;
  let strongest = 18;
  for (let i = k; i < path.length - k; i += 1) {
    const before = lums.slice(i - k, i).filter(v => !Number.isNaN(v));
    const after = lums.slice(i, i + k).filter(v => !Number.isNaN(v));
    if (before.length < 3 || after.length < 3) continue;
    const diff = Math.abs(
      after.reduce((a, b) => a + b, 0) / after.length -
        before.reduce((a, b) => a + b, 0) / before.length
    );
    if (diff > strongest) {
      strongest = diff;
      cut = i;
    }
  }
  if (cut < 0) return path;
  const first = path.slice(0, cut);
  const second = path.slice(cut);
  // Keep the side that holds the seam originally found, when known.
  if (anchor) {
    const nearest = path.reduce(
      (best, p, i) =>
        Math.hypot(p.x - anchor!.x, p.y - anchor!.y) <
        Math.hypot(path[best].x - anchor!.x, path[best].y - anchor!.y)
          ? i
          : best,
      0
    );
    return nearest < cut ? first : second;
  }
  const len = (pts: Point[]) =>
    pts.length > 1
      ? Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y)
      : 0;
  return len(first) >= len(second) ? first : second;
}

/** Fit up to `max` long straight seams with RANSAC, strongest first. */
export function findSeams(
  img: Pixels,
  max = 4,
  minFraction = 0.08,
  outlineMargin?: number
): SeamLine[] {
  const mask = seamMask(img, outlineMargin);
  const { width, height } = img;
  let points: Point[] = [];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) if (mask[y * width + x]) points.push({ x, y });
  const minLength = Math.max(width, height) * minFraction;
  const tolerance = Math.max(3, width / 300);
  const seams: SeamLine[] = [];
  // Deterministic pseudo-random sampling so results are repeatable.
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const allPoints = points;
  for (let round = 0; round < max && points.length > 20; round += 1) {
    let best: { a: Point; u: Point; inliers: Point[] } | null = null;
    for (let trial = 0; trial < 400; trial += 1) {
      const p = points[Math.floor(rand() * points.length)];
      const q = points[Math.floor(rand() * points.length)];
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      if (l < minLength / 2) continue;
      const u = { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
      const inliers = points.filter(
        r => Math.abs((r.x - p.x) * -u.y + (r.y - p.y) * u.x) <= tolerance
      );
      if (!best || inliers.length > best.inliers.length) best = { a: p, u, inliers };
    }
    if (!best) break;
    // Keep the longest continuous run along the line. Gaps are judged against all
    // seam pixels, so a crossing seam found earlier does not cut this one.
    const fullInliers = allPoints.filter(
      r => Math.abs((r.x - best!.a.x) * -best!.u.y + (r.y - best!.a.y) * best!.u.x) <= tolerance
    );
    const along = fullInliers
      .map(r => ({ r, t: (r.x - best!.a.x) * best!.u.x + (r.y - best!.a.y) * best!.u.y }))
      .sort((m, n) => m.t - n.t);
    // Seams are continuous strokes; a gap means the seam was cut by a face edge.
    const gap = Math.max(3, width / 600);
    let runStart = 0;
    let bestRun: [number, number] = [0, 0];
    for (let i = 1; i <= along.length; i += 1) {
      if (i === along.length || along[i].t - along[i - 1].t > gap) {
        if (i - 1 - runStart > bestRun[1] - bestRun[0]) bestRun = [runStart, i - 1];
        runStart = i;
      }
    }
    let run = along.slice(bestRun[0], bestRun[1] + 1);
    run = splitAtFaceEdge(img, run, best.u);
    const length = run.length ? run[run.length - 1].t - run[0].t : 0;
    const used = new Set(run.map(m => m.r));
    const discard = () => {
      points = points.filter(r => !used.has(r));
    };
    // A seam must be mostly made of pixels not already claimed by an earlier seam.
    if (best.inliers.length < run.length * 0.5 || length < minLength) {
      discard();
      continue;
    }
    // Centre-line: average the seam pixels in short slices along the run.
    const path: Point[] = [];
    const slice = Math.max(4, length / 40);
    for (let t = run[0].t; t <= run[run.length - 1].t; t += slice) {
      const inSlice = run.filter(m => m.t >= t && m.t < t + slice);
      if (!inSlice.length) continue;
      path.push({
        x: inSlice.reduce((s, m) => s + m.r.x, 0) / inSlice.length,
        y: inSlice.reduce((s, m) => s + m.r.y, 0) / inSlice.length,
      });
    }
    if (path.length < 2) {
      discard();
      continue;
    }
    // Seams curve gently; follow the thick stroke beyond the straight fit, then cut
    // it where it passes onto another face.
    const grown = cutAtFaceEdge(img, growSeam(img, mask, path), path[Math.floor(path.length / 2)]);
    for (const q of grown)
      points = points.filter(
        r => Math.abs(r.x - q.x) > tolerance * 2 || Math.abs(r.y - q.y) > tolerance * 2
      );
    seams.push({
      path: extendToEdges(img, grown),
      angle: Math.atan2(best.u.y, best.u.x),
      length,
    });
  }
  return seams;
}

/**
 * Carry each end of a seam on along its direction to the edge of its face: stop at
 * the first edge line (any ink after leaving the seam) or at the background.
 */
function extendToEdges(img: Pixels, path: Point[]): Point[] {
  const out = [...path];
  // Seams normally run to the face edge already; only close a small gap.
  const reach = Math.max(img.width, img.height) * 0.012;
  const grow = (end: Point, prev: Point): Point => {
    const l = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
    const u = { x: (end.x - prev.x) / l, y: (end.y - prev.y) / l };
    let p = end;
    let leftSeam = false;
    const startLum = sideBrightness(img, end, u);
    for (let s = 1; s < reach; s += 1) {
      const q = { x: end.x + u.x * s, y: end.y + u.y * s };
      const xi = Math.round(q.x);
      const yi = Math.round(q.y);
      if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) break;
      const i = (yi * img.width + xi) * 4;
      const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (isBackground(r, g, b)) break;
      // Stop where the cover brightness changes: the seam has reached another face.
      const lum = sideBrightness(img, q, u);
      if (!Number.isNaN(startLum) && !Number.isNaN(lum) && Math.abs(lum - startLum) > 10) break;
      // Faint anti-aliased edge lines: clearly darker than the cover just before/after.
      const here = 0.299 * r + 0.587 * g + 0.114 * b;
      const lumAt = (o: number) => luminance(img, q.x + u.x * o, q.y + u.y * o);
      const ink = isInk(r, g, b) || here < 90 || here < Math.min(lumAt(-2), lumAt(2)) - 12;
      if (!ink) leftSeam = true;
      else if (leftSeam) {
        p = q;
        break;
      }
      p = q;
    }
    return p;
  };
  const k = Math.min(3, out.length - 1);
  out[0] = grow(out[0], out[k]);
  out[out.length - 1] = grow(out[out.length - 1], out[out.length - 1 - k]);
  return out;
}

/**
 * Follow the seam that carries a top seam over the edge of the top face and down a
 * side. Starts at `end` heading along `dir`, steps over the face-edge line, then
 * follows any black line (thin or thick) within a forward fan until it reaches the
 * cover's outline. Returns null unless it reaches the outline.
 */
function traceOverEdge(img: Pixels, end: Point, dir: Point): Point[] | null {
  const size = Math.max(img.width, img.height);
  const at = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return 'out';
    const i = (yi * img.width + xi) * 4;
    const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
    if (isBackground(r, g, b)) return 'bg';
    return isInk(r, g, b) || 0.299 * r + 0.587 * g + 0.114 * b < 95 ? 'ink' : 'cover';
  };
  const nearBackground = (p: Point) => {
    for (let dy = -3; dy <= 3; dy += 1)
      for (let dx = -3; dx <= 3; dx += 1) if (at(p.x + dx, p.y + dy) === 'bg') return true;
    return false;
  };
  // Find where the seam resumes past the edge line: first ink after some cover.
  let start: Point | null = null;
  let sawCover = false;
  for (let s = 2; s < size * 0.04; s += 1) {
    const q = { x: end.x + dir.x * s, y: end.y + dir.y * s };
    const v = at(q.x, q.y);
    if (v === 'bg' || v === 'out') return null;
    if (v === 'cover') sawCover = true;
    else if (sawCover) {
      // Search a little either side for the line centre.
      start = q;
      break;
    }
  }
  if (!start) {
    // The seam may continue without a gap: start just past the end.
    start = { x: end.x + dir.x * 3, y: end.y + dir.y * 3 };
    if (at(start.x, start.y) !== 'ink') return null;
  }
  const path: Point[] = [start];
  let pos = start;
  let heading = dir;
  for (let i = 0; i < size * 0.25; i += 1) {
    if (nearBackground(pos)) {
      // A depth seam runs down the side; edges and zippers run sideways.
      const dx = pos.x - start.x;
      const dy = pos.y - start.y;
      const l = Math.hypot(dx, dy);
      return l >= size * 0.015 && dy / (l || 1) >= 0.55 ? path : null;
    }
    // Look 3px ahead across a forward fan for ink, preferring straight on.
    let best: Point | null = null;
    let bestTurn = Infinity;
    for (let deg = -40; deg <= 40; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const h = {
        x: heading.x * Math.cos(a) - heading.y * Math.sin(a),
        y: heading.x * Math.sin(a) + heading.y * Math.cos(a),
      };
      const q = { x: pos.x + h.x * 3, y: pos.y + h.y * 3 };
      const v = at(q.x, q.y);
      if (v === 'bg') {
        best = q;
        bestTurn = Math.abs(deg);
        break;
      }
      if (v === 'ink' && Math.abs(deg) < bestTurn) {
        best = q;
        bestTurn = Math.abs(deg);
      }
    }
    if (!best) return null;
    const l = Math.hypot(best.x - pos.x, best.y - pos.y) || 1;
    heading = {
      x: heading.x * 0.6 + ((best.x - pos.x) / l) * 0.4,
      y: heading.y * 0.6 + ((best.y - pos.y) / l) * 0.4,
    };
    const hl = Math.hypot(heading.x, heading.y) || 1;
    heading = { x: heading.x / hl, y: heading.y / hl };
    pos = best;
    path.push(pos);
  }
  return null;
}

type Cell = 'out' | 'bg' | 'ink' | 'cover';
function cellAt(img: Pixels, x: number, y: number): Cell {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return 'out';
  const i = (yi * img.width + xi) * 4;
  const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
  if (isBackground(r, g, b)) return 'bg';
  return isInk(r, g, b) || 0.299 * r + 0.587 * g + 0.114 * b < 95 ? 'ink' : 'cover';
}
const rotate = (v: Point, deg: number): Point => {
  const a = (deg * Math.PI) / 180;
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
};
const nearBg = (img: Pixels, p: Point, r = 3) => {
  for (let dy = -r; dy <= r; dy += 1)
    for (let dx = -r; dx <= r; dx += 1) if (cellAt(img, p.x + dx, p.y + dy) === 'bg') return true;
  return false;
};

/** Follow a black line (thin or thick) from `start` along `heading` within a forward fan. */
function followLine(
  img: Pixels,
  start: Point,
  heading: Point,
  maxSteps: number,
  fan = 40
): { path: Point[]; reachedOutline: boolean } {
  const path: Point[] = [start];
  let pos = start;
  let h = heading;
  for (let i = 0; i < maxSteps; i += 1) {
    if (i > 2 && nearBg(img, pos)) return { path, reachedOutline: true };
    let best: Point | null = null;
    for (const deg of [
      0,
      ...Array.from({ length: fan / 5 }, (_, k) => [(k + 1) * 5, -(k + 1) * 5]).flat(),
    ]) {
      const q = { x: pos.x + rotate(h, deg).x * 2, y: pos.y + rotate(h, deg).y * 2 };
      if (cellAt(img, q.x, q.y) === 'ink') {
        best = q;
        break;
      }
    }
    if (!best) return { path, reachedOutline: nearBg(img, pos, 4) };
    const l = Math.hypot(best.x - pos.x, best.y - pos.y) || 1;
    h = {
      x: h.x * 0.7 + ((best.x - pos.x) / l) * 0.3,
      y: h.y * 0.7 + ((best.y - pos.y) / l) * 0.3,
    };
    const hl = Math.hypot(h.x, h.y) || 1;
    h = { x: h.x / hl, y: h.y / hl };
    pos = best;
    path.push(pos);
  }
  return { path, reachedOutline: false };
}

/**
 * Depth seam on a side face: from where a top seam meets the top face's edge line,
 * walk along that edge line and look for a line branching off outward (away from
 * the top face). The first branch that runs down to the outline is the depth seam.
 */
function branchOffEdge(img: Pixels, endPoint: Point, inward: Point): Point[] | null {
  const size = Math.max(img.width, img.height);
  // Step back toward the top face onto its edge line if the seam end overshot it.
  let end = endPoint;
  for (let s = 0; s <= Math.max(30, size * 0.02); s += 1) {
    const q = { x: endPoint.x + inward.x * s, y: endPoint.y + inward.y * s };
    if (cellAt(img, q.x, q.y) === 'ink') {
      end = q;
      break;
    }
  }
  // The edge line runs roughly across the top seam's direction; try both ways.
  const across = { x: -inward.y, y: inward.x };
  for (const along of [across, { x: -across.x, y: -across.y }]) {
    // Prefer walking toward the front/bottom of the image first.
    const edge = followLine(img, end, along, Math.round(size * 0.18), 25).path;
    for (let i = 3; i < edge.length; i += 1) {
      const p = edge[i];
      const q = edge[Math.max(0, i - 3)];
      const l = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const t = { x: (p.x - q.x) / l, y: (p.y - q.y) / l };
      // Outward normal: pointing away from the top face.
      let n = { x: -t.y, y: t.x };
      if (n.x * -inward.x + n.y * -inward.y < 0) n = { x: -n.x, y: -n.y };
      for (const deg of [0, 20, -20, 40, -40, 60, -60]) {
        const dirn = rotate(n, deg);
        const a = { x: p.x + dirn.x * 4, y: p.y + dirn.y * 4 };
        const b = { x: p.x + dirn.x * 7, y: p.y + dirn.y * 7 };
        if (cellAt(img, a.x, a.y) !== 'ink' || cellAt(img, b.x, b.y) !== 'ink') continue;
        const branch = followLine(img, b, dirn, Math.round(size * 0.15), 40);
        if (!branch.reachedOutline) continue;
        const last = branch.path[branch.path.length - 1];
        const length = Math.hypot(last.x - p.x, last.y - p.y);
        if (length < size * 0.012) continue;
        // Depth seams run down the side, not along it.
        if ((last.y - p.y) / (length || 1) < 0.2) continue;
        return [p, ...branch.path];
      }
    }
  }
  return null;
}

/** Zippers are drawn as two parallel lines; a single seam has none alongside it. */
function isDoubleLine(img: Pixels, path: Point[]): boolean {
  if (path.length < 3) return false;
  let doubled = 0;
  let checked = 0;
  for (let k = 1; k < 10; k += 1) {
    const i = Math.min(path.length - 2, Math.floor((path.length * k) / 10));
    const p = path[i];
    const q = path[i + 1];
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const n = { x: -(q.y - p.y) / l, y: (q.x - p.x) / l };
    checked += 1;
    for (const side of [-1, 1]) {
      let gap = false;
      for (let o = 2; o <= 10; o += 1) {
        const c = cellAt(img, p.x + n.x * o * side, p.y + n.y * o * side);
        if (c === 'cover') gap = true;
        else if (c === 'ink' && gap) {
          doubled += 1;
          break;
        } else if (c === 'bg') break;
      }
    }
  }
  return checked > 0 && doubled / checked > 0.6;
}

/** Drop leading and trailing points that are not on a black line. */
function trimToInk(img: Pixels, path: Point[]): Point[] {
  const onInk = (p: Point) => {
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1)
        if (cellAt(img, p.x + dx, p.y + dy) === 'ink') return true;
    return false;
  };
  let a = 0;
  let b = path.length - 1;
  while (a < b && !onInk(path[a])) a += 1;
  while (b > a && !onInk(path[b])) b -= 1;
  return path.slice(a, b + 1);
}

/** Insert points so consecutive points are at most `step` px apart. */
function densify(path: Point[], step: number): Point[] {
  const out: Point[] = [path[0]];
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k += 1)
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/**
 * Cushion diagram -> width, depth and thickness lines on the seams. The top cross
 * gives width (the more horizontal seam) and depth (the other); a separate, more
 * vertical seam below the cross gives thickness.
 */
export function seamDiagramLines(
  img: Pixels,
  names: { width: string; depth: string; thickness: string }
): { lines: DiagramLine[]; confidence: number } {
  const seams = findSeams(img, 4);
  const horizontalness = (s: SeamLine) => Math.abs(Math.cos(s.angle));
  const crossing = (a: SeamLine, b: SeamLine) => {
    const p = intersect(a.path[0], a.path[a.path.length - 1], b.path[0], b.path[b.path.length - 1]);
    if (!p) return null;
    const position = (s: SeamLine) => {
      const [m, n] = [s.path[0], s.path[s.path.length - 1]];
      return (
        ((p.x - m.x) * (n.x - m.x) + (p.y - m.y) * (n.y - m.y)) /
        ((n.x - m.x) ** 2 + (n.y - m.y) ** 2)
      );
    };
    const ta = position(a);
    const tb = position(b);
    if (ta < 0.15 || ta > 0.85 || tb < 0.15 || tb > 0.85) return null;
    // Nearer the middles, and between longer seams, is better.
    return Math.min(a.length, b.length) * (1 - Math.abs(ta - 0.5) - Math.abs(tb - 0.5));
  };
  // The top cross: the pair of seams that cross nearest both their middles.
  let cross: [SeamLine, SeamLine] | null = null;
  let crossScore = -Infinity;
  for (let i = 0; i < seams.length; i += 1)
    for (let j = i + 1; j < seams.length; j += 1) {
      const score = crossing(seams[i], seams[j]);
      if (score !== null && score > crossScore) {
        crossScore = score;
        cross = [seams[i], seams[j]];
      }
    }
  // The top cross covers the main face. A small cross on an end panel (bolsters,
  // pillows seen end-on) spans only a fraction of the cushion's outline.
  if (cross) {
    let foreground = 0;
    for (let i = 0; i < img.width * img.height; i += 1)
      if (!isBackground(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2])) foreground += 1;
    if (cross[0].length * cross[1].length < foreground * 0.2) cross = null;
  }
  const lines: DiagramLine[] = [];
  if (cross) {
    const [w, d] =
      horizontalness(cross[0]) >= horizontalness(cross[1]) ? cross : [cross[1], cross[0]];
    const asLine = (s: SeamLine, measurement: string): DiagramLine => ({
      measurement,
      from: s.path[0],
      to: s.path[s.path.length - 1],
      path: s.path,
    });
    lines.push(asLine(w, names.width), asLine(d, names.depth));
    // Thickness: the seam that carries a top seam on over the edge of the top face,
    // down the front face (continuing the depth seam) or a side face (continuing the
    // width seam). Prefer the front.
    const frontEnd =
      d.path[0].y > d.path[d.path.length - 1].y ? d.path[0] : d.path[d.path.length - 1];
    const centre =
      intersect(w.path[0], w.path[w.path.length - 1], d.path[0], d.path[d.path.length - 1]) ||
      frontEnd;
    const topEnds = [
      { p: frontEnd, front: true },
      { p: w.path[0], front: false },
      { p: w.path[w.path.length - 1], front: false },
    ];
    const reachLimit = Math.max(img.width, img.height) * 0.05;
    const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const onTop = (p: Point) => w.path.concat(d.path).some(q => dist(p, q) < 3);
    const straight = (s: SeamLine) => {
      const [a, b] = [s.path[0], s.path[s.path.length - 1]];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const worst = Math.max(
        ...s.path.map(p => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l)
      );
      // Front seams bow with the cushion, so allow a gentle curve.
      return worst <= Math.max(2.5, l * 0.15);
    };
    // Side seams on narrow end faces sit close to the outline: use a small margin.
    const short = findSeams(img, 14, 0.015, 3)
      // Not one of the top seams (touching one at its end is expected).
      .filter(s => s.path.filter(onTop).length < s.path.length * 0.3)
      // Zippers and outlines curve; depth seams are straight and fairly upright.
      .filter(s => straight(s) && horizontalness(s) < 0.8);
    // 1) Any upright seam on the front face, below the front edge of the top face.
    const frontFace = short
      .filter(s => horizontalness(s) < 0.4)
      .filter(
        s => Math.min(s.path[0].y, s.path[s.path.length - 1].y) > frontEnd.y - img.height * 0.15
      )
      .filter(
        s => Math.min(s.path[0].y, s.path[s.path.length - 1].y) > Math.min(...d.path.map(p => p.y))
      )
      .filter(s => s.length < img.height * 0.35)
      .sort((a, b) => dist(a.path[0], frontEnd) - dist(b.path[0], frontEnd))[0];
    const candidates = short
      .flatMap(s => {
        const ends = [s.path[0], s.path[s.path.length - 1]];
        // A thickness seam starts at the top face's edge and runs down the side.
        const [near, far] = ends[0].y <= ends[1].y ? ends : [ends[1], ends[0]];
        return topEnds.map(t => ({
          s,
          t,
          gap: dist(near, t.p),
          outward: dist(far, centre) > dist(near, centre),
          near,
          far,
        }));
      })
      .filter(c => c.gap < reachLimit && c.outward)
      .sort((a, b) => Number(b.t.front) - Number(a.t.front) || a.gap - b.gap);
    // 2) Otherwise the seam carrying a top seam on over the edge onto a side face.
    // A depth seam only crosses a side face: not a tick on the outline, and not a
    // long zipper or edge running along the side.
    const sizeRef = Math.max(img.width, img.height);
    const plausible = (path: Point[] | null | undefined, minimum = 0.03): path is Point[] => {
      if (!path || path.length < 2) return false;
      const a = path[0];
      const b = path[path.length - 1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      return l >= sizeRef * minimum && l <= sizeRef * 0.2 && !isDoubleLine(img, path);
    };
    const chosen = candidates.find(c => plausible(c.s.path));
    let front: Point[] | null = plausible(frontFace?.path)
      ? frontFace!.path
      : chosen
        ? chosen.s.path
        : null;
    // 3) Otherwise trace the (often thin) line that continues a top seam over the
    //    edge: the depth seam first, then either end of the width seam.
    if (!front) {
      const direction = (path: Point[], atEnd: boolean): Point => {
        const k = Math.min(6, path.length - 1);
        const [a, b] = atEnd
          ? [path[path.length - 1 - k], path[path.length - 1]]
          : [path[k], path[0]];
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
      };
      const dFrontAtEnd = d.path[d.path.length - 1] === frontEnd;
      const starts: Array<[Point, Point]> = [
        [frontEnd, direction(d.path, dFrontAtEnd)],
        [w.path[w.path.length - 1], direction(w.path, true)],
        [w.path[0], direction(w.path, false)],
      ];
      for (const [p, u] of starts) {
        const over = traceOverEdge(img, p, u);
        // A branch is proven to run from the face edge to the outline, so narrow end
        // faces (short seams) are accepted there.
        const branch = plausible(over) ? null : branchOffEdge(img, p, { x: -u.x, y: -u.y });
        const traced = plausible(over) ? over : plausible(branch, 0.012) ? branch : null;
        if (traced) {
          front = traced;
          break;
        }
      }
    }
    if (front) {
      // Seam pixels only: drop any extension that ran onto plain cover.
      const dense = densify(front, 2);
      const trimmed = trimToInk(img, dense);
      const kept = trimmed.length >= 2 ? trimmed : front;
      const top = kept[0].y < kept[kept.length - 1].y ? kept : [...kept].reverse();
      lines.push({
        measurement: names.thickness,
        from: top[0],
        to: top[top.length - 1],
        path: simplifyPath(top, 0.8),
      });
    }
  }
  const confidence = cross ? (lines.length === 3 ? 1 : 0.7) : 0;
  return { lines, confidence };
}
