// Tag Manager
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Creates draggable, resizable tag objects that connect to strokes
import { StrokeMetadataManager } from './StrokeMetadataManager.js';
import { PathUtils } from './utils/PathUtils.js';

export class TagManager {
  constructor(canvasManager, metadataManager) {
    this.canvasManager = canvasManager;
    this.metadataManager = metadataManager;
    this.tagObjects = new Map(); // Map<viewId::strokeLabel, fabricObject>
    this.tagSize = 34; // Default tag font size
    this.tagShape = 'square'; // 'square' or 'circle'
    this.tagMode = 'letters+numbers'; // 'letters' or 'letters+numbers'
    this.tagBackgroundStyle = 'solid'; // 'solid', 'no-fill', 'clear-black', 'clear-color', 'clear-white'
    this.strokeColor = '#3b82f6'; // Default stroke color for clear-color style
    this.connectorColor = '#ffffff';
    this.connectorMatchesLine = true;
    this.customTagColors = null;
    this.tagStyleConfig = this.createDefaultTagStyleConfig();
    this.selectedStyleTagKeys = new Set();
    this.isSyncingSelectedStyleTargetsToCanvas = false;
    this.tagSizeMin = 8;
    this.tagSizeMax = 72;

    this.syncTagStyleConfigFromMetadata();
    this.syncTagSizeFromMetadata();

    // Initialize showMeasurements to visible by default; sync checkbox state if present
    const showMeasurementsCheckbox = document.getElementById('toggleShowMeasurements');
    this.showMeasurements = true;
    if (showMeasurementsCheckbox) {
      showMeasurementsCheckbox.checked = true;
    }

    // Initialize tag prediction system integration
    this.initTagPrediction();
  }

  normalizeImageLabel(imageLabel) {
    const baseLabel = imageLabel || window.app?.projectManager?.currentViewId || 'front';
    if (typeof baseLabel !== 'string') return baseLabel;
    if (baseLabel.includes('::tab:')) return baseLabel;
    if (typeof this.metadataManager?.normalizeImageLabel === 'function') {
      return this.metadataManager.normalizeImageLabel(baseLabel);
    }
    if (typeof window.getCaptureTabScopedLabel === 'function') {
      return window.getCaptureTabScopedLabel(baseLabel) || baseLabel;
    }
    return baseLabel;
  }

  getTagKey(strokeLabel, imageLabel) {
    const viewId = this.normalizeImageLabel(imageLabel);
    return `${viewId}::${strokeLabel}`;
  }

  resolveTagKey(strokeLabel, imageLabel) {
    if (typeof strokeLabel === 'string' && strokeLabel.includes('::')) {
      return strokeLabel;
    }
    const preferredKey = this.getTagKey(strokeLabel, imageLabel);
    if (this.tagObjects.has(preferredKey)) return preferredKey;

    const viewId = this.normalizeImageLabel(imageLabel);
    for (const [key, tagObj] of this.tagObjects.entries()) {
      if (!tagObj) continue;
      if (tagObj.strokeLabel !== strokeLabel) continue;
      const tagScope = tagObj.scopedLabel || tagObj.imageLabel;
      if (viewId && tagScope && tagScope !== viewId && tagObj.imageLabel !== viewId) continue;
      return key;
    }

    return null;
  }

  getTagObject(strokeLabel, imageLabel) {
    const key = this.resolveTagKey(strokeLabel, imageLabel);
    if (!key) return null;
    const tagObj = this.tagObjects.get(key);
    if (!tagObj) return null;
    return { key, tagObj };
  }

  // Get canvas reference dynamically (may not be available at construction time)
  get canvas() {
    return this.canvasManager?.fabricCanvas || null;
  }

  initTagPrediction() {
    // Get initial tag mode from UI
    const tagModeToggle = document.getElementById('tagModeToggle');
    if (tagModeToggle) {
      this.tagMode = tagModeToggle.textContent.includes('Letters Only')
        ? 'letters'
        : 'letters+numbers';
    }

    // Listen for tag mode changes
    if (tagModeToggle) {
      tagModeToggle.addEventListener('click', () => {
        this.tagMode = this.tagMode === 'letters' ? 'letters+numbers' : 'letters';
        this.updateAllTags();
      });
    }

    // Listen for tag size changes
    const increaseBtn = document.getElementById('increaseAllTagSize');
    const decreaseBtn = document.getElementById('decreaseAllTagSize');
    if (increaseBtn) {
      increaseBtn.addEventListener('click', () => {
        this.tagSize = this.normalizeTagSize(this.tagSize + 2);
        this.updateTagSize();
      });
    }
    if (decreaseBtn) {
      decreaseBtn.addEventListener('click', () => {
        this.tagSize = this.normalizeTagSize(this.tagSize - 2);
        this.updateTagSize();
      });
    }

    // Tag shape toggle is wired from toolbar UI modules.
    // Keep TagManager free of direct DOM listeners to avoid duplicate toggles.
  }

  getViewScopes(viewId) {
    const base = this.normalizeImageLabel(
      viewId || window.app?.projectManager?.currentViewId || 'front'
    );
    const keys = Object.keys(this.metadataManager?.vectorStrokesByImage || {});
    const scopes = keys.filter(key => {
      if (key.startsWith('__guide__:')) return false;
      return key === base || key.startsWith(`${base}::tab:`);
    });
    return scopes.length ? scopes : [base];
  }

  setTagShape(shape, imageLabel) {
    const next = shape === 'circle' ? 'circle' : 'square';
    if (this.tagShape === next) return;
    this.tagShape = next;
    this.updateAllTags(imageLabel);
  }

  // Get next tag from prediction system
  getNextTag(imageLabel) {
    // Use the tag prediction system from index.html
    if (window.calculateNextTag) {
      const tag = window.calculateNextTag();
      if (tag && this.isValidTag(tag)) {
        return tag;
      }
    }

    // Fallback: check nextTagDisplay directly
    const nextTagDisplay = document.getElementById('nextTagDisplay');
    if (nextTagDisplay) {
      const tag = nextTagDisplay.textContent.trim().toUpperCase();
      if (tag && this.isValidTag(tag)) {
        return tag;
      }
    }

    // Final fallback to metadata manager's prediction
    return this.metadataManager.getNextLabel(imageLabel, this.tagMode);
  }

  isValidTag(tag) {
    if (this.tagMode === 'letters') {
      return /^[A-Z]$/.test(tag);
    } else {
      return /^[A-Z]\d+$/.test(tag);
    }
  }

  createDefaultTagStyleConfig() {
    return {
      presets: {
        lettersOnly: null,
        lettersNumbers: null,
        highlight: null,
      },
      perTagThemes: {},
      highlightedTagKeys: new Set(),
    };
  }

  cloneTagTheme(theme) {
    if (!theme) return null;
    return {
      background: theme.background,
      border: theme.border,
      text: theme.text,
    };
  }

  getDefaultTagTheme() {
    return {
      background: '#ffffff',
      border: '#000000',
      text: '#000000',
    };
  }

  getDefaultHighlightTheme() {
    return {
      background: '#fef3c7',
      border: '#f59e0b',
      text: '#92400e',
    };
  }

  normalizeTagTheme(theme) {
    if (!theme || typeof theme !== 'object') return null;
    const background = this.normalizeThemeColor(theme.background);
    const border = this.normalizeThemeColor(theme.border);
    const text = this.normalizeThemeColor(theme.text);
    if (!background || !border || !text) return null;
    return { background, border, text };
  }

  normalizeTagStyleTarget(target) {
    return ['lettersOnly', 'lettersNumbers', 'highlight'].includes(target)
      ? target
      : 'lettersNumbers';
  }

  normalizeTagStyleConfig(config) {
    const source = config && typeof config === 'object' ? config : {};
    const presets = source.presets && typeof source.presets === 'object' ? source.presets : {};
    const highlightedTagKeys = Array.isArray(source.highlightedTagKeys)
      ? source.highlightedTagKeys.map(value => String(value || '').trim()).filter(Boolean)
      : source.highlightedTagKeys instanceof Set
        ? Array.from(source.highlightedTagKeys as Set<string>)
            .map(value => (value || '').trim())
            .filter(Boolean)
        : [];

    return {
      presets: {
        lettersOnly: this.normalizeTagTheme(presets.lettersOnly),
        lettersNumbers: this.normalizeTagTheme(presets.lettersNumbers),
        highlight: this.normalizeTagTheme(presets.highlight),
      },
      perTagThemes: Object.entries(
        source.perTagThemes && typeof source.perTagThemes === 'object' ? source.perTagThemes : {}
      ).reduce((acc, [key, value]) => {
        const normalizedKey = (key || '').trim();
        const normalizedTheme = this.normalizeTagTheme(value);
        if (normalizedKey && normalizedTheme) {
          acc[normalizedKey] = normalizedTheme;
        }
        return acc;
      }, {}),
      highlightedTagKeys: new Set(highlightedTagKeys),
    };
  }

  serializeTagStyleConfig() {
    const config = this.tagStyleConfig || this.createDefaultTagStyleConfig();
    return {
      presets: {
        lettersOnly: this.cloneTagTheme(config.presets?.lettersOnly),
        lettersNumbers: this.cloneTagTheme(config.presets?.lettersNumbers),
        highlight: this.cloneTagTheme(config.presets?.highlight),
      },
      perTagThemes: Object.keys(config.perTagThemes || {})
        .sort()
        .reduce((acc, key) => {
          const theme = this.cloneTagTheme(config.perTagThemes?.[key]);
          if (theme) {
            acc[key] = theme;
          }
          return acc;
        }, {}),
      highlightedTagKeys: Array.from(config.highlightedTagKeys || []).sort(),
    };
  }

  syncTagStyleConfigFromMetadata() {
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const nextConfig =
      metadata?.tagStyleConfig && typeof metadata.tagStyleConfig === 'object'
        ? this.normalizeTagStyleConfig(metadata.tagStyleConfig)
        : null;
    const legacyTheme = this.normalizeTagTheme(metadata?.tagColorTheme);

    if (nextConfig) {
      this.tagStyleConfig = nextConfig;
    } else if (legacyTheme) {
      this.tagStyleConfig = {
        presets: {
          lettersOnly: this.cloneTagTheme(legacyTheme),
          lettersNumbers: this.cloneTagTheme(legacyTheme),
          highlight: null,
        },
        perTagThemes: {},
        highlightedTagKeys: new Set(),
      };
    } else {
      this.tagStyleConfig = this.createDefaultTagStyleConfig();
    }

    this.customTagColors =
      this.cloneTagTheme(this.tagStyleConfig.presets.lettersNumbers) ||
      this.cloneTagTheme(this.tagStyleConfig.presets.lettersOnly);
  }

  persistTagStyleConfigToMetadata() {
    const payload = this.serializeTagStyleConfig();
    if (window.app?.projectManager?.setProjectMetadata) {
      window.app.projectManager.setProjectMetadata({ tagStyleConfig: payload });
      return;
    }
    window.projectMetadata = {
      ...(window.projectMetadata || {}),
      tagStyleConfig: payload,
    };
  }

  hasCustomTagStyles() {
    const config = this.tagStyleConfig || this.createDefaultTagStyleConfig();
    return Boolean(
      config.presets?.lettersOnly ||
        config.presets?.lettersNumbers ||
        config.presets?.highlight ||
        Object.keys(config.perTagThemes || {}).length ||
        config.highlightedTagKeys?.size
    );
  }

  getTagStyleConfigSnapshot() {
    return this.serializeTagStyleConfig();
  }

  isLettersOnlyTag(strokeLabel) {
    return /^[A-Z]$/.test(
      String(strokeLabel || '')
        .trim()
        .toUpperCase()
    );
  }

  isLettersNumbersTag(strokeLabel) {
    return /^[A-Z]\d+$/.test(
      String(strokeLabel || '')
        .trim()
        .toUpperCase()
    );
  }

  isTagHighlighted(strokeLabel, imageLabel) {
    const tagKey = this.getTagKey(strokeLabel, imageLabel);
    return Boolean(this.tagStyleConfig?.highlightedTagKeys?.has(tagKey));
  }

  getTagThemeOverride(strokeLabel, imageLabel) {
    const tagKey = this.getTagKey(strokeLabel, imageLabel);
    const override = this.tagStyleConfig?.perTagThemes?.[tagKey];
    return override ? this.cloneTagTheme(override) : null;
  }

  hasTagThemeOverride(strokeLabel, imageLabel) {
    return Boolean(this.getTagThemeOverride(strokeLabel, imageLabel));
  }

  emitTagStyleStateChanged(imageLabel) {
    const viewId = this.normalizeImageLabel(imageLabel);
    if (typeof this.metadataManager?.updateStrokeVisibilityControls === 'function') {
      this.metadataManager.updateStrokeVisibilityControls();
    }
    if (typeof window?.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
      window.dispatchEvent(
        new window.CustomEvent('openpaint:tag-style-state-changed', {
          detail: { imageLabel: viewId },
        })
      );
    }
  }

  getSelectedStyleTargetLabels(imageLabel) {
    const viewId = this.normalizeImageLabel(imageLabel);
    return Array.from(this.selectedStyleTagKeys || [])
      .filter(key => key.startsWith(`${viewId}::`))
      .map(key => key.slice(`${viewId}::`.length))
      .sort((left, right) =>
        String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      );
  }

  getSelectedStyleTargetKeys(imageLabel) {
    const viewId = this.normalizeImageLabel(imageLabel);
    return Array.from(this.selectedStyleTagKeys || [])
      .filter(key => key.startsWith(`${viewId}::`))
      .sort((left, right) =>
        String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      );
  }

  isSelectedStyleTarget(strokeLabel, imageLabel) {
    const tagKey = this.getTagKey(strokeLabel, imageLabel);
    return this.selectedStyleTagKeys.has(tagKey);
  }

  setSelectedStyleTarget(strokeLabel, imageLabel, selected = true, options = {}) {
    const normalizedLabel = String(strokeLabel || '').trim();
    if (!normalizedLabel) return false;
    const viewId = this.normalizeImageLabel(imageLabel);
    const tagKey = this.getTagKey(normalizedLabel, viewId);
    if (selected) {
      this.selectedStyleTagKeys.add(tagKey);
    } else {
      this.selectedStyleTagKeys.delete(tagKey);
    }
    if (options.syncCanvas === true) {
      this.syncSelectedStyleTargetsToCanvas(viewId);
    }
    if (options.emitChange !== false) {
      this.emitTagStyleStateChanged(viewId);
    }
    return selected;
  }

  toggleSelectedStyleTarget(strokeLabel, imageLabel, options = {}) {
    const nextSelected = !this.isSelectedStyleTarget(strokeLabel, imageLabel);
    this.setSelectedStyleTarget(strokeLabel, imageLabel, nextSelected, options);
    return nextSelected;
  }

  replaceSelectedStyleTargets(strokeLabels, imageLabel, options = {}) {
    const viewId = this.normalizeImageLabel(imageLabel);
    Array.from(this.selectedStyleTagKeys || []).forEach(key => {
      if (key.startsWith(`${viewId}::`)) {
        this.selectedStyleTagKeys.delete(key);
      }
    });

    (Array.isArray(strokeLabels) ? strokeLabels : []).forEach(strokeLabel => {
      this.setSelectedStyleTarget(strokeLabel, viewId, true, {
        syncCanvas: false,
        emitChange: false,
      });
    });

    const labels = this.getSelectedStyleTargetLabels(viewId);
    if (options.syncCanvas === true) {
      this.syncSelectedStyleTargetsToCanvas(viewId);
    }
    if (options.emitChange !== false) {
      this.emitTagStyleStateChanged(viewId);
    }
    return labels;
  }

  syncSelectedStyleTargetsToCanvas(imageLabel) {
    const canvas = this.canvas;
    const viewId = this.normalizeImageLabel(imageLabel);
    if (!canvas || !viewId || this.isSyncingSelectedStyleTargetsToCanvas) return [];

    const labels = this.getSelectedStyleTargetLabels(viewId);
    const strokesByImage = this.metadataManager?.vectorStrokesByImage?.[viewId] || {};
    const targetObjects = labels
      .map(label => strokesByImage?.[label])
      .filter(obj => obj && obj.canvas === canvas && obj.visible !== false);

    this.isSyncingSelectedStyleTargetsToCanvas = true;
    window.__openpaintSuppressMeasurementFocus = true;
    try {
      canvas.discardActiveObject();

      if (targetObjects.length === 1) {
        canvas.setActiveObject(targetObjects[0]);
      } else if (targetObjects.length > 1 && typeof fabric?.ActiveSelection === 'function') {
        const selection = new fabric.ActiveSelection(targetObjects, { canvas });
        canvas.setActiveObject(selection);
      }

      canvas.requestRenderAll();
    } finally {
      this.isSyncingSelectedStyleTargetsToCanvas = false;
      window.setTimeout(() => {
        window.__openpaintSuppressMeasurementFocus = false;
      }, 0);
    }
    return labels;
  }

  getTagStyleTheme(target) {
    const normalizedTarget = this.normalizeTagStyleTarget(target);
    const preset = this.tagStyleConfig?.presets?.[normalizedTarget];
    if (preset) {
      return this.cloneTagTheme(preset);
    }
    return normalizedTarget === 'highlight'
      ? this.getDefaultHighlightTheme()
      : this.getDefaultTagTheme();
  }

  getTagPalette(strokeLabel, orientation = 'horizontal', imageLabel) {
    if (!this.tagStyleConfig) {
      this.syncTagStyleConfigFromMetadata();
    }

    const overrideTheme = this.getTagThemeOverride(strokeLabel, imageLabel);
    if (overrideTheme) {
      return {
        bg: overrideTheme.background,
        stroke: overrideTheme.border,
        text: overrideTheme.text,
      };
    }

    if (this.isTagHighlighted(strokeLabel, imageLabel)) {
      const highlightTheme = this.getTagStyleTheme('highlight');
      return {
        bg: highlightTheme.background,
        stroke: highlightTheme.border,
        text: highlightTheme.text,
      };
    }

    let target = null;
    if (this.isLettersOnlyTag(strokeLabel)) {
      target = 'lettersOnly';
    } else if (this.isLettersNumbersTag(strokeLabel)) {
      target = 'lettersNumbers';
    }

    const theme = target ? this.getTagStyleTheme(target) : this.getDefaultTagTheme();
    return {
      bg: theme.background,
      stroke: theme.border,
      text: theme.text,
    };
  }

  getStrokeOrientation(strokeObject) {
    if (!strokeObject) return 'horizontal';

    if (
      typeof strokeObject.x1 === 'number' &&
      typeof strokeObject.x2 === 'number' &&
      typeof strokeObject.y1 === 'number' &&
      typeof strokeObject.y2 === 'number'
    ) {
      const dx = Math.abs(strokeObject.x2 - strokeObject.x1);
      const dy = Math.abs(strokeObject.y2 - strokeObject.y1);
      return dy > dx ? 'vertical' : 'horizontal';
    }

    if (typeof strokeObject.getBoundingRect === 'function') {
      const bounds = strokeObject.getBoundingRect();
      if (bounds && typeof bounds.width === 'number' && typeof bounds.height === 'number') {
        return bounds.height > bounds.width ? 'vertical' : 'horizontal';
      }
    }

    return 'horizontal';
  }

  isRenderableStrokeObject(strokeObject) {
    return Boolean(strokeObject && typeof strokeObject.getBoundingRect === 'function');
  }

  getCanvasObjectCenter(obj) {
    if (!obj) return null;
    try {
      if (obj.group && typeof obj.getCenterPoint === 'function' && fabric?.util?.transformPoint) {
        const centerRelative = obj.getCenterPoint();
        const groupMatrix = obj.group.calcTransformMatrix();
        return fabric.util.transformPoint(centerRelative, groupMatrix);
      }
      if (typeof obj.getCenterPoint === 'function') {
        return obj.getCenterPoint();
      }
      if (typeof obj.getBoundingRect === 'function') {
        const bounds = obj.getBoundingRect(true, true);
        return {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  getTagScopeLabel(tagObj) {
    return tagObj?.scopedLabel || tagObj?.imageLabel || null;
  }

  // Create a draggable, resizable tag object
  createTag(strokeLabel, imageLabel, strokeObject) {
    imageLabel = this.normalizeImageLabel(imageLabel);
    this.syncTagSizeFromMetadata(imageLabel);
    // Ensure canvas is available
    const canvas = this.canvas;
    if (!canvas) {
      console.warn('TagManager: Canvas not available, cannot create tag');
      return null;
    }

    if (!this.isRenderableStrokeObject(strokeObject)) {
      console.warn('[TagManager] Skipping tag creation for non-renderable stroke object', {
        strokeLabel,
        imageLabel,
      });
      return null;
    }

    // Remove existing tag if any, but keep style state when rebuilding the tag.
    this.removeTag(strokeLabel, imageLabel, { preserveStyleState: true });

    // Get tag position in canvas/world coordinates. Avoid viewport-sensitive
    // bounding boxes here; tags are rebuilt during view switches before the
    // final viewport/frame restore has always settled.
    const strokeCenter = this.getCanvasObjectCenter(strokeObject);
    if (!strokeCenter) {
      console.warn('[TagManager] Skipping tag creation because stroke center could not resolve', {
        strokeLabel,
        imageLabel,
      });
      return null;
    }
    const centerX = strokeCenter.x;
    const centerY = strokeCenter.y;

    // Create tag text (editable IText)
    let tagText;
    try {
      // Text positioned at (0, 0) relative to group center
      tagText = new fabric.IText(strokeLabel, {
        left: 0,
        top: 0,
        fontSize: this.tagSize,
        fill: '#000000',
        fontFamily: 'Arial',
        textAlign: 'center',
        originX: 'center',
        originY: 'center',
        // Centered tags render cleanly with a middle baseline and avoid canvas warnings.
        textBaseline: 'middle',
        selectable: false, // Will be controlled by group
        evented: true, // Allow editing
        hasControls: false, // Controlled by group
        hasBorders: false, // Controlled by group
        excludeFromExport: true, // Don't save tags to canvas JSON
        isTagText: true,
      });
    } catch (e) {
      console.error('TagManager: Error creating text object', e);
      // Fallback to the same centered baseline used by the primary tag text.
      tagText = new fabric.Text(strokeLabel, {
        fontSize: this.tagSize,
        textBaseline: 'middle',
      });
    }
    tagText.styles = {};

    // Allow editing tag text (double-click to edit)
    tagText.on('editing:entered', () => {
      // When editing starts, select all text
      tagText.selectAll();
    });

    tagText.on('editing:exited', () => {
      const newLabel = tagText.text.trim().toUpperCase();
      if (newLabel && this.isValidTag(newLabel)) {
        // Update stroke label if valid
        // Note: This would require updating metadata, which is complex
        // For now, just update the display
        console.log(`Tag text changed to: ${newLabel}`);
      } else {
        // Restore original if invalid
        tagText.set('text', strokeLabel);
      }
    });

    // Create background shape
    // Wait for text to measure properly
    const padding = 4;
    const textWidth = Math.max(tagText.width || 30, strokeLabel.length * (this.tagSize * 0.6));
    const textHeight = tagText.height || this.tagSize;

    let background;
    let width = textWidth + padding * 2;
    const height = textHeight + padding * 2;

    // Square mode keeps a rounded-rectangle profile.
    // Circle mode uses full rounding.
    if (this.tagShape === 'square') {
      width = Math.max(width, height);
    }

    let radius;
    if (this.tagShape === 'circle') {
      radius = height / 2;
    } else {
      radius = 4;
    }

    // Determine background style properties
    const orientation = this.getStrokeOrientation(strokeObject);
    const palette = this.getTagPalette(strokeLabel, orientation, imageLabel);
    let bgFill = palette.bg;
    let bgStroke = palette.stroke;
    let bgStrokeWidth = 2;
    let textFill = palette.text;

    if (this.tagBackgroundStyle === 'no-fill') {
      bgFill = 'transparent';
      bgStroke = 'transparent';
      bgStrokeWidth = 0;
      textFill = this.strokeColor || '#3b82f6';
    } else if (this.tagBackgroundStyle === 'clear-black') {
      bgFill = 'transparent';
      bgStroke = '#000000';
      bgStrokeWidth = 2;
      textFill = '#000000';
    } else if (this.tagBackgroundStyle === 'clear-color') {
      bgFill = 'transparent';
      bgStroke = this.strokeColor || '#3b82f6';
      bgStrokeWidth = 2;
      textFill = this.strokeColor || '#3b82f6';
    } else if (this.tagBackgroundStyle === 'clear-white') {
      bgFill = 'transparent';
      bgStroke = '#ffffff';
      bgStrokeWidth = 2;
      textFill = '#ffffff';
    }
    // 'solid' style uses defaults

    background = new fabric.Rect({
      left: 0,
      top: 0,
      width: width,
      height: height,
      rx: radius, // Horizontal radius for rounded corners
      ry: radius, // Vertical radius for rounded corners
      fill: bgFill,
      stroke: bgStroke,
      strokeWidth: bgStrokeWidth,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: true,
      excludeFromExport: true, // Don't save tag backgrounds to canvas JSON
      isTagBackground: true,
    });

    // Update text color based on background style
    tagText.set('fill', textFill);

    // Group tag text and background
    // Position group at stroke center + offset
    const initialOffset = strokeObject?.tagOffset || { x: 20, y: -10 };

    // For multi-frame support: set both imageLabel (base) and scopedLabel (with ::tab:)
    const baseImageLabel = imageLabel.includes('::tab:')
      ? imageLabel.split('::tab:')[0]
      : imageLabel;
    const scopedLabel = imageLabel; // Full scope (includes ::tab: if present)

    const tagGroup = new fabric.Group([background, tagText], {
      left: centerX + initialOffset.x,
      top: centerY + initialOffset.y,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: false,
      lockRotation: true,
      hoverCursor: 'move',
      perPixelTargetFind: false,
      excludeFromExport: true, // Don't serialize tags - they're recreated from stroke metadata
      // Custom properties
      isTag: true,
      isTagGroup: true, // Mark as a tag group for filtering
      strokeLabel: strokeLabel,
      imageLabel: baseImageLabel, // Base view label (e.g., "cushion")
      scopedLabel: scopedLabel, // Full scope including tab (e.g., "cushion::tab:abc123")
      connectedStroke: strokeObject,
      tagOffset: { x: initialOffset.x, y: initialOffset.y }, // Default offset
    });

    if (strokeObject) {
      strokeObject.tagOffset = { x: initialOffset.x, y: initialOffset.y };
    }

    const scopedImageLabel = this.normalizeImageLabel(imageLabel);
    const scopedStrokeVisibility =
      this.metadataManager?.strokeVisibilityByImage?.[scopedImageLabel] || {};
    const scopedLabelVisibility =
      this.metadataManager?.strokeLabelVisibility?.[scopedImageLabel] || {};
    const tagVisible =
      scopedStrokeVisibility[strokeLabel] !== false && scopedLabelVisibility[strokeLabel] !== false;
    tagGroup.set({
      visible: tagVisible,
      evented: tagVisible,
      selectable: tagVisible,
    });

    // Update connector line when tag moves
    tagGroup.on('moving', () => {
      // Update offset based on new position
      const strokeCenter = this.getCanvasObjectCenter(strokeObject);
      if (!strokeCenter) return;

      tagGroup.tagOffset = {
        x: tagGroup.left - strokeCenter.x,
        y: tagGroup.top - strokeCenter.y,
      };

      if (strokeObject) {
        strokeObject.tagOffset = {
          x: tagGroup.tagOffset.x,
          y: tagGroup.tagOffset.y,
        };
      }

      this.updateConnector(strokeLabel, scopedImageLabel);
    });

    tagGroup.on('modified', () => {
      this.updateConnector(strokeLabel, scopedImageLabel);
      if (window.app?.historyManager?.saveState) {
        window.app.historyManager.saveState({ force: true, reason: 'tag:modified' });
      }
    });

    // Update connector when connected stroke moves
    if (strokeObject) {
      strokeObject.on('moving', () => {
        this.updateConnector(strokeLabel, scopedImageLabel, { repositionTag: true });
      });
      strokeObject.on('modified', () => {
        this.updateConnector(strokeLabel, scopedImageLabel, { repositionTag: true });
      });
      strokeObject.on('scaling', () => {
        this.updateConnector(strokeLabel, scopedImageLabel, { repositionTag: true });
      });
      strokeObject.on('rotating', () => {
        this.updateConnector(strokeLabel, scopedImageLabel, { repositionTag: true });
      });
    }

    // Click on tag to focus measurement input in sidebar
    // Use both fabric mouse:down and native mousedown for better compatibility
    tagGroup.on('mouse:down', e => {
      // Only if not already editing the text
      if (!tagText.isEditing) {
        // Select the connected stroke
        if (strokeObject && canvas) {
          canvas.setActiveObject(strokeObject);
          canvas.requestRenderAll();
        }

        if (this.metadataManager && this.metadataManager.focusMeasurementInput) {
          this.metadataManager.focusMeasurementInput(strokeLabel);
        }
      }
    });

    canvas.add(tagGroup);
    tagGroup.strokeLabel = strokeLabel;
    tagGroup.imageLabel = baseImageLabel;
    tagGroup.scopedLabel = scopedLabel;
    this.tagObjects.set(this.getTagKey(strokeLabel, imageLabel), tagGroup);

    // Update tag text to include measurement if showMeasurements is enabled
    this.updateTagText(strokeLabel, scopedImageLabel);

    // Register global click handler for tags (fallback if object events don't fire)
    // This ensures clicks work even when drawing tools are active
    if (!this._globalTagClickHandlerRegistered) {
      canvas.on('mouse:down', options => {
        const target = options.target;
        if (target && target.isTag) {
          const strokeLabel = target.strokeLabel;
          const textObj = target.getObjects().find(obj => obj.isTagText);

          // Select the connected stroke
          if (target.connectedStroke) {
            canvas.setActiveObject(target.connectedStroke);
            canvas.requestRenderAll();
          }

          // Only focus if not editing the text inline
          if (textObj && !textObj.isEditing) {
            if (this.metadataManager?.focusMeasurementInput) {
              this.metadataManager.focusMeasurementInput(strokeLabel);
            }
          }
        }
      });
      this._globalTagClickHandlerRegistered = true;
    }

    // Create connector line
    this.updateConnector(strokeLabel, scopedImageLabel);

    return tagGroup;
  }

  // Get the closest point on the actual stroke geometry to a given point
  getClosestStrokeEndpoint(strokeObj, targetPoint) {
    const isFinitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
    const projectPointToSegment = (p, a, b) => {
      if (!isFinitePoint(p) || !isFinitePoint(a) || !isFinitePoint(b)) return null;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const ab2 = abx * abx + aby * aby;
      if (ab2 <= 0) return { x: a.x, y: a.y };
      const apx = p.x - a.x;
      const apy = p.y - a.y;
      let t = (apx * abx + apy * aby) / ab2;
      t = Math.max(0, Math.min(1, t));
      return {
        x: a.x + abx * t,
        y: a.y + aby * t,
      };
    };

    // Arrow groups from MOS import can yield double-transformed points in generic helpers.
    // Resolve from child-line geometry first, with a dual-matrix sanity check.
    if (
      strokeObj?.type === 'group' &&
      strokeObj?.isArrow &&
      typeof strokeObj.getObjects === 'function'
    ) {
      const lineObj = strokeObj.getObjects().find(obj => obj?.type === 'line');
      if (lineObj && typeof lineObj.calcLinePoints === 'function' && fabric?.util?.transformPoint) {
        try {
          const pts = lineObj.calcLinePoints();
          const lineMatrix = lineObj.calcTransformMatrix();
          const groupMatrix = strokeObj.calcTransformMatrix?.();

          // Candidate A: line local -> line matrix
          const a1 = fabric.util.transformPoint({ x: pts.x1, y: pts.y1 }, lineMatrix);
          const a2 = fabric.util.transformPoint({ x: pts.x2, y: pts.y2 }, lineMatrix);

          // Candidate B: line local -> line matrix -> group matrix
          const b1 = groupMatrix ? fabric.util.transformPoint(a1, groupMatrix) : null;
          const b2 = groupMatrix ? fabric.util.transformPoint(a2, groupMatrix) : null;

          const pickClosestProjection = (p1, p2) => {
            if (!isFinitePoint(p1) || !isFinitePoint(p2)) return null;
            return projectPointToSegment(targetPoint, p1, p2);
          };

          const nearA = pickClosestProjection(a1, a2);
          const nearB = pickClosestProjection(b1, b2);

          if (nearA && nearB) {
            const dA = this.calculateDistance(targetPoint, nearA);
            const dB = this.calculateDistance(targetPoint, nearB);
            return dA <= dB ? nearA : nearB;
          }
          if (nearA) return nearA;
          if (nearB) return nearB;
        } catch {
          // continue to generic path below
        }
      }
    }

    try {
      const point = PathUtils.getClosestStrokeEndpoint(strokeObj, targetPoint);
      if (isFinitePoint(point)) {
        return point;
      }
    } catch {
      // Fall through to robust local fallbacks below.
    }

    // Fallback for arrow groups: derive endpoint from child line geometry.
    if (strokeObj?.type === 'group' && typeof strokeObj.getObjects === 'function') {
      const lineObj = strokeObj.getObjects().find(obj => obj?.type === 'line');
      if (lineObj && typeof lineObj.calcLinePoints === 'function' && fabric?.util?.transformPoint) {
        try {
          const pts = lineObj.calcLinePoints();
          const lineMatrix = lineObj.calcTransformMatrix();
          const groupMatrix = strokeObj.calcTransformMatrix();
          const p1Local = fabric.util.transformPoint({ x: pts.x1, y: pts.y1 }, lineMatrix);
          const p2Local = fabric.util.transformPoint({ x: pts.x2, y: pts.y2 }, lineMatrix);
          const p1 = fabric.util.transformPoint(p1Local, groupMatrix);
          const p2 = fabric.util.transformPoint(p2Local, groupMatrix);
          if (isFinitePoint(p1) && isFinitePoint(p2)) {
            const d1 = this.calculateDistance(targetPoint, p1);
            const d2 = this.calculateDistance(targetPoint, p2);
            return d1 <= d2 ? p1 : p2;
          }
        } catch {
          // continue to center fallback
        }
      }
    }

    const center =
      typeof strokeObj?.getCenterPoint === 'function' ? strokeObj.getCenterPoint() : null;
    if (isFinitePoint(center)) {
      return center;
    }

    return {
      x: Number.isFinite(targetPoint?.x) ? targetPoint.x : 0,
      y: Number.isFinite(targetPoint?.y) ? targetPoint.y : 0,
    };
  }

  // Find closest point on a line to target point
  getClosestPointOnLine(lineObj, targetPoint) {
    return PathUtils.getClosestPointOnLine(lineObj, targetPoint);
  }

  // Find closest point on a line within a group (for arrows)
  getClosestPointOnGroupLine(groupObj, lineObj, targetPoint) {
    return PathUtils.getClosestPointOnGroupLine(groupObj, lineObj, targetPoint);
  }

  // Find closest point on a path (curves, freehand drawings)
  getClosestPointOnPath(pathObj, targetPoint) {
    return PathUtils.getClosestPointOnPath(pathObj, targetPoint);
  }

  // Find closest point from an array of points
  getClosestPointFromArray(points, targetPoint) {
    return PathUtils.getClosestPointFromArray(points, targetPoint);
  }

  // Sample points along an SVG path
  samplePathPoints(pathObj, numSamples = 30) {
    return PathUtils.samplePathPoints(pathObj, numSamples);
  }

  // Sample points along a line
  sampleLine(p0, p1, numSamples = 5) {
    return PathUtils.sampleLine(p0, p1, numSamples);
  }

  // Sample points along a cubic Bezier curve
  sampleCubicBezier(p0, cp1, cp2, p1, numSamples = 10) {
    return PathUtils.sampleCubicBezier(p0, cp1, cp2, p1, numSamples);
  }

  // Calculate point on cubic Bezier curve at parameter t (0 to 1)
  cubicBezierPoint(p0, cp1, cp2, p1, t) {
    return PathUtils.cubicBezierPoint(p0, cp1, cp2, p1, t);
  }

  // Sample points along a quadratic Bezier curve
  sampleQuadraticBezier(p0, cp, p1, numSamples = 10) {
    return PathUtils.sampleQuadraticBezier(p0, cp, p1, numSamples);
  }

  // Calculate point on quadratic Bezier curve at parameter t (0 to 1)
  quadraticBezierPoint(p0, cp, p1, t) {
    return PathUtils.quadraticBezierPoint(p0, cp, p1, t);
  }

  // Get closest point on bounding box (fallback)
  getClosestPointOnBoundingBox(pathObj, targetPoint) {
    return PathUtils.getClosestPointOnBoundingBox(pathObj, targetPoint);
  }

  // Calculate distance between two points
  calculateDistance(p1, p2) {
    return PathUtils.calculateDistance(p1, p2);
  }

  getConnectorStrokeColor(strokeObj) {
    if (this.connectorMatchesLine) {
      const derivedLineColor = this.getStrokeColorFromObject(strokeObj);
      if (derivedLineColor) return derivedLineColor;
      return (
        String(
          strokeObj?.stroke || strokeObj?.fill || this.strokeColor || this.connectorColor
        ).trim() || '#3b82f6'
      );
    }
    return String(this.connectorColor || '#ffffff').trim() || '#ffffff';
  }

  getStrokeColorFromObject(strokeObj) {
    if (!strokeObj) return null;

    if (strokeObj.type === 'group' && typeof strokeObj.getObjects === 'function') {
      const children = strokeObj.getObjects() || [];
      const lineChild = children.find(child => child?.type === 'line' && child?.stroke);
      if (lineChild?.stroke) {
        const value = String(lineChild.stroke).trim();
        if (value) return value;
      }

      const anyStrokeChild = children.find(child => child?.stroke);
      if (anyStrokeChild?.stroke) {
        const value = String(anyStrokeChild.stroke).trim();
        if (value) return value;
      }
    }

    const fromSelf = String(strokeObj.stroke || strokeObj.fill || '').trim();
    if (fromSelf) return fromSelf;

    return null;
  }

  // Create a manipulatable connector line
  createConnectorObject(x1, y1, x2, y2, tagObj, strokeObj, strokeLabel) {
    const strokeWidth = 2;
    const snap = (value: number) => Math.round(value || 0);
    const scopedLabel =
      tagObj?.scopedLabel ||
      tagObj?.imageLabel ||
      strokeObj?.strokeMetadata?.imageLabel ||
      strokeObj?.imageLabel ||
      null;
    const baseImageLabel =
      typeof scopedLabel === 'string' && scopedLabel.includes('::tab:')
        ? scopedLabel.split('::tab:')[0]
        : scopedLabel;
    return new fabric.Line([x1, y1, x2, y2], {
      x1: snap(x1),
      y1: snap(y1),
      x2: snap(x2),
      y2: snap(y2),
      stroke: this.getConnectorStrokeColor(strokeObj),
      strokeWidth,
      strokeDashArray: [6, 4],
      opacity: 1,
      objectCaching: false,
      strokeLineCap: 'butt',
      strokeUniform: true,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      lockRotation: true,
      lockScalingFlip: true,
      excludeFromExport: true,
      isConnectorLine: true,
      connectedTag: tagObj,
      connectedStroke: strokeObj,
      strokeLabel: strokeLabel,
      imageLabel: baseImageLabel,
      scopedLabel,
    });
  }

  createManipulatableConnector(tagObj, strokeObj, strokeLabel) {
    const canvas = this.canvas;
    if (!canvas) return null;

    // Get tag center
    const tagCenter = this.getCanvasObjectCenter(tagObj);
    if (!tagCenter) return null;

    // Get closest stroke endpoint
    const strokeEndpoint = this.getClosestStrokeEndpoint(strokeObj, tagCenter);

    const connector = this.createConnectorObject(
      tagCenter.x,
      tagCenter.y,
      strokeEndpoint.x,
      strokeEndpoint.y,
      tagObj,
      strokeObj,
      strokeLabel
    );

    return connector;
  }

  // Update connector line between tag and stroke
  updateConnector(strokeLabel, imageLabel, options = {}) {
    const canvas = this.canvas;
    if (!canvas) return;

    const found = this.getTagObject(strokeLabel, imageLabel);
    if (!found) return;
    const tagObj = found.tagObj;
    const displayLabel = tagObj.strokeLabel || strokeLabel;
    let connectedStrokeObj = tagObj.connectedStroke;

    // Rebind to the live stroke object if the current reference is stale/off-canvas.
    const isLiveStroke =
      connectedStrokeObj &&
      (typeof canvas.contains !== 'function' || canvas.contains(connectedStrokeObj));
    if (!isLiveStroke && this.metadataManager) {
      const scopedImageLabel =
        tagObj.scopedLabel ||
        this.normalizeImageLabel(imageLabel || tagObj.imageLabel || window.currentImageLabel);
      const candidate =
        this.metadataManager.vectorStrokesByImage?.[scopedImageLabel]?.[displayLabel];
      if (candidate) {
        connectedStrokeObj = candidate;
        tagObj.connectedStroke = candidate;
      }
    }

    if (!connectedStrokeObj) return;

    // Only move the tag when the connected stroke itself moved. Measurement edits,
    // tag drags, and style refreshes should only redraw the connector line.
    const activeObject = canvas.getActiveObject();
    const isTagInSelection =
      activeObject &&
      activeObject.type === 'activeSelection' &&
      activeObject.getObjects().includes(tagObj);

    if (options?.repositionTag === true && !isTagInSelection) {
      const strokeCenter = this.getCanvasObjectCenter(connectedStrokeObj);

      if (strokeCenter) {
        // Use stored offset or default
        const tagOffset = tagObj.tagOffset || connectedStrokeObj.tagOffset || { x: 20, y: -10 };
        tagObj.tagOffset = { x: tagOffset.x, y: tagOffset.y };
        connectedStrokeObj.tagOffset = { x: tagOffset.x, y: tagOffset.y };
        const newTagLeft = strokeCenter.x + tagOffset.x;
        const newTagTop = strokeCenter.y + tagOffset.y;

        // Update tag position to maintain offset from stroke
        tagObj.set({
          left: newTagLeft,
          top: newTagTop,
        });
        tagObj.setCoords();
      }
    }

    // Get tag center in canvas space
    const tagCenter = this.getCanvasObjectCenter(tagObj);
    if (!tagCenter) return;

    // Get closest stroke endpoint
    const strokeEndpoint = this.getClosestStrokeEndpoint(connectedStrokeObj, tagCenter);

    // console.log(`[ConnectorDebug] ${strokeLabel} Tag: (${tagCenter.x.toFixed(0)}, ${tagCenter.y.toFixed(0)}) Stroke: (${strokeEndpoint.x.toFixed(0)}, ${strokeEndpoint.y.toFixed(0)})`);

    // Check if connector already exists
    let connector = tagObj.connectorLine;

    if (connector && canvas.contains(connector)) {
      // For fabric.Line objects, updating endpoints requires proper recreation
      // Just setting x1,y1,x2,y2 doesn't update the line's visual position correctly

      // Remove the old connector and create a new one
      canvas.remove(connector);

      // Create new connector with updated endpoints
      connector = this.createConnectorObject(
        tagCenter.x,
        tagCenter.y,
        strokeEndpoint.x,
        strokeEndpoint.y,
        tagObj,
        connectedStrokeObj,
        displayLabel
      );

      canvas.add(connector);
      connector.sendToBack();
      tagObj.connectorLine = connector;
    } else {
      // Create new connector
      connector = this.createManipulatableConnector(tagObj, connectedStrokeObj, displayLabel);
      if (connector) {
        canvas.add(connector);
        connector.sendToBack();
        tagObj.connectorLine = connector;
      }
    }

    const connectorVisible =
      tagObj.visible !== false &&
      connectedStrokeObj.visible !== false &&
      connectedStrokeObj?.strokeMetadata?.visible !== false &&
      connectedStrokeObj?.strokeMetadata?.labelVisible !== false;
    if (connector) {
      connector.set({
        visible: connectorVisible,
        evented: false,
        selectable: false,
      });
    }

    // Request render (debounced by Fabric)
    canvas.requestRenderAll();
  }

  // Remove a tag
  removeTag(strokeLabel, imageLabel, options = {}) {
    const canvas = this.canvas;
    if (!canvas) return;

    const key = this.resolveTagKey(strokeLabel, imageLabel);
    if (!key) return;
    const tagObj = this.tagObjects.get(key);
    if (!tagObj) return;

    // Remove connector
    if (tagObj.connectorLine) {
      canvas.remove(tagObj.connectorLine);
    }
    // Remove tag
    canvas.remove(tagObj);
    this.tagObjects.delete(key);
    if (!options.preserveStyleState) {
      if (this.tagStyleConfig?.perTagThemes?.[key]) {
        delete this.tagStyleConfig.perTagThemes[key];
        this.persistTagStyleConfigToMetadata();
      }
      if (this.tagStyleConfig?.highlightedTagKeys?.has(key)) {
        this.tagStyleConfig.highlightedTagKeys.delete(key);
        this.persistTagStyleConfigToMetadata();
      }
    }
  }

  // Clear all tags (useful when switching views with shared labels like A1)
  clearAllTags() {
    const canvas = this.canvas;
    if (!canvas) return;

    // Remove tracked tags
    for (const tagObj of this.tagObjects.values()) {
      if (!tagObj) continue;
      if (tagObj.connectorLine) {
        canvas.remove(tagObj.connectorLine);
      }
      canvas.remove(tagObj);
    }
    this.tagObjects.clear();

    // Sweep for orphan tags/connectors that aren't tracked in the Map
    // (e.g. from stale loadFromJSON, race conditions, or async listeners)
    const orphans = canvas.getObjects().filter(obj => obj.isTag || obj.isConnectorLine);
    if (orphans.length > 0) {
      for (const obj of orphans) {
        canvas.remove(obj);
      }
    }

    canvas.requestRenderAll();
  }

  /**
   * Remove any tags whose imageLabel doesn't match the current scope.
   * Catches tags that leaked from a previous view during async view switching.
   */
  removeStaleTagsForScope(currentScope: string) {
    const canvas = this.canvas;
    if (!canvas || !currentScope) return;

    let removed = 0;
    const normalizedScope = this.normalizeImageLabel(currentScope);
    const baseScope =
      typeof normalizedScope === 'string' && normalizedScope.includes('::tab:')
        ? normalizedScope.split('::tab:')[0]
        : normalizedScope;
    const belongsToScope = obj => {
      const objectScope = obj?.scopedLabel || obj?.imageLabel || '';
      if (!objectScope || objectScope.startsWith('__guide__')) return true;
      if (objectScope === normalizedScope) return true;
      if (objectScope === baseScope && normalizedScope === baseScope) return true;
      return false;
    };

    // Remove tracked tags from wrong scope
    for (const [key, tagObj] of this.tagObjects.entries()) {
      if (!tagObj) continue;
      if (!belongsToScope(tagObj)) {
        if (tagObj.connectorLine) canvas.remove(tagObj.connectorLine);
        canvas.remove(tagObj);
        this.tagObjects.delete(key);
        removed++;
      }
    }

    // Also sweep for untracked orphans from wrong scope
    const orphans = canvas.getObjects().filter(obj => {
      if (!obj.isTag && !obj.isConnectorLine) return false;
      return !belongsToScope(obj);
    });
    for (const obj of orphans) {
      canvas.remove(obj);
      removed++;
    }

    if (removed > 0) {
      console.log(
        `[TagManager] Removed ${removed} stale tags not matching scope "${currentScope}"`
      );
      canvas.requestRenderAll();
    }
  }

  renameTagLabel(oldLabel, newLabel, imageLabel) {
    const found = this.getTagObject(oldLabel, imageLabel);
    if (!found) return false;

    const { key, tagObj } = found;
    tagObj.strokeLabel = newLabel;
    const resolvedImageLabel =
      this.getTagScopeLabel(tagObj) || this.normalizeImageLabel(imageLabel);
    const newKey = this.getTagKey(newLabel, resolvedImageLabel);

    this.tagObjects.delete(key);
    this.tagObjects.set(newKey, tagObj);

    if (this.tagStyleConfig?.highlightedTagKeys?.has(key)) {
      this.tagStyleConfig.highlightedTagKeys.delete(key);
      this.tagStyleConfig.highlightedTagKeys.add(newKey);
    }
    if (this.tagStyleConfig?.perTagThemes?.[key]) {
      this.tagStyleConfig.perTagThemes[newKey] = this.tagStyleConfig.perTagThemes[key];
      delete this.tagStyleConfig.perTagThemes[key];
    }
    this.persistTagStyleConfigToMetadata();

    this.updateTagText(newLabel, resolvedImageLabel);
    return true;
  }

  // Update tag text when measurement changes
  updateTagText(strokeLabel, imageLabel) {
    const found = this.getTagObject(strokeLabel, imageLabel);
    if (!found) {
      console.warn(`[TagManager] No tag found for ${strokeLabel}`);
      return;
    }
    const tagObj = found.tagObj;

    // Get the text object from the tag group
    const textObj = tagObj.getObjects().find(obj => obj.isTagText);
    if (!textObj) {
      console.warn(`[TagManager] No text object found in tag for ${strokeLabel}`);
      return;
    }

    // Get the updated measurement
    const measurementString = this.metadataManager.getMeasurementString(imageLabel, strokeLabel, {
      context: 'tag',
    });

    // Only show measurement if showMeasurements is true and measurement exists
    let fullText;
    if (this.showMeasurements && measurementString) {
      fullText = `${strokeLabel} = ${measurementString}`;
    } else {
      fullText = strokeLabel;
    }

    // Update the text
    textObj.set('text', fullText);
    textObj.set('textBaseline', 'middle');
    textObj.styles = {};

    // Force text to recalculate dimensions
    textObj.initDimensions();
    textObj.setCoords();

    // Update background size to match new text
    const bgObj = tagObj.getObjects().find(obj => !obj.isTagText);
    if (bgObj) {
      const padding = 4;
      const textWidth = textObj.width || 30;
      const textHeight = textObj.height || this.tagSize;
      let width = textWidth + padding * 2;
      const height = textHeight + padding * 2;
      if (this.tagShape === 'square') width = Math.max(width, height);

      let radius;
      if (this.tagShape === 'circle') {
        radius = height / 2;
      } else {
        radius = 4;
      }

      bgObj.set({
        width: width,
        height: height,
        rx: radius,
        ry: radius,
      });
    }

    // Recalculate group bounds to fit resized background
    // Must preserve the tag's position on canvas while resizing internal bounds
    const savedLeft = tagObj.left;
    const savedTop = tagObj.top;

    tagObj._restoreObjectsState();
    tagObj._calcBounds();
    tagObj._updateObjectsCoords();

    // Restore position
    tagObj.set({
      left: savedLeft,
      top: savedTop,
    });
    tagObj.setCoords();

    // Update connector line if needed
    this.updateConnector(strokeLabel, tagObj.scopedLabel || tagObj.imageLabel);

    // Force canvas re-render
    if (this.canvas) {
      this.canvas.requestRenderAll();
    }
  }

  // Update all tags (e.g., when tag mode or shape changes)
  updateAllTags(imageLabel) {
    const currentViewId = this.normalizeImageLabel(
      imageLabel || window.app?.projectManager?.currentViewId || 'front'
    );

    this.getViewScopes(currentViewId).forEach(scope => {
      const strokes = this.metadataManager.vectorStrokesByImage[scope] || {};
      Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
        const found = this.getTagObject(strokeLabel, scope);
        if (found && this.isRenderableStrokeObject(strokeObj)) {
          // Recreate tag with new settings
          this.createTag(strokeLabel, scope, strokeObj);
        }
      });
    });
  }

  updateAllTagTexts() {
    for (const tagObj of this.tagObjects.values()) {
      if (!tagObj || !tagObj.strokeLabel) continue;
      this.updateTagText(tagObj.strokeLabel, this.getTagScopeLabel(tagObj));
    }
  }

  // Update tag size for all tags
  updateTagSize() {
    const canvas = this.canvas;
    if (!canvas) return;

    const currentViewId = this.normalizeImageLabel(
      window.app?.projectManager?.currentViewId || 'front'
    );
    const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};

    Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
      const found = this.getTagObject(strokeLabel, currentViewId);
      if (found && this.isRenderableStrokeObject(strokeObj)) {
        const tagObj = found.tagObj;
        // Update both text and background size
        const textObj = tagObj
          .getObjects()
          .find(obj => obj.type === 'i-text' || obj.type === 'text');
        const bgObj = tagObj.getObjects().find(obj => !obj.isTagText);

        if (textObj && bgObj) {
          // Update font size
          textObj.set('fontSize', this.tagSize);

          // Recalculate text dimensions (Fabric.js needs a render cycle to measure text)
          setTimeout(() => {
            const padding = 4;
            const textWidth = Math.max(
              textObj.width || 30,
              textObj.text.length * (this.tagSize * 0.6)
            );
            const textHeight = textObj.height || this.tagSize;
            let width = textWidth + padding * 2;
            const height = textHeight + padding * 2;
            if (this.tagShape === 'square') width = Math.max(width, height);

            let radius;
            if (this.tagShape === 'circle') {
              radius = height / 2;
            } else {
              radius = 4;
            }

            // Update background dimensions
            bgObj.set({
              width: width,
              height: height,
              rx: radius,
              ry: radius,
            });

            // Update group coordinates and render
            tagObj.setCoords();
            this.updateConnector(strokeLabel, this.getTagScopeLabel(tagObj) || currentViewId);
            canvas.renderAll();
          }, 10); // Small delay to allow text measurement
        }
      }
    });

    // Update UI display
    const currentTagSizeEl = document.getElementById('currentTagSize');
    if (currentTagSizeEl) {
      currentTagSizeEl.textContent = this.tagSize;
    }

    this.persistTagSizeToMetadata(this.tagSize, currentViewId);

    canvas.renderAll();
  }

  normalizeTagSize(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 20;
    return Math.max(this.tagSizeMin, Math.min(this.tagSizeMax, Math.round(num)));
  }

  getTagSizeScopeKey(imageLabel) {
    const currentViewId = window.app?.projectManager?.currentViewId || 'front';
    const normalized = this.normalizeImageLabel(imageLabel || currentViewId || 'front');
    if (typeof normalized === 'string' && normalized.includes('::')) {
      return normalized.split('::')[0] || normalized;
    }
    return normalized || 'front';
  }

  getTagSizeFromMetadata(imageLabel) {
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const scopedKey = this.getTagSizeScopeKey(imageLabel);
    const scopedMap =
      metadata?.tagSizeByView && typeof metadata.tagSizeByView === 'object'
        ? metadata.tagSizeByView
        : {};
    const scopedSize = scopedMap?.[scopedKey];
    if (Number.isFinite(Number(scopedSize))) {
      return this.normalizeTagSize(scopedSize);
    }
    return this.normalizeTagSize(metadata?.tagSize ?? this.tagSize);
  }

  syncTagSizeFromMetadata(imageLabel) {
    this.tagSize = this.getTagSizeFromMetadata(imageLabel);
    const currentTagSizeEl = document.getElementById('currentTagSize');
    if (currentTagSizeEl) {
      currentTagSizeEl.textContent = this.tagSize;
    }
  }

  persistTagSizeToMetadata(size, imageLabel) {
    const normalized = this.normalizeTagSize(size);
    const scopedKey = this.getTagSizeScopeKey(imageLabel);
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const scopedMap =
      metadata?.tagSizeByView && typeof metadata.tagSizeByView === 'object'
        ? { ...metadata.tagSizeByView }
        : {};
    if (scopedKey) {
      scopedMap[scopedKey] = normalized;
    }

    if (window.app?.projectManager?.setProjectMetadata) {
      window.app.projectManager.setProjectMetadata({
        tagSize: normalized,
        tagSizeByView: scopedMap,
      });
      return;
    }
    window.projectMetadata = {
      ...(window.projectMetadata || {}),
      tagSize: normalized,
      tagSizeByView: scopedMap,
    };
  }

  // Set the background style for all tags
  setBackgroundStyle(style) {
    this.tagBackgroundStyle = style; // 'solid', 'no-fill', 'clear-black', 'clear-color', 'clear-white'

    const currentViewId = this.normalizeImageLabel(
      window.app?.projectManager?.currentViewId || 'front'
    );
    const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};

    Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
      const found = this.getTagObject(strokeLabel, currentViewId);
      if (found && this.isRenderableStrokeObject(strokeObj)) {
        // Recreate tag with new background style
        this.createTag(strokeLabel, currentViewId, strokeObj);
      }
    });
  }

  // Set the stroke color for clear-color style
  setStrokeColor(color) {
    this.strokeColor = color;

    if (this.connectorMatchesLine) {
      this.connectorColor = String(color || this.connectorColor || '#3b82f6').trim() || '#3b82f6';
      this.refreshAllConnectors();
    }

    // If using clear-color style, update all tags
    if (this.tagBackgroundStyle === 'clear-color') {
      const currentViewId = this.normalizeImageLabel(
        window.app?.projectManager?.currentViewId || 'front'
      );
      const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};

      Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
        const found = this.getTagObject(strokeLabel, currentViewId);
        if (found && this.isRenderableStrokeObject(strokeObj)) {
          this.createTag(strokeLabel, currentViewId, strokeObj);
        }
      });
    }
  }

  // Create tag for a stroke when metadata is attached
  createTagForStroke(strokeLabel, imageLabel, strokeObject) {
    imageLabel = this.normalizeImageLabel(imageLabel);
    // Check if label should be visible
    const isLabelVisible =
      this.metadataManager.strokeLabelVisibility[imageLabel]?.[strokeLabel] !== false;
    if (!isLabelVisible) return;

    this.createTag(strokeLabel, imageLabel, strokeObject);

    // Update stroke visibility controls to show the new stroke
    if (this.metadataManager.updateStrokeVisibilityControls) {
      setTimeout(() => {
        this.metadataManager.updateStrokeVisibilityControls();

        // Focus the measurement input after controls are updated (skip during paste)
        if (this.metadataManager._shouldAutoFocus && this.metadataManager.focusMeasurementInput) {
          this.metadataManager.focusMeasurementInput(strokeLabel);
        }
      }, 100); // Small delay to ensure all metadata is properly set
    }
  }

  // Clear all tags for an image
  clearTagsForImage(imageLabel) {
    imageLabel = this.normalizeImageLabel(imageLabel);
    const strokes = this.metadataManager.vectorStrokesByImage[imageLabel] || {};
    Object.keys(strokes).forEach(strokeLabel => {
      this.removeTag(strokeLabel, imageLabel);
    });
  }

  // Recreate all tags for an image after loading from JSON
  // This is needed because tags are not serialized (they have excludeFromExport)
  recreateTagsForImage(imageLabel) {
    imageLabel = this.normalizeImageLabel(imageLabel);
    console.log(`[TagManager] Recreating tags for image: ${imageLabel}`);

    // First clear any existing tags for this image
    this.clearTagsForImage(imageLabel);

    // Get all strokes for this image
    const strokes = this.metadataManager.vectorStrokesByImage[imageLabel] || {};
    const strokeLabels = Object.keys(strokes);

    console.log(`[TagManager] Found ${strokeLabels.length} strokes to create tags for`);

    // Recreate tag for each stroke
    strokeLabels.forEach(strokeLabel => {
      const strokeObject = strokes[strokeLabel];
      if (this.isRenderableStrokeObject(strokeObject)) {
        // Check if label should be visible
        const isLabelVisible =
          this.metadataManager.strokeLabelVisibility[imageLabel]?.[strokeLabel] !== false;
        if (isLabelVisible) {
          this.createTag(strokeLabel, imageLabel, strokeObject);
        }
      }
    });

    // Request render
    if (this.canvas) {
      this.canvas.requestRenderAll();
    }
  }

  // Toggle showing measurements on all tags
  setShowMeasurements(show) {
    this.showMeasurements = show;

    // Update all existing tags
    const currentViewId = this.normalizeImageLabel(
      window.app?.projectManager?.currentViewId || 'front'
    );
    const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};

    Object.keys(strokes).forEach(strokeLabel => {
      this.updateTagText(strokeLabel, currentViewId);
    });
  }

  // Update tags when stroke visibility changes
  updateTagVisibility(strokeLabel, imageLabel, visible) {
    imageLabel = this.normalizeImageLabel(imageLabel);
    const strokeVisible =
      this.metadataManager?.strokeVisibilityByImage?.[imageLabel]?.[strokeLabel] !== false;
    const labelVisible =
      this.metadataManager?.strokeLabelVisibility?.[imageLabel]?.[strokeLabel] !== false;
    const effectiveVisible = visible !== false && strokeVisible && labelVisible;

    let found = this.getTagObject(strokeLabel, imageLabel);
    if (!found && effectiveVisible) {
      const strokeObj = this.metadataManager?.vectorStrokesByImage?.[imageLabel]?.[strokeLabel];
      if (this.isRenderableStrokeObject(strokeObj)) {
        this.createTag(strokeLabel, imageLabel, strokeObj);
        found = this.getTagObject(strokeLabel, imageLabel);
      }
    }
    if (!found) return;

    const tagObj = found.tagObj;
    tagObj.set({
      visible: effectiveVisible,
      evented: effectiveVisible,
      selectable: effectiveVisible,
    });
    if (tagObj.connectorLine) {
      tagObj.connectorLine.set({
        visible: effectiveVisible,
        evented: false,
        selectable: false,
      });
    }
    this.canvas?.requestRenderAll();
  }

  refreshAllConnectors(imageLabel) {
    const normalized = imageLabel ? this.normalizeImageLabel(imageLabel) : null;
    for (const tagObj of this.tagObjects.values()) {
      if (!tagObj || !tagObj.strokeLabel) continue;
      const tagScope = tagObj.scopedLabel || tagObj.imageLabel;
      if (normalized && tagScope !== normalized && tagObj.imageLabel !== normalized) continue;
      this.updateConnector(tagObj.strokeLabel, tagScope);
    }
  }

  setConnectorColor(color) {
    if (!color) return;
    this.connectorColor = String(color).trim().toLowerCase();
    this.refreshAllConnectors();
  }

  normalizeThemeColor(value) {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    return /^#[0-9a-f]{6}$/.test(raw) ? raw : null;
  }

  syncCustomTagColorsFromMetadata() {
    this.syncTagStyleConfigFromMetadata();
  }

  persistCustomTagColorsToMetadata(theme) {
    const payload = theme || null;
    if (window.app?.projectManager?.setProjectMetadata) {
      window.app.projectManager.setProjectMetadata({ tagColorTheme: payload });
      return;
    }
    window.projectMetadata = {
      ...(window.projectMetadata || {}),
      tagColorTheme: payload,
    };
  }

  refreshAllTagStyles() {
    const tags = Array.from(this.tagObjects.values());
    tags.forEach(tagObj => {
      if (!tagObj?.strokeLabel || !tagObj?.connectedStroke) return;
      this.createTag(tagObj.strokeLabel, this.getTagScopeLabel(tagObj), tagObj.connectedStroke);
    });
    this.canvas?.requestRenderAll();
  }

  refreshTagStylesForKeys(keys) {
    const uniqueKeys = Array.from(new Set(Array.isArray(keys) ? keys : []));
    uniqueKeys.forEach(key => {
      const tagObj = this.tagObjects.get(key);
      if (!tagObj?.strokeLabel || !tagObj?.connectedStroke) return;
      this.createTag(tagObj.strokeLabel, this.getTagScopeLabel(tagObj), tagObj.connectedStroke);
    });
    this.canvas?.requestRenderAll();
  }

  setTagStyleTheme(target, colors) {
    const normalizedTarget = this.normalizeTagStyleTarget(target);
    const normalizedTheme = this.normalizeTagTheme(colors);
    if (!normalizedTheme) return;

    if (!this.tagStyleConfig) {
      this.tagStyleConfig = this.createDefaultTagStyleConfig();
    }

    this.tagStyleConfig.presets[normalizedTarget] = normalizedTheme;
    this.customTagColors =
      this.cloneTagTheme(this.tagStyleConfig.presets.lettersNumbers) ||
      this.cloneTagTheme(this.tagStyleConfig.presets.lettersOnly);
    this.persistTagStyleConfigToMetadata();
    this.tagBackgroundStyle = 'solid';
    this.refreshAllTagStyles();
  }

  clearTagStyleTheme(target) {
    const normalizedTarget = this.normalizeTagStyleTarget(target);
    if (!this.tagStyleConfig) {
      this.tagStyleConfig = this.createDefaultTagStyleConfig();
    }

    this.tagStyleConfig.presets[normalizedTarget] = null;
    this.customTagColors =
      this.cloneTagTheme(this.tagStyleConfig.presets.lettersNumbers) ||
      this.cloneTagTheme(this.tagStyleConfig.presets.lettersOnly);
    this.persistTagStyleConfigToMetadata();
    this.refreshAllTagStyles();
  }

  getSelectedTagKeys() {
    const canvas = this.canvas;
    if (!canvas) return [];

    const activeObject = canvas.getActiveObject();
    if (!activeObject) return [];

    const selected =
      activeObject.type === 'activeSelection' ? activeObject.getObjects?.() || [] : [activeObject];
    const keys = new Set();

    selected.forEach(obj => {
      if (!obj) return;

      const strokeLabel =
        obj.strokeLabel ||
        obj.strokeMetadata?.strokeLabel ||
        obj.strokeMetadata?.label ||
        obj.customData?.strokeLabel ||
        obj.customData?.label ||
        obj.connectedStroke?.strokeMetadata?.strokeLabel ||
        obj.connectedStroke?.strokeMetadata?.label ||
        obj.connectedStroke?.strokeLabel ||
        obj.connectedStroke?.customData?.strokeLabel ||
        obj.connectedStroke?.customData?.label;
      const imageLabel =
        obj.scopedLabel ||
        obj.imageLabel ||
        obj.strokeMetadata?.imageLabel ||
        obj.customData?.imageLabel ||
        obj.connectedTag?.scopedLabel ||
        obj.connectedStroke?.strokeMetadata?.imageLabel ||
        obj.connectedStroke?.scopedLabel ||
        obj.connectedStroke?.imageLabel ||
        obj.connectedStroke?.customData?.imageLabel;

      if (!strokeLabel) return;
      keys.add(this.getTagKey(strokeLabel, imageLabel));
    });

    return Array.from(keys);
  }

  setHighlightForSelectedTags(highlighted = true) {
    const selectedKeys = this.getSelectedTagKeys();
    if (!selectedKeys.length) return 0;

    if (!this.tagStyleConfig) {
      this.tagStyleConfig = this.createDefaultTagStyleConfig();
    }

    if (highlighted && !this.tagStyleConfig.presets.highlight) {
      this.tagStyleConfig.presets.highlight = this.getDefaultHighlightTheme();
    }

    selectedKeys.forEach(key => {
      if (highlighted) {
        this.tagStyleConfig.highlightedTagKeys.add(key);
      } else {
        this.tagStyleConfig.highlightedTagKeys.delete(key);
      }
    });

    this.persistTagStyleConfigToMetadata();
    this.refreshTagStylesForKeys(selectedKeys);
    return selectedKeys.length;
  }

  setTagTheme(strokeLabel, imageLabel, colors) {
    const normalizedLabel = String(strokeLabel || '').trim();
    if (!normalizedLabel) return false;

    if (!this.tagStyleConfig) {
      this.tagStyleConfig = this.createDefaultTagStyleConfig();
    }

    const tagKey = this.getTagKey(normalizedLabel, imageLabel);
    const normalizedTheme = this.normalizeTagTheme(colors);

    if (normalizedTheme) {
      this.tagStyleConfig.perTagThemes[tagKey] = normalizedTheme;
    } else if (this.tagStyleConfig.perTagThemes?.[tagKey]) {
      delete this.tagStyleConfig.perTagThemes[tagKey];
    }

    this.persistTagStyleConfigToMetadata();
    this.refreshTagStylesForKeys([tagKey]);
    this.emitTagStyleStateChanged(imageLabel);
    return true;
  }

  setTagThemeForStyleTargets(imageLabel, colors) {
    const viewId = this.normalizeImageLabel(imageLabel);
    const selectedKeys = this.getSelectedStyleTargetKeys(viewId);
    if (!selectedKeys.length) return 0;

    if (!this.tagStyleConfig) {
      this.tagStyleConfig = this.createDefaultTagStyleConfig();
    }

    const normalizedTheme = this.normalizeTagTheme(colors);
    selectedKeys.forEach(key => {
      if (normalizedTheme) {
        this.tagStyleConfig.perTagThemes[key] = normalizedTheme;
      } else {
        delete this.tagStyleConfig.perTagThemes[key];
      }
    });

    this.persistTagStyleConfigToMetadata();
    this.refreshTagStylesForKeys(selectedKeys);
    this.emitTagStyleStateChanged(viewId);
    return selectedKeys.length;
  }

  setTagThemeForSelectedTags(colors) {
    const selectedKeys = this.getSelectedTagKeys();
    if (!selectedKeys.length) return 0;

    if (!this.tagStyleConfig) {
      this.tagStyleConfig = this.createDefaultTagStyleConfig();
    }

    const normalizedTheme = this.normalizeTagTheme(colors);
    selectedKeys.forEach(key => {
      if (normalizedTheme) {
        this.tagStyleConfig.perTagThemes[key] = normalizedTheme;
      } else {
        delete this.tagStyleConfig.perTagThemes[key];
      }
    });

    this.persistTagStyleConfigToMetadata();
    this.refreshTagStylesForKeys(selectedKeys);
    return selectedKeys.length;
  }

  setTagHighlighted(strokeLabel, imageLabel, highlighted = true) {
    const normalizedLabel = String(strokeLabel || '').trim();
    if (!normalizedLabel) return false;

    if (!this.tagStyleConfig) {
      this.tagStyleConfig = this.createDefaultTagStyleConfig();
    }

    if (highlighted && !this.tagStyleConfig.presets.highlight) {
      this.tagStyleConfig.presets.highlight = this.getDefaultHighlightTheme();
    }

    const tagKey = this.getTagKey(normalizedLabel, imageLabel);
    if (highlighted) {
      this.tagStyleConfig.highlightedTagKeys.add(tagKey);
    } else {
      this.tagStyleConfig.highlightedTagKeys.delete(tagKey);
    }

    this.persistTagStyleConfigToMetadata();
    this.refreshTagStylesForKeys([tagKey]);
    return highlighted;
  }

  toggleTagHighlight(strokeLabel, imageLabel) {
    const nextHighlighted = !this.isTagHighlighted(strokeLabel, imageLabel);
    this.setTagHighlighted(strokeLabel, imageLabel, nextHighlighted);
    return nextHighlighted;
  }

  setTagCustomColors(colors) {
    const normalizedTheme = this.normalizeTagTheme(colors);
    if (!normalizedTheme) return;

    this.setTagStyleTheme('lettersOnly', normalizedTheme);
    this.setTagStyleTheme('lettersNumbers', normalizedTheme);
    this.persistCustomTagColorsToMetadata(normalizedTheme);
  }

  clearTagCustomColors() {
    this.customTagColors = null;
    this.persistCustomTagColorsToMetadata(null);
    this.clearTagStyleTheme('lettersOnly');
    this.clearTagStyleTheme('lettersNumbers');
  }
}
