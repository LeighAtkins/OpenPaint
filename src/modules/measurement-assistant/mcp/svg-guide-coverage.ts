import { selectedGuideIds } from './construction-plan';
import type { MeasurementPlacement } from '../placement-model';
import type { GuideService } from './guide-service';
import { getGuideRoles } from './guide-roles';

/** Illustrator measurement IDs are m<label>cm / m<label>in; duplicate units are one role. */
export function svgMeasurementLabels(svg: string): string[] {
  return [
    ...new Set([...svg.matchAll(/\bid\s*=\s*["']m([A-Z][A-Z0-9]*?)(?:cm|in)["']/g)].map(m => m[1])),
  ];
}
export function requiredGuideLabels(guideId: string, svg: string): string[] {
  const labels = [
    ...new Set([
      ...svgMeasurementLabels(svg),
      ...(getGuideRoles(guideId)?.map(r => r.label) || []),
    ]),
  ];
  // Leigh's corrected short-back reference supersedes the legacy single E.
  if (/-(?:SA|SLA)-SB(?:[_-]|\.svg|$)/i.test(guideId) && /front[_-]/i.test(guideId)) {
    return [...new Set([...labels.filter(label => label !== 'E'), 'E1', 'E2', 'B2'])];
  }
  return labels;
}
export async function getSvgGuideCoverage(plan: MeasurementPlacement, guides: GuideService) {
  const selections = new Map<string, { imageId: string; guideId: string }>();
  for (const selection of plan.guideSelections || []) {
    for (const guideId of selectedGuideIds(selection))
      selections.set(`${selection.imageId}:${guideId}`, { imageId: selection.imageId, guideId });
  }
  for (const m of plan.measurements)
    if (m.source.kind === 'guide')
      selections.set(`${m.imageId}:${m.source.guideId}`, {
        imageId: m.imageId,
        guideId: m.source.guideId,
      });
  for (const o of plan.omittedGuideRoles || []) selections.set(`${o.imageId}:${o.guideId}`, o);
  const rows: Array<{
    imageId: string;
    guideId: string;
    label: string;
    status: string;
    reason?: string;
  }> = [];
  for (const { imageId, guideId } of selections.values()) {
    const { svg } = await guides.get(guideId);
    const labels = requiredGuideLabels(guideId, svg);
    if (!labels.length)
      throw new Error(
        `Cannot establish measurement labels for ${guideId}. Inspect the SVG before using this guide.`
      );
    for (const label of labels) {
      const drawn = plan.measurements.some(
        m =>
          m.imageId === imageId &&
          m.source.kind === 'guide' &&
          m.source.guideId === guideId &&
          m.source.roleId.replace(/(?:cm|in)$/i, '') === label &&
          m.label === label
      );
      const omission = plan.omittedGuideRoles?.find(
        o => o.imageId === imageId && o.guideId === guideId && o.roleId === label
      );
      rows.push({
        imageId,
        guideId,
        label,
        status: drawn ? 'drawn' : omission ? 'omitted' : 'missing',
        reason: omission?.reason,
      });
    }
  }
  return rows;
}
