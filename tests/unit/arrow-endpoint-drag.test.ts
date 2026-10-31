import { describe, expect, it } from 'vitest';
import { fabric } from 'fabric';
import { FabricControls } from '../../src/modules/utils/FabricControls.js';

function endpoints(line: any) {
  const p = line.calcLinePoints();
  const matrix = line.calcTransformMatrix();
  return [
    fabric.util.transformPoint(new fabric.Point(p.x1, p.y1), matrix),
    fabric.util.transformPoint(new fabric.Point(p.x2, p.y2), matrix),
  ];
}

describe('arrow endpoint dragging', () => {
  it('keeps the opposite endpoint fixed after moving the group and alternating repeated endpoint edits', () => {
    (globalThis as any).fabric = fabric;
    const line = new fabric.Line([100, 100, 250, 180], { originX: 'center', originY: 'center' });
    const head = new fabric.Triangle({
      left: 250,
      top: 180,
      width: 10,
      height: 10,
      originX: 'center',
      originY: 'center',
    });
    const tail = new fabric.Triangle({
      left: 100,
      top: 100,
      width: 10,
      height: 10,
      originX: 'center',
      originY: 'center',
    });
    const group = new fabric.Group([line, head, tail]);
    group.set({ left: group.left! + 75, top: group.top! + 40 });
    (group as any).canvas = {
      viewportTransform: [1, 0, 0, 1, 0, 0],
      getPointer: (event: any) => event.point,
    };
    FabricControls.createArrowControls(group);
    const original = endpoints(line);
    const drag = (control: string, x: number, y: number) =>
      group.controls[control].actionHandler!(
        { point: { x, y } } as any,
        { target: group } as any,
        x,
        y
      );
    drag('p2', 450, 310);
    let p = endpoints(line);
    expect(p[0].x).toBeCloseTo(original[0].x);
    expect(p[0].y).toBeCloseTo(original[0].y);
    expect(p[1].x).toBeCloseTo(450);
    expect(p[1].y).toBeCloseTo(310);
    drag('p1', 190, 160);
    p = endpoints(line);
    expect(p[0].x).toBeCloseTo(190);
    expect(p[0].y).toBeCloseTo(160);
    expect(p[1].x).toBeCloseTo(450);
    expect(p[1].y).toBeCloseTo(310);
    drag('p2', 510, 360);
    p = endpoints(line);
    expect(p[0].x).toBeCloseTo(190);
    expect(p[0].y).toBeCloseTo(160);
    expect(p[1].x).toBeCloseTo(510);
    expect(p[1].y).toBeCloseTo(360);
  });
});
