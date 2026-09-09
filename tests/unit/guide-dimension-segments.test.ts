import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { importMosSvg } from '../../src/modules/measurement-mos/mos-importer';
import { sanitizeAndPrefixSvg } from '../../src/modules/measurement-mos/mos-sanitizer';
import {
  stripSvgLabels,
  stripNonMeasurementElements,
} from '../../src/modules/ui/measurement-guide-flash.js';
import { MeasurementOverlayManager } from '../../src/modules/measurement-mos/MeasurementOverlayManager';
import { splitStrokePoints } from '../../src/modules/utils/split-stroke';
vi.mock('../../src/modules/utils/FabricControls.js', () => ({
  FabricControls: { createArrowControls() {}, createCurveControls() {} },
}));
class Primitive {
  customData: any;
  constructor(
    public data: any,
    options = {}
  ) {
    Object.assign(this, options);
  }
  set(values: object) {
    Object.assign(this, values);
  }
  on() {}
  setCoords() {}
}
const load = (code: string, view = 'front') =>
  readFileSync(`tests/fixtures/measurement-guides/${code}-${view}.svg`, 'utf8');
const parse = (code: string, view = 'front') => {
  vi.stubGlobal('fabric', {
    Line: Primitive,
    Triangle: Primitive,
    Group: Primitive,
    Path: Primitive,
  });
  const objects: any[] = [];
  const overlay = importMosSvg(
    sanitizeAndPrefixSvg(stripNonMeasurementElements(load(code, view)), 1),
    1,
    'front',
    { left: 0, top: 0, width: 1000, height: 1000 } as any,
    {
      add(obj: any) {
        objects.push(obj);
      },
    }
  );
  vi.unstubAllGlobals();
  return { overlay, objects };
};
describe('Source guide dimension details', () => {
  it.each(['CS4-SSA-HB-R', 'CS4-SSA-HB-L', 'CS4-SSA-SB-R', 'CS4-SSA-SB-L'])(
    'retains %s dotted construction lines',
    code => {
      const clean = stripSvgLabels(load(code));
      const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
      expect(doc.querySelectorAll('.st0').length).toBeGreaterThan(0);
    }
  );
  it.each(['CS3B-SRA-HB-R', 'CS3B-SRA-HB-L', 'CS3B-SRA-SB-R', 'CS3B-SRA-SB-L'])(
    'imports %s dimension extensions',
    code => {
      const { overlay } = parse(code);
      const c3 = [...overlay.elements.values()].filter(
        e => e.kind === 'measureLine' && e.roleToken === (code === 'CS3B-SRA-SB-R' ? 'C4' : 'C3')
      );
      expect(c3).toHaveLength(3);
      expect(c3.filter(e => e.style?.strokeDashArray?.length)).toHaveLength(2);
    }
  );
  it('retains every bend in the WA2 E1 arm measurement', () => {
    const { overlay, objects } = parse('CS3B-WA2-HB');
    const e1 = [...overlay.elements.values()].find(
      e => e.kind === 'measureLine' && e.roleToken === 'E1'
    )!;
    expect(e1.curvePoints).toHaveLength(5);
    expect(e1.curveInterpolation).toBe('linear');
    const path = objects.find(o => o.__mosId === `${e1.id}_line`);
    expect(path.data).toContain(' L ');
    expect(path.data).not.toContain(' C ');
  });
  it('splits vertical and bent dimensions by length in either direction', () => {
    expect(
      splitStrokePoints(
        [
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ],
        0.25
      )[0].at(-1)
    ).toEqual({ x: 0, y: 75 });
    const split = splitStrokePoints(
      [
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 60, y: 40 },
      ],
      0.5
    );
    expect(split[0].at(-1)).toEqual({ x: 10, y: 40 });
    expect(split[1][0]).toEqual({ x: 10, y: 40 });
  });
});

it('aligns CS4-SSA-HB-R side tags to the source circles and retains both E1 dimensions', () => {
  const { overlay } = parse('CS4-SSA-HB-R', 'side');
  const manager = Object.create(MeasurementOverlayManager.prototype) as any;
  const anchors = manager._collectRoleAnchors(overlay);
  // Source E1 circle is (484.4, 88.4), not its value box at (506.16, 61.62).
  expect(anchors.get('E1').x).toBeCloseTo((484.4 / 637.5) * 1000);
  expect(anchors.get('E1').y).toBeCloseTo((88.4 / 439) * 1000);
  expect(anchors.get('E4').x).toBeCloseTo((441.8 / 637.5) * 1000);
  expect(anchors.get('E4').y).toBeCloseTo((107 / 439) * 1000);
  const repeated = [...overlay.elements.values()].filter(
    e => e.kind === 'measureLine' && (e.roleToken === 'E1' || e.displayLabel === 'E1')
  );
  expect(anchors.get('E1-2').x).toBeCloseTo((220 / 637.5) * 1000);
  expect(anchors.get('E1-2').y).toBeCloseTo((304.5 / 439) * 1000);
  expect(new Set(repeated.map(e => e.roleToken)).size).toBe(2);
  expect(repeated).toHaveLength(2);
  expect(repeated[0].endpoints).not.toEqual(repeated[1].endpoints);
});
