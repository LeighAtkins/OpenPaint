import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { measurementPlacementSchema } from '../src/modules/measurement-assistant/placement-model';
import { escapeXml } from '../src/modules/measurement-assistant/svg-preview';
import { exportNativeMeasurementPdf } from '../src/modules/measurement-assistant/native-pdf-export';

const [stage, inputPath, folder, runName = stage] = process.argv.slice(2);
if (
  !['import', 'guides', 'draw', 'review', 'export', 'export-local'].includes(stage) ||
  !isAbsolute(inputPath || '') ||
  !isAbsolute(folder || '') ||
  !/^[a-z0-9-]+$/.test(runName || '')
)
  throw new Error(
    'Usage: bundled-script import|guides|draw|review|export|export-local absolute-input-json absolute-private-folder [unique-run-name]'
  );
if (stage === 'import') await mkdir(folder);
const output = join(folder, runName);
await mkdir(output);
const input = JSON.parse(await readFile(inputPath, 'utf8'));
interface Image {
  id: string;
  view: string;
  width: number;
  height: number;
  mimeType: string;
  src: string;
}
interface State {
  projectId: string;
  projectToken: string;
  revision: number;
  editorUrl: string;
  images: Image[];
  caseId: string;
  reviewRegions: Record<string, unknown>;
  lastReviewRun?: string;
}
let state: State | undefined =
  stage === 'import'
    ? undefined
    : JSON.parse(await readFile(join(folder, 'private-state.json'), 'utf8'));
const endpoint = new URL('https://sofapaint-mcp.sofapaint-api.workers.dev/public/mcp');
const client = new Client({ name: 'sofapaint-independent-drawing-pilot', version: '1' });
const report: Record<string, unknown> = {
  stage,
  runName,
  status: 'running',
  startedAt: new Date().toISOString(),
  claimsPhysicalAccuracy: false,
  authoringMode: 'explicit-supplied-landmarks',
  independenceNotAutomaticallyVerified: true,
};
const calls: Record<string, unknown>[] = [];
report.calls = calls;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (path: string, data: unknown) =>
  writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
async function saveState() {
  await writeFile(join(folder, 'private-state.tmp'), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  await rename(join(folder, 'private-state.tmp'), join(folder, 'private-state.json'));
}
let lastCall = 0;
async function call(name: string, args: Record<string, unknown>, label: string) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 1600 - (Date.now() - lastCall))));
  lastCall = Date.now();
  const result = CallToolResultSchema.parse(
    await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 })
  );
  const record = {
    name,
    label,
    at: new Date().toISOString(),
    isError: Boolean(result.isError),
    structuredContent: result.structuredContent,
    text: result.content.filter(c => c.type === 'text').map(c => c.text),
  };
  await json(join(output, `${label}.json`), record);
  calls.push({ name, label, isError: record.isError });
  const image = result.content.find(c => c.type === 'image');
  if (image?.type === 'image')
    await writeFile(join(output, `${label}.png`), Buffer.from(image.data, 'base64'), {
      flag: 'wx',
      mode: 0o600,
    });
  if (result.isError) throw new Error(`${name}: ${record.text.join(' ')}`);
  return result.structuredContent as Record<string, unknown>;
}
const access = () => ({ projectId: state!.projectId, projectToken: state!.projectToken });
function update(data: Record<string, unknown>) {
  state = { ...state!, ...data } as State;
  return saveState();
}
async function getCurrent() {
  const current = await call('get_measurement_project', access(), 'current-project');
  if (current.revision !== state!.revision)
    throw new Error('Project changed since the last pilot stage; refusing stale edits.');
  return current;
}
async function ownedDownload(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.host !== endpoint.host)
    throw new Error('Unexpected project download origin.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Private project download failed (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  if (stage === 'import') {
    const sources = JSON.parse(await readFile(input.sourceList, 'utf8')) as Array<
      Record<string, string>
    >;
    const source = sources.find(row => row.case_id === input.caseId);
    if (!source || !/^S\d+$/.test(input.caseId)) throw new Error('Unknown reviewed source case.');
    for (const view of ['front', 'side']) {
      const image = {
        download_url: source[`${view}_url`],
        file_id: `pilot-${input.caseId}-${view}`,
      };
      const data = state
        ? await call(
            'add_project_image',
            { ...access(), expectedRevision: state.revision, image, view },
            `import-${view}`
          )
        : await call(
            'start_measurement_project',
            { image, view, observations: input.observations },
            `import-${view}`
          );
      state = {
        ...state!,
        ...data,
        caseId: input.caseId,
        reviewRegions: input.reviewRegions,
      } as State;
      await saveState();
    }
    for (const image of state!.images) {
      await call(
        'find_measurement_guides',
        { observations: input.observations, view: image.view },
        `${image.view}-guide-options`
      );
      const masks = await call(
        'segment_project_image',
        { ...access(), imageId: image.id },
        `${image.view}-masks`
      );
      const bytes = await ownedDownload(image.src);
      const evidence = masks as unknown as {
        image: { sha256: string; width: number; height: number };
        model: { sha256: string };
      };
      if (
        digest(bytes) !== evidence.image.sha256 ||
        evidence.image.width !== image.width ||
        evidence.image.height !== image.height ||
        evidence.model.sha256 !== 'd8b3be861b6abcf0d9656d77432aa23b22b2d3f8f4037061fa41d7ef95658dc1'
      )
        throw new Error('Original photo and reviewed model provenance mismatch.');
      await writeFile(join(output, `${image.view}-canonical.bin`), bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      await sharp(bytes)
        .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toFile(join(output, `${image.view}-original.jpg`));
      await call(
        'review_measurement_drawing',
        { ...access(), imageId: image.id, includeDrawing: false },
        `${image.view}-original-full`
      );
      await call(
        'review_measurement_drawing',
        {
          ...access(),
          imageId: image.id,
          includeDrawing: false,
          region: state!.reviewRegions[image.view],
        },
        `${image.view}-original-detail`
      );
    }
    report.status = 'awaiting-landmark-authoring';
  } else if (stage === 'guides') {
    await getCurrent();
    if (!Array.isArray(input.guides) || !input.guides.length || input.guides.length > 10)
      throw new Error('Supply one to ten named guide IDs.');
    const names = new Set<string>();
    for (const guide of input.guides) {
      if (
        !/^[a-z0-9-]+$/.test(guide.name) ||
        names.has(guide.name) ||
        typeof guide.guideId !== 'string' ||
        guide.guideId.length > 300
      )
        throw new Error('Invalid or duplicated guide name.');
      names.add(guide.name);
    }
    for (const guide of input.guides)
      await call('get_measurement_guide', { guideId: guide.guideId }, guide.name);
    report.status = 'awaiting-guide-visual-inspection';
  } else if (stage === 'draw') {
    await getCurrent();
    const placement = measurementPlacementSchema.parse(input.placement);
    const map = new Map(state!.images.map(image => [image.view, image.id]));
    const id = (key: string) => {
      const value = map.get(key);
      if (!value) throw new Error('Pilot placement must identify a recorded photo view.');
      return value;
    };
    placement.images.forEach(image => {
      image.id = id(image.id);
    });
    placement.guideSelections?.forEach(selection => {
      selection.imageId = id(selection.imageId);
    });
    placement.omittedGuideRoles?.forEach(omission => {
      omission.imageId = id(omission.imageId);
    });
    placement.features.forEach(feature =>
      feature.observations.forEach(observation => {
        observation.imageId = id(observation.imageId);
      })
    );
    placement.measurements.forEach(measurement => {
      measurement.imageId = id(measurement.imageId);
    });
    measurementPlacementSchema.parse(placement);
    await update(
      await call(
        'prepare_measurement_plan',
        {
          ...access(),
          expectedRevision: state!.revision,
          plan: { ...placement, measurements: [] },
        },
        'prepare-landmarks'
      )
    );
    await update(
      await call(
        'generate_measurement_drawing',
        { ...access(), expectedRevision: state!.revision, placement },
        'generate-drawing'
      )
    );
    report.status = 'awaiting-rendered-visual-review';
  } else if (stage === 'review') {
    await getCurrent();
    const previewHashes: Record<string, string> = {};
    for (const image of state!.images) {
      for (const detail of [false, true]) {
        const label = `${image.view}-${detail ? 'detail' : 'full'}`;
        await call(
          'review_measurement_drawing',
          {
            ...access(),
            imageId: image.id,
            ...(detail ? { region: state!.reviewRegions[image.view] } : {}),
          },
          label
        );
        previewHashes[`${label}.png`] = digest(await readFile(join(output, `${label}.png`)));
      }
    }
    await call('check_measurement_drawing', access(), 'drawing-checks');
    state!.lastReviewRun = runName;
    await saveState();
    await json(join(output, 'preview-manifest.json'), { revision: state!.revision, previewHashes });
    const photos = state!.images
      .map(
        image =>
          `<section><h2>${escapeXml(image.view)}</h2><figure><img src="${image.view}-full.png" alt="${escapeXml(image.view)} drawing"><figcaption>Independent pilot · dimensions blank</figcaption></figure></section>`
      )
      .join('');
    await writeFile(
      join(output, 'review.html'),
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(state!.caseId)} drawing pilot</title><style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif;color:#182026;background:#f4f5f6}header{padding:18px;border-bottom:1px solid #cdd5da;background:white}h1{font-size:22px;margin:0 0 8px}h2{font-size:18px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:16px}section,figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;max-height:84vh;object-fit:contain}figcaption{margin-top:8px}a{color:#0562ac}@media(max-width:700px){main{grid-template-columns:1fr}}</style><header><h1>${escapeXml(state!.caseId)} · drawing pilot</h1><a href="${escapeXml(state!.editorUrl)}">Editable SofaPaint project</a><p>Partial visible-surface plan. Hidden frame seams remain unresolved. Not customer-approved.</p></header><main>${photos}</main></html>`,
      { flag: 'wx', mode: 0o600 }
    );
    report.status = 'awaiting-agent-visual-confirmation';
  } else {
    const current = await getCurrent();
    if (
      !state!.lastReviewRun ||
      input.agentVisuallyInspected !== true ||
      input.revision !== state!.revision
    )
      throw new Error(
        'Inspect current full/detail images before explicitly recording visual review.'
      );
    const manifest = JSON.parse(
      await readFile(join(folder, state!.lastReviewRun, 'preview-manifest.json'), 'utf8')
    );
    if (
      manifest.revision !== input.revision ||
      JSON.stringify(manifest.previewHashes) !== JSON.stringify(input.previewHashes)
    )
      throw new Error('Visual confirmation does not bind the current previews.');
    for (const [file, hash] of Object.entries(input.previewHashes))
      if (
        !/^(front|side)-(full|detail)\.png$/.test(file) ||
        digest(await readFile(join(folder, state!.lastReviewRun, file))) !== hash
      )
        throw new Error('A reviewed preview changed.');
    await call(
      'confirm_measurement_review',
      { ...access(), expectedRevision: state!.revision, measurements: input.measurements },
      'record-visual-review'
    );
    let bytes: Uint8Array;
    if (stage === 'export-local') {
      if (!current.placement) throw new Error('No current drawing to export.');
      const placement = measurementPlacementSchema.parse(current.placement);
      const provenance: unknown[] = [];
      bytes = await exportNativeMeasurementPdf(
        placement,
        state!.images,
        async photo => {
          const source = await readFile(
            join(folder, state!.lastReviewRun!, `${photo.view}-full.png`)
          );
          const before = await sharp(source).metadata();
          const raster = await sharp(source)
            .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
            .toBuffer();
          const after = await sharp(raster).metadata();
          if (before.width !== after.width || before.height !== after.height)
            throw new Error('Export raster changed photo dimensions.');
          provenance.push({
            view: photo.view,
            sourceSha256: digest(source),
            exportSha256: digest(raster),
            width: after.width,
            height: after.height,
            quality: 95,
            chromaSubsampling: '4:4:4',
            bytes: raster.length,
          });
          return { bytes: raster, mimeType: 'image/jpeg' };
        },
        {
          fillable: true,
          units: 'cm',
          title: `${state!.caseId} visible-surface measurement pilot`,
        },
        'https://sofapaint.vercel.app/api/pdf/render'
      );
      const after = await call('get_measurement_project', access(), 'after-native-render');
      if (after.revision !== current.revision)
        throw new Error('Drawing changed during native rendering.');
      await json(join(output, 'raster-provenance.json'), provenance);
      report.exportRoute =
        'Explicit local invocation of existing SofaPaint Save as PDF; unchanged reviewed raster dimensions, JPEG quality 95. Not cached as a hosted MCP download.';
    } else {
      const pdf = await call(
        'export_measurement_pdf',
        {
          ...access(),
          fillable: true,
          units: 'cm',
          title: `${state!.caseId} visible-surface measurement pilot`,
        },
        'native-pdf'
      );
      bytes = await ownedDownload(String(pdf.url));
    }
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
      throw new Error('Native PDF download is not a PDF.');
    await writeFile(join(output, 'measurement-pilot.pdf'), bytes, { flag: 'wx', mode: 0o600 });
    report.status = 'native-pdf-exported-needs-pdf-qa';
  }
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client.close();
  report.completedAt = new Date().toISOString();
  report.revision = state?.revision;
  await json(join(output, 'results.json'), report);
  console.log(
    JSON.stringify({
      stage,
      status: report.status,
      revision: report.revision,
      output,
      error: report.error,
    })
  );
}
