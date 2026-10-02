import { describe, it, expect } from 'vitest';
import {
  fetchMaskEvidence,
  normalizeMaskInput,
  renderMaskOverlay,
  MASK_CLASSES,
} from '../../src/modules/measurement-assistant/mcp/mask-service';

const bytes = new Uint8Array([1, 2, 3]);
const modelSha256 = 'a'.repeat(64);
const config = { url: 'https://mask.example/segment', token: 'private', modelSha256 };
async function evidence() {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return {
    schema: 'sofapaint-masks-v1',
    coordinateSystem: 'normalized-full-photo',
    image: {
      width: 4,
      height: 3,
      sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''),
    },
    model: { id: 'reviewed-model', sha256: modelSha256, classes: MASK_CLASSES },
    warnings: [],
    instances: [
      {
        id: 'mask_1',
        classId: 0,
        label: 'physical_left_arm',
        confidence: 0.8,
        areaPixels: 4,
        bbox: [0, 0, 1, 1],
        rings: [
          {
            hole: false,
            points: [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
          },
        ],
        bitmap: { order: 'row-major', counts: [0, 4, 8] },
      },
    ],
  };
}
describe('reviewed segmentation bridge', () => {
  it('binds predictions to the exact input bytes and checkpoint', async () => {
    const data = await evidence();
    const fetcher = async (_url: unknown, options?: RequestInit) => {
      expect(options?.redirect).toBe('manual');
      expect(options?.headers).toEqual({
        Authorization: 'Bearer private',
        'Content-Type': 'application/octet-stream',
      });
      return new Response(JSON.stringify(data));
    };
    const result = await fetchMaskEvidence(
      bytes,
      { width: 4, height: 3 },
      config,
      fetcher as typeof fetch
    );
    expect(result.instances[0].label).toBe('physical_left_arm');
    expect(result.instances[0].bitmap.counts).toEqual([0, 4, 8]);
  });
  it.each(['input', 'model', 'class', 'area', 'identity', 'coordinates'])(
    'rejects inconsistent %s evidence',
    async kind => {
      const data = await evidence();
      if (kind === 'input') data.image.sha256 = 'b'.repeat(64);
      if (kind === 'model') data.model.sha256 = 'b'.repeat(64);
      if (kind === 'class') data.instances[0].label = 'physical_right_arm';
      if (kind === 'area') data.instances[0].areaPixels = 3;
      if (kind === 'identity') data.instances.push(data.instances[0]);
      if (kind === 'coordinates') data.image.width = 5;
      await expect(
        fetchMaskEvidence(
          bytes,
          { width: 4, height: 3 },
          config,
          (async () => new Response(JSON.stringify(data))) as typeof fetch
        )
      ).rejects.toThrow();
    }
  );
  it('uses an explicit configuration error instead of fabricated masks', async () => {
    await expect(fetchMaskEvidence(bytes, { width: 4, height: 3 }, {})).rejects.toThrow(
      'not configured'
    );
  });
  it.each([301, 302, 307, 308])(
    'rejects %s redirects without forwarding the bearer token',
    async status => {
      for (const endpoint of ['segment', 'normalize']) {
        let calls = 0;
        const fetcher = async (url: unknown, options?: RequestInit) => {
          calls++;
          expect(String(url)).toBe(`https://mask.example/${endpoint}`);
          expect(options?.redirect).toBe('manual');
          return new Response(null, {
            status,
            headers: { Location: 'https://other.example/leak' },
          });
        };
        await expect(
          endpoint === 'segment'
            ? fetchMaskEvidence(bytes, { width: 4, height: 3 }, config, fetcher as typeof fetch)
            : normalizeMaskInput(bytes, config, fetcher as typeof fetch)
        ).rejects.toThrow(`(${status})`);
        expect(calls).toBe(1);
      }
    }
  );
  it('renders occlusion holes with even-odd paths on original coordinates', async () => {
    const data = await evidence();
    const validated = await fetchMaskEvidence(
      bytes,
      { width: 4, height: 3 },
      config,
      (async () => new Response(JSON.stringify(data))) as typeof fetch
    );
    validated.instances[0].rings.push({
      hole: true,
      points: [
        [0.2, 0.2],
        [0.4, 0.2],
        [0.4, 0.4],
      ],
    });
    const svg = renderMaskOverlay(validated, 'data:image/png;base64,AAAA');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('viewBox="0 0 4 3"');
    expect(svg).toContain('#1 Left arm 80%');
  });
});
