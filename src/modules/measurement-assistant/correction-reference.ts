import { z } from 'zod';
import type { ReferenceMeasurement } from './measurement-benchmark';

const number = z.union([z.number().finite(), z.string().trim().min(1)]).transform(value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Non-finite correction coordinate.');
  return parsed;
});
const fixtureSchema = z.object({
  caseId: z.string().min(1),
  provenance: z.string().min(1),
  geometry: z
    .array(
      z.object({
        viewIndex: z.number().int().nonnegative(),
        viewBox: z.string(),
        measurements: z.array(
          z.object({
            id: z.string(),
            points: z.string().optional(),
            x1: number.optional(),
            y1: number.optional(),
            x2: number.optional(),
            y2: number.optional(),
          })
        ),
      })
    )
    .default([]),
  vectors: z
    .array(
      z.object({
        background: z.object({
          left: number,
          top: number,
          width: number,
          height: number,
          scaleX: number,
          scaleY: number,
          angle: number.optional(),
        }),
        strokes: z.array(z.object({ label: z.string().min(1), fabric: z.record(z.unknown()) })),
      })
    )
    .default([]),
});
const fabricLineSchema = z.object({
  type: z.literal('line'),
  originX: z.literal('center'),
  originY: z.literal('center'),
  left: number,
  top: number,
  scaleX: number,
  scaleY: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  angle: z.literal(0).optional(),
  skewX: z.literal(0).optional(),
  skewY: z.literal(0).optional(),
  flipX: z.literal(false).optional(),
  flipY: z.literal(false).optional(),
});
const fabricGroupSchema = fabricLineSchema
  .omit({ type: true, x1: true, y1: true, x2: true, y2: true })
  .extend({
    type: z.literal('group'),
    objects: z.array(z.record(z.unknown())),
  });
interface Point {
  x: number;
  y: number;
}

/** Legacy fixtures record geometry, not proof of the historical source-photo identity. */
export function readCorrectionReference(
  input: unknown,
  views: ReferenceMeasurement['view'][],
  imageIds: string[]
) {
  if (
    imageIds.length !== views.length ||
    new Set(imageIds).size !== imageIds.length ||
    imageIds.some(id => !id.trim()) ||
    views.some(view => !['front', 'back', 'side', 'top', 'underside', 'detail'].includes(view))
  )
    throw new Error('Supply one distinct photo identity and valid view per correction frame.');
  const fixture = fixtureSchema.parse(input);
  const reference: ReferenceMeasurement[] = [];
  const skipped: string[] = [];
  function add(
    index: number,
    label: string,
    raw: Point[],
    box: number[],
    pathKind: 'span' | 'surface-path'
  ) {
    const view = views[index],
      imageId = imageIds[index];
    if (!['front', 'back', 'side', 'top', 'underside', 'detail'].includes(view) || !imageId)
      throw new Error('Explicit view and image identity required for each correction photo.');
    if (box.length !== 4 || box.some(n => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0)
      throw new Error('Invalid correction frame.');
    const points = raw.map(p => ({ x: (p.x - box[0]) / box[2], y: (p.y - box[1]) / box[3] }));
    if (
      points.length < 2 ||
      points.length > 128 ||
      points.some(
        p =>
          !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1
      ) ||
      !points.some(p => Math.hypot(p.x - points[0].x, p.y - points[0].y) > 1e-9)
    )
      throw new Error(`Invalid correction geometry: ${fixture.caseId} ${label}`);
    const existing = reference.find(r => r.imageId === imageId && r.label === label);
    if (existing) {
      if (
        existing.pathKind !== pathKind ||
        JSON.stringify(existing.points) !== JSON.stringify(points)
      )
        throw new Error(`Conflicting correction geometry: ${fixture.caseId} ${label}`);
      return;
    }
    reference.push({ view, imageId, label, points, pathKind });
  }
  for (const geometry of fixture.geometry) {
    const box = geometry.viewBox.trim().split(/\s+/).map(Number);
    for (const m of geometry.measurements) {
      const label = /^m(.+?)(?:cm|in)$/.exec(m.id)?.[1];
      if (!label) {
        skipped.push(m.id);
        continue;
      }
      const points = m.points
        ? m.points
            .trim()
            .split(/\s+/)
            .map(p => {
              const pair = p.split(',');
              if (pair.length !== 2 || pair.some(n => !n.trim()))
                throw new Error('Invalid point pair.');
              return { x: Number(pair[0]), y: Number(pair[1]) };
            })
        : m.x1 !== undefined && m.y1 !== undefined && m.x2 !== undefined && m.y2 !== undefined
          ? [
              { x: m.x1, y: m.y1 },
              { x: m.x2, y: m.y2 },
            ]
          : null;
      if (!points) {
        skipped.push(m.id);
        continue;
      }
      add(geometry.viewIndex, label, points, box, m.points ? 'surface-path' : 'span');
    }
  }
  // S2280's manual additions are in vectors; its old MOS overlays are not authoritative.
  for (const [index, vector] of fixture.vectors.entries()) {
    const bg = vector.background;
    if (bg.angle)
      throw new Error('Rotated correction background requires full transform conversion.');
    const box = [
      bg.left - (bg.width * bg.scaleX) / 2,
      bg.top - (bg.height * bg.scaleY) / 2,
      bg.width * bg.scaleX,
      bg.height * bg.scaleY,
    ];
    for (const stroke of vector.strokes) {
      const group =
        stroke.fabric.type === 'group' ? fabricGroupSchema.parse(stroke.fabric) : undefined;
      const rawLine = group ? group.objects.find(o => o.type === 'line') : stroke.fabric;
      if (!rawLine || rawLine.type !== 'line') {
        skipped.push(stroke.label);
        continue;
      }
      if (group && group.objects.filter(o => o.type === 'line').length !== 1)
        throw new Error('Ambiguous multi-line Fabric correction.');
      const line = fabricLineSchema.parse(rawLine);
      const transform = (x: number, y: number) => ({
        x: (group?.left || 0) + (line.left + x * line.scaleX) * (group?.scaleX ?? 1),
        y: (group?.top || 0) + (line.top + y * line.scaleY) * (group?.scaleY ?? 1),
      });
      add(
        index,
        stroke.label,
        [transform(line.x1, line.y1), transform(line.x2, line.y2)],
        box,
        'span'
      );
    }
  }
  if (!reference.length) throw new Error('No supported corrected reference geometry.');
  return {
    caseId: fixture.caseId,
    provenance: fixture.provenance,
    reference,
    skipped,
    historicalPhotoFramingVerified: false,
    framingWarning:
      'Legacy fixtures omit original photo hashes. Case/view association does not verify historical photo framing.',
  };
}
