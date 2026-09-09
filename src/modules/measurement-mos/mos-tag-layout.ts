export interface TagBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Deterministic initial placement. Explicit user positions never enter this solver. */
export function separateTag(box: TagBox, occupied: TagBox[], gap = 8): TagBox {
  const clear = (candidate: TagBox) =>
    occupied.every(
      other =>
        Math.abs(candidate.x - other.x) >= (candidate.width + other.width) / 2 + gap ||
        Math.abs(candidate.y - other.y) >= (candidate.height + other.height) / 2 + gap
    );
  if (clear(box)) return box;
  const step = Math.max(12, Math.min(box.width, box.height) / 2);
  for (let ring = 1; ring <= 40; ring++) {
    for (let i = 0; i < 16; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 8;
      const candidate = {
        ...box,
        x: box.x + Math.cos(angle) * step * ring,
        y: box.y + Math.sin(angle) * step * ring,
      };
      if (clear(candidate)) return candidate;
    }
  }
  return box;
}
export function readTagOffsets(value: unknown): Record<string, { x: number; y: number }> {
  const offsets: Record<string, { x: number; y: number }> = {};
  if (!value || typeof value !== 'object') return offsets;
  for (const [key, point] of Object.entries(value).slice(0, 500)) {
    if (
      /^[A-Z][A-Z0-9_-]*$/.test(key) &&
      point &&
      typeof point.x === 'number' &&
      typeof point.y === 'number' &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y)
    )
      offsets[key] = { x: point.x, y: point.y };
  }
  return offsets;
}
