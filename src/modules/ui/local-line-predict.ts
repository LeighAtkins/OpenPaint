/**
 * Local SofaPaint ML Line Prediction UI ("Auto Lines")
 *
 * Calls the local Express relay (/api/local-predict-lines -> WSL RTX 4070 service on :8091)
 * to classify the sofa view (Front / Side / Back / Cushion) and import editable measurement
 * lines directly onto the active OpenPaint Fabric.js canvas via MeasurementOverlayManager.
 */

import { captureBackgroundImageDataUrl } from '../measurement-mos/mos-generate-client';

interface LocalPredictResponse {
  success: boolean;
  view?: string;
  predictedView?: string;
  viewConf?: number;
  lines?: Array<{ label: string; conf: number }>;
  svg?: string;
  elapsedMs?: number;
  error?: string;
}

type AnyObj = Record<string, any>;

async function ensureOverlayManager(app: AnyObj): Promise<AnyObj> {
  let om = app?.measurementOverlayManager;
  if (!om?.importSvg && app?.initDeferredManagers) {
    await app.initDeferredManagers();
    om = app.measurementOverlayManager;
  }
  if (!om?.importSvg) {
    throw new Error('Measurement overlay manager is not ready yet.');
  }
  return om;
}

export async function runLocalAutoLines(
  options: { viewOverride?: string; flipArm?: boolean } = {}
): Promise<LocalPredictResponse> {
  const win = window as AnyObj;
  const app = win.app;
  const canvas = app?.canvasManager?.fabricCanvas;
  if (!canvas?.backgroundImage) {
    throw new Error('Load a sofa photo onto the canvas first.');
  }

  const imageDataUrl = captureBackgroundImageDataUrl(canvas);
  if (!imageDataUrl) {
    throw new Error('Could not capture the current canvas image.');
  }

  const resp = await fetch('/api/local-predict-lines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageDataUrl,
      viewOverride: options.viewOverride || 'auto',
      flipArm: Boolean(options.flipArm),
    }),
  });

  const data = (await resp.json().catch(() => ({}))) as LocalPredictResponse;
  if (!resp.ok || !data.success || !data.svg) {
    throw new Error(data.error || `Local prediction failed (HTTP ${resp.status})`);
  }

  const viewId = app?.projectManager?.currentViewId || win.currentImageLabel || 'front';
  const om = await ensureOverlayManager(app);

  // Preserve existing measurement values & visibility maps across SVG import
  const metadata = app.metadataManager || {};
  const mapNames = ['strokeMeasurements', 'strokeVisibilityByImage', 'strokeLabelVisibility'];
  const kept = Object.fromEntries(
    mapNames.map(name => [name, JSON.parse(JSON.stringify(metadata[name]?.[viewId] || {}))])
  );

  await om.importSvg(data.svg, viewId);

  for (const name of mapNames) {
    if (!metadata[name]) continue;
    metadata[name][viewId] = { ...kept[name], ...(metadata[name][viewId] || {}) };
  }
  for (const label of Object.keys(kept.strokeMeasurements || {})) {
    app.tagManager?.updateTagText?.(label, viewId);
  }
  app.historyManager?.saveState?.({ force: true, reason: 'local-auto-lines' });
  canvas.requestRenderAll?.();

  return data;
}

export function initLocalLinePredictUI(): void {
  if (document.getElementById('localAutoLinesBtn')) return;
  const host = document.getElementById('tbRight');
  if (!host) return;

  const button = document.createElement('button');
  button.id = 'localAutoLinesBtn';
  button.type = 'button';
  button.title = 'Predict measurement lines locally on GPU (Shift+Click to flip arm side)';
  button.textContent = 'Auto Lines';
  button.style.cssText =
    'font-size:12px;font-weight:600;padding:6px 10px;border:1px solid #93c5fd;border-radius:7px;background:#eff6ff;color:#1d4ed8;white-space:nowrap;cursor:pointer';

  host.prepend(button);

  button.addEventListener('click', async event => {
    const win = window as AnyObj;
    const prevText = button.textContent;
    button.disabled = true;
    button.textContent = 'Predicting...';
    try {
      const result = await runLocalAutoLines({ flipArm: event.shiftKey });
      const pct = Math.round((result.viewConf || 0) * 100);
      const count = result.lines?.length || 0;
      const ms = Math.round(result.elapsedMs || 0);
      win.showStatusMessage?.(
        `Auto Lines: ${result.view} (${pct}%) · ${count} lines in ${ms}ms`,
        'success'
      );
    } catch (error) {
      const msg = (error as Error)?.message || 'Auto Lines failed';
      console.error('[Local Auto Lines]', error);
      win.showStatusMessage?.(msg, 'error');
    } finally {
      button.disabled = false;
      button.textContent = prevText;
    }
  });

  // Expose helper for scripting / console testing
  (window as AnyObj).runLocalAutoLines = runLocalAutoLines;
}
