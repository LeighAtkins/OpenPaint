export interface StrokePoint {
  x: number;
  y: number;
}
/** Split by travelled length, independent of drawing direction or orientation. */
export function splitStrokePoints(
  points: StrokePoint[],
  ratio: number
): [StrokePoint[], StrokePoint[]] {
  if (points.length < 2) return [points.slice(), points.slice()];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const distance = lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, ratio));
  let travelled = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (travelled + lengths[i] >= distance || i === lengths.length - 1) {
      const t = lengths[i] ? (distance - travelled) / lengths[i] : 0;
      const p = {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
      return [
        [...points.slice(0, i + 1), p],
        [p, ...points.slice(i + 1)],
      ];
    }
    travelled += lengths[i];
  }
  return [points.slice(), []];
}

/** Start at the left edge and travel across the back/top half first. */
export function ellipseStrokePoints(rx: number, ry: number, steps = 160): StrokePoint[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = Math.PI + (i / steps) * Math.PI * 2;
    return { x: rx * Math.cos(angle), y: ry * Math.sin(angle) };
  });
}
