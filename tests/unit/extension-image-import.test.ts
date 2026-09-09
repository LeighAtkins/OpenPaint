import { describe, expect, it, vi } from 'vitest';
import { initExtensionImageImport } from '../../src/modules/ui/extension-image-import';
import { cloudSaveService } from '../../src/services/cloud/cloudSaveService';

function extensionMessage(data: Record<string, unknown>): MessageEvent {
  const event = new MessageEvent('message', { data });
  Object.defineProperty(event, 'source', { configurable: true, value: window });
  return event;
}

describe('Chrome extension image handoff', () => {
  it('adds files progressively in source order before the batch completes', async () => {
    document.body.innerHTML = `
      <input id="projectName" value="OpenPaint Project" />
      <div><p class="images-panel-subtitle">Project views</p></div>`;
    let metadata: any = {
      naming: {},
      externalSources: { gorgiasTickets: {} },
      measurementGuideCodes: [],
      measurementGuideLibraryCodes: [],
      measurementGuideProjectDefaults: { codes: [], activeCode: '' },
    };
    (window as any).app = {
      projectManager: {
        views: {},
        getProjectMetadata: vi.fn(() => metadata),
        loadProjectFromData: vi.fn(async () => undefined),
        setProjectMetadata: vi.fn((patch: any) => {
          metadata = { ...metadata, ...patch };
          return metadata;
        }),
      },
    };
    const cloudSaveRequested = vi.fn();
    window.addEventListener('openpaint:request-cloud-save', cloudSaveRequested);
    let releaseFirstImport: (() => void) | null = null;
    const firstImportGate = new Promise<void>(resolve => {
      releaseFirstImport = resolve;
    });
    const uploadManager = {
      handleFiles: vi.fn(async (files: File[]) => {
        if (files[0]?.name === 'front.png') await firstImportGate;
        const viewId = String(files[0]?.name || 'image').replace(/\.[^.]+$/, '');
        return [{ success: true, viewId }];
      }),
      showStatus: vi.fn(),
    };
    initExtensionImageImport(uploadManager);
    expect(document.documentElement.dataset.openpaintExtensionImportReady).toBe('true');
    const batchId = 'test-batch';
    const png = 'data:image/png;base64,iVBORw0KGgo=';

    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_BEGIN',
        batchId,
        total: 2,
        ticketContext: {
          ticketId: '221130761',
          ticketUrl: 'https://comfort-works.gorgias.com/app/ticket/221130761',
          customerName: 'Jamie Customer',
          productName: 'Boxed Seat Snug Fit Armless Chair Slipcover',
          productSku: 'CS1B-NA-SNUG__PO__VELC__SP__BEN-04',
        },
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_IMAGE',
        batchId,
        index: 1,
        name: 'back.png',
        mime: 'image/png',
        hash: 'back-hash',
        dataUrl: png,
      })
    );

    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_IMAGE',
        batchId,
        index: 0,
        name: 'front.png',
        mime: 'image/png',
        hash: 'front-hash',
        dataUrl: png,
      })
    );

    await vi.waitFor(() => expect(uploadManager.handleFiles).toHaveBeenCalledTimes(1));
    expect((uploadManager.handleFiles.mock.calls[0][0] as File[]).map(file => file.name)).toEqual([
      'front.png',
    ]);
    expect(uploadManager.handleFiles.mock.calls[0][1]).toEqual({ suppressStatus: true });
    releaseFirstImport?.();

    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_COMPLETE',
        batchId,
        importedCount: 2,
      })
    );

    await vi.waitFor(() => expect(uploadManager.handleFiles).toHaveBeenCalledTimes(2));
    const importedNames = uploadManager.handleFiles.mock.calls.flatMap(call =>
      (call[0] as File[]).map(file => file.name)
    );
    expect(importedNames).toEqual(['front.png', 'back.png']);
    expect(
      uploadManager.handleFiles.mock.calls.every(call =>
        (call[0] as File[]).every(file => file.type === 'image/png')
      )
    ).toBe(true);
    await vi.waitFor(() => expect(cloudSaveRequested).toHaveBeenCalledTimes(1));
    expect(metadata.naming).toEqual(
      expect.objectContaining({
        customerName: 'Jamie Customer',
        sofaTypeLabel: 'Boxed Seat Snug Fit Armless Chair Slipcover',
      })
    );
    expect(metadata.measurementGuideLibraryCodes).toContain('CS1B-NA-SNUG');
    expect(metadata.externalSources.gorgiasTickets['221130761'].importedImageHashes.sort()).toEqual(
      ['back-hash', 'front-hash']
    );
    expect((document.getElementById('projectName') as HTMLInputElement).value).toBe(
      'Jamie Customer - Boxed Seat Snug Fit Armless Chair Slipcover'
    );
    expect(document.getElementById('gorgiasTicketSourceLink')).toEqual(
      expect.objectContaining({
        textContent: 'Gorgias #221130761',
        href: 'https://comfort-works.gorgias.com/app/ticket/221130761',
      })
    );
    expect(document.getElementById('gorgiasCloudSaveStatus')?.textContent).toBe('Saving...');
    window.dispatchEvent(
      new CustomEvent('openpaint:cloud-save-status', {
        detail: { status: 'saved', savedAt: '2026-07-16T01:02:03.000Z' },
      })
    );
    expect(document.getElementById('gorgiasCloudSaveStatus')).toEqual(
      expect.objectContaining({ textContent: 'Cloud saved' })
    );
    window.dispatchEvent(
      new CustomEvent('openpaint:cloud-save-status', {
        detail: { status: 'dirty', message: 'Changes not saved' },
      })
    );
    expect(document.getElementById('gorgiasCloudSaveStatus')).toEqual(
      expect.objectContaining({ textContent: 'Changes not saved' })
    );

    uploadManager.handleFiles.mockClear();
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_BEGIN',
        batchId: 'repeat-batch',
        total: 1,
        ticketContext: {
          ticketId: '221130761',
          ticketUrl: 'https://comfort-works.gorgias.com/app/ticket/221130761',
          productSku: 'CS1B-NA-SNUG__PO__VELC__SP__BEN-04',
        },
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_IMAGE',
        batchId: 'repeat-batch',
        index: 0,
        name: 'front-again.png',
        mime: 'image/png',
        hash: 'front-hash',
        dataUrl: png,
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_COMPLETE',
        batchId: 'repeat-batch',
        importedCount: 1,
      })
    );
    await vi.waitFor(() => expect(cloudSaveRequested).toHaveBeenCalledTimes(2));
    expect(uploadManager.handleFiles).not.toHaveBeenCalled();
    expect(metadata.externalSources.gorgiasTickets['221130761']).toEqual(
      expect.objectContaining({
        customerName: 'Jamie Customer',
        productName: 'Boxed Seat Snug Fit Armless Chair Slipcover',
      })
    );

    (document.getElementById('projectName') as HTMLInputElement).value = 'OpenPaint Project';
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_BEGIN',
        batchId: 'customer-only-batch',
        total: 1,
        ticketContext: {
          ticketId: '230998813',
          ticketUrl: 'https://comfort-works.gorgias.com/app/ticket/230998813',
          customerName: 'Alex Customer',
        },
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_IMAGE',
        batchId: 'customer-only-batch',
        index: 0,
        name: 'new-ticket.png',
        mime: 'image/png',
        hash: 'new-ticket-hash',
        dataUrl: png,
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_COMPLETE',
        batchId: 'customer-only-batch',
        importedCount: 1,
      })
    );
    await vi.waitFor(() =>
      expect(document.querySelector('.gorgias-import-destination')).not.toBeNull()
    );
    expect(uploadManager.handleFiles).not.toHaveBeenCalled();
    (document.querySelector('[data-import-destination="current"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(uploadManager.handleFiles).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect((document.getElementById('projectName') as HTMLInputElement).value).toBe(
        'Alex Customer'
      )
    );
    expect(metadata.naming).toEqual(
      expect.objectContaining({
        customerName: 'Alex Customer',
        autoProjectTitle: 'Alex Customer',
      })
    );

    uploadManager.handleFiles.mockClear();
    vi.spyOn(cloudSaveService, 'listProjects').mockResolvedValue({
      success: true,
      data: [
        {
          id: 'matching-cloud-project',
          name: 'Taylor Customer - CS3B Sofa',
          user_id: 'user-1',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-17T00:00:00.000Z',
        },
      ],
    } as any);
    vi.spyOn(cloudSaveService, 'loadProject').mockResolvedValue({
      success: true,
      data: {
        id: 'matching-cloud-project',
        name: 'Taylor Customer - CS3B Sofa',
        user_id: 'user-1',
        data: {
          version: '2.0-fabric',
          projectName: 'Taylor Customer - CS3B Sofa',
          metadata: {},
          views: { front: {} },
        },
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-17T00:00:00.000Z',
      },
    } as any);
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_BEGIN',
        batchId: 'existing-cloud-batch',
        total: 1,
        ticketContext: {
          ticketId: '230998999',
          customerName: 'Taylor Customer',
          productName: 'CS3B Sofa',
          guideCode: 'CS3B',
        },
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_IMAGE',
        batchId: 'existing-cloud-batch',
        index: 0,
        name: 'side.png',
        mime: 'image/png',
        hash: 'cloud-side-hash',
        dataUrl: png,
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_COMPLETE',
        batchId: 'existing-cloud-batch',
        importedCount: 1,
      })
    );
    await vi.waitFor(() =>
      expect(document.querySelector('.gorgias-import-match')?.textContent).toBe('Likely match')
    );
    const saveFirst = document.querySelector<HTMLInputElement>('.gorgias-import-save-first input');
    if (saveFirst) saveFirst.checked = false;
    (document.querySelector('[data-import-destination="existing"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(cloudSaveService.loadProject).toHaveBeenCalledWith('matching-cloud-project')
    );
    await vi.waitFor(() => expect(uploadManager.handleFiles).toHaveBeenCalledTimes(1));
    expect((window as any).app.projectManager.loadProjectFromData).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'Taylor Customer - CS3B Sofa' })
    );

    uploadManager.handleFiles.mockClear();
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_BEGIN',
        batchId: 'new-project-batch',
        total: 1,
        ticketContext: {
          ticketId: '230999000',
          customerName: 'Morgan Customer',
          productName: 'Custom Armchair',
        },
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_IMAGE',
        batchId: 'new-project-batch',
        index: 0,
        name: 'chair.png',
        mime: 'image/png',
        hash: 'new-project-image-hash',
        dataUrl: png,
      })
    );
    window.dispatchEvent(
      extensionMessage({
        source: 'sofapaint-gorgias-extension',
        type: 'IMPORT_COMPLETE',
        batchId: 'new-project-batch',
        importedCount: 1,
      })
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-import-destination="new"]')).not.toBeNull()
    );
    const newProjectSaveFirst = document.querySelector<HTMLInputElement>(
      '.gorgias-import-save-first input'
    );
    if (newProjectSaveFirst) newProjectSaveFirst.checked = false;
    (document.querySelector('[data-import-destination="new"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(uploadManager.handleFiles).toHaveBeenCalledTimes(1));
    expect((window as any).app.projectManager.loadProjectFromData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectName: 'Morgan Customer - Custom Armchair',
        currentViewId: 'front',
        views: expect.objectContaining({ front: expect.any(Object), cushion: expect.any(Object) }),
      })
    );
    expect(cloudSaveService.getCurrentProjectId()).toBeNull();
    window.removeEventListener('openpaint:request-cloud-save', cloudSaveRequested);
  });
});
