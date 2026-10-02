import type { MeasurementPlacement } from './placement-model';

export interface ReferenceMeasurement {
  view: MeasurementPlacement['images'][number]['view'];
  label: string;
  points: Array<{ x: number; y: number }>;
}

/** Use only the same original photo framing. Scores cannot establish physical correctness. */
export function scoreMeasurementPlacement(
  plan: MeasurementPlacement,
  reference: ReferenceMeasurement[]
) {
  const actual = plan.measurements.map(m => {
    const point = (id: string) =>
      plan.features.find(f => f.id === id)?.observations.find(o => o.imageId === m.imageId)?.point;
    const start = point(m.startFeatureId);
    const end = point(m.endFeatureId);
    return {
      view: plan.images.find(i => i.id === m.imageId)?.view,
      label: m.label,
      points: m.path.kind === 'surface-path' ? m.path.points : start && end ? [start, end] : [],
    };
  });
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const rows = reference.map(r => {
    const matches = actual.filter(m => m.view === r.view && m.label === r.label);
    if (
      matches.length !== 1 ||
      reference.filter(other => other.view === r.view && other.label === r.label).length !== 1
    )
      return { view: r.view, label: r.label, status: matches.length ? 'ambiguous' : 'missing' };
    const a = matches[0].points;
    const b = r.points;
    if (a.length < 2 || b.length < 2) return { view: r.view, label: r.label, status: 'invalid' };
    const direct = [distance(a[0], b[0]), distance(a.at(-1)!, b.at(-1)!)];
    const reverse = [distance(a[0], b.at(-1)!), distance(a.at(-1)!, b[0])];
    const errors = direct[0] + direct[1] <= reverse[0] + reverse[1] ? direct : reverse;
    return {
      view: r.view,
      label: r.label,
      status: 'matched',
      meanEndpointError: (errors[0] + errors[1]) / 2,
      maxEndpointError: Math.max(...errors),
      pathTypeMismatch: a.length > 2 !== b.length > 2,
    };
  });
  const testedViews = new Set(reference.map(r => r.view));
  const unexpected = actual
    .filter(a => a.view && testedViews.has(a.view))
    .filter(a => !reference.some(r => r.view === a.view && r.label === a.label))
    .map(a => ({ view: a.view, label: a.label }));
  return {
    rows,
    unexpected,
    missing: rows.filter(r => r.status === 'missing').length,
    framingRequirement:
      'Reference and candidate must use the identical original photos and full-photo normalized coordinates.',
    requiresHumanReview: true,
    unscoredViews: plan.images
      .filter(image => !testedViews.has(image.view))
      .map(image => image.view),
  };
}
