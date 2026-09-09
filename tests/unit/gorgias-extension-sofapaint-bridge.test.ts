import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Gorgias SofaPaint content bridge', () => {
  afterEach(() => {
    delete (globalThis as any).__gorgiasSofaPaintContentBridge;
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('acknowledges an open-project request immediately before the cloud load finishes', () => {
    let listener: any = null;
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((next: any) => {
            listener = next;
          }),
        },
      },
    });
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/content-sofapaint.js'), 'utf8')
    )();
    const sendResponse = vi.fn();

    const keepAlive = listener(
      { type: 'SOFAPAINT_OPEN_PROJECT', projectId: 'project-123' },
      {},
      sendResponse
    );

    expect(keepAlive).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, opening: true });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'sofapaint-gorgias-extension',
        type: 'OPEN_PROJECT_REQUEST',
        projectId: 'project-123',
      }),
      window.location.origin
    );
  });
});
