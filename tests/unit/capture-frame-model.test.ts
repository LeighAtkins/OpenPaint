import { describe, expect, it } from 'vitest';
import {
  frameAspectsMatch,
  isCaptureFrameBaseConsistent,
  mergeCaptureFrameRecord,
  normalizeCaptureFrameBase,
  resolveCaptureFrameSizeReference,
  worldRectsMatch,
} from '../../src/modules/utils/captureFrameModel';

const measured = (width: number, height: number, windowWidth = 1280, windowHeight = 800) => ({
  left: 100,
  top: 100,
  width,
  height,
  windowWidth,
  windowHeight,
  baseWidth: width,
  baseHeight: height,
  baseWindowWidth: windowWidth,
  baseWindowHeight: windowHeight,
});

describe('capture frame size model', () => {
  it('uses the authored base size as the proportional reference', () => {
    const frame = {
      ...measured(640, 480, 1024, 700),
      baseWidth: 800,
      baseHeight: 600,
      baseWindowWidth: 1280,
      baseWindowHeight: 800,
    };
    expect(resolveCaptureFrameSizeReference(frame)).toEqual({
      width: 800,
      height: 600,
      windowWidth: 1280,
      windowHeight: 800,
    });
  });

  it('ignores a base whose shape no longer matches the frame', () => {
    // Older builds left the base untouched when a frame was reshaped by its handles.
    const frame = { ...measured(1018, 320), baseWidth: 1083, baseHeight: 487 };
    expect(isCaptureFrameBaseConsistent(frame)).toBe(false);
    expect(resolveCaptureFrameSizeReference(frame)).toEqual({
      width: 1018,
      height: 320,
      windowWidth: 1280,
      windowHeight: 800,
    });
    expect(normalizeCaptureFrameBase(frame)).toMatchObject({
      baseWidth: 1018,
      baseHeight: 320,
      baseWindowWidth: 1280,
      baseWindowHeight: 800,
    });
  });

  it('leaves a consistent record untouched when normalising', () => {
    const frame = { ...measured(794, 596), baseWidth: 845, baseHeight: 634 };
    expect(normalizeCaptureFrameBase(frame)).toBe(frame);
  });

  it('falls back to the laid-out frame when no base was ever stored', () => {
    expect(
      resolveCaptureFrameSizeReference({
        width: 600,
        height: 450,
        windowWidth: 1440,
        windowHeight: 900,
      })
    ).toEqual({ width: 600, height: 450, windowWidth: 1440, windowHeight: 900 });
    expect(resolveCaptureFrameSizeReference(null)).toBeNull();
    expect(resolveCaptureFrameSizeReference({ width: 0, height: 0 })).toBeNull();
  });

  it('keeps the base through passive layout so a shrunken frame can grow back', () => {
    const authored = measured(800, 600, 1280, 800);
    const shrunk = mergeCaptureFrameRecord(authored, measured(640, 480, 1024, 700));
    expect(shrunk).toMatchObject({
      width: 640,
      height: 480,
      windowWidth: 1024,
      baseWidth: 800,
      baseHeight: 600,
      baseWindowWidth: 1280,
      baseWindowHeight: 800,
    });
  });

  it('adopts the measured frame as the new base after a deliberate edit', () => {
    const authored = measured(800, 600);
    expect(mergeCaptureFrameRecord(authored, measured(880, 660), { rebase: true })).toMatchObject({
      baseWidth: 880,
      baseHeight: 660,
    });
    // A change of shape is always an edit, even without the explicit flag.
    expect(mergeCaptureFrameRecord(authored, measured(800, 300))).toMatchObject({
      baseWidth: 800,
      baseHeight: 300,
    });
  });

  it('preserves unrelated fields such as the crop when merging', () => {
    const worldRect = { left: 10, top: 20, width: 300, height: 200 };
    const merged = mergeCaptureFrameRecord(
      { ...measured(800, 600), worldRect },
      measured(640, 480)
    );
    expect(merged.worldRect).toBe(worldRect);
  });

  it('tolerates pixel rounding when comparing shapes', () => {
    expect(frameAspectsMatch(794, 596, 845, 634)).toBe(true);
    expect(frameAspectsMatch(100, 81, 800, 640)).toBe(true);
    expect(frameAspectsMatch(1018, 320, 1083, 487)).toBe(false);
    expect(frameAspectsMatch(0, 100, 100, 100)).toBe(false);
  });

  it('treats crops within a rendering rounding error as the same crop', () => {
    const crop = { left: 243.5, top: 30, width: 794, height: 596 };
    expect(worldRectsMatch(crop, { ...crop, left: 244, width: 793.4 })).toBe(true);
    expect(worldRectsMatch(crop, { ...crop, width: 845 })).toBe(false);
    expect(worldRectsMatch(crop, null)).toBe(false);
  });
});
