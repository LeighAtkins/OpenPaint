import { describe, expect, it } from 'vitest';
import {
  canvasToPhoto,
  fitBox,
  formatInchCm,
  overlayLines,
  readProjectLines,
  strokeCanvasPoints,
} from '../../src/modules/agent/agent-geometry';

const bg = {
  type: 'image',
  originX: 'center',
  originY: 'center',
  left: 640,
  top: 349,
  width: 961,
  height: 1280,
  scaleX: 0.5,
  scaleY: 0.5,
  angle: 0,
};

describe('agent geometry', () => {
  it('maps canvas points onto the photo', () => {
    expect(canvasToPhoto(bg, 640, 349)).toEqual({ x: 0.5, y: 0.5 });
    const corner = canvasToPhoto(bg, 640 - 961 / 4, 349 - 320);
    expect(corner?.x).toBeCloseTo(0);
    expect(corner?.y).toBeCloseTo(0);
  });

  it('reads the main line of a grouped arrow stroke', () => {
    const group = {
      type: 'group',
      left: 100,
      top: 50,
      angle: 0,
      scaleX: 1,
      scaleY: 1,
      objects: [
        { type: 'line', left: 0, top: 0, x1: -10, y1: 0, x2: 10, y2: 0 },
        { type: 'triangle', left: 10, top: 0 },
      ],
    };
    expect(strokeCanvasPoints(group)).toEqual([
      [90, 50],
      [110, 50],
    ]);
  });

  it('reads overlay lines with or without the mos prefix', () => {
    const svg =
      '<svg viewBox="0 0 1000 1000"><line id="mos12_mE6cm" class="mos-line" x1="213.32" y1="558.59" x2="520.29" y2="460.94" />' +
      '<line id="mL2cm" x1="0" y1="0" x2="1000" y2="500"/><circle id="mos3_x" cx="1" cy="1"/></svg>';
    const lines = overlayLines(svg);
    expect(lines.map(l => l.label)).toEqual(['E6', 'L2']);
    expect(lines[1].points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0.5 },
    ]);
  });

  it('collects lines and values per view', () => {
    const project = {
      viewOrder: ['front-2'],
      metadata: { imagePartLabels: { 'front-2': 'Corner, inside' } },
      views: {
        'front-2': {
          canvasJSON: { backgroundImage: bg },
          metadata: {
            strokeMeasurements: { 'front-2': { E6: { inch: 25.5, cm: 64.77 } } },
          },
        },
      },
      mosOverlays: {
        overlays: [
          {
            viewId: 'front-2',
            svgText: '<line id="mos1_mE6cm" x1="100" y1="200" x2="300" y2="400"/>',
          },
        ],
      },
    };
    const [view] = readProjectLines(project);
    expect(view.title).toBe('Corner, inside');
    expect(view.lines[0]).toMatchObject({
      label: 'E6',
      source: 'overlay',
      inch: 25.5,
      from: { x: 0.1, y: 0.2 },
      to: { x: 0.3, y: 0.4 },
    });
  });

  it('formats inches first with cm', () => {
    expect(formatInchCm(40.5)).toBe('40½" (102.9 cm)');
    expect(formatInchCm(2.125)).toBe('2⅛" (5.4 cm)');
    expect(formatInchCm(36)).toBe('36" (91.4 cm)');
    expect(formatInchCm(0.75)).toBe('¾" (1.9 cm)');
  });

  it('fits a crop around lines and keeps it on the photo', () => {
    const box = fitBox([
      { x: 0.9, y: 0.95 },
      { x: 0.95, y: 0.97 },
    ]);
    expect(box.x1).toBe(1);
    expect(box.y1).toBe(1);
    expect(box.x1 - box.x0).toBeCloseTo(0.35);
  });
});
