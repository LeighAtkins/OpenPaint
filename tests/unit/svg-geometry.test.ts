import { describe, expect, it } from 'vitest';
import {
  getSvgElementTransform,
  parseSvgTransform,
  transformSvgPoint,
} from '../../src/modules/measurement-mos/svg-geometry';
import { importMosSvg } from '../../src/modules/measurement-mos/mos-importer';

describe('Illustrator SVG coordinates', () => {
  it('composes nested translation, reflection and scaling in SVG order', () => {
    const doc = new DOMParser().parseFromString(
      '<svg><g transform="translate(100 20)"><g transform="scale(-2 3)"><text transform="matrix(1 0 0 1 10 5)" x="4" y="2">A1</text></g></g></svg>',
      'image/svg+xml'
    );
    const matrix = getSvgElementTransform(doc.querySelector('text')!);
    expect(transformSvgPoint(matrix, 4, 2)).toEqual({ x: 72, y: 41 });
  });
  it('handles Illustrator numeric syntax and rotation about a pivot', () => {
    expect(transformSvgPoint(parseSvgTransform('translate(1e2,-.5) scale(2)'), 2, 3)).toEqual({
      x: 104,
      y: 5.5,
    });
    const p = transformSvgPoint(parseSvgTransform('rotate(90 10 20)'), 20, 20);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(30);
  });
  it('stores transformed text anchors in normalized overlay coordinates', () => {
    const overlay = importMosSvg(
      '<svg viewBox="10 20 200 100"><g transform="translate(30 40)"><g id="mos1_cA1cm"><text transform="scale(2)" x="5" y="6">A1</text></g></g></svg>',
      1,
      'front',
      { left: 0, top: 0, width: 1000, height: 500 } as any,
      { add() {} }
    );
    const label = [...overlay.elements.values()].find(el => el.label)!;
    expect(label.label).toMatchObject({ text: 'A1', cx: 150, cy: 320 });
    expect(label.roleToken).toBe('A1');
  });
});

it('imports flat Illustrator measurements as editable semantic strokes', async () => {
  const { vi } = await import('vitest');
  const { FabricControls } = await import('../../src/modules/utils/FabricControls.js');
  vi.spyOn(FabricControls, 'createArrowControls').mockImplementation(() => {});
  class Primitive {
    constructor(
      public data: unknown,
      options = {}
    ) {
      Object.assign(this, options);
    }
    set(values: object) {
      Object.assign(this, values);
    }
  }
  vi.stubGlobal('fabric', { Line: Primitive, Triangle: Primitive, Group: Primitive });
  try {
    const overlay = importMosSvg(
      `<svg viewBox="0 0 300 300"><style>.m{stroke:#DF6868;fill:none}</style>
      <g transform="translate(10 20)"><line class="m" x1="20" y1="50" x2="200" y2="50"/>
      <text x="100" y="45">A1</text><line class="m" x1="20" y1="150" x2="200" y2="150"/>
      <text x="100" y="145">B1</text></g></svg>`,
      2,
      'front',
      { left: 0, top: 0, width: 300, height: 300 } as any,
      { add() {} }
    );
    const lines = [...overlay.elements.values()].filter(el => el.kind === 'measureLine');
    expect(lines.map(el => el.roleToken)).toEqual(['A1', 'B1']);
    expect(lines[0].endpoints[0].point.x).toBeCloseTo(100);
    expect(lines[0].endpoints[0].point.y).toBeCloseTo(700 / 3);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
