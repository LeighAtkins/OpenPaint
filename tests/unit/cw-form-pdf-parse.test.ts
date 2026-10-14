import { describe, it, expect } from 'vitest';
import {
  analyzeCwFormPage,
  detectUnit,
  parseNumericValue,
  type CwPageData,
  type CwPoint,
  type CwStroke,
  type CwTextItem,
} from '../../src/modules/cw-form-pdf/parse-cw-form';
import { measurementInput } from '../../src/modules/ui/cw-form-pdf-import';

const RED = '#de6969';
const TEAL = '#52cfbd';
const GREY = '#4d4d4d';

function bbox(points: CwPoint[]) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function line(x1: number, y1: number, x2: number, y2: number, color = RED): CwStroke {
  const points = [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ];
  return { points, color, closed: false, curved: false, bbox: bbox(points) };
}

function rectOutline(x0: number, y0: number, x1: number, y1: number): CwStroke {
  const points = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
  return { points, color: GREY, closed: true, curved: false, bbox: bbox(points) };
}

/** A 20pt circle; pass label '' to model glyphs drawn as outlines. */
function circle(label: string, cx: number, cy: number, color = RED) {
  const points = Array.from({ length: 17 }, (_, i) => ({
    x: cx + 10 * Math.cos((i / 16) * Math.PI * 2),
    y: cy + 10 * Math.sin((i / 16) * Math.PI * 2),
  }));
  const stroke: CwStroke = { points, color, closed: true, curved: true, bbox: bbox(points) };
  const text: CwTextItem[] = label
    ? [{ str: label, rect: { x0: cx - 4, y0: cy - 5, x1: cx + 4, y1: cy + 5 } }]
    : [];
  return { stroke, text };
}

function tableRow(label: string, value: string, x: number, y: number) {
  return {
    text: { str: label, rect: { x0: x - 25, y0: y + 3, x1: x - 15, y1: y + 13 } },
    field: { name: `f-${label}-${x}-${y}`, value, rect: { x0: x, y0: y, x1: x + 50, y1: y + 16 } },
  };
}

function page(parts: {
  strokes: CwStroke[];
  texts: CwTextItem[];
  rows: ReturnType<typeof tableRow>[];
}): CwPageData {
  return {
    pageNumber: 2,
    width: 612,
    height: 792,
    strokes: parts.strokes,
    texts: [
      ...parts.texts,
      ...parts.rows.map(r => r.text),
      { str: 'All measurements in CM', rect: { x0: 300, y0: 600, x1: 420, y1: 610 } },
    ],
    fields: parts.rows.map(r => r.field),
  };
}

describe('CW form PDF parser', () => {
  it('resolves labels on their line and labels joined by a stem', () => {
    const a1 = circle('A1', 150, 100);
    const b1 = circle('B1', 300, 60, TEAL);
    const data = page({
      strokes: [
        rectOutline(80, 80, 420, 260),
        a1.stroke,
        line(100, 100, 200, 100), // A1 sits on its own line
        b1.stroke,
        line(300, 70, 300, 90, TEAL), // stem
        line(250, 90, 380, 90, TEAL), // B1 line
      ],
      texts: [...a1.text, ...b1.text],
      rows: [tableRow('A1', '96.52', 100, 650), tableRow('B1', '167.64', 100, 670)],
    });

    const [view] = analyzeCwFormPage(data);
    expect(view.unit).toBe('cm');
    expect(view.measurements.map(m => [m.label, m.value])).toEqual([
      ['A1', 96.52],
      ['B1', 167.64],
    ]);
    const b1Line = view.measurements.find(m => m.label === 'B1')!;
    expect(b1Line.points).toEqual([
      { x: 250, y: 90 },
      { x: 380, y: 90 },
    ]);
    expect(view.maskStems).toHaveLength(1);
    // The crop keeps the diagram and drops the value table.
    expect(view.crop.y1).toBeLessThan(650);
  });

  it('picks the diagram level with the table when letters repeat', () => {
    const upperA = circle('A', 120, 120);
    const lowerA = circle('A', 120, 320);
    const data = page({
      strokes: [
        rectOutline(60, 130, 200, 220),
        upperA.stroke,
        line(60, 120, 200, 120),
        rectOutline(60, 330, 200, 420),
        lowerA.stroke,
        line(60, 320, 200, 320),
      ],
      texts: [...upperA.text, ...lowerA.text],
      rows: [tableRow('A', '214.63', 300, 360)],
    });

    const [view] = analyzeCwFormPage(data);
    expect(view.measurements[0].points[0].y).toBe(320);
  });

  it('pairs an outlined label ("F∗") with the diagram’s unlabelled circle', () => {
    const upperF = circle('F', 60, 120);
    const lowerA = circle('A', 120, 320);
    const lowerF = circle('', 60, 380);
    const data = page({
      strokes: [
        rectOutline(70, 130, 200, 220),
        upperF.stroke,
        line(40, 140, 40, 200),
        rectOutline(70, 330, 200, 420),
        lowerA.stroke,
        line(70, 320, 200, 320),
        lowerF.stroke,
        line(48, 390, 48, 420),
      ],
      texts: [...upperF.text, ...lowerA.text],
      rows: [tableRow('A', '214.63', 300, 350), tableRow('F∗', '173.99', 300, 370)],
    });

    const [view] = analyzeCwFormPage(data);
    const f = view.measurements.find(m => m.label === 'F')!;
    expect(f.points[0]).toEqual({ x: 48, y: 390 });
  });

  it('splits TYPE 1 / TYPE 2 columns that reuse labels into separate views', () => {
    const a = circle('A', 120, 120);
    const data = page({
      strokes: [rectOutline(60, 130, 200, 220), a.stroke, line(60, 120, 200, 120)],
      texts: a.text,
      rows: [
        tableRow('A', '100', 300, 150),
        {
          ...tableRow('A', '80', 300, 150),
          field: { name: 'type2', value: '80', rect: { x0: 360, y0: 150, x1: 410, y1: 166 } },
        },
      ],
    });
    const views = analyzeCwFormPage(data);
    expect(views.map(v => v.measurements.map(m => m.value))).toEqual([[100], [80]]);
  });

  it('reports values with no diagram line instead of guessing', () => {
    const data = page({
      strokes: [rectOutline(60, 130, 200, 220)],
      texts: [],
      rows: [tableRow('Z9', '12', 300, 150)],
    });
    const [view] = analyzeCwFormPage(data);
    expect(view.measurements).toEqual([]);
    expect(view.unplaced).toEqual([{ label: 'Z9', value: 12 }]);
  });
});

describe('CW form values and units', () => {
  it('reads the stated unit', () => {
    const text = (str: string): CwTextItem => ({ str, rect: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    expect(detectUnit([text('All measurements in CM')])).toEqual({ unit: 'cm', assumed: false });
    expect(detectUnit([text('All dimensions in INCHES.')])).toEqual({
      unit: 'inch',
      assumed: false,
    });
    expect(detectUnit([text('Sofa frame')])).toEqual({ unit: 'cm', assumed: true });
  });

  it('parses numeric field values only', () => {
    expect(parseNumericValue('104.78')).toBe(104.78);
    expect(parseNumericValue('48,9')).toBe(48.9);
    expect(parseNumericValue('1/2')).toBeNull();
    expect(parseNumericValue('n/a')).toBeNull();
  });

  it('stores cm values converted from clean inches as inches', () => {
    expect(measurementInput(104.78, 'cm')).toBe('41.25 in');
    expect(measurementInput(48.9, 'cm')).toBe('19.25 in');
    expect(measurementInput(100, 'cm')).toBe('100cm');
    expect(measurementInput(25, 'inch')).toBe('25 in');
  });
});
