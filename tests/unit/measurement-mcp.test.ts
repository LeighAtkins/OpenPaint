import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMeasurementMcpServer } from '../../src/modules/measurement-assistant/mcp/server';
import {
  DraftService,
  type DraftStorage,
  type MeasurementDraft,
} from '../../src/modules/measurement-assistant/mcp/project-service';
import { GuideService } from '../../src/modules/measurement-assistant/mcp/guide-service';
import {
  validateImageUrl,
  downloadInputImage,
  readBoundedBody,
} from '../../src/modules/measurement-assistant/mcp/image-input';
import { measurementPlacementSchema } from '../../src/modules/measurement-assistant/placement-model';
import { assistantPlacement } from '../helpers/assistant-placement';

function memoryStorage(): DraftStorage {
  const records = new Map<string, { draft: MeasurementDraft; version: string }>();
  return {
    async read(id) {
      return structuredClone(records.get(id) || null);
    },
    async write(draft, version) {
      const current = records.get(draft.id);
      if (version && version !== current?.version) return false;
      records.set(draft.id, { draft: structuredClone(draft), version: String(draft.revision) });
      return true;
    },
  };
}
const newImage = (id: string) => ({
  id,
  view: 'front' as const,
  width: 1200,
  height: 800,
  mimeType: 'image/png',
  storageKey: `images/${id}`,
});
describe('measurement draft ownership and revisions', () => {
  it('rejects another project capability and stale concurrent edits', async () => {
    const drafts = new DraftService(memoryStorage());
    const first = await drafts.create();
    const other = await drafts.create();
    await expect(drafts.read(first.draft.id, other.token)).rejects.toThrow('unavailable');
    const imageId = crypto.randomUUID();
    await drafts.addImage(first.draft.id, first.token, newImage(imageId), 0);
    await expect(
      drafts.place(first.draft.id, first.token, assistantPlacement(imageId), 0)
    ).rejects.toThrow('changed');
    const placed = await drafts.place(first.draft.id, first.token, assistantPlacement(imageId), 1);
    expect(placed.revision).toBe(2);
    await expect(
      drafts.place(first.draft.id, first.token, assistantPlacement(crypto.randomUUID()), 2)
    ).rejects.toThrow('project images');
  });
});
describe('MCP protocol drawing flow', () => {
  it('exposes correct file handoff schemas and creates, draws, corrects and exports a draft', async () => {
    const drafts = new DraftService(memoryStorage());
    const guides = new GuideService({
      localCatalogue: async () => [],
      localSvg: async () => '',
      remoteKeys: async () => [],
      remoteSvg: async () => null,
    });
    const server = createMeasurementMcpServer({
      drafts,
      guides,
      confirmReview: async () => undefined,
      assertReviewed: async () => undefined,
      exportPdf: async () => ({
        url: 'https://mcp.example/test.pdf',
        filename: 'test.pdf',
        fillable: true,
        revision: 2,
      }),
      renderGuide: async () => 'iVBORw0KGgo=',
      reviewImage: async () => 'iVBORw0KGgo=',
      addImage: async (id, token, _url, _view, revision) =>
        drafts.addImage(id, token, newImage(crypto.randomUUID()), revision),
      describe: draft => ({
        projectId: draft.id,
        revision: draft.revision,
        images: draft.images,
        placement: draft.placement,
      }),
      previewUrl: (id, imageId) =>
        `https://mcp.example/projects/${id}/preview/${imageId}.svg?key=test`,
    });
    const client = new Client({ name: 'test-chatgpt', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const list = await client.listTools();
      const start = list.tools.find(tool => tool.name === 'start_measurement_project')!;
      expect(start._meta?.['openai/fileParams']).toEqual(['image']);
      const imageSchema = start.inputSchema.properties!.image as {
        required: string[];
        properties: Record<string, unknown>;
      };
      expect(imageSchema.required).toEqual(['download_url', 'file_id']);
      expect(Object.keys(imageSchema.properties)).toEqual([
        'download_url',
        'file_id',
        'mime_type',
        'file_name',
      ]);
      const created = await client.callTool({
        name: 'start_measurement_project',
        arguments: {
          image: { download_url: 'https://files.oaiusercontent.com/photo', file_id: 'photo' },
          view: 'front',
          observations: {
            target: 'whole-furniture',
            furnitureKind: 'seating',
            seatingCapacity: 3,
            looseCushions: 'absent',
          },
        },
      });
      const draft = created.structuredContent as {
        projectId: string;
        projectToken: string;
        revision: number;
        images: Array<{ id: string }>;
        category: { category: string };
      };
      expect(draft.category.category).toBe('sofa');
      const access = { projectId: draft.projectId, projectToken: draft.projectToken };
      const placement = assistantPlacement(draft.images[0].id);
      const unprepared = await client.callTool({
        name: 'generate_measurement_drawing',
        arguments: { ...access, expectedRevision: draft.revision, placement },
      });
      expect(unprepared.isError).toBe(true);
      expect(JSON.stringify(unprepared.content)).toContain('prepare_measurement_plan');
      const selections = [
        {
          imageId: draft.images[0].id,
          rationale: 'No matching catalogue guide; use the visible panel boundaries.',
          construction: {
            armShape: 'unknown',
            backHeight: 'unknown',
            cushions: 'unknown',
            armEvidence: 'Only the panel seams are visible in the supplied photo.',
            backEvidence: 'Back height cannot be established in this test photograph.',
          },
        },
      ];
      const prepared = await client.callTool({
        name: 'prepare_measurement_plan',
        arguments: {
          ...access,
          expectedRevision: draft.revision,
          plan: { ...placement, guideSelections: selections, measurements: [] },
        },
      });
      expect(prepared.isError).not.toBe(true);
      const badGuide = measurementPlacementSchema.parse(placement);
      badGuide.measurements[1].label = 'C1';
      badGuide.measurements[1].source = {
        kind: 'guide',
        guideId: 'remote:measurement-guides/Front_CS3B-SLA-HB2.svg',
        guideVersion: 'current',
        roleId: 'C1',
      };
      const rejectedGuide = await client.callTool({
        name: 'generate_measurement_drawing',
        arguments: { ...access, expectedRevision: draft.revision, placement: badGuide },
      });
      expect(rejectedGuide.isError).toBe(true);
      expect(JSON.stringify(rejectedGuide.content)).toContain('must retain its guide path type');
      const drawn = await client.callTool({
        name: 'generate_measurement_drawing',
        arguments: {
          ...access,
          expectedRevision: 2,
          placement: { ...placement, guideSelections: selections },
        },
      });
      expect(drawn.isError).not.toBe(true);
      const measurement = structuredClone(placement.measurements[1]);
      measurement.path.points![1].x = 0.9;
      const corrected = await client.callTool({
        name: 'update_measurement',
        arguments: { ...access, expectedRevision: 3, measurement },
      });
      expect(corrected.isError).not.toBe(true);
      expect((corrected.structuredContent as { revision: number }).revision).toBe(4);
      const exported = await client.callTool({
        name: 'export_measurement_drawing',
        arguments: { ...access, imageId: draft.images[0].id },
      });
      expect((exported.structuredContent as { svgUrl: string }).svgUrl).toContain('download=1');
      const rejected = await client.callTool({
        name: 'get_measurement_project',
        arguments: { ...access, projectToken: '0'.repeat(64) },
      });
      expect(rejected.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
describe('image handoff limits', () => {
  it('rejects private targets, deceptive hostnames, ports and credentials', () => {
    for (const url of [
      'http://127.0.0.1/photo',
      'https://169.254.169.254/photo',
      'https://files.oaiusercontent.com.evil.example/photo',
      'https://other-account.blob.core.windows.net/photo',
      'https://oaisdmntprseasia.blob.core.windows.net.evil.example/photo',
      'https://oaisdmntprindiasocentral.blob.core.windows.net.evil.example/photo',
      'https://user:pass@files.oaiusercontent.com/photo',
      'https://files.oaiusercontent.com:8080/photo',
    ])
      expect(() =>
        validateImageUrl(url, [
          'oaiusercontent.com',
          'oaisdmntprseasia.blob.core.windows.net',
          'oaisdmntprindiasocentral.blob.core.windows.net',
        ])
      ).toThrow();
    expect(
      validateImageUrl('https://files.oaiusercontent.com/photo', ['oaiusercontent.com']).hostname
    ).toBe('files.oaiusercontent.com');
  });
  it('accepts the regional download host used by ChatGPT attachments', () => {
    for (const host of [
      'oaisdmntprseasia.blob.core.windows.net',
      'oaisdmntprindiasocentral.blob.core.windows.net',
    ])
      expect(validateImageUrl(`https://${host}/private/photo?sig=test`, [host]).hostname).toBe(
        host
      );
    expect(() =>
      validateImageUrl('https://unapproved.example/photo?sig=secret', ['oaiusercontent.com'])
    ).toThrow('File host is not approved for image handoff (unapproved.example).');
  });
  it('bounds chunked downloads and disables redirects', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    await expect(readBoundedBody(stream, 10)).rejects.toThrow('exceeds');
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    await expect(
      downloadInputImage(new URL('https://files.oaiusercontent.com/photo'), fetcher)
    ).rejects.toThrow('Expected');
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  });
});

describe('rolled arm guide boundaries', () => {
  it('keeps arm cap, body heights and all four rear widths distinct', async () => {
    const { getGuideRoles } = await import(
      '../../src/modules/measurement-assistant/mcp/guide-roles'
    );
    const side = getGuideRoles('remote:measurement-guides/Side_CS3B-RA-HB.svg')!;
    expect(side.find(role => role.label === 'G1')!.meaning).toContain('TOP');
    expect(side.find(role => role.label === 'G2')!.meaning).toContain('UNDER');
    for (const label of ['H1', 'H2']) {
      expect(side.find(role => role.label === label)!.meaning).toContain('ONLY to G2');
    }
    const back = getGuideRoles('remote:measurement-guides/Back_CS3B-RA-HB.svg')!;
    expect(back.filter(role => /^L/.test(role.label)).map(role => role.label)).toEqual([
      'L1',
      'L2',
      'L3',
      'L4',
    ]);
    const front = getGuideRoles('remote:measurement-guides/Front_CS3B-RA-HB.svg')!;
    expect(front.find(role => role.label === 'E1')!.pathKind).toBe('surface-path');
  });
});

describe('square arm guide completeness', () => {
  it('distinguishes back heights, thicknesses and front arm spans', async () => {
    const { getGuideRoles } = await import(
      '../../src/modules/measurement-assistant/mcp/guide-roles'
    );
    const side = getGuideRoles('remote:measurement-guides/Side_CS3B-SA-HB.svg')!;
    expect(side.map(r => r.label)).toEqual(['F1', 'F2', 'F3', 'F4', 'G1', 'G2', 'H1', 'H2', 'H3']);
    expect(side.find(r => r.label === 'F2')!.meaning).toContain('height ABOVE');
    expect(side.find(r => r.label === 'G2')!.meaning).toContain('LOWER upholstery HEM');
    const front = getGuideRoles('remote:measurement-guides/Front_CS3B-SA-HB.svg')!;
    expect(front.map(r => r.label)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
      'B2',
      'C1',
      'C2',
      'C3',
      'D',
    ]);
  });
  it('blocks silent guide omissions while allowing explicitly explained omissions', async () => {
    const { assertGuideCoverage, getGuideCoverage } = await import(
      '../../src/modules/measurement-assistant/mcp/guide-roles'
    );
    const guideId = 'remote:measurement-guides/Side_CS3B-SA-HB.svg';
    const placement = {
      measurements: [{ imageId: 'side', label: 'F1', source: { kind: 'guide', guideId } }],
    } as any;
    expect(() => assertGuideCoverage(placement)).toThrow('F2');
    placement.omittedGuideRoles = getGuideCoverage(placement)
      .filter(r => r.status === 'missing')
      .map(r => ({
        imageId: 'side',
        guideId,
        roleId: r.label,
        reason: 'Boundary is occluded in this photo; another angle is required.',
      }));
    expect(() => assertGuideCoverage(placement)).not.toThrow();
    placement.omittedGuideRoles[0].imageId = 'another-photo';
    expect(() => assertGuideCoverage(placement)).toThrow('F2');
  });
});
