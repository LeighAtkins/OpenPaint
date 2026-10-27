import { describe, expect, it } from 'vitest';
import { sanitizeAndPrefixSvg } from '../../src/modules/measurement-mos/mos-sanitizer';

const svg = (id: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><line id="${id}" class="mos-line" x1="10" y1="10" x2="900" y2="10" stroke="#DF6868" stroke-width="4"/></svg>`;

describe('sanitizeAndPrefixSvg id prefixes', () => {
  it('prefixes a plain measurement id', () => {
    expect(sanitizeAndPrefixSvg(svg('mA1cm'), 30)).toContain('id="mos30_mA1cm"');
  });

  it('replaces the prefix saved in a project instead of stacking it', () => {
    const out = sanitizeAndPrefixSvg(svg('mos15_mA1cm'), 30);
    expect(out).toContain('id="mos30_mA1cm"');
    expect(out).not.toContain('mos15_');
  });

  it('collapses prefixes stacked by earlier reloads', () => {
    expect(sanitizeAndPrefixSvg(svg('mos30_mos15_mA1cm'), 31)).toContain('id="mos31_mA1cm"');
  });
});

describe('exportMosSvg curves', () => {
  it('keeps a curved measurement as a polyline when saving', async () => {
    const { exportMosSvg } = await import('../../src/modules/measurement-mos/mos-exporter');
    const curvePoints = [
      { x: 200, y: 640 },
      { x: 150, y: 520 },
      { x: 110, y: 560 },
      { x: 150, y: 600 },
    ];
    const element = {
      id: 'mos0_mE1cm',
      opId: 'mos0_mE1cm',
      kind: 'measureLine',
      roleToken: 'E1',
      endpoints: [{ point: curvePoints[0] }, { point: curvePoints[3] }],
      curvePoints,
      curveInterpolation: 'smooth',
    };
    const overlay = {
      id: 'o',
      viewId: 'front',
      overlayIndex: 0,
      svgText: '',
      elements: new Map([['e', element]]),
    };
    const svg = exportMosSvg(overlay as any, { left: 0, top: 0, width: 1000, height: 1000 });
    expect(svg).toContain('<polyline id="mos0_mE1cm" points="200,640 150,520 110,560 150,600"');
    expect(svg).toContain('data-curve-interpolation="smooth"');
  });
});
