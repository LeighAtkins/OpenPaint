import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { measurementPlacementSchema } from '../src/modules/measurement-assistant/placement-model';
import { readImageDimensions } from '../src/modules/measurement-assistant/mcp/image-input';
import { validateMaskEvidence } from '../src/modules/measurement-assistant/mcp/mask-service';
import { maskPathDiagnostics } from '../src/modules/measurement-assistant/mcp/mask-path-diagnostics';
import { escapeXml } from '../src/modules/measurement-assistant/svg-preview';

const [referenceRoot, imageRoot, tokenPath, outputRoot, expectedModel] = process.argv.slice(2);
if (
  ![referenceRoot, imageRoot, tokenPath, outputRoot].every(path => path && isAbsolute(path)) ||
  !/^[a-f0-9]{64}$/.test(expectedModel || '')
)
  throw new Error(
    'Usage: bundled-script absolute-reference-root absolute-private-photo-root absolute-token-file absolute-new-output-root expected-model-sha256'
  );
await mkdir(outputRoot);
const reports: ReturnType<typeof maskPathDiagnostics>[] = [];
const summary: Record<string, unknown> = {
  status: 'running',
  kind: 'historical-reference-mask-agreement',
  independentModelEvaluation: false,
  claimsPhysicalAccuracy: false,
  historicalPhotoFramingVerified: false,
  expectedModel,
  warning:
    'Current mask/photo bytes are verified. Historical human-correction framing is not verified. Mask agreement does not prove seam correctness.',
  createdAt: new Date().toISOString(),
  reports,
};
const sections: string[] = [];
try {
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error('Missing local mask-service credential.');
  for (const caseId of ['S0673', 'S2280', 'S2427', 'S2325']) {
    const plan = measurementPlacementSchema.parse(
      JSON.parse(await readFile(join(referenceRoot, `${caseId}-reference.json`), 'utf8')).placement
    );
    for (const image of plan.images) {
      const source = await readFile(join(imageRoot, image.id, 'source.bin'));
      const normalized = await fetch('http://127.0.0.1:8091/normalize', {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: source,
      });
      if (!normalized.ok)
        throw new Error(`${image.id}: local normalization failed (${normalized.status})`);
      const bytes = new Uint8Array(await normalized.arrayBuffer());
      const frame = {
        ...readImageDimensions(bytes),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      const raw = JSON.parse(await readFile(join(imageRoot, image.id, 'evidence.json'), 'utf8'));
      const evidence = validateMaskEvidence(raw, frame, expectedModel);
      const report = maskPathDiagnostics(plan, image.id, evidence);
      reports.push(report);
      await mkdir(join(outputRoot, image.id));
      await copyFile(
        join(referenceRoot, image.id, 'reference.png'),
        join(outputRoot, image.id, 'reference.png')
      );
      await copyFile(
        join(imageRoot, image.id, 'parts.jpg'),
        join(outputRoot, image.id, 'parts.jpg')
      );
      await copyFile(
        join(imageRoot, image.id, 'original.jpg'),
        join(outputRoot, image.id, 'original.jpg')
      );
      const warnings = report.rows.filter(row => row.warnings.length);
      sections.push(
        `<section><h2>${escapeXml(image.id)}</h2><p>${report.rows.length} reference lines · ${warnings.length} lines flagged for inspection</p><div class="photos">${[
          ['original.jpg', 'Photo'],
          ['parts.jpg', 'Mask proposals'],
          ['reference.png', 'User-corrected reference'],
        ]
          .map(
            ([file, label]) =>
              `<figure><figcaption>${label}</figcaption><a href="${image.id}/${file}"><img src="${image.id}/${file}" alt="${escapeXml(image.id)} ${label}" loading="lazy"></a></figure>`
          )
          .join(
            ''
          )}</div><ul>${warnings.map(row => `<li><strong>${escapeXml(row.label)}</strong>: ${Math.round(row.predictedOutsideFraction * 100)}% raw sampled path outside predictions, ${Math.round(row.neighbourhoodUnsupportedFraction * 100)}% outside boundary neighbourhood; ${row.warnings.map(escapeXml).join(', ')}</li>`).join('') || '<li>No mask-agreement warning. Not an accuracy pass.</li>'}</ul></section>`
      );
    }
  }
  summary.referenceLines = reports.reduce((sum, report) => sum + report.rows.length, 0);
  summary.flaggedReferenceLines = reports.reduce(
    (sum, report) => sum + report.rows.filter(row => row.warnings.length).length,
    0
  );
  await writeFile(
    join(outputRoot, 'review.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reference mask agreement</title><style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif;background:#f5f6f7;color:#16191d}header,section{padding:18px 20px;border-bottom:1px solid #cbd0d5}header{background:white}h1{font-size:22px;margin:0 0 10px}h2{font-size:18px}p,li{line-height:1.5}header p{max-width:950px}.photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}figcaption{font-size:14px;margin:0 0 6px}img{width:100%;height:auto;display:block}@media(max-width:700px){.photos{grid-template-columns:1fr}section,header{padding:14px}}</style><header><h1>Reference mask agreement</h1><p>${summary.referenceLines} historical reference lines · ${summary.flaggedReferenceLines} lines flagged. Current mask/photo bytes verified; historical correction framing unverified. Advisory warnings only. No independent seam or measurement accuracy claim.</p></header>${sections.join('')}</html>`,
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
      photos: reports.length,
      referenceLines: summary.referenceLines,
      flaggedReferenceLines: summary.flaggedReferenceLines,
      error: summary.error,
      outputRoot,
    })
  );
}
