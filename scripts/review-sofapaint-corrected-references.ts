import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import sharp from 'sharp';
import { readCorrectionReference } from '../src/modules/measurement-assistant/correction-reference';
import {
  measurementPlacementSchema,
  type MeasurementPlacement,
} from '../src/modules/measurement-assistant/placement-model';
import { renderPlacementSvg, escapeXml } from '../src/modules/measurement-assistant/svg-preview';
import { renderSvgPng } from '../src/modules/measurement-assistant/mcp/raster-preview';

const [inputRoot, outputRoot] = process.argv.slice(2);
if (!inputRoot || !outputRoot || !isAbsolute(inputRoot) || !isAbsolute(outputRoot))
  throw new Error(
    'Supply absolute existing private photo-review input and new output directories.'
  );
await mkdir(outputRoot); // Refuse to replace an earlier audit.
const cases = ['S0673', 'S2280', 'S2427', 'S2325'];
const rows: Array<Record<string, unknown>> = [];
const sections: string[] = [];
const summary: Record<string, unknown> = {
  status: 'running',
  createdAt: new Date().toISOString(),
  kind: 'user-corrected-reference-reconstruction',
  independentModelEvaluation: false,
  claimsPhysicalAccuracy: false,
  historicalPhotoFramingVerified: false,
  warning:
    'Legacy correction fixtures omit original photo hashes. Case/view matching is not historical framing verification. These are reconstructed references, not independently generated results.',
  photos: rows,
};
try {
  const font = new Uint8Array(await readFile('dist/mcp-guides/preview-font.ttf'));
  for (const caseId of cases) {
    const fixture = JSON.parse(
      await readFile(`tests/fixtures/measurement-corrections/${caseId}.json`, 'utf8')
    );
    const views = ['front', 'side'] as const;
    const imageIds = views.map(view => `${caseId}-${view}`);
    const corrected = readCorrectionReference(fixture, [...views], imageIds);
    const plan: MeasurementPlacement = {
      images: views.map((view, index) => ({ id: imageIds[index], view })),
      components: [
        { id: 'reference', name: 'Recorded correction; component identities not reconstructed' },
      ],
      surfaces: imageIds.map(id => ({
        id: `${id}-surface`,
        componentId: 'reference',
        name: 'Recorded correction surface',
        status: 'partial',
        reason:
          'Historical reference reconstruction only; visibility and completeness are not independently assessed.',
      })),
      features: [],
      measurements: [],
    };
    for (const [index, ref] of corrected.reference.entries()) {
      const imageId = ref.imageId!;
      const id = `ref-${index}`;
      for (const [suffix, point] of [
        ['start', ref.points[0]],
        ['end', ref.points.at(-1)!],
      ] as const)
        plan.features.push({
          id: `${id}-${suffix}`,
          componentId: 'reference',
          name: `Recorded ${ref.label} ${suffix}`,
          kind: 'surface-landmark',
          observations: [
            {
              imageId,
              point,
              confidence: 0,
              evidence: 'Historical user correction; not independently localized in this audit.',
            },
          ],
        });
      plan.measurements.push({
        id,
        label: ref.label,
        componentId: 'reference',
        surfaceIds: [`${imageId}-surface`],
        imageId,
        startFeatureId: `${id}-start`,
        endFeatureId: `${id}-end`,
        path:
          ref.pathKind === 'surface-path'
            ? { kind: 'surface-path', points: ref.points }
            : { kind: 'span' },
        source: {
          kind: 'freestyle',
          rationale: 'Reconstructed historical user correction, not an independent prediction.',
        },
      });
    }
    measurementPlacementSchema.parse(plan);
    await writeFile(
      join(outputRoot, `${caseId}-reference.json`),
      JSON.stringify({ ...corrected, placement: plan }, null, 2),
      { flag: 'wx', mode: 0o600 }
    );
    for (const imageId of imageIds) {
      const source = join(inputRoot, imageId);
      const destination = join(outputRoot, imageId);
      await mkdir(destination);
      const photo = await readFile(join(source, 'original.jpg'));
      const metadata = await sharp(photo).metadata();
      if (!metadata.width || !metadata.height)
        throw new Error(`${imageId}: invalid photo dimensions`);
      const svg = renderPlacementSvg(plan, imageId, {
        width: metadata.width,
        height: metadata.height,
        url: `data:image/jpeg;base64,${photo.toString('base64')}`,
      });
      const png = await renderSvgPng(svg, font);
      const raster = sharp(png),
        rasterMetadata = await raster.metadata(),
        stats = await raster.stats();
      if (
        !rasterMetadata.width ||
        !rasterMetadata.height ||
        Math.abs(rasterMetadata.height / rasterMetadata.width - metadata.height / metadata.width) >
          0.01 ||
        stats.channels.slice(0, 3).every(c => c.stdev < 1)
      )
        throw new Error(`${imageId}: blank or incorrectly framed reference render`);
      await copyFile(join(source, 'original.jpg'), join(destination, 'original.jpg'));
      await copyFile(join(source, 'parts.jpg'), join(destination, 'parts.jpg'));
      await writeFile(join(destination, 'reference.svg'), svg, { flag: 'wx', mode: 0o600 });
      await writeFile(join(destination, 'reference.png'), png, { flag: 'wx', mode: 0o600 });
      rows.push({
        imageId,
        labels: corrected.reference.filter(r => r.imageId === imageId).map(r => r.label),
        skippedReferenceGeometry: corrected.skipped,
        displayedPhotoSha256: createHash('sha256').update(photo).digest('hex'),
        displayedPhotoWidth: metadata.width,
        displayedPhotoHeight: metadata.height,
        rasterWidth: rasterMetadata.width,
        rasterHeight: rasterMetadata.height,
        historicalPhotoFramingVerified: false,
      });
      sections.push(
        `<section><h2>${escapeXml(imageId)}</h2><div class="photos">${[
          ['original.jpg', 'Photo'],
          ['parts.jpg', 'Mask proposals'],
          ['reference.png', 'User-corrected reference'],
        ]
          .map(
            ([file, label]) =>
              `<figure><figcaption>${label}</figcaption><a href="${imageId}/${file}"><img src="${imageId}/${file}" loading="lazy" alt="${escapeXml(imageId)} ${label}"></a></figure>`
          )
          .join('')}</div></section>`
      );
    }
  }
  await writeFile(
    join(outputRoot, 'review.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SofaPaint corrected references</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f6f7;color:#16191d;font:16px Arial,sans-serif}header{padding:20px;border-bottom:1px solid #cbd0d5;background:white}h1{font-size:22px;margin:0 0 8px}header p{margin:0;max-width:900px;line-height:1.5}section{padding:16px 20px;border-bottom:1px solid #cbd0d5}h2{font-size:18px;margin:0 0 12px}.photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}figcaption{font-size:14px;margin-bottom:6px}img{width:100%;height:auto;display:block;background:#e2e4e7}a{display:block}@media(max-width:700px){.photos{grid-template-columns:1fr}section,header{padding:14px}}</style>
  <header><h1>User-corrected references</h1><p>4 corrected cases · 8 photos. Historical photo framing unverified. Reference reconstruction only; no independent accuracy score.</p></header><main>${sections.join('')}</main></html>`,
    { flag: 'wx', mode: 0o600 }
  );
  summary.status = 'completed';
} catch (error) {
  summary.status = 'failed';
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  summary.completedAt = new Date().toISOString();
  await writeFile(join(outputRoot, 'results.json'), JSON.stringify(summary, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      status: summary.status,
      photos: rows.length,
      output: outputRoot,
      error: summary.error,
    })
  );
}
