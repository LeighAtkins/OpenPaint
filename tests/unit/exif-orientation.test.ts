import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  needsUpright,
  orientationTransform,
  readExifOrientation,
  readImageFileInfo,
  rotationTransform,
  uprightImageFile,
} from '../../src/modules/utils/exif-orientation';

function tiffWithOrientation(orientation: number, little = true): number[] {
  const u16 = (n: number) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) =>
    little
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
      : [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  return [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(0x2a),
    ...u32(8), // IFD0 at byte 8
    ...u16(2), // two entries: Make (to be skipped) then Orientation
    ...u16(0x010f),
    ...u16(2),
    ...u32(4),
    0x41,
    0x42,
    0x43,
    0x00, // Make = "ABC"
    ...u16(0x0112),
    ...u16(3),
    ...u32(1),
    ...u16(orientation),
    ...u16(0),
    ...u32(0), // no next IFD
  ];
}

/** A minimal JPEG: SOI, APP1 Exif, SOF0 (width x height), EOI. */
function jpegFixture(options: {
  orientation?: number;
  little?: boolean;
  width?: number;
  height?: number;
}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  if (options.orientation) {
    const payload = [
      0x45,
      0x78,
      0x69,
      0x66,
      0,
      0,
      ...tiffWithOrientation(options.orientation, options.little ?? true),
    ];
    const length = payload.length + 2;
    bytes.push(0xff, 0xe1, length >> 8, length & 0xff, ...payload);
  }
  // A JFIF APP0 that must be skipped without confusing the walker.
  bytes.push(0xff, 0xe0, 0x00, 0x04, 0x00, 0x00);
  const width = options.width ?? 4000;
  const height = options.height ?? 3000;
  bytes.push(
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00
  );
  bytes.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);
  return new Uint8Array(bytes);
}

function pngFixture(orientation: number): Uint8Array {
  const chunk = (type: string, data: number[]) => [
    (data.length >> 24) & 0xff,
    (data.length >> 16) & 0xff,
    (data.length >> 8) & 0xff,
    data.length & 0xff,
    ...type.split('').map(c => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0, // CRC not checked
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [0, 0, 0x0b, 0xb8, 0, 0, 0x0f, 0xa0, 8, 6, 0, 0, 0]), // 3000 x 4000
    ...chunk('eXIf', tiffWithOrientation(orientation, false)),
    ...chunk('IDAT', [0]),
    ...chunk('IEND', []),
  ]);
}

describe('EXIF orientation parser', () => {
  it.each([1, 3, 6, 8])(
    'reads orientation %i from a little-endian JPEG APP1 segment',
    orientation => {
      expect(readExifOrientation(jpegFixture({ orientation }))).toBe(orientation);
    }
  );

  it('reads a big-endian (Motorola) TIFF header', () => {
    expect(readExifOrientation(jpegFixture({ orientation: 6, little: false }))).toBe(6);
  });

  it('gives 0 for a JPEG without EXIF and for non-image bytes', () => {
    expect(readExifOrientation(jpegFixture({}))).toBe(0);
    expect(readExifOrientation(new Uint8Array([1, 2, 3, 4, 5]))).toBe(0);
    expect(readExifOrientation(new Uint8Array(0))).toBe(0);
  });

  it('reads the stored frame size alongside the orientation', () => {
    const info = readImageFileInfo(jpegFixture({ orientation: 6, width: 4032, height: 3024 }));
    expect(info).toEqual({ orientation: 6, width: 4032, height: 3024, format: 'jpeg' });
  });

  it('reads a PNG eXIf chunk and IHDR size', () => {
    expect(readImageFileInfo(pngFixture(8))).toEqual({
      orientation: 8,
      width: 3000,
      height: 4000,
      format: 'png',
    });
    expect(readExifOrientation(pngFixture(1))).toBe(1);
  });

  it('ignores out-of-range orientation values', () => {
    expect(readExifOrientation(jpegFixture({ orientation: 9 }))).toBe(0);
  });

  it('only orientations 2 to 8 need work', () => {
    expect(needsUpright(0)).toBe(false);
    expect(needsUpright(1)).toBe(false);
    expect([2, 3, 4, 5, 6, 7, 8].every(needsUpright)).toBe(true);
  });
});

describe('orientation transform math', () => {
  const w = 40;
  const h = 30;
  const corners = (orientation: number) => {
    const t = orientationTransform(orientation, w, h);
    return {
      size: [t.width, t.height],
      topLeft: applyTransform(t, 0, 0),
      topRight: applyTransform(t, w, 0),
      bottomLeft: applyTransform(t, 0, h),
    };
  };

  it('orientation 1 is the identity', () => {
    expect(corners(1)).toEqual({
      size: [w, h],
      topLeft: { x: 0, y: 0 },
      topRight: { x: w, y: 0 },
      bottomLeft: { x: 0, y: h },
    });
  });

  it('orientation 3 turns the image 180 degrees', () => {
    expect(corners(3)).toEqual({
      size: [w, h],
      topLeft: { x: w, y: h },
      topRight: { x: 0, y: h },
      bottomLeft: { x: w, y: 0 },
    });
  });

  it('orientation 6 turns the stored pixels 90 degrees clockwise into a portrait frame', () => {
    // The stored top edge becomes the right edge.
    expect(corners(6)).toEqual({
      size: [h, w],
      topLeft: { x: h, y: 0 },
      topRight: { x: h, y: w },
      bottomLeft: { x: 0, y: 0 },
    });
  });

  it('orientation 8 turns the stored pixels 90 degrees anticlockwise', () => {
    // The stored top edge becomes the left edge.
    expect(corners(8)).toEqual({
      size: [h, w],
      topLeft: { x: 0, y: w },
      topRight: { x: 0, y: 0 },
      bottomLeft: { x: h, y: w },
    });
  });

  it('mirrored orientations keep the size but flip an axis', () => {
    expect(corners(2).topLeft).toEqual({ x: w, y: 0 });
    expect(corners(4).topLeft).toEqual({ x: 0, y: h });
    expect(corners(5)).toEqual({
      size: [h, w],
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: w },
      bottomLeft: { x: h, y: 0 },
    });
    expect(corners(7).topLeft).toEqual({ x: h, y: w });
  });

  it('every corner of the stored image lands inside the upright frame', () => {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const t = orientationTransform(orientation, w, h);
      for (const [x, y] of [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ]) {
        const p = applyTransform(t, x, y);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(t.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(t.height);
      }
    }
  });

  it('manual rotation maps onto the same transforms', () => {
    expect(rotationTransform(90, w, h)).toEqual(orientationTransform(6, w, h));
    expect(rotationTransform(-90, w, h)).toEqual(orientationTransform(8, w, h));
    expect(rotationTransform(270, w, h)).toEqual(orientationTransform(8, w, h));
    expect(rotationTransform(180, w, h)).toEqual(orientationTransform(3, w, h));
    expect(rotationTransform(0, w, h)).toEqual(orientationTransform(1, w, h));
    expect(rotationTransform(360, w, h)).toEqual(orientationTransform(1, w, h));
  });
});

describe('uprightImageFile', () => {
  it('returns the same File untouched when there is nothing to do', async () => {
    const file = new File([jpegFixture({ orientation: 1 })], 'front.jpg', { type: 'image/jpeg' });
    const result = await uprightImageFile(file);
    expect(result.changed).toBe(false);
    expect(result.orientation).toBe(1);
    expect(result.file).toBe(file);
  });

  it('leaves non-image files alone', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });
    const result = await uprightImageFile(file);
    expect(result.changed).toBe(false);
    expect(result.file).toBe(file);
  });
});
