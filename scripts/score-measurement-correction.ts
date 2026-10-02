import { readFile, writeFile } from 'node:fs/promises';
import { measurementPlacementSchema } from '../src/modules/measurement-assistant/placement-model.ts';
import {
  scoreMeasurementPlacement,
  type ReferenceMeasurement,
} from '../src/modules/measurement-assistant/measurement-benchmark.ts';

// Explicit view mapping prevents silently comparing a side photo with a rear photo.
const [referencePath, candidatePath, outputPath, viewList, framing] = process.argv.slice(2);
if (!referencePath || !candidatePath || !outputPath || !viewList || framing !== '--same-framing')
  throw new Error(
    'Usage: bun scripts/score-measurement-correction.ts reference.json candidate.json report.json front,side --same-framing. Confirm identical original photo framing first.'
  );
const views = viewList.split(',');
const fixture = JSON.parse(await readFile(referencePath, 'utf8'));
const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
const plan = measurementPlacementSchema.parse(candidate.placement || candidate);
const reference: ReferenceMeasurement[] = [];
const skipped: string[] = [];
function add(index: number, label: string, raw: Array<{ x: number; y: number }>, box: number[]) {
  const view = views[index];
  if (!['front', 'back', 'side', 'top', 'underside', 'detail'].includes(view))
    throw new Error('Supply a valid explicit view for each reference photo.');
  if (box.length !== 4 || box.some(n => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0)
    throw new Error('Invalid reference coordinate frame.');
  const points = raw.map(p => ({ x: (p.x - box[0]) / box[2], y: (p.y - box[1]) / box[3] }));
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('Invalid reference point.');
  reference.push({ view: view as ReferenceMeasurement['view'], label, points });
}
for (const geometry of fixture.geometry || []) {
  const box = geometry.viewBox.trim().split(/\s+/).map(Number);
  for (const m of geometry.measurements) {
    const label = /^m(.+?)(?:cm|in)$/.exec(m.id)?.[1];
    if (!label || reference.some(r => r.view === views[geometry.viewIndex] && r.label === label))
      continue;
    const points = m.points
      ? m.points
          .trim()
          .split(/\s+/)
          .map((p: string) => {
            const [x, y] = p.split(',').map(Number);
            return { x, y };
          })
      : m.x1 !== undefined
        ? [
            { x: Number(m.x1), y: Number(m.y1) },
            { x: Number(m.x2), y: Number(m.y2) },
          ]
        : null;
    if (!points) {
      skipped.push(m.id);
      continue;
    }
    add(geometry.viewIndex, label, points, box);
  }
}
// S2280's manually added B2/E1/E2 live in Fabric vectors, not the stale MOS SVG.
for (const [index, vector] of (fixture.vectors || []).entries()) {
  const bg = vector.background;
  if (bg.angle) throw new Error('Rotated reference background requires full transform conversion.');
  const box = [
    bg.left - (bg.width * bg.scaleX) / 2,
    bg.top - (bg.height * bg.scaleY) / 2,
    bg.width * bg.scaleX,
    bg.height * bg.scaleY,
  ];
  for (const stroke of vector.strokes) {
    const group = stroke.fabric;
    const line =
      group.type === 'group'
        ? group.objects.find((o: { type: string }) => o.type === 'line')
        : group;
    if (!line || line.type !== 'line') {
      skipped.push(stroke.label);
      continue;
    }
    for (const obj of [group, line])
      if (
        obj.angle ||
        obj.skewX ||
        obj.skewY ||
        obj.flipX ||
        obj.flipY ||
        obj.originX !== 'center' ||
        obj.originY !== 'center'
      )
        throw new Error(
          'Complex Fabric transforms require full conversion; refusing approximate benchmark coordinates.'
        );
    const sx = group.type === 'group' ? group.scaleX : 1;
    const sy = group.type === 'group' ? group.scaleY : 1;
    const offsetX = group.type === 'group' ? group.left : 0;
    const offsetY = group.type === 'group' ? group.top : 0;
    add(
      index,
      stroke.label,
      [
        {
          x: offsetX + (line.left + line.x1 * line.scaleX) * sx,
          y: offsetY + (line.top + line.y1 * line.scaleY) * sy,
        },
        {
          x: offsetX + (line.left + line.x2 * line.scaleX) * sx,
          y: offsetY + (line.top + line.y2 * line.scaleY) * sy,
        },
      ],
      box
    );
  }
}
if (!reference.length) throw new Error('No supported corrected reference geometry.');
const report = {
  caseId: fixture.caseId,
  provenance: fixture.provenance,
  skippedReferenceGeometry: skipped,
  ...scoreMeasurementPlacement(plan, reference),
};
await writeFile(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify({
    referenceLines: reference.length,
    missing: report.missing,
    unexpected: report.unexpected.length,
    skipped: skipped.length,
  })
);
