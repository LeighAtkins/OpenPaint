// @ts-nocheck
/**
 * MeasurementOverlayManager — orchestrates MOS overlay lifecycle.
 *
 * Responsibilities:
 *  - Maintains the MeasurementOverlayStore
 *  - Imports/exports MOS SVG via importer/exporter modules
 *  - Listens for background-image and viewport changes
 *  - Coordinates edit controls and undo/redo snapshots
 *  - Persists to Supabase / R2
 */

import type { CanvasManager } from '../CanvasManager';
import type { HistoryManager } from '../HistoryManager';
import type {
  MeasurementOverlay,
  MeasurementOverlayStore,
  ImageRect,
  MeasurementOverlayElement,
  MosFabricCustomData,
} from './types';
import { getImageRect, mosToCanvas } from './mos-transform';
import { exportMosSvg } from './mos-exporter';

export class MeasurementOverlayManager {
  private canvasManager: CanvasManager;
  private historyManager: HistoryManager;
  private store: MeasurementOverlayStore;
  private _disposed = false;
  private _editControlsCleanup: (() => void) | null = null;
  private _uiCleanup: (() => void) | null = null;
  private _overlayTagKeys = new Map<string, string[]>();

  constructor(canvasManager: CanvasManager, historyManager: HistoryManager) {
    this.canvasManager = canvasManager;
    this.historyManager = historyManager;

    this.store = {
      byId: new Map(),
      order: [],
      activeId: null,
      nextOverlayIndex: 0,
    };

    this._bindEvents();
    this._initEditControls();
    this._pushDebug('manager:init', {});
    console.log('[MOS] MeasurementOverlayManager initialised');
  }

  // -----------------------------------------------------------------------
  // Event binding
  // -----------------------------------------------------------------------

  private _bindEvents(): void {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    // Listen for image rect changes (fired from ProjectManager after setBackgroundImage)
    canvas.on('mos:imageRect:changed', () => {
      this._repositionAllOverlays();
    });
  }

  // -----------------------------------------------------------------------
  // Edit controls
  // -----------------------------------------------------------------------

  private async _initEditControls(): Promise<void> {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    const { initMosEditControls } = await import('./mos-edit-controls');

    this._editControlsCleanup = initMosEditControls(
      canvas,
      (fabricObj: any) => {
        const cd = fabricObj.customData as MosFabricCustomData | undefined;
        if (!cd || cd.layerType !== 'mos-overlay') return undefined;
        const overlay = this.store.byId.get(cd.overlayId);
        return overlay?.elements.get(cd.elementId);
      },
      (element: MeasurementOverlayElement) => {
        // Mark overlay as dirty
        for (const overlay of this.store.byId.values()) {
          if (overlay.elements.has(element.id)) {
            overlay.dirty = true;
            break;
          }
        }
      }
    );
  }

  // -----------------------------------------------------------------------
  // UI initialisation (call after app is fully ready)
  // -----------------------------------------------------------------------

  async initUI(projectManager: any): Promise<void> {
    const { initMosGenerateUI } = await import('./mos-generate-ui');
    this._uiCleanup = initMosGenerateUI(this, this.canvasManager, projectManager);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  getStore(): MeasurementOverlayStore {
    return this.store;
  }

  getOverlay(id: string): MeasurementOverlay | undefined {
    return this.store.byId.get(id);
  }

  getActiveOverlay(): MeasurementOverlay | undefined {
    return this.store.activeId ? this.store.byId.get(this.store.activeId) : undefined;
  }

  setActiveOverlay(id: string | null): void {
    this.store.activeId = id;
  }

  // -----------------------------------------------------------------------
  // Import
  // -----------------------------------------------------------------------

  /**
   * Import an MOS SVG string and render it on the canvas.
   * Returns the overlay ID.
   */
  async importSvg(
    svgText: string,
    viewId: string,
    options?: {
      sourceR2Key?: string;
      supabaseId?: string;
    }
  ): Promise<string> {
    // Lazy-load importer to keep initial bundle small
    const { importMosSvg } = await import('./mos-importer');
    const { sanitizeAndPrefixSvg } = await import('./mos-sanitizer');

    const overlayIndex = this.store.nextOverlayIndex++;
    const sanitised = sanitizeAndPrefixSvg(svgText, overlayIndex);

    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) throw new Error('[MOS] No canvas available');

    const imageRect = getImageRect(canvas);

    const overlay = importMosSvg(sanitised, overlayIndex, viewId, imageRect, canvas, {
      sourceR2Key: options?.sourceR2Key,
      supabaseId: options?.supabaseId,
    });

    this._pushDebug('import:svg', {
      viewId,
      overlayId: overlay.id,
      sourceR2Key: options?.sourceR2Key || null,
      supabaseId: options?.supabaseId || null,
      elementCount: overlay.elements.size,
    });

    this.store.byId.set(overlay.id, overlay);
    this.store.order.push(overlay.id);
    this.store.activeId = overlay.id;

    this._syncOverlayTags(overlay.id);

    canvas.requestRenderAll();
    console.log(`[MOS] Imported overlay ${overlay.id} with ${overlay.elements.size} elements`);
    return overlay.id;
  }

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  /**
   * Export the given overlay back to an MOS SVG string.
   */
  async exportSvg(overlayId: string): Promise<string> {
    const overlay = this.store.byId.get(overlayId);
    if (!overlay) throw new Error(`[MOS] Overlay ${overlayId} not found`);

    const { exportMosSvg } = await import('./mos-exporter');
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) throw new Error('[MOS] No canvas available');

    const imageRect = getImageRect(canvas);
    return exportMosSvg(overlay, imageRect);
  }

  // -----------------------------------------------------------------------
  // Remove
  // -----------------------------------------------------------------------

  removeOverlay(overlayId: string): void {
    const overlay = this.store.byId.get(overlayId);
    if (!overlay) return;

    const canvas = this.canvasManager.fabricCanvas;
    if (canvas) {
      // Remove all Fabric objects belonging to this overlay
      const toRemove = canvas.getObjects().filter((obj: any) => {
        const cd = obj.customData as MosFabricCustomData | undefined;
        return cd?.layerType === 'mos-overlay' && cd?.overlayId === overlayId;
      });
      toRemove.forEach((obj: any) => canvas.remove(obj));
      canvas.requestRenderAll();
    }

    this._clearOverlayTags(overlayId);
    this.store.byId.delete(overlayId);
    this.store.order = this.store.order.filter(id => id !== overlayId);
    if (this.store.activeId === overlayId) {
      this.store.activeId = this.store.order[0] ?? null;
    }

    console.log(`[MOS] Removed overlay ${overlayId}`);
  }

  // -----------------------------------------------------------------------
  // Reposition on image/viewport change
  // -----------------------------------------------------------------------

  private _repositionAllOverlays(): void {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    const imageRect = getImageRect(canvas);

    for (const overlay of this.store.byId.values()) {
      this._repositionOverlay(overlay, imageRect, canvas);
    }

    canvas.requestRenderAll();
  }

  private _repositionOverlay(overlay: MeasurementOverlay, imageRect: ImageRect, canvas: any): void {
    // mosToCanvas imported at top of file

    for (const element of overlay.elements.values()) {
      // For lines with two endpoints, reposition both ends
      if (element.kind === 'measureLine' && element.endpoints.length === 2) {
        const lineObj = canvas.getObjects().find((o: any) => o.__mosId === `${element.id}_line`);
        if (lineObj && lineObj.type === 'line') {
          const p1 = mosToCanvas(element.endpoints[0].point, imageRect);
          const p2 = mosToCanvas(element.endpoints[1].point, imageRect);
          const cx = (p1.x + p2.x) / 2;
          const cy = (p1.y + p2.y) / 2;
          lineObj.set({
            x1: p1.x - cx,
            y1: p1.y - cy,
            x2: p2.x - cx,
            y2: p2.y - cy,
            left: cx,
            top: cy,
          });
          lineObj.setCoords();
        }
      }

      // Reposition labels
      if (element.label) {
        const labelObj = canvas.getObjects().find((o: any) => o.__mosId === `${element.id}_label`);
        if (labelObj) {
          const lp = mosToCanvas({ x: element.label.cx, y: element.label.cy }, imageRect);
          labelObj.set({ left: lp.x, top: lp.y });
          labelObj.setCoords();
        }
      }

      // Reposition single-point elements (leaders, shape hints)
      if (element.endpoints.length === 1) {
        const suffix = element.kind === 'leader' ? '_leader' : '_marker';
        const obj = canvas.getObjects().find((o: any) => o.__mosId === `${element.id}${suffix}`);
        if (obj) {
          const cp = mosToCanvas(element.endpoints[0].point, imageRect);
          obj.set({ left: cp.x, top: cp.y });
          obj.setCoords();
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // View switching support
  // -----------------------------------------------------------------------

  /**
   * Remove all Fabric objects for the current view (before switching away).
   */
  unmountView(viewId: string): void {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    const toRemove = canvas.getObjects().filter((obj: any) => {
      const cd = obj.customData as MosFabricCustomData | undefined;
      if (cd?.layerType !== 'mos-overlay') return false;
      const overlay = this.store.byId.get(cd.overlayId);
      return overlay?.viewId === viewId;
    });
    toRemove.forEach((obj: any) => canvas.remove(obj));
    for (const overlay of this.store.byId.values()) {
      if (overlay.viewId === viewId) {
        this._clearOverlayTags(overlay.id);
      }
    }
    canvas.requestRenderAll();
  }

  /**
   * Re-render all overlays for the given view.
   */
  async mountView(viewId: string): Promise<void> {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    const imageRect = getImageRect(canvas);

    // Defensive cleanup to avoid duplicate overlay objects when mountView is called repeatedly.
    this.unmountView(viewId);

    for (const overlay of this.store.byId.values()) {
      if (overlay.viewId !== viewId) continue;

      const { remountOverlayObjects } = await import('./mos-importer');
      remountOverlayObjects(overlay, imageRect, canvas);
      this._syncOverlayTags(overlay.id);
    }

    canvas.requestRenderAll();
  }

  // -----------------------------------------------------------------------
  // Serialisation (for project save/load)
  // -----------------------------------------------------------------------

  toJSON(): object {
    const overlays: object[] = [];
    const canvas = this.canvasManager.fabricCanvas;
    const imageRect = canvas
      ? getImageRect(canvas)
      : { left: 0, top: 0, width: 1000, height: 1000 };

    for (const id of this.store.order) {
      const overlay = this.store.byId.get(id);
      if (!overlay) continue;

      // Always serialize current model geometry so edited positions persist across view/project reload.
      const currentSvgText = exportMosSvg(overlay, imageRect);
      overlays.push({
        id: overlay.id,
        viewId: overlay.viewId,
        overlayIndex: overlay.overlayIndex,
        svgText: currentSvgText,
        sourceR2Key: overlay.sourceR2Key,
        supabaseId: overlay.supabaseId,
      });
    }
    return {
      nextOverlayIndex: this.store.nextOverlayIndex,
      overlays,
    };
  }

  async fromJSON(data: any): Promise<void> {
    if (!data || !Array.isArray(data.overlays)) return;

    this.store.nextOverlayIndex = data.nextOverlayIndex ?? 0;
    const activeViewId = window.app?.projectManager?.currentViewId;

    for (const entry of data.overlays) {
      await this.importSvg(entry.svgText, entry.viewId, {
        sourceR2Key: entry.sourceR2Key,
        supabaseId: entry.supabaseId,
      });

      // Keep only the active view mounted on canvas; other overlays stay in the store.
      if (activeViewId && entry.viewId !== activeViewId) {
        this.unmountView(entry.viewId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Supabase persistence
  // -----------------------------------------------------------------------

  /**
   * Persist all dirty overlays to Supabase.
   */
  async persistToSupabase(): Promise<void> {
    try {
      const { getSupabaseClient } = await import('../../../src/config/supabase.config');
      const clientResult = getSupabaseClient();
      if (!clientResult.ok) {
        console.warn('[MOS] Supabase not available, skipping persist');
        return;
      }
      const supabase = clientResult.value;

      for (const overlay of this.store.byId.values()) {
        if (!overlay.dirty) continue;

        // Export current SVG from model
        const { exportMosSvg } = await import('./mos-exporter');
        const canvas = this.canvasManager.fabricCanvas;
        if (!canvas) continue;
        const imageRect = getImageRect(canvas);
        const svgText = exportMosSvg(overlay, imageRect);

        if (overlay.supabaseId) {
          // Update existing row
          const { error } = await supabase
            .from('mos_overlays')
            .update({ svg_text: svgText })
            .eq('id', overlay.supabaseId);

          if (error) {
            console.error(`[MOS] Failed to update overlay ${overlay.id}:`, error);
          } else {
            overlay.svgText = svgText;
            overlay.dirty = false;
          }
        } else {
          // Insert new row
          const { data, error } = await supabase
            .from('mos_overlays')
            .insert({
              project_id: 'local', // Will be set properly when project has a cloud ID
              view_id: overlay.viewId,
              overlay_index: overlay.overlayIndex,
              svg_text: svgText,
              r2_key: overlay.sourceR2Key || null,
            })
            .select('id')
            .single();

          if (error) {
            console.error(`[MOS] Failed to insert overlay ${overlay.id}:`, error);
          } else if (data) {
            overlay.supabaseId = data.id;
            overlay.svgText = svgText;
            overlay.dirty = false;
          }
        }
      }
    } catch (err) {
      console.error('[MOS] persistToSupabase failed:', err);
    }
  }

  /**
   * Load all overlays for a project from Supabase.
   */
  async loadFromSupabase(projectId: string, viewId?: string): Promise<void> {
    try {
      const { getSupabaseClient } = await import('../../../src/config/supabase.config');
      const clientResult = getSupabaseClient();
      if (!clientResult.ok) {
        console.warn('[MOS] Supabase not available, skipping load');
        return;
      }
      const supabase = clientResult.value;

      let query = supabase
        .from('mos_overlays')
        .select('*')
        .eq('project_id', projectId)
        .order('overlay_index', { ascending: true });

      if (viewId) {
        query = query.eq('view_id', viewId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[MOS] Failed to load overlays from Supabase:', error);
        return;
      }

      if (!data || data.length === 0) return;

      for (const row of data) {
        await this.importSvg(row.svg_text, row.view_id, {
          sourceR2Key: row.r2_key ?? undefined,
          supabaseId: row.id,
        });

        const activeViewId = window.app?.projectManager?.currentViewId;
        if (activeViewId && row.view_id !== activeViewId) {
          this.unmountView(row.view_id);
        }
      }

      console.log(`[MOS] Loaded ${data.length} overlays from Supabase`);
    } catch (err) {
      console.error('[MOS] loadFromSupabase failed:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  dispose(): void {
    this._disposed = true;
    this._editControlsCleanup?.();
    this._uiCleanup?.();
    const canvas = this.canvasManager.fabricCanvas;
    if (canvas) {
      canvas.off('mos:imageRect:changed');
    }
    this.store.byId.clear();
    this._overlayTagKeys.clear();
    this.store.order = [];
    this.store.activeId = null;
    console.log('[MOS] MeasurementOverlayManager disposed');
  }

  private _syncOverlayTags(overlayId: string): void {
    const overlay = this.store.byId.get(overlayId);
    if (!overlay) return;

    const tagManager = window.app?.tagManager;
    const metadataManager = window.app?.metadataManager;
    if (!tagManager) return;

    this._clearOverlayTags(overlayId);

    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    const createdKeys: string[] = [];
    const createdRoles: string[] = [];

    for (const element of overlay.elements.values()) {
      if (element.kind !== 'measureLine') continue;

      const roleToken = this._deriveRoleToken(element);
      if (!roleToken) continue;

      const lineObj = canvas.getObjects().find((o: any) => o.__mosId === `${element.id}_line`);
      if (!lineObj) continue;

      if (lineObj?.customData) {
        lineObj.customData.roleToken = roleToken;
      }

      if (metadataManager?.attachMetadata) {
        metadataManager.attachMetadata(lineObj, overlay.viewId, roleToken);
      }

      tagManager.createTag(roleToken, overlay.viewId, lineObj);
      createdKeys.push(roleToken);
      createdRoles.push(roleToken);
    }

    this._overlayTagKeys.set(overlayId, createdKeys);
    if (metadataManager?.updateStrokeVisibilityControls) {
      metadataManager.updateStrokeVisibilityControls();
    }
    this._pushDebug('tags:sync', {
      overlayId,
      viewId: overlay.viewId,
      createdCount: createdKeys.length,
      createdRoles,
    });
  }

  private _clearOverlayTags(overlayId: string): void {
    const overlay = this.store.byId.get(overlayId);
    const tagManager = window.app?.tagManager;
    const metadataManager = window.app?.metadataManager;
    if (!tagManager || !overlay) return;

    const keys = this._overlayTagKeys.get(overlayId) || [];
    for (const strokeLabel of keys) {
      tagManager.removeTag(strokeLabel, overlay.viewId);
      if (metadataManager) {
        if (metadataManager.vectorStrokesByImage?.[overlay.viewId]?.[strokeLabel]) {
          delete metadataManager.vectorStrokesByImage[overlay.viewId][strokeLabel];
        }
        if (
          metadataManager.strokeVisibilityByImage?.[overlay.viewId]?.[strokeLabel] !== undefined
        ) {
          delete metadataManager.strokeVisibilityByImage[overlay.viewId][strokeLabel];
        }
        if (metadataManager.strokeLabelVisibility?.[overlay.viewId]?.[strokeLabel] !== undefined) {
          delete metadataManager.strokeLabelVisibility[overlay.viewId][strokeLabel];
        }
        if (metadataManager.strokeMeasurements?.[overlay.viewId]?.[strokeLabel] !== undefined) {
          delete metadataManager.strokeMeasurements[overlay.viewId][strokeLabel];
        }
      }
    }
    this._overlayTagKeys.delete(overlayId);
    if (metadataManager?.updateStrokeVisibilityControls) {
      metadataManager.updateStrokeVisibilityControls();
    }
    this._pushDebug('tags:clear', {
      overlayId,
      viewId: overlay.viewId,
      clearedCount: keys.length,
      clearedRoles: keys,
    });
  }

  private _debugEnabled(): boolean {
    try {
      return new URLSearchParams(window.location.search).has('debug');
    } catch {
      return false;
    }
  }

  private _pushDebug(stage: string, payload: Record<string, unknown>): void {
    if (!this._debugEnabled()) return;
    const w = window as any;
    if (!Array.isArray(w.__MOS_DEBUG_LOGS)) {
      w.__MOS_DEBUG_LOGS = [];
    }
    const entry = {
      ts: new Date().toISOString(),
      stage,
      ...payload,
    };
    w.__MOS_DEBUG_LOGS.push(entry);
    w.__MOS_DEBUG_LAST = entry;
  }

  private _deriveRoleToken(element: MeasurementOverlayElement): string {
    if (element.roleToken) return element.roleToken.toUpperCase();
    const normalized = (element.opId || '').replace(/^mos\d+_/, '').trim();
    if (!/^[mbc][a-z0-9_-]+$/i.test(normalized)) return '';
    const token = normalized
      .slice(1)
      .replace(/_(label|text)$/i, '')
      .replace(/(?:CM|MM|IN)\d*$/i, '')
      .replace(/[^a-z0-9-]/gi, '')
      .toUpperCase();
    return token;
  }
}
