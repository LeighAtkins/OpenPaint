import { z } from 'zod';
import type { MeasurementPlacement } from './placement-model';
import { getGuideRoles } from './mcp/guide-roles';

/** SofaPaint's existing Classic palette; consistent physical roles across every view. */
export const DRAWING_PALETTE = {
  width: '#3b82f6',
  depth: '#10b981',
  height: '#ef4444',
  contour: '#a855f7',
} as const;
export const drawingStyleSchema = z.object({
  strokeColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  strokeWidth: z.number().min(1).max(6),
  arrowStyle: z.enum(['open', 'filled', 'none']),
  strokeDashArray: z.array(z.number().min(1).max(30)).min(2).max(4).optional(),
});
export type DrawingStyle = z.infer<typeof drawingStyleSchema>;
export function resolveDrawingStyle(
  measurement: MeasurementPlacement['measurements'][number]
): DrawingStyle {
  if (measurement.style) return measurement.style;
  if (measurement.path.kind === 'surface-path')
    return { strokeColor: DRAWING_PALETTE.contour, strokeWidth: 2.5, arrowStyle: 'open' };
  const source = measurement.source;
  const meaning =
    source.kind === 'guide'
      ? getGuideRoles(source.guideId)?.find(role => role.label === measurement.label)?.meaning || ''
      : source.rationale;
  const category = /height|clearance/i.test(meaning)
    ? 'height'
    : /depth|thickness/i.test(meaning)
      ? 'depth'
      : /width/i.test(meaning)
        ? 'width'
        : /^(A3|C3|C4|H|J)/.test(measurement.label)
          ? 'height'
          : /^(B|F|G)/.test(measurement.label)
            ? 'depth'
            : 'width';
  return { strokeColor: DRAWING_PALETTE[category], strokeWidth: 2, arrowStyle: 'filled' };
}
