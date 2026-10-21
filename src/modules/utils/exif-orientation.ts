// EXIF orientation for imported photos.
//
// Phone JPEGs (and some PNGs with an eXIf chunk) store the pixels as the sensor
// saw them and leave a note saying how to turn them. SofaPaint bakes that turn
// into the pixels once, on import, so the image is upright everywhere it is
// drawn, exported or sent on. Nothing here touches the DOM except
// uprightImageFile and rotateImageFile, which need a canvas.

export interface ImageFileInfo {
  /** EXIF orientation 1-8, or 0 when the file has none. */
  orientation: number;
  /** Stored pixel size before any orientation is applied, 0 when unknown. */
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'unknown';
}

export interface OrientationTransform {
  /** Size of the upright image. */
  width: number;
  height: number;
  /** [a, b, c, d, e, f] for ctx.setTransform before drawing the stored pixels at 0,0. */
  matrix: [number, number, number, number, number, number];
}

const toBytes = (data: Uint8Array | ArrayBuffer): Uint8Array =>
  data instanceof Uint8Array ? data : new Uint8Array(data);

/** Read the orientation tag (0x0112) out of a TIFF block (the body of an EXIF segment). */
export function readTiffOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 0;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return 0;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (offset: number): number => view.getUint16(offset, little);
  const u32 = (offset: number): number => view.getUint32(offset, little);
  if (u16(2) !== 0x2a) return 0;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 0;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 0;
    if (u16(entry) !== 0x0112) continue;
    const type = u16(entry + 2);
    // SHORT values sit in the first two bytes of the value field; LONG uses all four.
    const value = type === 3 ? u16(entry + 8) : type === 4 ? u32(entry + 8) : 0;
    return value >= 1 && value <= 8 ? value : 0;
  }
  return 0;
}

function readJpeg(bytes: Uint8Array): ImageFileInfo {
  const info: ImageFileInfo = { orientation: 0, width: 0, height: 0, format: 'jpeg' };
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers have no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    const start = offset + 4;
    const end = offset + 2 + length;
    if (end > bytes.length) break;
    if (
      marker === 0xe1 &&
      !info.orientation &&
      bytes[start] === 0x45 && // E
      bytes[start + 1] === 0x78 && // x
      bytes[start + 2] === 0x69 && // i
      bytes[start + 3] === 0x66 && // f
      bytes[start + 4] === 0 &&
      bytes[start + 5] === 0
    ) {
      info.orientation = readTiffOrientation(bytes.subarray(start + 6, end));
    }
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader && !info.width && end - start >= 5) {
      info.height = (bytes[start + 1] << 8) | bytes[start + 2];
      info.width = (bytes[start + 3] << 8) | bytes[start + 4];
    }
    if (info.orientation && info.width) break;
    offset = end;
  }
  return info;
}

function readPng(bytes: Uint8Array): ImageFileInfo {
  const info: ImageFileInfo = { orientation: 0, width: 0, height: 0, format: 'png' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;
    if (type === 'IHDR' && length >= 8) {
      info.width = view.getUint32(start);
      info.height = view.getUint32(start + 4);
    } else if (type === 'eXIf') {
      info.orientation = readTiffOrientation(bytes.subarray(start, end));
    } else if (type === 'IDAT' || type === 'IEND') {
      break; // eXIf must come before the image data
    }
    offset = end + 4; // skip CRC
  }
  return info;
}

/** Orientation and stored size of a JPEG or PNG. Other formats give orientation 0. */
export function readImageFileInfo(data: Uint8Array | ArrayBuffer): ImageFileInfo {
  const bytes = toBytes(data);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
  if (
    bytes.length >= 16 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return readPng(bytes);
  return { orientation: 0, width: 0, height: 0, format: 'unknown' };
}

/** The EXIF orientation of a JPEG or PNG, 0 when there is none. */
export function readExifOrientation(data: Uint8Array | ArrayBuffer): number {
  return readImageFileInfo(data).orientation;
}

/** True for orientations that change what the viewer sees (2 to 8). */
export function needsUpright(orientation: number): boolean {
  return orientation >= 2 && orientation <= 8;
}

/**
 * How to draw the stored pixels (width x height) so the result is upright.
 * Orientation 6 is the common portrait phone photo: turn 90 degrees clockwise.
 */
export function orientationTransform(
  orientation: number,
  width: number,
  height: number
): OrientationTransform {
  const w = width;
  const h = height;
  switch (orientation) {
    case 2:
      return { width: w, height: h, matrix: [-1, 0, 0, 1, w, 0] };
    case 3:
      return { width: w, height: h, matrix: [-1, 0, 0, -1, w, h] };
    case 4:
      return { width: w, height: h, matrix: [1, 0, 0, -1, 0, h] };
    case 5:
      return { width: h, height: w, matrix: [0, 1, 1, 0, 0, 0] };
    case 6:
      return { width: h, height: w, matrix: [0, 1, -1, 0, h, 0] };
    case 7:
      return { width: h, height: w, matrix: [0, -1, -1, 0, h, w] };
    case 8:
      return { width: h, height: w, matrix: [0, -1, 1, 0, 0, w] };
    default:
      return { width: w, height: h, matrix: [1, 0, 0, 1, 0, 0] };
  }
}

/** Transform for turning an image by a multiple of 90 degrees (positive = clockwise). */
export function rotationTransform(
  degrees: number,
  width: number,
  height: number
): OrientationTransform {
  const turns = (((Math.round(degrees / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const orientation = turns === 1 ? 6 : turns === 2 ? 3 : turns === 3 ? 8 : 1;
  return orientationTransform(orientation, width, height);
}

/** Where a stored pixel lands after the transform (for tests and tooling). */
export function applyTransform(
  transform: OrientationTransform,
  x: number,
  y: number
): { x: number; y: number } {
  const [a, b, c, d, e, f] = transform.matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

// ---------------------------------------------------------------- canvas work

const JPEG_QUALITY = 0.92;

function outputType(mime: string): string {
  return /^image\/jpe?g$/i.test(mime) ? 'image/jpeg' : 'image/png';
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('The image could not be re-encoded'))),
      type,
      type === 'image/jpeg' ? JPEG_QUALITY : undefined
    );
  });
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode images for rotation');
  }
  try {
    // Browsers apply the EXIF turn themselves when asked; the result reports
    // the upright size.
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

function drawTransformed(source: ImageBitmap, transform: OrientationTransform): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = transform.width;
  canvas.height = transform.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2d canvas context');
  context.setTransform(...transform.matrix);
  context.drawImage(source, 0, 0);
  return canvas;
}

export interface UprightResult {
  file: File;
  orientation: number;
  changed: boolean;
}

/**
 * A copy of the file with its EXIF orientation baked into the pixels and the
 * tag gone. Files that are already upright (orientation 0 or 1), or that are
 * not JPEG/PNG, come back unchanged so their bytes stay byte-identical.
 */
export async function uprightImageFile(file: File): Promise<UprightResult> {
  const info = readImageFileInfo(await file.arrayBuffer());
  if (!needsUpright(info.orientation)) {
    return { file, orientation: info.orientation, changed: false };
  }
  const bitmap = await decode(file);
  try {
    const swapped = info.orientation >= 5;
    const storedSizeKnown = info.width > 0 && info.height > 0;
    // If the browser honoured the tag, a sideways photo comes back with its
    // sides swapped. If it did not (old engines), apply the turn ourselves.
    const browserApplied =
      !storedSizeKnown ||
      !swapped ||
      (bitmap.width === info.height && bitmap.height === info.width);
    const transform = browserApplied
      ? orientationTransform(1, bitmap.width, bitmap.height)
      : orientationTransform(info.orientation, bitmap.width, bitmap.height);
    const canvas = drawTransformed(bitmap, transform);
    const type = outputType(file.type);
    const blob = await canvasToBlob(canvas, type);
    const name =
      type === 'image/jpeg' ? file.name : file.name.replace(/\.(jpe?g|heic|heif)$/i, '.png');
    return {
      file: new File([blob], name, { type, lastModified: file.lastModified || Date.now() }),
      orientation: info.orientation,
      changed: true,
    };
  } finally {
    bitmap.close?.();
  }
}

/** A copy of the image turned by `degrees` (multiple of 90, positive = clockwise). */
export async function rotateImageBlob(
  blob: Blob,
  degrees: number,
  name = 'image.png'
): Promise<File> {
  const bitmap = await decode(blob);
  try {
    const transform = rotationTransform(degrees, bitmap.width, bitmap.height);
    const canvas = drawTransformed(bitmap, transform);
    const type = outputType(blob.type);
    const out = await canvasToBlob(canvas, type);
    const outName =
      type === 'image/jpeg' ? name : name.replace(/\.(jpe?g|heic|heif|webp)$/i, '.png');
    return new File([out], outName, { type, lastModified: Date.now() });
  } finally {
    bitmap.close?.();
  }
}
