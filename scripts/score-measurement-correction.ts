import { readFile, writeFile } from 'node:fs/promises';
import { measurementPlacementSchema } from '../src/modules/measurement-assistant/placement-model.ts';
import { readCorrectionReference } from '../src/modules/measurement-assistant/correction-reference.ts';
import {
  scoreMeasurementPlacement,
  type ReferenceMeasurement,
} from '../src/modules/measurement-assistant/measurement-benchmark.ts';

const [referencePath, candidatePath, outputPath, viewList, framing, imageList] =
  process.argv.slice(2);
if (!referencePath || !candidatePath || !outputPath || !viewList || framing !== '--same-framing')
  throw new Error(
    'Usage: bun scripts/score-measurement-correction.ts reference.json candidate.json report.json front,side --same-framing [front-image-id,side-image-id]'
  );
const views = viewList.split(',') as ReferenceMeasurement['view'][];
const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
const plan = measurementPlacementSchema.parse(candidate.placement || candidate);
const imageIds = imageList
  ? imageList.split(',')
  : views.map(view => {
      const matches = plan.images.filter(image => image.view === view);
      if (matches.length !== 1)
        throw new Error('Ambiguous photo identity: provide the explicit image ID list.');
      return matches[0].id;
    });
for (const [index, imageId] of imageIds.entries())
  if (!plan.images.some(image => image.id === imageId && image.view === views[index]))
    throw new Error(
      'Reference mapping must identify an actual candidate photo of the stated view.'
    );
const corrected = readCorrectionReference(
  JSON.parse(await readFile(referencePath, 'utf8')),
  views,
  imageIds
);
const report = {
  caseId: corrected.caseId,
  provenance: corrected.provenance,
  skippedReferenceGeometry: corrected.skipped,
  historicalPhotoFramingVerified: corrected.historicalPhotoFramingVerified,
  framingWarning: corrected.framingWarning,
  ...scoreMeasurementPlacement(plan, corrected.reference),
};
await writeFile(outputPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
console.log(
  JSON.stringify({
    referenceLines: corrected.reference.length,
    missing: report.missing,
    unexpected: report.unexpected.length,
    skipped: corrected.skipped.length,
  })
);
