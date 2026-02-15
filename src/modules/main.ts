// Main Entry Point
// @ts-nocheck
import { CanvasManager } from './CanvasManager';
import { ToolManager } from './tools/ToolManager';
import { ProjectManager } from './ProjectManager.js';
import { HistoryManager } from './HistoryManager.js';
import { StrokeMetadataManager } from './StrokeMetadataManager.js';
import { UploadManager } from './UploadManager.js';
import { imageRegistry } from './ImageRegistry.js';
import { PathUtils } from './utils/PathUtils';

// Deferred managers are dynamically loaded JS modules with varying shapes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DeferredManager = any;

export class App {
  canvasManager: CanvasManager;
  historyManager: HistoryManager;
  toolManager: ToolManager;
  metadataManager: StrokeMetadataManager;
  projectManager: ProjectManager;
  uploadManager: UploadManager;
  tagManager: DeferredManager | null;
  arrowManager: DeferredManager | null;
  measurementSystem: DeferredManager | null;
  measurementDialog: DeferredManager | null;
  measurementExporter: DeferredManager | null;
  deferredInitStarted: boolean;
  deferredToolPreloadStarted: boolean;
  hasDrawnFirstStroke: boolean;
  hasUploadedFirstImage: boolean;
  firstPaintMarked: boolean;
  firstStrokeCommitMarked: boolean;
  firstStrokeCommitInProgress: boolean;
  currentUnit: 'inch' | 'cm';
  captureFrameScale: number;
  currentDashSettings: {
    style: string;
    pattern: number[];
    splitRatio: number;
    mixedEnabled: boolean;
    dashFirst: boolean;
  };
  dashSplitHandle: any | null;
  dashSplitDragState: {
    target: any;
    prevLockMovementX: boolean;
    prevLockMovementY: boolean;
  } | null;
  dashSplitCursorState: {
    hovering: boolean;
    savedCursor: string | null;
  };

  constructor() {
    this.canvasManager = new CanvasManager('canvas');
    this.historyManager = new HistoryManager(this.canvasManager);
    this.toolManager = new ToolManager(this.canvasManager);
    this.metadataManager = new StrokeMetadataManager();
    this.projectManager = new ProjectManager(this.canvasManager, this.historyManager);
    this.uploadManager = new UploadManager(this.projectManager);

    imageRegistry.bindProjectManager(this.projectManager);
    imageRegistry.start();

    this.deferredInitStarted = false;
    this.deferredToolPreloadStarted = false;
    this.hasDrawnFirstStroke = false;
    this.hasUploadedFirstImage = false;
    this.firstPaintMarked = false;
    this.firstStrokeCommitMarked = false;
    this.firstStrokeCommitInProgress = false;
    this.currentUnit = 'inch';
    this.captureFrameScale = 1.0;
    this.currentDashSettings = {
      style: 'solid',
      pattern: [],
      splitRatio: 0.5,
      mixedEnabled: false,
      dashFirst: true,
    };
    this.dashSplitHandle = null;
    this.dashSplitDragState = null;
    this.dashSplitCursorState = {
      hovering: false,
      savedCursor: null,
    };

    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark('app-init-start');
    }
    this.tagManager = null;
    this.arrowManager = null;
    this.measurementSystem = null;
    this.measurementDialog = null;
    this.measurementExporter = null;

    this.init();
  }

  init(): void {
    console.log('OpenPaint (Fabric.js) Initializing...');

    // Wait a tick to ensure DOM is fully ready
    setTimeout(() => {
      // Initialize managers
      this.canvasManager.init();

      // Resize immediately after init
      this.canvasManager.resize();

      // Initialize other managers
      this.toolManager.init();
      this.historyManager.init();
      this.projectManager.init();
      this.uploadManager.init();

      this.setupDeferredToolPreload();

      // Initialize drawing mode toggle button label
      const drawingModeToggle = document.getElementById('drawingModeToggle');
      if (drawingModeToggle) {
        this.updateToggleLabel(drawingModeToggle, 'Straight Line');
      }

      // Set default color to bright blue and activate first color button
      const firstColorBtn = document.querySelector('[data-color="#3b82f6"]');
      if (firstColorBtn) {
        firstColorBtn.classList.add('active', 'transform', 'scale-110');
      }

      // Initialize color picker to default color
      const colorPicker = document.getElementById('colorPicker') as HTMLInputElement | null;
      if (colorPicker) {
        colorPicker.value = '#3b82f6';
      }

      // Setup label rendering on object changes
      if (this.canvasManager.fabricCanvas) {
        this.canvasManager.fabricCanvas.on('object:added', (e: any) => {
          const obj = e.target;
          if (this.isDashDrawableObject(obj)) {
            this.applyDashSettingsToObject(obj, this.currentDashSettings);
          }
          if (obj && obj.evented !== false && !obj.isTag) {
            // Check if we're in a drawing tool - if so, don't auto-enable objects
            // (drawing tools will manage object states to prevent accidental dragging)
            const activeTool = this.toolManager?.activeTool;
            const isDrawingTool =
              activeTool &&
              (activeTool.constructor.name === 'LineTool' ||
                activeTool.constructor.name === 'CurveTool' ||
                activeTool.constructor.name === 'ArrowTool');

            // Only make interactive if NOT in drawing mode
            if (!isDrawingTool) {
              obj.set({
                selectable: true,
                evented: true,
              });
            }
          }
        });
        this.canvasManager.fabricCanvas.on('object:removed', (e: any) => {
          // If a stroke is removed, remove its tag
          const obj = e.target;
          if (obj && obj.strokeMetadata && obj.strokeMetadata.strokeLabel && this.tagManager) {
            this.tagManager.removeTag(
              obj.strokeMetadata.strokeLabel,
              obj.strokeMetadata.imageLabel || window.currentImageLabel
            );
          }
        });
      }

      // Setup UI bindings
      this.setupUI();

      // Add Tab key handler to cycle through drawing modes
      this.setupKeyboardShortcuts();

      // Add resize listener
      window.addEventListener('resize', () => {
        this.canvasManager.resize();
      });

      // Expose resize globally
      window.resizeCanvas = () => {
        return this.canvasManager.resize();
      };

      this.scheduleDeferredInit();
      this.markFirstPaint();

      console.log('OpenPaint initialization complete');

      // Debug: Verify canvas is accessible
      const canvasEl = document.getElementById('canvas');
      if (canvasEl) {
        console.log(`Canvas element found: ${canvasEl.offsetWidth}x${canvasEl.offsetHeight}`);
        console.log(
          `Canvas computed style: display=${window.getComputedStyle(canvasEl).display}, z-index=${window.getComputedStyle(canvasEl).zIndex}`
        );
      } else {
        console.error('Canvas element not found in DOM!');
      }
    }, 0);
  }

  scheduleDeferredInit(): void {
    if (this.deferredInitStarted) {
      return;
    }

    const runDeferred = () => {
      this.deferredInitStarted = true;
      void this.initDeferredManagers();
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(runDeferred, { timeout: 1500 });
    } else {
      setTimeout(runDeferred, 0);
    }
  }

  setupDeferredToolPreload(): void {
    if (this.deferredToolPreloadStarted) {
      return;
    }

    const preload = () => {
      if (this.deferredToolPreloadStarted) {
        return;
      }
      this.deferredToolPreloadStarted = true;
      this.toolManager.preloadTools([
        'select',
        'pencil',
        'curve',
        'arrow',
        'privacy',
        'text',
        'shape',
      ]);
    };

    window.addEventListener('firststroke', preload, { once: true });
    window.addEventListener('firstupload', preload, { once: true });
  }

  markFirstPaint(): void {
    if (this.firstPaintMarked) {
      return;
    }
    this.firstPaintMarked = true;

    if (typeof performance === 'undefined' || !performance.mark) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        performance.mark('app-first-paint');
        if (performance.measure) {
          try {
            performance.measure('app-init->first-paint', 'app-init-start', 'app-first-paint');
            this.logPerfMeasure('app-init->first-paint');
          } catch (error) {
            console.warn('[Perf] Measure first paint failed', error);
          }
        }
      });
    });
  }

  logPerfMeasure(name: string): void {
    if (typeof performance === 'undefined' || !performance.getEntriesByName) {
      return;
    }
    const entry = performance.getEntriesByName(name).slice(-1)[0];
    if (!entry) {
      return;
    }
    console.log(`[Perf] ${name}: ${entry.duration.toFixed(1)}ms`);
  }

  async initDeferredManagers(): Promise<void> {
    try {
      const [
        { TagManager },
        { MeasurementSystem },
        { MeasurementDialog },
        { MeasurementExporter },
        { ArrowManager },
        { setupDebugHelpers },
      ] = await Promise.all([
        import('./TagManager.js'),
        import('./MeasurementSystem.js'),
        import('./MeasurementDialog.js'),
        import('./MeasurementExporter.js'),
        import('./utils/ArrowManager.js'),
        import('./DebugHelpers.js'),
      ]);

      if (!this.tagManager) {
        this.tagManager = new TagManager(this.canvasManager, this.metadataManager);
      }

      if (!this.arrowManager) {
        this.arrowManager = new ArrowManager(this.canvasManager);
        this.arrowManager.init();
      }

      if (!this.measurementSystem) {
        this.measurementSystem = new MeasurementSystem(this.metadataManager);
      }
      this.measurementSystem.setUnit(this.currentUnit === 'inch' ? 'inches' : 'cm');

      if (!this.measurementDialog) {
        this.measurementDialog = new MeasurementDialog(this.measurementSystem);
      }

      if (!this.measurementExporter) {
        this.measurementExporter = new MeasurementExporter(
          this.measurementSystem,
          this.projectManager
        );
      }

      if (this.metadataManager?.updateStrokeVisibilityControls) {
        this.metadataManager.updateStrokeVisibilityControls();
      }

      if (setupDebugHelpers) {
        setupDebugHelpers(this);
      }
    } catch (error) {
      console.error('Deferred init failed', error);
    }
  }

  // Helper function to update properties of selected strokes
  updateSelectedStrokes(property: 'color' | 'strokeWidth', value: string | number): void {
    if (!this.canvasManager.fabricCanvas) return;

    const activeObjects = this.canvasManager.fabricCanvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    let updatedCount = 0;
    activeObjects.forEach((obj: any) => {
      // Only update drawable strokes (lines, paths, and curves)
      if (obj && (obj.type === 'line' || obj.type === 'path')) {
        if (property === 'color') {
          obj.set('stroke', value);
        } else if (property === 'strokeWidth') {
          obj.set('strokeWidth', value);
        }
        obj.dirty = true;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      this.canvasManager.fabricCanvas.requestRenderAll();
      console.log(`Updated ${property} for ${updatedCount} selected strokes`);
    }
  }

  getDashPatternForStyle(style: string): number[] {
    const patterns: Record<string, number[]> = {
      solid: [],
      dotted: [2, 5],
      small: [5, 5],
      medium: [10, 5],
      large: [15, 5],
      'dot-dash': [5, 5, 1, 5],
      mixed: [2, 5],
      custom: [5, 5],
    };
    return patterns[style] || [];
  }

  isDashDrawableObject(obj: any): boolean {
    if (!obj) return false;
    if (obj.isTag || obj.isConnectorLine) return false;
    if (obj.type === 'line' || obj.type === 'path') return true;
    if (obj.type === 'i-text' || obj.type === 'text') return true;
    return obj.strokeMetadata?.type === 'shape';
  }

  attachMixedDashRenderer(obj: any): void {
    if (!obj || obj._mixedDashRendererAttached) return;
    const originalRender = obj._render;
    if (typeof originalRender !== 'function') return;

    obj._render = function (ctx: CanvasRenderingContext2D) {
      const dashSettings = this.dashSettings || {};
      const pattern = Array.isArray(this.strokeDashArray) ? this.strokeDashArray : [];
      const hasMixedDash = dashSettings.mixedEnabled && pattern.length > 0;

      if (!hasMixedDash) {
        originalRender.call(this, ctx);
        return;
      }

      const splitRatio = Math.max(0.05, Math.min(0.95, Number(dashSettings.splitRatio ?? 0.5)));
      const dashFirst = dashSettings.dashFirst !== false;

      // Pass 1: full dashed render.
      originalRender.call(this, ctx);

      // Pass 2: overlay solid stroke on the trailing side.
      const prevDash = this.strokeDashArray;
      const prevFill = this.fill;
      const dims = this._getNonTransformedDimensions
        ? this._getNonTransformedDimensions()
        : { x: this.width || 0, y: this.height || 0 };
      const width = Math.max(2, Number(dims?.x || 0) + Number(this.strokeWidth || 1) * 2);
      const height = Math.max(2, Number(dims?.y || 0) + Number(this.strokeWidth || 1) * 2);

      let startX = -width / 2;
      let endX = width / 2;
      if (this.type === 'line') {
        if (typeof this.x1 === 'number' && typeof this.x2 === 'number') {
          startX = Number(this.x1);
          endX = Number(this.x2);
        } else if (typeof this.calcLinePoints === 'function') {
          const pts = this.calcLinePoints();
          startX = Number(pts?.x1 ?? startX);
          endX = Number(pts?.x2 ?? endX);
        }
      } else if (this.type === 'path' && Array.isArray(this.path) && this.path.length > 1) {
        const first = this.path[0];
        const last = this.path[this.path.length - 1];
        if (first?.[0] === 'M' && typeof first[1] === 'number') {
          startX = Number(first[1]);
        }
        if (last?.[0] === 'L' && typeof last[1] === 'number') {
          endX = Number(last[1]);
        } else if (last?.[0] === 'C' && typeof last[5] === 'number') {
          endX = Number(last[5]);
        } else if (last?.[0] === 'Q' && typeof last[3] === 'number') {
          endX = Number(last[3]);
        }
      }

      const startOnLeft = startX <= endX;
      const solidOnRight = dashFirst ? startOnLeft : !startOnLeft;
      const splitRatioX = startOnLeft ? splitRatio : 1 - splitRatio;

      ctx.save();
      ctx.beginPath();
      if (solidOnRight) {
        ctx.rect(
          -width / 2 + width * splitRatioX,
          -height / 2 - 4,
          width * (1 - splitRatioX) + 8,
          height + 8
        );
      } else {
        ctx.rect(-width / 2 - 8, -height / 2 - 4, width * splitRatioX + 8, height + 8);
      }
      ctx.clip();

      this.strokeDashArray = null;
      if (this.type !== 'line' && this.type !== 'path') {
        this.fill = 'rgba(0,0,0,0)';
      }
      originalRender.call(this, ctx);

      this.strokeDashArray = prevDash;
      this.fill = prevFill;
      ctx.restore();
    };

    obj._mixedDashRendererAttached = true;
    obj.objectCaching = false;
    obj.dirty = true;
  }

  applyDashSettingsToObject(
    obj: any,
    {
      style,
      pattern,
      splitRatio,
      mixedEnabled,
      dashFirst,
    }: {
      style: string;
      pattern: number[];
      splitRatio: number;
      mixedEnabled: boolean;
      dashFirst: boolean;
    }
  ): void {
    if (!this.isDashDrawableObject(obj)) return;

    if (obj.type === 'i-text' || obj.type === 'text') {
      if (style === 'solid') {
        obj.set('strokeDashArray', null);
        obj.dashSettings = {
          style,
          splitRatio,
          mixedEnabled,
          dashFirst,
          pattern: pattern || [],
        };
        obj.dirty = true;
        return;
      }
      const strokeColor =
        obj.stroke && obj.stroke !== 'transparent' ? obj.stroke : obj.fill || '#111827';
      const currentWidth = Number(obj.strokeWidth || 0);
      obj.set({
        stroke: strokeColor,
        strokeWidth: Math.max(1, currentWidth || 1),
      });
    }

    const nextPattern = pattern?.length ? pattern : null;
    obj.set('strokeDashArray', nextPattern);
    obj.dashSettings = {
      style,
      splitRatio,
      mixedEnabled,
      dashFirst,
      pattern: pattern || [],
    };

    if (mixedEnabled) {
      this.attachMixedDashRenderer(obj);
    }

    obj.dirty = true;
  }

  applyDashSettingsToTools(pattern: number[]): void {
    const activeTool = this.toolManager.activeTool as any;
    if (activeTool?.setDashPattern) {
      activeTool.setDashPattern(pattern);
    }

    const dashCapable = ['line', 'curve', 'arrow', 'shape'];
    dashCapable.forEach((name: string) => {
      const tool = this.toolManager.tools[name];
      if (tool?.setDashPattern) {
        tool.setDashPattern(pattern);
      }
    });
  }

  applyDashSettingsToSelection(): void {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;
    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects?.length) return;
    activeObjects.forEach((obj: any) => {
      this.applyDashSettingsToObject(obj, this.currentDashSettings);
    });
    canvas.requestRenderAll();
    this.updateDashSplitHandleForSelection();
  }

  getDashTargetObjectFromSelection(): any | null {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return null;
    const activeObjects = canvas.getActiveObjects?.() || [];
    if (activeObjects.length !== 1) return null;
    const target = activeObjects[0];
    if (!this.isDashDrawableObject(target)) return null;
    const ds = target.dashSettings || {};
    if (!ds.mixedEnabled) return null;
    return target;
  }

  ensureDashSplitHandle(): any | null {
    const canvas = this.canvasManager.fabricCanvas;
    const fabricLib = (globalThis as any).fabric;
    if (!canvas || !fabricLib) return null;
    if (this.dashSplitHandle) return this.dashSplitHandle;

    this.dashSplitHandle = new fabricLib.Circle({
      radius: 7,
      fill: '#2563eb',
      stroke: '#ffffff',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      hoverCursor: 'ew-resize',
      visible: false,
      originX: 'center',
      originY: 'center',
      excludeFromExport: true,
      isDashSplitHandle: true,
    });
    canvas.add(this.dashSplitHandle);
    return this.dashSplitHandle;
  }

  getDashLineEndpoints(
    target: any
  ): { p1: { x: number; y: number }; p2: { x: number; y: number } } | null {
    const fabricLib = (globalThis as any).fabric;
    const util = fabricLib?.util;
    if (
      !target ||
      target.type !== 'line' ||
      !target.calcLinePoints ||
      !util?.transformPoint ||
      !fabricLib?.Point
    ) {
      return null;
    }
    const pts = target.calcLinePoints();
    const matrix = target.calcTransformMatrix();
    const p1 = util.transformPoint(new fabricLib.Point(pts.x1, pts.y1), matrix);
    const p2 = util.transformPoint(new fabricLib.Point(pts.x2, pts.y2), matrix);
    return { p1: { x: p1.x, y: p1.y }, p2: { x: p2.x, y: p2.y } };
  }

  getDashStrokePolyline(target: any): Array<{ x: number; y: number }> {
    if (!target) return [];

    const line = this.getDashLineEndpoints(target);
    if (line) {
      return [line.p1, line.p2];
    }

    if (target.type === 'path') {
      if (Array.isArray(target.customPoints) && target.customPoints.length >= 2) {
        return target.customPoints.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }));
      }
      const sampled = PathUtils.samplePathPoints(target, 80);
      if (sampled.length >= 2) {
        return sampled.map(p => ({ x: Number(p.x), y: Number(p.y) }));
      }
    }

    const fabricLib = (globalThis as any).fabric;
    const util = fabricLib?.util;
    if (!util?.transformPoint || !fabricLib?.Point) {
      return [];
    }
    const dims = target._getNonTransformedDimensions
      ? target._getNonTransformedDimensions()
      : { x: target.width || 0, y: target.height || 0 };
    const width = Math.max(2, Number(dims?.x || 0) + Number(target.strokeWidth || 1) * 2);
    const matrix = target.calcTransformMatrix();
    const start = util.transformPoint(new fabricLib.Point(-width / 2, 0), matrix);
    const end = util.transformPoint(new fabricLib.Point(width / 2, 0), matrix);
    return [
      { x: Number(start.x), y: Number(start.y) },
      { x: Number(end.x), y: Number(end.y) },
    ];
  }

  getPolylinePointAtRatio(
    points: Array<{ x: number; y: number }>,
    ratio: number
  ): { x: number; y: number } | null {
    if (!Array.isArray(points) || points.length < 2) return null;
    const r = Math.max(0, Math.min(1, Number(ratio)));
    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      lengths.push(len);
      total += len;
    }
    if (total <= 0) return { ...points[0]! };
    const targetDist = total * r;
    let acc = 0;
    for (let i = 0; i < lengths.length; i++) {
      const segLen = lengths[i]!;
      const nextAcc = acc + segLen;
      if (targetDist <= nextAcc || i === lengths.length - 1) {
        const t = segLen > 0 ? (targetDist - acc) / segLen : 0;
        const a = points[i]!;
        const b = points[i + 1]!;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        };
      }
      acc = nextAcc;
    }
    return { ...points[points.length - 1]! };
  }

  getClosestRatioOnPolyline(
    points: Array<{ x: number; y: number }>,
    pointer: { x: number; y: number }
  ): number {
    if (!Array.isArray(points) || points.length < 2 || !pointer) return 0.5;

    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      lengths.push(len);
      total += len;
    }
    if (total <= 0) return 0.5;

    let bestRatio = 0;
    let bestDistSq = Number.POSITIVE_INFINITY;
    let acc = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const segLenSq = vx * vx + vy * vy;
      if (segLenSq <= 0) {
        acc += lengths[i]!;
        continue;
      }
      let t = ((pointer.x - a.x) * vx + (pointer.y - a.y) * vy) / segLenSq;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + vx * t;
      const py = a.y + vy * t;
      const dx = pointer.x - px;
      const dy = pointer.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        const distAlong = acc + lengths[i]! * t;
        bestRatio = distAlong / total;
      }
      acc += lengths[i]!;
    }

    return Math.max(0, Math.min(1, bestRatio));
  }

  getSplitHandleCanvasPoint(target: any, splitRatio: number): { x: number; y: number } | null {
    const points = this.getDashStrokePolyline(target);
    return this.getPolylinePointAtRatio(points, splitRatio);
  }

  updateDashSplitHandleForSelection(): void {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;
    const handle = this.ensureDashSplitHandle();
    if (!handle) return;

    const dragTarget = this.dashSplitDragState?.target || null;
    const target = dragTarget || this.getDashTargetObjectFromSelection();
    if (!target) {
      handle.set({ visible: false, ownerObject: null });
      canvas.requestRenderAll();
      return;
    }

    const ds = target.dashSettings || this.currentDashSettings;
    const splitRatio = Math.max(0, Math.min(1, Number(ds.splitRatio ?? 0.5)));
    const point = this.getSplitHandleCanvasPoint(target, splitRatio);
    if (!point) {
      handle.set({ visible: false, ownerObject: null });
      canvas.requestRenderAll();
      return;
    }

    handle.set({
      left: point.x,
      top: point.y,
      visible: true,
      ownerObject: target,
    });
    canvas.bringToFront(handle);
    canvas.requestRenderAll();
  }

  isPointerNearDashSplitHandle(pointer: { x: number; y: number }): boolean {
    const handle = this.dashSplitHandle;
    if (!handle || !handle.visible || !pointer) return false;
    const dx = Number(pointer.x) - Number(handle.left || 0);
    const dy = Number(pointer.y) - Number(handle.top || 0);
    const radius = Number(handle.radius || 7) + 6;
    return dx * dx + dy * dy <= radius * radius;
  }

  updateDashSplitFromPointer(pointer: { x: number; y: number }, target: any): void {
    if (!pointer || !target) {
      return;
    }

    const polyline = this.getDashStrokePolyline(target);
    const splitRatio = this.getClosestRatioOnPolyline(polyline, pointer);

    const ds = target.dashSettings || this.currentDashSettings;
    ds.splitRatio = splitRatio;
    ds.mixedEnabled = true;
    target.dashSettings = ds;
    target.dirty = true;

    this.currentDashSettings = {
      ...this.currentDashSettings,
      style: 'mixed',
      mixedEnabled: true,
      splitRatio,
      pattern: this.getDashPatternForStyle('mixed'),
      dashFirst: ds.dashFirst !== false,
    };

    const dashSplitInput = document.getElementById('dashSplitInput') as HTMLInputElement | null;
    const dashStyleSelect = document.getElementById('dashStyleSelect') as HTMLSelectElement | null;
    const dashSplitWrap = document.getElementById('dashSplitWrap');
    if (dashSplitInput) {
      dashSplitInput.value = String(Math.round(splitRatio * 100));
    }
    if (dashStyleSelect) {
      dashStyleSelect.value = 'mixed';
    }
    dashSplitWrap?.classList.remove('hidden');
    dashSplitWrap?.classList.add('flex');

    this.canvasManager.fabricCanvas?.requestRenderAll();
    this.updateDashSplitHandleForSelection();
  }

  initDashSplitHandleSystem(): void {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas || (canvas as any).__dashSplitBound) return;
    (canvas as any).__dashSplitBound = true;

    this.ensureDashSplitHandle();

    canvas.on('selection:created', () => this.updateDashSplitHandleForSelection());
    canvas.on('selection:updated', () => this.updateDashSplitHandleForSelection());
    canvas.on('selection:cleared', () => this.updateDashSplitHandleForSelection());
    canvas.on('object:moving', () => this.updateDashSplitHandleForSelection());
    canvas.on('object:scaling', () => this.updateDashSplitHandleForSelection());
    canvas.on('object:rotating', () => this.updateDashSplitHandleForSelection());
    canvas.on('object:modified', () => this.updateDashSplitHandleForSelection());

    canvas.on('mouse:down:before', (opt: any) => {
      const target = this.getDashTargetObjectFromSelection();
      if (!target) return;
      const pointer = canvas.getPointer(opt.e);
      if (!this.isPointerNearDashSplitHandle(pointer)) return;
      opt?.e?.preventDefault?.();
      opt?.e?.stopPropagation?.();
      this.dashSplitDragState = {
        target,
        prevLockMovementX: Boolean(target.lockMovementX),
        prevLockMovementY: Boolean(target.lockMovementY),
      };
      target.set({ lockMovementX: true, lockMovementY: true });
      target.setCoords?.();
      canvas.skipTargetFind = true;
      if (canvas.upperCanvasEl) {
        if (this.dashSplitCursorState.savedCursor === null) {
          this.dashSplitCursorState.savedCursor = canvas.upperCanvasEl.style.cursor || '';
        }
        canvas.upperCanvasEl.style.cursor = 'grabbing';
      }
    });

    canvas.on('mouse:down', (opt: any) => {
      if (this.dashSplitDragState) {
        opt?.e?.preventDefault?.();
        return;
      }
      const target = this.getDashTargetObjectFromSelection();
      if (!target) return;
      const pointer = canvas.getPointer(opt.e);
      if (!this.isPointerNearDashSplitHandle(pointer)) return;
      opt?.e?.preventDefault?.();
      opt?.e?.stopPropagation?.();
      this.dashSplitDragState = {
        target,
        prevLockMovementX: Boolean(target.lockMovementX),
        prevLockMovementY: Boolean(target.lockMovementY),
      };
      target.set({ lockMovementX: true, lockMovementY: true });
      target.setCoords?.();
      if (canvas.upperCanvasEl) {
        if (this.dashSplitCursorState.savedCursor === null) {
          this.dashSplitCursorState.savedCursor = canvas.upperCanvasEl.style.cursor || '';
        }
        canvas.upperCanvasEl.style.cursor = 'grabbing';
      }
    });

    canvas.on('mouse:move', (opt: any) => {
      const pointer = canvas.getPointer(opt.e);
      if (!this.dashSplitDragState) {
        if (canvas.upperCanvasEl) {
          const hovering = this.isPointerNearDashSplitHandle(pointer);
          if (hovering && !this.dashSplitCursorState.hovering) {
            this.dashSplitCursorState.savedCursor = canvas.upperCanvasEl.style.cursor || '';
            canvas.upperCanvasEl.style.cursor = 'grab';
            this.dashSplitCursorState.hovering = true;
          } else if (!hovering && this.dashSplitCursorState.hovering) {
            canvas.upperCanvasEl.style.cursor = this.dashSplitCursorState.savedCursor || '';
            this.dashSplitCursorState.savedCursor = null;
            this.dashSplitCursorState.hovering = false;
          }
        }
        return;
      }
      opt?.e?.preventDefault?.();
      if (canvas.upperCanvasEl) {
        canvas.upperCanvasEl.style.cursor = 'grabbing';
      }
      this.updateDashSplitFromPointer(pointer, this.dashSplitDragState.target);
    });

    canvas.on('mouse:up', () => {
      const dragState = this.dashSplitDragState;
      const hadDrag = Boolean(dragState);
      if (dragState?.target) {
        dragState.target.set({
          lockMovementX: dragState.prevLockMovementX,
          lockMovementY: dragState.prevLockMovementY,
        });
        dragState.target.setCoords?.();
      }
      this.dashSplitDragState = null;
      canvas.skipTargetFind = false;
      if (canvas.upperCanvasEl) {
        canvas.upperCanvasEl.style.cursor = this.dashSplitCursorState.savedCursor || '';
      }
      this.dashSplitCursorState.savedCursor = null;
      this.dashSplitCursorState.hovering = false;
      if (hadDrag && this.historyManager?.saveState) {
        this.historyManager.saveState({ force: true, reason: 'dash:split-adjust' });
      }
    });

    canvas.on('after:render', () => {
      if (this.dashSplitDragState) return;
      const handle = this.dashSplitHandle;
      const target = handle?.ownerObject;
      if (!handle || !handle.visible || !target) return;
      const ds = target.dashSettings || this.currentDashSettings;
      const splitRatio = Math.max(0, Math.min(1, Number(ds.splitRatio ?? 0.5)));
      const point = this.getSplitHandleCanvasPoint(target, splitRatio);
      if (!point) return;
      handle.set({ left: point.x, top: point.y });
      handle.setCoords();
    });
  }

  updateSelectedTextAndShapes({
    color,
    strokeWidth,
    fontSize,
    fontFamily,
  }: {
    color?: string;
    strokeWidth?: number;
    fontSize?: number;
    fontFamily?: string;
  }): void {
    if (!this.canvasManager.fabricCanvas) return;

    const activeObjects = this.canvasManager.fabricCanvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    let updatedCount = 0;
    const shapeTool = this.toolManager?.tools?.shape;
    const textBgEnabled = window.textBgEnabled === true;

    activeObjects.forEach((obj: any) => {
      if (!obj) return;

      if (obj.type === 'i-text' || obj.type === 'text') {
        if (color) {
          obj.set('fill', color);
          obj.set('stroke', '#000000');
        }
        if (fontSize) {
          obj.set('fontSize', fontSize);
        }
        if (fontFamily) {
          obj.set('fontFamily', fontFamily);
        }
        obj.set('backgroundColor', textBgEnabled ? '#ffffff' : 'transparent');
        obj.dirty = true;
        updatedCount++;
        return;
      }

      if (obj.strokeMetadata?.type === 'shape') {
        const baseColor = color || obj.stroke || shapeTool?.strokeColor || '#3b82f6';
        obj.set({ fill: 'rgba(0,0,0,0)', stroke: baseColor });
        if (strokeWidth) {
          obj.set('strokeWidth', strokeWidth);
        }
        obj.dirty = true;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      this.canvasManager.fabricCanvas.requestRenderAll();
    }
  }

  updateSelectedShapesFill(style: string): void {
    if (!this.canvasManager.fabricCanvas) return;

    const activeObjects = this.canvasManager.fabricCanvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    let updatedCount = 0;
    const shapeTool = this.toolManager?.tools?.shape;

    activeObjects.forEach((obj: any) => {
      if (!obj || obj.strokeMetadata?.type !== 'shape') return;
      const baseColor = obj.stroke || shapeTool?.strokeColor || '#3b82f6';
      const styles = shapeTool?.getStyleForFillStyle
        ? shapeTool.getStyleForFillStyle(style, baseColor)
        : { fill: baseColor, stroke: baseColor };
      obj.set({ fill: styles.fill, stroke: styles.stroke });
      obj.dirty = true;
      updatedCount++;
    });

    if (updatedCount > 0) {
      this.canvasManager.fabricCanvas.requestRenderAll();
    }
  }

  setupUI(): void {
    // Undo/Redo
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) undoBtn.addEventListener('click', () => this.historyManager.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.historyManager.redo());

    // Rotate controls
    const rotateLeftCtrl = document.getElementById('rotateLeftCtrl');
    const rotateRightCtrl = document.getElementById('rotateRightCtrl');

    if (rotateLeftCtrl) {
      rotateLeftCtrl.addEventListener('click', () => {
        this.projectManager.rotateCurrentView(-90);
      });
    }

    if (rotateRightCtrl) {
      rotateRightCtrl.addEventListener('click', () => {
        this.projectManager.rotateCurrentView(90);
      });
    }

    // Fine rotate controls (hover bar)
    const rotateFineSlider = document.getElementById('rotateFineSlider') as HTMLInputElement | null;
    const rotateFineValue = document.getElementById('rotateFineValue');
    let lastFineValue = 0;

    const updateFineReadout = (value: number) => {
      if (rotateFineValue) {
        rotateFineValue.textContent = `${value}°`;
      }
    };

    const applyFineRotateDelta = (deltaDegrees: number) => {
      if (!deltaDegrees) return;
      this.projectManager.rotateCurrentView(deltaDegrees);
    };

    if (rotateFineSlider) {
      const setFineRotateActive = (active: boolean) => {
        document.body.classList.toggle('fine-rotate-active', active);
      };

      rotateFineSlider.addEventListener('pointerdown', (e: PointerEvent) => {
        rotateFineSlider.setPointerCapture(e.pointerId);
        setFineRotateActive(true);
      });
      rotateFineSlider.addEventListener('input', () => {
        const value = Number(rotateFineSlider.value);
        const delta = value - lastFineValue;
        lastFineValue = value;
        updateFineReadout(value);
        applyFineRotateDelta(delta);
      });
      rotateFineSlider.addEventListener('pointerup', () => {
        setFineRotateActive(false);
      });
    }

    // Tools
    const drawingModeToggles = document.querySelectorAll<HTMLElement>('#drawingModeToggle');
    const drawingModeWrappers = document.querySelectorAll<HTMLElement>('#drawingModeWrapper');
    const drawingModeOptions = document.querySelectorAll<HTMLElement>('[data-drawing-mode]');
    const textModeToggles = document.querySelectorAll<HTMLElement>('#textModeToggle');
    const textModeWrappers = document.querySelectorAll<HTMLElement>('#textModeWrapper');
    const textFontOptions = document.querySelectorAll<HTMLElement>('[data-text-font]');
    const clearBtn = document.getElementById('clear');
    let preferredTextWrapper: HTMLElement | null = null;

    const textToolFontFamilies: Record<string, string> = {
      handdrawn: 'Caveat',
      rounded: 'Nunito',
      mono: 'Space Mono',
      classic: 'Georgia',
    };

    const getCurrentTextSize = () => {
      const viewId = window.app?.projectManager?.currentViewId;
      const base = viewId ? window.originalImageDimensions?.[viewId] : null;
      const baseWidth = base?.width || 1200;
      return Math.max(24, Math.round((baseWidth / 1200) * 24));
    };

    const syncTextCursor = () => {
      const canvasEl = document.getElementById('canvas');
      if (!canvasEl) return;
      const isText = this.toolManager.activeTool === this.toolManager.tools.text;
      canvasEl.style.cursor = isText ? 'text' : 'crosshair';
    };

    const resolveTextWrapper = () => {
      if (preferredTextWrapper && preferredTextWrapper.isConnected) {
        return preferredTextWrapper;
      }
      const wrappers = Array.from(textModeWrappers);
      const visibleWrapper = wrappers.find(
        wrapper => wrapper.offsetParent !== null || wrapper.getClientRects().length > 0
      );
      preferredTextWrapper = visibleWrapper || wrappers[0] || null;
      return preferredTextWrapper;
    };

    const setActiveTextFontOption = (font: string) => {
      const allOptions = document.querySelectorAll<HTMLElement>('[data-text-font]');
      allOptions.forEach(option => option.classList.remove('active'));
      const matchingOptions = document.querySelectorAll<HTMLElement>(`[data-text-font="${font}"]`);
      matchingOptions.forEach(option => option.classList.add('active'));
    };

    const updateDrawingModeState = () => {
      const currentTool = this.toolManager.activeTool;
      const isDrawingMode =
        currentTool === this.toolManager.tools.line ||
        currentTool === this.toolManager.tools.curve ||
        currentTool === this.toolManager.tools.privacy ||
        currentTool === this.toolManager.tools.select;

      drawingModeWrappers.forEach(wrapper => {
        wrapper.classList.toggle('shape-active', isDrawingMode);
        if (!isDrawingMode) {
          wrapper.classList.remove('shape-open');
        }
      });

      drawingModeToggles.forEach(toggle => {
        toggle.setAttribute('aria-pressed', String(isDrawingMode));
      });

      drawingModeOptions.forEach(option => {
        const mode = option.getAttribute('data-drawing-mode');
        const isActive =
          (mode === 'line' && currentTool === this.toolManager.tools.line) ||
          (mode === 'curve' && currentTool === this.toolManager.tools.curve) ||
          (mode === 'privacy' && currentTool === this.toolManager.tools.privacy) ||
          (mode === 'select' && currentTool === this.toolManager.tools.select);
        option.classList.toggle('active', isActive);
      });
    };

    const updateTextToggleState = () => {
      const isText = this.toolManager.activeTool === this.toolManager.tools.text;
      const activeWrapper = isText ? resolveTextWrapper() : null;
      textModeWrappers.forEach(wrapper => {
        const isActiveWrapper = isText && wrapper === activeWrapper;
        wrapper.classList.toggle('shape-active', isActiveWrapper);
        if (!isActiveWrapper) {
          wrapper.classList.remove('shape-open');
        }
      });
      textModeToggles.forEach(toggle => {
        const wrapper = toggle.closest('.shape-toggle');
        const isActiveToggle = isText && wrapper === activeWrapper;
        toggle.setAttribute('aria-pressed', String(isActiveToggle));
        toggle.classList.toggle('shape-inactive', !isActiveToggle);
      });
    };

    const updateDrawingToggleLabels = (text: string) => {
      drawingModeToggles.forEach(toggle => this.updateToggleLabel(toggle, text));
    };

    drawingModeToggles.forEach(toggle => {
      toggle.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const wrapper = toggle.closest('.shape-toggle');
        if (wrapper) wrapper.classList.toggle('shape-open');
      });
    });

    textModeToggles.forEach(toggle => {
      toggle.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const wrapper = toggle.closest('.shape-toggle');
        if (wrapper instanceof HTMLElement) {
          preferredTextWrapper = wrapper;
        }
        void (async () => {
          const fontSize = getCurrentTextSize();
          const tool = await this.toolManager.ensureTool('text');
          if (tool?.setFontSize) {
            tool.setFontSize(fontSize);
          }
          this.toolManager.updateSettings({ fontSize });
          this.updateSelectedTextAndShapes({ fontSize });
          this.toolManager.previousToolName = this.toolManager.activeToolName || 'line';
          this.toolManager.selectTool('text');
          syncTextCursor();
          updateTextToggleState();
          if (wrapper) wrapper.classList.remove('shape-open');
        })();
      });
    });

    const shapeModeToggles = document.querySelectorAll<HTMLElement>('#shapeModeToggle');
    const shapeModeWrappers = document.querySelectorAll<HTMLElement>('#shapeModeWrapper');
    const shapeOptions = document.querySelectorAll<HTMLElement>('[data-shape-option]');
    const shapeFillToggles = document.querySelectorAll<HTMLElement>('[data-shape-fill-toggle]');
    const textStyleWrappers = document.querySelectorAll<HTMLElement>('#textStyleWrapper');
    const shapeFillStyles = [
      'solid',
      'no-fill',
      'clear-black',
      'clear-color',
      'clear-white',
    ] as const;
    const shapeFillLabels: Record<(typeof shapeFillStyles)[number], string> = {
      solid: 'Solid',
      'no-fill': 'No Fill',
      'clear-black': 'Clear Black',
      'clear-color': 'Clear Color',
      'clear-white': 'Clear White',
    };
    const shapeIcons: Record<string, string> = {
      square: '▭',
      triangle: '▲',
      circle: '●',
      star: '★',
    };
    const shapeLabels: Record<string, string> = {
      square: 'Rectangle',
      triangle: 'Triangle',
      circle: 'Circle',
      star: 'Star',
    };

    // Shape button click - activate shape tool and store previous tool
    shapeModeToggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        // Store previous tool name for returning after drawing
        const currentToolName = this.toolManager.activeToolName || 'line';
        this.toolManager.previousToolName = currentToolName;
        this.toolManager.selectTool('shape');
      });
    });

    const updateShapeIcon = (shape: string) => {
      shapeModeToggles.forEach(toggle => {
        const icon = toggle.querySelector('.shape-icon');
        if (icon) icon.textContent = shapeIcons[shape] ?? shapeIcons['square'] ?? null;
        this.updateToggleLabel(toggle, shapeLabels[shape] ?? 'Shapes');
      });
      shapeOptions.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-shape-option') === shape);
      });
    };

    const updateShapeAvailability = () => {
      const isShapeMode = this.toolManager.activeTool === this.toolManager.tools.shape;
      shapeModeWrappers.forEach(wrapper => {
        wrapper.classList.toggle('shape-active', isShapeMode);
        if (!isShapeMode) {
          wrapper.classList.remove('shape-open');
        }
      });
      shapeModeToggles.forEach(toggle => {
        toggle.setAttribute('aria-pressed', String(isShapeMode));
      });
    };

    const applyShapeFillStyle = (style: (typeof shapeFillStyles)[number]) => {
      if (this.toolManager.tools.shape) {
        this.toolManager.tools.shape.setFillStyle(style);
      }
      shapeFillToggles.forEach(toggle => {
        toggle.textContent = `Fill: ${shapeFillLabels[style]}`;
        toggle.setAttribute('aria-pressed', String(style !== 'solid'));
      });
      this.updateSelectedShapesFill(style);
    };

    const bindShapeMenu = (wrapper: HTMLElement, shouldShow?: () => boolean) => {
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      const showMenu = () => {
        if (shouldShow && !shouldShow()) return;
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        wrapper.classList.add('shape-open');
      };

      const scheduleHide = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          wrapper.classList.remove('shape-open');
          hideTimer = null;
        }, 200);
      };

      wrapper.addEventListener('mouseenter', showMenu);
      wrapper.addEventListener('mouseleave', scheduleHide);
    };

    shapeModeWrappers.forEach(wrapper => bindShapeMenu(wrapper, () => true));
    textStyleWrappers.forEach(wrapper => bindShapeMenu(wrapper));
    drawingModeWrappers.forEach(wrapper => bindShapeMenu(wrapper));
    textModeWrappers.forEach(wrapper => bindShapeMenu(wrapper, () => true));

    if (this.toolManager.tools.shape) {
      updateShapeIcon(this.toolManager.tools.shape.shapeType);
      const initialStyle =
        (this.toolManager.tools.shape.getFillStyle?.() as
          | (typeof shapeFillStyles)[number]
          | undefined) ?? 'solid';
      applyShapeFillStyle(initialStyle);
    }

    const selectShapeOption = async (btn: HTMLElement) => {
      const shape = btn.getAttribute('data-shape-option');
      if (!shape) return;
      const shapeTool = await this.toolManager.ensureTool('shape');
      if (!shapeTool?.setShapeType) return;
      this.toolManager.previousToolName = this.toolManager.activeToolName || 'line';
      shapeTool.setShapeType(shape);
      this.toolManager.selectTool('shape');
      updateShapeIcon(shape);
      updateShapeAvailability();
      const wrapper = btn.closest('.shape-toggle');
      if (wrapper) wrapper.classList.remove('shape-open');
    };

    shapeOptions.forEach(btn => {
      btn.addEventListener('click', () => {
        void selectShapeOption(btn);
      });
    });

    drawingModeOptions.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-drawing-mode');
        if (!mode) return;
        if (mode === 'curve') {
          this.toolManager.selectTool('curve');
          updateDrawingToggleLabels('Curved Line');
        } else if (mode === 'privacy') {
          this.toolManager.selectTool('privacy');
          updateDrawingToggleLabels('Privacy Erase');
        } else if (mode === 'select') {
          this.toolManager.selectTool('select');
          updateDrawingToggleLabels('Select');
        } else {
          this.toolManager.selectTool('line');
          updateDrawingToggleLabels('Straight Line');
        }
        drawingModeOptions.forEach(item => item.classList.remove('active'));
        btn.classList.add('active');
        const wrapper = btn.closest('.shape-toggle');
        if (wrapper) wrapper.classList.remove('shape-open');
      });
    });

    textFontOptions.forEach(btn => {
      btn.addEventListener(
        'click',
        () =>
          void (async () => {
            const font = btn.getAttribute('data-text-font');
            if (!font) return;
            const fontFamily = textToolFontFamilies[font] || textToolFontFamilies['rounded'];
            const tool = await this.toolManager.ensureTool('text');
            if (tool?.setFontFamily) {
              tool.setFontFamily(fontFamily);
            }
            this.toolManager.updateSettings({ fontFamily });
            this.updateSelectedTextAndShapes({ fontFamily });
            this.toolManager.previousToolName = this.toolManager.activeToolName || 'line';
            this.toolManager.selectTool('text');
            syncTextCursor();
            updateTextToggleState();
            const parentDropdown = btn.closest('.shape-toggle');
            if (parentDropdown instanceof HTMLElement) {
              preferredTextWrapper = parentDropdown;
            }
            setActiveTextFontOption(font);
            const wrapper = btn.closest('.shape-toggle');
            if (wrapper) wrapper.classList.remove('shape-open');
          })()
      );
    });

    if (textFontOptions.length > 0) {
      setActiveTextFontOption('rounded');
      this.toolManager.updateSettings({ fontFamily: textToolFontFamilies['rounded'] });
    }

    shapeFillToggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        const tool = this.toolManager.tools.shape;
        const currentStyle =
          (tool?.getFillStyle?.() as (typeof shapeFillStyles)[number] | undefined) ?? 'solid';
        const currentIndex = shapeFillStyles.indexOf(currentStyle);
        const nextIndex = (currentIndex + 1) % shapeFillStyles.length;
        applyShapeFillStyle(shapeFillStyles[nextIndex]!);
      });
    });

    window.addEventListener('toolchange', () => {
      updateDrawingModeState();
      updateShapeAvailability();
      if (this.toolManager.tools.shape) {
        updateShapeIcon(this.toolManager.tools.shape.shapeType);
      }
      const currentTool = this.toolManager.activeTool;
      if (currentTool === this.toolManager.tools.line) {
        updateDrawingToggleLabels('Straight Line');
      } else if (currentTool === this.toolManager.tools.curve) {
        updateDrawingToggleLabels('Curved Line');
      } else if (currentTool === this.toolManager.tools.privacy) {
        updateDrawingToggleLabels('Privacy Erase');
      } else if (currentTool === this.toolManager.tools.select) {
        updateDrawingToggleLabels('Select');
      }
      syncTextCursor();
      updateTextToggleState();
    });

    updateTextToggleState();
    updateDrawingModeState();

    updateShapeAvailability();

    // Arrows - select Arrow tool
    const startArrowBtn = document.getElementById('startArrow');
    const endArrowBtn = document.getElementById('endArrow');

    const selectArrowTool = () => {
      this.toolManager.selectTool('arrow');
      // Update drawing mode toggle label if needed
      const drawingModeToggle = document.getElementById('drawingModeToggle');
      if (drawingModeToggle) {
        // Don't change the label, just switch to arrow tool
      }
    };

    if (startArrowBtn) startArrowBtn.addEventListener('click', selectArrowTool);
    if (endArrowBtn) endArrowBtn.addEventListener('click', selectArrowTool);

    // Clear
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the canvas?')) {
          this.canvasManager.clear();
          this.historyManager.saveState();
        }
      });
    }

    // Color Picker
    const colorPicker = document.getElementById('colorPicker') as HTMLInputElement | null;
    const colorButtons = document.querySelectorAll<HTMLElement>('[data-color]');
    const textBgToggles = document.querySelectorAll<HTMLInputElement>('[data-text-bg-toggle]');

    if (window.textBgEnabled === undefined) {
      window.textBgEnabled = true;
    }

    if (colorPicker) {
      colorPicker.addEventListener('input', (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        if (!target) return;
        // Update tool settings for new strokes
        this.toolManager.updateSettings({ color: target.value });

        if (this.toolManager?.tools?.shape) {
          this.toolManager.tools.shape.setFillStyle('no-fill');
        }

        // Update selected strokes if any are selected
        this.updateSelectedStrokes('color', target.value);

        // Update selected text/shape elements
        this.updateSelectedTextAndShapes({ color: target.value });
      });
    }

    textBgToggles.forEach(toggle => {
      toggle.checked = window.textBgEnabled === true;
    });

    colorButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.getAttribute('data-color');
        if (!color) return;

        // Update tool settings for new strokes
        this.toolManager.updateSettings({ color: color });
        if (colorPicker) {
          colorPicker.value = color;
          colorPicker.dispatchEvent(new Event('change'));
        }

        if (this.toolManager?.tools?.shape) {
          this.toolManager.tools.shape.setFillStyle('no-fill');
        }

        // Update selected strokes if any are selected
        this.updateSelectedStrokes('color', color);

        // Update selected text/shape elements
        this.updateSelectedTextAndShapes({ color: color });

        // Update active state
        colorButtons.forEach(b => b.classList.remove('active', 'transform', 'scale-110'));
        btn.classList.add('active', 'transform', 'scale-110');
      });
    });

    // Line width/thickness control
    const brushSizeSelect = document.getElementById('brushSize') as HTMLInputElement | null;
    const parseBrushWidth = (value: string): number => {
      const parsed = parseInt((value || '').replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(parsed)) return 1;
      return Math.max(1, Math.min(300, parsed));
    };
    const formatBrushWidth = (value: number): string => String(value);
    const resizableTools = new Set(['line', 'curve', 'arrow', 'pencil', 'shape', 'privacy']);

    const handleAltBrushWheel = (wheelEvent: WheelEvent): boolean => {
      if (!wheelEvent.altKey) return false;

      const activeTool = this.toolManager?.activeToolName;
      if (!activeTool || !resizableTools.has(activeTool)) {
        return false;
      }

      const eventTarget = wheelEvent.target;
      const targetElement = eventTarget instanceof Element ? eventTarget : null;
      const insideBrushInput = !!targetElement?.closest('#brushSize');
      if (!insideBrushInput) {
        return false;
      }

      const target = document.getElementById('brushSize') as HTMLInputElement | null;
      if (!target) return false;

      const min = Math.max(1, parseInt(target.min || '1', 10) || 1);
      const max = Math.max(min, parseInt(target.max || '300', 10) || 300);
      const step = Math.max(1, parseInt(target.step || '1', 10) || 1);
      const current = parseBrushWidth(target.value);
      const direction = wheelEvent.deltaY < 0 ? 1 : -1;
      const next = Math.max(min, Math.min(max, current + direction * step));

      wheelEvent.preventDefault();
      wheelEvent.stopPropagation();
      (wheelEvent as unknown as { __brushSizeHandled?: boolean }).__brushSizeHandled = true;

      target.value = formatBrushWidth(next);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    if (brushSizeSelect) {
      const applyBrushWidth = (width: number) => {
        // Update tool settings for new strokes
        this.toolManager.updateSettings({ width });

        // Update selected strokes if any are selected (handles both single and multi-selection)
        this.updateSelectedStrokes('strokeWidth', width);

        // Update selected shape elements only (text ignores brush size)
        this.updateSelectedTextAndShapes({ strokeWidth: width });
      };

      const handleBrushSizeInput = (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        if (!target) return;
        const width = parseBrushWidth(target.value);
        applyBrushWidth(width);
      };

      const commitBrushSizeValue = (target: HTMLInputElement | null) => {
        if (!target) return;
        const width = parseBrushWidth(target.value);
        target.value = formatBrushWidth(width);
        applyBrushWidth(width);
      };

      brushSizeSelect.addEventListener('input', handleBrushSizeInput);
      brushSizeSelect.addEventListener('change', e => {
        commitBrushSizeValue(e.target as HTMLInputElement | null);
      });
      brushSizeSelect.addEventListener('blur', e => {
        commitBrushSizeValue(e.target as HTMLInputElement | null);
      });
      brushSizeSelect.addEventListener('focus', e => {
        const target = e.target as HTMLInputElement | null;
        if (!target) return;
        target.value = String(parseBrushWidth(target.value));
      });
      brushSizeSelect.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        commitBrushSizeValue(e.target as HTMLInputElement | null);
      });
      brushSizeSelect.addEventListener(
        'wheel',
        e => {
          handleAltBrushWheel(e as WheelEvent);
          e.preventDefault();
        },
        { passive: false }
      );

      // Initialize to canonical displayed format
      commitBrushSizeValue(brushSizeSelect);
    }

    // Dash style controls (solid/dotted/partial split)
    const dashStyleSelect = document.getElementById('dashStyleSelect') as HTMLSelectElement | null;
    const dottedBtn = document.getElementById('dottedBtn') as HTMLButtonElement | null;
    const dashControls = document.getElementById('dashControls');
    let dashSplitInput = document.getElementById('dashSplitInput') as HTMLInputElement | null;

    if (dashControls && !dashSplitInput) {
      const splitWrap = document.createElement('label');
      splitWrap.id = 'dashSplitWrap';
      splitWrap.className = 'hidden items-center gap-2';
      splitWrap.innerHTML =
        '<span class="text-xs text-slate-500">Split</span><input id="dashSplitInput" type="range" min="0" max="100" value="50" class="w-24 accent-blue-500" aria-label="Dashed split position" /><button id="dashSplitHalfBtn" type="button" class="text-xs px-2 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50">1/2</button><button id="dashSplitOrderBtn" type="button" class="text-xs px-2 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50">Dash -> Solid</button>';
      dashControls.appendChild(splitWrap);
      dashSplitInput = splitWrap.querySelector('#dashSplitInput') as HTMLInputElement | null;
    }
    const dashSplitHalfBtn = document.getElementById(
      'dashSplitHalfBtn'
    ) as HTMLButtonElement | null;
    const dashSplitOrderBtn = document.getElementById(
      'dashSplitOrderBtn'
    ) as HTMLButtonElement | null;

    const dashedCycle = ['solid', 'dotted', 'small', 'medium', 'large', 'dot-dash', 'mixed'];
    const setLineStyleIcon = (style: string) => {
      if (!dottedBtn) return;
      const iconMap: Record<string, string> = {
        solid:
          '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        dotted:
          '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 5"/></svg>',
        small:
          '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5"/></svg>',
        medium:
          '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="8 5"/></svg>',
        large:
          '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="12 7"/></svg>',
        'dot-dash':
          '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5 1 5"/></svg>',
        mixed:
          '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="17" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 5"/><line x1="17" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="17" cy="6" r="2" fill="currentColor"/></svg>',
      };
      dottedBtn.innerHTML = iconMap[style] || iconMap.solid;
    };

    const applyDashStyle = (style: string) => {
      const normalizedStyle = style || 'solid';
      const mixedEnabled = normalizedStyle === 'mixed';
      const pattern = this.getDashPatternForStyle(normalizedStyle);
      const splitRatio = Math.max(0, Math.min(1, Number(dashSplitInput?.value || 50) / 100));
      const dashFirst = this.currentDashSettings.dashFirst !== false;

      this.currentDashSettings = {
        style: normalizedStyle,
        pattern,
        splitRatio,
        mixedEnabled,
        dashFirst,
      };

      this.applyDashSettingsToTools(pattern);
      this.applyDashSettingsToSelection();

      if (dashStyleSelect && dashStyleSelect.value !== normalizedStyle) {
        dashStyleSelect.value = normalizedStyle;
      }
      if (dashSplitInput) {
        const wrap = document.getElementById('dashSplitWrap');
        wrap?.classList.toggle('hidden', !mixedEnabled);
        wrap?.classList.toggle('flex', mixedEnabled);
      }
      if (dashSplitOrderBtn) {
        dashSplitOrderBtn.textContent = dashFirst ? 'Dash -> Solid' : 'Solid -> Dash';
      }
      setLineStyleIcon(normalizedStyle);
      this.updateDashSplitHandleForSelection();
    };

    if (dashStyleSelect) {
      dashStyleSelect.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLSelectElement | null;
        if (!target) return;
        applyDashStyle(target.value);
      });
    }

    if (dashSplitInput) {
      dashSplitInput.addEventListener('input', () => {
        if (this.currentDashSettings.style !== 'mixed') return;
        applyDashStyle('mixed');
      });
    }

    if (dashSplitHalfBtn) {
      dashSplitHalfBtn.addEventListener('click', () => {
        if (!dashSplitInput) return;
        dashSplitInput.value = '50';
        applyDashStyle('mixed');
      });
    }

    if (dashSplitOrderBtn) {
      dashSplitOrderBtn.addEventListener('click', () => {
        this.currentDashSettings.dashFirst = !this.currentDashSettings.dashFirst;
        applyDashStyle('mixed');
      });
    }

    if (dottedBtn) {
      dottedBtn.addEventListener(
        'click',
        e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const current = this.currentDashSettings.style || 'solid';
          const currentIndex = dashedCycle.indexOf(current);
          const nextStyle =
            dashedCycle[(currentIndex + 1 + dashedCycle.length) % dashedCycle.length];
          applyDashStyle(nextStyle || 'solid');
        },
        true
      );
      setLineStyleIcon(this.currentDashSettings.style);
    }

    this.initDashSplitHandleSystem();
    this.updateDashSplitHandleForSelection();

    // Image fit mode control
    const fitModeSelect = document.getElementById('fitModeSelect') as HTMLSelectElement | null;
    if (fitModeSelect) {
      fitModeSelect.addEventListener('change', () => {
        const fitMode = fitModeSelect.value;
        console.log(`[ImageFit] Applying fit mode: ${fitMode}`);
        this.applyImageFitMode(fitMode);
      });
    }

    // Setup keyboard shortcuts and help system
    this.setupKeyboardControls();

    // Create help hint
    this.createHelpHint();

    // Setup unit toggle buttons
    this.setupUnitToggle();

    // Make metadata manager available globally for compatibility
    window.metadataManager = this.metadataManager;
    window.vectorStrokesByImage = this.metadataManager.vectorStrokesByImage;
    window.strokeVisibilityByImage = this.metadataManager.strokeVisibilityByImage;
    window.strokeLabelVisibility = this.metadataManager.strokeLabelVisibility;
    window.strokeMeasurements = this.metadataManager.strokeMeasurements;

    // Expose updateStrokeVisibilityControls function globally
    window.updateStrokeVisibilityControls = () =>
      this.metadataManager.updateStrokeVisibilityControls();

    // Initialize the stroke visibility controls
    setTimeout(() => {
      if (this.metadataManager) {
        this.metadataManager.updateStrokeVisibilityControls();
      }
    }, 100);

    // Make project manager available globally for image switching
    window.projectManager = this.projectManager;
    window.shareProject = () => this.projectManager.shareProject();
    window.updateSharedProject = () => this.projectManager.updateSharedProject();
    window.app = this;

    // Copy Canvas button - copies image to clipboard (cropped to capture frame if present)
    const copyCanvasBtn = document.getElementById('copyCanvasBtn');
    if (copyCanvasBtn) {
      copyCanvasBtn.addEventListener(
        'click',
        () =>
          void (async () => {
            console.log('[Copy] Button clicked');
            try {
              const canvas = this.canvasManager?.fabricCanvas;
              if (!canvas) {
                console.error('[Copy] Canvas not available');
                return;
              }

              // Visual feedback - subtle press animation
              copyCanvasBtn.style.transform = 'scale(0.98)';
              setTimeout(() => {
                copyCanvasBtn.style.transform = '';
              }, 100);

              // Get icon elements for animation
              const copyIcon = copyCanvasBtn.querySelector('#copyIcon') as HTMLElement | null;
              const checkIcon = copyCanvasBtn.querySelector('#checkIcon') as HTMLElement | null;

              // Get the capture frame if it exists
              const captureFrame = document.getElementById('captureFrame');
              const sourceCanvas = (canvas as any).lowerCanvasEl;
              let cropData: { x: number; y: number; width: number; height: number } | null = null;

              if (captureFrame) {
                const frameRect = captureFrame.getBoundingClientRect();
                const canvasRect = sourceCanvas.getBoundingClientRect();

                // Check if frame overlaps with canvas
                if (
                  frameRect.left < canvasRect.right &&
                  frameRect.right > canvasRect.left &&
                  frameRect.top < canvasRect.bottom &&
                  frameRect.bottom > canvasRect.top
                ) {
                  // Calculate crop area in canvas pixel coordinates
                  const scalePx = sourceCanvas.width / canvasRect.width;
                  const left = Math.max(frameRect.left, canvasRect.left);
                  const top = Math.max(frameRect.top, canvasRect.top);
                  const right = Math.min(frameRect.right, canvasRect.right);
                  const bottom = Math.min(frameRect.bottom, canvasRect.bottom);

                  cropData = {
                    x: Math.round((left - canvasRect.left) * scalePx),
                    y: Math.round((top - canvasRect.top) * scalePx),
                    width: Math.round((right - left) * scalePx),
                    height: Math.round((bottom - top) * scalePx),
                  };
                  console.log('[Copy] Cropping to frame:', cropData);
                }
              }

              // Create a temporary canvas for the output
              const tempCanvas = document.createElement('canvas');
              const tempCtx = tempCanvas.getContext('2d');
              if (!tempCtx) {
                throw new Error('Failed to acquire 2D context');
              }

              if (cropData && cropData.width > 0 && cropData.height > 0) {
                // Copy the cropped region
                tempCanvas.width = cropData.width;
                tempCanvas.height = cropData.height;
                tempCtx.drawImage(
                  sourceCanvas,
                  cropData.x,
                  cropData.y,
                  cropData.width,
                  cropData.height,
                  0,
                  0,
                  cropData.width,
                  cropData.height
                );
              } else {
                // Copy the entire canvas
                tempCanvas.width = sourceCanvas.width;
                tempCanvas.height = sourceCanvas.height;
                tempCtx.drawImage(sourceCanvas, 0, 0);
                console.log(
                  '[Copy] Copying full canvas:',
                  tempCanvas.width,
                  'x',
                  tempCanvas.height
                );
              }

              // Convert to blob and copy to clipboard
              const blob = await new Promise<Blob>((resolve, reject) => {
                tempCanvas.toBlob((b: Blob | null) => {
                  if (b) resolve(b);
                  else reject(new Error('Failed to create blob'));
                }, 'image/png');
              });

              console.log('[Copy] Blob created, size:', blob.size);

              const ClipboardItemConstructor = (
                window as Window & { ClipboardItem?: typeof ClipboardItem }
              ).ClipboardItem;
              if (navigator.clipboard && ClipboardItemConstructor) {
                await navigator.clipboard.write([
                  new ClipboardItemConstructor({ 'image/png': blob }),
                ]);
                console.log('[Copy] Successfully copied to clipboard');

                // Show success feedback
                if (this.projectManager?.showStatusMessage) {
                  this.projectManager.showStatusMessage('Image copied to clipboard!', 'success');
                }

                // Visual success feedback - icon transition to checkmark
                if (copyIcon && checkIcon) {
                  copyIcon.classList.add('opacity-0', 'scale-50');
                  copyIcon.classList.remove('opacity-90', 'scale-100');
                  checkIcon.classList.remove('opacity-0', 'scale-50');
                  checkIcon.classList.add('opacity-100', 'scale-100');

                  // Transition back to copy icon after delay
                  setTimeout(() => {
                    checkIcon.classList.add('opacity-0', 'scale-50');
                    checkIcon.classList.remove('opacity-100', 'scale-100');
                    copyIcon.classList.remove('opacity-0', 'scale-50');
                    copyIcon.classList.add('opacity-90', 'scale-100');
                  }, 1500);
                }
              } else {
                console.warn('[Copy] Clipboard API not supported');
                if (this.projectManager?.showStatusMessage) {
                  this.projectManager.showStatusMessage(
                    'Clipboard not supported in this browser',
                    'error'
                  );
                }
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.error('[Copy] Failed to copy to clipboard:', error);
              if (this.projectManager?.showStatusMessage) {
                this.projectManager.showStatusMessage('Failed to copy image: ' + message, 'error');
              }

              // Visual error feedback - subtle shake animation
              copyCanvasBtn.style.animation = 'shake 0.3s ease-in-out';
              setTimeout(() => {
                copyCanvasBtn.style.animation = '';
              }, 300);
            }
          })()
      );
      console.log('[main.js] Copy canvas button event listener added');
    } else {
      console.warn('[main.js] Copy canvas button not found');
    }
  }

  setupUnitToggle(): void {
    const unitToggle = document.getElementById('unitToggleBtn');
    const unitToggleSecondary = document.getElementById('unitToggleBtnSecondary');
    const unitSelector = document.getElementById('unitSelector') as HTMLSelectElement | null;

    // Initialize currentUnit state
    this.currentUnit = 'inch';

    const applyUnit = (unit: 'inch' | 'cm'): void => {
      this.currentUnit = unit;

      if (unitSelector) {
        unitSelector.value = unit;
      }

      const unitLabel = unit === 'inch' ? 'inches' : 'cm';
      if (unitToggle) unitToggle.textContent = unitLabel;
      if (unitToggleSecondary) unitToggleSecondary.textContent = unitLabel;

      if (this.measurementSystem) {
        this.measurementSystem.setUnit(unitLabel);
      }

      if (this.metadataManager) {
        this.metadataManager.refreshAllMeasurements();
      }
    };

    // Sync initial state
    if (unitSelector) {
      // Force reset to inch to avoid browser form restoration issues
      unitSelector.value = 'inch';
    }
    applyUnit('inch');

    if (unitToggle) {
      unitToggle.addEventListener('click', () => {
        applyUnit(this.currentUnit === 'inch' ? 'cm' : 'inch');
      });
    }

    if (unitToggleSecondary) {
      unitToggleSecondary.addEventListener('click', () => {
        applyUnit(this.currentUnit === 'inch' ? 'cm' : 'inch');
      });
    }

    // Also listen for direct changes to unit selector
    if (unitSelector) {
      unitSelector.addEventListener('change', () => {
        applyUnit(unitSelector.value as 'inch' | 'cm');
      });
    }

    // Setup Show Measurements toggle
    const showMeasurementsCheckbox = document.getElementById(
      'toggleShowMeasurements'
    ) as HTMLInputElement | null;
    if (showMeasurementsCheckbox) {
      showMeasurementsCheckbox.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        if (!target) return;
        const showMeasurements = target.checked;
        console.log(`[ShowMeasurements] Toggle: ${showMeasurements}`);

        // Update all tags to show/hide measurements
        if (this.tagManager) {
          this.tagManager.setShowMeasurements(showMeasurements);
        }
      });

      // Set initial state
      if (this.tagManager) {
        this.tagManager.setShowMeasurements(showMeasurementsCheckbox.checked);
      }
    }
  }

  setupKeyboardShortcuts(): void {
    // Tab key cycles through drawing modes: Straight Line -> Curved Line -> Shapes -> Select -> Straight Line
    // Tab key cycles through drawing modes: Straight Line -> Curved Line -> Shapes -> Select -> Straight Line
    // Use capture phase to ensure we catch it before anything else
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.key !== 'Tab') {
          return;
        }

        // Don't cycle if typing in an input/textarea or if text tool is active
        // Exception: Allow cycling if the target is a measurement span (user wants to tab out of it)
        const target = e.target as HTMLElement | null;
        const isMeasurement = target?.classList && target.classList.contains('stroke-measurement');
        if (
          (target?.tagName === 'INPUT' ||
            target?.tagName === 'TEXTAREA' ||
            target?.isContentEditable) &&
          !isMeasurement
        ) {
          return;
        }

        // Don't cycle if text tool is active (user might be typing).
        // Also prevent default focus navigation so Tab does not appear to switch modes.
        if (this.toolManager.activeToolName === 'text') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // Prevent default tab behavior (focus switching)
        e.preventDefault();
        e.stopPropagation();

        // Blur any active element to ensure focus doesn't get stuck
        if (document.activeElement && document.activeElement !== document.body) {
          (document.activeElement as HTMLElement).blur();
        }

        const currentToolName = this.toolManager.activeToolName;
        const drawingModeToggle = document.getElementById('drawingModeToggle');

        if (currentToolName === 'line') {
          // Straight Line -> Curved Line
          this.toolManager.selectTool('curve');
          if (drawingModeToggle) {
            this.updateToggleLabel(drawingModeToggle, 'Curved Line');
          }
        } else if (currentToolName === 'curve') {
          // Curved Line -> Select
          this.toolManager.selectTool('select');
          if (drawingModeToggle) {
            this.updateToggleLabel(drawingModeToggle, 'Select');
          }
        } else {
          // Select (or any other tool) -> Straight Line
          this.toolManager.selectTool('line');
          if (drawingModeToggle) {
            this.updateToggleLabel(drawingModeToggle, 'Straight Line');
          }
        }
      },
      true
    ); // Use capture phase
  }

  updateToggleLabel(button: Element, text: string): void {
    const longSpan = button.querySelector('.label-long');
    const shortSpan = button.querySelector('.label-short');
    if (longSpan) longSpan.textContent = text;
    if (shortSpan) {
      // Set short label based on text
      if (text === 'Straight Line') {
        shortSpan.textContent = 'Straight';
      } else if (text === 'Curved Line') {
        shortSpan.textContent = 'Curved';
      } else if (text === 'Privacy Erase') {
        shortSpan.textContent = 'Erase';
      } else if (text === 'Shapes') {
        shortSpan.textContent = 'Shapes';
      } else if (text === 'Select') {
        shortSpan.textContent = 'Select';
      } else {
        shortSpan.textContent = text;
      }
    }
  }

  applyImageFitMode(fitMode: string): void {
    const currentView = (this.projectManager.views as any)[this.projectManager.currentViewId];

    if (!currentView || !currentView.image) {
      console.warn('No current image available for fit mode');
      return;
    }

    // Simply call the project manager's setBackgroundImage with the fit mode
    this.projectManager.setBackgroundImage(currentView.image, fitMode);
  }

  setupKeyboardControls(): void {
    // Create +/- buttons for resizing capture frame
    this.captureFrameScale = 1.0;

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // Don't interfere if typing in input fields
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }

      // Don't interfere if text tool is actively editing
      const textTool = this.toolManager?.tools?.text;
      if (textTool?.activeTextObject?.isEditing) {
        return;
      }

      // Handle capture frame resize shortcuts
      let scaleChange = 0;

      if (e.key === '+' || e.key === '=') {
        scaleChange = 0.1; // Increase by 10%
      } else if (e.key === '-') {
        scaleChange = -0.1; // Decrease by 10%
      }

      if (scaleChange !== 0) {
        e.preventDefault();
        this.resizeCaptureFrameProportionally(scaleChange);
        return;
      }

      // Handle help menu toggle
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        this.toggleHelpMenu();
      }
    });
  }

  resizeCaptureFrameProportionally(scaleChange: number): void {
    const captureFrame = document.getElementById('captureFrame');
    if (!captureFrame) return;

    this.captureFrameScale = Math.max(0.2, Math.min(3.0, this.captureFrameScale + scaleChange));

    const baseWidth = 800;
    const baseHeight = 600;
    const aspectRatio = 4 / 3;

    const newWidth = baseWidth * this.captureFrameScale;
    const newHeight = baseHeight * this.captureFrameScale;

    // Ensure frame fits within viewport
    const maxWidth = window.innerWidth * 0.9;
    const maxHeight = window.innerHeight * 0.9;

    let frameWidth = newWidth;
    let frameHeight = newHeight;

    if (frameWidth > maxWidth) {
      frameWidth = maxWidth;
      frameHeight = frameWidth / aspectRatio;
      this.captureFrameScale = frameWidth / baseWidth;
    }

    if (frameHeight > maxHeight) {
      frameHeight = maxHeight;
      frameWidth = frameHeight * aspectRatio;
      this.captureFrameScale = frameHeight / baseHeight;
    }

    // Center the frame
    const left = (window.innerWidth - frameWidth) / 2;
    const top = (window.innerHeight - frameHeight) / 2;

    // Apply the new size and position
    captureFrame.style.left = `${left}px`;
    captureFrame.style.top = `${top}px`;
    captureFrame.style.width = `${frameWidth}px`;
    captureFrame.style.height = `${frameHeight}px`;

    // Save the new capture frame position for the current image
    if (window.saveCurrentCaptureFrameForLabel) {
      window.saveCurrentCaptureFrameForLabel(this.projectManager.currentViewId);
    }

    console.log(
      `[CaptureFrame] Proportional resize: ${(this.captureFrameScale * 100).toFixed(0)}% (${frameWidth.toFixed(0)}x${frameHeight.toFixed(0)})`
    );
  }

  createHelpHint(): void {
    // Create help hint in bottom right corner
    const helpHint = document.createElement('div');
    helpHint.id = 'helpHint';
    helpHint.innerHTML = 'Press <kbd>H</kbd> for help';
    helpHint.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            z-index: 1000;
            pointer-events: none;
        `;

    // Style the kbd element
    const kbd = helpHint.querySelector('kbd') as HTMLElement | null;
    if (kbd) {
      kbd.style.cssText = `
                background: rgba(255, 255, 255, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 3px;
                padding: 2px 4px;
                font-size: 11px;
                font-weight: bold;
            `;
    }

    document.body.appendChild(helpHint);
  }

  createHelpMenu(): void {
    const helpOverlay = document.createElement('div');
    helpOverlay.id = 'helpOverlay';
    helpOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

    const helpMenu = document.createElement('div');
    helpMenu.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 30px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        `;

    helpMenu.innerHTML = `
            <h2 style="margin-top: 0; margin-bottom: 20px; color: #333; font-size: 24px; font-weight: 600;">Keyboard Shortcuts</h2>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: #555; font-size: 16px; margin-bottom: 10px; font-weight: 600;">Drawing Tools</h3>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 14px;">
                    <kbd>Tab</kbd><span>Cycle through drawing modes (Line → Curve → Shapes → Select)</span>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: #555; font-size: 16px; margin-bottom: 10px; font-weight: 600;">Capture Frame</h3>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 14px;">
                    <kbd>+</kbd><span>Increase capture frame size</span>
                    <kbd>-</kbd><span>Decrease capture frame size</span>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: #555; font-size: 16px; margin-bottom: 10px; font-weight: 600;">General</h3>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 14px;">
                    <kbd>H</kbd><span>Show/hide this help menu</span>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 25px;">
                <button id="closeHelp" style="
                    background: #3b82f6;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                ">Close</button>
            </div>
        `;

    // Style all kbd elements
    const kbdElements = helpMenu.querySelectorAll<HTMLElement>('kbd');
    kbdElements.forEach(kbd => {
      kbd.style.cssText = `
                background: #f3f4f6;
                border: 1px solid #d1d5db;
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 12px;
                font-weight: bold;
                color: #374151;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            `;
    });

    helpOverlay.appendChild(helpMenu);
    document.body.appendChild(helpOverlay);

    // Close help menu handlers
    const closeBtn = helpMenu.querySelector<HTMLButtonElement>('#closeHelp');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        document.body.removeChild(helpOverlay);
      });
    }

    // Close on overlay click
    helpOverlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === helpOverlay) {
        document.body.removeChild(helpOverlay);
      }
    });

    // Close on Escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.body.removeChild(helpOverlay);
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  toggleHelpMenu(): void {
    const existingOverlay = document.getElementById('helpOverlay');
    if (existingOverlay) {
      document.body.removeChild(existingOverlay);
    } else {
      this.createHelpMenu();
    }
  }
}

function startApp(): void {
  window.app = new App();

  // Explicitly show panels to prevent them from being hidden by CSS
  const panels = ['strokePanel', 'imagePanel', 'canvasControls'];
  panels.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('hidden');
      // Use flex for side panels, block for bottom controls
      el.style.display = id === 'canvasControls' ? 'block' : 'flex';
      // Mark as loaded to enable transitions
      requestAnimationFrame(() => {
        el.setAttribute('data-loaded', 'true');
      });
    }
  });
}

// Start the app when DOM is ready, or immediately if it already fired.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
