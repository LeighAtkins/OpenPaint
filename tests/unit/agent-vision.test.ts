import { describe, expect, it } from 'vitest';
import {
  alignPhoto,
  differsFromPhoto,
  findMarks,
  gradient,
  snapEndpoint,
  toGray,
  toPhoto,
  type Pixels,
} from '../../src/modules/agent/agent-vision';

function blank(w: number, h: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data.set([...rgb, 255], i * 4);
  }
  return { width: w, height: h, data };
}
const put = (img: Pixels, x: number, y: number, rgb: [number, number, number]) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set([...rgb, 255], (Math.round(y) * img.width + Math.round(x)) * 4);
};

/** A textured "photo": soft stripes with a dark sofa block. */
function photo(w: number, h: number): Pixels {
  const img = blank(w, h, [200, 200, 200]);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const base = 150 + 60 * Math.sin(x / 7) * Math.cos(y / 11);
      const sofa = x > w * 0.3 && x < w * 0.8 && y > h * 0.4 && y < h * 0.85;
      const v = sofa ? base * 0.45 : base;
      put(img, x, y, [v, v * 0.95, v * 0.9]);
    }
  }
  return img;
}

describe('agent vision', () => {
  it('snaps a line end onto the nearest strong edge', () => {
    const img = blank(120, 80, [230, 230, 230]);
    for (let y = 0; y < 80; y += 1) for (let x = 70; x < 120; x += 1) put(img, x, y, [40, 40, 40]);
    const gray = toGray(img);
    const grad = gradient(gray, 120, 80);
    const snap = snapEndpoint(grad, 120, 80, { x: 62, y: 40 }, { x: 10, y: 40 }, 15);
    expect(Math.abs(snap.point.x - 69.5)).toBeLessThanOrEqual(1);
    expect(snap.strength).toBeGreaterThan(0.9);
  });

  it('finds coloured strokes and ignores beige and grey', () => {
    const img = blank(200, 150, [210, 190, 160]);
    for (let x = 30; x < 170; x += 1)
      for (let t = -1; t <= 1; t += 1) put(img, x, 60 + t, [30, 110, 240]);
    for (let y = 20; y < 120; y += 1)
      for (let t = -1; t <= 1; t += 1) put(img, 100 + t, y, [245, 150, 20]);
    for (let y = 130; y < 140; y += 1)
      for (let x = 10; x < 20; x += 1) put(img, x, y, [30, 110, 240]); // blob
    const marks = findMarks(img);
    const blue = marks.find(m => m.color === 'blue')!;
    const orange = marks.find(m => m.color === 'orange')!;
    expect(marks).toHaveLength(2);
    expect(Math.round(blue.length)).toBeGreaterThanOrEqual(135);
    expect(Math.min(blue.from.x, blue.to.x)).toBeLessThan(32);
    expect(Math.abs(orange.from.x - 100)).toBeLessThan(2);
  });

  it('finds a scaled photo inside a screenshot and maps marks onto it', () => {
    const src = photo(160, 200);
    // Screenshot: white page, photo shown at 0.75 scale from (40, 30).
    const shot = blank(260, 240, [255, 255, 255]);
    for (let y = 0; y < 150; y += 1) {
      for (let x = 0; x < 120; x += 1) {
        const j = (Math.floor(y / 0.75) * 160 + Math.floor(x / 0.75)) * 4;
        put(shot, 40 + x, 30 + y, [src.data[j], src.data[j + 1], src.data[j + 2]]);
      }
    }
    // A blue mark across the photo at photo y = 0.5.
    for (let x = 50; x < 150; x += 1) put(shot, x, 30 + 75, [20, 100, 250]);
    const a = alignPhoto(shot, src);
    expect(a.score).toBeGreaterThan(0.8);
    expect(Math.abs(a.scale - 0.75)).toBeLessThan(0.04);
    expect(Math.abs(a.offsetX - 40)).toBeLessThan(3);
    expect(Math.abs(a.offsetY - 30)).toBeLessThan(3);
    const [mark] = findMarks(shot, { colors: ['blue'] });
    const p = toPhoto(mark.from, a, src);
    expect(Math.abs(p.y - 0.5)).toBeLessThan(0.03);
  });

  it('finds a cropped photo and ignores coloured areas that are in the photo itself', () => {
    const src = photo(160, 200);
    // Paint an orange "floor" into the photo itself.
    for (let y = 170; y < 200; y += 1)
      for (let x = 0; x < 160; x += 1) put(src, x, y, [190, 110, 40]);
    // Screenshot shows the photo's middle only (crop from y 40), at 1.2x.
    const shot = blank(200, 200, [255, 255, 255]);
    for (let y = 0; y < 200; y += 1) {
      for (let x = 0; x < 192; x += 1) {
        const sx = Math.floor(x / 1.2);
        const sy = Math.floor(y / 1.2) + 40;
        if (sy >= 200) continue;
        const j = (sy * 160 + sx) * 4;
        put(shot, 4 + x, y, [src.data[j], src.data[j + 1], src.data[j + 2]]);
      }
    }
    for (let y = 30; y < 120; y += 1) put(shot, 60, y, [20, 100, 250]);
    const a = alignPhoto(shot, src);
    expect(Math.abs(a.scale - 1.2)).toBeLessThan(0.06);
    expect(Math.abs(a.offsetY - -48)).toBeLessThan(5);
    const marks = findMarks(shot, { keep: differsFromPhoto(shot, src, a) });
    expect(marks.map(m => m.color)).toEqual(['blue']);
  });
});
