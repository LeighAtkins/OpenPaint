import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Gorgias extension transfer pipeline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads four at a time, sends progressively, and preserves ticket order', async () => {
    let importListener: any = null;
    let activeDownloads = 0;
    let maxActiveDownloads = 0;
    const finishedDownloads: string[] = [];
    const targetMessages: any[] = [];
    let downloadsFinishedWhenFirstImageSent = 0;
    const delays = [10, 110, 70, 55, 20, 15];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fallback download failed');
      })
    );
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: any) => {
            importListener = listener;
          }),
        },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      storage: {
        sync: {
          get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })),
        },
      },
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'http://127.0.0.1:5173/' }]),
        update: vi.fn(async () => undefined),
        create: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(async (tabId: number, message: any) => {
          if (tabId === 2) {
            if (message.type === 'SOFAPAINT_IMPORT_READY') return { ok: true, ready: true };
            if (
              message.type === 'IMPORT_IMAGE' &&
              !targetMessages.some(item => item.type === 'IMPORT_IMAGE')
            ) {
              downloadsFinishedWhenFirstImageSent = finishedDownloads.length;
            }
            targetMessages.push({ ...message, at: Date.now() });
            return { ok: true };
          }
          const index = Number(message.attachment.index);
          activeDownloads += 1;
          maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
          await new Promise(resolve => setTimeout(resolve, delays[index]));
          activeDownloads -= 1;
          finishedDownloads.push(message.attachment.name);
          if (index === 4) return { ok: false, message: 'attachment unavailable' };
          return {
            ok: true,
            image: {
              name: message.attachment.name,
              mime: 'image/jpeg',
              size: 1000 + index,
              hash: index === 2 ? 'hash-0' : `hash-${index}`,
              dataUrl: `data:image/jpeg;base64,image-${index}`,
            },
          };
        }),
      },
    });

    const script = fs.readFileSync(
      path.resolve('extensions/gorgias-sofapaint/service-worker.js'),
      'utf8'
    );
    new Function(script)();

    const attachments = Array.from({ length: 6 }, (_value, index) => ({
      index,
      name: `photo-${index + 1}.jpg`,
      url: `https://uploads.gorgias.io/photo-${index + 1}.jpg`,
      partLabel: ['front', 'side', '', 'cushion', '', 'back'][index],
    }));
    const ticketContext = {
      ticketId: '221130761',
      customerName: 'Jamie Customer',
      guideCode: 'CS1B-NA-SNUG',
    };
    const result = await new Promise<any>((resolve, reject) => {
      const keepAlive = importListener(
        { type: 'IMPORT_ATTACHMENTS', sourceTabId: 1, attachments, ticketContext },
        {},
        (response: any) => (response?.ok ? resolve(response) : reject(new Error(response?.message)))
      );
      expect(keepAlive).toBe(true);
    });

    const imageMessages = targetMessages.filter(message => message.type === 'IMPORT_IMAGE');
    const expectedNames = ['front.jpg', 'side.jpg', 'cushion.jpg', 'back.jpg'];
    expect(maxActiveDownloads).toBe(4);
    expect(imageMessages.map(message => message.name)).toEqual(expectedNames);
    expect(imageMessages.map(message => message.index)).toEqual([0, 1, 2, 3]);
    expect(imageMessages.map(message => message.partLabel)).toEqual([
      'front',
      'side',
      'cushion',
      'back',
    ]);
    expect(downloadsFinishedWhenFirstImageSent).toBeLessThan(attachments.length);
    expect(finishedDownloads.length).toBeGreaterThan(1);
    expect(targetMessages[0]).toEqual(
      expect.objectContaining({ type: 'IMPORT_BEGIN', total: attachments.length, ticketContext })
    );
    expect(imageMessages[0]).toEqual(expect.objectContaining({ hash: 'hash-0' }));
    expect(targetMessages.at(-1)).toEqual(
      expect.objectContaining({
        type: 'IMPORT_COMPLETE',
        importedCount: 4,
        duplicateCount: 1,
        errorCount: 1,
      })
    );
    expect(result.importedCount).toBe(4);
    expect(result.duplicateCount).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('opens SofaPaint when needed and waits for the app receiver before importing', async () => {
    let importListener: any = null;
    let readyAttempts = 0;
    const targetMessages: any[] = [];
    const create = vi.fn(async () => ({
      id: 2,
      url: 'http://127.0.0.1:5173/',
      status: 'complete',
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fallback download failed');
      })
    );
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: vi.fn((listener: any) => (importListener = listener)) },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      storage: {
        sync: { get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })) },
      },
      tabs: {
        query: vi.fn(async () => [
          { id: 1, url: 'https://comfort-works.gorgias.com/app/ticket/180507823' },
        ]),
        create,
        get: vi.fn(async () => ({ id: 2, status: 'complete' })),
        update: vi.fn(async () => undefined),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(async (tabId: number, message: any) => {
          if (tabId === 2 && message.type === 'SOFAPAINT_IMPORT_READY') {
            readyAttempts += 1;
            if (readyAttempts <= 2) throw new Error('Receiving end does not exist');
            return { ok: true, ready: readyAttempts >= 4 };
          }
          if (tabId === 2) {
            targetMessages.push(message);
            return { ok: true };
          }
          return {
            ok: true,
            image: {
              name: 'photo.jpg',
              mime: 'image/jpeg',
              size: 1024,
              hash: 'photo-hash',
              dataUrl: 'data:image/jpeg;base64,cGhvdG8=',
            },
          };
        }),
      },
    });

    const script = fs.readFileSync(
      path.resolve('extensions/gorgias-sofapaint/service-worker.js'),
      'utf8'
    );
    new Function(script)();
    const response = await new Promise<any>((resolve, reject) => {
      importListener(
        {
          type: 'IMPORT_ATTACHMENTS',
          sourceTabId: 1,
          attachments: [{ name: 'photo.jpg', url: 'https://uploads.gorgias.io/photo.jpg' }],
        },
        {},
        (result: any) => (result?.ok ? resolve(result) : reject(new Error(result?.message)))
      );
    });

    expect(create).toHaveBeenCalledWith({ url: 'http://127.0.0.1:5173/', active: true });
    expect(readyAttempts).toBe(4);
    expect(targetMessages.map(message => message.type)).toEqual([
      'IMPORT_BEGIN',
      'IMPORT_IMAGE',
      'IMPORT_COMPLETE',
    ]);
    expect(response.importedCount).toBe(1);
  });

  it('downloads a Google Drive file through its large authenticated thumbnail endpoint', async () => {
    let importListener: any = null;
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('/thumbnail?')) throw new Error('Only thumbnail fallback should be needed');
      return new Response(
        new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
        { status: 200, headers: { 'content-type': 'image/jpeg' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: vi.fn((listener: any) => (importListener = listener)) },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      storage: {
        sync: { get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })) },
      },
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'http://127.0.0.1:5173/' }]),
        update: vi.fn(async () => undefined),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(async (tabId: number, message: any) => {
          if (tabId === 1) throw new Error('Gorgias page cannot fetch Google Drive across origins');
          if (message.type === 'SOFAPAINT_IMPORT_READY') return { ok: true, ready: true };
          return { ok: true };
        }),
      },
    });
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/service-worker.js'), 'utf8')
    )();

    const response = await new Promise<any>((resolve, reject) => {
      importListener(
        {
          type: 'IMPORT_ATTACHMENTS',
          sourceTabId: 1,
          attachments: [
            {
              name: 'drive-photo.jpg',
              url: 'https://drive.google.com/file/d/1Wu35LWMvomBsnTUTDP97RoBI4n_b7hn8/edit',
            },
          ],
        },
        {},
        (result: any) => (result?.ok ? resolve(result) : reject(new Error(result?.message)))
      );
    });

    expect(response.importedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://drive.google.com/thumbnail?id=1Wu35LWMvomBsnTUTDP97RoBI4n_b7hn8&sz=w4096',
      { credentials: 'include', cache: 'no-store' }
    );
  });

  it('reuses an authenticated redirect captured when the Gorgias slide was opened', async () => {
    let importListener: any = null;
    let redirectListener: any = null;
    const targetMessages: any[] = [];
    const originalUrl =
      'https://comfort-works.gorgias.com/api/attachment/download/qgaXzxaEbWZxvDWO/IMG_7724%202-photo.jpeg';
    const signedUrl = 'https://images-signed.gorgias.io/original/IMG_7724.jpeg?signature=valid';
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== signedUrl) throw new Error(`Unexpected fetch: ${url}`);
      return new Response(
        new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
        { status: 200, headers: { 'content-type': 'image/jpeg' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: vi.fn((listener: any) => (importListener = listener)) },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      storage: {
        sync: { get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })) },
      },
      scripting: { executeScript: vi.fn(async () => []) },
      webRequest: {
        onBeforeRedirect: {
          addListener: vi.fn((listener: any) => (redirectListener = listener)),
        },
      },
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'http://127.0.0.1:5173/' }]),
        update: vi.fn(async () => undefined),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(async (_tabId: number, message: any) => {
          if (message.type === 'SOFAPAINT_IMPORT_READY') return { ok: true, ready: true };
          targetMessages.push(message);
          return { ok: true };
        }),
      },
    });
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/service-worker.js'), 'utf8')
    )();
    redirectListener({ tabId: 1, url: originalUrl, redirectUrl: signedUrl });

    const response = await new Promise<any>((resolve, reject) => {
      importListener(
        {
          type: 'IMPORT_ATTACHMENTS',
          sourceTabId: 1,
          attachments: [
            {
              name: 'IMG_7724 2.jpeg',
              url: `${originalUrl}?format=120x80`,
              previewUrl: `${originalUrl}?format=120x80`,
            },
          ],
        },
        {},
        (result: any) => (result?.ok ? resolve(result) : reject(new Error(result?.message)))
      );
    });

    expect(response.importedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(signedUrl, {
      credentials: 'include',
      cache: 'no-store',
    });
    expect(targetMessages).toContainEqual(
      expect.objectContaining({
        type: 'IMPORT_IMAGE',
        name: 'IMG_7724 2.jpeg',
      })
    );
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('prefers the full attachment read by the Gorgias page over a cached thumbnail redirect', async () => {
    let importListener: any = null;
    let redirectListener: any = null;
    const targetMessages: any[] = [];
    const originalUrl =
      'https://comfort-works.gorgias.com/api/attachment/download/team/IMG_3091-photo.jpeg';
    const thumbnailRedirect =
      'https://images-signed.gorgias.io/thumb/IMG_3091.jpeg?signature=small';
    const fetchMock = vi.fn(async () => {
      throw new Error('The cached thumbnail must not be downloaded');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: vi.fn((listener: any) => (importListener = listener)) },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      storage: {
        sync: { get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })) },
      },
      scripting: { executeScript: vi.fn(async () => []) },
      webRequest: {
        onBeforeRedirect: {
          addListener: vi.fn((listener: any) => (redirectListener = listener)),
        },
      },
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'http://127.0.0.1:5173/' }]),
        update: vi.fn(async () => undefined),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(async (tabId: number, message: any) => {
          if (tabId === 1 && message.type === 'FETCH_ATTACHMENT') {
            expect(message.attachment.url).toBe(originalUrl);
            return {
              ok: true,
              image: {
                name: 'IMG_3091.jpeg',
                mime: 'image/jpeg',
                size: 4_000_000,
                hash: 'full-resolution-hash',
                dataUrl: 'data:image/jpeg;base64,full-resolution',
              },
            };
          }
          if (message.type === 'SOFAPAINT_IMPORT_READY') return { ok: true, ready: true };
          targetMessages.push(message);
          return { ok: true };
        }),
      },
    });
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/service-worker.js'), 'utf8')
    )();
    redirectListener({ tabId: 1, url: originalUrl, redirectUrl: thumbnailRedirect });

    const response = await new Promise<any>((resolve, reject) => {
      importListener(
        {
          type: 'IMPORT_ATTACHMENTS',
          sourceTabId: 1,
          attachments: [
            {
              name: 'IMG_3091.jpeg',
              url: `${originalUrl}?format=120x80`,
              previewUrl: `${originalUrl}?format=120x80`,
              width: 4032,
              height: 3024,
            },
          ],
        },
        {},
        (result: any) => (result?.ok ? resolve(result) : reject(new Error(result?.message)))
      );
    });

    expect(response.importedCount).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(targetMessages).toContainEqual(
      expect.objectContaining({
        type: 'IMPORT_IMAGE',
        hash: 'full-resolution-hash',
      })
    );
  });

  it('reveals a Gorgias attachment only when the quiet download is still thumbnail-sized', async () => {
    let importListener: any = null;
    const targetMessages: any[] = [];
    const sourceMessages: string[] = [];
    const originalUrl =
      'https://comfort-works.gorgias.com/api/attachment/download/team/processed-photo.jpeg';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('No network fallback should be needed');
      })
    );
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: vi.fn((listener: any) => (importListener = listener)) },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      storage: {
        sync: { get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })) },
      },
      scripting: { executeScript: vi.fn(async () => []) },
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'http://127.0.0.1:5173/' }]),
        update: vi.fn(async () => undefined),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(async (tabId: number, message: any) => {
          if (tabId === 1) {
            sourceMessages.push(message.type);
            if (message.type === 'FETCH_ATTACHMENT') {
              return {
                ok: true,
                image: {
                  name: 'processed-photo.jpeg',
                  mime: 'image/jpeg',
                  size: 12_000,
                  hash: 'thumbnail-hash',
                  dataUrl: 'data:image/jpeg;base64,thumbnail',
                },
              };
            }
            if (message.type === 'FETCH_ATTACHMENT_ORIGINAL') {
              return {
                ok: true,
                image: {
                  name: 'processed-photo.jpeg',
                  mime: 'image/jpeg',
                  size: 4_200_000,
                  width: 4000,
                  height: 3000,
                  hash: 'original-hash',
                  dataUrl: 'data:image/jpeg;base64,original',
                },
              };
            }
          }
          if (message.type === 'SOFAPAINT_IMPORT_READY') return { ok: true, ready: true };
          targetMessages.push(message);
          return { ok: true };
        }),
      },
    });
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/service-worker.js'), 'utf8')
    )();

    const response = await new Promise<any>((resolve, reject) => {
      importListener(
        {
          type: 'IMPORT_ATTACHMENTS',
          sourceTabId: 1,
          attachments: [
            {
              name: 'processed-photo.jpeg',
              url: `${originalUrl}?format=120x80`,
              previewUrl: `${originalUrl}?format=120x80`,
              width: 120,
              height: 80,
            },
          ],
        },
        {},
        (result: any) => (result?.ok ? resolve(result) : reject(new Error(result?.message)))
      );
    });

    expect(response.importedCount).toBe(1);
    expect(sourceMessages).toEqual(['FETCH_ATTACHMENT', 'FETCH_ATTACHMENT_ORIGINAL']);
    expect(targetMessages).toContainEqual(
      expect.objectContaining({
        type: 'IMPORT_IMAGE',
        hash: 'original-hash',
      })
    );
  });

  it('reinjects the SofaPaint bridge and reads project status without a page refresh', async () => {
    let runtimeListener: any = null;
    let statusAttempts = 0;
    const executeScript = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: vi.fn((listener: any) => (runtimeListener = listener)) },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      storage: {
        sync: { get: vi.fn(async () => ({ sofapaintTarget: 'http://127.0.0.1:5173/' })) },
      },
      scripting: { executeScript },
      tabs: {
        query: vi.fn(async () => [{ id: 9, url: 'http://127.0.0.1:5173/' }]),
        update: vi.fn(async () => undefined),
        sendMessage: vi.fn(async (_tabId: number, message: any) => {
          if (message.type === 'SOFAPAINT_IMPORT_READY') return { ok: true, ready: true };
          if (message.type !== 'SOFAPAINT_PROJECT_STATUS') return { ok: true };
          statusAttempts += 1;
          if (statusAttempts === 1) throw new Error('Receiving end does not exist');
          return {
            ok: true,
            projectName: 'Customer Sofa',
            sameTicket: true,
            importedImageHashes: ['hash-a'],
          };
        }),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/service-worker.js'), 'utf8')
    )();

    const response = await new Promise<any>(resolve => {
      runtimeListener({ type: 'GET_SOFAPAINT_PROJECT_STATUS', ticketId: '194035459' }, {}, resolve);
    });

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 9 },
      files: ['content-sofapaint.js'],
    });
    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        open: true,
        projectName: 'Customer Sofa',
        sameTicket: true,
        importedImageHashes: ['hash-a'],
      })
    );

    const openResponse = await new Promise<any>(resolve => {
      runtimeListener({ type: 'OPEN_SOFAPAINT_PROJECT', projectId: 'project-123' }, {}, resolve);
    });
    expect(openResponse).toEqual(expect.objectContaining({ ok: true, opened: true }));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(9, {
      type: 'SOFAPAINT_OPEN_PROJECT',
      projectId: 'project-123',
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(9, { active: true });
  });
});
