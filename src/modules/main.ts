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
  primaryCanvasManager: CanvasManager;
  compareCanvasManager: CanvasManager | null;
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
  measurementOverlayManager: DeferredManager | null;
  deferredInitStarted: boolean;
  deferredToolPreloadStarted: boolean;
  hasDrawnFirstStroke: boolean;
  hasUploadedFirstImage: boolean;
  firstPaintMarked: boolean;
  firstStrokeCommitMarked: boolean;
  firstStrokeCommitInProgress: boolean;
  currentUnit: 'inch' | 'cm';
  currentInchDisplayMode: 'decimal' | 'fraction';
  captureFrameScale: number;
  currentDashSettings: {
    style: string;
    pattern: number[];
    splitRatio: number;
    mixedEnabled: boolean;
    dashFirst: boolean;
    tapeTickSpacing: number;
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
  activeCanvasPane: 'left' | 'right';

  constructor() {
    this.canvasManager = new CanvasManager('canvas');
    this.primaryCanvasManager = this.canvasManager;
    this.compareCanvasManager = null;
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
    this.currentInchDisplayMode = 'decimal';
    const scaleFromW = typeof window !== 'undefined' ? (window.innerWidth * 0.8) / 800 : 0.9;
    const scaleFromH = typeof window !== 'undefined' ? (window.innerHeight * 0.75) / 600 : 0.9;
    this.captureFrameScale = Math.max(0.9, Math.min(3.0, Math.min(scaleFromW, scaleFromH)));
    this.currentDashSettings = {
      style: 'solid',
      pattern: [],
      splitRatio: 0.5,
      mixedEnabled: false,
      dashFirst: true,
      tapeTickSpacing: 1,
    };
    this.dashSplitHandle = null;
    this.dashSplitDragState = null;
    this.dashSplitCursorState = {
      hovering: false,
      savedCursor: null,
    };
    this.activeCanvasPane = 'left';

    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark('app-init-start');
    }
    this.tagManager = null;
    this.arrowManager = null;
    this.measurementSystem = null;
    this.measurementDialog = null;
    this.measurementExporter = null;
    this.measurementOverlayManager = null;

    this.init();
  }

  registerCompareCanvasManager(canvasManager: CanvasManager | null): void {
    this.compareCanvasManager = canvasManager || null;
  }

  getToolbarColorPalettes(): Record<string, Array<{ name: string; hex: string }>> {
    return {
      classic: [
        { name: 'Blue', hex: '#3b82f6' },
        { name: 'Green', hex: '#22c55e' },
        { name: 'Red', hex: '#ef4444' },
        { name: 'Orange', hex: '#f59e0b' },
        { name: 'Purple', hex: '#a855f7' },
        { name: 'Dark Gray', hex: '#1f2937' },
        { name: 'White', hex: '#ffffff' },
        { name: 'Emerald', hex: '#10b981' },
      ],
      pastel: [
        { name: 'Pastel Blue', hex: '#93c5fd' },
        { name: 'Pastel Mint', hex: '#86efac' },
        { name: 'Pastel Rose', hex: '#fda4af' },
        { name: 'Pastel Peach', hex: '#fdba74' },
        { name: 'Pastel Lavender', hex: '#c4b5fd' },
        { name: 'Pastel Sky', hex: '#7dd3fc' },
        { name: 'Pastel Lemon', hex: '#fde68a' },
        { name: 'Pastel Pink', hex: '#f9a8d4' },
      ],
      fluro: [
        { name: 'Fluro Blue', hex: '#00a3ff' },
        { name: 'Fluro Green', hex: '#39ff14' },
        { name: 'Fluro Red', hex: '#ff1744' },
        { name: 'Fluro Orange', hex: '#ff9100' },
        { name: 'Fluro Purple', hex: '#bf00ff' },
        { name: 'Fluro Yellow', hex: '#faff00' },
        { name: 'Fluro Cyan', hex: '#00f5ff' },
        { name: 'Fluro Pink', hex: '#ff2bd6' },
      ],
    };
  }

  getSavedToolbarPaletteName(): string {
    const palettes = this.getToolbarColorPalettes();
    const saved = localStorage.getItem('openpaint.toolbarColorPalette') || 'classic';
    return palettes[saved] ? saved : 'classic';
  }

  getSavedToolbarColor(): string {
    return localStorage.getItem('openpaint.toolbarColor') || '#3b82f6';
  }

  setToolbarColor(color: string, options: { save?: boolean } = {}): void {
    const normalized = (color || '').trim();
    if (!normalized) return;
    const colorPicker = document.getElementById('colorPicker') as HTMLInputElement | null;
    if (colorPicker) {
      colorPicker.value = normalized;
    }

    this.toolManager?.updateSettings?.({ color: normalized });
    this.tagManager?.setStrokeColor?.(normalized);

    if (this.toolManager?.tools?.shape) {
      this.toolManager.tools.shape.setFillStyle('no-fill');
    }

    this.updateSelectedStrokes?.('color', normalized);
    this.updateSelectedTextAndShapes?.({ color: normalized });

    document.querySelectorAll<HTMLElement>('[data-color]').forEach(button => {
      const isActive =
        button.getAttribute('data-color')?.toLowerCase() === normalized.toLowerCase();
      button.classList.toggle('active', isActive);
      button.classList.toggle('transform', isActive);
      button.classList.toggle('scale-110', isActive);
    });

    const brushSize = document.getElementById('brushSize');
    if (brushSize) {
      brushSize.style.setProperty('--accent', normalized);
    }

    if (options.save !== false) {
      localStorage.setItem('openpaint.toolbarColor', normalized);
    }
  }

  renderToolbarColorPalettes(paletteName = this.getSavedToolbarPaletteName()): string {
    const palettes = this.getToolbarColorPalettes();
    const resolvedName = palettes[paletteName] ? paletteName : 'classic';
    const palette = palettes[resolvedName];
    const savedColor = this.getSavedToolbarColor();
    const activeColor = palette.some(item => item.hex.toLowerCase() === savedColor.toLowerCase())
      ? savedColor
      : palette[0]?.hex || '#3b82f6';
    const paletteNames = Object.keys(palettes);
    const nextPalette =
      paletteNames[(paletteNames.indexOf(resolvedName) + 1) % paletteNames.length];
    const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

    document.querySelectorAll<HTMLElement>('.color-swatches').forEach(container => {
      container.dataset.palette = resolvedName;
      container.innerHTML = palette
        .map(color => {
          const isWhite = color.hex.toLowerCase() === '#ffffff';
          const isFluro = resolvedName === 'fluro';
          const glow = isWhite
            ? '0 2px 4px rgba(0,0,0,0.28)'
            : `0 0 ${isFluro ? 12 : 10}px ${color.hex}${isFluro ? 'aa' : '99'}`;
          return `<button
            type="button"
            class="tbtn${color.hex.toLowerCase() === activeColor.toLowerCase() ? ' active transform scale-110' : ''}"
            data-color="${color.hex}"
            style="background-color:${color.hex};box-shadow:${glow};${isWhite ? 'border:1px solid #ccc;' : ''}"
            title="${color.name}"
            aria-label="${color.name}"
          ></button>`;
        })
        .join('');

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'tbtn color-palette-toggle';
      toggle.dataset.paletteToggle = 'true';
      toggle.textContent = titleCase(resolvedName);
      toggle.title = `Palette: ${titleCase(resolvedName)}. Click for ${titleCase(nextPalette)}.`;
      toggle.setAttribute('aria-label', `Color palette ${titleCase(resolvedName)}`);
      container.appendChild(toggle);
    });

    localStorage.setItem('openpaint.toolbarColorPalette', resolvedName);
    localStorage.setItem('openpaint.toolbarColor', activeColor);
    this.setToolbarColor(activeColor, { save: false });
    return resolvedName;
  }

  initializeToolbarColorPalette(): void {
    this.renderToolbarColorPalettes();
    this.setToolbarColor(this.getSavedToolbarColor(), { save: false });
  }

  async rebindActiveCanvasManager(
    canvasManager: CanvasManager,
    pane: 'left' | 'right' = 'left'
  ): Promise<void> {
    if (!canvasManager) return;
    const activeToolName = this.toolManager?.activeToolName;

    if (this.canvasManager !== canvasManager) {
      this.canvasManager = canvasManager;
      this.toolManager?.setCanvasManager?.(canvasManager);
      this.historyManager?.setCanvasManager?.(canvasManager);
      this.projectManager?.setCanvasManager?.(canvasManager, this.historyManager);
      if (this.arrowManager) {
        this.arrowManager.canvasManager = canvasManager;
        this.arrowManager.canvas = canvasManager.fabricCanvas;
      }
      if (this.measurementOverlayManager) {
        this.measurementOverlayManager.canvasManager = canvasManager;
        this.measurementOverlayManager.historyManager = this.historyManager;
      }
    }

    this.activeCanvasPane = pane;

    if (activeToolName) {
      await this.toolManager.selectTool(activeToolName);
    }
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

      this.initializeToolbarColorPalette();

      // Expose capture frame scale for cross-image frame sizing
      window.captureFrameDefaultScale = this.captureFrameScale;

      // Apply default capture frame scale
      this.resizeCaptureFrameProportionally(0);

      // Setup label rendering on object changes
      if (this.canvasManager.fabricCanvas) {
        this.canvasManager.fabricCanvas.on('object:added', (e: any) => {
          const obj = e.target;
          if (
            this.isDashDrawableObject(obj) &&
            !this.canvasManager.isLoadingFromJSON &&
            !obj.dashSettings
          ) {
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

      // Touch event support for mobile devices — only intercept canvas touches.
      // Let buttons, overlays, dialogs, and other UI handle their own events.
      const isCanvasTouch = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) return false;
        // Allow normal behaviour for interactive UI elements and overlays
        if (target.closest('button, a, input, select, textarea, dialog, [role="button"], label'))
          return false;
        if (target.closest('#welcomeOverlay, #shortcutHelpDialog, #helpOverlay')) return false;
        // Only intercept touches on the canvas area
        const canvas = document.querySelector('.canvas-container');
        return canvas ? canvas.contains(target) : false;
      };

      document.addEventListener(
        'touchstart',
        e => {
          if (!isCanvasTouch(e.target)) return;
          e.preventDefault();
          if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.canvasManager.handleTouchStart(touch);
          }
        },
        { passive: false }
      );

      document.addEventListener(
        'touchmove',
        e => {
          if (!isCanvasTouch(e.target)) return;
          e.preventDefault();
          if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.canvasManager.handleTouchMove(touch);
          }
        },
        { passive: false }
      );

      document.addEventListener(
        'touchend',
        e => {
          if (!isCanvasTouch(e.target)) return;
          if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.canvasManager.handleTouchEnd(touch);
          }
        },
        { passive: false }
      );

      // Pinch-to-zoom for mobile
      document.addEventListener('gesturestart', e => {
        if (e.touches.length === 2) {
          document.addEventListener('gesturechange', e => {
            if (e.touches.length === 2) {
              // Apply zoom centered on pinch point
              const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
              const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
              this.canvasManager.zoomToPoint({ x: centerX, y: centerY });
            }
          });
        }
      });

      // Setup UI bindings

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
        { MeasurementOverlayManager },
      ] = await Promise.all([
        import('./TagManager.js'),
        import('./MeasurementSystem.js'),
        import('./MeasurementDialog.js'),
        import('./MeasurementExporter.js'),
        import('./utils/ArrowManager.js'),
        import('./DebugHelpers.js'),
        import('./measurement-mos/index'),
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
      if (this.measurementSystem.setInchDisplayMode) {
        this.measurementSystem.setInchDisplayMode(this.currentInchDisplayMode || 'decimal');
      }

      if (!this.measurementDialog) {
        this.measurementDialog = new MeasurementDialog(this.measurementSystem);
      }

      if (!this.measurementExporter) {
        this.measurementExporter = new MeasurementExporter(
          this.measurementSystem,
          this.projectManager
        );
      }

      if (!this.measurementOverlayManager) {
        this.measurementOverlayManager = new MeasurementOverlayManager(
          this.canvasManager,
          this.historyManager
        );
        this.measurementOverlayManager.initUI(this.projectManager);
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
      tape: [],
      stretchy: [],
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
          startX = this.x1;
          endX = this.x2;
        } else if (typeof this.calcLinePoints === 'function') {
          const pts = this.calcLinePoints();
          startX = pts?.x1 ?? startX;
          endX = pts?.x2 ?? endX;
        }
      } else if (this.type === 'path' && Array.isArray(this.path) && this.path.length > 1) {
        const first = this.path[0];
        const last = this.path[this.path.length - 1];
        if (first?.[0] === 'M' && typeof first[1] === 'number') {
          startX = first[1];
        }
        if (last?.[0] === 'L' && typeof last[1] === 'number') {
          endX = last[1];
        } else if (last?.[0] === 'C' && typeof last[5] === 'number') {
          endX = last[5];
        } else if (last?.[0] === 'Q' && typeof last[3] === 'number') {
          endX = last[3];
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
      tapeTickSpacing,
    }: {
      style: string;
      pattern: number[];
      splitRatio: number;
      mixedEnabled: boolean;
      dashFirst: boolean;
      tapeTickSpacing?: number;
    }
  ): void {
    if (!this.isDashDrawableObject(obj)) return;
    if (obj.isPrivacyErase || obj.customData?.isPrivacyErase) return;
    if (window.app?.toolManager?.activeToolName === 'privacy') return;

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

    const customLineStyle =
      (style === 'tape' || style === 'stretchy') && (obj.type === 'line' || obj.type === 'path')
        ? style
        : 'solid';
    const isCustomLineStyle = customLineStyle !== 'solid';
    const nextPattern = isCustomLineStyle ? null : pattern?.length ? pattern : null;
    obj.set('strokeDashArray', nextPattern);
    obj.dashSettings = {
      style,
      splitRatio,
      mixedEnabled,
      dashFirst,
      tapeTickSpacing: tapeTickSpacing ?? 1,
      pattern: pattern || [],
    };
    obj.lineStyle = customLineStyle;

    if (obj.type === 'line' || obj.type === 'path') {
      obj.arrowSettings = obj.arrowSettings || {
        ...(window.app?.arrowManager?.defaultSettings || {}),
      };
      obj.arrowSettings.lineStyle = customLineStyle;
      obj.arrowSettings.tapeTickSpacing = tapeTickSpacing ?? 1;
      if (obj.type === 'path') {
        obj.arrowSettings.curveArrows = true;
      }
      if (window.app?.arrowManager?.attachArrowRendering) {
        window.app.arrowManager.attachArrowRendering(obj);
        window.app.arrowManager.syncArrowMetadata?.(obj);
      }
    }

    if (mixedEnabled && !isCustomLineStyle) {
      this.attachMixedDashRenderer(obj);
    }

    obj.dirty = true;
  }

  applyDashSettingsToTools(pattern: number[], style = 'solid'): void {
    const activeTool = this.toolManager.activeTool as any;
    if (activeTool?.setLineStyle) {
      activeTool.setLineStyle(style);
    }
    if (activeTool?.setTapeTickSpacing) {
      activeTool.setTapeTickSpacing(this.currentDashSettings.tapeTickSpacing ?? 1);
    }
    if (activeTool?.setDashPattern) {
      activeTool.setDashPattern(pattern);
    }

    const dashCapable = ['line', 'curve', 'arrow', 'shape'];
    dashCapable.forEach((name: string) => {
      const tool = this.toolManager.tools[name];
      if (tool?.setLineStyle) {
        tool.setLineStyle(style);
      }
      if (tool?.setTapeTickSpacing) {
        tool.setTapeTickSpacing(this.currentDashSettings.tapeTickSpacing ?? 1);
      }
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
        return target.customPoints.map((p: any) => ({ x: p.x, y: p.y }));
      }
      const sampled = PathUtils.samplePathPoints(target, 80);
      if (sampled.length >= 2) {
        return sampled.map(p => ({ x: p.x, y: p.y }));
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
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
    ];
  }

  getPolylinePointAtRatio(
    points: Array<{ x: number; y: number }>,
    ratio: number
  ): { x: number; y: number } | null {
    if (!Array.isArray(points) || points.length < 2) return null;
    const r = Math.max(0, Math.min(1, ratio));
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
    const dx = pointer.x - (handle.left || 0);
    const dy = pointer.y - (handle.top || 0);
    const radius = (handle.radius || 7) + 6;
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

  setupToolbarMenus(): void {
    const menuWrappers = Array.from(document.querySelectorAll<HTMLElement>('.toolbar-menu'));
    const closeMenus = (except?: HTMLElement) => {
      menuWrappers.forEach(wrapper => {
        if (wrapper === except) return;
        wrapper.classList.remove('open');
        const toggle = wrapper.querySelector<HTMLElement>('[aria-expanded]');
        toggle?.setAttribute('aria-expanded', 'false');
      });
    };

    menuWrappers.forEach(wrapper => {
      if (wrapper.dataset.menuBound === 'true') return;
      wrapper.dataset.menuBound = 'true';
      const toggle = wrapper.querySelector<HTMLButtonElement>('.toolbar-menu-toggle');
      toggle?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const willOpen = !wrapper.classList.contains('open');
        closeMenus(wrapper);
        wrapper.classList.toggle('open', willOpen);
        toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      });
      wrapper.addEventListener('click', event => {
        event.stopPropagation();
      });
    });

    if (!document.body.dataset.toolbarMenuCloseBound) {
      document.body.dataset.toolbarMenuCloseBound = 'true';
      document.addEventListener('click', () => closeMenus());
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMenus();
      });
    }

    const frameToggleBtn = document.getElementById('frameToggleBtn') as HTMLButtonElement | null;
    if (frameToggleBtn && frameToggleBtn.dataset.bound !== 'true') {
      frameToggleBtn.dataset.bound = 'true';
      const syncFrameToggle = () => {
        const active = document.body.classList.contains('frames-visible');
        frameToggleBtn.classList.toggle('active', active);
        frameToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        frameToggleBtn.textContent = active ? 'Hide Frames' : 'Frames';
        frameToggleBtn.title = active ? 'Hide frame controls' : 'Show frame controls';
      };
      frameToggleBtn.addEventListener('click', event => {
        event.preventDefault();
        document.body.classList.toggle('frames-visible');
        syncFrameToggle();
      });
      syncFrameToggle();
    }
  }

  setupUI(): void {
    this.setupToolbarMenus();

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
        currentTool === this.toolManager.tools.select ||
        currentTool === this.toolManager.tools.text ||
        currentTool === this.toolManager.tools.shape;

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
        const shapeIcon = toggle.querySelector('.shape-icon');
        const clickedOnIcon = shapeIcon && e.target === shapeIcon;

        // If clicking the dropdown icon, toggle the menu
        if (clickedOnIcon) {
          if (wrapper) wrapper.classList.toggle('shape-open');
        } else {
          // Clicking the button itself: select line tool and close menu
          leaveEraserBrushSize();
          this.toolManager.selectTool('line');
          updateDrawingToggleLabels('Straight Line');
          if (wrapper) wrapper.classList.remove('shape-open');

          // Mark the straight line option as active in the dropdown
          drawingModeOptions.forEach(item => {
            const mode = item.getAttribute('data-drawing-mode');
            item.classList.toggle('active', mode === 'line');
          });
        }
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
          leaveEraserBrushSize();
          const fontSize = getCurrentTextSize();
          const tool = await this.toolManager.ensureTool('text');
          if (tool?.setFontSize) {
            tool.setFontSize(fontSize);
          }
          this.toolManager.updateSettings({ fontSize });
          this.updateSelectedTextAndShapes({ fontSize });
          this.toolManager.previousToolName = this.toolManager.activeToolName || 'line';
          this.toolManager.selectTool('text');
          updateDrawingToggleLabels('Text');
          syncTextCursor();
          updateTextToggleState();
          if (wrapper) {
            wrapper.classList.remove('shape-open');
            wrapper.closest('#drawingModeWrapper')?.classList.remove('shape-open');
          }
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
        leaveEraserBrushSize();
        // Store previous tool name for returning after drawing
        const currentToolName = this.toolManager.activeToolName || 'line';
        this.toolManager.previousToolName = currentToolName;
        this.toolManager.selectTool('shape');
        updateDrawingToggleLabels('Shapes');
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
        const siblingFlyouts = wrapper.parentElement?.querySelectorAll<HTMLElement>(
          ':scope > .tool-flyout.shape-open'
        );
        siblingFlyouts?.forEach(sibling => {
          if (sibling !== wrapper) {
            sibling.classList.remove('shape-open');
          }
        });
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

      // Touch support: tap the toggle button to open/close menu on mobile
      const toggleBtn = wrapper.querySelector<HTMLElement>('.tbtn');
      if (toggleBtn) {
        toggleBtn.addEventListener('touchend', (e: TouchEvent) => {
          if (e.target !== toggleBtn && !toggleBtn.contains(e.target as Node)) return;
          if (wrapper.classList.contains('shape-open')) {
            wrapper.classList.remove('shape-open');
          } else {
            showMenu();
          }
        });
      }
    };

    shapeModeWrappers.forEach(wrapper => bindShapeMenu(wrapper, () => true));
    textStyleWrappers.forEach(wrapper => bindShapeMenu(wrapper));
    drawingModeWrappers.forEach(wrapper => bindShapeMenu(wrapper));
    textModeWrappers.forEach(wrapper => bindShapeMenu(wrapper, () => true));
    document
      .querySelectorAll('#eraserModeWrapper')
      .forEach(wrapper => bindShapeMenu(wrapper as HTMLElement, () => true));

    // ── Scrollable toolbar menu escape ──
    // When the toolbar has overflow-x:auto, absolutely-positioned flyout menus
    // get clipped. We detect open menus inside scrollable toolbars and switch
    // them to position:fixed so they escape the clip. On scroll, we close all
    // menus (simpler and more reliable than tracking positions during scroll).

    const isToolbarScrollable = (tw: Element): boolean => {
      const style = getComputedStyle(tw);
      return style.overflowX === 'auto' || style.overflowX === 'scroll';
    };

    const FIXED_MENU_ATTR = 'data-menu-escaped';

    const repositionOpenMenus = () => {
      document.querySelectorAll('.toolbar-wrap').forEach(tw => {
        if (!isToolbarScrollable(tw)) return;

        // Handle shape-toggle flyout menus
        tw.querySelectorAll<HTMLElement>('.shape-toggle.shape-open').forEach(wrapper => {
          const menu = wrapper.querySelector<HTMLElement>(':scope > .shape-menu');
          if (!menu) return;
          const trigger = wrapper.querySelector<HTMLElement>(':scope > button, :scope > .tbtn');
          if (!trigger) return;
          const rect = trigger.getBoundingClientRect();
          menu.setAttribute(FIXED_MENU_ATTR, 'true');
          menu.style.position = 'fixed';
          menu.style.top = `${rect.bottom + 6}px`;
          menu.style.left = `${rect.left}px`;
          menu.style.zIndex = '10500';
        });

        // Handle toolbar-menu panels (Project menu, etc.)
        tw.querySelectorAll<HTMLElement>('.toolbar-menu.open').forEach(wrapper => {
          const panel = wrapper.querySelector<HTMLElement>(':scope > .toolbar-menu-panel');
          if (!panel) return;
          const trigger = wrapper.querySelector<HTMLElement>(':scope > button');
          if (!trigger) return;
          const rect = trigger.getBoundingClientRect();
          panel.setAttribute(FIXED_MENU_ATTR, 'true');
          panel.style.position = 'fixed';
          panel.style.top = `${rect.bottom + 6}px`;
          panel.style.right = '';
          panel.style.left = `${rect.left}px`;
          panel.style.zIndex = '10500';
        });
      });
    };

    const releaseEscapedMenus = () => {
      document.querySelectorAll<HTMLElement>(`[${FIXED_MENU_ATTR}]`).forEach(menu => {
        menu.removeAttribute(FIXED_MENU_ATTR);
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.style.zIndex = '';
      });
    };

    const closeAllOpenMenus = () => {
      // Close shape-toggle flyouts
      document.querySelectorAll('.shape-toggle.shape-open').forEach(el => {
        el.classList.remove('shape-open');
      });
      // Close toolbar-menu panels
      document.querySelectorAll('.toolbar-menu.open').forEach(el => {
        el.classList.remove('open');
        const toggle = el.querySelector('[aria-expanded]');
        toggle?.setAttribute('aria-expanded', 'false');
      });
      // Clean up any escaped (fixed-position) menus
      releaseEscapedMenus();
    };

    // Reposition menus when they open/close (class changes)
    new MutationObserver(() => {
      const hasOpen = document.querySelector('.shape-toggle.shape-open, .toolbar-menu.open');
      if (hasOpen) {
        repositionOpenMenus();
      } else {
        releaseEscapedMenus();
      }
    }).observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['class'],
    });

    // Close menus on toolbar scroll
    document.querySelectorAll('.toolbar-wrap').forEach(tw => {
      tw.addEventListener(
        'scroll',
        () => {
          closeAllOpenMenus();
        },
        { passive: true }
      );
    });

    // Reposition on resize (menus might need to shift)
    window.addEventListener(
      'resize',
      () => {
        repositionOpenMenus();
      },
      { passive: true }
    );

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
      leaveEraserBrushSize();
      const shapeTool = await this.toolManager.ensureTool('shape');
      if (!shapeTool?.setShapeType) return;
      this.toolManager.previousToolName = this.toolManager.activeToolName || 'line';
      shapeTool.setShapeType(shape);
      this.toolManager.selectTool('shape');
      updateShapeIcon(shape);
      updateDrawingToggleLabels(shapeLabels[shape] ?? 'Shapes');
      updateShapeAvailability();
    };

    shapeOptions.forEach(btn => {
      btn.addEventListener('click', () => {
        void selectShapeOption(btn);
      });
    });

    // Eraser brush size: save/restore normal size when entering/leaving eraser
    const ERASER_DEFAULT_SIZE = 30;
    let preEraserBrushSize = 0; // 0 = not in eraser mode

    const enterEraserBrushSize = () => {
      const bs = document.getElementById('brushSize') as HTMLInputElement | null;
      if (!bs) return;
      preEraserBrushSize = parseInt(bs.value, 10) || 2;
      bs.value = String(ERASER_DEFAULT_SIZE);
      bs.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const leaveEraserBrushSize = () => {
      if (!preEraserBrushSize) return;
      const bs = document.getElementById('brushSize') as HTMLInputElement | null;
      if (!bs) return;
      bs.value = String(preEraserBrushSize);
      bs.dispatchEvent(new Event('input', { bubbles: true }));
      preEraserBrushSize = 0;
    };

    drawingModeOptions.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-drawing-mode');
        if (!mode) return;
        const wasEraser = preEraserBrushSize > 0;
        if (mode === 'curve') {
          if (wasEraser) leaveEraserBrushSize();
          this.toolManager.selectTool('curve');
          updateDrawingToggleLabels('Curved Line');
        } else if (mode === 'select') {
          if (wasEraser) leaveEraserBrushSize();
          this.toolManager.selectTool('select');
          updateDrawingToggleLabels('Select');
        } else {
          if (wasEraser) leaveEraserBrushSize();
          this.toolManager.selectTool('line');
          updateDrawingToggleLabels('Straight Line');
        }
        drawingModeOptions.forEach(item => item.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    const updateEraserToggleState = () => {
      const isEraser = this.toolManager.activeTool === this.toolManager.tools.privacy;
      document.querySelectorAll('#eraserModeWrapper').forEach(wrapper => {
        wrapper.classList.toggle('shape-active', isEraser);
      });
      document.querySelectorAll('#eraserModeToggle').forEach(toggle => {
        toggle.setAttribute('aria-pressed', String(isEraser));
      });
    };

    // Eraser toggle selects eraser tool
    document.querySelectorAll('#eraserModeToggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const wasEraser = preEraserBrushSize > 0;
        if (!wasEraser) enterEraserBrushSize();
        const currentToolName = this.toolManager.activeToolName || 'line';
        this.toolManager.previousToolName = currentToolName;
        this.toolManager.selectTool('privacy');
        updateDrawingToggleLabels('Eraser Tool');
        drawingModeOptions.forEach(item => item.classList.remove('active'));
      });
    });

    // Eraser mode selection (White / Match Color)
    const activeEraserBtn = document.querySelector<HTMLElement>('[data-eraser-mode].active');
    (window as any).eraserMode = activeEraserBtn?.getAttribute('data-eraser-mode') || 'white';
    document.querySelectorAll('[data-eraser-mode]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const mode = btn.getAttribute('data-eraser-mode');
        if (!mode) return;
        (window as any).eraserMode = mode;
        document.querySelectorAll('[data-eraser-mode]').forEach(b => b.classList.remove('active'));
        document
          .querySelectorAll(`[data-eraser-mode="${mode}"]`)
          .forEach(b => b.classList.add('active'));

        // Immediately activate the eraser tool
        const wasEraser = preEraserBrushSize > 0;
        if (!wasEraser) enterEraserBrushSize();
        const currentToolName = this.toolManager.activeToolName || 'line';
        this.toolManager.previousToolName = currentToolName;
        this.toolManager.selectTool('privacy');
        updateDrawingToggleLabels('Eraser Tool');
        drawingModeOptions.forEach(item => item.classList.remove('active'));
        updateEraserToggleState();

        // Close the flyout
        document.querySelectorAll('#eraserModeWrapper').forEach(wrapper => {
          wrapper.classList.remove('shape-active');
        });
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
            updateDrawingToggleLabels('Text');
            syncTextCursor();
            updateTextToggleState();
            const parentDropdown = btn.closest('.shape-toggle');
            if (parentDropdown instanceof HTMLElement) {
              preferredTextWrapper = parentDropdown;
            }
            setActiveTextFontOption(font);
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
        updateDrawingToggleLabels('Eraser Tool');
      } else if (currentTool === this.toolManager.tools.select) {
        updateDrawingToggleLabels('Select');
      }
      syncTextCursor();
      updateTextToggleState();
      updateEraserToggleState();
    });

    updateTextToggleState();
    updateDrawingModeState();
    updateEraserToggleState();

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
    const colorSwatchGroups = document.querySelectorAll<HTMLElement>('.color-swatches');
    const textBgToggles = document.querySelectorAll<HTMLInputElement>('[data-text-bg-toggle]');

    if (window.textBgEnabled === undefined) {
      window.textBgEnabled = true;
    }

    if (colorPicker) {
      const handleColorPickerChange = (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        if (!target) return;
        this.setToolbarColor(target.value);
      };
      colorPicker.addEventListener('input', handleColorPickerChange);
      colorPicker.addEventListener('change', handleColorPickerChange);
    }

    textBgToggles.forEach(toggle => {
      toggle.checked = window.textBgEnabled === true;
    });

    colorSwatchGroups.forEach(group => {
      if (group.dataset.paletteBound === 'true') return;
      group.dataset.paletteBound = 'true';
      group.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        const paletteToggle = target?.closest<HTMLElement>('[data-palette-toggle]');
        if (paletteToggle) {
          const palettes = this.getToolbarColorPalettes();
          const names = Object.keys(palettes);
          const current = this.getSavedToolbarPaletteName();
          const next = names[(names.indexOf(current) + 1) % names.length] || 'classic';
          this.renderToolbarColorPalettes(next);
          return;
        }

        const colorButton = target?.closest<HTMLElement>('[data-color]');
        const color = colorButton?.getAttribute('data-color');
        if (!color) return;
        this.setToolbarColor(color);
      });
    });

    // Line width/thickness control
    const brushSizeSelect = document.getElementById('brushSize') as HTMLInputElement | null;
    const arrowStartBtn = document.getElementById('arrowStartBtn') as HTMLButtonElement | null;
    const arrowEndBtn = document.getElementById('arrowEndBtn') as HTMLButtonElement | null;
    const dottedBtn = document.getElementById('dottedBtn') as HTMLButtonElement | null;
    let lineStyleScope: 'selection' | 'image' | 'project' = 'selection';
    const parseBrushWidth = (value: string): number => {
      const parsed = parseInt((value || '').replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(parsed)) return 1;
      return Math.max(1, Math.min(300, parsed));
    };
    const formatBrushWidth = (value: number): string => String(value);
    const normalizeTapeTickSpacing = (value: string | number | null | undefined): number => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 1;
      return Math.max(0.55, Math.min(2.25, numeric));
    };
    const formatTapeTickSpacing = (value: number): string => `${Math.round(value * 100)}%`;
    const resizableTools = new Set(['line', 'curve', 'arrow', 'pencil', 'shape', 'privacy']);
    const getBaseLabel = (label: string | null | undefined): string =>
      typeof label === 'string' ? label.split('::tab:')[0] || label : '';
    const currentViewId = () => (window.app?.projectManager?.currentViewId as string) || '';
    const currentBaseViewId = () => getBaseLabel(currentViewId());
    const getScopeImageIds = (scope: 'selection' | 'image' | 'project'): string[] => {
      const all = Object.keys(window.vectorStrokesByImage || {});
      if (scope === 'project') return all;
      if (scope === 'image') {
        const base = currentBaseViewId();
        return all.filter(id => getBaseLabel(id) === base);
      }
      return [];
    };
    const objectIsInScope = (
      obj: { strokeMetadata?: { imageLabel?: string }; imageLabel?: string },
      scope: 'selection' | 'image' | 'project'
    ): boolean => {
      if (scope === 'project') return true;
      const objectLabel = obj?.strokeMetadata?.imageLabel || obj?.imageLabel || '';
      return getBaseLabel(objectLabel) === currentBaseViewId();
    };
    const applyBrushWidthToScope = (width: number): void => {
      if (lineStyleScope === 'selection') {
        this.updateSelectedStrokes('strokeWidth', width);
        this.updateSelectedTextAndShapes({ strokeWidth: width });
        return;
      }

      const canvas = this.canvasManager.fabricCanvas;
      if (canvas?.forEachObject) {
        canvas.forEachObject((obj: any) => {
          if (!obj || obj.isTag || obj.isConnectorLine) return;
          if (!objectIsInScope(obj, lineStyleScope)) return;
          if (obj.type === 'line' || obj.type === 'path') {
            obj.set('strokeWidth', width);
            obj.dirty = true;
          }
        });
        canvas.requestRenderAll();
      }

      const scopedImageIds = getScopeImageIds(lineStyleScope);
      scopedImageIds.forEach(imageId => {
        const strokes = window.vectorStrokesByImage?.[imageId] || {};
        Object.values(strokes).forEach((stroke: any) => {
          if (stroke && typeof stroke === 'object') {
            stroke.width = width;
          }
        });
      });

      window.redrawCanvasWithVisibility?.();
    };
    const applyDashStyleToScope = (): void => {
      if (lineStyleScope === 'selection') {
        this.applyDashSettingsToSelection();
        return;
      }

      const canvas = this.canvasManager.fabricCanvas;
      if (canvas?.forEachObject) {
        canvas.forEachObject((obj: any) => {
          if (!obj || obj.isTag || obj.isConnectorLine) return;
          if (!objectIsInScope(obj, lineStyleScope)) return;
          this.applyDashSettingsToObject(obj, this.currentDashSettings);
        });
        canvas.requestRenderAll();
      }

      const scopedImageIds = getScopeImageIds(lineStyleScope);
      scopedImageIds.forEach(imageId => {
        const strokes = window.vectorStrokesByImage?.[imageId] || {};
        Object.values(strokes).forEach((stroke: any) => {
          if (!stroke || typeof stroke !== 'object') return;
          const width = Number(stroke.width || brushSizeSelect?.value || 2) || 2;
          stroke.dashSettings = {
            ...this.currentDashSettings,
            pattern: this.getDashPatternForStyle(this.currentDashSettings.style).map(segment =>
              Math.max(1, Math.round(segment * Math.max(1, width / 2)))
            ),
          };
          if (stroke.type === 'line' || stroke.type === 'arrow' || stroke.type === 'path') {
            stroke.lineStyle =
              this.currentDashSettings.style === 'tape' ||
              this.currentDashSettings.style === 'stretchy'
                ? this.currentDashSettings.style
                : 'solid';
            stroke.arrowSettings = stroke.arrowSettings || {};
            stroke.arrowSettings.lineStyle = stroke.lineStyle;
            stroke.arrowSettings.tapeTickSpacing = this.currentDashSettings.tapeTickSpacing ?? 1;
            if (stroke.strokeMetadata) {
              stroke.strokeMetadata.arrowSettings = stroke.arrowSettings;
            }
          }
        });
      });

      window.redrawCanvasWithVisibility?.();
    };
    const applyTapeSpacingToTools = (spacing: number): void => {
      const activeTool = this.toolManager.activeTool as any;
      if (activeTool?.setTapeTickSpacing) {
        activeTool.setTapeTickSpacing(spacing);
      }

      ['line', 'curve', 'arrow'].forEach((name: string) => {
        const tool = this.toolManager.tools[name];
        if (tool?.setTapeTickSpacing) {
          tool.setTapeTickSpacing(spacing);
        }
      });
    };
    const applyTapeSpacingToObject = (obj: any, spacing: number): void => {
      if (!obj || (obj.type !== 'line' && obj.type !== 'path')) return;
      obj.arrowSettings = obj.arrowSettings || {
        ...(window.app?.arrowManager?.defaultSettings || {}),
      };
      obj.arrowSettings.tapeTickSpacing = spacing;
      if (obj.type === 'path') {
        obj.arrowSettings.curveArrows = true;
      }
      if (obj.strokeMetadata) {
        obj.strokeMetadata.arrowSettings = obj.arrowSettings;
      }
      obj.dirty = true;
    };
    const applyTapeSpacingToScope = (spacing: number): void => {
      if (lineStyleScope === 'selection') {
        const canvas = this.canvasManager.fabricCanvas;
        const activeObjects = canvas?.getActiveObjects?.() || [];
        activeObjects.forEach((obj: any) => applyTapeSpacingToObject(obj, spacing));
        canvas?.requestRenderAll?.();
        return;
      }

      const canvas = this.canvasManager.fabricCanvas;
      if (canvas?.forEachObject) {
        canvas.forEachObject((obj: any) => {
          if (!obj || obj.isTag || obj.isConnectorLine) return;
          if (!objectIsInScope(obj, lineStyleScope)) return;
          applyTapeSpacingToObject(obj, spacing);
        });
        canvas.requestRenderAll();
      }

      const scopedImageIds = getScopeImageIds(lineStyleScope);
      scopedImageIds.forEach(imageId => {
        const strokes = window.vectorStrokesByImage?.[imageId] || {};
        Object.values(strokes).forEach((stroke: any) => {
          if (!stroke || typeof stroke !== 'object') return;
          if (stroke.type !== 'line' && stroke.type !== 'arrow' && stroke.type !== 'path') return;
          stroke.arrowSettings = stroke.arrowSettings || {};
          stroke.arrowSettings.tapeTickSpacing = spacing;
          if (stroke.strokeMetadata) {
            stroke.strokeMetadata.arrowSettings = stroke.arrowSettings;
          }
        });
      });

      window.redrawCanvasWithVisibility?.();
    };

    const handleBrushSizeWheelShortcut = (wheelEvent: WheelEvent): boolean => {
      if (!wheelEvent.ctrlKey && !wheelEvent.metaKey && !wheelEvent.altKey) return false;

      const activeTool = this.toolManager?.activeToolName;
      if (!activeTool || !resizableTools.has(activeTool)) {
        return false;
      }

      const eventTarget = wheelEvent.target;
      const targetElement = eventTarget instanceof Element ? eventTarget : null;
      const insideEditable = !!targetElement?.closest(
        'input:not(#brushSize), textarea, select, [contenteditable="true"]'
      );
      if (insideEditable) {
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
        applyBrushWidthToScope(width);
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
          if (handleBrushSizeWheelShortcut(e as WheelEvent)) {
            e.preventDefault();
          }
        },
        { passive: false }
      );

      window.addEventListener(
        'wheel',
        e => {
          const wheelEvent = e as WheelEvent;
          if (!handleBrushSizeWheelShortcut(wheelEvent)) {
            return;
          }
          wheelEvent.preventDefault();
        },
        { passive: false, capture: true }
      );

      // Initialize to canonical displayed format
      commitBrushSizeValue(brushSizeSelect);
    }

    // Dash style controls (solid/dotted/partial split)
    const dashStyleSelect = document.getElementById('dashStyleSelect') as HTMLSelectElement | null;
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

    const dashedCycle = [
      'solid',
      'stretchy',
      'dotted',
      'small',
      'medium',
      'large',
      'dot-dash',
      'mixed',
      'tape',
    ];
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
        tape: '<svg width="38" height="16" viewBox="0 0 38 16" aria-hidden="true"><defs><linearGradient id="tapeIconGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".55" stop-color="#facc15"/><stop offset="1" stop-color="#b45309"/></linearGradient></defs><rect x="2" y="3" width="34" height="10" rx="1.5" fill="url(#tapeIconGradient)" stroke="#713f12" stroke-width="1"/><path d="M6 3v10M10 3v6M14 3v10M18 3v6M22 3v10M26 3v6M30 3v10" stroke="#111827" stroke-width="1"/><path d="M14 4.5h5" stroke="#b91c1c" stroke-width="1.2"/></svg>',
        stretchy:
          '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><path d="M4 5 C11.3 5.3 22.7 3 30 2.7 L30 9.3 C22.7 9 11.3 6.7 4 7 Q3.4 6 4 5Z" fill="currentColor"/></svg>',
      };
      dottedBtn.innerHTML = iconMap[style] || iconMap.solid;
    };

    const applyDashStyle = (style: string) => {
      const normalizedStyle = style || 'solid';
      const mixedEnabled = normalizedStyle === 'mixed';
      const pattern = this.getDashPatternForStyle(normalizedStyle);
      const splitRatio = Math.max(0, Math.min(1, Number(dashSplitInput?.value || 50) / 100));
      const dashFirst = this.currentDashSettings.dashFirst;
      const tapeTickSpacing = normalizeTapeTickSpacing(this.currentDashSettings.tapeTickSpacing);

      this.currentDashSettings = {
        style: normalizedStyle,
        pattern,
        splitRatio,
        mixedEnabled,
        dashFirst,
        tapeTickSpacing,
      };

      this.applyDashSettingsToTools(pattern, normalizedStyle);
      applyDashStyleToScope();

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
      const canvas = this.canvasManager.fabricCanvas;
      const activeObjects = canvas?.getActiveObjects?.() || [];
      window.app?.arrowManager?.updateButtonState?.(
        activeObjects.length ? activeObjects : canvas?.getActiveObject?.() || null
      );
      this.updateDashSplitHandleForSelection();
      // Notify line style preview to re-render
      window.dispatchEvent(new CustomEvent('dash-style-changed'));
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

    const setupLineStylePopover = () => {
      if (!brushSizeSelect || !dottedBtn || !arrowStartBtn || !arrowEndBtn) {
        return;
      }
      const tbLeft = document.getElementById('tbLeft');
      if (!tbLeft) return;

      if (!document.getElementById('lineStylePopoverStyles')) {
        const style = document.createElement('style');
        style.id = 'lineStylePopoverStyles';
        style.textContent = `
          #lineStylePopoverWrap { position: relative; display: inline-flex; align-items: center; gap: 6px; }
          #lineStylePopoverBtn { min-width: 126px; gap: 7px; justify-content: center; }
          .line-style-toggle-icon { display: inline-flex; width: 38px; height: 18px; align-items: center; justify-content: center; color: currentColor; }
          .line-style-toggle-label { font-weight: 700; white-space: nowrap; }
          .line-style-toggle-chip { min-width: 22px; padding: 1px 6px; border-radius: 999px; background: #eef2ff; color: #1d4ed8; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
          #lineStylePopoverPanel { position: fixed; width: 520px; max-width: calc(100vw - 24px); background: rgba(255,255,255,0.97); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(0,0,0,0.08); border-radius: 14px; box-shadow: 0 24px 48px rgba(2,6,23,0.18), 0 2px 8px rgba(2,6,23,0.08); padding: 14px; z-index: 10150; transform-origin: top left; transform: translateY(-4px) scale(0.98); opacity: 0; pointer-events: none; transition: opacity 120ms ease-out, transform 150ms cubic-bezier(0.2,0,0,1); }
          #lineStylePopoverPanel.open { transform: translateY(0) scale(1); opacity: 1; pointer-events: auto; }
          .line-style-panel-grid { display: grid; gap: 10px; }
          .line-style-row { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 10px; }
          .line-style-title { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: #64748b; text-transform: uppercase; }
          .line-style-control { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
          .line-style-width-input { width: 62px !important; height: 30px !important; border-radius: 999px !important; text-align: center; font-weight: 700; color: #111827; background: #f8fafc; border: 1px solid #dbe3ef; }
          .line-style-arrow-buttons { display: inline-flex; align-items: center; gap: 6px; padding: 3px; border: 1px solid #e2e8f0; border-radius: 999px; background: #f8fafc; }
          .line-style-arrow-buttons .tbtn { width: 32px; height: 28px; min-width: 32px; padding: 0; border-radius: 999px; }
          #lineStyleQuickArrowButtons { box-shadow: 0 1px 2px rgba(15,23,42,0.06); }
          .line-style-lock-note { font-size: 11px; color: #64748b; white-space: nowrap; }
          .line-style-range { width: 92px; accent-color: #2563eb; }
          .line-style-inline-slider { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:#475569; }
          .line-style-size-chip { font-size: 11px; font-weight: 600; color: #334155; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; padding: 2px 8px; min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
          .line-style-scope button { border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; border-radius: 999px; padding: 4px 12px; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 100ms ease; }
          .line-style-scope button:hover { background: #f1f5f9; border-color: #cbd5e1; }
          .line-style-scope button.active { background: #1e40af; color: #fff; border-color: #1e40af; box-shadow: 0 1px 3px rgba(30,64,175,0.3); }
          #lineStylePreviewWrap { width: 100%; height: 58px; background: linear-gradient(180deg,#ffffff,#f8fafc); border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
          #lineStylePreviewCanvas { width: 100%; height: 58px; display: block; }
        `;
        document.head.appendChild(style);
      }

      let wrap = document.getElementById('lineStylePopoverWrap');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'lineStylePopoverWrap';

        const toggle = document.createElement('button');
        toggle.id = 'lineStylePopoverBtn';
        toggle.className = 'tbtn';
        toggle.type = 'button';
        toggle.innerHTML = `
          <span class="line-style-toggle-icon" aria-hidden="true"></span>
          <span class="line-style-toggle-label">Line</span>
          <span class="line-style-toggle-chip">2</span>
        `;
        toggle.setAttribute('aria-haspopup', 'dialog');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('title', 'Line width, arrows, and line style');

        const panel = document.createElement('div');
        panel.id = 'lineStylePopoverPanel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Line style controls');
        panel.innerHTML = `
          <div class="line-style-panel-grid">
            <div class="line-style-row"><span class="line-style-title">Stroke</span><div id="lineStyleStrokeRow" class="line-style-control"></div></div>
            <div class="line-style-row"><span class="line-style-title">Arrow</span><div id="lineStyleArrowStyleRow" class="line-style-control"></div></div>
            <div class="line-style-row"><span class="line-style-title">Pattern</span><div id="lineStylePatternRow" class="line-style-control"></div></div>
            <div class="line-style-row line-style-scope"><span class="line-style-title">Scope</span><div class="line-style-control"><button type="button" data-scope="selection" class="active">Selection</button><button type="button" data-scope="image">Image</button><button type="button" data-scope="project">Project</button></div></div>
            <div id="lineStylePreviewWrap" aria-hidden="true"><canvas id="lineStylePreviewCanvas" width="300" height="58"></canvas></div>
          </div>
        `;

        wrap.appendChild(toggle);
        document.body.appendChild(panel);
        tbLeft.appendChild(wrap);

        toggle.addEventListener('click', e => {
          e.preventDefault();
          const open = !panel.classList.contains('open');
          if (open) {
            const rect = toggle.getBoundingClientRect();
            const panelWidth = 520;
            const gap = 8;
            const margin = 8;
            let left = rect.left;
            if (left + panelWidth + margin > window.innerWidth) {
              left = window.innerWidth - panelWidth - margin;
            }
            if (left < margin) left = margin;
            let top = rect.bottom + gap;
            const panelHeight = panel.offsetHeight || 500;
            if (top + panelHeight + margin > window.innerHeight) {
              top = rect.top - panelHeight - gap;
            }
            if (top < margin) top = margin;
            panel.style.top = `${top}px`;
            panel.style.left = `${left}px`;
          }
          panel.classList.toggle('open', open);
          toggle.setAttribute('aria-expanded', String(open));
        });

        document.addEventListener('click', e => {
          if (!wrap || wrap.contains(e.target as Node) || panel.contains(e.target as Node)) return;
          panel.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        });
      }

      const panel = document.getElementById('lineStylePopoverPanel');
      if (!panel) return;
      const strokeRow = document.getElementById('lineStyleStrokeRow');
      const arrowStyleRow = document.getElementById('lineStyleArrowStyleRow');
      const patternRow = document.getElementById('lineStylePatternRow');
      if (!strokeRow || !arrowStyleRow || !patternRow) return;

      if (!wrap.querySelector('#lineStyleQuickArrowButtons')) {
        const quickArrowButtons = document.createElement('div');
        quickArrowButtons.id = 'lineStyleQuickArrowButtons';
        quickArrowButtons.className = 'line-style-arrow-buttons';
        quickArrowButtons.setAttribute('aria-label', 'Toggle line arrowheads');
        quickArrowButtons.setAttribute(
          'title',
          'Toggle start and end arrowheads. Double-click for arrow options.'
        );
        wrap.appendChild(quickArrowButtons);
      }
      const quickArrowButtons = document.getElementById('lineStyleQuickArrowButtons');
      if (quickArrowButtons) {
        quickArrowButtons.appendChild(arrowStartBtn);
        quickArrowButtons.appendChild(arrowEndBtn);
      }

      const arrowOptionsBtn = document.getElementById(
        'arrowOptionsBtn'
      ) as HTMLButtonElement | null;
      const arrowOptionsMenu = document.getElementById('arrowOptionsMenu') as HTMLDivElement | null;
      if (arrowOptionsBtn) {
        arrowOptionsBtn.classList.add('hidden');
        arrowOptionsBtn.setAttribute('aria-hidden', 'true');
      }
      if (arrowOptionsMenu) {
        arrowOptionsMenu.classList.add('hidden');
        arrowOptionsMenu.style.display = 'none';
        arrowOptionsMenu.setAttribute('aria-hidden', 'true');
      }

      if (!strokeRow.querySelector('#lineStyleStrokeLabel')) {
        const strokeLabel = document.createElement('span');
        strokeLabel.id = 'lineStyleStrokeLabel';
        strokeLabel.className = 'line-style-lock-note';
        strokeLabel.textContent = 'Line width';
        strokeRow.appendChild(strokeLabel);
      }
      if (brushSizeSelect && brushSizeSelect.parentElement !== strokeRow) {
        brushSizeSelect.classList.add('line-style-width-input');
        brushSizeSelect.setAttribute('title', 'Line width in pixels');
        brushSizeSelect.setAttribute('aria-label', 'Line width');
        strokeRow.appendChild(brushSizeSelect);
      }
      patternRow.appendChild(dottedBtn);

      if (!patternRow.querySelector('#lineStyleTapeSpacing')) {
        const spacingControl = document.createElement('label');
        spacingControl.id = 'lineStyleTapeSpacingWrap';
        spacingControl.className = 'line-style-inline-slider';
        spacingControl.innerHTML = `
          Notches
          <input id="lineStyleTapeSpacing" type="range" min="0.55" max="2.25" step="0.05" value="1" style="width:96px" aria-label="Tape notch spacing" />
          <span id="lineStyleTapeSpacingValue" class="line-style-size-chip">100%</span>
        `;
        patternRow.appendChild(spacingControl);
      }

      const arrowStyleTop = document.getElementById('arrowStyleTop') as HTMLSelectElement | null;
      const arrowSizeTop = document.getElementById('arrowSizeTop') as HTMLInputElement | null;

      if (!arrowStyleRow.querySelector('#lineStyleArrowStyle')) {
        const controls = document.createElement('div');
        controls.className = 'line-style-control';
        controls.innerHTML = `
          <select id="lineStyleArrowStyle" class="tselect" style="height:30px;min-width:100px"><option value="triangular">Triangle</option><option value="open">Open</option><option value="hand-2">Hand</option><option value="dimension">Dimension</option></select>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#475569">Scale <input id="lineStyleArrowScale" class="line-style-range" type="range" min="2" max="8" step="0.25" value="5" /></label>
          <span id="lineStyleArrowSizeValue" class="line-style-size-chip">10 px</span>
          <span id="lineStyleArrowLockNote" class="line-style-lock-note" style="display:none">arrow = width × 5</span>
        `;
        arrowStyleRow.appendChild(controls);
      }

      const lineStyleArrowStyle = document.getElementById(
        'lineStyleArrowStyle'
      ) as HTMLSelectElement | null;
      const lineStyleArrowScale = document.getElementById(
        'lineStyleArrowScale'
      ) as HTMLInputElement | null;
      const lineStyleArrowSizeValue = document.getElementById('lineStyleArrowSizeValue');
      const lineStyleArrowLockNote = document.getElementById('lineStyleArrowLockNote');
      const lineStyleTapeSpacing = document.getElementById(
        'lineStyleTapeSpacing'
      ) as HTMLInputElement | null;
      const lineStyleTapeSpacingWrap = document.getElementById('lineStyleTapeSpacingWrap');
      const lineStyleTapeSpacingValue = document.getElementById('lineStyleTapeSpacingValue');
      let previewArrowState = {
        startArrow: true,
        endArrow: true,
      };

      const clampArrowSize = (value: number): number =>
        Math.max(5, Math.min(50, Math.round(value)));
      const clampArrowScale = (value: string | number | null | undefined): number => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 5;
        return Math.max(2, Math.min(8, numeric));
      };
      const getLockedArrowSize = (): number => {
        const width = brushSizeSelect ? parseBrushWidth(brushSizeSelect.value) : 2;
        const scale = clampArrowScale(lineStyleArrowScale?.value);
        return clampArrowSize(width * scale);
      };
      const updateArrowSizeReadout = (size = getLockedArrowSize()) => {
        const width = brushSizeSelect ? parseBrushWidth(brushSizeSelect.value) : 2;
        const scale = clampArrowScale(lineStyleArrowScale?.value);
        if (lineStyleArrowSizeValue) {
          lineStyleArrowSizeValue.textContent = `${size} px`;
        }
        if (lineStyleArrowLockNote) {
          lineStyleArrowLockNote.textContent = `arrow = width × ${scale.toFixed(scale % 1 ? 2 : 0)}`;
        }
        const toggleChip = document.querySelector<HTMLElement>(
          '#lineStylePopoverBtn .line-style-toggle-chip'
        );
        if (toggleChip) {
          toggleChip.textContent = String(width);
        }
      };
      const updateArrowSizeProxy = ({ dispatch = true } = {}) => {
        const size = getLockedArrowSize();
        if (arrowSizeTop) {
          arrowSizeTop.value = String(size);
          if (dispatch) {
            arrowSizeTop.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        updateArrowSizeReadout(size);
        return size;
      };
      const updateLineStyleToggleSummary = () => {
        const button = document.getElementById('lineStylePopoverBtn');
        const icon = button?.querySelector<HTMLElement>('.line-style-toggle-icon');
        if (!button || !icon) return;
        const uiArrowSettings = window.paintApp?.uiState?.arrowSettings;
        const startArrow =
          typeof uiArrowSettings?.startArrow === 'boolean'
            ? uiArrowSettings.startArrow
            : previewArrowState.startArrow;
        const endArrow =
          typeof uiArrowSettings?.endArrow === 'boolean'
            ? uiArrowSettings.endArrow
            : previewArrowState.endArrow;
        const style = this.currentDashSettings.style || 'solid';
        const dashMap: Record<string, string> = {
          solid: '',
          dotted: '2 5',
          small: '5 5',
          medium: '8 5',
          large: '12 7',
          'dot-dash': '5 5 1 5',
          mixed: '2 5',
          tape: '',
          stretchy: '',
        };
        const dash = dashMap[style] ? `stroke-dasharray="${dashMap[style]}"` : '';
        const strokeColor =
          style === 'tape' ? '#b45309' : style === 'stretchy' ? '#db2777' : 'currentColor';
        icon.innerHTML =
          style === 'stretchy'
            ? `
          <svg width="38" height="18" viewBox="0 0 38 18" aria-hidden="true">
            ${(() => {
              const sx = startArrow ? 10 : 5;
              const ex = endArrow ? 28 : 33;
              const len = ex - sx;
              const narrowH = 1.0;
              const wideH = 3.3;
              const startH = startArrow ? wideH : narrowH;
              const endH = endArrow ? wideH : narrowH;
              const isAsym = startH !== endH;
              const cy = 9;
              let d;
              if (isAsym) {
                d = `M${sx} ${cy - startH} C${sx + len * 0.28} ${cy - startH * 0.7} ${sx + len * 0.72} ${cy - endH * 0.9} ${ex} ${cy - endH} L${ex} ${cy + endH} C${sx + len * 0.72} ${cy + endH * 0.9} ${sx + len * 0.28} ${cy + startH * 0.7} ${sx} ${cy + startH} Q${sx - narrowH * 0.6} ${cy} ${sx} ${cy - startH}Z`;
              } else {
                const waistH = 1.8;
                d = `M${sx} ${cy - wideH * 0.7} C${sx + len * 0.25} ${cy - wideH * 1.1} ${sx + len * 0.4} ${cy - waistH * 1.15} ${sx + len * 0.5} ${cy - waistH} C${sx + len * 0.6} ${cy - waistH * 1.15} ${sx + len * 0.75} ${cy - wideH * 1.1} ${ex} ${cy - wideH * 0.7} L${ex} ${cy + wideH * 0.7} C${sx + len * 0.75} ${cy + wideH * 1.1} ${sx + len * 0.6} ${cy + waistH * 1.15} ${sx + len * 0.5} ${cy + waistH} C${sx + len * 0.4} ${cy + waistH * 1.15} ${sx + len * 0.25} ${cy + wideH * 1.1} ${sx} ${cy + wideH * 0.7}Z`;
              }
              return `<path d="${d}" fill="currentColor"/>`;
            })()}
            ${startArrow ? '<polygon points="5,9 11,5.5 11,12.5" fill="currentColor"/>' : ''}
            ${endArrow ? '<polygon points="33,9 27,5.5 27,12.5" fill="currentColor"/>' : ''}
          </svg>
        `
            : `
          <svg width="38" height="18" viewBox="0 0 38 18" aria-hidden="true">
            <line x1="7" y1="9" x2="31" y2="9" stroke="${strokeColor}" stroke-width="2.4" stroke-linecap="round" ${dash}></line>
            ${
              startArrow
                ? '<path d="M9 5 L4 9 L9 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'
                : ''
            }
            ${
              endArrow
                ? '<path d="M29 5 L34 9 L29 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'
                : ''
            }
          </svg>
        `;
        button.setAttribute(
          'title',
          `Line width ${brushSizeSelect ? parseBrushWidth(brushSizeSelect.value) : 2}px, arrow ${getLockedArrowSize()}px`
        );
      };

      const syncArrowProxyFromSource = () => {
        if (lineStyleArrowStyle && arrowStyleTop) lineStyleArrowStyle.value = arrowStyleTop.value;
        if (lineStyleArrowScale && arrowSizeTop && brushSizeSelect) {
          const width = parseBrushWidth(brushSizeSelect.value);
          const sourceSize = clampArrowSize(Number(arrowSizeTop.value || 10));
          lineStyleArrowScale.value = String(clampArrowScale(sourceSize / Math.max(1, width)));
        }
        updateArrowSizeReadout();
        updateLineStyleToggleSummary();
      };

      const bindArrowProxy = () => {
        if (lineStyleArrowStyle && arrowStyleTop) {
          lineStyleArrowStyle.onchange = () => {
            arrowStyleTop.value = lineStyleArrowStyle.value;
            arrowStyleTop.dispatchEvent(new Event('change', { bubbles: true }));
          };
        }
        if (lineStyleArrowScale && arrowSizeTop) {
          lineStyleArrowScale.oninput = () => {
            updateArrowSizeProxy();
            syncPreview();
          };
        }
      };
      bindArrowProxy();
      syncArrowProxyFromSource();

      const syncTapeSpacingControl = () => {
        const isTapeStyle = this.currentDashSettings.style === 'tape';
        if (lineStyleTapeSpacingWrap) {
          lineStyleTapeSpacingWrap.style.display = isTapeStyle ? 'inline-flex' : 'none';
          lineStyleTapeSpacingWrap.setAttribute('aria-hidden', String(!isTapeStyle));
        }
        const spacing = normalizeTapeTickSpacing(this.currentDashSettings.tapeTickSpacing);
        if (lineStyleTapeSpacing) {
          lineStyleTapeSpacing.value = String(spacing);
        }
        if (lineStyleTapeSpacingValue) {
          lineStyleTapeSpacingValue.textContent = formatTapeTickSpacing(spacing);
        }
      };

      const dashSplitWrap = document.getElementById('dashSplitWrap');
      if (dashSplitWrap && !patternRow.contains(dashSplitWrap)) {
        patternRow.appendChild(dashSplitWrap);
      }

      const previewCanvasElement = document.getElementById(
        'lineStylePreviewCanvas'
      ) as HTMLCanvasElement | null;
      let previewCanvas: any = null;
      let previewLine: any = null;
      const ensurePreviewCanvas = () => {
        if (!previewCanvasElement || previewCanvas) return;
        const fabricLib = (globalThis as any).fabric;
        if (!fabricLib?.StaticCanvas || !fabricLib?.Line) return;
        previewCanvas = new fabricLib.StaticCanvas(previewCanvasElement, {
          selection: false,
          renderOnAddRemove: false,
        });
        previewLine = new fabricLib.Line([30, 29, 270, 29], {
          stroke: '#1f2937',
          strokeWidth: 2,
          strokeLineCap: 'round',
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        previewCanvas.add(previewLine);
      };
      const syncPreview = () => {
        if (!brushSizeSelect) return;
        syncTapeSpacingControl();
        ensurePreviewCanvas();
        if (!previewCanvas || !previewLine) return;
        const colorInput = document.getElementById('colorPicker') as HTMLInputElement | null;
        const strokeColor = colorInput?.value || '#1f2937';
        const uiArrowSettings = window.paintApp?.uiState?.arrowSettings;
        const startArrow =
          typeof uiArrowSettings?.startArrow === 'boolean'
            ? uiArrowSettings.startArrow
            : previewArrowState.startArrow;
        const endArrow =
          typeof uiArrowSettings?.endArrow === 'boolean'
            ? uiArrowSettings.endArrow
            : previewArrowState.endArrow;
        const width = Math.max(1, parseBrushWidth(brushSizeSelect.value));
        const arrowStyle = lineStyleArrowStyle?.value || arrowStyleTop?.value || 'triangular';
        const arrowSize = updateArrowSizeProxy({ dispatch: false });
        const style = this.currentDashSettings.style || 'solid';
        const pattern = this.getDashPatternForStyle(style);
        const tapeTickSpacing = normalizeTapeTickSpacing(this.currentDashSettings.tapeTickSpacing);
        updateLineStyleToggleSummary();

        previewLine.set({
          x1: 30,
          y1: 29,
          x2: 270,
          y2: 29,
          stroke: strokeColor,
          strokeWidth: Math.min(14, width),
          opacity: 0.96,
          strokeDashArray: pattern.length ? pattern : null,
          lineStyle: style === 'tape' || style === 'stretchy' ? style : 'solid',
          arrowSettings: {
            ...(previewLine.arrowSettings || {}),
            startArrow,
            endArrow,
            arrowStyle,
            arrowSize,
            lineStyle: style === 'tape' || style === 'stretchy' ? style : 'solid',
            tapeTickSpacing,
          },
        });

        if (window.app?.arrowManager?.attachArrowRendering) {
          window.app.arrowManager.attachArrowRendering(previewLine);
        }
        previewLine.dirty = true;
        previewCanvas.requestRenderAll();
      };

      const handleArrowSettingsUpdated = (event: Event) => {
        const customEvent = event as CustomEvent<{
          startArrow?: boolean;
          endArrow?: boolean;
          arrowStyle?: string;
          arrowSize?: number;
        }>;
        const detail = customEvent.detail || {};
        if (typeof detail.startArrow === 'boolean')
          previewArrowState.startArrow = detail.startArrow;
        if (typeof detail.endArrow === 'boolean') previewArrowState.endArrow = detail.endArrow;
        if (lineStyleArrowStyle && typeof detail.arrowStyle === 'string') {
          lineStyleArrowStyle.value = detail.arrowStyle;
        }
        if (lineStyleArrowScale && typeof detail.arrowSize === 'number' && brushSizeSelect) {
          const width = parseBrushWidth(brushSizeSelect.value);
          lineStyleArrowScale.value = String(
            clampArrowScale(detail.arrowSize / Math.max(1, width))
          );
          if (lineStyleArrowSizeValue) {
            lineStyleArrowSizeValue.textContent = `${clampArrowSize(detail.arrowSize)} px`;
          }
        }
        syncPreview();
      };

      panel.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach(btn => {
        btn.addEventListener('click', () => {
          lineStyleScope = btn.dataset.scope as 'selection' | 'image' | 'project';
          panel
            .querySelectorAll<HTMLButtonElement>('[data-scope]')
            .forEach(node => node.classList.toggle('active', node === btn));
        });
      });

      brushSizeSelect.addEventListener('input', () => {
        updateArrowSizeProxy();
        syncPreview();
      });
      dottedBtn.addEventListener('click', () => setTimeout(syncPreview, 0));
      arrowStartBtn.addEventListener('click', () => setTimeout(syncPreview, 0));
      arrowEndBtn.addEventListener('click', () => setTimeout(syncPreview, 0));
      lineStyleTapeSpacing?.addEventListener('input', () => {
        const spacing = normalizeTapeTickSpacing(lineStyleTapeSpacing.value);
        this.currentDashSettings = {
          ...this.currentDashSettings,
          tapeTickSpacing: spacing,
        };
        if (lineStyleTapeSpacingValue) {
          lineStyleTapeSpacingValue.textContent = formatTapeTickSpacing(spacing);
        }
        applyTapeSpacingToTools(spacing);
        applyTapeSpacingToScope(spacing);
        syncPreview();
      });
      lineStyleArrowStyle?.addEventListener('change', syncPreview);
      lineStyleArrowScale?.addEventListener('input', syncPreview);
      arrowStyleTop?.addEventListener('change', syncPreview);
      arrowSizeTop?.addEventListener('input', syncPreview);
      window.addEventListener(
        'arrow-settings-updated',
        handleArrowSettingsUpdated as EventListener
      );
      window.addEventListener('dash-style-changed', syncPreview);
      syncTapeSpacingControl();
      (document.getElementById('colorPicker') as HTMLInputElement | null)?.addEventListener(
        'change',
        syncPreview
      );
      syncPreview();
    };

    setupLineStylePopover();

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
      // Apply default fit mode on load
      this.applyImageFitMode(fitModeSelect.value);
    }

    // Setup keyboard shortcuts and help system
    this.setupKeyboardControls();
    this.setupKeyboardShortcuts();

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

            // If multiview is active, delegate to the comparison capture
            if (document.body.classList.contains('multiview-active')) {
              copyCanvasBtn.style.transform = 'scale(0.98)';
              setTimeout(() => {
                copyCanvasBtn.style.transform = '';
              }, 100);
              try {
                await (window as any).imageGallery?.captureCompareGrid?.();
                const copyIcon = copyCanvasBtn.querySelector('#copyIcon') as HTMLElement | null;
                const checkIcon = copyCanvasBtn.querySelector('#checkIcon') as HTMLElement | null;
                if (copyIcon && checkIcon) {
                  copyIcon.classList.add('opacity-0', 'scale-50');
                  copyIcon.classList.remove('opacity-90', 'scale-100');
                  checkIcon.classList.remove('opacity-0', 'scale-50');
                  checkIcon.classList.add('opacity-100', 'scale-100');
                  setTimeout(() => {
                    checkIcon.classList.add('opacity-0', 'scale-50');
                    checkIcon.classList.remove('opacity-100', 'scale-100');
                    copyIcon.classList.remove('opacity-0', 'scale-50');
                    copyIcon.classList.add('opacity-90', 'scale-100');
                  }, 1500);
                }
              } catch (error) {
                console.error('[Copy] Multiview capture failed:', error);
              }
              return;
            }

            let copyOutputCanvas: HTMLCanvasElement | null = null;
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
              copyOutputCanvas = tempCanvas;
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

              // Convert to blob and copy to clipboard. Safari is strict about user activation:
              // pass the blob promise directly into ClipboardItem before awaiting it.
              const blobPromise = new Promise<Blob>((resolve, reject) => {
                tempCanvas.toBlob((b: Blob | null) => {
                  if (b) resolve(b);
                  else reject(new Error('Failed to create blob'));
                }, 'image/png');
              });

              const ClipboardItemConstructor = (
                window as Window & { ClipboardItem?: typeof ClipboardItem }
              ).ClipboardItem;
              if (navigator.clipboard && ClipboardItemConstructor) {
                await navigator.clipboard.write([
                  new ClipboardItemConstructor({
                    'image/png': blobPromise as unknown as Blob,
                  }),
                ]);
                const blob = await blobPromise;
                console.log('[Copy] Blob created, size:', blob.size);
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
                throw new Error('Clipboard image writes are not supported in this browser');
              }
            } catch (error) {
              console.error('[Copy] Failed to copy to clipboard:', error);
              if (copyOutputCanvas) {
                const fallbackBlob = await new Promise<Blob | null>(resolve => {
                  copyOutputCanvas?.toBlob((b: Blob | null) => resolve(b), 'image/png');
                });
                if (fallbackBlob) {
                  this.showCopyImageFallback(fallbackBlob);
                }
              }
              if (this.projectManager?.showStatusMessage) {
                this.projectManager.showStatusMessage(
                  'Clipboard blocked. Opened image preview instead.',
                  'info'
                );
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

      // Update button appearance when multiview is toggled
      const updateCopyBtnForMultiview = () => {
        const active = document.body.classList.contains('multiview-active');
        const labelLong = copyCanvasBtn.querySelector('.label-long');
        const labelShort = copyCanvasBtn.querySelector('.label-short');
        if (active) {
          copyCanvasBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700', 'active:bg-blue-800');
          copyCanvasBtn.classList.add(
            'bg-emerald-600',
            'hover:bg-emerald-700',
            'active:bg-emerald-800'
          );
          if (labelLong) labelLong.textContent = 'Copy Images';
          if (labelShort) labelShort.textContent = 'Copy All';
          copyCanvasBtn.title = 'Copy all comparison images to clipboard';
        } else {
          copyCanvasBtn.classList.add('bg-blue-600', 'hover:bg-blue-700', 'active:bg-blue-800');
          copyCanvasBtn.classList.remove(
            'bg-emerald-600',
            'hover:bg-emerald-700',
            'active:bg-emerald-800'
          );
          if (labelLong) labelLong.textContent = 'Copy Image';
          if (labelShort) labelShort.textContent = 'Copy';
          copyCanvasBtn.title = 'Copy image to clipboard';
        }
      };
      updateCopyBtnForMultiview();
      const observer = new MutationObserver(updateCopyBtnForMultiview);
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } else {
      console.warn('[main.js] Copy canvas button not found');
    }
  }

  private showCopyImageFallback(blob: Blob): void {
    document.getElementById('copyImageFallbackModal')?.remove();

    const url = URL.createObjectURL(blob);
    const overlay = document.createElement('div');
    overlay.id = 'copyImageFallbackModal';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 20000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(15, 23, 42, 0.62);
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      width: min(760px, 92vw);
      max-height: 88vh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 12px;
      padding: 16px;
      border-radius: 8px;
      background: #ffffff;
      color: #0f172a;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.34);
    `;

    const title = document.createElement('div');
    title.textContent = 'Clipboard was blocked';
    title.style.cssText = 'font-size:16px;font-weight:700;';

    const preview = document.createElement('img');
    preview.src = url;
    preview.alt = 'Copied canvas preview';
    preview.style.cssText =
      'max-width:100%;max-height:62vh;object-fit:contain;border:1px solid #e2e8f0;background:#f8fafc;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;align-items:center;';

    const download = document.createElement('a');
    download.href = url;
    download.download = `openpaint-copy-${Date.now()}.png`;
    download.textContent = 'Download PNG';
    download.style.cssText =
      'padding:8px 12px;border-radius:6px;background:#2563eb;color:#fff;text-decoration:none;font-size:13px;font-weight:700;';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.style.cssText =
      'padding:8px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:13px;font-weight:700;cursor:pointer;';

    const cleanup = () => {
      overlay.remove();
      URL.revokeObjectURL(url);
      document.removeEventListener('keydown', onKeyDown);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cleanup();
    };

    close.addEventListener('click', cleanup);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) cleanup();
    });
    document.addEventListener('keydown', onKeyDown);

    actions.append(download, close);
    panel.append(title, preview, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  setupUnitToggle(): void {
    const unitToggle = document.getElementById('unitToggleBtn');
    const unitToggleSecondary = document.getElementById('unitToggleBtnSecondary');
    const unitToggles = [unitToggle, unitToggleSecondary].filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    );
    const unitSelector = document.getElementById('unitSelector') as HTMLSelectElement | null;
    const inchDisplayToggleWrap = document.getElementById('inchDisplayToggleWrap');
    const inchDisplayToggle = document.getElementById(
      'inchDisplayToggleBtn'
    ) as HTMLButtonElement | null;
    const inchDisplayToggleSecondary = document.getElementById(
      'inchDisplayToggleBtnSecondary'
    ) as HTMLButtonElement | null;
    const inchDisplayToggles = [inchDisplayToggle, inchDisplayToggleSecondary].filter(
      (el): el is HTMLButtonElement => el instanceof HTMLButtonElement
    );
    const syncInchInputs = (): void => {
      const syncInput = (inchInputId: string, cmInputId?: string): void => {
        const inchInput = document.getElementById(inchInputId) as HTMLInputElement | null;
        const cmInput = cmInputId
          ? ((document.getElementById(cmInputId) as HTMLInputElement | null) ?? null)
          : null;

        if (!inchInput) return;

        const parsedFromInches = this.measurementSystem?.parseMeasurementInput?.(
          inchInput.value,
          'inches'
        );
        if (parsedFromInches) {
          inchInput.value = this.measurementSystem.formatInchInputValue(
            parsedFromInches.inchWhole,
            parsedFromInches.inchFraction
          );
          return;
        }

        const cm = parseFloat(cmInput?.value || '');
        if (!Number.isFinite(cm) || cm < 0 || !this.measurementSystem?.convertFromCm) return;

        const result = this.measurementSystem.convertFromCm(cm);
        inchInput.value = this.measurementSystem.formatInchInputValue(
          result.inchWhole,
          result.inchFraction,
          { inchValue: cm / 2.54, decimalPlaces: 1 }
        );
      };

      syncInput('inchValue', 'cmValue');
      syncInput('dialogInchValue', 'dialogCmValue');
    };

    const applyInchDisplayMode = (mode: 'decimal' | 'fraction'): void => {
      this.currentInchDisplayMode = mode;

      inchDisplayToggles.forEach(toggle => {
        const isSecondary = toggle === inchDisplayToggleSecondary;
        toggle.textContent =
          mode === 'decimal'
            ? isSecondary
              ? 'dec'
              : 'decimals'
            : isSecondary
              ? 'frac'
              : 'fractions';
        toggle.setAttribute(
          'aria-label',
          `Switch inches display to ${mode === 'decimal' ? 'fractions' : 'decimals'}`
        );
        toggle.setAttribute('title', `Display inches as ${mode}`);
        toggle.setAttribute('aria-pressed', String(mode === 'fraction'));
      });

      if (this.measurementSystem?.setInchDisplayMode) {
        this.measurementSystem.setInchDisplayMode(mode);
      }

      syncInchInputs();
      window.dispatchEvent(
        new CustomEvent('openpaint:inch-display-mode-change', {
          detail: { mode },
        })
      );

      if (this.metadataManager) {
        this.metadataManager.refreshAllMeasurements();
      }
    };

    const applyUnit = (unit: 'inch' | 'cm'): void => {
      this.currentUnit = unit;

      if (unitSelector) {
        unitSelector.value = unit;
      }

      const unitLabel = unit === 'inch' ? 'inches' : 'cm';
      unitToggles.forEach(toggle => {
        toggle.textContent = unitLabel;
      });

      if (this.measurementSystem) {
        this.measurementSystem.setUnit(unitLabel);
        if (this.measurementSystem.setInchDisplayMode) {
          this.measurementSystem.setInchDisplayMode(this.currentInchDisplayMode);
        }
      }

      if (inchDisplayToggleWrap) {
        inchDisplayToggleWrap.classList.toggle('hidden', unit !== 'inch');
      }
      if (inchDisplayToggleSecondary) {
        inchDisplayToggleSecondary.classList.toggle('hidden', unit !== 'inch');
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
    applyInchDisplayMode('decimal');

    unitToggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        applyUnit(this.currentUnit === 'inch' ? 'cm' : 'inch');
      });
    });

    // Also listen for direct changes to unit selector
    if (unitSelector) {
      unitSelector.addEventListener('change', () => {
        applyUnit(unitSelector.value as 'inch' | 'cm');
      });
    }

    inchDisplayToggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        applyInchDisplayMode(this.currentInchDisplayMode === 'decimal' ? 'fraction' : 'decimal');
      });
    });

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
    // Tab key cycles through drawing modes:
    // Straight Line -> Curved Line -> Eraser Tool -> Select -> Straight Line
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
          // Curved Line -> Eraser Tool
          enterEraserBrushSize();
          this.toolManager.selectTool('privacy');
          if (drawingModeToggle) {
            this.updateToggleLabel(drawingModeToggle, 'Eraser Tool');
          }
        } else if (currentToolName === 'privacy') {
          // Eraser Tool -> Select
          leaveEraserBrushSize();
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
      } else if (text === 'Eraser Tool') {
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

    if (!currentView) {
      return;
    }

    const autoFitModes = ['scale-page-size', 'fill-frame'];
    const normalizedFitMode = autoFitModes.includes(fitMode) ? fitMode : 'keep-size';
    currentView.fitMode = normalizedFitMode;
    const backgroundImage = this.canvasManager.fabricCanvas?.backgroundImage;
    if (backgroundImage) {
      backgroundImage.openpaintFitMode = normalizedFitMode;
      backgroundImage.customData = {
        ...(backgroundImage.customData || {}),
        openpaintFitMode: normalizedFitMode,
      };
    }
    const fitModeSelect = document.getElementById('fitModeSelect') as HTMLSelectElement | null;
    if (fitModeSelect && fitModeSelect.value !== normalizedFitMode) {
      fitModeSelect.value = normalizedFitMode;
    }

    if (autoFitModes.includes(normalizedFitMode) && backgroundImage) {
      this.canvasManager.refitBackgroundImageToPlacementFrame?.();

      const backgroundWorldRect = this.canvasManager.getBackgroundWorldRect?.();
      const placementFrame = this.canvasManager.getBackgroundPlacementFrame?.();
      if (
        backgroundWorldRect &&
        placementFrame &&
        this.canvasManager.fitViewportToBackgroundPlacementFrame?.(
          backgroundWorldRect,
          placementFrame,
          this.canvasManager.getViewportState?.()
        )
      ) {
        this.canvasManager.applyViewportTransform?.();
      }
    }

    this.canvasManager.fabricCanvas?.requestRenderAll?.();
    console.log(`[ImageFit] Applied fit mode: ${normalizedFitMode}`);
  }

  setupKeyboardControls(): void {
    // Create +/- buttons for resizing capture frame
    this.captureFrameScale = 0.9;

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
        scaleChange = 0.05; // Increase by 5%
      } else if (e.key === '-') {
        scaleChange = -0.05; // Decrease by 5%
      }

      if (scaleChange !== 0) {
        e.preventDefault();
        this.resizeCaptureFrameProportionally(scaleChange);
        return;
      }

      // Tool shortcuts: D=draw (line), T=text, S=shapes, M=select
      // Skip tool shortcuts when modifier keys are held (e.g. Ctrl+V for paste)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case 'd':
        case 'D':
          e.preventDefault();
          this.toolManager.selectTool('line');
          return;
        case 't':
        case 'T':
          e.preventDefault();
          this.toolManager.selectTool('text');
          return;
        case 's':
        case 'S':
          e.preventDefault();
          this.toolManager.selectTool('shape');
          return;
        case 'm':
        case 'M':
          e.preventDefault();
          this.toolManager.selectTool('select');
          return;
        case 'h':
        case 'H': {
          // Open the unified shortcut help dialog (same as ?)
          e.preventDefault();
          const dialog = document.getElementById('shortcutHelpDialog') as HTMLDialogElement | null;
          if (dialog) {
            if (dialog.open) dialog.close();
            else dialog.showModal();
          }
          return;
        }
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
    const helpHint = document.createElement('div');
    helpHint.id = 'helpHint';
    helpHint.innerHTML = 'Press <kbd>H</kbd> for help';
    helpHint.style.cssText = `
            position: fixed;
            top: calc(var(--toolbar-height, 48px) + 8px);
            right: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            z-index: 1000;
            pointer-events: none;
            transition: opacity 0.6s ease;
        `;

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

    setTimeout(() => {
      helpHint.style.opacity = '0';
      setTimeout(() => helpHint.remove(), 600);
    }, 5000);
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

function initWelcomeOverlay(): void {
  const overlay = document.getElementById('welcomeOverlay');
  if (!overlay) return;

  if (!localStorage.getItem('openpaint:welcomed')) {
    overlay.style.display = 'block';
  }

  const dismiss = () => {
    overlay.style.display = 'none';
    localStorage.setItem('openpaint:welcomed', '1');
  };

  document.getElementById('welcomeDismiss')?.addEventListener('click', dismiss);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) dismiss();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display === 'block') dismiss();
  });
}

function initShortcutHelp(): void {
  const dialog = document.getElementById('shortcutHelpDialog') as HTMLDialogElement | null;
  if (!dialog) return;

  const toggle = () => {
    if (dialog.open) {
      dialog.close();
    } else {
      dialog.showModal();
    }
  };

  document.getElementById('shortcutHelpBtn')?.addEventListener('click', toggle);
  document.getElementById('shortcutHelpClose')?.addEventListener('click', () => dialog.close());

  document.addEventListener('keydown', e => {
    const target = e.target as HTMLElement;
    const isTyping =
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.tagName === 'SELECT' ||
      target?.isContentEditable;
    if (isTyping) return;

    if (e.key === '?') {
      e.preventDefault();
      toggle();
    }
  });

  // Close on backdrop click
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.close();
  });
}

// Start the app when DOM is ready, or immediately if it already fired.
if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      startApp();
      initWelcomeOverlay();
      initShortcutHelp();
    },
    { once: true }
  );
} else {
  startApp();
  initWelcomeOverlay();
  initShortcutHelp();
}
