import type { MeasurementPlacement } from '../placement-model';

export function selectedGuideIds(selection: { guideId?: string; supplementalGuideIds?: string[] }) {
  return [
    ...new Set([
      ...(selection.guideId ? [selection.guideId] : []),
      ...(selection.supplementalGuideIds || []),
    ]),
  ];
}

/** Catalogue metadata, not a classifier operating on pixels. */
export function guideConstruction(id: string) {
  const code = /(?:front|back|side)_([^/]+)\.svg$/i.exec(id)?.[1].toUpperCase();
  const arm = code?.split('-')[1];
  return {
    armShape:
      arm === 'SA' || arm === 'SSA'
        ? 'square'
        : arm === 'SLA'
          ? 'sloped'
          : arm === 'RA'
            ? 'rolled'
            : undefined,
    backHeight:
      code?.match(/-(SB|HB)/)?.[1] === 'SB' ? 'short' : code?.includes('-HB') ? 'high' : undefined,
    view: /(?:front|back|side)_/i.exec(id)?.[0].slice(0, -1).toLowerCase(),
  };
}

export function constructionIssues(plan: MeasurementPlacement) {
  const issues: Array<{ code: string; imageId: string; message: string }> = [];
  for (const image of plan.images) {
    const selection = plan.guideSelections?.find(s => s.imageId === image.id);
    if (!selection) {
      issues.push({
        code: 'missing-construction-plan',
        imageId: image.id,
        message:
          'Record the arm shape, back height, visible evidence and guide or freestyle choice before drawing.',
      });
      continue;
    }
    if (!selection.guideId) continue;
    const expected = guideConstruction(selection.guideId);
    if (expected.view && expected.view !== image.view)
      issues.push({
        code: 'wrong-guide-view',
        imageId: image.id,
        message: 'The selected guide belongs to another photo view.',
      });
    for (const key of ['armShape', 'backHeight'] as const) {
      if (
        expected[key] &&
        selection.construction[key] !== 'unknown' &&
        expected[key] !== selection.construction[key] &&
        !selection.adaptationReason
      )
        issues.push({
          code: 'guide-construction-mismatch',
          imageId: image.id,
          message: `${key}: observed ${selection.construction[key]}, guide expects ${expected[key]}. Choose the matching family or explain the physical adaptation.`,
        });
    }
  }
  return issues;
}

export function assertLandmarkPlan(plan: MeasurementPlacement) {
  const issues = constructionIssues(plan);
  if (issues.length) throw new Error(issues.map(i => `${i.imageId}: ${i.message}`).join(' '));
  for (const image of plan.images) {
    if (!plan.features.some(f => f.observations.some(o => o.imageId === image.id)))
      throw new Error(`Identify visible physical landmarks for ${image.id} before drawing.`);
  }
}

export function assertPreparedDrawing(plan: MeasurementPlacement, prepared: MeasurementPlacement) {
  assertLandmarkPlan(plan);
  if (JSON.stringify(plan.guideSelections) !== JSON.stringify(prepared.guideSelections))
    throw new Error('Guide construction choices changed. Prepare the revised landmark plan first.');
  for (const m of plan.measurements) {
    const selection = plan.guideSelections?.find(s => s.imageId === m.imageId);
    if (
      m.source.kind === 'guide' &&
      (!selection || !selectedGuideIds(selection).includes(m.source.guideId))
    )
      throw new Error(`${m.label}: use the explicitly selected guide, or prepare a revised plan.`);
    for (const featureId of [m.startFeatureId, m.endFeatureId]) {
      const planned = prepared.features.find(f => f.id === featureId);
      const actual = plan.features.find(f => f.id === featureId);
      if (
        !planned ||
        planned.componentId !== actual?.componentId ||
        !planned.observations.some(o => o.imageId === m.imageId)
      )
        throw new Error(
          `${m.label}: endpoint ${featureId} was not identified in the landmark plan. Prepare it before drawing.`
        );
    }
  }
}
