import { expect, it } from 'vitest';
import { measurementPlacementSchema } from '../../src/modules/measurement-assistant/placement-model';
import {
  MASK_CLASSES,
  validateMaskEvidence,
} from '../../src/modules/measurement-assistant/mcp/mask-service';
import { maskPathDiagnostics } from '../../src/modules/measurement-assistant/mcp/mask-path-diagnostics';
import { assistantPlacement } from '../helpers/assistant-placement';

const width = 100,
  height = 50;
function masks(predicates: Array<(x: number, y: number) => boolean>) {
  const image = { width, height, sha256: 'a'.repeat(64) };
  return validateMaskEvidence(
    {
      schema: 'sofapaint-masks-v1',
      coordinateSystem: 'normalized-full-photo',
      image,
      model: { id: 'reviewed', sha256: 'b'.repeat(64), classes: MASK_CLASSES },
      warnings: [],
      instances: predicates.map((contains, index) => {
        const counts = [0];
        let foreground = false,
          areaPixels = 0;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const current = contains(x, y);
            if (current !== foreground) {
              counts.push(0);
              foreground = current;
            }
            counts[counts.length - 1]++;
            if (current) areaPixels++;
          }
        return {
          id: `mask_${index}`,
          classId: index % 5,
          label: MASK_CLASSES[index % 5],
          confidence: 0.9,
          areaPixels,
          bbox: [0, 0, 1, 1],
          rings: [],
          bitmap: { order: 'row-major', counts },
        };
      }),
    },
    image,
    'b'.repeat(64)
  );
}
function line() {
  const plan = measurementPlacementSchema.parse(assistantPlacement('photo'));
  plan.measurements = [plan.measurements[0]];
  return plan;
}
it('checks exact bitmap membership and does not claim a seam or physical accuracy pass', () => {
  const plan = line(),
    before = structuredClone(plan);
  const report = maskPathDiagnostics(plan, 'photo', masks([() => true]));
  expect(report.rows[0].predictedOutsideFraction).toBe(0);
  expect(report.rows[0].warnings).toEqual([]);
  expect(report.claimsPhysicalAccuracy).toBe(false);
  expect(report.advisoryOnly).toBe(true);
  expect(plan).toEqual(before);
});
it('preserves occlusion holes and disconnected-instance identity without polygon refill', () => {
  const report = maskPathDiagnostics(
    line(),
    'photo',
    masks([(x, y) => y > 10 && y < 25 && (x < 35 || x >= 65)])
  );
  const row = report.rows[0];
  expect(row.predictedOutsideFraction).toBeCloseTo(0.5, 1);
  expect(row.warnings).toContain('long-path-outside-predicted-furniture');
  expect(row.instanceOverlap).toHaveLength(1);
  expect(row.instanceOverlap[0].id).toBe('mask_0');
  expect(row.suggestedReviewRegion?.x).toBeGreaterThan(0.2);
});
it('checks the entire bent path rather than only its supported endpoints', () => {
  const plan = line();
  plan.measurements[0].path = {
    kind: 'surface-path',
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.5, y: 0.9 },
      { x: 0.8, y: 0.3 },
    ],
  };
  const row = maskPathDiagnostics(plan, 'photo', masks([(_x, y) => y < 25])).rows[0];
  expect(row.startSupport.exactInstanceIds).toEqual(['mask_0']);
  expect(row.endSupport.exactInstanceIds).toEqual(['mask_0']);
  expect(row.predictedOutsideFraction).toBeGreaterThan(0.6);
  expect(row.warnings).toContain('long-path-outside-predicted-furniture');
});
it('reports overlapping instances without double-counting foreground union', () => {
  const row = maskPathDiagnostics(line(), 'photo', masks([() => true, () => true])).rows[0];
  expect(row.predictedOutsideFraction).toBe(0);
  expect(row.instanceOverlap.map(r => r.pathFraction)).toEqual([1, 1]);
});
it('maps the normalized photo edge to the last pixel, without wrapping a row', () => {
  const plan = line();
  plan.features.find(f => f.id === 'left')!.observations[0].point = { x: 1, y: 0.3 };
  plan.features.find(f => f.id === 'right')!.observations[0].point = { x: 1, y: 1 };
  const row = maskPathDiagnostics(plan, 'photo', masks([x => x === 99])).rows[0];
  expect(row.predictedOutsideFraction).toBe(0);
  expect(row.endSupport.exactInstanceIds).toEqual(['mask_0']);
});
it('reports no predictions as unavailable evidence, not proof of an absent sofa or a bad drawing', () => {
  const report = maskPathDiagnostics(line(), 'photo', masks([]));
  expect(report.status).toBe('no-predictions');
  expect(report.rows[0].warnings).toEqual([]);
});
it('uses length weighting across unequal polyline segments and bounds sampling cost', () => {
  const plan = line();
  const points = [
    { x: 0.2, y: 0.3 },
    { x: 0.21, y: 0.3 },
    { x: 0.8, y: 0.3 },
  ];
  plan.measurements[0].path = { kind: 'surface-path', points };
  const row = maskPathDiagnostics(plan, 'photo', masks([x => x < 21])).rows[0];
  expect(row.predictedOutsideFraction).toBeCloseTo(59 / 60, 2);
  expect(row.sampleCount).toBeLessThanOrEqual(2048);
});

it('reports raw outside pixels separately from supported boundary-neighbourhood pixels', () => {
  const plan = line();
  plan.features.find(f => f.id === 'left')!.observations[0].point = { x: 0.2, y: 0.299 };
  plan.features.find(f => f.id === 'right')!.observations[0].point = { x: 0.8, y: 0.299 };
  const row = maskPathDiagnostics(plan, 'photo', masks([(_x, y) => y >= 15])).rows[0];
  expect(row.predictedOutsideFraction).toBeCloseTo(1);
  expect(row.neighbourhoodUnsupportedFraction).toBe(0);
  expect(row.warnings).toEqual([]);
});

it('stops expensive diagnostics at the explicit bitmap-query budget', () => {
  const plan = line();
  plan.measurements = Array.from({ length: 30 }, (_, i) => ({
    ...plan.measurements[0],
    id: `line-${i}`,
  }));
  const evidence = masks(Array.from({ length: 100 }, () => () => true));
  expect(() => maskPathDiagnostics(plan, 'photo', evidence)).toThrow('query budget exceeded');
});
