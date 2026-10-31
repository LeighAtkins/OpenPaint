import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

const folder = process.argv[2];
if (!folder) throw new Error('Pass a private output folder containing private-inputs.json.');
const inputs = JSON.parse(await readFile(join(folder, 'private-inputs.json'), 'utf8')) as {
  case_id: string;
  front_url: string;
  side_url: string;
  group: string;
  visual_note: string;
}[];
const expectedSha = 'd8b3be861b6abcf0d9656d77432aa23b22b2d3f8f4037061fa41d7ef95658dc1';
const endpoint = 'https://sofapaint-mcp.sofapaint-api.workers.dev/public/mcp';
const client = new Client({ name: 'sofapaint-private-customer-image-check', version: '1' });
const rows: Record<string, unknown>[] = [];
const cards: string[] = [];
const credentials: Record<string, unknown>[] = [];
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
let lastCall = 0;
async function call(name: string, args: Record<string, unknown>) {
  // Stay below the deployed per-minute quota; never retry inference automatically.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 1600 - (Date.now() - lastCall))));
  lastCall = Date.now();
  const result = CallToolResultSchema.parse(
    await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 })
  );
  if (result.isError)
    throw new Error(
      `${name}: ${result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join(' ')}`
    );
  return result;
}
async function save(status: string, error?: string) {
  const report = {
    status,
    endpoint,
    modelSha256: expectedSha,
    completedPhotos: rows.length,
    requestedCases: inputs.length,
    photos: rows,
    error,
  };
  await writeFile(join(folder, 'results.tmp'), JSON.stringify(report, null, 2));
  await rename(join(folder, 'results.tmp'), join(folder, 'results.json'));
  await writeFile(join(folder, 'private-drafts.json'), JSON.stringify(credentials, null, 2));
  await writeFile(
    join(folder, 'review.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SofaPaint customer image masks</title><style>body{margin:0;background:#f4f5f6;color:#182026;font:15px system-ui}header{padding:16px 20px;background:white;border-bottom:1px solid #cdd5da}h1{font-size:22px;margin:0}main{max-width:1500px;margin:auto;padding:16px}section{padding:12px 0 22px;border-bottom:1px solid #cdd5da}h2{font-size:17px;margin:0 0 6px}.meta{margin:0 0 10px;color:#46545f}.views{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}img{display:block;width:100%;height:440px;object-fit:contain;background:white}figcaption{padding:8px 0;font-weight:600}@media(max-width:700px){main{padding:10px}.views{grid-template-columns:1fr}img{height:auto;max-height:76vh}}</style></head><body><header><h1>SofaPaint customer image masks</h1></header><main>${cards.join('')}</main></body></html>`
  );
}
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  const tools = await client.listTools();
  if (!tools.tools.some(tool => tool.name === 'segment_project_image'))
    throw new Error('Hosted masking tool missing');
  await writeFile(
    join(folder, 'live-tools.json'),
    JSON.stringify(
      { names: tools.tools.map(t => t.name), checkedAt: new Date().toISOString() },
      null,
      2
    )
  );
  let checkedCache = false;
  for (const entry of inputs) {
    if (!/^S\d+$/.test(entry.case_id)) throw new Error('Invalid case identifier');
    let draft:
      | {
          projectId: string;
          projectToken: string;
          revision: number;
          images: { id: string; src: string; width: number; height: number }[];
        }
      | undefined;
    for (const view of ['front', 'side'] as const) {
      const url = entry[`${view}_url`];
      if (!url) continue;
      const started = Date.now();
      const source = new URL(url);
      if (source.protocol !== 'https:' || source.hostname !== 's3-us-west-1.amazonaws.com')
        throw new Error('Unexpected source host');
      const image = { download_url: url, file_id: `pc-test-${entry.case_id}-${view}` };
      if (!draft) {
        const result = await call('start_measurement_project', {
          image,
          view,
          observations: {
            target: 'whole-furniture',
            furnitureKind: 'seating',
            layout: entry.group === 'sectional' ? 'l-shaped' : 'unknown',
          },
        });
        draft = result.structuredContent as typeof draft;
        if (!draft?.projectToken) throw new Error('Missing project access');
        credentials.push({
          caseId: entry.case_id,
          projectId: draft.projectId,
          projectToken: draft.projectToken,
        });
      } else {
        const result = await call('add_project_image', {
          projectId: draft.projectId,
          projectToken: draft.projectToken,
          expectedRevision: draft.revision,
          image,
          view,
        });
        draft = {
          ...(result.structuredContent as NonNullable<typeof draft>),
          projectToken: draft.projectToken,
        };
      }
      const photo = draft.images.at(-1)!;
      const args = {
        projectId: draft.projectId,
        projectToken: draft.projectToken,
        imageId: photo.id,
      };
      const result = await call('segment_project_image', args);
      const evidence = result.structuredContent as {
        image: { width: number; height: number; sha256: string };
        model: { sha256: string };
        instances: unknown[];
      };
      if (evidence.model.sha256 !== expectedSha) throw new Error('Hosted checkpoint mismatch');
      if (evidence.image.width !== photo.width || evidence.image.height !== photo.height)
        throw new Error('Hosted coordinates mismatch');
      const overlay = result.content.find(c => c.type === 'image');
      if (!overlay || overlay.type !== 'image' || overlay.mimeType !== 'image/png')
        throw new Error('Native mask overlay missing');
      const response = await fetch(photo.src, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Private stored photo fetch failed');
      const original = new Uint8Array(await response.arrayBuffer());
      if (digest(original) !== evidence.image.sha256)
        throw new Error('Private photo evidence hash mismatch');
      if (!checkedCache) {
        const repeat = await call('segment_project_image', args);
        const repeatOverlay = repeat.content.find(c => c.type === 'image');
        if (
          !repeatOverlay ||
          repeatOverlay.type !== 'image' ||
          repeatOverlay.data !== overlay.data ||
          JSON.stringify(repeat.structuredContent) !== JSON.stringify(evidence)
        )
          throw new Error('Hosted cache result changed');
        const denied = new URL(photo.src);
        denied.searchParams.set('key', 'invalid');
        const unauthorized = await fetch(denied, { signal: AbortSignal.timeout(30000) });
        if (unauthorized.ok) throw new Error('Private photo accessible without project capability');
        checkedCache = true;
      }
      const id = `${entry.case_id}-${view}`;
      const output = join(folder, id);
      await mkdir(output);
      await sharp(original)
        .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toFile(join(output, 'original.jpg'));
      await writeFile(join(output, 'parts.png'), Buffer.from(overlay.data, 'base64'));
      await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
      const row = {
        caseId: entry.case_id,
        view,
        group: entry.group,
        instances: evidence.instances.length,
        width: photo.width,
        height: photo.height,
        seconds: (Date.now() - started) / 1000,
      };
      rows.push(row);
      cards.push(
        `<section><h2>${escape(id)}</h2><p class="meta">${escape(entry.group)} · ${row.instances} regions · ${escape(entry.visual_note || '')}</p><div class="views"><figure><img loading="lazy" src="${id}/original.jpg" alt="${id} original photo"><figcaption>Original photo</figcaption></figure><figure><img loading="lazy" src="${id}/parts.png" alt="${id} model masks"><figcaption>Reviewed model proposals</figcaption></figure></div></section>`
      );
      await save('running');
      console.log(JSON.stringify(row));
    }
  }
  await save('completed');
  console.log(
    JSON.stringify({
      status: 'completed',
      cases: inputs.length,
      photos: rows.length,
      cacheVerified: checkedCache,
    })
  );
} catch (error) {
  const message =
    error instanceof Error
      ? error.message.replace(/https?:\/\/[^\s"<>]+/g, '[private URL]')
      : 'Live check failed';
  await save('failed', message);
  console.error(message);
  process.exitCode = 1;
} finally {
  await client.close();
}
