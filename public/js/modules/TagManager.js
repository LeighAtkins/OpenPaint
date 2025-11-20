// Tag Manager
// Creates draggable, resizable tag objects that connect to strokes
import { StrokeMetadataManager } from './StrokeMetadataManager.js';

export class TagManager {
    constructor(canvasManager, metadataManager) {
        this.canvasManager = canvasManager;
        this.metadataManager = metadataManager;
        this.tagObjects = new Map(); // Map<strokeLabel, fabricObject>
        this.tagSize = 20; // Default tag font size
        this.tagShape = 'square'; // 'square' or 'circle'
        this.tagMode = 'letters+numbers'; // 'letters' or 'letters+numbers'
        
        // Initialize tag prediction system integration
        this.initTagPrediction();
    }
    
    // Get canvas reference dynamically (may not be available at construction time)
    get canvas() {
        return this.canvasManager?.fabricCanvas || null;
    }
    
    initTagPrediction() {
        // Get initial tag mode from UI
        const tagModeToggle = document.getElementById('tagModeToggle');
        if (tagModeToggle) {
            this.tagMode = tagModeToggle.textContent.includes('Letters Only') ? 'letters' : 'letters+numbers';
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
        // Ensure canvas is available
        const canvas = this.canvas;
        if (!canvas) {
            console.warn('TagManager: Canvas not available, cannot create tag');
            return null;
        }
        
        // Remove existing tag if any
        this.removeTag(strokeLabel);
        
        // Get tag position (near stroke center)
        const bounds = strokeObject.getBoundingRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        
        // Create tag text (editable IText)
        // Temporarily suppress Fabric.js textBaseline warning during creation
        const originalWarn = console.warn;
        const originalError = console.error;
        
        // Suppress warnings/errors about textBaseline
        const suppressTextBaselineWarning = (message) => {
            const msg = typeof message === 'string' ? message : String(message);
            return msg.includes('alphabetical') && msg.includes('CanvasTextBaseline');
        };
        
        console.warn = (...args) => {
            const message = args.map(a => String(a)).join(' ');
            if (suppressTextBaselineWarning(message)) {
                return; // Suppress this specific warning
            }
            originalWarn.apply(console, args);
        };
        
        console.error = (...args) => {
            const message = args.map(a => String(a)).join(' ');
            if (suppressTextBaselineWarning(message)) {
                return; // Suppress this specific error
            }
            originalError.apply(console, args);
        };
        
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
                selectable: false, // Will be controlled by group
                evented: true, // Allow editing
                hasControls: false, // Controlled by group
                hasBorders: false, // Controlled by group
                lockRotation: true,
                lockScalingFlip: true,
                // Custom properties
                isTagText: true,
                strokeLabel: strokeLabel,
                imageLabel: imageLabel
            });
            
            // Small delay to catch any async warnings
            setTimeout(() => {
                // Set valid textBaseline after creation
                try {
                    tagText.set('textBaseline', 'alphabetic');
                } catch (e) {
                    // Ignore if property doesn't exist
                }
            }, 0);
        } finally {
            // Restore console methods after a delay to catch async warnings
            // Fabric.js may trigger warnings asynchronously during initialization
            setTimeout(() => {
                console.warn = originalWarn;
                console.error = originalError;
            }, 100);
        }
        
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
        if (this.tagShape === 'circle') {
            const radius = Math.max(textWidth, textHeight) / 2 + padding;
            background = new fabric.Circle({
                left: 0,
                top: 0,
                radius: radius,
                fill: '#ffffff',
                stroke: '#000000',
                strokeWidth: 1,
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: false
            });
        } else {
            // Square/rectangle
            background = new fabric.Rect({
                left: 0,
                top: 0,
                width: textWidth + padding * 2,
                height: textHeight + padding * 2,
                fill: '#ffffff',
                stroke: '#000000',
                strokeWidth: 1,
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: false
            });
        }
        
        // Group tag text and background
        // Position group at stroke center + offset
        const tagGroup = new fabric.Group([background, tagText], {
            left: centerX + 20,
            top: centerY - 10,
            originX: 'center',
            originY: 'center',
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true,
            lockRotation: true,
            // Custom properties
            isTag: true,
            strokeLabel: strokeLabel,
            imageLabel: imageLabel,
            connectedStroke: strokeObject
        });
        
        // Update connector line when tag moves
        tagGroup.on('moving', () => {
            this.updateConnector(strokeLabel);
        });
        
        // Update connector line when tag is modified/resized
        tagGroup.on('modified', () => {
            this.updateConnector(strokeLabel);
            // Update background size when text changes
            const textObj = tagGroup.getObjects().find(obj => obj.isTagText);
            if (textObj) {
                const bgObj = tagGroup.getObjects().find(obj => !obj.isTagText);
                if (bgObj) {
                    const padding = 4;
                    const textWidth = textObj.width || 30;
                    const textHeight = textObj.height || this.tagSize;
                    if (this.tagShape === 'circle') {
                        const radius = Math.max(textWidth, textHeight) / 2 + padding;
                        bgObj.set('radius', radius);
                    } else {
                        bgObj.set({
                            width: textWidth + padding * 2,
                            height: textHeight + padding * 2
                        });
                    }
                    tagGroup.setCoords();
                }
            }
        });
        
        canvas.add(tagGroup);
        this.tagObjects.set(strokeLabel, tagGroup);
        
        // Create connector line
        this.updateConnector(strokeLabel);
        
        return tagGroup;
    }
    
    // Update connector line between tag and stroke
    updateConnector(strokeLabel) {
        const canvas = this.canvas;
        if (!canvas) return;
        
        const tagObj = this.tagObjects.get(strokeLabel);
        if (!tagObj) return;
        
        const strokeObj = tagObj.connectedStroke;
        if (!strokeObj) return;
        
        // Remove old connector if exists
        const oldConnector = tagObj.connectorLine;
        if (oldConnector) {
            canvas.remove(oldConnector);
        }
        
        // Get positions
        const tagBounds = tagObj.getBoundingRect();
        const strokeBounds = strokeObj.getBoundingRect();
        const tagCenter = { x: tagBounds.left + tagBounds.width / 2, y: tagBounds.top + tagBounds.height / 2 };
        const strokeCenter = { x: strokeBounds.left + strokeBounds.width / 2, y: strokeBounds.top + strokeBounds.height / 2 };
        
        // Create dotted connector line
        const connector = new fabric.Line([tagCenter.x, tagCenter.y, strokeCenter.x, strokeCenter.y], {
            stroke: '#999999',
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false
        });
        
        canvas.add(connector);
        connector.sendToBack(); // Put connector behind everything
        
        // Store reference
        tagObj.connectorLine = connector;
        
        canvas.renderAll();
    }
    
    // Remove a tag
    removeTag(strokeLabel) {
        const canvas = this.canvas;
        if (!canvas) return;
        
        const tagObj = this.tagObjects.get(strokeLabel);
        if (tagObj) {
            // Remove connector
            if (tagObj.connectorLine) {
                canvas.remove(tagObj.connectorLine);
            }
            // Remove tag
            canvas.remove(tagObj);
            this.tagObjects.delete(strokeLabel);
        }
    }
    
    // Update all tags (e.g., when tag mode or shape changes)
    updateAllTags() {
        const currentViewId = window.app?.projectManager?.currentViewId || 'front';
        const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};
        
        Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
            const tagObj = this.tagObjects.get(strokeLabel);
            if (tagObj) {
                // Recreate tag with new settings
                this.createTag(strokeLabel, currentViewId, strokeObj);
            }
        });
    }
    
    // Update tag size for all tags
    updateTagSize() {
        const canvas = this.canvas;
        if (!canvas) return;
        
        const currentViewId = window.app?.projectManager?.currentViewId || 'front';
        const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};
        
        Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
            const tagObj = this.tagObjects.get(strokeLabel);
            if (tagObj) {
                // Update font size in the group
                const textObj = tagObj.getObjects().find(obj => obj.type === 'i-text' || obj.type === 'text');
                if (textObj) {
                    textObj.set('fontSize', this.tagSize);
                    tagObj.setCoords();
                    this.updateConnector(strokeLabel);
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
    
    // Create tag for a stroke when metadata is attached
    createTagForStroke(strokeLabel, imageLabel, strokeObject) {
        // Check if label should be visible
        const isLabelVisible = this.metadataManager.strokeLabelVisibility[imageLabel]?.[strokeLabel] !== false;
        if (!isLabelVisible) return;
        
        this.createTag(strokeLabel, imageLabel, strokeObject);
    }
    
    
    // Clear all tags for an image
    clearTagsForImage(imageLabel) {
        const strokes = this.metadataManager.vectorStrokesByImage[imageLabel] || {};
        Object.keys(strokes).forEach(strokeLabel => {
            this.removeTag(strokeLabel);
        });
    }
    
    // Update tags when stroke visibility changes
    updateTagVisibility(strokeLabel, imageLabel, visible) {
        const tagObj = this.tagObjects.get(strokeLabel);
        if (tagObj) {
            tagObj.set('visible', visible);
            if (tagObj.connectorLine) {
                tagObj.connectorLine.set('visible', visible);
            }
            this.canvas.renderAll();
        }
    }
}

