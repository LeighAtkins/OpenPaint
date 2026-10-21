/**
 * Handwriting out of a scanned value box: binarise the crop against its local
 * background, find the printed box border by its long run of ink and cut it
 * away, drop leftover line fragments and specks, then frame what is left
 * (the handwriting) on white for the recogniser. Pure typed-array code shared
 * by the OCR worker and Node tests.
 */
import type { NormRect } from './pair-letters';
import { resample, type GrayImage } from './scan-image';

/** Share of the box size added around a box before cleaning, so its border is inside the crop. */
export const CELL_PAD = 0.12;

/** A rect of the page (normalised) grown by `pad` of its size on every side, as pixels. */
export function cropCell(img: GrayImage, rect: NormRect, pad = CELL_PAD): GrayImage {
  const x0 = Math.max(0, Math.floor((rect.x - pad * rect.w) * img.width));
  const y0 = Math.max(0, Math.floor((rect.y - pad * rect.h) * img.height));
  const x1 = Math.min(img.width, Math.floor((rect.x + rect.w * (1 + pad)) * img.width));
  const y1 = Math.min(img.height, Math.floor((rect.y + rect.h * (1 + pad)) * img.height));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = (y0 + y) * img.width + x0;
    data.set(img.data.subarray(row, row + width), y * width);
  }
  return { width, height, data };
}

function percentile(data: Uint8Array, share: number): number {
  const counts = new Uint32Array(256);
  for (const v of data) counts[v] += 1;
  const target = Math.floor(data.length * share);
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += counts[v];
    if (seen > target) return v;
  }
  return 255;
}

/**
 * Ink mask (1 = ink): darker than the mean of its neighbourhood by `offset`
 * and clearly darker than the paper.
 */
export function binarize(img: GrayImage, block = 31, offset = 12): Uint8Array {
  const { width: w, height: h, data } = img;
  const paper = percentile(data, 0.9);
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const r = block >> 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(w, x + r + 1);
      const sum =
        integral[yb * (w + 1) + xb] -
        integral[ya * (w + 1) + xb] -
        integral[yb * (w + 1) + xa] +
        integral[ya * (w + 1) + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      const v = data[y * w + x];
      out[y * w + x] = v < mean - offset && v <= paper * 0.85 ? 1 : 0;
    }
  }
  return out;
}

export interface Component {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

/** 8-connected components of a mask: a label per pixel (0 = background) and each one's box. */
export function components(
  mask: Uint8Array,
  width: number,
  height: number
): { labels: Int32Array; parts: Component[] } {
  const labels = new Int32Array(width * height);
  const parts: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    const id = parts.length + 1;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let area = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % width;
      const py = (p - px) / width;
      area += 1;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = py + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = px + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = id;
            stack.push(q);
          }
        }
      }
    }
    parts.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return { labels, parts };
}

/**
 * Where the printed border runs: the column (row) with the most ink near each
 * side, when that ink covers a good share of the box. Null when no border is
 * seen on that side.
 */
export function findBorders(
  ink: Uint8Array,
  width: number,
  height: number,
  pad = CELL_PAD
): { left: number | null; right: number | null; top: number | null; bottom: number | null } {
  const cols = new Uint32Array(width);
  const rows = new Uint32Array(height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (ink[y * width + x]) {
        cols[x] += 1;
        rows[y] += 1;
      }
  // The border sits about `pad / (1 + 2 pad)` in from each edge of the crop.
  const edge = pad / (1 + 2 * pad);
  const strongest = (
    profile: Uint32Array,
    lo: number,
    hi: number,
    length: number,
    share: number
  ) => {
    let best = -1;
    for (let i = Math.max(0, lo); i < Math.min(profile.length, hi); i += 1)
      if (best < 0 || profile[i] > profile[best]) best = i;
    return best >= 0 && profile[best] >= share * length ? best : null;
  };
  return {
    left: strongest(cols, 0, Math.floor(width * (edge + 0.05)), height, 0.35),
    right: strongest(cols, Math.floor(width * (1 - edge - 0.05)), width, height, 0.35),
    top: strongest(rows, 0, Math.floor(height * (edge + 0.08)), width, 0.3),
    bottom: strongest(rows, Math.floor(height * (1 - edge - 0.08)), height, width, 0.3),
  };
}

export interface CleanCell {
  /** 1 where handwriting is, same size as the crop. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Box of the handwriting in the crop, or null when the box holds none. */
  bounds: Component | null;
}

/** The handwriting of a value box crop (made with cropCell), border and specks removed. */
export function cleanCell(crop: GrayImage, pad = CELL_PAD): CleanCell {
  const { width: W, height: H } = crop;
  const ink = binarize(crop);
  const b = findBorders(ink, W, H, pad);
  const gap = Math.max(2, Math.floor(H * 0.04));
  const x0 = b.left !== null ? b.left + gap : 0;
  const x1 = b.right !== null ? b.right - gap + 1 : W;
  const y0 = b.top !== null ? b.top + gap : 0;
  const y1 = b.bottom !== null ? b.bottom - gap + 1 : H;
  const inside = new Uint8Array(W * H);
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y += 1)
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) inside[y * W + x] = ink[y * W + x];
  const { labels, parts } = components(inside, W, H);
  const innerH = y1 - y0;
  const innerW = x1 - x0;
  const keep = new Uint8Array(parts.length + 1);
  for (let i = 0; i < parts.length; i += 1) {
    const { x, w, h, area } = parts[i];
    if (area < Math.max(6, innerH * innerH * 0.003)) continue; // specks
    if (h <= Math.max(3, innerH * 0.08) && w > h * 2.5) continue; // left of a border line
    const thin = w <= Math.max(3, innerH * 0.08);
    const atSide = x < x0 + innerW * 0.06 || x + w > x1 - innerW * 0.06;
    const onEdge = x < x0 + 3 || x + w > x1 - 3;
    if (thin && atSide && (h < innerH * 0.5 || onEdge)) continue; // piece of a side border
    keep[i + 1] = 1;
  }
  const mask = new Uint8Array(W * H);
  let bx0 = W;
  let by0 = H;
  let bx1 = -1;
  let by1 = -1;
  let area = 0;
  for (let p = 0; p < mask.length; p += 1)
    if (keep[labels[p]]) {
      mask[p] = 1;
      area += 1;
      const x = p % W;
      const y = (p - x) / W;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  const bounds = bx1 < 0 ? null : { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1, area };
  return { mask, width: W, height: H, bounds };
}

/**
 * The handwriting framed on white with a margin of `margin` times its height.
 * 'ink' draws it pure black; 'grey' keeps the scan's grey levels (contrast
 * stretched) on and right around the strokes.
 */
export function frameInk(
  crop: GrayImage,
  cell: CleanCell,
  margin: number,
  style: 'ink' | 'grey'
): GrayImage | null {
  const b = cell.bounds;
  if (!b) return null;
  const { width: W, height: H } = cell;
  let keep = cell.mask;
  let lo = 0;
  let span = 255;
  if (style === 'grey') {
    keep = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1)
      for (let x = 0; x < W; x += 1) {
        if (!cell.mask[y * W + x]) continue;
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H) keep[ny * W + nx] = 1;
          }
      }
    const strokes: number[] = [];
    for (let p = 0; p < cell.mask.length; p += 1) if (cell.mask[p]) strokes.push(crop.data[p]);
    strokes.sort((a, c) => a - c);
    lo = strokes[Math.floor(strokes.length * 0.1)] ?? 0;
    const hi = percentile(crop.data, 0.9);
    span = Math.max(1, hi - lo);
  }
  const m = Math.floor(b.h * margin) + 2;
  const width = b.w + 2 * m;
  const height = b.h + 2 * m;
  const data = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < b.h; y += 1)
    for (let x = 0; x < b.w; x += 1) {
      const p = (b.y + y) * W + b.x + x;
      if (!keep[p]) continue;
      const v =
        style === 'ink' ? 0 : Math.max(0, Math.min(255, ((crop.data[p] - lo) / span) * 255));
      data[(y + m) * width + x + m] = Math.round(v);
    }
  return { width, height, data };
}

/** A grey image scaled to `height` px tall (width kept in proportion, at least `minWidth`). */
export function scaleToHeight(img: GrayImage, height: number, minWidth = 16): GrayImage {
  const width = Math.max(minWidth, Math.round((img.width * height) / img.height));
  return resample(img, 0, 0, img.width, img.height, width, height);
}
