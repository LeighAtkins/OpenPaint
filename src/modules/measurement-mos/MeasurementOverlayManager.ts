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

export class MeasurementOverlayManager {
  private canvasManager: CanvasManager;
  private historyManager: HistoryManager;
  private store: MeasurementOverlayStore;
  private _disposed = false;
  private _editControlsCleanup: (() => void) | null = null;
  private _uiCleanup: (() => void) | null = null;

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

    this.store.byId.set(overlay.id, overlay);
    this.store.order.push(overlay.id);
    this.store.activeId = overlay.id;

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
  unmountView(_viewId: string): void {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    const toRemove = canvas.getObjects().filter((obj: any) => {
      const cd = obj.customData as MosFabricCustomData | undefined;
      return cd?.layerType === 'mos-overlay';
    });
    toRemove.forEach((obj: any) => canvas.remove(obj));
  }

  /**
   * Re-render all overlays for the given view.
   */
  async mountView(viewId: string): Promise<void> {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    const imageRect = getImageRect(canvas);

    for (const overlay of this.store.byId.values()) {
      if (overlay.viewId !== viewId) continue;

      const { remountOverlayObjects } = await import('./mos-importer');
      remountOverlayObjects(overlay, imageRect, canvas);
    }

    canvas.requestRenderAll();
  }

  // -----------------------------------------------------------------------
  // Serialisation (for project save/load)
  // -----------------------------------------------------------------------

  toJSON(): object {
    const overlays: object[] = [];
    for (const id of this.store.order) {
      const overlay = this.store.byId.get(id);
      if (!overlay) continue;
      overlays.push({
        id: overlay.id,
        viewId: overlay.viewId,
        overlayIndex: overlay.overlayIndex,
        svgText: overlay.svgText,
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

    for (const entry of data.overlays) {
      await this.importSvg(entry.svgText, entry.viewId, {
        sourceR2Key: entry.sourceR2Key,
        supabaseId: entry.supabaseId,
      });
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
    this.store.order = [];
    this.store.activeId = null;
    console.log('[MOS] MeasurementOverlayManager disposed');
  }
}
