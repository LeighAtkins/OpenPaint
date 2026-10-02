import { describe, expect, it } from 'vitest';
import {
  drawingQualityReport,
  validateReviewCoverage,
} from '../../src/modules/measurement-assistant/mcp/drawing-quality';
import {
  svgMeasurementLabels,
  getSvgGuideCoverage,
  requiredGuideLabels,
} from '../../src/modules/measurement-assistant/mcp/svg-guide-coverage';
const makePlan = (): any => ({
  images: [{ id: 'side', view: 'side' }],
  features: [],
  measurements: [],
  omittedGuideRoles: [],
});
describe('drawing delivery checks', () => {
  it('detects unsupported endpoints instead of treating confidence text as proof', () => {
    const p = makePlan();
    p.measurements = [
      {
        id: 'x',
        label: 'S1',
        imageId: 'side',
        startFeatureId: 'a',
        endFeatureId: 'b',
        source: { kind: 'freestyle' },
      },
    ];
    expect(
      drawingQualityReport(p).issues.filter(i => i.code === 'unsupported-endpoint')
    ).toHaveLength(2);
  });
  it('checks square arm corner junctions without forcing independent spans to connect', () => {
    const p = makePlan();
    p.measurements = ['G1', 'G2', 'H1', 'H2', 'C3', 'D'].map((label, i) => ({
      id: label,
      label,
      imageId: 'side',
      startFeatureId: `a${i}`,
      endFeatureId: `b${i}`,
      source: { kind: 'guide', guideId: 'remote:measurement-guides/Side_CS3B-SA-HB.svg' },
    }));
    const issues = drawingQualityReport(p).issues.filter(i => i.code === 'disconnected-junction');
    expect(issues).toHaveLength(4);
    expect(issues.some(i => i.message.includes('C3'))).toBe(false);
  });
  it('rejects stale, missing and duplicate line review entries', () => {
    const p = makePlan();
    p.measurements = [{ id: 'a' }, { id: 'b' }];
    expect(() => validateReviewCoverage(p, ['a', 'b'])).not.toThrow();
    for (const ids of [['a'], ['a', 'a'], ['a', 'old']])
      expect(() => validateReviewCoverage(p, ids)).toThrow();
  });
  it('deduplicates SVG units and finds sectional labels outside named families', async () => {
    const svg = '<line id="mE1cm"/><g id="mE1in"/><line id="mM7cm"/>';
    expect(svgMeasurementLabels(svg)).toEqual(['E1', 'M7']);
    const p = makePlan();
    p.measurements = [
      {
        imageId: 'side',
        label: 'E1',
        source: { kind: 'guide', guideId: 'sectional', roleId: 'E1' },
      },
    ];
    const result = await getSvgGuideCoverage(p, { get: async () => ({ svg }) } as any);
    expect(result.find(r => r.label === 'M7')?.status).toBe('missing');
    p.omittedGuideRoles = [
      {
        imageId: 'side',
        guideId: 'sectional',
        roleId: 'M7',
        reason: 'Hidden seam needs another angle.',
      },
    ];
    expect(
      (await getSvgGuideCoverage(p, { get: async () => ({ svg }) } as any)).find(
        r => r.label === 'M7'
      )?.status
    ).toBe('omitted');
  });
});

describe('corrected short-back labels', () => {
  it('requires E1/E2 and B2 instead of legacy E', () => {
    const labels = requiredGuideLabels(
      'remote:measurement-guides/Front_CS3B-SA-SB.svg',
      '<line id="mEcm"/><line id="mA1cm"/>'
    );
    expect(labels).toEqual(['A1', 'E1', 'E2', 'B2']);
  });
  it('does not rename E in an unrelated guide', () => {
    expect(
      requiredGuideLabels('remote:measurement-guides/Front_CS3B-SLA-HB2.svg', '<line id="mEcm"/>')
    ).toContain('E');
  });
});

it('rejects a collapsed F1–F4 profile but accepts the four shared side-profile corners', () => {
  const p = makePlan();
  const guideId = 'remote:measurement-guides/Side_CS3B-SA-HB.svg';
  const ends = [
    ['a', 'b'],
    ['a', 'c'],
    ['c', 'd'],
    ['d', 'b'],
  ];
  p.measurements = ends.map(([startFeatureId, endFeatureId], i) => ({
    id: `f${i}`,
    label: `F${i + 1}`,
    imageId: 'side',
    startFeatureId,
    endFeatureId,
    source: { kind: 'guide', guideId },
  }));
  expect(drawingQualityReport(p).issues.some(i => i.code === 'disconnected-back-profile')).toBe(
    false
  );
  p.measurements[3].startFeatureId = 'a';
  expect(drawingQualityReport(p).issues.some(i => i.code === 'disconnected-back-profile')).toBe(
    true
  );
});
