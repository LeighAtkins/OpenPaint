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
