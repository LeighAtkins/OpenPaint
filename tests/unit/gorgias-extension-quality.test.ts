import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe('Gorgias attachment quality selection', () => {
  let quality: any;

  beforeAll(() => {
    const script = fs.readFileSync(
      path.resolve('extensions/gorgias-sofapaint/attachment-quality.js'),
      'utf8'
    );
    const scope: Record<string, unknown> = {};
    new Function('globalThis', script)(scope);
    quality = scope.GorgiasAttachmentQuality;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('keeps the highest-resolution copy of the same visual photo selected', () => {
    const visualHash = '10100101'.repeat(8);
    const result = quality.classifyAttachmentVariants([
      { name: 'preview.jpg', width: 488, height: 650, byteSize: 82_000, visualHash },
      { name: 'original.jpg', width: 1952, height: 2600, byteSize: 2_400_000, visualHash },
    ]);

    expect(result[0]).toEqual(
      expect.objectContaining({
        excludedAsLowQuality: true,
        preferredVariantIndex: 1,
      })
    );
    expect(result[1].excludedAsLowQuality).toBe(false);
  });

  it('prefers an original Gorgias download over its transformed thumbnail', () => {
    const base =
      'https://comfort-works.gorgias.com/api/attachment/download/account/file/photo.jpeg';
    const result = quality.classifyAttachmentVariants([
      { name: 'photo.jpeg', url: `${base}?format=120x80`, width: 120, height: 80 },
      { name: 'photo.jpeg', url: base, width: 0, height: 0 },
    ]);

    expect(result[0]).toEqual(
      expect.objectContaining({
        excludedAsLowQuality: true,
        preferredVariantIndex: 1,
      })
    );
    expect(result[1].excludedAsLowQuality).toBe(false);
  });

  it('does not merge different photos merely because their dimensions match', () => {
    const result = quality.classifyAttachmentVariants([
      { name: 'front.jpg', width: 1200, height: 900, visualHash: '0'.repeat(64) },
      { name: 'back.jpg', width: 1200, height: 900, visualHash: '1'.repeat(64) },
    ]);

    expect(result.every((item: any) => !item.excludedAsLowQuality)).toBe(true);
  });

  it('does not merge similar hashes when the crop or aspect ratio differs', () => {
    const hash = '10010010'.repeat(8);
    const result = quality.classifyAttachmentVariants([
      { name: 'wide.jpg', width: 1600, height: 900, visualHash: hash },
      { name: 'portrait.jpg', width: 900, height: 1600, visualHash: hash },
    ]);

    expect(result.every((item: any) => !item.excludedAsLowQuality)).toBe(true);
  });

  it('formats real resolution for every analyzed preview', () => {
    expect(quality.formatResolution({ width: 4032, height: 3024 })).toBe('4032 × 3024');
    expect(quality.formatResolution({})).toBe('Resolution unavailable');
  });

  it('shows both resolutions but deselects the lower-quality preview automatically', async () => {
    const html = fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/popup.html'), 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script').forEach(script => script.remove());
    document.body.innerHTML = parsed.body.innerHTML;

    const visualHash = '10100101'.repeat(8);
    vi.stubGlobal('GorgiasAttachmentQuality', quality);
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn(async () => [
          { id: 7, url: 'https://comfort-works.gorgias.com/app/ticket/180507823' },
        ]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          ticketId: '180507823',
          attachments: [
            {
              name: 'photo-small.jpg',
              url: 'https://uploads.gorgias.io/small.jpg',
              previewUrl: 'small.jpg',
            },
            {
              name: 'photo-full.jpg',
              url: 'https://uploads.gorgias.io/full.jpg',
              previewUrl: 'full.jpg',
            },
          ],
        })),
      },
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: true,
          analyses: [
            { index: 0, ok: true, width: 488, height: 650, byteSize: 80_000, visualHash },
            { index: 1, ok: true, width: 1952, height: 2600, byteSize: 2_000_000, visualHash },
          ],
        })),
        onMessage: { addListener: vi.fn() },
      },
      storage: {
        sync: {
          get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })),
          set: vi.fn(),
        },
      },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    });

    const popupScript = fs.readFileSync(
      path.resolve('extensions/gorgias-sofapaint/popup.js'),
      'utf8'
    );
    new Function(popupScript)();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.attachment')).toHaveLength(2);
      expect(document.querySelector('.attachment-low-quality')).not.toBeNull();
    });

    const rows = [...document.querySelectorAll('.attachment')];
    expect(rows[0].textContent).toContain('488 × 650 · Lower-quality duplicate');
    expect((rows[0].querySelector('input') as HTMLInputElement).checked).toBe(false);
    expect(rows[1].textContent).toContain('1952 × 2600 · Best available');
    expect((rows[1].querySelector('input') as HTMLInputElement).checked).toBe(true);
  });

  it('reuses a recent analyzed ticket scan when the popup is reopened', async () => {
    const html = fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/popup.html'), 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script').forEach(script => script.remove());
    document.body.innerHTML = parsed.body.innerHTML;

    const cacheKey = 'gorgiasSofaPaintScan:v11:202493877';
    const sendMessage = vi.fn(async (message: any) => {
      if (message.type === 'GET_SOFAPAINT_PROJECT_STATUS') return { ok: false, open: false };
      throw new Error(`Unexpected message: ${message.type}`);
    });
    const sendToTab = vi.fn();
    vi.stubGlobal('GorgiasAttachmentQuality', quality);
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 7,
            url: 'https://comfort-works.gorgias.com/app/views/1384557/202493877',
          },
        ]),
        sendMessage: sendToTab,
      },
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
      storage: {
        sync: {
          get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })),
          set: vi.fn(),
        },
        session: {
          get: vi.fn(async () => ({
            [cacheKey]: {
              savedAt: Date.now(),
              analyzed: true,
              ticketContext: { ticketId: '202493877' },
              attachments: [
                {
                  name: 'IMG_7496.jpeg',
                  url: 'https://comfort-works.gorgias.com/api/attachment/download/photo.jpeg',
                  previewUrl: 'preview.jpeg',
                  width: 3024,
                  height: 4032,
                },
              ],
            },
          })),
          set: vi.fn(),
        },
      },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    });

    new Function(fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/popup.js'), 'utf8'))();

    await vi.waitFor(() => {
      expect(document.querySelectorAll('.attachment')).toHaveLength(1);
    });
    expect(document.body.textContent).toContain('3024 × 4032');
    expect(document.body.textContent).toContain('Cached ticket photos');
    expect(sendToTab).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('preserves a manual deselection when image analysis redraws the popup', async () => {
    const html = fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/popup.html'), 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script').forEach(script => script.remove());
    document.body.innerHTML = parsed.body.innerHTML;

    let finishAnalysis: ((value: any) => void) | null = null;
    const analysis = new Promise(resolve => (finishAnalysis = resolve));
    vi.stubGlobal('GorgiasAttachmentQuality', quality);
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn(async () => [
          { id: 7, url: 'https://comfort-works.gorgias.com/app/ticket/225833939' },
        ]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          ticketId: '225833939',
          attachments: [
            { name: 'one.jpg', url: 'https://uploads.gorgias.io/one.jpg', previewUrl: 'one.jpg' },
            { name: 'two.jpg', url: 'https://uploads.gorgias.io/two.jpg', previewUrl: 'two.jpg' },
          ],
        })),
      },
      runtime: {
        sendMessage: vi.fn(async (message: any) => {
          if (message.type === 'GET_SOFAPAINT_PROJECT_STATUS') return { ok: false, open: false };
          if (message.type === 'ANALYZE_ATTACHMENTS') return analysis;
          return { ok: true };
        }),
        onMessage: { addListener: vi.fn() },
      },
      storage: {
        sync: {
          get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })),
          set: vi.fn(),
        },
        session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    });

    new Function(fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/popup.js'), 'utf8'))();
    await vi.waitFor(() => expect(document.querySelectorAll('.attachment')).toHaveLength(2));
    const checkboxes = [
      ...document.querySelectorAll('[data-attachment-index]'),
    ] as HTMLInputElement[];
    checkboxes[1].checked = false;
    checkboxes[1].dispatchEvent(new Event('change'));

    finishAnalysis?.({
      ok: true,
      analyses: [
        { index: 0, ok: true, width: 1800, height: 2400, visualHash: '0'.repeat(64) },
        { index: 1, ok: true, width: 1800, height: 2400, visualHash: '1'.repeat(64) },
      ],
    });

    await vi.waitFor(() => expect(document.body.textContent).toContain('1800 × 2400'));
    const redrawn = [...document.querySelectorAll('[data-attachment-index]')] as HTMLInputElement[];
    expect(redrawn[0].checked).toBe(true);
    expect(redrawn[1].checked).toBe(false);
    expect((document.getElementById('importBtn') as HTMLButtonElement).textContent).toContain(
      'Send 1 photo'
    );
  });
});
