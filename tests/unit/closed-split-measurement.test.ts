import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { ellipseStrokePoints, splitStrokePoints } from '../../src/modules/utils/split-stroke';
import { importMosSvg } from '../../src/modules/measurement-mos/mos-importer';
import { exportMosSvg } from '../../src/modules/measurement-mos/mos-exporter';
it('splits a complete ellipse into connected back and front halves', () => {
  const points = ellipseStrokePoints(269, 87.5);
  const [back, front] = splitStrokePoints(points, 0.5);
  expect(back[0].x).toBeCloseTo(-269);
  expect(back.at(-1)!.x).toBeCloseTo(269);
  expect(back.every(p => p.y < 0.0001)).toBe(true);
  expect(front.every(p => p.y > -0.0001)).toBe(true);
  expect(front.at(-1)!.x).toBeCloseTo(back[0].x);
  expect(front.at(-1)!.y).toBeCloseTo(back[0].y);
});
it('imports and saves D as one closed editable ellipse with its split settings', () => {
  const raw = readFileSync(
    'public/measurement-guides/Modular MT /Ottoman/Round Ottoman/Round Ottoman.svg',
    'utf8'
  );
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const group = doc.querySelector('g[id="mDcm"]')!;
  expect(group.querySelectorAll('ellipse')).toHaveLength(1);
  class Ellipse {
    constructor(options: object) {
      Object.assign(this, options);
    }
    on() {}
  }
  vi.stubGlobal('fabric', { Ellipse });
  const rect = { left: 0, top: 0, width: 729, height: 729 };
  try {
    const overlay = importMosSvg(
      `<svg viewBox="0 0 729 729">${new XMLSerializer().serializeToString(group)}</svg>`,
      0,
      'front',
      rect,
      { add() {} }
    );
    const d = [...overlay.elements.values()].find(e => e.kind === 'measureLine')!;
    expect(d.ellipse).toBe(true);
    expect(d.style?.splitRatio).toBe(0.5);
    const restored = importMosSvg(exportMosSvg(overlay, rect), 1, 'front', rect, { add() {} });
    const roundtrip = [...restored.elements.values()].find(e => e.kind === 'measureLine')!;
    expect(roundtrip.ellipse).toBe(true);
    expect(roundtrip.roleToken).toBe('D');
    expect(roundtrip.style?.splitRatio).toBe(0.5);
  } finally {
    vi.unstubAllGlobals();
  }
});
