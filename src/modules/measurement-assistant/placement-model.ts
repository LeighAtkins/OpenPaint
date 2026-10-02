import { z } from 'zod';
import { drawingStyleSchema } from './drawing-style';

const id = z.string().trim().min(1).max(512);
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const view = z.enum(['front', 'back', 'side', 'top', 'underside', 'detail']);

export const guideSelectionSchema = z.object({
  imageId: id,
  guideId: id.optional(),
  supplementalGuideIds: z.array(id).max(10).optional(),
  rationale: z.string().trim().min(12).max(512),
  construction: z.object({
    armShape: z.enum(['square', 'sloped', 'rolled', 'armless', 'other', 'unknown']),
    backHeight: z.enum(['short', 'high', 'unknown']),
    armEvidence: z.string().trim().min(12).max(512),
    backEvidence: z.string().trim().min(12).max(512),
    cushions: z.enum(['removed', 'present', 'fixed', 'unknown']),
  }),
  adaptationReason: z.string().trim().min(12).max(512).optional(),
});

/** Physical features have stable IDs; each photo supplies its own projected position. */
export const measurementPlacementSchema = z
  .object({
    images: z.array(z.object({ id, view })).min(1),
    guideSelections: z.array(guideSelectionSchema).optional(),
    omittedGuideRoles: z
      .array(
        z.object({
          imageId: id,
          guideId: id,
          roleId: id,
          reason: z.string().trim().min(12).max(512),
        })
      )
      .optional(),
    components: z.array(z.object({ id, name: id })).min(1),
    features: z.array(
      z.object({
        id,
        componentId: id,
        name: id,
        kind: z.enum([
          'seam-intersection',
          'piping-corner',
          'panel-boundary',
          'cushion-edge',
          'surface-landmark',
        ]),
        observations: z
          .array(
            z.object({
              imageId: id,
              point,
              evidence: id,
              confidence: z.number().min(0).max(1),
            })
          )
          .min(1),
      })
    ),
    surfaces: z
      .array(
        z.object({
          id,
          componentId: id,
          name: id,
          status: z.enum(['covered', 'partial', 'unseen']),
          reason: id,
          requestedView: view.optional(),
        })
      )
      .min(1),
    measurements: z.array(
      z.object({
        id,
        label: id,
        value: z.string().trim().max(100).optional(),
        componentId: id,
        surfaceIds: z.array(id).min(1),
        imageId: id,
        startFeatureId: id,
        endFeatureId: id,
        path: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('span') }),
          z.object({ kind: z.literal('surface-path'), points: z.array(point).min(2).max(128) }),
        ]),
        source: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('guide'), guideId: id, guideVersion: id, roleId: id }),
          z.object({ kind: z.literal('freestyle'), rationale: id }),
        ]),
        labelPosition: point.optional(),
        style: drawingStyleSchema.optional(),
      })
    ),
  })
  .superRefine((plan, context) => {
    const issue = (path: Array<string | number>, message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    for (const key of ['images', 'components', 'features', 'surfaces', 'measurements'] as const) {
      const seen = new Set<string>();
      plan[key].forEach((item, index) => {
        if (seen.has(item.id))
          issue([key, index, 'id'], 'IDs must be unique within this collection.');
        seen.add(item.id);
      });
    }
    const images = new Set(plan.images.map(image => image.id));
    const components = new Set(plan.components.map(component => component.id));
    const features = new Map(plan.features.map(feature => [feature.id, feature]));
    const surfaces = new Map(plan.surfaces.map(surface => [surface.id, surface]));
    const selectedImages = new Set<string>();
    plan.guideSelections?.forEach((selection, index) => {
      if (!images.has(selection.imageId) || selectedImages.has(selection.imageId))
        issue(
          ['guideSelections', index, 'imageId'],
          'Select one guide or explicit freestyle plan per project image.'
        );
      selectedImages.add(selection.imageId);
    });
    plan.omittedGuideRoles?.forEach((omission, index) => {
      if (!images.has(omission.imageId))
        issue(['omittedGuideRoles', index, 'imageId'], 'Unknown image.');
      if (
        plan.measurements.some(
          m =>
            m.imageId === omission.imageId &&
            m.source.kind === 'guide' &&
            m.source.guideId === omission.guideId &&
            m.source.roleId === omission.roleId
        )
      )
        issue(['omittedGuideRoles', index], 'A role cannot be both drawn and omitted.');
    });
    plan.features.forEach((feature, index) => {
      if (!components.has(feature.componentId))
        issue(['features', index, 'componentId'], 'Unknown component.');
      const seenImages = new Set<string>();
      feature.observations.forEach((observation, observationIndex) => {
        if (!images.has(observation.imageId))
          issue(['features', index, 'observations', observationIndex, 'imageId'], 'Unknown image.');
        if (seenImages.has(observation.imageId))
          issue(
            ['features', index, 'observations', observationIndex, 'imageId'],
            'A physical feature has one position per image.'
          );
        seenImages.add(observation.imageId);
      });
    });
    plan.surfaces.forEach((surface, index) => {
      if (!components.has(surface.componentId))
        issue(['surfaces', index, 'componentId'], 'Unknown component.');
      if (
        surface.status === 'covered' &&
        !plan.measurements.some(measurement => measurement.surfaceIds.includes(surface.id))
      ) {
        issue(['surfaces', index, 'status'], 'A covered surface requires a drawing.');
      }
    });
    plan.measurements.forEach((measurement, index) => {
      const path = ['measurements', index];
      if (!components.has(measurement.componentId))
        issue([...path, 'componentId'], 'Unknown component.');
      if (!images.has(measurement.imageId)) issue([...path, 'imageId'], 'Unknown image.');
      const endpoints = [measurement.startFeatureId, measurement.endFeatureId].map(
        (featureId, endpointIndex) => {
          const key = endpointIndex === 0 ? 'startFeatureId' : 'endFeatureId';
          const feature = features.get(featureId);
          if (!feature || feature.componentId !== measurement.componentId)
            issue([...path, key], 'Endpoint must belong to this component.');
          const observation = feature?.observations.find(
            item => item.imageId === measurement.imageId
          );
          if (!observation)
            issue([...path, key], 'Endpoint must have visible evidence in this image.');
          return observation?.point;
        }
      );
      if (measurement.startFeatureId === measurement.endFeatureId)
        issue([...path, 'endFeatureId'], 'A measurement must join distinct physical features.');
      if (
        endpoints[0] &&
        endpoints[1] &&
        Math.hypot(endpoints[0].x - endpoints[1].x, endpoints[0].y - endpoints[1].y) < 1e-6
      ) {
        issue([...path, 'endFeatureId'], 'A measurement cannot have zero projected length.');
      }
      measurement.surfaceIds.forEach((surfaceId, surfaceIndex) => {
        const surface = surfaces.get(surfaceId);
        if (
          !surface ||
          surface.componentId !== measurement.componentId ||
          surface.status === 'unseen'
        ) {
          issue(
            [...path, 'surfaceIds', surfaceIndex],
            'Drawing surfaces must belong to this component and be visible.'
          );
        }
      });
      if (measurement.path.kind === 'surface-path') {
        const points = measurement.path.points;
        for (const [endpointIndex, pathPoint] of [
          [0, points[0]],
          [1, points[points.length - 1]],
        ] as const) {
          const endpoint = endpoints[endpointIndex];
          if (endpoint && Math.hypot(endpoint.x - pathPoint.x, endpoint.y - pathPoint.y) > 1e-6) {
            issue(
              [...path, 'path', 'points'],
              'Surface path must start and end at its referenced features.'
            );
          }
        }
      }
    });
  });
export type MeasurementPlacement = z.infer<typeof measurementPlacementSchema>;
