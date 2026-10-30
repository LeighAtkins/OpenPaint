/**
 * Label placement for question cards: each label sits on its own line, at the
 * first spot along it that is clear of other labels and, where possible, of
 * other lines. Pure geometry so it can be tested without a canvas.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface LabelRect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export interface LabelRequest {
  a: Pt;
  b: Pt;
  /** Label size in pixels. */
  w: number;
  h: number;
  /** Optional manual nudge in pixels, applied after placement. */
  offset?: Pt;
}

// Positions along the line to try, centre first.
const ALONG = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78, 0.14, 0.86];

const rectsOverlap = (a: LabelRect, b: LabelRect) =>
  a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;

function segmentCrosses(a: Pt, b: Pt, r: LabelRect): boolean {
  for (let i = 0; i <= 24; i += 1) {
    const x = a.x + ((b.x - a.x) * i) / 24;
    const y = a.y + ((b.y - a.y) * i) / 24;
    if (x > r.x0 && x < r.x0 + r.w && y > r.y0 && y < r.y0 + r.h) return true;
  }
  return false;
}

/** Rects for every label, in the same order as `requests`. */
export function placeLabels(
  requests: LabelRequest[],
  bounds: { width: number; height: number }
): LabelRect[] {
  const clampRect = (cx: number, cy: number, w: number, h: number): LabelRect => ({
    x0: Math.max(2, Math.min(bounds.width - w - 2, cx - w / 2)),
    y0: Math.max(2, Math.min(bounds.height - h - 2, cy - h / 2)),
    w,
    h,
  });
  const placed: Array<LabelRect | null> = requests.map(() => null);
  // Short lines have the fewest good spots, so they choose first.
  const order = requests
    .map((req, index) => ({ index, len: Math.hypot(req.b.x - req.a.x, req.b.y - req.a.y) }))
    .sort((p, q) => p.len - q.len)
    .map(item => item.index);

  for (const index of order) {
    const req = requests[index];
    const taken = placed.filter(Boolean) as LabelRect[];
    const others = requests.filter((_, k) => k !== index);
    let best: { rect: LabelRect; score: number } | null = null;
    for (const t of ALONG) {
      const rect = clampRect(
        req.a.x + (req.b.x - req.a.x) * t,
        req.a.y + (req.b.y - req.a.y) * t,
        req.w,
        req.h
      );
      if (taken.some(r => rectsOverlap(r, rect))) continue;
      const score = others.filter(o => segmentCrosses(o.a, o.b, rect)).length;
      if (!best || score < best.score) best = { rect, score };
      if (score === 0) break;
    }
    if (!best) {
      // Every spot on the line is taken: step off the middle, at right angles,
      // by the label's own extent in that direction, then search further out.
      const len = Math.hypot(req.b.x - req.a.x, req.b.y - req.a.y) || 1;
      const nx = -(req.b.y - req.a.y) / len;
      const ny = (req.b.x - req.a.x) / len;
      const mx = (req.a.x + req.b.x) / 2;
      const my = (req.a.y + req.b.y) / 2;
      const across = Math.abs(nx) * req.w + Math.abs(ny) * req.h;
      const tries: Pt[] = [];
      for (let k = 1; k <= 8; k += 1) {
        for (const side of [1, -1]) {
          tries.push({
            x: mx + nx * across * 0.6 * k * side,
            y: my + ny * across * 0.6 * k * side,
          });
        }
      }
      for (let ring = 1; ring <= 10; ring += 1) {
        for (let step = 0; step < 12; step += 1) {
          const angle = (step / 12) * Math.PI * 2;
          tries.push({
            x: mx + Math.cos(angle) * req.w * 0.6 * ring,
            y: my + Math.sin(angle) * req.h * 1.2 * ring,
          });
        }
      }
      for (const at of tries) {
        const rect = clampRect(at.x, at.y, req.w, req.h);
        if (!taken.some(r => rectsOverlap(r, rect))) {
          best = { rect, score: 0 };
          break;
        }
      }
      best ||= { rect: clampRect(mx, my, req.w, req.h), score: 0 };
    }
    const { rect } = best;
    placed[index] = req.offset
      ? clampRect(
          rect.x0 + rect.w / 2 + req.offset.x,
          rect.y0 + rect.h / 2 + req.offset.y,
          rect.w,
          rect.h
        )
      : rect;
  }
  return placed as LabelRect[];
}
