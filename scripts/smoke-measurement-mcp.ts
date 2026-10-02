import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { assistantPlacement } from '../tests/helpers/assistant-placement.ts';

const vars = await readFile('mcp/.dev.vars', 'utf8');
const token = /^MCP_ACCESS_TOKEN=(.+)$/m.exec(vars)?.[1];
if (!token) throw new Error('Set MCP_ACCESS_TOKEN in mcp/.dev.vars first.');
const image = await sharp({
  create: { width: 1000, height: 600, channels: 3, background: '#b4a08c' },
})
  .png()
  .toBuffer();
const photoServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'image/png' });
  response.end(image);
});
await new Promise<void>(resolve => photoServer.listen(8790, '127.0.0.1', resolve));
const client = new Client({ name: 'sofapaint-smoke', version: '1' });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8789/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  const tools = await client.listTools();
  if (!tools.tools.some(tool => tool.name === 'prepare_measurement_plan'))
    throw new Error('Landmark planning tool missing.');
  const created = await client.callTool({
    name: 'start_measurement_project',
    arguments: {
      image: { download_url: 'http://127.0.0.1:8790/photo.png', file_id: 'smoke-local-photo' },
      view: 'front',
      observations: {
        target: 'whole-furniture',
        furnitureKind: 'seating',
        layout: 'straight',
        seatingCapacity: 3,
      },
    },
  });
  if (created.isError) throw new Error(JSON.stringify(created.content));
  const draft = created.structuredContent as {
    projectId: string;
    projectToken: string;
    revision: number;
    images: { id: string }[];
  };
  const originalReview = await client.callTool({
    name: 'review_measurement_drawing',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      imageId: draft.images[0].id,
      includeDrawing: false,
      region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
    },
  });
  if (originalReview.isError) throw new Error('Original photo grounding failed.');
  const placement = {
    ...assistantPlacement(draft.images[0].id),
    guideSelections: [
      {
        imageId: draft.images[0].id,
        rationale: 'Synthetic transport test uses freestyle panel boundaries, not a sofa guide.',
        construction: {
          armShape: 'unknown',
          backHeight: 'unknown',
          cushions: 'unknown',
          armEvidence: 'Synthetic transport fixture cannot establish sofa arm construction.',
          backEvidence: 'Synthetic transport fixture cannot establish real back height.',
        },
      },
    ],
  };
  const prepared = await client.callTool({
    name: 'prepare_measurement_plan',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      expectedRevision: draft.revision,
      plan: { ...placement, measurements: [] },
    },
  });
  if (prepared.isError) throw new Error('Landmark preparation failed.');
  const placed = await client.callTool({
    name: 'generate_measurement_drawing',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      expectedRevision: (prepared.structuredContent as { revision: number }).revision,
      placement,
    },
  });
  if (placed.isError) throw new Error(JSON.stringify(placed.content));
  const prematureExport = await client.callTool({
    name: 'export_measurement_drawing',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      imageId: draft.images[0].id,
    },
  });
  if (!prematureExport.isError) throw new Error('Export must require visual review.');
  const prematurePdf = await client.callTool({
    name: 'export_measurement_pdf',
    arguments: { projectId: draft.projectId, projectToken: draft.projectToken },
  });
  if (!prematurePdf.isError) throw new Error('PDF must require visual review.');
  const crop = await client.callTool({
    name: 'review_measurement_drawing',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      imageId: draft.images[0].id,
      region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
    },
  });
  if (crop.isError) throw new Error('Close-up review failed.');
  const croppedExport = await client.callTool({
    name: 'export_measurement_drawing',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      imageId: draft.images[0].id,
    },
  });
  if (!croppedExport.isError) throw new Error('A crop alone must not count as full-photo review.');
  const reviewed = await client.callTool({
    name: 'review_measurement_drawing',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      imageId: draft.images[0].id,
    },
  });
  if (
    reviewed.isError ||
    !reviewed.content.some(item => item.type === 'image' && item.mimeType === 'image/png')
  )
    throw new Error('Native visual review failed.');
  const confirmed = await client.callTool({
    name: 'confirm_measurement_review',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      expectedRevision: (placed.structuredContent as { revision: number }).revision,
      measurements: placement.measurements.map(m => ({
        measurementId: m.id,
        startBoundary: 'Synthetic test fixture start boundary.',
        endBoundary: 'Synthetic test fixture end boundary.',
        surfaceCheck: 'Synthetic transport check, not actual photo quality.',
        junctionCheck: 'Only shared fixture endpoints are connected.',
      })),
    },
  });
  if (confirmed.isError) throw new Error('Review confirmation failed.');
  const exported = await client.callTool({
    name: 'export_measurement_drawing',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      imageId: draft.images[0].id,
    },
  });
  if (exported.isError) throw new Error('Reviewed export failed.');
  for (const fillable of [true, false]) {
    const result = await client.callTool({
      name: 'export_measurement_pdf',
      arguments: {
        projectId: draft.projectId,
        projectToken: draft.projectToken,
        fillable,
        units: 'cm',
      },
    });
    if (result.isError) throw new Error('Reviewed PDF export failed.');
    const pdfUrl = (result.structuredContent as { url: string }).url;
    const response = await fetch(pdfUrl);
    if (!response.ok || response.headers.get('Content-Type') !== 'application/pdf')
      throw new Error('PDF download failed.');
    const pdf = await PDFDocument.load(await response.arrayBuffer());
    if (
      pdf
        .getForm()
        .getFields()
        .filter(field => field.getName().startsWith('measurement_')).length !==
      (fillable ? assistantPlacement(draft.images[0].id).measurements.length : 0)
    )
      throw new Error('PDF fields do not match drawing.');
    const unauthorized = new URL(pdfUrl);
    unauthorized.searchParams.set('key', 'invalid');
    if ((await fetch(unauthorized)).ok) throw new Error('PDF must require project access.');
  }
  const changedMeasurement = {
    ...assistantPlacement(draft.images[0].id).measurements[0],
    labelPosition: { x: 0.4, y: 0.4 },
  };
  const correction = await client.callTool({
    name: 'update_measurement',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      expectedRevision: (placed.structuredContent as { revision: number }).revision,
      measurement: changedMeasurement,
    },
  });
  if (correction.isError) throw new Error('Correction failed.');
  const staleExport = await client.callTool({
    name: 'export_measurement_drawing',
    arguments: {
      projectId: draft.projectId,
      projectToken: draft.projectToken,
      imageId: draft.images[0].id,
    },
  });
  if (!staleExport.isError) throw new Error('A correction must invalidate earlier reviews.');

  const preview = await fetch(
    `http://127.0.0.1:8789/projects/${draft.projectId}/preview/${draft.images[0].id}.svg?key=${draft.projectToken}`
  );
  const svg = await preview.text();
  if (!preview.ok || !svg.includes('data:image/png;base64,') || !svg.includes('polyline'))
    throw new Error('Annotated photo preview failed.');
  console.log(
    'MCP HTTP check passed: landmark planning and visual review, photo stored in R2, drawing saved, annotated photo rendered.'
  );
} finally {
  await client.close();
  photoServer.close();
}
