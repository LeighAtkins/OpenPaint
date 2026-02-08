// Main Entry Point
import { CanvasManager } from './CanvasManager.ts';
import { ToolManager } from './tools/ToolManager.js';
import { ProjectManager } from './ProjectManager.js';
import { HistoryManager } from './HistoryManager.js';
import { StrokeMetadataManager } from './StrokeMetadataManager.js';
import { UploadManager } from './UploadManager.js';
import { imageRegistry } from './ImageRegistry.js';

class App {
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

  init() {
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
      const colorPicker = document.getElementById('colorPicker');
      if (colorPicker) {
        colorPicker.value = '#3b82f6';
      }

      // Setup label rendering on object changes
      if (this.canvasManager.fabricCanvas) {
        this.canvasManager.fabricCanvas.on('object:added', e => {
          const obj = e.target;
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
        this.canvasManager.fabricCanvas.on('object:removed', e => {
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

  scheduleDeferredInit() {
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

  setupDeferredToolPreload() {
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

  markFirstPaint() {
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

  logPerfMeasure(name) {
    if (typeof performance === 'undefined' || !performance.getEntriesByName) {
      return;
    }
    const entry = performance.getEntriesByName(name).slice(-1)[0];
    if (!entry) {
      return;
    }
    console.log(`[Perf] ${name}: ${entry.duration.toFixed(1)}ms`);
  }

  async initDeferredManagers() {
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
  updateSelectedStrokes(property, value) {
    if (!this.canvasManager.fabricCanvas) return;

    const activeObjects = this.canvasManager.fabricCanvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    let updatedCount = 0;
    activeObjects.forEach(obj => {
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

  updateSelectedTextAndShapes({ color, strokeWidth, fontSize }) {
    if (!this.canvasManager.fabricCanvas) return;

    const activeObjects = this.canvasManager.fabricCanvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    let updatedCount = 0;
    const shapeTool = this.toolManager?.tools?.shape;
    const textBgEnabled = window.textBgEnabled === true;

    activeObjects.forEach(obj => {
      if (!obj) return;

      if (obj.type === 'i-text' || obj.type === 'text') {
        if (color) {
          obj.set('fill', color);
          obj.set('stroke', '#000000');
        }
        if (fontSize) {
          obj.set('fontSize', fontSize);
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

  updateSelectedShapesFill(style) {
    if (!this.canvasManager.fabricCanvas) return;

    const activeObjects = this.canvasManager.fabricCanvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    let updatedCount = 0;
    const shapeTool = this.toolManager?.tools?.shape;

    activeObjects.forEach(obj => {
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

  setupUI() {
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
    const rotateFineSlider = document.getElementById('rotateFineSlider');
    const rotateFineValue = document.getElementById('rotateFineValue');
    let lastFineValue = 0;

    const updateFineReadout = value => {
      if (rotateFineValue) {
        rotateFineValue.textContent = `${value}°`;
      }
    };

    const applyFineRotateDelta = deltaDegrees => {
      if (!deltaDegrees) return;
      this.projectManager.rotateCurrentView(deltaDegrees);
    };

    if (rotateFineSlider) {
      const setFineRotateActive = active => {
        document.body.classList.toggle('fine-rotate-active', active);
      };

      rotateFineSlider.addEventListener('pointerdown', () => setFineRotateActive(true));
      rotateFineSlider.addEventListener('input', () => {
        const value = Number(rotateFineSlider.value);
        const delta = value - lastFineValue;
        lastFineValue = value;
        updateFineReadout(value);
        applyFineRotateDelta(delta);
      });

      const resetFineSlider = () => {
        lastFineValue = 0;
        rotateFineSlider.value = '0';
        updateFineReadout(0);
        setFineRotateActive(false);
      };

      rotateFineSlider.addEventListener('pointerup', resetFineSlider);
      rotateFineSlider.addEventListener('pointercancel', resetFineSlider);
      rotateFineSlider.addEventListener('blur', resetFineSlider);
    }

    // Tools
    const drawingModeToggles = document.querySelectorAll('#drawingModeToggle');
    const textModeToggles = document.querySelectorAll('#textModeToggle');
    const textModeWrappers = document.querySelectorAll('#textModeWrapper');
    const textModeOptions = document.querySelectorAll('[data-text-size]');
    const clearBtn = document.getElementById('clear');

    const textToolSizeMultipliers = {
      small: 0.75,
      medium: 1,
      large: 1.35,
    };

    const getCurrentTextSize = () => {
      const viewId = window.app?.projectManager?.currentViewId;
      const base = viewId ? window.originalImageDimensions?.[viewId] : null;
      const baseWidth = base?.width || 1200;
      return Math.max(12, Math.round((baseWidth / 1200) * 12));
    };

    const syncTextCursor = () => {
      const canvasEl = document.getElementById('canvas');
      if (!canvasEl) return;
      const isText = this.toolManager.activeTool === this.toolManager.tools.text;
      canvasEl.style.cursor = isText ? 'text' : 'crosshair';
    };

    const updateTextToggleState = () => {
      const isText = this.toolManager.activeTool === this.toolManager.tools.text;
      textModeWrappers.forEach(wrapper => {
        wrapper.classList.toggle('shape-active', isText);
        if (!isText) {
          wrapper.classList.remove('shape-open');
        }
      });
      textModeToggles.forEach(toggle => {
        toggle.setAttribute('aria-pressed', String(isText));
        toggle.classList.toggle('shape-inactive', !isText);
      });
    };

    const updateDrawingToggleLabels = text => {
      drawingModeToggles.forEach(toggle => this.updateToggleLabel(toggle, text));
    };

    drawingModeToggles.forEach(toggle => {
      toggle.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const wrapper = toggle.closest('.shape-toggle');
        if (wrapper) wrapper.classList.toggle('shape-open');
      });
    });

    textModeToggles.forEach(toggle => {
      toggle.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const wrapper = toggle.closest('.shape-toggle');
        if (wrapper) wrapper.classList.toggle('shape-open');
        this.toolManager.previousToolName = this.toolManager.activeToolName || 'line';
        this.toolManager.selectTool('text');
        syncTextCursor();
        updateTextToggleState();
      });
    });

    const shapeModeToggles = document.querySelectorAll('#shapeModeToggle');
    const shapeModeWrappers = document.querySelectorAll('#shapeModeWrapper');
    const shapeOptions = document.querySelectorAll('[data-shape-option]');
    const shapeFillToggles = document.querySelectorAll('[data-shape-fill-toggle]');
    const textStyleWrappers = document.querySelectorAll('#textStyleWrapper');
    const textStyleOptions = document.querySelectorAll('[data-text-style]');
    const drawingModeWrappers = document.querySelectorAll('#drawingModeWrapper');
    const drawingModeOptions = document.querySelectorAll('[data-drawing-mode]');
    const textStyleToggles = document.querySelectorAll('#textStyleToggle');
    const shapeFillStyles = ['solid', 'no-fill', 'clear-black', 'clear-color', 'clear-white'];
    const shapeFillLabels = {
      solid: 'Solid',
      'no-fill': 'No Fill',
      'clear-black': 'Clear Black',
      'clear-color': 'Clear Color',
      'clear-white': 'Clear White',
    };
    const shapeIcons = {
      square: '■',
      triangle: '▲',
      circle: '●',
      star: '★',
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

    const updateShapeIcon = shape => {
      shapeModeToggles.forEach(toggle => {
        const icon = toggle.querySelector('.shape-icon');
        if (icon) icon.textContent = shapeIcons[shape] || shapeIcons.square;
      });
      shapeOptions.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-shape-option') === shape);
      });
    };

    const updateShapeAvailability = () => {
      const isShapeMode = this.toolManager.activeTool === this.toolManager.tools.shape;
      shapeModeWrappers.forEach(wrapper => {
        wrapper.classList.toggle('shape-active', isShapeMode);
        wrapper.classList.toggle('shape-disabled', !isShapeMode);
        if (!isShapeMode) {
          wrapper.classList.remove('shape-open');
        }
      });
      shapeModeToggles.forEach(toggle => {
        toggle.setAttribute('aria-pressed', String(isShapeMode));
      });
    };

    const applyShapeFillStyle = style => {
      if (this.toolManager.tools.shape) {
        this.toolManager.tools.shape.setFillStyle(style);
      }
      shapeFillToggles.forEach(toggle => {
        toggle.textContent = `Fill: ${shapeFillLabels[style]}`;
        toggle.setAttribute('aria-pressed', String(style !== 'solid'));
      });
      this.updateSelectedShapesFill(style);
    };

    const bindShapeMenu = (wrapper, shouldShow) => {
      let hideTimer = null;

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

    shapeModeWrappers.forEach(wrapper =>
      bindShapeMenu(wrapper, () => this.toolManager.activeTool === this.toolManager.tools.shape)
    );
    textStyleWrappers.forEach(wrapper => bindShapeMenu(wrapper));
    drawingModeWrappers.forEach(wrapper => bindShapeMenu(wrapper));
    textModeWrappers.forEach(wrapper => bindShapeMenu(wrapper, () => true));

    if (this.toolManager.tools.shape) {
      updateShapeIcon(this.toolManager.tools.shape.shapeType);
      const initialStyle = this.toolManager.tools.shape.getFillStyle?.() || 'solid';
      applyShapeFillStyle(initialStyle);
    }

    shapeOptions.forEach(btn => {
      btn.addEventListener('click', () => {
        const shape = btn.getAttribute('data-shape-option');
        if (!shape || !this.toolManager.tools.shape) return;
        this.toolManager.tools.shape.setShapeType(shape);
        updateShapeIcon(shape);
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

    textModeOptions.forEach(btn => {
      btn.addEventListener('click', async () => {
        const size = btn.getAttribute('data-text-size');
        if (!size) return;
        const scale = textToolSizeMultipliers[size] || textToolSizeMultipliers.medium;
        const fontSize = Math.max(12, Math.round(getCurrentTextSize() * scale));
        const tool = await this.toolManager.ensureTool('text');
        if (tool) {
          tool.setFontSize(fontSize);
        }
        this.toolManager.updateSettings({ fontSize });
        this.updateSelectedTextAndShapes({ fontSize });
        this.toolManager.previousToolName = this.toolManager.activeToolName || 'line';
        this.toolManager.selectTool('text');
        syncTextCursor();
        updateTextToggleState();
        textModeOptions.forEach(item => item.classList.remove('active'));
        btn.classList.add('active');
        textModeWrappers.forEach(wrapper => {
          wrapper.classList.remove('text-size-small', 'text-size-medium', 'text-size-large');
          wrapper.classList.add(`text-size-${size}`);
        });
        const wrapper = btn.closest('.shape-toggle');
        if (wrapper) wrapper.classList.remove('shape-open');
      });
    });

    if (textModeOptions.length > 0) {
      const defaultOption = Array.from(textModeOptions).find(
        option => option.dataset.textSize === 'medium'
      );
      if (defaultOption) {
        defaultOption.classList.add('active');
      }
      textModeWrappers.forEach(wrapper => wrapper.classList.add('text-size-medium'));
    }

    shapeFillToggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        const tool = this.toolManager.tools.shape;
        const currentStyle = tool?.getFillStyle?.() || 'solid';
        const currentIndex = shapeFillStyles.indexOf(currentStyle);
        const nextIndex = (currentIndex + 1) % shapeFillStyles.length;
        applyShapeFillStyle(shapeFillStyles[nextIndex]);
      });
    });

    window.addEventListener('toolchange', () => {
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
    const colorPicker = document.getElementById('colorPicker');
    const colorButtons = document.querySelectorAll('[data-color]');
    const textBgToggles = document.querySelectorAll('[data-text-bg-toggle]');

    if (window.textBgEnabled === undefined) {
      window.textBgEnabled = true;
    }

    if (colorPicker) {
      colorPicker.addEventListener('input', e => {
        // Update tool settings for new strokes
        this.toolManager.updateSettings({ color: e.target.value });

        if (this.toolManager?.tools?.shape) {
          this.toolManager.tools.shape.setFillStyle('no-fill');
        }

        // Update selected strokes if any are selected
        this.updateSelectedStrokes('color', e.target.value);

        // Update selected text/shape elements
        this.updateSelectedTextAndShapes({ color: e.target.value });
      });
    }

    textBgToggles.forEach(toggle => {
      toggle.checked = window.textBgEnabled === true;
    });

    colorButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.getAttribute('data-color');

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
    const brushSizeSelect = document.getElementById('brushSize');
    if (brushSizeSelect) {
      brushSizeSelect.addEventListener('change', e => {
        const width = parseInt(e.target.value, 10);

        // Update tool settings for new strokes
        this.toolManager.updateSettings({ width: width });

        // Update selected strokes if any are selected (handles both single and multi-selection)
        this.updateSelectedStrokes('strokeWidth', width);

        // Update selected shape elements only (text ignores brush size)
        this.updateSelectedTextAndShapes({ strokeWidth: width });
      });
    }

    // Dash style control (dotted lines)
    const dashStyleSelect = document.getElementById('dashStyleSelect');
    if (dashStyleSelect) {
      dashStyleSelect.addEventListener('change', e => {
        const style = e.target.value;
        const patterns = {
          solid: [],
          small: [5, 5],
          medium: [10, 5],
          large: [15, 5],
          'dot-dash': [5, 5, 1, 5],
          dotted: [2, 5],
          custom: [5, 5],
        };

        const pattern = patterns[style] || [];

        // Apply to all tools that support dash patterns
        if (this.toolManager.activeTool && this.toolManager.activeTool.setDashPattern) {
          this.toolManager.activeTool.setDashPattern(pattern);
        }

        // Apply to all line-based tools
        if (this.toolManager.tools.line) {
          this.toolManager.tools.line.setDashPattern(pattern);
        }
        if (this.toolManager.tools.curve) {
          this.toolManager.tools.curve.setDashPattern(pattern);
        }
        if (this.toolManager.tools.arrow) {
          this.toolManager.tools.arrow.setDashPattern(pattern);
        }
        if (this.toolManager.tools.shape) {
          this.toolManager.tools.shape.setDashPattern(pattern);
        }
      });
    }

    // Image fit mode control
    const fitModeSelect = document.getElementById('fitModeSelect');
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
      copyCanvasBtn.addEventListener('click', async () => {
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
          const copyIcon = copyCanvasBtn.querySelector('#copyIcon');
          const checkIcon = copyCanvasBtn.querySelector('#checkIcon');

          // Get the capture frame if it exists
          const captureFrame = document.getElementById('captureFrame');
          const sourceCanvas = canvas.lowerCanvasEl;
          let cropData = null;

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
            console.log('[Copy] Copying full canvas:', tempCanvas.width, 'x', tempCanvas.height);
          }

          // Convert to blob and copy to clipboard
          const blob = await new Promise((resolve, reject) => {
            tempCanvas.toBlob(b => {
              if (b) resolve(b);
              else reject(new Error('Failed to create blob'));
            }, 'image/png');
          });

          console.log('[Copy] Blob created, size:', blob.size);

          if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
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
          console.error('[Copy] Failed to copy to clipboard:', error);
          if (this.projectManager?.showStatusMessage) {
            this.projectManager.showStatusMessage(
              'Failed to copy image: ' + error.message,
              'error'
            );
          }

          // Visual error feedback - subtle shake animation
          copyCanvasBtn.style.animation = 'shake 0.3s ease-in-out';
          setTimeout(() => {
            copyCanvasBtn.style.animation = '';
          }, 300);
        }
      });
      console.log('[main.js] Copy canvas button event listener added');
    } else {
      console.warn('[main.js] Copy canvas button not found');
    }
  }

  setupUnitToggle() {
    const unitToggle = document.getElementById('unitToggleBtn');
    const unitToggleSecondary = document.getElementById('unitToggleBtnSecondary');
    const unitSelector = document.getElementById('unitSelector');

    // Initialize currentUnit state
    this.currentUnit = 'inch';

    // Sync initial state
    if (unitSelector) {
      // Force reset to inch to avoid browser form restoration issues
      unitSelector.value = 'inch';

      const unitLabel = 'inches';
      if (unitToggle) unitToggle.textContent = unitLabel;
      if (unitToggleSecondary) unitToggleSecondary.textContent = unitLabel;
    }

    const toggleUnits = () => {
      // Toggle between inch and cm using our state
      this.currentUnit = this.currentUnit === 'inch' ? 'cm' : 'inch';

      // Sync selector if it exists
      if (unitSelector) {
        unitSelector.value = this.currentUnit;
      }

      // Update button labels
      const unitLabel = this.currentUnit === 'inch' ? 'inches' : 'cm';
      if (unitToggle) unitToggle.textContent = unitLabel;
      if (unitToggleSecondary) unitToggleSecondary.textContent = unitLabel;

      // Refresh all measurement displays
      if (this.metadataManager) {
        this.metadataManager.refreshAllMeasurements();
      }
    };

    if (unitToggle) {
      unitToggle.addEventListener('click', toggleUnits);
    }

    if (unitToggleSecondary) {
      unitToggleSecondary.addEventListener('click', toggleUnits);
    }

    // Also listen for direct changes to unit selector
    if (unitSelector) {
      unitSelector.addEventListener('change', () => {
        this.currentUnit = unitSelector.value;
        const unitLabel = this.currentUnit === 'inch' ? 'inches' : 'cm';
        if (unitToggle) unitToggle.textContent = unitLabel;
        if (unitToggleSecondary) unitToggleSecondary.textContent = unitLabel;

        if (this.metadataManager) {
          this.metadataManager.refreshAllMeasurements();
        }
      });
    }

    // Setup Show Measurements toggle
    const showMeasurementsCheckbox = document.getElementById('toggleShowMeasurements');
    if (showMeasurementsCheckbox) {
      showMeasurementsCheckbox.addEventListener('change', e => {
        const showMeasurements = e.target.checked;
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

  setupKeyboardShortcuts() {
    // Tab key cycles through drawing modes: Straight Line -> Curved Line -> Shapes -> Select -> Straight Line
    // Tab key cycles through drawing modes: Straight Line -> Curved Line -> Shapes -> Select -> Straight Line
    // Use capture phase to ensure we catch it before anything else
    window.addEventListener(
      'keydown',
      e => {
        // Don't cycle if typing in an input/textarea or if text tool is active
        // Exception: Allow cycling if the target is a measurement span (user wants to tab out of it)
        const isMeasurement =
          e.target.classList && e.target.classList.contains('stroke-measurement');
        if (
          (e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.isContentEditable) &&
          !isMeasurement
        ) {
          return;
        }

        // Don't cycle if text tool is active (user might be typing)
        if (this.toolManager.activeTool === this.toolManager.tools.text) {
          return;
        }

        if (e.key === 'Tab') {
          // Prevent default tab behavior (focus switching)
          e.preventDefault();
          e.stopPropagation();

          // Blur any active element to ensure focus doesn't get stuck
          if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
          }

          const currentTool = this.toolManager.activeTool;
          const drawingModeToggle = document.getElementById('drawingModeToggle');

          if (currentTool === this.toolManager.tools.line) {
            // Straight Line -> Curved Line
            this.toolManager.selectTool('curve');
            if (drawingModeToggle) {
              this.updateToggleLabel(drawingModeToggle, 'Curved Line');
            }
          } else if (currentTool === this.toolManager.tools.curve) {
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
        }
      },
      true
    ); // Use capture phase
  }

  updateToggleLabel(button, text) {
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

  applyImageFitMode(fitMode) {
    const currentView = this.projectManager.views[this.projectManager.currentViewId];

    if (!currentView || !currentView.image) {
      console.warn('No current image available for fit mode');
      return;
    }

    // Simply call the project manager's setBackgroundImage with the fit mode
    this.projectManager.setBackgroundImage(currentView.image, fitMode);
  }

  setupKeyboardControls() {
    // Create +/- buttons for resizing capture frame
    this.captureFrameScale = 1.0;

    document.addEventListener('keydown', e => {
      // Don't interfere if typing in input fields
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
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

  resizeCaptureFrameProportionally(scaleChange) {
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

  createHelpHint() {
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
    const kbd = helpHint.querySelector('kbd');
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

  createHelpMenu() {
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
    const kbdElements = helpMenu.querySelectorAll('kbd');
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
    const closeBtn = helpMenu.querySelector('#closeHelp');
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(helpOverlay);
    });

    // Close on overlay click
    helpOverlay.addEventListener('click', e => {
      if (e.target === helpOverlay) {
        document.body.removeChild(helpOverlay);
      }
    });

    // Close on Escape key
    const handleEscape = e => {
      if (e.key === 'Escape') {
        document.body.removeChild(helpOverlay);
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  toggleHelpMenu() {
    const existingOverlay = document.getElementById('helpOverlay');
    if (existingOverlay) {
      document.body.removeChild(existingOverlay);
    } else {
      this.createHelpMenu();
    }
  }
}

function startApp() {
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
