import { describe, expect, it } from 'vitest';
import { updateElementFromFabric } from '../../src/modules/measurement-mos/mos-edit-controls';

describe('imported measurement edit persistence', () => {
  it('preserves two transformed arrow endpoints when remounting onto a different image frame', async () => {
    const { mosToCanvas } = await import('../../src/modules/measurement-mos/mos-transform');
    (globalThis as any).fabric = {
      util: {
        transformPoint: (p: any, m: number[]) => ({
          x: m[0] * p.x + m[2] * p.y + m[4],
          y: m[1] * p.x + m[3] * p.y + m[5],
        }),
      },
    };
    const child = {
      type: 'line',
      calcLinePoints: () => ({ x1: -50, y1: 0, x2: 50, y2: 0 }),
      calcTransformMatrix: () => [0, 2, -1, 0, 300, 250],
    };
    const group = {
      type: 'group',
      __mosId: 'arrow',
      left: 300,
      top: 250,
      getObjects: () => [child],
    };
    const element: any = {
      endpoints: [
        { point: { x: 0, y: 0 }, fabricObjectId: 'arrow' },
        { point: { x: 0, y: 0 }, fabricObjectId: 'arrow' },
      ],
    };
    updateElementFromFabric(
      element,
      { getObjects: () => [group] },
      { left: 100, top: 50, width: 400, height: 400 }
    );
    expect(element.endpoints.map((e: any) => e.point)).toEqual([
      { x: 500, y: 250 },
      { x: 500, y: 750 },
    ]);
    const remounted = element.endpoints.map((e: any) =>
      mosToCanvas(e.point, { left: 20, top: 30, width: 800, height: 600 })
    );
    expect(remounted).toEqual([
      { x: 420, y: 180 },
      { x: 420, y: 480 },
    ]);
    // Switching back must recover the edited endpoints, not the arrow centre.
    expect(
      element.endpoints.map((e: any) =>
        mosToCanvas(e.point, { left: 100, top: 50, width: 400, height: 400 })
      )
    ).toEqual([
      { x: 300, y: 150 },
      { x: 300, y: 350 },
    ]);
  });
  it('keeps edited curve control points instead of replacing endpoints with the path centre', () => {
    const obj = {
      type: 'path',
      __mosId: 'curve',
      left: 999,
      top: 999,
      customPoints: [
        { x: 100, y: 100 },
        { x: 200, y: 150 },
        { x: 300, y: 100 },
      ],
    };
    const element: any = { endpoints: [{ fabricObjectId: 'curve' }, { fabricObjectId: 'curve' }] };
    updateElementFromFabric(
      element,
      { getObjects: () => [obj] },
      { left: 0, top: 0, width: 400, height: 200 }
    );
    expect(element.curvePoints).toEqual([
      { x: 250, y: 500 },
      { x: 500, y: 750 },
      { x: 750, y: 500 },
    ]);
    expect(element.endpoints.map((e: any) => e.point)).toEqual([
      { x: 250, y: 500 },
      { x: 750, y: 500 },
    ]);
  });
});
