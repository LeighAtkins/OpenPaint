import { describe, expect, it } from 'vitest';
import { measurementPlacementSchema } from '../../src/modules/measurement-assistant/placement-model';
import {
  assertLandmarkPlan,
  assertPreparedDrawing,
} from '../../src/modules/measurement-assistant/mcp/construction-plan';
import { getSvgGuideCoverage } from '../../src/modules/measurement-assistant/mcp/svg-guide-coverage';
import { GuideService } from '../../src/modules/measurement-assistant/mcp/guide-service';
import { assistantPlacement } from '../helpers/assistant-placement';

const guideId = 'remote:measurement-guides/Front_CS3B-SA-SB.svg';
function plan() {
  return measurementPlacementSchema.parse({
    ...assistantPlacement('photo'),
    guideSelections: [
      {
        imageId: 'photo',
        guideId,
        rationale: 'Square arms and a short back match the visible construction.',
        construction: {
          armShape: 'square',
          backHeight: 'short',
          cushions: 'removed',
          armEvidence: 'Flat rectangular inner arm face and top edge.',
          backEvidence: 'Back rises only a short distance above the arm tops.',
        },
      },
    ],
  });
}
describe('construction and landmark planning', () => {
  it('accounts for supplemental component guides even before any lines are drawn', async () => {
    const p = plan();
    p.measurements = [];
    p.guideSelections![0].supplementalGuideIds = ['remote:measurement-guides/Front_CC1.svg'];
    const guides = new GuideService({
      localCatalogue: async () => [],
      localSvg: async () => '',
      remoteKeys: async () => [],
      remoteSvg: async key => (key.includes('CC1') ? '<line id="mK1cm"/>' : '<line id="mA1cm"/>'),
    });
    const coverage = await getSvgGuideCoverage(p, guides);
    expect(coverage.find(r => r.label === 'K1')?.status).toBe('missing');
  });
  it('rejects high-back selection for observed short back and accepts an explicit adaptation', () => {
    const p = plan();
    p.guideSelections![0].guideId = guideId.replace('-SB', '-HB');
    expect(() => assertLandmarkPlan(p)).toThrow('guide expects high');
    p.guideSelections![0].adaptationReason =
      'The matching guide is unavailable; retain only shared panel roles and add short-back inner heights.';
    expect(() => assertLandmarkPlan(p)).not.toThrow();
  });
  it('requires landmark identities before drawing and allows later coordinate corrections', () => {
    const p = plan();
    p.guideSelections![0].guideId = undefined;
    const prepared = structuredClone(p);
    prepared.measurements = [];
    p.features[0].observations[0].point.x = 0.25;
    expect(() => assertPreparedDrawing(p, prepared)).not.toThrow();
    prepared.features.shift();
    expect(() => assertPreparedDrawing(p, prepared)).toThrow('not identified');
  });
  it('checks all selected roles even when no guide measurements were drawn', async () => {
    const p = plan();
    p.measurements = [];
    const guides = new GuideService({
      localCatalogue: async () => [],
      localSvg: async () => '',
      remoteKeys: async () => [],
      remoteSvg: async () => '<line id="mA1cm"/><line id="mEcm"/>',
    });
    const coverage = await getSvgGuideCoverage(p, guides);
    expect(coverage.map(r => r.label)).toEqual(['A1', 'E1', 'E2', 'B2']);
    expect(coverage.every(r => r.status === 'missing')).toBe(true);
  });
  it('ranks construction matches before a catalogue truncated to sixty entries', async () => {
    const keys = Array.from(
      { length: 70 },
      (_, i) => `measurement-guides/Front_CS3B-SA-HB-${i}.svg`
    );
    keys.push('measurement-guides/Front_CS3B-SA-SB.svg');
    const guides = new GuideService({
      localCatalogue: async () => [],
      localSvg: async () => '',
      remoteKeys: async () => keys,
      remoteSvg: async () => '',
    });
    const result = await guides.list('sofa', 'front', '', {
      target: 'whole-furniture',
      armShape: 'square',
      backHeight: 'short',
    });
    expect(result[0].id).toBe(guideId);
    expect(result[0].differences).toEqual([]);
  });
  it('rejects conflicting drawn and omitted roles and unknown selection images', () => {
    const p = plan();
    p.measurements[0].source = { kind: 'guide', guideId, guideVersion: 'current', roleId: 'A1' };
    expect(() =>
      measurementPlacementSchema.parse({
        ...p,
        omittedGuideRoles: [
          {
            imageId: 'photo',
            guideId,
            roleId: 'A1',
            reason: 'The seam is not visible in this supplied view.',
          },
        ],
      })
    ).toThrow('both drawn and omitted');
    p.guideSelections![0].imageId = 'other';
    expect(() => measurementPlacementSchema.parse(p)).toThrow('per project image');
  });
});
