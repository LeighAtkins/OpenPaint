/**
 * SofaPaint ML Auto Lines UI (v4: Group -> SVG Template Match -> Snap + Per-Cushion Splitter)
 *
 * Calls /api/local-predict-lines (Express / Vercel relay -> Modal Tesla T4 or local GPU)
 * to classify the furniture group, match the closest SVG templates, split multi-cushion
 * photos into separate cushions, and import editable lines onto the Fabric.js canvas.
 */

import { captureBackgroundImageDataUrl } from '../measurement-mos/mos-generate-client';

export interface MatchedTemplate {
  id: string;
  modelCode: string;
  source: string;
  path: string;
  pieceType?: string;
  armStyle?: string;
  backStyle?: string;
  baseStyle?: string;
  score: number;
}

export interface CushionInstance {
  index: number;
  label: string;
  shapeCode: string;
  templateId: string;
  bbox: [number, number, number, number];
  areaFrac: number;
}

export interface ArmShapeOption {
  id: string;
  label: string;
  shortLabel: string;
}

export interface LocalPredictResponse {
  success: boolean;
  version?: string;
  view?: string;
  predictedView?: string;
  viewConf?: number;
  productGroup?: string;
  productGroupLabel?: string;
  armShape?: string | null;
  armShapeLabel?: string | null;
  availableArmShapes?: ArmShapeOption[];
  activeTemplate?: string | null;
  matchedTemplates?: MatchedTemplate[];
  cushionInstances?: CushionInstance[];
  activeCushionIndex?: number | 'all' | null;
  lines?: Array<{ label: string; conf: number; isCurve?: boolean }>;
  svg?: string;
  elapsedMs?: number;
  error?: string;
}

export interface AutoLinesOptions {
  viewOverride?: string;
  flipArm?: boolean;
  templateId?: string;
  cushionIndex?: number | 'all' | null;
  armShape?: string;
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
  options: AutoLinesOptions = {}
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
      templateId: options.templateId || '',
      cushionIndex: options.cushionIndex ?? null,
      armShape: options.armShape || '',
    }),
  });

  const data = (await resp.json().catch(() => ({}))) as LocalPredictResponse;
  if (!resp.ok || !data.success || !data.svg) {
    throw new Error(data.error || `Auto Lines prediction failed (HTTP ${resp.status})`);
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

export async function saveAutoLinesReference(
  meta: {
    view?: string;
    armShape?: string | null;
    templateId?: string | null;
    productGroup?: string;
  } = {}
): Promise<{ success: boolean; id?: string; totalSaved?: number; error?: string }> {
  const win = window as AnyObj;
  const app = win.app;
  const canvas = app?.canvasManager?.fabricCanvas;
  if (!canvas?.backgroundImage) {
    throw new Error('Load a photo onto the canvas first.');
  }
  const imageDataUrl = captureBackgroundImageDataUrl(canvas);
  if (!imageDataUrl) {
    throw new Error('Could not capture the current canvas image.');
  }
  const viewId = app?.projectManager?.currentViewId || win.currentImageLabel || 'front';
  const om = await ensureOverlayManager(app);
  const svg = await om.exportSvg(viewId);
  if (!svg) {
    throw new Error('No measurement lines on canvas to save.');
  }
  const resp = await fetch('/api/local-predict-lines/save-reference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageDataUrl,
      svg,
      view: meta.view || 'front_standard',
      armShape: meta.armShape || '',
      templateId: meta.templateId || '',
      productGroup: meta.productGroup || '',
    }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    success: boolean;
    id?: string;
    totalSaved?: number;
    error?: string;
  };
  if (!resp.ok || !data.success) {
    throw new Error(data.error || `Save reference failed (HTTP ${resp.status})`);
  }
  return data;
}

export function initLocalLinePredictUI(): void {
  if (document.getElementById('localAutoLinesBtn')) return;
  const host = document.getElementById('tbRight');
  if (!host) return;

  const wrap = document.createElement('div');
  wrap.id = 'localAutoLinesWrap';
  wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:4px;';

  const button = document.createElement('button');
  button.id = 'localAutoLinesBtn';
  button.type = 'button';
  button.title = 'Predict measurement lines on GPU (Shift+Click to flip arm side)';
  button.textContent = 'Auto Lines';
  button.style.cssText =
    'font-size:12px;font-weight:600;padding:6px 10px;border:1px solid #93c5fd;border-radius:7px;background:#eff6ff;color:#1d4ed8;white-space:nowrap;cursor:pointer';

  const matchBtn = document.createElement('button');
  matchBtn.id = 'localAutoLinesMatchBtn';
  matchBtn.type = 'button';
  matchBtn.style.cssText =
    'display:none;font-size:11px;font-weight:600;padding:5px 8px;border:1px solid #cbd5e1;border-radius:7px;background:#ffffff;color:#334155;white-space:nowrap;cursor:pointer;max-width:165px;overflow:hidden;text-overflow:ellipsis';

  const popover = document.createElement('div');
  popover.id = 'localAutoLinesPopover';
  popover.style.cssText =
    'display:none;position:fixed;z-index:9999;min-width:255px;max-width:320px;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,0.16);padding:10px;font-size:12px;color:#0f172a;';

  wrap.appendChild(button);
  wrap.appendChild(matchBtn);
  host.prepend(wrap);
  document.body.appendChild(popover);

  let lastResult: LocalPredictResponse | null = null;
  let lastFlipArm = false;

  const closePopover = () => {
    popover.style.display = 'none';
  };

  document.addEventListener('click', e => {
    if (!popover.contains(e.target as Node) && e.target !== matchBtn) {
      closePopover();
    }
  });

  const renderPopover = (res: LocalPredictResponse) => {
    popover.innerHTML = '';

    const groupHeader = document.createElement('div');
    groupHeader.style.cssText =
      'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:6px;';
    groupHeader.textContent = res.productGroupLabel || res.productGroup || 'Matched Group';
    popover.appendChild(groupHeader);

    // 1. Closest SVG Templates
    const templates = res.matchedTemplates || [];
    if (templates.length > 0) {
      const tplLabel = document.createElement('div');
      tplLabel.style.cssText = 'font-size:11px;color:#475569;margin-bottom:4px;';
      tplLabel.textContent = 'Closest SVG Templates (click to switch):';
      popover.appendChild(tplLabel);

      for (const tpl of templates) {
        const isActive = res.activeTemplate === tpl.id;
        const item = document.createElement('button');
        item.type = 'button';
        item.style.cssText =
          `display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;padding:6px 8px;margin-bottom:4px;border-radius:6px;cursor:pointer;font-size:12px;` +
          (isActive
            ? 'border:1px solid #3b82f6;background:#eff6ff;color:#1d4ed8;font-weight:600;'
            : 'border:1px solid #e2e8f0;background:#f8fafc;color:#1e293b;');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = tpl.modelCode || tpl.id;
        const scoreSpan = document.createElement('span');
        scoreSpan.style.cssText = 'font-size:11px;color:#64748b;';
        scoreSpan.textContent = `${Math.round((tpl.score || 0) * 100)}%`;
        item.appendChild(nameSpan);
        item.appendChild(scoreSpan);
        item.addEventListener('click', () => {
          closePopover();
          void triggerPredict({ flipArm: lastFlipArm, templateId: tpl.id });
        });
        popover.appendChild(item);
      }
    }

    // 2. Arm Shape Blueprints Switcher (Front Views)
    const armShapes = res.availableArmShapes || [];
    if (armShapes.length > 0) {
      const armLabel = document.createElement('div');
      armLabel.style.cssText =
        'font-size:11px;font-weight:700;color:#475569;margin-top:8px;margin-bottom:5px;border-top:1px solid #e2e8f0;padding-top:8px;';
      armLabel.textContent = `Arm Shape Blueprint (${res.armShapeLabel || res.armShape || 'Auto'}):`;
      popover.appendChild(armLabel);

      const armRow = document.createElement('div');
      armRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
      for (const shape of armShapes) {
        const active = res.armShape === shape.id;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = shape.shortLabel || shape.label;
        b.title = shape.label;
        b.style.cssText =
          'font-size:11px;padding:4px 8px;border-radius:6px;cursor:pointer;' +
          (active
            ? 'border:1px solid #3b82f6;background:#eff6ff;color:#1d4ed8;font-weight:600;'
            : 'border:1px solid #cbd5e1;background:#ffffff;color:#334155;');
        b.addEventListener('click', () => {
          closePopover();
          void triggerPredict({
            flipArm: lastFlipArm,
            templateId: res.activeTemplate || '',
            armShape: shape.id,
          });
        });
        armRow.appendChild(b);
      }
      popover.appendChild(armRow);
    }

    // 3. Separate Cushion Instances Switcher
    const cushions = res.cushionInstances || [];
    if (cushions.length > 1) {
      const cLabel = document.createElement('div');
      cLabel.style.cssText =
        'font-size:11px;font-weight:700;color:#475569;margin-top:8px;margin-bottom:5px;border-top:1px solid #e2e8f0;padding-top:8px;';
      cLabel.textContent = `Separate Cushions Detected (${cushions.length}):`;
      popover.appendChild(cLabel);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
      const makePill = (text: string, idx: number | 'all') => {
        const active = res.activeCushionIndex === idx;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText =
          'font-size:11px;padding:4px 8px;border-radius:6px;cursor:pointer;' +
          (active
            ? 'border:1px solid #3b82f6;background:#eff6ff;color:#1d4ed8;font-weight:600;'
            : 'border:1px solid #cbd5e1;background:#ffffff;color:#334155;');
        b.addEventListener('click', () => {
          closePopover();
          void triggerPredict({ flipArm: lastFlipArm, cushionIndex: idx });
        });
        return b;
      };
      for (const c of cushions) {
        row.appendChild(makePill(`#${c.index + 1} ${c.shapeCode}`, c.index));
      }
      row.appendChild(makePill('All', 'all'));
      popover.appendChild(row);
    }

    // 4. Save Corrected Reference (Active Learning for rare arms / side views / cushions)
    const refWrap = document.createElement('div');
    refWrap.style.cssText = 'margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;';
    const saveRefBtn = document.createElement('button');
    saveRefBtn.type = 'button';
    saveRefBtn.textContent = 'Save Corrected Lines as Training Reference';
    saveRefBtn.style.cssText =
      'width:100%;font-size:11px;font-weight:600;padding:6px 8px;border:1px solid #86efac;border-radius:6px;background:#f0fdf4;color:#15803d;cursor:pointer;';
    saveRefBtn.addEventListener('click', async () => {
      const win = window as AnyObj;
      saveRefBtn.disabled = true;
      saveRefBtn.textContent = 'Saving...';
      try {
        const saved = await saveAutoLinesReference({
          view: res.view,
          armShape: res.armShape,
          templateId: res.activeTemplate,
          productGroup: res.productGroup,
        });
        const tag = res.armShape ? `${res.armShape} · ${res.view}` : res.view || 'reference';
        win.showStatusMessage?.(
          `Saved training reference #${saved.totalSaved ?? 1} (${tag})`,
          'success'
        );
        closePopover();
      } catch (err) {
        const msg = (err as Error)?.message || 'Failed to save reference';
        win.showStatusMessage?.(msg, 'error');
      } finally {
        saveRefBtn.disabled = false;
        saveRefBtn.textContent = 'Save Corrected Lines as Training Reference';
      }
    });
    refWrap.appendChild(saveRefBtn);
    popover.appendChild(refWrap);
  };

  const updateMatchPill = (res: LocalPredictResponse) => {
    lastResult = res;
    const topTpl =
      res.matchedTemplates?.find(t => t.id === res.activeTemplate) || res.matchedTemplates?.[0];
    const cushions = res.cushionInstances || [];
    let label = topTpl?.modelCode || res.productGroup || 'Matched';
    if (cushions.length > 1) {
      const idxText =
        res.activeCushionIndex === 'all'
          ? `All ${cushions.length}`
          : `${Number(res.activeCushionIndex ?? 0) + 1}/${cushions.length}`;
      label = `${label} · ${idxText}`;
    }
    matchBtn.textContent = `${label} ▾`;
    matchBtn.title = `${res.productGroupLabel || ''} — Click to switch SVG template or separate cushions`;
    matchBtn.style.display = 'inline-block';
    renderPopover(res);
  };

  const triggerPredict = async (opts: AutoLinesOptions) => {
    const win = window as AnyObj;
    const prevText = button.textContent;
    button.disabled = true;
    matchBtn.disabled = true;
    button.textContent = 'Predicting...';
    try {
      const result = await runLocalAutoLines(opts);
      updateMatchPill(result);
      const pct = Math.round((result.viewConf || 0) * 100);
      const count = result.lines?.length || 0;
      const ms = Math.round(result.elapsedMs || 0);
      const grp = result.productGroupLabel ? ` · ${result.productGroupLabel}` : '';
      win.showStatusMessage?.(
        `Auto Lines: ${result.view} (${pct}%)${grp} · ${count} lines in ${ms}ms`,
        'success'
      );
    } catch (error) {
      const msg = (error as Error)?.message || 'Auto Lines failed';
      console.error('[Local Auto Lines]', error);
      win.showStatusMessage?.(msg, 'error');
    } finally {
      button.disabled = false;
      matchBtn.disabled = false;
      button.textContent = prevText || 'Auto Lines';
    }
  };

  button.addEventListener('click', event => {
    lastFlipArm = event.shiftKey;
    void triggerPredict({ flipArm: event.shiftKey });
  });

  matchBtn.addEventListener('click', event => {
    event.stopPropagation();
    if (!lastResult) return;
    if (popover.style.display === 'block') {
      closePopover();
      return;
    }
    const rect = matchBtn.getBoundingClientRect();
    popover.style.top = `${Math.round(rect.bottom + 6)}px`;
    popover.style.left = `${Math.max(8, Math.round(rect.right - 270))}px`;
    popover.style.display = 'block';
  });

  // Expose helper for scripting / console testing
  (window as AnyObj).runLocalAutoLines = runLocalAutoLines;
}
