import type { MeasurementPlacement } from '../placement-model';
import { getGuideCoverage } from './guide-roles';
import { constructionIssues } from './construction-plan';

/** Diagnostics, not pixel detection: photographic claims still require visual review. */
export function drawingQualityReport(plan: MeasurementPlacement) {
  const issues: Array<{ code: string; imageId: string; measurementId?: string; message: string }> =
    [];
  if (plan.guideSelections) issues.push(...constructionIssues(plan));
  for (const role of getGuideCoverage(plan)) {
    if (role.status === 'missing')
      issues.push({
        code: 'missing-guide-role',
        imageId: role.imageId,
        message: `Draw ${role.label} or explain why its physical feature is hidden or absent.`,
      });
  }
  for (const m of plan.measurements) {
    if (
      m.label === 'E' &&
      m.source.kind === 'guide' &&
      /front[_-].*-(?:SA|SLA)-SB(?:[_-]|\.svg|$)/i.test(m.source.guideId)
    )
      issues.push({
        code: 'obsolete-short-back-label',
        imageId: m.imageId,
        measurementId: m.id,
        message:
          'Short-back inner arm heights need distinct E1 and E2 lines, not a single E. Preserve B2 too.',
      });
    for (const featureId of [m.startFeatureId, m.endFeatureId]) {
      const observation = plan.features
        .find(f => f.id === featureId)
        ?.observations.find(o => o.imageId === m.imageId);
      if (!observation || observation.confidence < 0.5 || observation.evidence.trim().length < 12)
        issues.push({
          code: 'unsupported-endpoint',
          imageId: m.imageId,
          measurementId: m.id,
          message: `${m.label}: inspect endpoint ${featureId} in a close-up; insufficient visible boundary evidence.`,
        });
    }
  }
  // Only enforce junction semantics established in the reviewed square-arm guide.
  // Independent front spans (D, C3, A3) are deliberately outside this network.
  for (const image of plan.images.filter(i => i.view === 'side')) {
    const square = plan.measurements.filter(
      m =>
        m.imageId === image.id &&
        m.source.kind === 'guide' &&
        /Side_CS3B-SA-HB\.svg$/i.test(m.source.guideId)
    );
    const byLabel = new Map(square.map(m => [m.label, m]));
    for (const [a, b] of [
      ['G1', 'H1'],
      ['G1', 'H2'],
      ['G2', 'H1'],
      ['G2', 'H2'],
    ]) {
      const first = byLabel.get(a);
      const second = byLabel.get(b);
      if (!first || !second) continue;
      const shared = [first.startFeatureId, first.endFeatureId].some(
        id => id === second.startFeatureId || id === second.endFeatureId
      );
      if (!shared)
        issues.push({
          code: 'disconnected-junction',
          imageId: image.id,
          measurementId: first.id,
          message: `${a} and ${b} must share the same physical arm-panel corner feature. Do not connect unrelated measurements.`,
        });
    }
    const profile = plan.measurements.filter(
      m =>
        m.imageId === image.id &&
        m.source.kind === 'guide' &&
        /Side_CS3B-(?:SA|RA)-HB\.svg$/i.test(m.source.guideId) &&
        /^F[1-4]$/.test(m.label)
    );
    if (profile.length === 4 && new Set(profile.map(m => m.label)).size === 4) {
      const degree = new Map<string, number>();
      for (const m of profile)
        for (const id of [m.startFeatureId, m.endFeatureId])
          degree.set(id, (degree.get(id) || 0) + 1);
      const byRole = new Map(profile.map(m => [m.label, m]));
      const share = (a: string, b: string) => {
        const first = byRole.get(a)!;
        const second = byRole.get(b)!;
        return [first.startFeatureId, first.endFeatureId].some(
          id => id === second.startFeatureId || id === second.endFeatureId
        );
      };
      if (
        degree.size !== 4 ||
        [...degree.values()].some(d => d !== 2) ||
        ![
          ['F1', 'F2'],
          ['F2', 'F3'],
          ['F3', 'F4'],
          ['F4', 'F1'],
        ].every(([a, b]) => share(a, b))
      )
        issues.push({
          code: 'disconnected-back-profile',
          imageId: image.id,
          message:
            'F1–F4 must bound the same four physical backrest side-profile corners: base thickness, outer height, top thickness, inner slope. Do not span the broad backrest face.',
        });
    }
  }
  const uncertainEndpoints = plan.features.flatMap(f =>
    f.observations
      .filter(o => o.confidence < 0.5)
      .map(o => ({ imageId: o.imageId, featureId: f.id, evidence: o.evidence }))
  );
  return {
    issues,
    uncertainEndpoints,
    requiresVisualReview: true,
    checklist: [
      'Verify both arrow tips on named visible seams, corners or panel boundaries.',
      'Verify the intended surface: backrest thickness is not backrest width.',
      'Inspect arm joins, backrest side profile and sectional corner in close-ups.',
      'Connect only meaningful shared physical junctions; leave independent spans independent.',
      'Record hidden surfaces and request another angle instead of inventing endpoints.',
    ],
  };
}
export function assertDrawingQuality(plan: MeasurementPlacement) {
  const report = drawingQualityReport(plan);
  if (report.issues.length)
    throw new Error(
      `Drawing checks need correction: ${report.issues.map(i => i.message).join(' ')}`
    );
}
export function validateReviewCoverage(plan: MeasurementPlacement, ids: string[]) {
  const expected = new Set(plan.measurements.map(m => m.id));
  if (
    ids.length !== expected.size ||
    new Set(ids).size !== ids.length ||
    ids.some(id => !expected.has(id))
  )
    throw new Error(
      'Review every current measurement exactly once; omitted, duplicate or unknown review entries are not accepted.'
    );
}
