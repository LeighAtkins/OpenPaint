import { PathUtils } from './PathUtils.js';

export class ArrowManager {
  static versionStamp = 'arrow-tangent-fabric-v1';
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    this.canvas = null; // Will be set in init()

    // Default settings for next line
    this.defaultSettings = {
      startArrow: true,
      endArrow: true,
      arrowSize: 10,
      arrowStyle: 'triangular',
      arrowSpread: 1,
      ghostBaseline: true,
      dimensionOffset: 18,
      lineStyle: 'solid',
      tapeTickSpacing: 1,
    };

    this.dimensionDragState = null;
  }

  init() {
    this.canvas = this.canvasManager.fabricCanvas;
    if (!this.canvas) {
      console.error('ArrowManager: Canvas not initialized');
      return;
    }
    this.bindEvents();
  }

  bindEvents() {
    const startBtn = document.getElementById('arrowStartBtn');
    const endBtn = document.getElementById('arrowEndBtn');
    const optionsBtn = document.getElementById('arrowOptionsBtn');
    const optionsMenu = document.getElementById('arrowOptionsMenu');
    const sizeInput = document.getElementById('arrowSize');
    const sizeInputTop = document.getElementById('arrowSizeTop');
    const styleSelect = document.getElementById('arrowStyle');
    const styleSelectTop = document.getElementById('arrowStyleTop');
    const spreadInputTop = document.getElementById('arrowSpreadTop');
    const ghostInputTop = document.getElementById('arrowGhostTop');
    const bindArrowToggleButton = (button, side) => {
      if (!button) return;

      button.addEventListener(
        'click',
        e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.toggleArrow(side);
        },
        true
      );
      button.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        this.openOptionsMenuFromButton(button, optionsMenu);
      });
      button.addEventListener('dblclick', e => {
        e.preventDefault();
        e.stopPropagation();
        this.openOptionsMenuFromButton(button, optionsMenu);
      });
    };

    bindArrowToggleButton(startBtn, 'start');
    bindArrowToggleButton(endBtn, 'end');

    if (optionsBtn && optionsMenu) {
      optionsBtn.classList.add('hidden');
      const closeMenu = () => {
        optionsMenu.classList.add('hidden');
      };
      document.addEventListener('click', closeMenu);
      optionsMenu.addEventListener('click', e => e.stopPropagation());
    }

    if (sizeInput) {
      sizeInput.addEventListener('input', e => {
        const size = parseInt(e.target.value, 10);
        this.updateSetting('arrowSize', size);
      });
    }

    if (sizeInputTop) {
      sizeInputTop.addEventListener('input', e => {
        const size = parseInt(e.target.value, 10);
        this.updateSetting('arrowSize', size);
      });
    }

    if (styleSelect) {
      styleSelect.addEventListener('change', e => {
        this.updateSetting('arrowStyle', e.target.value);
      });
    }

    if (styleSelectTop) {
      styleSelectTop.addEventListener('change', e => {
        this.updateSetting('arrowStyle', e.target.value);
      });
    }

    if (spreadInputTop) {
      spreadInputTop.addEventListener('input', e => {
        const pct = parseInt(e.target.value, 10);
        const spread = Math.max(0.5, Math.min(1.8, pct / 100));
        this.updateSetting('arrowSpread', spread);
      });
    }

    if (ghostInputTop) {
      ghostInputTop.addEventListener('change', e => {
        this.updateSetting('ghostBaseline', Boolean(e.target.checked));
      });
    }

    // Listen for selection changes to update button state
    this.canvas.on('selection:created', e => this.updateButtonState(e.selected));
    this.canvas.on('selection:updated', e => this.updateButtonState(e.selected));
    this.canvas.on('selection:cleared', () => this.updateButtonState(null));
    this.updateButtonState(null);

    // Right-click + drag on dimension arrows to move the dimension line offset
    this.canvas.on('mouse:down', opt => {
      const evt = opt?.e;
      const target = opt?.target;
      if (!target || target.type !== 'line') return;
      if (target.arrowSettings?.arrowStyle !== 'dimension') return;

      const pointer = this.canvas.getPointer(evt);
      target.__dimensionDragStart = {
        object: target,
        startPointer: { x: pointer.x, y: pointer.y },
        startOffset: Number(target.arrowSettings?.dimensionOffset ?? 18),
        anchorLeft: Number(target.left || 0),
        anchorTop: Number(target.top || 0),
      };

      if (evt.button === 2) {
        evt.preventDefault();
        this.dimensionDragState = { ...target.__dimensionDragStart };
        this.canvas.defaultCursor = 'ns-resize';
      }
    });

    this.canvas.on('object:moving', opt => {
      const target = opt?.target;
      if (!target || target.type !== 'line') return;
      if (target.arrowSettings?.arrowStyle !== 'dimension') return;

      const drag = target.__dimensionDragStart;
      const evt = opt?.e;
      if (!drag || !evt) return;

      const endpoints = this.getLineWorldEndpoints(target);
      if (!endpoints) return;

      const pointer = this.canvas.getPointer(evt);
      const deltaX = pointer.x - drag.startPointer.x;
      const deltaY = pointer.y - drag.startPointer.y;
      const vx = endpoints.x2 - endpoints.x1;
      const vy = endpoints.y2 - endpoints.y1;
      const len = Math.hypot(vx, vy) || 1;
      const nx = -vy / len;
      const ny = vx / len;
      const projected = deltaX * nx + deltaY * ny;

      const nextOffset = Math.max(-2500, Math.min(2500, drag.startOffset + projected));
      target.arrowSettings = target.arrowSettings || { ...this.defaultSettings };
      target.arrowSettings.dimensionOffset = nextOffset;

      // Keep source line fixed; only move the dimension overlay
      target.set({
        left: drag.anchorLeft,
        top: drag.anchorTop,
      });
      target.setCoords();
      this.syncArrowMetadata(target);
      target.dirty = true;
      this.canvas.requestRenderAll();
    });

    this.canvas.on('mouse:move', opt => {
      if (!this.dimensionDragState) return;
      const evt = opt?.e;
      if (!evt) return;
      evt.preventDefault();

      const { object, startPointer, startOffset } = this.dimensionDragState;
      if (!object || object.type !== 'line') return;

      const endpoints = this.getLineWorldEndpoints(object);
      if (!endpoints) return;

      const pointer = this.canvas.getPointer(evt);
      const deltaX = pointer.x - startPointer.x;
      const deltaY = pointer.y - startPointer.y;
      const vx = endpoints.x2 - endpoints.x1;
      const vy = endpoints.y2 - endpoints.y1;
      const len = Math.hypot(vx, vy) || 1;
      const nx = -vy / len;
      const ny = vx / len;
      const projected = deltaX * nx + deltaY * ny;

      const nextOffset = Math.max(-2500, Math.min(2500, startOffset + projected));
      object.arrowSettings = object.arrowSettings || { ...this.defaultSettings };
      object.arrowSettings.dimensionOffset = nextOffset;
      this.syncArrowMetadata(object);
      object.dirty = true;
      this.canvas.requestRenderAll();
    });

    this.canvas.on('mouse:up', () => {
      const active = this.canvas.getActiveObject?.();
      const hadLeftDrag = Boolean(active?.__dimensionDragStart);
      if (hadLeftDrag) {
        delete active.__dimensionDragStart;
      }

      const hadRightDrag = Boolean(this.dimensionDragState);
      if (hadRightDrag) {
        this.dimensionDragState = null;
        this.canvas.defaultCursor = 'default';
      }

      if ((hadLeftDrag || hadRightDrag) && window.app?.historyManager?.saveState) {
        window.app.historyManager.saveState({ force: true, reason: 'arrow:dimension-offset' });
      }
    });

    const upperCanvas = this.canvas.upperCanvasEl;
    if (upperCanvas && !upperCanvas.__arrowContextMenuBound) {
      upperCanvas.__arrowContextMenuBound = true;
      upperCanvas.addEventListener('contextmenu', evt => {
        const active = this.canvas.getActiveObject?.();
        if (active?.type === 'line' && active?.arrowSettings?.arrowStyle === 'dimension') {
          evt.preventDefault();
        }
      });
    }

    // Listen for object creation to apply default settings
    this.canvas.on('object:added', e => {
      const obj = e.target;
      if (obj && (obj.type === 'line' || obj.type === 'path') && !obj.arrowSettings) {
        // Only apply if it's a newly created object (not one being loaded from JSON which might already have settings)
        // However, checking if it's "new" is tricky.
        // We'll rely on the Tool to call applyArrows, OR we can do it here if missing.
        // But Tools usually create the object.
      }
    });
  }

  toggleArrow(side) {
    const activeObjects = this.canvas.getActiveObjects();

    if (activeObjects.length > 0) {
      // Filter to only valid drawable objects
      const validObjects = activeObjects.filter(obj => obj.type === 'line' || obj.type === 'path');

      if (validObjects.length > 0) {
        // Toggle on all selected objects
        validObjects.forEach(obj => {
          if (!obj.arrowSettings) {
            obj.arrowSettings = { ...this.defaultSettings };
          }
          if (obj.type === 'path') {
            obj.arrowSettings.curveArrows = true;
          }

          if (side === 'start') {
            obj.arrowSettings.startArrow = !obj.arrowSettings.startArrow;
          } else {
            obj.arrowSettings.endArrow = !obj.arrowSettings.endArrow;
          }

          this.attachArrowRendering(obj);
          this.syncArrowMetadata(obj);
          obj.dirty = true;
        });

        this.canvas.requestRenderAll();
        this.updateButtonState(validObjects);
      }
    } else {
      // Toggle default settings for next line
      if (side === 'start') {
        this.defaultSettings.startArrow = !this.defaultSettings.startArrow;
      } else {
        this.defaultSettings.endArrow = !this.defaultSettings.endArrow;
      }
      this.updateButtonState(null);
    }
  }

  updateSetting(key, value) {
    const activeObjects = this.canvas.getActiveObjects();

    if (activeObjects.length > 0) {
      // Filter to only valid drawable objects
      const validObjects = activeObjects.filter(obj => obj.type === 'line' || obj.type === 'path');

      if (validObjects.length > 0) {
        // Update all selected objects
        validObjects.forEach(obj => {
          if (!obj.arrowSettings) {
            obj.arrowSettings = { ...this.defaultSettings };
          }
          if (obj.type === 'path') {
            obj.arrowSettings.curveArrows = true;
          }

          obj.arrowSettings[key] = value;
          if (key === 'arrowStyle' && value === 'dimension') {
            if (!obj.arrowSettings.startArrow && !obj.arrowSettings.endArrow) {
              obj.arrowSettings.startArrow = true;
              obj.arrowSettings.endArrow = true;
            }
          }
          this.attachArrowRendering(obj);
          this.syncArrowMetadata(obj);
          obj.dirty = true;
        });

        this.canvas.requestRenderAll();
        this.updateButtonState(validObjects);
      }
    } else {
      // Update default settings
      this.defaultSettings[key] = value;
      if (key === 'arrowStyle' && value === 'dimension') {
        if (!this.defaultSettings.startArrow && !this.defaultSettings.endArrow) {
          this.defaultSettings.startArrow = true;
          this.defaultSettings.endArrow = true;
        }
      }
      this.updateButtonState(null);
    }
  }

  openOptionsMenuFromButton(button, menu) {
    if (!button || !menu) return;
    if (document.getElementById('lineStylePopoverPanel')) return;
    const rect = button.getBoundingClientRect();
    menu.classList.remove('hidden');
    menu.style.position = 'fixed';
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.top = `${Math.round(rect.bottom + 8)}px`;
    menu.style.zIndex = '10050';
  }

  buildArrowIconSvg(side, style) {
    const startLine = side === 'start' ? '19' : '5';
    const endLine = side === 'start' ? '5' : '19';
    if (style === 'dimension') {
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="${startLine}" y1="12" x2="${endLine}" y2="12" stroke-dasharray="3 3"></line><line x1="8" y1="6" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="18"></line></svg>`;
    }
    if (style === 'open') {
      return side === 'start'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="13 18 5 12 13 6"></polyline></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="11 6 19 12 11 18"></polyline></svg>';
    }
    if (style === 'hand-2') {
      return side === 'start'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12 C15 11,10 13,5 12"></path><path d="M12.2 18.2 L5 12 L12.5 5.2"></path></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12 C9 11,14 13,19 12"></path><path d="M11.8 5.2 L19 12 L11.5 18.2"></path></svg>';
    }
    return side === 'start'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
  }

  buildTapeCapIconSvg(side) {
    const isStart = side === 'start';
    const capX = isStart ? 4 : 15;
    const tapeX = isStart ? 9 : 4;
    return `
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="tape-cap-metal-${side}" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="#475569"/>
            <stop offset=".45" stop-color="#f8fafc"/>
            <stop offset="1" stop-color="#334155"/>
          </linearGradient>
        </defs>
        <rect x="${tapeX}" y="8" width="11" height="8" rx="1" fill="#facc15" stroke="#713f12" stroke-width="1"/>
        <path d="M${tapeX + 3} 8v8M${tapeX + 7} 8v5" stroke="#111827" stroke-width="1"/>
        <rect x="${capX}" y="6" width="5" height="12" rx=".8" fill="url(#tape-cap-metal-${side})" stroke="#334155" stroke-width="1"/>
      </svg>
    `;
  }

  updateArrowButtonIcons(style, capMode = false) {
    const startBtn = document.getElementById('arrowStartBtn');
    const endBtn = document.getElementById('arrowEndBtn');
    const normalizedStyle = style === 'hand-drawn' ? 'hand-2' : style || 'triangular';

    if (startBtn) {
      startBtn.innerHTML = capMode
        ? this.buildTapeCapIconSvg('start')
        : this.buildArrowIconSvg('start', normalizedStyle);
      startBtn.setAttribute(
        'title',
        capMode ? 'Start cap' : 'Start Arrow (right-click for options)'
      );
      startBtn.setAttribute('aria-label', capMode ? 'Toggle start cap' : 'Toggle start arrow');
    }
    if (endBtn) {
      endBtn.innerHTML = capMode
        ? this.buildTapeCapIconSvg('end')
        : this.buildArrowIconSvg('end', normalizedStyle);
      endBtn.setAttribute('title', capMode ? 'End cap' : 'End Arrow (right-click for options)');
      endBtn.setAttribute('aria-label', capMode ? 'Toggle end cap' : 'Toggle end arrow');
    }
  }

  updateButtonState(objOrArray) {
    const startBtn = document.getElementById('arrowStartBtn');
    const endBtn = document.getElementById('arrowEndBtn');
    const sizeInput = document.getElementById('arrowSize');
    const sizeInputTop = document.getElementById('arrowSizeTop');
    const styleSelect = document.getElementById('arrowStyle');
    const styleSelectTop = document.getElementById('arrowStyleTop');
    const spreadInputTop = document.getElementById('arrowSpreadTop');
    const ghostInputTop = document.getElementById('arrowGhostTop');

    let startActive = false;
    let startMixed = false;
    let endActive = false;
    let endMixed = false;
    let size = 15;
    let style = 'hand-2';
    let spread = 1;
    let ghostBaseline = true;
    let isMixedSize = false;
    let isMixedStyle = false;
    let capMode =
      typeof window !== 'undefined' && window.app?.currentDashSettings?.style === 'tape';

    // Handle array of objects (multi-selection)
    if (Array.isArray(objOrArray) && objOrArray.length > 0) {
      const validObjects = objOrArray.filter(obj => obj.type === 'line' || obj.type === 'path');

      if (validObjects.length > 0) {
        capMode = validObjects.some(
          obj => obj.lineStyle === 'tape' || obj.arrowSettings?.lineStyle === 'tape'
        );
        // Check start arrow state
        const startStates = validObjects.map(obj => obj.arrowSettings?.startArrow ?? false);
        const endStates = validObjects.map(obj => obj.arrowSettings?.endArrow ?? false);
        const sizes = validObjects.map(obj => obj.arrowSettings?.arrowSize ?? 15);
        const styles = validObjects.map(obj => obj.arrowSettings?.arrowStyle ?? 'hand-2');
        const spreads = validObjects.map(obj => obj.arrowSettings?.arrowSpread ?? 1);
        const ghosts = validObjects.map(obj => obj.arrowSettings?.ghostBaseline ?? true);

        // All true, all false, or mixed
        startActive = startStates.every(s => s === true);
        startMixed = startStates.some(s => s) && !startActive;

        endActive = endStates.every(s => s === true);
        endMixed = endStates.some(s => s) && !endActive;

        // Size and style - use first value if all match, otherwise mixed
        size = sizes[0];
        isMixedSize = !sizes.every(s => s === size);

        style = styles[0];
        isMixedStyle = !styles.every(s => s === style);
        spread = spreads[0];
        ghostBaseline = ghosts.every(v => v === true)
          ? true
          : ghosts.every(v => v === false)
            ? false
            : ghosts[0];
      }
    }
    // Handle single object
    else if (objOrArray && (objOrArray.type === 'line' || objOrArray.type === 'path')) {
      capMode = objOrArray.lineStyle === 'tape' || objOrArray.arrowSettings?.lineStyle === 'tape';
      const settings = objOrArray.arrowSettings || {
        startArrow: false,
        endArrow: false,
        arrowSize: 15,
        arrowStyle: 'triangular',
        arrowSpread: 1,
        ghostBaseline: true,
      };
      startActive = settings.startArrow;
      endActive = settings.endArrow;
      size = settings.arrowSize || 15;
      style = settings.arrowStyle || 'hand-2';
      spread = settings.arrowSpread ?? 1;
      ghostBaseline = settings.ghostBaseline ?? true;
    }
    // Default settings when nothing is selected
    else {
      startActive = this.defaultSettings.startArrow;
      endActive = this.defaultSettings.endArrow;
      size = this.defaultSettings.arrowSize || 15;
      style = this.defaultSettings.arrowStyle || 'hand-2';
      spread = this.defaultSettings.arrowSpread ?? 1;
      ghostBaseline = this.defaultSettings.ghostBaseline ?? true;
    }

    // Update start arrow button
    if (startBtn) {
      startBtn.classList.toggle('active', startActive && !startMixed);
      startBtn.classList.toggle('mixed', startMixed);
      startBtn.style.backgroundColor =
        startActive && !startMixed ? '#e0e7ff' : startMixed ? '#f3e8ff' : '';
      startBtn.style.opacity = startMixed ? '0.6' : '';
    }

    // Update end arrow button
    if (endBtn) {
      endBtn.classList.toggle('active', endActive && !endMixed);
      endBtn.classList.toggle('mixed', endMixed);
      endBtn.style.backgroundColor = endActive && !endMixed ? '#e0e7ff' : endMixed ? '#f3e8ff' : '';
      endBtn.style.opacity = endMixed ? '0.6' : '';
    }

    // Update size input
    if (sizeInput) {
      sizeInput.value = size;
      sizeInput.style.opacity = isMixedSize ? '0.6' : '';
    }

    if (sizeInputTop) {
      sizeInputTop.value = size;
      sizeInputTop.style.opacity = isMixedSize ? '0.6' : '';
    }

    // Update style select
    const styleForUi =
      style === 'hand-drawn' || style === 'hand-1' || style === 'hand-3' ? 'hand-2' : style;
    if (styleSelect) {
      styleSelect.value = styleForUi;
      styleSelect.style.opacity = isMixedStyle ? '0.6' : '';
    }

    if (styleSelectTop) {
      styleSelectTop.value = styleForUi;
      styleSelectTop.style.opacity = isMixedStyle ? '0.6' : '';
    }

    this.updateArrowButtonIcons(styleForUi, capMode);

    if (spreadInputTop) {
      spreadInputTop.value = String(Math.round((spread || 1) * 100));
    }

    if (ghostInputTop) {
      ghostInputTop.checked = Boolean(ghostBaseline);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('arrow-settings-updated', {
          detail: {
            startArrow: startActive,
            endArrow: endActive,
            arrowSize: size,
            arrowStyle: styleForUi,
            arrowSpread: spread,
            ghostBaseline,
            mixed: {
              start: startMixed,
              end: endMixed,
              size: isMixedSize,
              style: isMixedStyle,
            },
          },
        })
      );
    }
  }

  applyArrows(object) {
    // Apply current default settings to a new object
    object.arrowSettings = { ...this.defaultSettings };
    const explicitLineStyle = object.lineStyle || object.dashSettings?.style;
    if (explicitLineStyle) {
      object.arrowSettings.lineStyle = explicitLineStyle;
    }
    if (object.type === 'path') {
      object.arrowSettings.curveArrows = true;
    }
    object.objectCaching = false;
    this.attachArrowRendering(object);
    this.syncArrowMetadata(object);
  }

  captureBaselineGeometry(object) {
    if (!object) return;
    object.arrowSettings = object.arrowSettings || { ...this.defaultSettings };
    if (object.arrowSettings.baselineCaptured) return;

    if (object.type === 'line' && typeof object.calcLinePoints === 'function') {
      const p = object.calcLinePoints();
      object.arrowSettings.baseLine = { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 };
      object.arrowSettings.baselineCaptured = true;
      return;
    }

    if (object.type === 'path' && Array.isArray(object.path)) {
      object.arrowSettings.basePath = JSON.parse(JSON.stringify(object.path));
      object.arrowSettings.basePathOffset = {
        x: object.pathOffset?.x || 0,
        y: object.pathOffset?.y || 0,
      };
      object.arrowSettings.baselineCaptured = true;
    }
  }

  syncArrowMetadata(object) {
    if (object?.strokeMetadata) {
      object.strokeMetadata.arrowSettings = object.arrowSettings;
    }
  }

  getLineWorldEndpoints(object) {
    if (!object || object.type !== 'line' || typeof object.calcLinePoints !== 'function') {
      return null;
    }

    const p = object.calcLinePoints();
    const matrix = object.calcTransformMatrix();
    const fabricUtil = globalThis.fabric?.util;
    if (!fabricUtil?.transformPoint || !globalThis.fabric?.Point) {
      return null;
    }

    const p1 = fabricUtil.transformPoint(new globalThis.fabric.Point(p.x1, p.y1), matrix);
    const p2 = fabricUtil.transformPoint(new globalThis.fabric.Point(p.x2, p.y2), matrix);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }

  attachArrowRendering(object) {
    if (object._arrowRenderingAttached) return;

    object.objectCaching = false;

    const originalRender = object._render;
    const self = this;

    // Cache trigonometry constants
    const ARROW_TAN_30 = Math.tan(Math.PI / 6); // ~0.577

    object._render = function (ctx) {
      const lineStyle = this.arrowSettings?.lineStyle || this.lineStyle || this.dashSettings?.style;
      const shouldRenderTapeLine = this.type === 'line' && lineStyle === 'tape';
      const shouldRenderTapePath = this.type === 'path' && lineStyle === 'tape';
      const shouldRenderStretchyLine = this.type === 'line' && lineStyle === 'stretchy';
      const shouldRenderStretchyPath = this.type === 'path' && lineStyle === 'stretchy';
      const shouldRenderCustomLine = shouldRenderTapeLine || shouldRenderStretchyLine;
      const shouldRenderCustomPath = shouldRenderTapePath || shouldRenderStretchyPath;
      const shouldRenderCustom = shouldRenderCustomLine || shouldRenderCustomPath;
      const hasVisibleArrows = !!(
        this.arrowSettings &&
        (this.arrowSettings.startArrow || this.arrowSettings.endArrow)
      );

      // Don't render arrows if no settings, but still allow custom line bodies.
      if (!this.arrowSettings || (!hasVisibleArrows && !shouldRenderCustom)) {
        originalRender.call(this, ctx);
        return;
      }
      if (
        this.type === 'path' &&
        this.arrowSettings.curveArrows !== true &&
        !shouldRenderCustomPath
      ) {
        originalRender.call(this, ctx);
        return;
      }

      ctx.save();

      const {
        startArrow,
        endArrow,
        arrowSize,
        arrowStyle = 'triangular',
        arrowSpread = 1,
        ghostBaseline = true,
      } = this.arrowSettings;
      const strokeWidth = this.strokeWidth;
      const objScale = Math.max(Math.abs(this.scaleX || 1), Math.abs(this.scaleY || 1));
      const strokeActualWidth = strokeWidth * objScale;

      // Keep arrow geometry in object-space units so arrowheads stay aligned
      // with line endpoints regardless of viewport/image scaling adjustments.
      const scale = 1;

      // Calculate effective arrow size
      // Formula: baseArrowSize = arrowSize || (strokeActualWidth * 2)
      // effectiveBaseSize = Math.max(baseArrowSize, strokeActualWidth * 2)
      // scaledArrowSize = effectiveBaseSize * scale

      // Note: this.strokeWidth is already the "actual width" in Fabric terms usually,
      // but if the object is scaled, we might need to account for that?
      // Fabric objects: effective width = width * scaleX.
      // But strokeWidth is usually constant unless scaling stroke.
      // Let's assume strokeWidth is the base.

      const baseArrowSize = arrowSize || strokeActualWidth * 2;
      const effectiveBaseSize = Math.max(baseArrowSize, strokeActualWidth * 2);
      const scaledArrowSize = effectiveBaseSize * scale;
      // Wait, if we zoom in, the canvas scales everything.
      // If we want the arrow to stay consistent relative to the image, we don't need to multiply by scale
      // IF the canvas transform handles it.
      // But the report says: "Maintains consistent arrow size relative to image zoom level".
      // If we are inside _render, the context is transformed.
      // So drawing 10px means 10 units in object space.
      // If the object is scaled up, 10 units becomes larger.
      // So we probably just need the base size in object space.

      // However, the report says: "scaledArrowSize = effectiveBaseSize * scale".
      // This suggests the arrow size is defined in SCREEN pixels maybe?
      // Or maybe it means "relative to the image scale".
      // If the image is zoomed in (scale > 1), the arrow should get bigger? Yes.
      // If we draw in object space, it scales automatically.
      // So we just need `effectiveBaseSize`.

      const normalizedStyle =
        arrowStyle === 'hand-drawn'
          ? 'hand-1'
          : arrowStyle === 'double-line'
            ? 'dimension'
            : arrowStyle;

      const extensionDistanceByStyle = {
        triangular: 1,
        filled: 1,
        curved: 0.8,
        open: 0,
        'hand-1': 0.15,
        'hand-2': 0.2,
        'hand-3': 0.12,
        dimension: 0,
      };
      const extensionDistance = scaledArrowSize * (extensionDistanceByStyle[normalizedStyle] ?? 1);

      // We need to modify the drawing of the line to be shorter.
      // This is tricky because `originalRender` draws the full line.
      // We cannot easily intercept the path drawing inside `originalRender` without re-implementing it.
      // BUT, for `fabric.Line`, we can temporarily modify x1, y1, x2, y2?
      // No, that would affect the object state.

      // Strategy:
      // 1. Calculate arrow points.
      // 2. Draw arrows.
      // 3. Draw the line MANUALLY (shortened) instead of calling originalRender?
      //    Or use a clipping region? Clipping is expensive.
      //    Re-implementing line render is easy. Path is harder.

      if (this.type === 'line') {
        if (!this.arrowSettings?.baselineCaptured && this.selectable) {
          self.captureBaselineGeometry(this);
          self.syncArrowMetadata(this);
        }

        // Re-implement Line rendering with shortening
        const p = this.calcLinePoints();
        let x1 = p.x1;
        let y1 = p.y1;
        let x2 = p.x2;
        let y2 = p.y2;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        let startX = x1;
        let startY = y1;
        let endX = x2;
        let endY = y2;

        if (ghostBaseline && normalizedStyle === 'dimension' && this.arrowSettings?.baseLine) {
          const b = this.arrowSettings.baseLine;
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.setLineDash([5, 6]);
          ctx.beginPath();
          ctx.moveTo(b.x1, b.y1);
          ctx.lineTo(b.x2, b.y2);
          ctx.lineWidth = Math.max(1, this.strokeWidth * 0.85);
          ctx.strokeStyle = this.stroke;
          ctx.stroke();
          ctx.restore();
        }

        if (normalizedStyle === 'dimension') {
          const lenSafe = Math.max(len, 1);
          const nx = -dy / lenSafe;
          const ny = dx / lenSafe;
          const offset = Number(this.arrowSettings?.dimensionOffset ?? 18);

          const d1x = x1 + nx * offset;
          const d1y = y1 + ny * offset;
          const d2x = x2 + nx * offset;
          const d2y = y2 + ny * offset;

          // Extension lines from measured line to dimension line
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(d1x, d1y);
          ctx.moveTo(x2, y2);
          ctx.lineTo(d2x, d2y);
          ctx.lineWidth = Math.max(1, this.strokeWidth * 0.9);
          ctx.strokeStyle = this.stroke;
          ctx.stroke();
          ctx.restore();

          // Dotted dimension line between offset endpoints
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.moveTo(d1x, d1y);
          ctx.lineTo(d2x, d2y);
          ctx.lineWidth = Math.max(1, this.strokeWidth);
          ctx.strokeStyle = this.stroke;
          ctx.stroke();
          ctx.restore();

          // End ticks
          const tickHalf = Math.max(4, scaledArrowSize * 0.45);
          ctx.save();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(d1x - nx * tickHalf, d1y - ny * tickHalf);
          ctx.lineTo(d1x + nx * tickHalf, d1y + ny * tickHalf);
          ctx.moveTo(d2x - nx * tickHalf, d2y - ny * tickHalf);
          ctx.lineTo(d2x + nx * tickHalf, d2y + ny * tickHalf);
          ctx.lineWidth = Math.max(1, this.strokeWidth * 0.95);
          ctx.strokeStyle = this.stroke;
          ctx.stroke();
          ctx.restore();

          // Arrowheads on dimension line, pointing inward
          if (startArrow) {
            self.drawArrowhead(
              ctx,
              d1x,
              d1y,
              angle + Math.PI,
              scaledArrowSize,
              'open',
              this.stroke,
              arrowSpread
            );
          }
          if (endArrow) {
            self.drawArrowhead(
              ctx,
              d2x,
              d2y,
              angle,
              scaledArrowSize,
              'open',
              this.stroke,
              arrowSpread
            );
          }

          // Keep original measured line as subtle dotted reference
          ctx.save();
          ctx.globalAlpha = 0.22;
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineWidth = Math.max(1, this.strokeWidth * 0.9);
          ctx.strokeStyle = this.stroke;
          ctx.stroke();
          ctx.restore();

          ctx.restore();
          return;
        }

        if (shouldRenderTapeLine) {
          self.drawMeasuringTapeLine(
            ctx,
            x1,
            y1,
            x2,
            y2,
            this.strokeWidth,
            this.arrowSettings?.tapeTickSpacing,
            {
              startCap: startArrow,
              endCap: endArrow,
            }
          );
        } else if (shouldRenderStretchyLine) {
          const lineLength = Math.hypot(x2 - x1, y2 - y1);
          const arrowInset = Math.min(
            lineLength * 0.38,
            Math.max(0, Number(scaledArrowSize || 0)) * 0.82
          );
          const totalInset = (startArrow ? arrowInset : 0) + (endArrow ? arrowInset : 0);
          const bodyLength = Math.max(1, lineLength - totalInset);
          const stretchyArrowSize = self.computeStretchyArrowSize(this.strokeWidth, bodyLength);
          const effectiveArrowSize = Math.max(scaledArrowSize, stretchyArrowSize);
          self.drawStretchyLine(ctx, x1, y1, x2, y2, this.strokeWidth, this.stroke, {
            startArrow,
            endArrow,
            arrowSize: effectiveArrowSize,
          });
          if (startArrow) {
            self.drawArrowhead(
              ctx,
              x1,
              y1,
              angle + Math.PI,
              effectiveArrowSize,
              normalizedStyle,
              this.stroke,
              arrowSpread
            );
          }
          if (endArrow) {
            self.drawArrowhead(
              ctx,
              x2,
              y2,
              angle,
              effectiveArrowSize,
              normalizedStyle,
              this.stroke,
              arrowSpread
            );
          }
        } else {
          if (startArrow) {
            startX = x1 + Math.cos(angle) * extensionDistance;
            startY = y1 + Math.sin(angle) * extensionDistance;

            // Draw start arrow
            self.drawArrowhead(
              ctx,
              x1,
              y1,
              angle + Math.PI,
              scaledArrowSize,
              normalizedStyle,
              this.stroke,
              arrowSpread
            );
          }

          if (endArrow) {
            endX = x2 - Math.cos(angle) * extensionDistance;
            endY = y2 - Math.sin(angle) * extensionDistance;

            // Draw end arrow
            self.drawArrowhead(
              ctx,
              x2,
              y2,
              angle,
              scaledArrowSize,
              normalizedStyle,
              this.stroke,
              arrowSpread
            );
          }

          // Draw the shortened line
          ctx.setLineDash(this.strokeDashArray || []);
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.lineWidth = this.strokeWidth;
          ctx.strokeStyle = this.stroke;
          ctx.lineCap = this.strokeLineCap;
          ctx.stroke();
        }
      } else if (this.type === 'path') {
        if (!this.arrowSettings?.baselineCaptured && this.selectable) {
          self.captureBaselineGeometry(this);
          self.syncArrowMetadata(this);
        }

        const path = this.path;
        if (!path || path.length < 2) {
          originalRender.call(this, ctx);
          ctx.restore();
          return;
        }

        const offsetX = this.pathOffset?.x || 0;
        const offsetY = this.pathOffset?.y || 0;

        const fabricUtil = globalThis.fabric?.util;
        const getLastPoint = cmd => {
          const len = cmd.length;
          return { x: cmd[len - 2], y: cmd[len - 1] };
        };

        let startPoint = null;
        let endPoint = null;
        let startAngle = 0;
        let endAngle = 0;

        // Calculate path info once for reuse
        let infos = null;
        let totalLength = 0;
        if (fabricUtil?.getPathSegmentsInfo) {
          infos = fabricUtil.getPathSegmentsInfo(path);
          totalLength = infos.length ? infos[infos.length - 1].length : 0;
        }

        let pathEffectiveArrowSize = scaledArrowSize;

        if (shouldRenderTapePath) {
          self.drawCurvedMeasuringTapeLine(
            ctx,
            path,
            offsetX,
            offsetY,
            this.strokeWidth,
            infos,
            totalLength,
            this.arrowSettings?.tapeTickSpacing,
            {
              startCap: startArrow,
              endCap: endArrow,
            }
          );
        } else if (shouldRenderStretchyPath) {
          const curvedInset = Math.min(
            totalLength * 0.38,
            Math.max(0, Number(scaledArrowSize || 0)) * 0.82
          );
          const curvedTotalInset = (startArrow ? curvedInset : 0) + (endArrow ? curvedInset : 0);
          const curvedBodyLength = Math.max(1, totalLength - curvedTotalInset);
          const curvedStretchyArrowSize = self.computeStretchyArrowSize(
            this.strokeWidth,
            curvedBodyLength,
            true
          );
          pathEffectiveArrowSize = Math.max(scaledArrowSize, curvedStretchyArrowSize);
          self.drawCurvedStretchyLine(
            ctx,
            path,
            offsetX,
            offsetY,
            this.strokeWidth,
            this.stroke,
            infos,
            totalLength,
            {
              startArrow,
              endArrow,
              arrowSize: scaledArrowSize,
            }
          );
        } else {
          originalRender.call(this, ctx);
        }

        if (fabricUtil?.getPointOnPath && infos) {
          const epsilon = Math.min(2, totalLength * 0.01);
          const startInfo = fabricUtil.getPointOnPath(path, 0, infos);
          const startTangentInfo = fabricUtil.getPointOnPath(
            path,
            Math.min(epsilon, totalLength),
            infos
          );
          const endInfo = fabricUtil.getPointOnPath(path, totalLength, infos);
          const endTangentInfo = fabricUtil.getPointOnPath(
            path,
            Math.max(0, totalLength - epsilon),
            infos
          );

          if (startInfo && (startInfo.x !== 0 || startInfo.y !== 0)) {
            startPoint = { x: startInfo.x, y: startInfo.y };

            // Calculate start angle only if we have valid startInfo
            if (startTangentInfo) {
              const dx = startTangentInfo.x - startInfo.x;
              const dy = startTangentInfo.y - startInfo.y;
              startAngle = Math.atan2(dy, dx) + Math.PI; // Reverse for start arrow
            }
          }

          if (endInfo) {
            endPoint = { x: endInfo.x, y: endInfo.y };

            // Calculate end angle
            if (endTangentInfo) {
              const dx = endInfo.x - endTangentInfo.x;
              const dy = endInfo.y - endTangentInfo.y;
              endAngle = Math.atan2(dy, dx);
            }
          }
        }

        if (!startPoint || !endPoint) {
          const startCmd = path[0];
          const endCmd = path[path.length - 1];

          if (!startPoint) {
            startPoint = { x: startCmd[1], y: startCmd[2] };

            // Calculate start angle from path commands - use tangent
            // For curves, use a point slightly along the path, not the next anchor
            if (fabricUtil?.getPointOnPath && infos) {
              const epsilon = Math.min(2, totalLength * 0.01);
              const tangentInfo = fabricUtil.getPointOnPath(path, epsilon, infos);
              if (tangentInfo && (tangentInfo.x !== 0 || tangentInfo.y !== 0)) {
                const dx = tangentInfo.x - startPoint.x;
                const dy = tangentInfo.y - startPoint.y;
                startAngle = Math.atan2(dy, dx) + Math.PI; // Reverse for start arrow
              }
            }
          }

          if (!endPoint) {
            endPoint = getLastPoint(endCmd);
          }
        }

        if (!shouldRenderTapePath && startArrow) {
          self.drawArrowhead(
            ctx,
            startPoint.x - offsetX,
            startPoint.y - offsetY,
            startAngle,
            pathEffectiveArrowSize,
            normalizedStyle,
            this.stroke,
            arrowSpread
          );
        }

        if (!shouldRenderTapePath && endArrow) {
          self.drawArrowhead(
            ctx,
            endPoint.x - offsetX,
            endPoint.y - offsetY,
            endAngle,
            pathEffectiveArrowSize,
            normalizedStyle,
            this.stroke,
            arrowSpread
          );
        }
      }

      ctx.restore();
    };

    object._arrowRenderingAttached = true;
  }

  normalizeTapeTickSpacing(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.max(0.55, Math.min(2.25, numeric));
  }

  drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  drawTapeNumberLabel(ctx, text, x, y, angle, tapeHeight, backgroundColor, textColor) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const fontSize = Math.max(7, tapeHeight * 0.34);
    ctx.font = `700 ${fontSize}px Arial, sans-serif`;
    const width = Math.max(tapeHeight * 0.5, ctx.measureText(text).width + tapeHeight * 0.22);
    const height = fontSize + tapeHeight * 0.16;
    ctx.fillStyle = backgroundColor;
    this.drawRoundedRect(
      ctx,
      -width / 2,
      -height / 2,
      width,
      height,
      Math.max(2, tapeHeight * 0.12)
    );
    ctx.fill();
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  drawStretchyLine(
    ctx,
    x1,
    y1,
    x2,
    y2,
    strokeWidth = 2,
    color = '#111827',
    { startArrow = false, endArrow = false, arrowSize = 10 } = {}
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const fullLength = Math.hypot(dx, dy);
    if (fullLength < 1) return;

    const angle = Math.atan2(dy, dx);
    const ux = dx / fullLength;
    const uy = dy / fullLength;
    const endpointInset = Math.min(fullLength * 0.38, Math.max(0, Number(arrowSize || 0)) * 0.82);
    const startInset = startArrow ? endpointInset : 0;
    const endInset = endArrow ? endpointInset : 0;
    const bodyX1 = x1 + ux * startInset;
    const bodyY1 = y1 + uy * startInset;
    const bodyX2 = x2 - ux * endInset;
    const bodyY2 = y2 - uy * endInset;
    const length = Math.hypot(bodyX2 - bodyX1, bodyY2 - bodyY1);
    if (length < 1) return;

    const base = Math.max(1, Number(strokeWidth || 2));
    const stretch = Math.max(0.28, Math.min(1, length / Math.max(80, base * 70)));
    const wideHalf = Math.max(base * 1.2, base * (1.5 + stretch * 0.6));
    const narrowHalf = Math.max(base * 0.5, base * (0.45 + stretch * 0.1));
    const waistHalf = Math.max(base * 0.48, base * (1.05 - stretch * 0.48));

    const startHalf = startArrow ? wideHalf : narrowHalf;
    const endHalfBody = endArrow ? wideHalf : narrowHalf;
    const isAsymmetric = startHalf !== endHalfBody;

    const outlineWidth = Math.max(0.9, base * 0.18);
    const mid = length / 2;

    ctx.save();
    ctx.translate(bodyX1, bodyY1);
    ctx.rotate(angle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = outlineWidth;
    ctx.beginPath();

    if (isAsymmetric) {
      ctx.moveTo(0, -startHalf * 0.5);
      ctx.bezierCurveTo(
        length * 0.28,
        -startHalf * 0.7,
        length * 0.72,
        -endHalfBody * 0.9,
        length,
        -endHalfBody * 0.5
      );
      if (endArrow) {
        ctx.lineTo(length, endHalfBody * 0.5);
      } else {
        ctx.quadraticCurveTo(length + endHalfBody * 0.6, 0, length, endHalfBody * 0.5);
      }
      ctx.bezierCurveTo(
        length * 0.72,
        endHalfBody * 0.9,
        length * 0.28,
        startHalf * 0.7,
        0,
        startHalf * 0.5
      );
      if (startArrow) {
        ctx.lineTo(0, -startHalf * 0.5);
      } else {
        ctx.quadraticCurveTo(-startHalf * 0.6, 0, 0, -startHalf * 0.5);
      }
    } else {
      const leftShoulder = Math.min(length * 0.24, wideHalf * 3);
      const rightShoulder = Math.max(length - leftShoulder, length * 0.76);

      ctx.moveTo(0, -wideHalf * 0.72);
      ctx.bezierCurveTo(
        leftShoulder * 0.32,
        -wideHalf * 1.12,
        mid * 0.72,
        -waistHalf * 1.2,
        mid,
        -waistHalf
      );
      ctx.bezierCurveTo(
        mid * 1.28,
        -waistHalf * 1.2,
        rightShoulder,
        -wideHalf * 1.12,
        length,
        -wideHalf * 0.72
      );
      if (endArrow) {
        ctx.lineTo(length, wideHalf * 0.72);
      } else {
        ctx.quadraticCurveTo(length + wideHalf * 0.9, 0, length, wideHalf * 0.72);
      }
      ctx.bezierCurveTo(
        rightShoulder,
        wideHalf * 1.12,
        mid * 1.28,
        waistHalf * 1.2,
        mid,
        waistHalf
      );
      ctx.bezierCurveTo(
        mid * 0.72,
        waistHalf * 1.2,
        leftShoulder * 0.32,
        wideHalf * 1.12,
        0,
        wideHalf * 0.72
      );
      if (startArrow) {
        ctx.lineTo(0, -wideHalf * 0.72);
      } else {
        ctx.quadraticCurveTo(-wideHalf * 0.9, 0, 0, -wideHalf * 0.72);
      }
    }

    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  drawCurvedStretchyLine(
    ctx,
    path,
    offsetX,
    offsetY,
    strokeWidth = 2,
    color = '#111827',
    infos = null,
    totalLength = 0,
    { startArrow = false, endArrow = false, arrowSize = 10 } = {}
  ) {
    const fabricUtil = globalThis.fabric?.util;
    if (!fabricUtil?.getPathSegmentsInfo || !fabricUtil?.getPointOnPath || !Array.isArray(path)) {
      return;
    }

    const segmentInfo = infos || fabricUtil.getPathSegmentsInfo(path);
    const pathLength =
      totalLength || (segmentInfo.length ? segmentInfo[segmentInfo.length - 1].length : 0);
    if (!pathLength || pathLength < 1) return;

    const base = Math.max(1, Number(strokeWidth || 2));
    const sampleStep = Math.max(4, Math.min(10, base * 1.4));
    const stretch = Math.max(0.28, Math.min(1, pathLength / Math.max(90, base * 75)));
    const wideWidth = Math.max(base * 2.2, base * (2.8 + stretch * 1.2));
    const waistWidth = Math.max(base * 1.08, base * (2.05 - stretch * 0.82));
    const narrowWidth = Math.max(base * 0.6, base * (0.55 + stretch * 0.15));

    const startWidthWide = startArrow ? wideWidth : narrowWidth;
    const endWidthVal = endArrow ? wideWidth : narrowWidth;
    const isAsymmetric = startWidthWide !== endWidthVal;

    const getCommandPoint = cmd => {
      if (!cmd || cmd.length < 3) return null;
      return { x: cmd[cmd.length - 2], y: cmd[cmd.length - 1] };
    };
    const startRaw = getCommandPoint(path[0]);
    const endRaw = getCommandPoint(path[path.length - 1]);

    const pointAt = distance => {
      const clampedDistance = Math.max(0, Math.min(pathLength, distance));
      if (clampedDistance === 0 && startRaw) {
        return { x: startRaw.x - offsetX, y: startRaw.y - offsetY, d: clampedDistance };
      }
      if (clampedDistance === pathLength && endRaw) {
        return { x: endRaw.x - offsetX, y: endRaw.y - offsetY, d: clampedDistance };
      }
      const point = fabricUtil.getPointOnPath(path, clampedDistance, segmentInfo);
      if (!point) return null;
      return { x: point.x - offsetX, y: point.y - offsetY, d: clampedDistance };
    };

    const samples = [];
    const endpointInset = Math.min(pathLength * 0.38, Math.max(0, Number(arrowSize || 0)) * 0.82);
    const startDistance = startArrow ? endpointInset : 0;
    const endDistance = endArrow
      ? Math.max(startDistance + 1, pathLength - endpointInset)
      : pathLength;

    for (let d = startDistance; d <= endDistance; d += sampleStep) {
      const point = pointAt(d);
      const previous = samples[samples.length - 1];
      if (
        point &&
        (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) < sampleStep * 8)
      ) {
        samples.push(point);
      }
    }
    const finalPoint = pointAt(endDistance);
    if (finalPoint) samples.push(finalPoint);
    if (samples.length < 2) return;

    const widthAt = distance => {
      const t = Math.max(0, Math.min(1, distance / pathLength));
      if (!isAsymmetric) {
        const centerPinch = Math.sin(Math.PI * t);
        return wideWidth * (1 - centerPinch) + waistWidth * centerPinch;
      }
      const smoothstep = t * t * (3 - 2 * t);
      return startWidthWide + (endWidthVal - startWidthWide) * smoothstep;
    };

    const strokeSegments = (widthScale, strokeStyle, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = strokeStyle;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      for (let i = 1; i < samples.length; i += 1) {
        const prev = samples[i - 1];
        const next = samples[i];
        ctx.lineWidth = Math.max(0.8, widthAt((prev.d + next.d) / 2) * widthScale);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }
      ctx.restore();
    };

    strokeSegments(1.08, color, 1);
    strokeSegments(1, color, 1);
  }

  computeStretchyArrowSize(strokeWidth, bodyLength, curved = false) {
    const base = Math.max(1, Number(strokeWidth || 2));
    const normLength = curved ? Math.max(90, base * 75) : Math.max(80, base * 70);
    const stretch = Math.max(0.28, Math.min(1, bodyLength / normLength));
    const wideSize = curved
      ? Math.max(base * 2.8, base * (3.4 + stretch * 1.5))
      : Math.max(base * 1.8, base * (2.2 + stretch * 0.8));
    const tangentHalf = Math.tan(Math.PI / 6);
    return Math.ceil(wideSize / tangentHalf);
  }

  drawStraightTapeEnds(ctx, length, tapeHeight, { startCap = true, endCap = true } = {}) {
    const half = tapeHeight / 2;

    if (startCap) {
      const hookDepth = Math.max(12, tapeHeight * 0.9);
      const lip = Math.max(3, tapeHeight * 0.18);
      const metalGradient = ctx.createLinearGradient(-hookDepth, -half, 2, half);
      metalGradient.addColorStop(0, '#64748b');
      metalGradient.addColorStop(0.3, '#f8fafc');
      metalGradient.addColorStop(0.62, '#94a3b8');
      metalGradient.addColorStop(1, '#334155');

      ctx.save();
      ctx.fillStyle = metalGradient;
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = Math.max(1, tapeHeight * 0.08);
      ctx.beginPath();
      ctx.moveTo(1, -half - lip * 0.45);
      ctx.lineTo(-hookDepth * 0.58, -half - lip);
      ctx.quadraticCurveTo(-hookDepth * 0.92, -half * 0.92, -hookDepth, -half * 0.44);
      ctx.lineTo(-hookDepth, half * 0.44);
      ctx.quadraticCurveTo(-hookDepth * 0.9, half * 0.92, -hookDepth * 0.58, half + lip);
      ctx.lineTo(1, half + lip * 0.45);
      ctx.lineTo(1, half * 0.55);
      ctx.lineTo(-hookDepth * 0.33, half * 0.46);
      ctx.quadraticCurveTo(-hookDepth * 0.53, half * 0.26, -hookDepth * 0.52, 0);
      ctx.quadraticCurveTo(-hookDepth * 0.53, -half * 0.26, -hookDepth * 0.33, -half * 0.46);
      ctx.lineTo(1, -half * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(0.8, tapeHeight * 0.04);
      ctx.beginPath();
      ctx.moveTo(-hookDepth * 0.72, -half * 0.54);
      ctx.quadraticCurveTo(-hookDepth * 0.88, 0, -hookDepth * 0.72, half * 0.54);
      ctx.stroke();

      const rivetRadius = Math.max(1.4, tapeHeight * 0.09);
      [-half * 0.42, half * 0.42].forEach(y => {
        ctx.beginPath();
        ctx.fillStyle = '#334155';
        ctx.arc(-hookDepth * 0.2, y, rivetRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.arc(-hookDepth * 0.22, y - rivetRadius * 0.28, rivetRadius * 0.35, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    if (endCap) {
      const caseWidth = Math.max(42, tapeHeight * 3.4);
      const caseHeight = Math.max(34, tapeHeight * 2.55);
      const caseX = length + tapeHeight * 0.22;
      const caseY = -caseHeight * 0.5;
      const wheelRadius = caseHeight * 0.32;
      const wheelX = caseX + caseWidth * 0.57;
      const bodyGradient = ctx.createLinearGradient(
        caseX,
        caseY,
        caseX + caseWidth,
        caseY + caseHeight
      );
      bodyGradient.addColorStop(0, '#6b7280');
      bodyGradient.addColorStop(0.34, '#334155');
      bodyGradient.addColorStop(0.72, '#475569');
      bodyGradient.addColorStop(1, '#1f2937');

      ctx.save();
      ctx.fillStyle = 'rgba(15,23,42,0.18)';
      ctx.beginPath();
      ctx.ellipse(
        caseX + caseWidth * 0.5,
        caseHeight * 0.52,
        caseWidth * 0.55,
        caseHeight * 0.18,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.fillStyle = bodyGradient;
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = Math.max(1.4, tapeHeight * 0.085);
      ctx.beginPath();
      ctx.moveTo(caseX, caseY + caseHeight * 0.24);
      ctx.quadraticCurveTo(
        caseX + caseWidth * 0.08,
        caseY + caseHeight * 0.08,
        caseX + caseWidth * 0.24,
        caseY + caseHeight * 0.05
      );
      ctx.lineTo(caseX + caseWidth * 0.7, caseY + caseHeight * 0.05);
      ctx.quadraticCurveTo(
        caseX + caseWidth * 0.96,
        caseY + caseHeight * 0.12,
        caseX + caseWidth * 0.98,
        caseY + caseHeight * 0.42
      );
      ctx.lineTo(caseX + caseWidth * 0.9, caseY + caseHeight * 0.82);
      ctx.quadraticCurveTo(
        caseX + caseWidth * 0.84,
        caseY + caseHeight * 0.97,
        caseX + caseWidth * 0.62,
        caseY + caseHeight * 0.97
      );
      ctx.lineTo(caseX + caseWidth * 0.15, caseY + caseHeight * 0.94);
      ctx.quadraticCurveTo(
        caseX + caseWidth * 0.02,
        caseY + caseHeight * 0.86,
        caseX,
        caseY + caseHeight * 0.68
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const wheelGradient = ctx.createRadialGradient(
        wheelX - wheelRadius * 0.35,
        -wheelRadius * 0.36,
        wheelRadius * 0.08,
        wheelX,
        0,
        wheelRadius
      );
      wheelGradient.addColorStop(0, '#fff7cc');
      wheelGradient.addColorStop(0.25, '#fde68a');
      wheelGradient.addColorStop(0.72, '#f59e0b');
      wheelGradient.addColorStop(1, '#92400e');
      ctx.fillStyle = wheelGradient;
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = Math.max(1.2, tapeHeight * 0.07);
      ctx.beginPath();
      ctx.arc(wheelX, 0, wheelRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(120,53,15,0.78)';
      ctx.lineWidth = Math.max(0.9, tapeHeight * 0.045);
      ctx.beginPath();
      ctx.arc(wheelX, 0, wheelRadius * 0.72, Math.PI * 0.04, Math.PI * 1.94);
      ctx.arc(wheelX, 0, wheelRadius * 0.47, Math.PI * 1.9, Math.PI * 0.12, true);
      ctx.stroke();

      ctx.fillStyle = '#111827';
      [caseX + caseWidth * 0.22, caseX + caseWidth * 0.84].forEach((x, idx) => {
        const y = idx === 0 ? caseY + caseHeight * 0.66 : caseY + caseHeight * 0.72;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.3, tapeHeight * 0.14), 0, Math.PI * 2);
        ctx.fill();
      });

      const buttonGradient = ctx.createLinearGradient(
        caseX + caseWidth * 0.08,
        caseY - tapeHeight * 0.1,
        caseX + caseWidth * 0.32,
        caseY + caseHeight * 0.42
      );
      buttonGradient.addColorStop(0, '#fef3c7');
      buttonGradient.addColorStop(0.45, '#fbbf24');
      buttonGradient.addColorStop(1, '#b45309');
      ctx.fillStyle = buttonGradient;
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = Math.max(1, tapeHeight * 0.055);
      this.drawRoundedRect(
        ctx,
        caseX + caseWidth * 0.05,
        caseY + caseHeight * 0.08,
        caseWidth * 0.22,
        caseHeight * 0.46,
        Math.max(4, tapeHeight * 0.25)
      );
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, tapeHeight * 0.05);
      ctx.beginPath();
      ctx.moveTo(caseX + caseWidth * 0.42, caseY + caseHeight * 0.16);
      ctx.quadraticCurveTo(
        caseX + caseWidth * 0.72,
        caseY + caseHeight * 0.22,
        caseX + caseWidth * 0.82,
        caseY + caseHeight * 0.48
      );
      ctx.stroke();

      ctx.strokeStyle = '#111827';
      ctx.lineWidth = Math.max(2.1, tapeHeight * 0.13);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(caseX + caseWidth * 0.94, caseY + caseHeight * 0.72);
      ctx.quadraticCurveTo(
        caseX + caseWidth * 1.25,
        caseY + caseHeight * 0.65,
        caseX + caseWidth * 1.36,
        caseY + caseHeight * 0.9
      );
      ctx.quadraticCurveTo(
        caseX + caseWidth * 1.14,
        caseY + caseHeight * 0.84,
        caseX + caseWidth * 0.97,
        caseY + caseHeight * 0.84
      );
      ctx.stroke();
      ctx.restore();
    }
  }

  drawCurvedTapeEndCap(ctx, x, y, angle, tapeHeight, accent = false) {
    const capWidth = Math.max(9, tapeHeight * 0.68);
    const capHeight = tapeHeight + 5;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const gradient = ctx.createLinearGradient(-capWidth / 2, 0, capWidth / 2, 0);
    gradient.addColorStop(0, '#475569');
    gradient.addColorStop(0.22, '#f8fafc');
    gradient.addColorStop(0.58, '#94a3b8');
    gradient.addColorStop(1, '#1f2937');
    ctx.fillStyle = gradient;
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = Math.max(1, tapeHeight * 0.075);
    ctx.beginPath();
    ctx.rect(-capWidth / 2, -capHeight / 2, capWidth, capHeight);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = Math.max(0.8, tapeHeight * 0.04);
    ctx.beginPath();
    ctx.moveTo(-capWidth * 0.18, -capHeight * 0.42);
    ctx.lineTo(-capWidth * 0.18, capHeight * 0.42);
    ctx.stroke();
    if (accent) {
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = Math.max(1.4, tapeHeight * 0.1);
      ctx.beginPath();
      ctx.moveTo(0, -capHeight * 0.35);
      ctx.lineTo(0, capHeight * 0.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMeasuringTapeLine(ctx, x1, y1, x2, y2, strokeWidth = 2, tickSpacing = 1, endOptions = {}) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;

    const angle = Math.atan2(dy, dx);
    const tapeHeight = Math.max(16, Math.min(38, Number(strokeWidth || 2) * 7.2));
    const half = tapeHeight / 2;
    const spacing = this.normalizeTapeTickSpacing(tickSpacing);
    const tickStep = Math.max(6, tapeHeight * 0.48 * spacing);
    const majorEvery = 5;
    const numberEvery = 10;

    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    const bodyGradient = ctx.createLinearGradient(0, -half, 0, half);
    bodyGradient.addColorStop(0, '#fff7a8');
    bodyGradient.addColorStop(0.18, '#fde047');
    bodyGradient.addColorStop(0.48, '#facc15');
    bodyGradient.addColorStop(0.78, '#f59e0b');
    bodyGradient.addColorStop(1, '#b45309');

    ctx.fillStyle = bodyGradient;
    ctx.fillRect(0, -half, length, tapeHeight);

    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#fff7cc';
    ctx.fillRect(0, -half + tapeHeight * 0.12, length, tapeHeight * 0.16);
    ctx.globalAlpha = 0.36;
    ctx.fillStyle = '#92400e';
    ctx.fillRect(0, half - tapeHeight * 0.22, length, tapeHeight * 0.12);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = Math.max(0.75, tapeHeight * 0.08);
    ctx.strokeRect(0, -half, length, tapeHeight);

    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(0.7, tapeHeight * 0.045);
    ctx.beginPath();
    ctx.moveTo(0, -half + tapeHeight * 0.24);
    ctx.lineTo(length, -half + tapeHeight * 0.24);
    ctx.stroke();

    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = Math.max(1, tapeHeight * 0.055);
    ctx.beginPath();
    ctx.moveTo(0, half - tapeHeight * 0.1);
    ctx.lineTo(length, half - tapeHeight * 0.1);
    ctx.stroke();

    const tickCount = Math.floor(length / tickStep);
    for (let i = 0; i <= tickCount; i += 1) {
      const x = Math.min(length, i * tickStep);
      const isMajor = i % majorEvery === 0;
      const isNumber = i > 0 && i % numberEvery === 0;
      const tickLength = isMajor
        ? tapeHeight * 0.86
        : i % 2 === 0
          ? tapeHeight * 0.56
          : tapeHeight * 0.34;
      const color = isNumber ? '#b91c1c' : '#111827';

      ctx.strokeStyle = color;
      ctx.lineWidth = isMajor
        ? Math.max(1.35, tapeHeight * 0.085)
        : Math.max(0.8, tapeHeight * 0.045);
      ctx.beginPath();
      if (isMajor) {
        ctx.moveTo(x, -half + 1);
        ctx.lineTo(x, half - tapeHeight * 0.14);
      } else {
        ctx.moveTo(x, -half + 1);
        ctx.lineTo(x, -half + tickLength);
        if (i % 2 === 0) {
          ctx.moveTo(x, half - tapeHeight * 0.12);
          ctx.lineTo(x, half - tickLength * 0.48);
        }
      }
      ctx.stroke();

      if (isNumber && length > 95) {
        this.drawTapeNumberLabel(
          ctx,
          String(i / numberEvery),
          x + tickStep * 0.18,
          tapeHeight * 0.14,
          -Math.PI / 2,
          tapeHeight,
          'rgba(254,243,199,0.96)',
          color
        );
      }
    }

    const rivetRadius = Math.max(1.2, tapeHeight * 0.08);
    [Math.min(length * 0.18, 24), Math.max(length - Math.min(length * 0.18, 24), 0)].forEach(x => {
      if (x <= 0 || x >= length) return;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(120,53,15,0.45)';
      ctx.arc(x, 0, rivetRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.arc(x - rivetRadius * 0.35, -rivetRadius * 0.35, rivetRadius * 0.36, 0, Math.PI * 2);
      ctx.fill();
    });

    this.drawStraightTapeEnds(ctx, length, tapeHeight, endOptions);

    ctx.restore();
  }

  drawCurvedMeasuringTapeLine(
    ctx,
    path,
    offsetX,
    offsetY,
    strokeWidth = 2,
    infos = null,
    totalLength = 0,
    tickSpacing = 1,
    { startCap = true, endCap = true } = {}
  ) {
    const fabricUtil = globalThis.fabric?.util;
    if (!fabricUtil?.getPathSegmentsInfo || !fabricUtil?.getPointOnPath || !Array.isArray(path)) {
      return;
    }

    const segmentInfo = infos || fabricUtil.getPathSegmentsInfo(path);
    const pathLength =
      totalLength || (segmentInfo.length ? segmentInfo[segmentInfo.length - 1].length : 0);
    if (!pathLength || pathLength < 1) return;

    const tapeHeight = Math.max(12, Math.min(30, Number(strokeWidth || 2) * 5));
    const sampleStep = Math.max(3, Math.min(8, tapeHeight * 0.35));
    const spacing = this.normalizeTapeTickSpacing(tickSpacing);
    const tickStep = Math.max(7, tapeHeight * 0.75 * spacing);
    const majorEvery = 5;
    const numberEvery = 10;

    const getCommandPoint = cmd => {
      if (!cmd || cmd.length < 3) return null;
      return { x: cmd[cmd.length - 2], y: cmd[cmd.length - 1] };
    };
    const startRaw = getCommandPoint(path[0]);
    const endRaw = getCommandPoint(path[path.length - 1]);
    const endpointIsOrigin =
      (startRaw && Math.hypot(startRaw.x, startRaw.y) < 0.5) ||
      (endRaw && Math.hypot(endRaw.x, endRaw.y) < 0.5);

    const pointAt = distance => {
      const clampedDistance = Math.max(0, Math.min(pathLength, distance));
      if (clampedDistance === 0 && startRaw) {
        return { x: startRaw.x - offsetX, y: startRaw.y - offsetY };
      }
      if (clampedDistance === pathLength && endRaw) {
        return { x: endRaw.x - offsetX, y: endRaw.y - offsetY };
      }

      const point = fabricUtil.getPointOnPath(path, clampedDistance, segmentInfo);
      if (!point) return null;

      // Fabric can report a synthetic {0,0} point for some path endpoints.
      // In object render space that becomes a huge negative offset, causing
      // a phantom tape segment to shoot toward the top-left of the canvas.
      if (!endpointIsOrigin && Math.hypot(point.x, point.y) < 0.5) {
        if (clampedDistance <= sampleStep && startRaw) {
          return { x: startRaw.x - offsetX, y: startRaw.y - offsetY };
        }
        if (pathLength - clampedDistance <= sampleStep && endRaw) {
          return { x: endRaw.x - offsetX, y: endRaw.y - offsetY };
        }
        return null;
      }

      return point ? { x: point.x - offsetX, y: point.y - offsetY } : null;
    };

    const samples = [];
    for (let d = 0; d <= pathLength; d += sampleStep) {
      const point = pointAt(d);
      const previous = samples[samples.length - 1];
      if (
        point &&
        (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) < sampleStep * 8)
      ) {
        samples.push(point);
      }
    }
    const finalPoint = pointAt(pathLength);
    const previous = samples[samples.length - 1];
    if (
      finalPoint &&
      (!previous ||
        Math.hypot(finalPoint.x - previous.x, finalPoint.y - previous.y) < sampleStep * 8)
    ) {
      samples.push(finalPoint);
    }
    if (samples.length < 2) return;

    const strokeSamples = (width, color, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(samples[0].x, samples[0].y);
      for (let i = 1; i < samples.length; i += 1) {
        ctx.lineTo(samples[i].x, samples[i].y);
      }
      ctx.stroke();
      ctx.restore();
    };

    strokeSamples(tapeHeight + 2.5, '#334155', 0.72);
    strokeSamples(tapeHeight, '#f8fafc', 1);
    strokeSamples(Math.max(2, tapeHeight * 0.34), 'rgba(255,255,255,0.92)', 1);
    strokeSamples(Math.max(1.2, tapeHeight * 0.1), 'rgba(148,163,184,0.55)', 1);

    const tickCount = Math.floor(pathLength / tickStep);
    for (let i = 0; i <= tickCount; i += 1) {
      const distance = Math.min(pathLength, i * tickStep);
      const center = pointAt(distance);
      const before = pointAt(distance - Math.max(2, tickStep * 0.18));
      const after = pointAt(distance + Math.max(2, tickStep * 0.18));
      if (!center || !before || !after) continue;

      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const isMajor = i % majorEvery === 0;
      const isNumber = i > 0 && i % numberEvery === 0;
      const tickLength = isMajor
        ? tapeHeight * 0.78
        : i % 2 === 0
          ? tapeHeight * 0.55
          : tapeHeight * 0.36;
      const color = isNumber ? '#dc2626' : '#111827';

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = isMajor
        ? Math.max(1.1, tapeHeight * 0.075)
        : Math.max(0.75, tapeHeight * 0.045);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(center.x - nx * tickLength * 0.5, center.y - ny * tickLength * 0.5);
      ctx.lineTo(center.x + nx * tickLength * 0.5, center.y + ny * tickLength * 0.5);
      ctx.stroke();
      ctx.restore();

      if (isNumber && pathLength > 130) {
        const angle = Math.atan2(dy, dx);
        this.drawTapeNumberLabel(
          ctx,
          String(i / numberEvery),
          center.x + nx * tapeHeight * 0.13,
          center.y + ny * tapeHeight * 0.13,
          angle,
          tapeHeight,
          'rgba(248,250,252,0.96)',
          color
        );
      }
    }

    const start = samples[0];
    const second = samples[Math.min(2, samples.length - 1)] || samples[1];
    const end = samples[samples.length - 1];
    const beforeEnd = samples[Math.max(0, samples.length - 3)] || samples[samples.length - 2];
    if (startCap && start && second) {
      this.drawCurvedTapeEndCap(
        ctx,
        start.x,
        start.y,
        Math.atan2(second.y - start.y, second.x - start.x),
        tapeHeight,
        true
      );
    }
    if (endCap && end && beforeEnd) {
      this.drawCurvedTapeEndCap(
        ctx,
        end.x,
        end.y,
        Math.atan2(end.y - beforeEnd.y, end.x - beforeEnd.x),
        tapeHeight,
        false
      );
    }
  }

  drawArrowhead(ctx, x, y, angle, size, style, color, spread = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    // ctx.lineWidth = 2; // Fixed outline width - User snippet sets this inside 'curved' style, but 'triangular' uses stroke() too.
    // Let's set a default or respect the snippet.
    // Snippet for 'curved' sets ctx.lineWidth = 2.
    // Snippet for 'triangular' calls ctx.stroke() but doesn't set width. Assuming inherited or default.
    // We'll set a default of 1 or 2 to be safe, or leave it to the caller?
    // The caller (attachArrowRendering) sets ctx.lineWidth = this.strokeWidth.
    // But we want the arrow outline to be independent?
    // The user snippet for 'curved' explicitly sets `ctx.lineWidth = 2`.
    // For 'triangular', it just says `ctx.stroke()`.
    // Let's set a sensible default for the outline if not specified.
    ctx.lineWidth = 1;

    const ARROW_TAN_30 = Math.tan(Math.PI / 6) * Math.max(0.5, Math.min(1.8, spread));

    if (style === 'triangular') {
      // Filled triangular arrowhead with thin outline
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * ARROW_TAN_30);
      ctx.lineTo(-size, size * ARROW_TAN_30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (style === 'filled') {
      // Solid filled triangular arrowhead (no outline)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * ARROW_TAN_30);
      ctx.lineTo(-size, size * ARROW_TAN_30);
      ctx.closePath();
      ctx.fill();
    } else if (style === 'curved') {
      // Curved arrowhead with fixed thickness
      const curveSize = size * 0.7;
      ctx.lineWidth = 2; // Fixed thickness for curved style
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-curveSize, -curveSize * 0.5, -size, -size * ARROW_TAN_30);
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-curveSize, curveSize * 0.5, -size, size * ARROW_TAN_30);
      ctx.stroke();
    } else if (style === 'open') {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * ARROW_TAN_30);
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, size * ARROW_TAN_30);
      ctx.stroke();
    } else if (style === 'hand-1' || style === 'hand-drawn') {
      ctx.lineWidth = 1.9;
      const t = size * ARROW_TAN_30;
      const wobble = Math.max(1.6, size * 0.16);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-size * 0.2, -t * 0.4 - wobble, -size * 0.98, -t * 1.08);
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-size * 0.25, t * 0.3 + wobble, -size * 1.05, t * 1.02);
      ctx.moveTo(-size * 0.35, -t * 0.1);
      ctx.quadraticCurveTo(-size * 0.65, -t * 0.6, -size * 1.08, -t * 0.86);
      ctx.moveTo(-size * 0.28, t * 0.16);
      ctx.quadraticCurveTo(-size * 0.62, t * 0.65, -size * 1.1, t * 0.9);
      ctx.stroke();
    } else if (style === 'hand-2') {
      ctx.lineWidth = 2.1;
      const t = size * ARROW_TAN_30;
      const wobble = Math.max(0.9, size * 0.08);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      // Draw as a single continuous stroke so the tip stays smooth at high zoom
      ctx.moveTo(-size * 1.02, -t * 0.98);
      ctx.bezierCurveTo(-size * 0.58, -t * 0.74, -size * 0.24, -t * 0.08 - wobble, 0, 0);
      ctx.bezierCurveTo(
        -size * 0.26,
        t * 0.1 + wobble,
        -size * 0.6,
        t * 0.76,
        -size * 1.04,
        t * 0.94
      );
      ctx.stroke();
    } else if (style === 'hand-3') {
      ctx.lineWidth = 1.7;
      const t = size * ARROW_TAN_30;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size * 0.94, -t * 1.02);
      ctx.moveTo(-size * 0.16, -t * 0.2);
      ctx.lineTo(-size * 1.06, -t * 0.86);
      ctx.moveTo(0, 0);
      ctx.lineTo(-size * 1.02, t * 0.96);
      ctx.moveTo(-size * 0.2, t * 0.22);
      ctx.lineTo(-size * 1.08, t * 0.9);
      ctx.stroke();
    } else if (style === 'dimension') {
      ctx.lineWidth = 2;
      const t = size * ARROW_TAN_30;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -t);
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, t);
      ctx.stroke();
    } else {
      // Default fallback (triangular)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * ARROW_TAN_30);
      ctx.lineTo(-size, size * ARROW_TAN_30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}
