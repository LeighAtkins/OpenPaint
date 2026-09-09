import { describe, expect, it } from 'vitest';
import { detectCwPatternLines } from '../../src/modules/measurement-mos/cw-pattern-lines';

describe('experimental CW pattern line detection', () => {
  it('finds an interior line without assigning any measurement values', () => {
    const width = 240;
    const height = 160;
    const pixels = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const black = y >= 78 && y <= 80 && x >= 20 && x <= 220;
        pixels.set(black ? [0, 0, 0] : [255, 132, 58], (y * width + x) * 3);
      }
    }
    const lines = detectCwPatternLines(pixels, width, height);
    expect(lines.length).toBeGreaterThan(0);
    expect(Math.abs(lines[0].y1 - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(lines[0].y2 - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(lines[0].x2 - lines[0].x1)).toBeGreaterThan(0.7);
    expect(lines[0]).not.toHaveProperty('value');
  });

  it('does not invent lines on a blank image or malformed buffer', () => {
    expect(detectCwPatternLines(new Uint8Array(240 * 160 * 3).fill(255), 240, 160)).toEqual([]);
    expect(detectCwPatternLines(new Uint8Array(2), 240, 160)).toEqual([]);
  });
});
