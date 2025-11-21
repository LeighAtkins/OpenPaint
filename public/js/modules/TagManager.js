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
            return (msg.includes('alphabetical') && msg.includes('CanvasTextBaseline')) || 
                   msg.includes('alphabetical') ||
                   msg.includes('CanvasTextBaseline');
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
                    // Use 'middle' instead of 'alphabetic' which is causing warnings
                    tagText.set('textBaseline', 'middle');
                } catch (e) {
                    // Ignore if property doesn't exist
                }
            }, 0);
        } finally {
            // Restore console methods after a longer delay to catch async warnings
            // Fabric.js may trigger warnings asynchronously during initialization and rendering
            setTimeout(() => {
                console.warn = originalWarn;
                console.error = originalError;
            }, 500);
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
        
        canvas.add(tagGroup);
        this.tagObjects.set(strokeLabel, tagGroup);
        
        // Create connector line
        this.updateConnector(strokeLabel);
        
        return tagGroup;
    }
    
    // Get the closest point on the actual stroke geometry to a given point
    getClosestStrokeEndpoint(strokeObj, targetPoint) {
        if (strokeObj.type === 'line') {
            // For lines, find closest point on the line segment
            return this.getClosestPointOnLine(strokeObj, targetPoint);
        } else if (strokeObj.type === 'group') {
            // For groups (arrows), find the line inside and get closest point
            const objects = strokeObj.getObjects();
            const lineObj = objects.find(obj => obj.type === 'line');
            if (lineObj) {
                return this.getClosestPointOnGroupLine(strokeObj, lineObj, targetPoint);
            }
        } else if (strokeObj.type === 'path') {
            // For paths (curves, freehand), approximate with bounding box edges
            return this.getClosestPointOnPath(strokeObj, targetPoint);
        }
        
        // Fallback to bounding box
        const bounds = strokeObj.getBoundingRect();
        return {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2
        };
    }
    
    // Find closest point on a line to target point
    getClosestPointOnLine(lineObj, targetPoint) {
        // Simple bounding box approach - get closest edge point
        const bounds = lineObj.getBoundingRect();
        
        // Calculate distances to each edge midpoint
        const edgePoints = [
            { x: bounds.left, y: bounds.top + bounds.height / 2 }, // left edge
            { x: bounds.left + bounds.width, y: bounds.top + bounds.height / 2 }, // right edge
            { x: bounds.left + bounds.width / 2, y: bounds.top }, // top edge
            { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height } // bottom edge
        ];
        
        let closestPoint = edgePoints[0];
        let minDistance = this.getDistance(edgePoints[0], targetPoint);
        
        for (let i = 1; i < edgePoints.length; i++) {
            const distance = this.getDistance(edgePoints[i], targetPoint);
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = edgePoints[i];
            }
        }
        
        console.log(`[Connector] Line bounds: ${bounds.left.toFixed(1)},${bounds.top.toFixed(1)} ${bounds.width.toFixed(1)}x${bounds.height.toFixed(1)}`);
        console.log(`[Connector] Target: (${targetPoint.x.toFixed(1)}, ${targetPoint.y.toFixed(1)}), Closest edge: (${closestPoint.x.toFixed(1)}, ${closestPoint.y.toFixed(1)})`);
        
        return { x: closestPoint.x, y: closestPoint.y };
    }
    
    // Find closest point on a line within a group (for arrows)
    getClosestPointOnGroupLine(groupObj, lineObj, targetPoint) {
        // Get group transform
        const groupMatrix = groupObj.calcTransformMatrix();
        const lineMatrix = lineObj.calcTransformMatrix();
        const combinedMatrix = fabric.util.multiplyTransformMatrices(groupMatrix, lineMatrix);
        
        // Transform line endpoints
        const point1 = fabric.util.transformPoint({ x: lineObj.x1, y: lineObj.y1 }, combinedMatrix);
        const point2 = fabric.util.transformPoint({ x: lineObj.x2, y: lineObj.y2 }, combinedMatrix);
        
        // Find closest point on line segment
        const A = targetPoint.x - point1.x;
        const B = targetPoint.y - point1.y;
        const C = point2.x - point1.x;
        const D = point2.y - point1.y;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        
        let param = -1;
        if (lenSq !== 0) {
            param = dot / lenSq;
        }
        
        let closestX, closestY;
        
        if (param < 0) {
            closestX = point1.x;
            closestY = point1.y;
        } else if (param > 1) {
            closestX = point2.x;
            closestY = point2.y;
        } else {
            closestX = point1.x + param * C;
            closestY = point1.y + param * D;
        }
        
        console.log(`[Connector] Arrow line: (${point1.x.toFixed(1)}, ${point1.y.toFixed(1)}) to (${point2.x.toFixed(1)}, ${point2.y.toFixed(1)})`);
        console.log(`[Connector] Target: (${targetPoint.x.toFixed(1)}, ${targetPoint.y.toFixed(1)}), Closest: (${closestX.toFixed(1)}, ${closestY.toFixed(1)})`);
        
        return { x: closestX, y: closestY };
    }
    
    // Find closest point on a path (approximate using bounding box edges)
    getClosestPointOnPath(pathObj, targetPoint) {
        const bounds = pathObj.getBoundingRect();
        
        // Use edge midpoints as approximation for paths/curves
        const edgePoints = [
            {x: bounds.left, y: bounds.top + bounds.height / 2}, // left edge
            {x: bounds.left + bounds.width, y: bounds.top + bounds.height / 2}, // right edge
            {x: bounds.left + bounds.width / 2, y: bounds.top}, // top edge
            {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height} // bottom edge
        ];
        
        let closestPoint = edgePoints[0];
        let minDistance = this.getDistance(edgePoints[0], targetPoint);
        
        for (let i = 1; i < edgePoints.length; i++) {
            const distance = this.getDistance(edgePoints[i], targetPoint);
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = edgePoints[i];
            }
        }
        
        console.log(`[Connector] Path closest edge point: (${closestPoint.x.toFixed(1)}, ${closestPoint.y.toFixed(1)})`);
        return closestPoint;
    }
    
    // Calculate distance between two points
    getDistance(point1, point2) {
        const dx = point1.x - point2.x;
        const dy = point1.y - point2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    // Create a manipulatable connector line
    createManipulatableConnector(tagObj, strokeObj, strokeLabel) {
        const canvas = this.canvas;
        if (!canvas) return null;
        
        // Get tag center
        const tagBounds = tagObj.getBoundingRect();
        const tagCenter = { 
            x: tagBounds.left + tagBounds.width / 2, 
            y: tagBounds.top + tagBounds.height / 2 
        };
        
        // Get closest stroke endpoint
        const strokeEndpoint = this.getClosestStrokeEndpoint(strokeObj, tagCenter);
        
        // Create the connector line with control points
        const connector = new fabric.Line([tagCenter.x, tagCenter.y, strokeEndpoint.x, strokeEndpoint.y], {
            stroke: '#666666',
            strokeWidth: 2,
            strokeDashArray: [8, 4],
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true,
            lockRotation: true,
            lockScalingFlip: true,
            excludeFromExport: true,
            isConnectorLine: true,
            connectedTag: tagObj,
            connectedStroke: strokeObj,
            strokeLabel: strokeLabel
        });
        
        // Override control points to only allow endpoint manipulation
        connector.setControlsVisibility({
            mt: false, // top center
            mb: false, // bottom center  
            ml: false, // left center
            mr: false, // right center
            tl: false, // top left corner
            tr: false, // top right corner
            bl: false, // bottom left corner
            br: false  // bottom right corner
        });
        
        // Custom controls for line endpoints
        connector.controls = {
            ...connector.controls,
            p1: new fabric.Control({
                positionHandler: function(dim, finalMatrix, fabricObject) {
                    return new fabric.Point(fabricObject.x1, fabricObject.y1);
                },
                actionHandler: function(eventData, fabricObject, x, y) {
                    fabricObject.set({x1: x, y1: y});
                    return true;
                },
                cursorStyleHandler: function() {
                    return 'pointer';
                },
                actionName: 'modifyLine',
                render: function(ctx, left, top, styleOverride, fabricObject) {
                    ctx.save();
                    ctx.fillStyle = '#FF6B6B';
                    ctx.beginPath();
                    ctx.arc(left, top, 5, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.restore();
                }
            }),
            p2: new fabric.Control({
                positionHandler: function(dim, finalMatrix, fabricObject) {
                    return new fabric.Point(fabricObject.x2, fabricObject.y2);
                },
                actionHandler: function(eventData, fabricObject, x, y) {
                    fabricObject.set({x2: x, y2: y});
                    return true;
                },
                cursorStyleHandler: function() {
                    return 'pointer';
                },
                actionName: 'modifyLine',
                render: function(ctx, left, top, styleOverride, fabricObject) {
                    ctx.save();
                    ctx.fillStyle = '#4ECDC4';
                    ctx.beginPath();
                    ctx.arc(left, top, 5, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.restore();
                }
            })
        };
        
        // Update connector when it's modified
        connector.on('modified', () => {
            console.log(`[Connector] Line modified for ${strokeLabel}`);
        });
        
        return connector;
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
            tagObj.connectorLine = null;
        }
        
        // Create new manipulatable connector
        const connector = this.createManipulatableConnector(tagObj, strokeObj, strokeLabel);
        if (connector) {
            canvas.add(connector);
            connector.sendToBack(); // Put connector behind everything
            
            // Store reference
            tagObj.connectorLine = connector;
            
            // Force re-render
            setTimeout(() => {
                canvas.requestRenderAll();
            }, 10);
        }
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
                // Update both text and background size
                const textObj = tagObj.getObjects().find(obj => obj.type === 'i-text' || obj.type === 'text');
                const bgObj = tagObj.getObjects().find(obj => !obj.isTagText);
                
                if (textObj && bgObj) {
                    // Update font size
                    textObj.set('fontSize', this.tagSize);
                    
                    // Recalculate text dimensions (Fabric.js needs a render cycle to measure text)
                    setTimeout(() => {
                        const padding = 4;
                        const textWidth = Math.max(textObj.width || 30, textObj.text.length * (this.tagSize * 0.6));
                        const textHeight = textObj.height || this.tagSize;
                        
                        // Update background dimensions
                        if (this.tagShape === 'circle') {
                            const radius = Math.max(textWidth, textHeight) / 2 + padding;
                            bgObj.set('radius', radius);
                        } else {
                            bgObj.set({
                                width: textWidth + padding * 2,
                                height: textHeight + padding * 2
                            });
                        }
                        
                        // Update group coordinates and render
                        tagObj.setCoords();
                        this.updateConnector(strokeLabel);
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
    
    // Create tag for a stroke when metadata is attached
    createTagForStroke(strokeLabel, imageLabel, strokeObject) {
        // Check if label should be visible
        const isLabelVisible = this.metadataManager.strokeLabelVisibility[imageLabel]?.[strokeLabel] !== false;
        if (!isLabelVisible) return;
        
        this.createTag(strokeLabel, imageLabel, strokeObject);
        
        // Update stroke visibility controls to show the new stroke
        if (this.metadataManager.updateStrokeVisibilityControls) {
            setTimeout(() => {
                this.metadataManager.updateStrokeVisibilityControls();
            }, 100); // Small delay to ensure all metadata is properly set
        }
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

