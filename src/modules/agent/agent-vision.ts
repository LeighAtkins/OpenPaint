/**
 * Image helpers for agent drawing, on plain RGBA pixel buffers so they run in
 * the browser and in tests:
 *
 * - snapEndpoint: move a line's end onto the strongest edge along the line.
 * - findMarks: coloured strokes someone drew on a screenshot, as segments.
 * - alignPhoto: where (scale, offset) a project photo sits inside a screenshot.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface P {
  x: number;
  y: number;
}

// ── Grey and gradients ──────────────────────────────────────────────

export function toGray(img: Pixels): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let i = 0, j = 0; i < out.length; i += 1, j += 4) {
    out[i] = 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2];
  }
  return out;
}

/** Box-average a grey image down to (w, h). */
export function resizeGray(gray: Float32Array, sw: number, sh: number, w: number, h: number) {
  const out = new Float32Array(w * h);
  const fx = sw / w;
  const fy = sh / h;
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < sh; yy += 1) {
        for (let xx = x0; xx < x1 && xx < sw; xx += 1) {
          sum += gray[yy * sw + xx];
          n += 1;
        }
      }
      out[y * w + x] = n ? sum / n : 0;
    }
  }
  return out;
}

/** Sobel gradient magnitude. */
export function gradient(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] -
        2 * gray[i - 1] -
        gray[i + w - 1] +
        gray[i - w + 1] +
        2 * gray[i + 1] +
        gray[i + w + 1];
      const gy =
        -gray[i - w - 1] -
        2 * gray[i - w] -
        gray[i - w + 1] +
        gray[i + w - 1] +
        2 * gray[i + w] +
        gray[i + w + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

// ── Snapping ────────────────────────────────────────────────────────

export interface SnapResult {
  point: P;
  /** Pixels moved. */
  moved: number;
  /** Edge strength at the result, relative to the strongest edge searched (0..1). */
  strength: number;
}

/**
 * Slide `end` along the direction from `other` to `end` by up to ±radius
 * pixels and stop at the strongest edge, preferring nearer edges a little.
 */
export function snapEndpoint(
  grad: Float32Array,
  w: number,
  h: number,
  end: P,
  other: P,
  radius: number
): SnapResult {
  const len = Math.hypot(end.x - other.x, end.y - other.y) || 1;
  const ux = (end.x - other.x) / len;
  const uy = (end.y - other.y) / len;
  // Average across a few pixels each side of the line so texture counts less.
  const px = -uy;
  const py = ux;
  const sample = (x: number, y: number) => {
    let sum = 0;
    for (let k = -2; k <= 2; k += 1) {
      const xx = Math.round(x + px * k);
      const yy = Math.round(y + py * k);
      if (xx >= 1 && yy >= 1 && xx < w - 1 && yy < h - 1) sum += grad[yy * w + xx];
    }
    return sum / 5;
  };
  let best = { t: 0, score: -1, raw: 0 };
  let peak = 0;
  for (let t = -radius; t <= radius; t += 1) {
    const raw = sample(end.x + ux * t, end.y + uy * t);
    peak = Math.max(peak, raw);
    const score = raw * (1 - (0.35 * Math.abs(t)) / radius);
    if (score > best.score) best = { t, score, raw };
  }
  return {
    point: { x: end.x + ux * best.t, y: end.y + uy * best.t },
    moved: Math.abs(best.t),
    strength: peak ? best.raw / peak : 0,
  };
}

// ── Coloured marks ──────────────────────────────────────────────────

export type MarkColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

function hueOf(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

export function colorName(r: number, g: number, b: number): MarkColor | null {
  const { h, s, v } = hueOf(r, g, b);
  if (s < 0.5 || v < 0.45) return null;
  if (h < 12 || h >= 340) return 'red';
  if (h < 40) return 'orange';
  if (h < 68) return 'yellow';
  if (h < 165) return 'green';
  if (h < 255) return 'blue';
  return 'purple';
}

export interface Mark {
  color: MarkColor;
  /** Segment ends in screenshot pixels, along the stroke's main axis. */
  from: P;
  to: P;
  length: number;
  pixels: number;
  /** Length / width: high for lines, low for blobs and text. */
  elongation: number;
}

/** Coloured strokes in a screenshot, longest first. */
export function findMarks(
  img: Pixels,
  options: {
    colors?: MarkColor[];
    minLength?: number;
    minElongation?: number;
    /** Extra test per pixel, e.g. differsFromPhoto. */
    keep?: (x: number, y: number) => boolean;
  } = {}
): Mark[] {
  const { width: w, height: h, data } = img;
  const label = new Int32Array(w * h).fill(-1);
  const colorAt = new Array<MarkColor | null>(w * h);
  for (let i = 0, j = 0; i < w * h; i += 1, j += 4) {
    const c = colorName(data[j], data[j + 1], data[j + 2]);
    colorAt[i] =
      c &&
      (!options.colors || options.colors.includes(c)) &&
      (!options.keep || options.keep(i % w, Math.floor(i / w)))
        ? c
        : null;
  }
  const marks: Mark[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start += 1) {
    const color = colorAt[start];
    if (!color || label[start] !== -1) continue;
    const pixels: number[] = [];
    label[start] = start;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (label[n] === -1 && colorAt[n] === color) {
            label[n] = start;
            stack.push(n);
          }
        }
      }
    }
    if (pixels.length < 12) continue;
    // Principal axis of the stroke's pixels.
    let mx = 0;
    let my = 0;
    for (const i of pixels) {
      mx += i % w;
      my += Math.floor(i / w);
    }
    mx /= pixels.length;
    my /= pixels.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const i of pixels) {
      const dx = (i % w) - mx;
      const dy = Math.floor(i / w) - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let lo = Infinity;
    let hi = -Infinity;
    let wide = 0;
    for (const i of pixels) {
      const dx = (i % w) - mx;
      const dy = Math.floor(i / w) - my;
      const along = dx * ux + dy * uy;
      lo = Math.min(lo, along);
      hi = Math.max(hi, along);
      wide += Math.abs(-dx * uy + dy * ux);
    }
    const length = hi - lo;
    const width = Math.max(1, (2 * wide) / pixels.length);
    const mark: Mark = {
      color,
      from: { x: mx + ux * lo, y: my + uy * lo },
      to: { x: mx + ux * hi, y: my + uy * hi },
      length,
      pixels: pixels.length,
      elongation: length / width,
    };
    if (mark.elongation >= (options.minElongation ?? 4) && length >= 6) marks.push(mark);
  }
  return mergeCollinear(marks)
    .filter(m => m.length >= (options.minLength ?? 15))
    .sort((a, b) => b.length - a.length);
}

/**
 * Rejoin pieces of one stroke that another stroke crossed: same colour, nearly
 * the same direction, and the gap between them lies on the same line.
 */
export function mergeCollinear(marks: Mark[], maxGap = 14, maxAngleDeg = 8): Mark[] {
  const out = [...marks];
  const dir = (m: Mark) => Math.atan2(m.to.y - m.from.y, m.to.x - m.from.x);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i];
        const b = out[j];
        if (a.color !== b.color) continue;
        let d = Math.abs(dir(a) - dir(b)) % Math.PI;
        d = Math.min(d, Math.PI - d);
        if ((d * 180) / Math.PI > maxAngleDeg) continue;
        const ends = [a.from, a.to, b.from, b.to];
        const ux = Math.cos(dir(a));
        const uy = Math.sin(dir(a));
        // b's ends must sit on a's line.
        const off = (q: P) => Math.abs(-(q.x - a.from.x) * uy + (q.y - a.from.y) * ux);
        if (off(b.from) > 4 || off(b.to) > 4) continue;
        const along = ends.map(q => (q.x - a.from.x) * ux + (q.y - a.from.y) * uy);
        const [a0, a1] = [Math.min(along[0], along[1]), Math.max(along[0], along[1])];
        const [b0, b1] = [Math.min(along[2], along[3]), Math.max(along[2], along[3])];
        const gap = Math.max(b0 - a1, a0 - b1);
        if (gap > maxGap) continue;
        const lo = Math.min(a0, b0);
        const hi = Math.max(a1, b1);
        out[i] = {
          color: a.color,
          from: { x: a.from.x + ux * lo, y: a.from.y + uy * lo },
          to: { x: a.from.x + ux * hi, y: a.from.y + uy * hi },
          length: hi - lo,
          pixels: a.pixels + b.pixels,
          elongation: Math.max(a.elongation, b.elongation),
        };
        out.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return out;
}

// ── Finding a photo inside a screenshot ─────────────────────────────

export interface Alignment {
  /** Screenshot pixels per photo pixel. */
  scale: number;
  /** Screenshot position of the photo's top-left corner. */
  offsetX: number;
  offsetY: number;
  /** Normalised correlation, -1..1; above ~0.6 is a confident match. */
  score: number;
}

/** Normalised correlation over the part of the template that overlaps the image. */
function correlate(
  img: Float32Array,
  iw: number,
  ih: number,
  tpl: Float32Array,
  tw: number,
  th: number,
  ox: number,
  oy: number,
  skip: Uint8Array | null,
  minOverlap: number
): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  const y0 = Math.max(0, -oy);
  const y1 = Math.min(th, ih - oy);
  const x0 = Math.max(0, -ox);
  const x1 = Math.min(tw, iw - ox);
  if ((y1 - y0) * (x1 - x0) < tw * th * minOverlap) return -1;
  for (let y = y0; y < y1; y += 1) {
    const row = (oy + y) * iw + ox;
    for (let x = x0; x < x1; x += 1) {
      if (skip && skip[row + x]) continue;
      const a = img[row + x];
      const b = tpl[y * tw + x];
      n += 1;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  }
  if (n < tw * th * minOverlap * 0.6) return -1;
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
}

/**
 * Find a photo inside a screenshot that shows it scaled, possibly cropped,
 * and with coloured marks on top (ignored). Coarse search over scale and
 * position, then a finer search around the best hit.
 */
export function alignPhoto(
  screen: Pixels,
  photo: Pixels,
  options: { coarseWidth?: number; minOverlap?: number } = {}
): Alignment {
  const coarseWidth = options.coarseWidth ?? 40;
  const minOverlap = options.minOverlap ?? 0.35;
  const sGray = toGray(screen);
  const pGray = toGray(photo);
  const marks = new Float32Array(screen.width * screen.height);
  for (let i = 0, j = 0; i < marks.length; i += 1, j += 4) {
    if (colorName(screen.data[j], screen.data[j + 1], screen.data[j + 2])) marks[i] = 255;
  }

  const search = (
    tplW: number,
    scales: number[],
    window: { x0: number; y0: number; x1: number; y1: number } | null
  ): Alignment => {
    const tplH = Math.max(4, Math.round((tplW * photo.height) / photo.width));
    const tpl = resizeGray(pGray, photo.width, photo.height, tplW, tplH);
    let best: Alignment = { scale: 0, offsetX: 0, offsetY: 0, score: -2 };
    for (const scale of scales) {
      // Screenshot shrunk so the photo would appear tplW pixels wide.
      const k = tplW / (photo.width * scale);
      const iw = Math.max(1, Math.round(screen.width * k));
      const ih = Math.max(1, Math.round(screen.height * k));
      const img = resizeGray(sGray, screen.width, screen.height, iw, ih);
      const skip = Uint8Array.from(resizeGray(marks, screen.width, screen.height, iw, ih), v =>
        v > 40 ? 1 : 0
      );
      const xs0 = window ? Math.floor(window.x0 * k) : -Math.floor(tplW * 0.65);
      const ys0 = window ? Math.floor(window.y0 * k) : -Math.floor(tplH * 0.65);
      const xs1 = window ? Math.ceil(window.x1 * k) : iw - Math.ceil(tplW * 0.35);
      const ys1 = window ? Math.ceil(window.y1 * k) : ih - Math.ceil(tplH * 0.35);
      for (let oy = ys0; oy <= ys1; oy += 1) {
        for (let ox = xs0; ox <= xs1; ox += 1) {
          const score = correlate(img, iw, ih, tpl, tplW, tplH, ox, oy, skip, minOverlap);
          if (score > best.score) best = { scale, offsetX: ox / k, offsetY: oy / k, score };
        }
      }
    }
    return best;
  };

  const fit = Math.min(screen.width / photo.width, screen.height / photo.height);
  const coarse: number[] = [];
  for (let sc = fit * 2.6; sc >= fit * 0.3; sc *= 0.93) coarse.push(sc);
  const first = search(coarseWidth, coarse, null);
  if (first.scale <= 0) return first;
  const fine: number[] = [];
  for (let f = 0.95; f <= 1.0501; f += 0.0125) fine.push(first.scale * f);
  const pad = ((photo.width * first.scale) / coarseWidth) * 3;
  const second = search(Math.min(120, coarseWidth * 3), fine, {
    x0: first.offsetX - pad,
    y0: first.offsetY - pad,
    x1: first.offsetX + pad,
    y1: first.offsetY + pad,
  });
  return second.score > first.score ? second : first;
}

/**
 * Keep only marked pixels that are not part of the photo underneath: with an
 * alignment, a pixel counts when it differs clearly from the photo there.
 */
export function differsFromPhoto(
  screen: Pixels,
  photo: Pixels,
  a: Alignment,
  threshold = 70
): (x: number, y: number) => boolean {
  // Compare with the closest photo pixel within ±reach, so a one-pixel
  // misalignment along an edge does not read as a mark.
  const reach = 2;
  return (x, y) => {
    const cx = Math.floor((x - a.offsetX) / a.scale);
    const cy = Math.floor((y - a.offsetY) / a.scale);
    if (cx < -reach || cy < -reach || cx >= photo.width + reach || cy >= photo.height + reach) {
      return true;
    }
    const i = (y * screen.width + x) * 4;
    let closest = Infinity;
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= photo.width || py >= photo.height) continue;
        const j = (py * photo.width + px) * 4;
        const d =
          Math.abs(screen.data[i] - photo.data[j]) +
          Math.abs(screen.data[i + 1] - photo.data[j + 1]) +
          Math.abs(screen.data[i + 2] - photo.data[j + 2]);
        if (d < closest) closest = d;
      }
    }
    return closest > threshold;
  };
}

/** Screenshot pixel -> photo position normalised 0..1. */
export function toPhoto(p: P, a: Alignment, photo: { width: number; height: number }): P {
  return {
    x: (p.x - a.offsetX) / a.scale / photo.width,
    y: (p.y - a.offsetY) / a.scale / photo.height,
  };
}
