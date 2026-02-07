// Tag Manager
// Creates draggable, resizable tag objects that connect to strokes
import { StrokeMetadataManager } from './StrokeMetadataManager.js';
import { PathUtils } from './utils/PathUtils.js';

export class TagManager {
  constructor(canvasManager, metadataManager) {
    this.canvasManager = canvasManager;
    this.metadataManager = metadataManager;
    this.tagObjects = new Map(); // Map<viewId::strokeLabel, fabricObject>
    this.tagSize = 20; // Default tag font size
    this.tagShape = 'square'; // 'square' or 'circle'
    this.tagMode = 'letters+numbers'; // 'letters' or 'letters+numbers'
    this.tagBackgroundStyle = 'solid'; // 'solid', 'no-fill', 'clear-black', 'clear-color', 'clear-white'
    this.strokeColor = '#3b82f6'; // Default stroke color for clear-color style

    // Initialize showMeasurements to hidden by default; sync checkbox state if present
    const showMeasurementsCheckbox = document.getElementById('toggleShowMeasurements');
    this.showMeasurements = false;
    if (showMeasurementsCheckbox) {
      showMeasurementsCheckbox.checked = false;
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
      if (viewId && tagObj.imageLabel && tagObj.imageLabel !== viewId) continue;
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
        this.tagSize = Math.min(this.tagSize + 2, 40);
        this.updateTagSize();
      });
    }
    if (decreaseBtn) {
      decreaseBtn.addEventListener('click', () => {
        this.tagSize = Math.max(this.tagSize - 2, 10);
        this.updateTagSize();
      });
    }

    // Listen for tag shape changes
    const shapeToggle = document.getElementById('labelShapeToggleBtn');
    if (shapeToggle) {
      shapeToggle.addEventListener('click', () => {
        this.tagShape = this.tagShape === 'square' ? 'circle' : 'square';
        this.updateAllTags();
      });
    }
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

  // Create a draggable, resizable tag object
  createTag(strokeLabel, imageLabel, strokeObject) {
    imageLabel = this.normalizeImageLabel(imageLabel);
    // Ensure canvas is available
    const canvas = this.canvas;
    if (!canvas) {
      console.warn('TagManager: Canvas not available, cannot create tag');
      return null;
    }

    // Remove existing tag if any
    this.removeTag(strokeLabel, imageLabel);

    // Get tag position (near stroke center)
    const bounds = strokeObject.getBoundingRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;

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
        // Use standard baseline to avoid CanvasTextBaseline warnings
        textBaseline: 'alphabetic',
        selectable: false, // Will be controlled by group
        evented: true, // Allow editing
        hasControls: false, // Controlled by group
        hasBorders: false, // Controlled by group
        excludeFromExport: true, // Don't save tags to canvas JSON
        isTagText: true,
      });
    } catch (e) {
      console.error('TagManager: Error creating text object', e);
      // Fallback - use alphabetic instead of middle to be consistent
      tagText = new fabric.Text(strokeLabel, {
        fontSize: this.tagSize,
        textBaseline: 'alphabetic',
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
    // Both square and circle modes use a rounded rectangle (capsule shape)
    // Circle mode just has more rounding
    const width = textWidth + padding * 2;
    const height = textHeight + padding * 2;
    const radius = this.tagShape === 'circle' ? height / 2 : 2; // Full rounding for circle, minimal for square

    // Determine background style properties
    let bgFill = '#ffffff';
    let bgStroke = '#000000';
    let bgStrokeWidth = 1;
    let textFill = '#000000';

    if (this.tagBackgroundStyle === 'no-fill') {
      bgFill = 'transparent';
      bgStroke = 'transparent';
      bgStrokeWidth = 0;
      textFill = this.strokeColor || '#3b82f6';
    } else if (this.tagBackgroundStyle === 'clear-black') {
      bgFill = 'transparent';
      bgStroke = '#000000';
      bgStrokeWidth = 1;
      textFill = '#000000';
    } else if (this.tagBackgroundStyle === 'clear-color') {
      bgFill = 'transparent';
      bgStroke = this.strokeColor || '#3b82f6';
      bgStrokeWidth = 1;
      textFill = this.strokeColor || '#3b82f6';
    } else if (this.tagBackgroundStyle === 'clear-white') {
      bgFill = 'transparent';
      bgStroke = '#ffffff';
      bgStrokeWidth = 1;
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
    });

    // Update text color based on background style
    tagText.set('fill', textFill);

    // Group tag text and background
    // Position group at stroke center + offset
    const initialOffset = strokeObject?.tagOffset || { x: 20, y: -10 };
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
      perPixelTargetFind: true, // Only select when clicking visible parts
      excludeFromExport: true, // Don't serialize tags - they're recreated from stroke metadata
      // Custom properties
      isTag: true,
      strokeLabel: strokeLabel,
      imageLabel: imageLabel,
      connectedStroke: strokeObject,
      tagOffset: { x: initialOffset.x, y: initialOffset.y }, // Default offset
    });

    if (strokeObject) {
      strokeObject.tagOffset = { x: initialOffset.x, y: initialOffset.y };
    }

    // Update connector line when tag moves
    tagGroup.on('moving', () => {
      // Update offset based on new position
      const strokeBounds = strokeObject.getBoundingRect(true);
      const strokeCenter = {
        x: strokeBounds.left + strokeBounds.width / 2,
        y: strokeBounds.top + strokeBounds.height / 2,
      };

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

      this.updateConnector(strokeLabel);
    });

    // Update connector when connected stroke moves
    if (strokeObject) {
      strokeObject.on('moving', () => {
        this.updateConnector(strokeLabel);
      });
      strokeObject.on('modified', () => {
        this.updateConnector(strokeLabel);
      });
      strokeObject.on('scaling', () => {
        this.updateConnector(strokeLabel);
      });
      strokeObject.on('rotating', () => {
        this.updateConnector(strokeLabel);
      });
    }

    // Click on tag to focus measurement input in sidebar
    // Use both fabric mouse:down and native mousedown for better compatibility
    tagGroup.on('mouse:down', e => {
      // Only if not already editing the text
      if (!tagText.isEditing) {
        // Check if multiple strokes are currently selected
        const activeObjects = canvas.getActiveObjects();
        const isMultipleSelected = activeObjects.length > 1;

        // Check if this stroke is part of the current multi-selection
        const isStrokeInSelection = strokeObject && activeObjects.includes(strokeObject);

        // Select the connected stroke
        if (strokeObject && canvas) {
          // If multiple strokes are selected and this stroke is already selected,
          // keep the multi-selection and show measurement input
          // Otherwise, select just this stroke
          if (!(isMultipleSelected && isStrokeInSelection)) {
            canvas.setActiveObject(strokeObject);
            canvas.requestRenderAll();
          }
        }

        // Only show measurement input if:
        // - Single stroke is selected, OR
        // - Multiple strokes are selected AND this stroke is in the selection
        // This prevents input from appearing when clicking a different tag
        const shouldShowMeasurement = !isMultipleSelected || isStrokeInSelection;

        if (
          shouldShowMeasurement &&
          this.metadataManager &&
          this.metadataManager.focusMeasurementInput
        ) {
          this.metadataManager.focusMeasurementInput(strokeLabel);
        } else if (!shouldShowMeasurement) {
          console.log('[TagManager] Clicked tag outside multi-selection - no measurement input');
        }
      }
    });

    canvas.add(tagGroup);
    tagGroup.strokeLabel = strokeLabel;
    tagGroup.imageLabel = imageLabel;
    this.tagObjects.set(this.getTagKey(strokeLabel, imageLabel), tagGroup);

    // Update tag text to include measurement if showMeasurements is enabled
    this.updateTagText(strokeLabel, imageLabel);

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
    this.updateConnector(strokeLabel, imageLabel);

    return tagGroup;
  }

  // Get the closest point on the actual stroke geometry to a given point
  getClosestStrokeEndpoint(strokeObj, targetPoint) {
    return PathUtils.getClosestStrokeEndpoint(strokeObj, targetPoint);
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

  // Create a manipulatable connector line
  createManipulatableConnector(tagObj, strokeObj, strokeLabel) {
    const canvas = this.canvas;
    if (!canvas) return null;

    // Get tag center
    const tagBounds = tagObj.getBoundingRect();
    const tagCenter = {
      x: tagBounds.left + tagBounds.width / 2,
      y: tagBounds.top + tagBounds.height / 2,
    };

    // Get closest stroke endpoint
    const strokeEndpoint = this.getClosestStrokeEndpoint(strokeObj, tagCenter);

    // Create the connector line (non-interactive, just visual feedback)
    const connector = new fabric.Line(
      [tagCenter.x, tagCenter.y, strokeEndpoint.x, strokeEndpoint.y],
      {
        stroke: 'rgba(0, 0, 0, 0.35)',
        strokeWidth: 1,
        strokeDashArray: [6, 4],
        opacity: 0.7,
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
        imageLabel: tagObj.imageLabel || strokeObj?.strokeMetadata?.imageLabel || null,
      }
    );

    return connector;
  }

  // Update connector line between tag and stroke
  updateConnector(strokeLabel, imageLabel) {
    const canvas = this.canvas;
    if (!canvas) return;

    const found = this.getTagObject(strokeLabel, imageLabel);
    if (!found) return;
    const tagObj = found.tagObj;
    const displayLabel = tagObj.strokeLabel || strokeLabel;
    const connectedStrokeObj = tagObj.connectedStroke;
    if (!connectedStrokeObj) return;

    // Reposition tag to maintain its offset from the stroke
    // Only if tag is NOT part of an active selection (multi-select)
    // If it IS in active selection, Fabric handles the movement
    const activeObject = canvas.getActiveObject();
    const isTagInSelection =
      activeObject &&
      activeObject.type === 'activeSelection' &&
      activeObject.getObjects().includes(tagObj);

    if (!isTagInSelection) {
      let strokeCenter;

      // Calculate absolute stroke center
      if (connectedStrokeObj.group) {
        // Stroke is in a group (activeSelection)
        // getCenterPoint() returns coordinates relative to the group center
        const centerRelative = connectedStrokeObj.getCenterPoint();
        const groupMatrix = connectedStrokeObj.group.calcTransformMatrix();

        // Transform to absolute canvas coordinates
        strokeCenter = fabric.util.transformPoint(centerRelative, groupMatrix);
      } else {
        // Stroke is directly on canvas
        strokeCenter = connectedStrokeObj.getCenterPoint();
      }

      if (strokeCenter) {
        // Use stored offset or default
        const tagOffset = tagObj.tagOffset || connectedStrokeObj.tagOffset || { x: 20, y: -10 };
        tagObj.tagOffset = { x: tagOffset.x, y: tagOffset.y };
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
    let tagCenter;

    if (tagObj.group) {
      // Tag is in a group (activeSelection)
      // getCenterPoint() returns coordinates relative to the group center
      const centerRelative = tagObj.getCenterPoint();
      const groupMatrix = tagObj.group.calcTransformMatrix();

      // Transform to absolute canvas coordinates
      tagCenter = fabric.util.transformPoint(centerRelative, groupMatrix);
    } else {
      // Tag is directly on canvas
      tagCenter = tagObj.getCenterPoint();
    }

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
      connector = new fabric.Line([tagCenter.x, tagCenter.y, strokeEndpoint.x, strokeEndpoint.y], {
        stroke: 'rgba(0, 0, 0, 0.35)',
        strokeWidth: 1,
        strokeDashArray: [6, 4],
        opacity: 0.7,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockRotation: true,
        lockScalingFlip: true,
        excludeFromExport: true,
        isConnectorLine: true,
        connectedTag: tagObj,
        connectedStroke: connectedStrokeObj,
        strokeLabel: displayLabel,
        imageLabel: tagObj.imageLabel || connectedStrokeObj?.strokeMetadata?.imageLabel || null,
      });

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

    // Request render (debounced by Fabric)
    canvas.requestRenderAll();
  }

  // Remove a tag
  removeTag(strokeLabel, imageLabel) {
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
  }

  // Clear all tags (useful when switching views with shared labels like A1)
  clearAllTags() {
    const keys = Array.from(this.tagObjects.keys());
    keys.forEach(key => this.removeTag(key));
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
    const measurementString = this.metadataManager.getMeasurementString(imageLabel, strokeLabel);

    // Only show measurement if showMeasurements is true and measurement exists
    let fullText;
    if (this.showMeasurements && measurementString) {
      fullText = `${strokeLabel} = ${measurementString}`;
    } else {
      fullText = strokeLabel;
    }

    // Update the text
    textObj.set('text', fullText);
    textObj.set('textBaseline', 'alphabetic');
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
      const width = textWidth + padding * 2;
      const height = textHeight + padding * 2;
      const radius = this.tagShape === 'circle' ? height / 2 : 2; // Full rounding for circle, minimal for square

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
    this.updateConnector(strokeLabel);

    // Force canvas re-render
    if (this.canvas) {
      this.canvas.requestRenderAll();
    }
  }

  // Update all tags (e.g., when tag mode or shape changes)
  updateAllTags() {
    const currentViewId = this.normalizeImageLabel(
      window.app?.projectManager?.currentViewId || 'front'
    );
    const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};

    Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
      const found = this.getTagObject(strokeLabel, currentViewId);
      if (found) {
        // Recreate tag with new settings
        this.createTag(strokeLabel, currentViewId, strokeObj);
      }
    });
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
      if (found) {
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
            const width = textWidth + padding * 2;
            const height = textHeight + padding * 2;
            const radius = this.tagShape === 'circle' ? height / 2 : 2; // Full rounding for circle, minimal for square

            // Update background dimensions
            bgObj.set({
              width: width,
              height: height,
              rx: radius,
              ry: radius,
            });

            // Update group coordinates and render
            tagObj.setCoords();
            this.updateConnector(strokeLabel, currentViewId);
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

    canvas.renderAll();
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
      if (found) {
        // Recreate tag with new background style
        this.createTag(strokeLabel, currentViewId, strokeObj);
      }
    });
  }

  // Set the stroke color for clear-color style
  setStrokeColor(color) {
    this.strokeColor = color;

    // If using clear-color style, update all tags
    if (this.tagBackgroundStyle === 'clear-color') {
      const currentViewId = this.normalizeImageLabel(
        window.app?.projectManager?.currentViewId || 'front'
      );
      const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};

      Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
        const found = this.getTagObject(strokeLabel, currentViewId);
        if (found) {
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

        // Focus the measurement input after controls are updated
        if (this.metadataManager.focusMeasurementInput) {
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
      if (strokeObject) {
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
    const found = this.getTagObject(strokeLabel, imageLabel);
    if (!found) return;
    const tagObj = found.tagObj;
    tagObj.set('visible', visible);
    if (tagObj.connectorLine) {
      tagObj.connectorLine.set('visible', visible);
    }
    this.canvas.renderAll();
  }
}
