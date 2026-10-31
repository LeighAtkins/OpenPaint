/**
 * Capture frame size and crop model.
 *
 * A frame tab stores two independent facts:
 *   - its authored size, as `baseWidth x baseHeight` at the window size where
 *     it was authored (`baseWindowWidth x baseWindowHeight`), and
 *   - its crop, as `worldRect` in canvas world coordinates.
 *
 * `width/height/windowWidth/windowHeight` describe the frame as it was last
 * laid out, which may be scaled or clamped for a smaller window. Everything
 * else (zoom, pan, on-screen position) is derived from those two facts, so the
 * helpers here are the only place that decides which numbers are trusted.
 */

export const CAPTURE_FRAME_VERSION = 2;

export interface WorldRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaptureFrameRecord {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  windowWidth?: number;
  windowHeight?: number;
  relativeLeft?: number;
  relativeTop?: number;
  relativeWidth?: number;
  relativeHeight?: number;
  baseWidth?: number;
  baseHeight?: number;
  baseWindowWidth?: number;
  baseWindowHeight?: number;
  worldRect?: WorldRectLike | null;
  /** Set once the record was written by the consistent model in this file. */
  frameVersion?: number;
  [key: string]: unknown;
}

export interface CaptureFrameSizeReference {
  width: number;
  height: number;
  windowWidth: number;
  windowHeight: number;
}

function positive(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Pixel-rounded frames cannot hold an aspect ratio exactly, so the tolerance
 * widens for small frames (one pixel of a 100px frame is already 1%).
 */
export function frameAspectsMatch(
  widthA: number,
  heightA: number,
  widthB: number,
  heightB: number
): boolean {
  if (!(widthA > 0 && heightA > 0 && widthB > 0 && heightB > 0)) return false;
  const aspectA = widthA / heightA;
  const aspectB = widthB / heightB;
  const smallestSide = Math.min(widthA, heightA, widthB, heightB);
  const tolerance = Math.max(0.015, 2 / Math.max(smallestSide, 1));
  return Math.abs(aspectA - aspectB) / aspectB <= tolerance;
}

export function hasCaptureFrameBase(frame: CaptureFrameRecord | null | undefined): boolean {
  return Boolean(
    frame &&
      positive(frame.baseWidth) &&
      positive(frame.baseHeight) &&
      positive(frame.baseWindowWidth) &&
      positive(frame.baseWindowHeight)
  );
}

/**
 * The base size is only meaningful while it has the same shape as the frame.
 * Older builds left it untouched when a frame was reshaped by its handles, so
 * a base with a different aspect ratio is stale and must not be used.
 */
export function isCaptureFrameBaseConsistent(
  frame: CaptureFrameRecord | null | undefined,
  width = positive(frame?.width),
  height = positive(frame?.height)
): boolean {
  if (!hasCaptureFrameBase(frame)) return false;
  if (!(width > 0 && height > 0)) return true;
  return frameAspectsMatch(positive(frame!.baseWidth), positive(frame!.baseHeight), width, height);
}

/** The size (and the window it belongs to) that proportional layout scales from. */
export function resolveCaptureFrameSizeReference(
  frame: CaptureFrameRecord | null | undefined
): CaptureFrameSizeReference | null {
  if (!frame || typeof frame !== 'object') return null;
  if (isCaptureFrameBaseConsistent(frame)) {
    return {
      width: positive(frame.baseWidth),
      height: positive(frame.baseHeight),
      windowWidth: positive(frame.baseWindowWidth),
      windowHeight: positive(frame.baseWindowHeight),
    };
  }
  const width = positive(frame.width);
  const height = positive(frame.height);
  if (!(width > 0 && height > 0)) return null;
  const fallbackWindowWidth = typeof window !== 'undefined' ? Math.max(window.innerWidth, 1) : 1;
  const fallbackWindowHeight = typeof window !== 'undefined' ? Math.max(window.innerHeight, 1) : 1;
  return {
    width,
    height,
    windowWidth: positive(frame.windowWidth) || fallbackWindowWidth,
    windowHeight: positive(frame.windowHeight) || fallbackWindowHeight,
  };
}

/**
 * Rebuild a stale or missing base from the frame as it was last laid out.
 * Safe to call repeatedly; a consistent record is returned unchanged.
 */
export function normalizeCaptureFrameBase<T extends CaptureFrameRecord | null | undefined>(
  frame: T
): T {
  if (!frame || typeof frame !== 'object') return frame;
  if (isCaptureFrameBaseConsistent(frame)) return frame;
  const reference = resolveCaptureFrameSizeReference(frame);
  if (!reference) return frame;
  return {
    ...frame,
    baseWidth: reference.width,
    baseHeight: reference.height,
    baseWindowWidth: reference.windowWidth,
    baseWindowHeight: reference.windowHeight,
  };
}

/**
 * Combine a freshly measured frame record with the stored one.
 *
 * Passive layout (window resize, revisiting an image, recentring) keeps the
 * authored base so a temporarily smaller frame can grow back. A deliberate
 * edit (`rebase`) or a change of shape makes the measured frame the new base.
 */
export function mergeCaptureFrameRecord(
  existing: CaptureFrameRecord | null | undefined,
  measured: CaptureFrameRecord,
  options: { rebase?: boolean } = {}
): CaptureFrameRecord {
  const previous = existing && typeof existing === 'object' ? existing : {};
  const keepBase =
    options.rebase !== true &&
    isCaptureFrameBaseConsistent(previous, positive(measured.width), positive(measured.height));
  return {
    ...previous,
    ...measured,
    baseWidth: keepBase ? previous.baseWidth : measured.width,
    baseHeight: keepBase ? previous.baseHeight : measured.height,
    baseWindowWidth: keepBase ? previous.baseWindowWidth : measured.windowWidth,
    baseWindowHeight: keepBase ? previous.baseWindowHeight : measured.windowHeight,
  };
}

/**
 * Two crops are "the same" when they differ by less than a rendering rounding
 * error. Keeping the stored crop in that case stops sub-pixel differences from
 * accumulating over many image switches.
 */
export function worldRectsMatch(
  a: WorldRectLike | null | undefined,
  b: WorldRectLike | null | undefined,
  relativeTolerance = 0.004
): boolean {
  if (!a || !b) return false;
  const tolerance = Math.max(
    0.75,
    Math.min(a.width, a.height, b.width, b.height) * relativeTolerance
  );
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}
