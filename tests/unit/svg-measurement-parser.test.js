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
