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
import { FabricControls } from '../utils/FabricControls.js';

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
    // Keep a single MOS drawing layer per view.
    this._removeOverlaysForView(viewId);

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

  private _removeOverlaysForView(viewId: string): void {
    const ids = this.store.order.filter(id => this.store.byId.get(id)?.viewId === viewId);
    ids.forEach(id => this.removeOverlay(id));
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
        const lineObj = this._resolveAndPruneStrokeObjectsForElement(canvas, `${element.id}_line`);
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
        } else if (lineObj && lineObj.type === 'path' && Array.isArray(element.curvePoints)) {
          const worldPoints = element.curvePoints.map(point => mosToCanvas(point, imageRect));
          if (worldPoints.length >= 2) {
            const pathData = this._buildSmoothPathFromPoints(worldPoints);
            lineObj.set({ path: fabric.Path.parsePath(pathData) });
            lineObj.customPoints = worldPoints.map(point => ({ x: point.x, y: point.y }));
            if (typeof FabricControls?.canonicalizeCurveFromWorldPoints === 'function') {
              FabricControls.canonicalizeCurveFromWorldPoints(lineObj);
            }
            if (typeof FabricControls?.createCurveControls === 'function') {
              FabricControls.createCurveControls(lineObj);
            }
            if (typeof lineObj.__mosUpdateCurveDecorators === 'function') {
              lineObj.__mosUpdateCurveDecorators();
            } else {
              const startArrow = this._resolveStrokeObjectForElement(
                canvas,
                `${element.id}_curve_start_arrow`
              );
              const endArrow = this._resolveStrokeObjectForElement(
                canvas,
                `${element.id}_curve_end_arrow`
              );
              if (startArrow && endArrow) {
                this._positionCurveArrowheads(worldPoints, startArrow, endArrow);
              }
            }
            lineObj.setCoords?.();
          }
        } else if (lineObj && lineObj.type === 'group' && lineObj.isArrow) {
          const p1 = mosToCanvas(element.endpoints[0].point, imageRect);
          const p2 = mosToCanvas(element.endpoints[1].point, imageRect);
          const children = lineObj.getObjects?.() || [];
          const childLine = children.find((obj: any) => obj?.type === 'line');
          const childHead = children.find((obj: any) => obj?.type === 'triangle');
          const childTailHead = children.filter((obj: any) => obj?.type === 'triangle')[1];
          if (childLine && childHead) {
            childLine.set({
              x1: p1.x,
              y1: p1.y,
              x2: p2.x,
              y2: p2.y,
            });
            childLine._setWidthHeight?.();
            const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI + 90;
            childHead.set({ left: p2.x, top: p2.y, angle });
            if (childTailHead) {
              childTailHead.set({ left: p1.x, top: p1.y, angle: angle - 180 });
            }
            lineObj._calcBounds?.();
            lineObj._updateObjectsCoords?.();
            lineObj.setCoords?.();
          }
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

    // Replace current in-memory overlays with loaded state to avoid duplicate
    // re-imports when project hydration runs multiple times.
    this._resetOverlaysForLoad();

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

  private _resetOverlaysForLoad(): void {
    const canvas = this.canvasManager.fabricCanvas;

    for (const overlayId of this.store.order) {
      this._clearOverlayTags(overlayId);
    }

    if (canvas) {
      const toRemove = canvas.getObjects().filter((obj: any) => {
        const cd = obj.customData as MosFabricCustomData | undefined;
        return cd?.layerType === 'mos-overlay';
      });
      toRemove.forEach((obj: any) => canvas.remove(obj));
    }

    this._overlayTagKeys.clear();
    this.store.byId.clear();
    this.store.order = [];
    this.store.activeId = null;

    if (canvas) {
      canvas.requestRenderAll();
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

    // Single-layer invariant: remove any stale MOS objects from other overlays in this view.
    const staleMosObjects = canvas.getObjects().filter((obj: any) => {
      const cd = obj.customData as MosFabricCustomData | undefined;
      if (cd?.layerType !== 'mos-overlay') return false;
      if (cd.overlayId === overlayId) return false;
      const sourceOverlay = this.store.byId.get(cd.overlayId);
      return sourceOverlay?.viewId === overlay.viewId;
    });
    staleMosObjects.forEach((obj: any) => canvas.remove(obj));

    // De-duplicate any leaked MOS objects by __mosId (keep most recent).
    this._pruneDuplicateMosObjectsById(canvas, overlay.viewId);

    // Remove legacy non-MOS triangle artifacts that overlap MOS curve arrowheads.
    this._pruneLegacyCurveArrowArtifacts(canvas, overlay.viewId);

    // Cleanup leaked orphan line primitives (typically from historical group restore paths).
    const orphanLines = canvas.getObjects().filter((obj: any) => {
      if (!obj || obj.type !== 'line') return false;
      if (obj.isTag || obj.isConnectorLine) return false;
      if (obj?.customData?.layerType === 'mos-overlay') return false;
      if (obj?.strokeMetadata?.strokeLabel) return false;
      if (obj.selectable || obj.evented) return false;
      return true;
    });
    orphanLines.forEach((obj: any) => canvas.remove(obj));

    const createdKeys: string[] = [];
    const createdRoles: string[] = [];
    let tagThemeConfigChanged = false;
    const roleAnchors = this._collectRoleAnchors(overlay);

    // Enforce MOS guide tag size for consistent readability/styling.
    if (typeof tagManager.persistTagSizeToMetadata === 'function') {
      tagManager.tagSize = 34;
      tagManager.persistTagSizeToMetadata(34, overlay.viewId);
    }

    const candidatesByRole = new Map<
      string,
      Array<{ element: MeasurementOverlayElement; lineObj: any; length: number }>
    >();

    for (const element of overlay.elements.values()) {
      if (element.kind !== 'measureLine') continue;

      const roleToken = this._deriveRoleToken(element);
      if (!roleToken) continue;

      const lineObj = this._resolveAndPruneStrokeObjectsForElement(canvas, `${element.id}_line`);
      if (!lineObj) continue;

      const length = this._strokeLength(lineObj);
      const list = candidatesByRole.get(roleToken) || [];
      list.push({ element, lineObj, length });
      candidatesByRole.set(roleToken, list);
    }

    for (const [roleToken, candidates] of candidatesByRole.entries()) {
      const primary = candidates.slice().sort((a, b) => {
        const aScore = this._strokePriorityScore(a.lineObj);
        const bScore = this._strokePriorityScore(b.lineObj);
        if (aScore !== bScore) return bScore - aScore;
        return (
          (Number.isFinite(b.length) ? b.length : 0) - (Number.isFinite(a.length) ? a.length : 0)
        );
      })[0];
      if (!primary) continue;

      // Keep only one stroke per role; remove all duplicate drawables.
      for (const candidate of candidates) {
        const isPrimary = candidate === primary;
        if (!isPrimary) {
          if (candidate.lineObj) {
            canvas.remove(candidate.lineObj);
          }
          if (candidate.element?.id) {
            overlay.elements.delete(candidate.element.id);
          }
          continue;
        }
        if (candidate.lineObj?.set) {
          candidate.lineObj.set({
            opacity: 1,
            visible: true,
            selectable: true,
            evented: true,
          });
          candidate.lineObj.setCoords?.();
        }
      }

      const lineObj = primary.lineObj;
      const element = primary.element;

      this._removeLegacyRoleStrokes(canvas, overlay.viewId, roleToken, lineObj);
      this._ensureInteractiveArrowControls(lineObj);

      if (lineObj?.customData) {
        lineObj.customData.roleToken = roleToken;
      }

      const previousStroke = metadataManager?.vectorStrokesByImage?.[overlay.viewId]?.[roleToken];
      if (previousStroke && previousStroke !== lineObj && canvas.contains(previousStroke)) {
        canvas.remove(previousStroke);
      }

      if (metadataManager?.attachMetadata) {
        metadataManager.attachMetadata(lineObj, overlay.viewId, roleToken);
      }

      this._seedMosTagOffset(lineObj);
      this._applyRoleAnchorOffset(lineObj, roleAnchors.get(roleToken));
      tagThemeConfigChanged =
        this._ensureMosTagTheme(tagManager, roleToken, overlay.viewId) || tagThemeConfigChanged;

      tagManager.createTag(roleToken, overlay.viewId, lineObj);
      createdKeys.push(roleToken);
      createdRoles.push(roleToken);
    }

    if (tagThemeConfigChanged && typeof tagManager.persistTagStyleConfigToMetadata === 'function') {
      tagManager.persistTagStyleConfigToMetadata();
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

  private _strokeLength(strokeObj: any): number {
    if (!strokeObj) return 0;

    if (strokeObj.type === 'line' && typeof strokeObj.calcLinePoints === 'function') {
      const pts = strokeObj.calcLinePoints();
      return Math.hypot((pts?.x2 || 0) - (pts?.x1 || 0), (pts?.y2 || 0) - (pts?.y1 || 0));
    }

    if (strokeObj.type === 'group' && typeof strokeObj.getObjects === 'function') {
      const lineObj = strokeObj.getObjects().find((o: any) => o?.type === 'line');
      if (lineObj && typeof lineObj.calcLinePoints === 'function') {
        const pts = lineObj.calcLinePoints();
        return Math.hypot((pts?.x2 || 0) - (pts?.x1 || 0), (pts?.y2 || 0) - (pts?.y1 || 0));
      }
    }

    if (strokeObj.type === 'path' && Array.isArray(strokeObj.customPoints)) {
      const points = strokeObj.customPoints.filter(
        (point: any) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
      );
      if (points.length < 2) return 0;
      let total = 0;
      for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      return total;
    }

    return 0;
  }

  private _strokePriorityScore(strokeObj: any): number {
    if (!strokeObj) return 0;
    let score = 0;
    if (strokeObj.type === 'group' && strokeObj.isArrow) score += 100;
    if (strokeObj.visible !== false) score += 20;
    if (strokeObj.selectable) score += 10;
    if (strokeObj.evented) score += 10;
    return score;
  }

  private _buildSmoothPathFromPoints(points: Array<{ x: number; y: number }>): string {
    if (!Array.isArray(points) || points.length < 2) return '';
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }

    let path = `M ${points[0].x} ${points[0].y}`;
    const tension = 0.5;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];

      const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
      const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
      const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
      const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return path;
  }

  private _positionCurveArrowheads(
    points: Array<{ x: number; y: number }>,
    startArrow: any,
    endArrow: any
  ): void {
    if (!Array.isArray(points) || points.length < 2 || !startArrow || !endArrow) return;
    const pStart = points[0];
    const pStartNext = points[1];
    const pEndPrev = points[points.length - 2];
    const pEnd = points[points.length - 1];
    const startAngle =
      (Math.atan2(pStartNext.y - pStart.y, pStartNext.x - pStart.x) * 180) / Math.PI;
    const endAngle = (Math.atan2(pEnd.y - pEndPrev.y, pEnd.x - pEndPrev.x) * 180) / Math.PI;
    startArrow.set({ left: pStart.x, top: pStart.y, angle: startAngle - 90 });
    endArrow.set({ left: pEnd.x, top: pEnd.y, angle: endAngle + 90 });
    startArrow.setCoords?.();
    endArrow.setCoords?.();
  }

  private _ensureInteractiveArrowControls(strokeObj: any): void {
    if (!strokeObj || strokeObj.type !== 'group' || !strokeObj.isArrow) return;
    strokeObj.set({
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: false,
      visible: true,
      opacity: 1,
    });
    FabricControls.createArrowControls(strokeObj);
    strokeObj.setCoords?.();
  }

  private _removeLegacyRoleStrokes(
    canvas: any,
    viewId: string,
    roleToken: string,
    keepStrokeObj: any
  ): void {
    const scopePrefix = `${viewId}::tab:`;
    const normalizedRole = String(roleToken || '')
      .trim()
      .toUpperCase();
    if (!normalizedRole) return;

    const toRemove = canvas.getObjects().filter((obj: any) => {
      if (!obj || obj === keepStrokeObj) return false;
      const isLegacyDrawable =
        (obj.type === 'group' && obj.isArrow) || obj.type === 'line' || obj.type === 'path';
      if (!isLegacyDrawable) return false;
      if (obj?.customData?.layerType === 'mos-overlay') return false;

      const label = String(obj?.strokeMetadata?.strokeLabel || '')
        .trim()
        .toUpperCase();
      if (label !== normalizedRole) return false;

      const imageLabel = String(obj?.strokeMetadata?.imageLabel || obj?.imageLabel || '').trim();
      return imageLabel === viewId || imageLabel.startsWith(scopePrefix);
    });

    toRemove.forEach((obj: any) => canvas.remove(obj));
  }

  private _resolveStrokeObjectForElement(canvas: any, mosId: string): any {
    if (!canvas || !mosId) return null;
    const objects = canvas.getObjects();
    const matches = objects.filter((o: any) => o.__mosId === mosId);
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];

    return matches.slice().sort((a: any, b: any) => {
      const aScore = this._strokePriorityScore(a);
      const bScore = this._strokePriorityScore(b);
      if (aScore !== bScore) return bScore - aScore;
      // If tied, prefer most recently added object.
      return objects.indexOf(b) - objects.indexOf(a);
    })[0];
  }

  private _resolveAndPruneStrokeObjectsForElement(canvas: any, mosId: string): any {
    if (!canvas || !mosId) return null;
    const objects = canvas.getObjects();
    const matches = objects.filter((o: any) => o.__mosId === mosId);
    if (!matches.length) return null;

    const ranked = matches.slice().sort((a: any, b: any) => {
      const aScore = this._strokePriorityScore(a);
      const bScore = this._strokePriorityScore(b);
      if (aScore !== bScore) return bScore - aScore;
      return objects.indexOf(b) - objects.indexOf(a);
    });

    const primary = ranked[0];
    ranked.slice(1).forEach((obj: any) => canvas.remove(obj));
    return primary;
  }

  private _pruneDuplicateMosObjectsById(canvas: any, viewId: string): void {
    if (!canvas) return;
    const objects = canvas.getObjects();
    const byId = new Map<string, any[]>();

    for (const obj of objects) {
      const cd = obj?.customData as MosFabricCustomData | undefined;
      if (cd?.layerType !== 'mos-overlay') continue;
      const overlay = this.store.byId.get(cd.overlayId);
      if (overlay?.viewId !== viewId) continue;
      const mosId = String(obj?.__mosId || '').trim();
      if (!mosId) continue;
      const list = byId.get(mosId) || [];
      list.push(obj);
      byId.set(mosId, list);
    }

    for (const list of byId.values()) {
      if (list.length <= 1) continue;
      const ranked = list.slice().sort((a, b) => objects.indexOf(b) - objects.indexOf(a));
      ranked.slice(1).forEach(obj => canvas.remove(obj));
    }
  }

  private _pruneLegacyCurveArrowArtifacts(canvas: any, viewId: string): void {
    if (!canvas) return;
    const objects = canvas.getObjects();

    const mosCurveArrows = objects.filter((obj: any) => {
      const cd = obj?.customData as MosFabricCustomData | undefined;
      if (obj?.type !== 'triangle') return false;
      if (cd?.layerType !== 'mos-overlay') return false;
      const overlay = this.store.byId.get(cd.overlayId);
      if (overlay?.viewId !== viewId) return false;
      const mosId = String(obj?.__mosId || '');
      return mosId.includes('_curve_start_arrow') || mosId.includes('_curve_end_arrow');
    });

    if (!mosCurveArrows.length) return;

    const arrowCenters = mosCurveArrows
      .map((obj: any) => obj.getCenterPoint?.())
      .filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
    if (!arrowCenters.length) return;

    const thresholdPx = 14;
    const toRemove = objects.filter((obj: any) => {
      if (obj?.type !== 'triangle') return false;
      if (obj?.customData?.layerType === 'mos-overlay') return false;
      const c = obj.getCenterPoint?.();
      if (!Number.isFinite(c?.x) || !Number.isFinite(c?.y)) return false;

      return arrowCenters.some((a: any) => Math.hypot(c.x - a.x, c.y - a.y) <= thresholdPx);
    });

    toRemove.forEach((obj: any) => canvas.remove(obj));
  }

  private _seedMosTagOffset(lineObj: any): void {
    if (!lineObj || lineObj.tagOffset) return;
    if (
      typeof lineObj.x1 !== 'number' ||
      typeof lineObj.y1 !== 'number' ||
      typeof lineObj.x2 !== 'number' ||
      typeof lineObj.y2 !== 'number'
    ) {
      return;
    }

    const dx = lineObj.x2 - lineObj.x1;
    const dy = lineObj.y2 - lineObj.y1;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 1) return;

    let nx = -dy / len;
    let ny = dx / len;

    // Prefer the offset direction that places labels upward on screen.
    if (ny > 0) {
      nx *= -1;
      ny *= -1;
    }

    const distance = 18;
    lineObj.tagOffset = {
      x: nx * distance,
      y: ny * distance,
    };
  }

  private _collectRoleAnchors(overlay: MeasurementOverlay): Map<string, { x: number; y: number }> {
    const anchors = new Map<string, { x: number; y: number }>();
    for (const element of overlay.elements.values()) {
      if (element.kind !== 'label') continue;
      const roleToken = this._deriveRoleToken(element);
      if (!roleToken) continue;
      const anchor = this._extractMosAnchorFromLabelElement(element);
      if (!anchor) continue;
      if (!anchors.has(roleToken)) {
        anchors.set(roleToken, anchor);
      }
    }
    return anchors;
  }

  private _extractMosAnchorFromLabelElement(
    element: MeasurementOverlayElement
  ): { x: number; y: number } | null {
    if (element?.label && Number.isFinite(element.label.cx) && Number.isFinite(element.label.cy)) {
      return { x: element.label.cx, y: element.label.cy };
    }

    const points = Array.isArray(element?.endpoints)
      ? element.endpoints
          .map(endpoint => endpoint?.point)
          .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      : [];
    if (!points.length) return null;

    if (points.length === 1) {
      return { x: points[0].x, y: points[0].y };
    }

    return {
      x: (points[0].x + points[points.length - 1].x) / 2,
      y: (points[0].y + points[points.length - 1].y) / 2,
    };
  }

  private _applyRoleAnchorOffset(lineObj: any, anchorMos?: { x: number; y: number }): void {
    if (!lineObj || !anchorMos) return;
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    const imageRect = getImageRect(canvas);
    const anchorCanvas = mosToCanvas(anchorMos, imageRect);
    const lineCenter = lineObj.getCenterPoint?.();
    if (
      !lineCenter ||
      !Number.isFinite(lineCenter.x) ||
      !Number.isFinite(lineCenter.y) ||
      !Number.isFinite(anchorCanvas.x) ||
      !Number.isFinite(anchorCanvas.y)
    ) {
      return;
    }

    lineObj.tagOffset = {
      x: anchorCanvas.x - lineCenter.x,
      y: anchorCanvas.y - lineCenter.y,
    };
  }

  private _ensureMosTagTheme(tagManager: any, roleToken: string, viewId: string): boolean {
    if (!tagManager || !roleToken || !viewId) return false;

    if (!tagManager.tagStyleConfig || typeof tagManager.tagStyleConfig !== 'object') {
      tagManager.tagStyleConfig =
        typeof tagManager.createDefaultTagStyleConfig === 'function'
          ? tagManager.createDefaultTagStyleConfig()
          : { presets: {}, perTagThemes: {}, highlightedTagKeys: new Set() };
    }

    if (
      !tagManager.tagStyleConfig.perTagThemes ||
      typeof tagManager.tagStyleConfig.perTagThemes !== 'object'
    ) {
      tagManager.tagStyleConfig.perTagThemes = {};
    }

    const tagKey =
      typeof tagManager.getTagKey === 'function'
        ? tagManager.getTagKey(roleToken, viewId)
        : `${viewId}::${roleToken}`;

    if (tagManager.tagStyleConfig.perTagThemes[tagKey]) {
      return false;
    }

    tagManager.tagStyleConfig.perTagThemes[tagKey] = {
      background: '#FFFFFF',
      border: '#DF6868',
      text: '#000000',
    };
    return true;
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
    if (!/^[mbc][a-z0-9-]+(?:cm|mm|in)\d*(?:_(?:label|text))?$/i.test(normalized)) return '';
    const token = normalized
      .slice(1)
      .replace(/_(label|text)$/i, '')
      .replace(/(?:CM|MM|IN)\d*$/i, '')
      .replace(/[^a-z0-9-]/gi, '')
      .toUpperCase();
    return token;
  }
}
