/**
 * Grey-image helpers for reading scanned CW forms: crop a value box, scale it
 * up and stretch its contrast for OCR, measure ink, and read the CM / INCH
 * tick. Pure (typed arrays only), so the OCR worker and Node tests share it.
 */
import type { NormRect } from './pair-letters';

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, 0 black .. 255 white. */
  data: Uint8Array;
}

export function toGray(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): GrayImage {
  const data = new Uint8Array(width * height);
  const channels = rgba.length / (width * height);
  for (let i = 0, p = 0; i < data.length; i += 1, p += channels) {
    if (channels >= 3) {
      const alpha = channels === 4 ? rgba[p + 3] / 255 : 1;
      const y = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      data[i] = Math.round(y * alpha + 255 * (1 - alpha));
    } else {
      data[i] = rgba[p];
    }
  }
  return { width, height, data };
}

/** Bilinear resample of a region (pixel coordinates) to the given size. */
function resample(
  img: GrayImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  outW: number,
  outH: number
): GrayImage {
  const out = new Uint8Array(outW * outH);
  const sx = w / outW;
  const sy = h / outH;
  for (let y = 0; y < outH; y += 1) {
    const fy = Math.min(img.height - 1, Math.max(0, y0 + (y + 0.5) * sy - 0.5));
    const iy = Math.floor(fy);
    const dy = fy - iy;
    const iy1 = Math.min(img.height - 1, iy + 1);
    for (let x = 0; x < outW; x += 1) {
      const fx = Math.min(img.width - 1, Math.max(0, x0 + (x + 0.5) * sx - 0.5));
      const ix = Math.floor(fx);
      const dx = fx - ix;
      const ix1 = Math.min(img.width - 1, ix + 1);
      const a = img.data[iy * img.width + ix];
      const b = img.data[iy * img.width + ix1];
      const c = img.data[iy1 * img.width + ix];
      const d = img.data[iy1 * img.width + ix1];
      out[y * outW + x] = Math.round(
        a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy
      );
    }
  }
  return { width: outW, height: outH, data: out };
}

/** Shrink a page so its width is at most `maxWidth`. */
export function downscale(img: GrayImage, maxWidth: number): GrayImage {
  if (img.width <= maxWidth) return img;
  const outH = Math.round((img.height * maxWidth) / img.width);
  // Box-average first when shrinking a lot, so thin print survives.
  const factor = Math.floor(img.width / maxWidth);
  let src = img;
  if (factor >= 2) {
    const w = Math.floor(img.width / factor);
    const h = Math.floor(img.height / factor);
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        let total = 0;
        for (let yy = 0; yy < factor; yy += 1)
          for (let xx = 0; xx < factor; xx += 1)
            total += img.data[(y * factor + yy) * img.width + x * factor + xx];
        data[y * w + x] = Math.round(total / (factor * factor));
      }
    src = { width: w, height: h, data };
  }
  return resample(src, 0, 0, src.width, src.height, maxWidth, outH);
}

const toPixels = (img: GrayImage, r: NormRect) => {
  const x0 = Math.max(0, Math.floor(r.x * img.width));
  const y0 = Math.max(0, Math.floor(r.y * img.height));
  const x1 = Math.min(img.width, Math.ceil((r.x + r.w) * img.width));
  const y1 = Math.min(img.height, Math.ceil((r.y + r.h) * img.height));
  return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
};

/** A rect shrunk on every side by a share of its height (keeps the box border out). */
export function insetRect(r: NormRect, share: number): NormRect {
  const d = r.h * share;
  return { x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) };
}

/**
 * A value box ready for OCR: inset past its border, scaled up (3x by
 * default), contrast stretched to the full range, with a white margin.
 */
export function cropForOcr(img: GrayImage, rect: NormRect, scale = 3): GrayImage {
  const p = toPixels(img, rect);
  const outW = Math.max(8, Math.round(p.w * scale));
  const outH = Math.max(8, Math.round(p.h * scale));
  const crop = resample(img, p.x0, p.y0, p.w, p.h, outW, outH);
  const sorted = Array.from(crop.data).sort((a, b) => a - b);
  const hi = sorted[Math.floor(sorted.length * 0.9)];
  // A box with very little ink (a lone "1") must not stretch paper grain to black.
  const lo = Math.min(sorted[Math.floor(sorted.length * 0.005)], hi - 90);
  const span = Math.max(24, hi - lo);
  for (let i = 0; i < crop.data.length; i += 1) {
    const v = ((crop.data[i] - lo) / span) * 255;
    crop.data[i] = v >= 255 ? 255 : v <= 0 ? 0 : Math.round(v);
  }
  const margin = Math.round(outH * 0.3);
  const W = outW + margin * 2;
  const H = outH + margin * 2;
  const framed = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < outH; y += 1)
    framed.set(crop.data.subarray(y * outW, (y + 1) * outW), (y + margin) * W + margin);
  return { width: W, height: H, data: framed };
}

/** Binary PGM: a format Tesseract (Leptonica) reads from memory in the browser and in Node. */
export function encodePgm(img: GrayImage): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${img.width} ${img.height}\n255\n`);
  const out = new Uint8Array(header.length + img.data.length);
  out.set(header, 0);
  out.set(img.data, header.length);
  return out;
}

/** Share of dark pixels in a rect, against the paper brightness around them. */
export function inkFraction(img: GrayImage, rect: NormRect): number {
  const p = toPixels(img, rect);
  const values: number[] = [];
  for (let y = p.y0; y < p.y0 + p.h; y += 1)
    for (let x = p.x0; x < p.x0 + p.w; x += 1) values.push(img.data[y * img.width + x]);
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  // Scanned paper is light; a small area filled with ink must not set its own paper level.
  const paper = Math.max(sorted[Math.floor(sorted.length * 0.9)], 170);
  const threshold = paper * 0.62;
  let dark = 0;
  for (const v of values) if (v < threshold) dark += 1;
  return dark / values.length;
}

/** True when a value box (inset past its border) holds handwriting or print. */
export function hasInk(img: GrayImage, rect: NormRect): boolean {
  return inkFraction(img, insetRect(rect, 0.18)) > 0.005;
}

/**
 * The inside of a printed circle near `rect`: slides a ring of the circle's size
 * around the expected place and keeps the darkest fit, then returns the middle
 * of it (the ring itself left out).
 */
export function circleCore(img: GrayImage, rect: NormRect): NormRect {
  const px = (x: number, y: number) => {
    const ix = Math.round(x * img.width);
    const iy = Math.round(y * img.height);
    if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return 255;
    return img.data[iy * img.width + ix];
  };
  const rx = rect.w * 0.45;
  const ry = rect.h * 0.45;
  let best = { score: -1, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
  for (let oy = -0.5; oy <= 0.5001; oy += 0.05)
    for (let ox = -0.8; ox <= 0.8001; ox += 0.05) {
      const cx = rect.x + rect.w / 2 + ox * rect.w;
      const cy = rect.y + rect.h / 2 + oy * rect.h;
      let score = 0;
      for (let k = 0; k < 36; k += 1) {
        const t = (k / 36) * Math.PI * 2;
        score += 255 - px(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry);
      }
      if (score > best.score) best = { score, cx, cy };
    }
  return {
    x: best.cx - rect.w * 0.25,
    y: best.cy - rect.h * 0.25,
    w: rect.w * 0.5,
    h: rect.h * 0.5,
  };
}

/**
 * Which CM / INCH circle is ticked, by ink in and just around each circle:
 * the ticked one carries clearly more than the empty one.
 */
export function readUnitTick(
  img: GrayImage,
  circles: Array<{ unit: 'cm' | 'inch'; rect: NormRect }>
): 'cm' | 'inch' | null {
  const cm = circles.find(c => c.unit === 'cm');
  const inch = circles.find(c => c.unit === 'inch');
  if (!cm || !inch) return null;
  // The inside of each circle, found where its printed ring actually is.
  const a = inkFraction(img, circleCore(img, cm.rect));
  const b = inkFraction(img, circleCore(img, inch.rect));
  if (Math.max(a, b) < 0.03) return null;
  if (b > a * 2 && b - a > 0.03) return 'inch';
  if (a > b * 2 && a - b > 0.03) return 'cm';
  return null;
}
