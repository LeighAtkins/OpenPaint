import type { MeasurementOverlayElement } from '../measurement-mos/types';
import { measurementPlacementSchema } from './placement-model';
import { resolveDrawingStyle } from './drawing-style';

/** Convert photo-normalized placement into existing editable MOS geometry (0–1000). */
export function buildPlacementOverlayElements(
  input: unknown,
  imageId: string
): MeasurementOverlayElement[] {
  const plan = measurementPlacementSchema.parse(input);
  if (!plan.images.some(image => image.id === imageId)) throw new Error('Unknown placement image.');
  const features = new Map(plan.features.map(feature => [feature.id, feature]));
  return plan.measurements
    .filter(measurement => measurement.imageId === imageId)
    .map(measurement => {
      const position = (featureId: string) => {
        const point = features
          .get(featureId)!
          .observations.find(observation => observation.imageId === imageId)!.point;
        return { x: point.x * 1000, y: point.y * 1000 };
      };
      const start = position(measurement.startFeatureId);
      const end = position(measurement.endFeatureId);
      return {
        id: measurement.id,
        opId: measurement.id,
        kind: 'measureLine',
        roleToken: measurement.id,
        displayLabel: measurement.label,
        style: resolveDrawingStyle(measurement),
        editMode: 'endpoint',
        endpoints: [{ point: start }, { point: end }],
        label: {
          text: measurement.label,
          cx: measurement.labelPosition
            ? measurement.labelPosition.x * 1000
            : (start.x + end.x) / 2,
          cy: measurement.labelPosition
            ? measurement.labelPosition.y * 1000
            : Math.max(20, (start.y + end.y) / 2 - 45),
          rotation: 0,
        },
        ...(measurement.path.kind === 'surface-path'
          ? {
              curvePoints: measurement.path.points.map(point => ({
                x: point.x * 1000,
                y: point.y * 1000,
              })),
              // Preserve supplied surface geometry rather than smoothing past a seam corner.
              curveInterpolation: 'linear' as const,
            }
          : {}),
        fabricObjectIds: [],
        dirty: false,
      };
    });
}
