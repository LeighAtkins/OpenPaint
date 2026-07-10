import {
  createCoordinateTransformer,
  parseSvgMeasurements,
} from '../../src/modules/ui/svg-measurement-parser.js';
import { readFileSync } from 'node:fs';

describe('svg measurement parser', () => {
  test('parses standalone guide lines', () => {
    const svgText = `
      <svg width="200" height="100" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
        <line id="mA1cm" x1="10" y1="20" x2="150" y2="20" />
        <circle id="cA1cm" cx="80" cy="20" r="5" />
        <rect id="bA1cm" x="70" y="10" width="30" height="20" />
      </svg>
    `;

    const parsed = parseSvgMeasurements(svgText);

    expect(parsed.totalMeasurements).toBe(1);
    expect(parsed.dimensions).toEqual({ minX: 0, minY: 0, width: 200, height: 100 });
    expect(parsed.measurements[0]).toMatchObject({
      label: 'Measurement 1',
    });
    expect(parsed.measurements[0].lines[0]).toMatchObject({
      kind: 'line',
      x1: 10,
      y1: 20,
      x2: 150,
      y2: 20,
    });
  });

  test('prefers explicit labels from tokenized guide groups', () => {
    const svgText = `
      <svg width="240" height="120" viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg">
        <g id="mwaistcm">
          <line x1="20" y1="40" x2="200" y2="40" />
        </g>
        <g id="cwaistcm">
          <text x="110" y="30">Waist</text>
        </g>
      </svg>
    `;

    const parsed = parseSvgMeasurements(svgText);

    expect(parsed.totalMeasurements).toBe(1);
    expect(parsed.measurements[0].label).toBe('Waist');
    expect(parsed.measurements[0].lines).toHaveLength(1);
  });

  test('keeps Illustrator-suffixed tokens and avoids tiny arrowhead connector stubs', () => {
    const svgText = `
      <svg width="361.2" height="313" viewBox="0 0 361.2 313" xmlns="http://www.w3.org/2000/svg">
        <style>
          .red{fill:none;stroke:#DE6969;stroke-width:2;}
          .arrow{fill:#DE6969;}
        </style>
        <g id="bC2cm">
          <polyline class="red" points="66.5,154.8 98.5,154.8 98.5,145.9" />
          <text>0000.00</text>
        </g>
        <g id="mC2cm">
          <line class="red" x1="103.6" y1="149.1" x2="93.4" y2="143.4" />
          <polygon class="arrow" points="104.4,145.5 107.9,151.5 101,151.6" />
        </g>
        <g id="cC2cm">
          <text>C2</text>
        </g>
        <g id="mA1cm_00000062882182865007628080000007963397885327792830_">
          <line class="red" x1="302.8" y1="108.7" x2="193.3" y2="45.5" />
        </g>
        <g id="cA1cm">
          <text>A1</text>
        </g>
      </svg>
    `;

    const parsed = parseSvgMeasurements(svgText);
    const c2 = parsed.measurements.find(measurement => measurement.label === 'C2');
    const a1 = parsed.measurements.find(measurement => measurement.label === 'A1');

    expect(a1).toBeTruthy();
    expect(c2).toBeTruthy();
    expect(c2.lines).toHaveLength(1);
    expect(c2.lines[0].kind).toBe('curve');
    expect(c2.lines[0].points.length).toBe(3);
    expect(c2.lines[0].points[0]).toEqual({ x: 66.5, y: 154.8 });
  });

  test('falls back to a document-wide same-colored segment when no b/c companion exists', () => {
    // Mimics cloud-exported guides that ship only an m-group (with a tiny
    // arrowhead stub) and a c-label, but no b-group leader line. The parser
    // must still resolve the real measurement from elsewhere in the document
    // so the tag does not anchor on the stub near a corner.
    const svgText = `
      <svg width="360" height="320" viewBox="0 0 360 320" xmlns="http://www.w3.org/2000/svg">
        <style>.red{fill:none;stroke:#DE6969;stroke-width:2;}.arrow{fill:#DE6969;}</style>
        <!-- The real C2 measurement lives as a loose polyline elsewhere -->
        <polyline class="red" points="60,160 280,160 280,90" />
        <!-- mC2 only carries the arrowhead triangle as a short stub -->
        <g id="mC2cm">
          <line class="red" x1="280" y1="90" x2="272.4" y2="98.2" />
          <polygon class="arrow" points="279,88 286,91 282,98" />
        </g>
        <g id="cC2cm"><text>C2</text></g>
      </svg>
    `;

    const parsed = parseSvgMeasurements(svgText);
    const c2 = parsed.measurements.find(m => m.label === 'C2');

    expect(c2).toBeTruthy();
    expect(c2.lines).toHaveLength(1);
    // The resolved line should be the long polyline, not the 11px stub.
    expect(c2.lines[0].kind).toBe('curve');
    expect(c2.lines[0].points.length).toBe(3);
    expect(c2.lines[0].points[0]).toEqual({ x: 60, y: 160 });
  });

  test('parses simple relative SVG paths without relying on browser path length APIs', () => {
    const svgText = `
      <svg width="400" height="240" viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">
        <g id="mL1cm">
          <path d="M320.1,103.3l-130,74.4" />
        </g>
        <g id="cL1cm">
          <text>L1</text>
        </g>
      </svg>
    `;

    const parsed = parseSvgMeasurements(svgText);

    expect(parsed.measurements).toHaveLength(1);
    expect(parsed.measurements[0].label).toBe('L1');
    const line = parsed.measurements[0].lines[0];
    expect(line.kind).toBe('curve');
    expect(line.x1).toBeCloseTo(320.1);
    expect(line.y1).toBeCloseTo(103.3);
    expect(line.x2).toBeCloseTo(190.1);
    expect(line.y2).toBeCloseTo(177.7);
  });

  test('creates an aspect-ratio-preserving coordinate transformer', () => {
    const transform = createCoordinateTransformer(
      {
        minX: 10,
        minY: 20,
        width: 200,
        height: 100,
        viewBox: { x: 10, y: 20, width: 200, height: 100 },
      },
      { width: 400, height: 400 },
      {
        width: 400,
        height: 400,
        scaleX: 1,
        scaleY: 1,
        left: 200,
        top: 200,
      }
    );

    expect(transform(10, 20)).toEqual({ x: 0, y: 0 });
    expect(transform(210, 120)).toEqual({ x: 400, y: 400 });
    expect(transform(110, 70)).toEqual({ x: 200, y: 200 });
  });

  test('parses ungrouped Illustrator round-back arm guide labels', () => {
    const cases = [
      {
        file: 'public/measurement-guides/Modular MT /Back Shape/Round Back, Round Arm/Archive/Back-CS1X-RA-RB.svg',
        labels: ['A1', 'A5', 'A2'],
      },
      {
        file: 'public/measurement-guides/Modular MT /Back Shape/Round Back, Round Arm/Archive/Back-CS3X-RA-RB.svg',
        labels: ['A1', 'A4', 'A5', 'A2'],
      },
    ];

    cases.forEach(({ file, labels }) => {
      const parsed = parseSvgMeasurements(readFileSync(file, 'utf8'));

      expect(parsed.measurements.map(measurement => measurement.label)).toEqual(labels);
      parsed.measurements.forEach(measurement => {
        expect(measurement.lines).toHaveLength(1);
        expect(measurement.lines[0].points.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
