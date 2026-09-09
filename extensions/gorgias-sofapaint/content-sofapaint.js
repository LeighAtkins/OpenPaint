if (!globalThis.__gorgiasSofaPaintContentBridge) {
  globalThis.__gorgiasSofaPaintContentBridge = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SOFAPAINT_IMPORT_READY') {
      sendResponse({
        ok: true,
        ready: Boolean(
          document.getElementById('canvas') &&
            document.documentElement.dataset.openpaintExtensionImportReady === 'true'
        ),
      });
      return false;
    }
    if (message?.type === 'SOFAPAINT_PROJECT_STATUS') {
      const requestId = `status-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onStatus);
        sendResponse({ ok: false, message: 'SofaPaint project status timed out' });
      }, 3000);
      const onStatus = event => {
        if (
          event.source !== window ||
          event.data?.source !== 'sofapaint-gorgias-project-status' ||
          event.data.requestId !== requestId
        )
          return;
        clearTimeout(timeout);
        window.removeEventListener('message', onStatus);
        sendResponse({ ok: true, ...event.data.status });
      };
      window.addEventListener('message', onStatus);
      window.postMessage(
        {
          source: 'sofapaint-gorgias-extension',
          type: 'PROJECT_STATUS_REQUEST',
          requestId,
          ticketId: String(message.ticketId || ''),
        },
        window.location.origin
      );
      return true;
    }
    if (message?.type === 'SOFAPAINT_OPEN_PROJECT') {
      const requestId = `open-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.postMessage(
        {
          source: 'sofapaint-gorgias-extension',
          type: 'OPEN_PROJECT_REQUEST',
          requestId,
          projectId: String(message.projectId || ''),
        },
        window.location.origin
      );
      // Acknowledge dispatch immediately. Loading a cloud project may take longer
      // than Chrome keeps the popup message channel alive.
      sendResponse({ ok: true, opening: true });
      return false;
    }
    if (!message || !['IMPORT_BEGIN', 'IMPORT_IMAGE', 'IMPORT_COMPLETE'].includes(message.type)) {
      return false;
    }
    if (!document.getElementById('canvas')) {
      sendResponse({ ok: false, message: 'This tab is not SofaPaint.' });
      return false;
    }
    window.postMessage(
      {
        source: 'sofapaint-gorgias-extension',
        type: message.type,
        batchId: message.batchId,
        index: message.index,
        name: message.name,
        mime: message.mime,
        hash: message.hash,
        dataUrl: message.dataUrl,
        total: message.total,
        importedCount: message.importedCount,
        duplicateCount: message.duplicateCount,
        errorCount: message.errorCount,
        ticketContext: message.ticketContext,
      },
      window.location.origin
    );
    sendResponse({ ok: true });
    return false;
  });
}
