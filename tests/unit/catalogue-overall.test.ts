import { describe, expect, it } from 'vitest';
import {
  dimensionLabel,
  dimensionValue,
  parseOverallPlacement,
  layoutOverallPlacement,
  overallPhotoPadding,
  renderOverallSvg,
} from '../../src/modules/catalogue/overall-dimensions';
import {
  coverComponents,
  selectCatalogueStyle,
} from '../../src/modules/catalogue/product-selection';
import { cataloguePhotoUrl } from '../../server/vercel-routes/cw/catalogue-overall';
const spans = ['width', 'depth', 'height'].map(key => ({
  key,
  start: { x: 0.1, y: 0.2 },
  end: { x: 0.8, y: 0.8 },
  offset: { x: 0, y: 0.1 },
  evidence: 'Physical outside edges',
}));
const geometry = () => JSON.parse(JSON.stringify({ spans, omissions: [] }));
describe('Overall catalogue dimensions', () => {
  it('keeps source unit precision and converts only explicitly labelled values', () => {
    expect(dimensionLabel({ width: { cm: 280, in: 110.24 } }, 'width', 'in')).toBe(
      'Width · 110.24 in'
    );
    expect(dimensionValue({ depth: { cm: 157 } }, 'depth', 'in')).toBe(61.81);
    expect(dimensionValue({ height: { in: 31.5 } }, 'height', 'cm')).toBe(80.01);
    for (const raw of [
      49,
      '49',
      { value: 49 },
      { cm: null },
      { cm: '' },
      { cm: Infinity },
      { cm: -1 },
    ])
      expect(dimensionValue({ width: raw }, 'width', 'cm')).toBeNull();
  });
  it('rejects invented, duplicate, missing and invalid axes', () => {
    for (const bad of [
      null,
      { spans: spans.slice(1), omissions: [] },
      { spans: [spans[0], spans[0], spans[2]], omissions: [] },
      { spans: [...spans.slice(0, 2), { ...spans[2], key: 'C1' }], omissions: [] },
      { spans: [...spans.slice(0, 2), { ...spans[2], start: { x: 2, y: 1 } }], omissions: [] },
    ])
      expect(() => parseOverallPlacement(bad)).toThrow();
    expect(
      parseOverallPlacement({
        spans: spans.slice(0, 2),
        omissions: [{ key: 'height', reason: 'Top cropped' }],
      }).omissions
    ).toHaveLength(1);
  });
  it('renders semantic source labels without exposing model HTML or changing geometry on unit switch', () => {
    const p = geometry();
    p.spans[0].evidence = '<script>bad</script>';
    const cm = renderOverallSvg(p, { width: { cm: 100 } }, 'cm', 'data:image/png;base64,abc', {
      width: 1000,
      height: 500,
    });
    const inch = renderOverallSvg(p, { width: { cm: 100 } }, 'in');
    expect(cm).toContain('Width · 100 cm');
    expect(inch).toContain('Width · 39.37 in');
    expect(cm).toContain('viewBox=');
    expect(cm).toContain('preserveAspectRatio="none"');
    expect(cm).not.toContain('<script>');
    expect(cm).not.toContain('Height ·');
  });
  it('keeps angled arm endpoints and moves depth into a bottom-left lane with parallel guides', () => {
    const raw = {
      spans: [
        {
          key: 'width',
          start: { x: 0.08, y: 0.55 },
          end: { x: 0.83, y: 0.42 },
          offset: { x: 0, y: 0.1 },
          evidence: 'Outside arm silhouettes',
        },
        {
          key: 'depth',
          start: { x: 0.92, y: 0.74 },
          end: { x: 0.61, y: 0.53 },
          offset: { x: 0.1, y: 0 },
          evidence: 'Chaise front and rear base',
        },
        {
          key: 'height',
          start: { x: 0.45, y: 0.26 },
          end: { x: 0.45, y: 0.8 },
          offset: { x: -0.1, y: 0 },
          evidence: 'Back cushion top to floor',
        },
      ],
      omissions: [],
    };
    const original = JSON.stringify(raw);
    const layout = layoutOverallPlacement(parseOverallPlacement(raw));
    const [width, depth, height] = layout.spans;
    expect(width.start).toEqual(raw.spans[0].start);
    expect(width.end).toEqual(raw.spans[0].end);
    expect(width.offset).toEqual({ x: 0, y: 0 });
    expect(width.start.y).not.toBe(width.end.y);
    expect(depth.start).toEqual(raw.spans[1].start);
    expect(depth.end).toEqual(raw.spans[1].end);
    const projectedStart = { x: depth.start.x + depth.offset.x, y: depth.start.y + depth.offset.y };
    const projectedEnd = { x: depth.end.x + depth.offset.x, y: depth.end.y + depth.offset.y };
    expect(projectedStart.x).toBeCloseTo(0.2);
    expect(projectedStart.y).toBeGreaterThan(0.8);
    expect(projectedEnd.x - projectedStart.x).toBeCloseTo(depth.end.x - depth.start.x);
    expect(projectedEnd.y - projectedStart.y).toBeCloseTo(depth.end.y - depth.start.y);
    expect(height.start).toEqual(raw.spans[2].start);
    expect(height.end).toEqual(raw.spans[2].end);
    expect(height.start.x + height.offset.x).toBeLessThan(
      Math.min(projectedStart.x, projectedEnd.x) - 0.17
    );
    const padding = overallPhotoPadding(parseOverallPlacement(raw));
    for (const span of layout.spans)
      for (const p of [span.start, span.end]) {
        expect(p.x + span.offset.x).toBeGreaterThanOrEqual(-padding + 0.15);
        expect(p.x + span.offset.x).toBeLessThanOrEqual(1 + padding - 0.15);
        expect(p.y + span.offset.y).toBeGreaterThanOrEqual(-padding + 0.07);
        expect(p.y + span.offset.y).toBeLessThanOrEqual(1 + padding - 0.07);
      }
    expect(JSON.stringify(raw)).toBe(original);
  });
  it('only permits bounded, public catalogue image hosts', () => {
    expect(cataloguePhotoUrl('https://img.comfort-works.com/sofa.webp')).toContain('sofa.webp');
    for (const url of [
      'http://localhost/a.png',
      'https://img.comfort-works.com.evil.test/a.png',
      'https://user:pass@img.comfort-works.com/a.png',
      'https://img.comfort-works.com/a.svg',
    ])
      expect(() => cataloguePhotoUrl(url)).toThrow();
  });
});
describe('Exact PID and cover images', () => {
  const style = {
    style_code: 'VELC_SP',
    product_style_id: 618,
    style_name: 'Original',
    width: { cm: 280 },
    product_components: [],
  };
  const payload = {
    content: {
      product_options: [
        { product_id: 1913, product_reference: 'IK-KD-35__L', product_styles: [style] },
        { product_id: 2966, product_reference: 'IK-KD-35__R', product_styles: [style] },
      ],
    },
  };
  it('never substitutes the other handedness or a different explicit style', () => {
    expect(selectCatalogueStyle({ productReference: 'IK-KD-35', codes: [] }, payload)).toBeNull();
    const right = selectCatalogueStyle(
      { productReference: 'IK-KD-35', codes: ['R', 'VELC_SP'] },
      payload
    );
    expect(right?.productId).toBe('2966');
    expect(right?.measurementReference).toBe('IK-KD-35__R');
  });
  it('refuses conflicting or duplicate selected styles', () => {
    const ambiguous = {
      content: {
        product_options: [
          {
            product_id: 2966,
            product_reference: 'IK-KD-35__R',
            product_styles: [style, { ...style }],
          },
        ],
      },
    };
    expect(
      selectCatalogueStyle({ productReference: 'IK-KD-35', codes: ['R', 'VELC_SP'] }, ambiguous)
    ).toBeNull();
  });
  it('keeps every image and duplicate component name under its own PID component', () => {
    const components = coverComponents({
      product_components: [
        {
          id: 1,
          name: 'Seat cover',
          quantity: 1,
          slipcover_details_images: [
            { file_path: 'one.png' },
            { file_path: 'two.png' },
            { url: 'https://unapproved.test/missing.png', name: 'Unresolved original' },
          ],
        },
        {
          id: 2,
          name: 'Seat cover',
          quantity: 2,
          slipcover_details_images: [
            { url: 'https://storage.googleapis.com/pid-storage/three.png' },
          ],
        },
      ],
    });
    expect(components).toHaveLength(2);
    expect(components[0].images).toHaveLength(3);
    expect(components[0].images[2]).toEqual({ url: '', name: 'Unresolved original' });
    expect(components[1].images).toHaveLength(1);
    expect(components[1].quantity).toBe(2);
  });
});
