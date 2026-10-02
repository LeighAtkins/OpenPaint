import { describe, expect, it } from 'vitest';
import { straightArrowGeometry } from '../../src/modules/measurement-search/geometry';

describe('straight measurement arrows', () => {
  it('centers both heads on a horizontal line and stops the shaft at their bases', () => {
    const result = straightArrowGeometry({ x: 10, y: 20 }, { x: 110, y: 20 }, 12, 10);
    expect(result.startHead[0]).toEqual({ x: 10, y: 20 });
    expect(result.endHead[0]).toEqual({ x: 110, y: 20 });
    expect(result.shaftStart).toEqual({ x: 22, y: 20 });
    expect(result.shaftEnd).toEqual({ x: 98, y: 20 });
    expect(result.startHead.slice(1).map(point => point.y)).toEqual([15, 25]);
    expect(result.endHead.slice(1).map(point => point.y)).toEqual([25, 15]);
  });

  it('keeps diagonal head bases perpendicular and scales them down for short lines', () => {
    const result = straightArrowGeometry({ x: 0, y: 0 }, { x: 30, y: 40 }, 20, 15);
    const midpoint = (points: Array<{ x: number; y: number }>) => ({
      x: (points[1].x + points[2].x) / 2,
      y: (points[1].y + points[2].y) / 2,
    });
    expect(midpoint(result.startHead).x).toBeCloseTo(result.shaftStart.x);
    expect(midpoint(result.startHead).y).toBeCloseTo(result.shaftStart.y);
    expect(midpoint(result.endHead).x).toBeCloseTo(result.shaftEnd.x);
    expect(midpoint(result.endHead).y).toBeCloseTo(result.shaftEnd.y);
    expect(result.shaftStart.x).toBeLessThan(result.shaftEnd.x);
    expect(result.shaftStart.y).toBeLessThan(result.shaftEnd.y);
  });
});
