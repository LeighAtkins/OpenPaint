/** Experimental detector for black lines inside orange CW pattern simulations.
 * Geometry only: detections do not establish measurement semantics or accuracy.
 */
export interface PatternLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  support: number;
}

export function detectCwPatternLines(
  rgb: Uint8Array,
  width: number,
  height: number,
  options: { allFaces?: boolean; minLength?: number; limit?: number } = {}
): PatternLine[] {
  if (width < 1 || height < 1 || rgb.length !== width * height * 3) return [];
  const orange = (x: number, y: number): boolean => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = (y * width + x) * 3;
    return rgb[i] > 240 && rgb[i + 1] > 110 && rgb[i + 1] < 185 && rgb[i + 2] < 135;
  };
  const points: Array<[number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) < 110) points.push([x, y]);
    }
  }
  const candidates: PatternLine[] = [];
  for (let angle = 0; angle < 180; angle++) {
    const theta = (angle * Math.PI) / 180;
    const nx = Math.cos(theta);
    const ny = Math.sin(theta);
    const bins = new Map<number, Array<[number, number]>>();
    for (const point of points) {
      const [x, y] = point;
      // Reject silhouette edges; require orange surface on both sides.
      if (!options.allFaces && (!orange(x + nx * 6, y + ny * 6) || !orange(x - nx * 6, y - ny * 6)))
        continue;
      const bin = Math.round((x * nx + y * ny) / 3);
      const entries = bins.get(bin) || [];
      entries.push(point);
      bins.set(bin, entries);
    }
    for (const entries of bins.values()) {
      if (entries.length < 30) continue;
      const sorted = entries.map(([x, y]) => -x * ny + y * nx).sort((a, b) => a - b);
      let start = 0;
      for (let end = 1; end <= sorted.length; end++) {
        if (end < sorted.length && sorted[end] - sorted[end - 1] < 28) continue;
        const lo = sorted[start];
        const hi = sorted[end - 1];
        const count = end - start;
        if (hi - lo > width * (options.minLength ?? 0.16) && count > 30) {
          const rho = entries.reduce((sum, [x, y]) => sum + x * nx + y * ny, 0) / entries.length;
          candidates.push({
            x1: (rho * nx - lo * ny) / width,
            y1: (rho * ny + lo * nx) / height,
            x2: (rho * nx - hi * ny) / width,
            y2: (rho * ny + hi * nx) / height,
            support: count,
          });
        }
        start = end;
      }
    }
  }
  const selected: PatternLine[] = [];
  for (const line of candidates.sort((a, b) => b.support - a.support)) {
    const duplicate = selected.some(other => {
      const distance = (reverse: boolean) =>
        Math.hypot(
          line.x1 - (reverse ? other.x2 : other.x1),
          line.y1 - (reverse ? other.y2 : other.y1)
        ) +
        Math.hypot(
          line.x2 - (reverse ? other.x1 : other.x2),
          line.y2 - (reverse ? other.y1 : other.y2)
        );
      return Math.min(distance(false), distance(true)) < (options.allFaces ? 0.08 : 0.2);
    });
    if (!duplicate) selected.push(line);
    if (selected.length === (options.limit ?? 8)) break;
  }
  return selected;
}
