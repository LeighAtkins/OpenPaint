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
        this.showMeasurements = true; // Show measurements by default
        
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
                textBaseline: 'middle',
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
                evented: true
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
                evented: true
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
            hasControls: false,
            hasBorders: false,
            lockRotation: true,
            hoverCursor: 'move',
            // Custom properties
            isTag: true,
            strokeLabel: strokeLabel,
            imageLabel: imageLabel,
            connectedStroke: strokeObject,
            tagOffset: { x: 20, y: -10 } // Default offset
        });
        
        // Update connector line when tag moves
        tagGroup.on('moving', () => {
            // Update offset based on new position
            const strokeBounds = strokeObject.getBoundingRect(true);
            const strokeCenter = {
                x: strokeBounds.left + strokeBounds.width / 2,
                y: strokeBounds.top + strokeBounds.height / 2
            };
            
            tagGroup.tagOffset = {
                x: tagGroup.left - strokeCenter.x,
                y: tagGroup.top - strokeCenter.y
            };
            
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
        tagGroup.on('mouse:down', (e) => {
            // Only if not already editing the text
            if (!tagText.isEditing) {
                // Focus the measurement input for this stroke
                if (this.metadataManager && this.metadataManager.focusMeasurementInput) {
                    this.metadataManager.focusMeasurementInput(strokeLabel);
                } else {
                    console.warn('[TagManager] metadataManager or focusMeasurementInput not available');
                }
            }
        });
        
        // Also try selection event
        tagGroup.on('selected', () => {
            if (!tagText.isEditing && this.metadataManager && this.metadataManager.focusMeasurementInput) {
                this.metadataManager.focusMeasurementInput(strokeLabel);
            }
        });
        
        canvas.add(tagGroup);
        this.tagObjects.set(strokeLabel, tagGroup);
        
        // Register global click handler for tags (fallback if object events don't fire)
        // This ensures clicks work even when drawing tools are active
        if (!this._globalTagClickHandlerRegistered) {
            canvas.on('mouse:down', (options) => {
                const target = options.target;
                if (target && target.isTag) {
                    const strokeLabel = target.strokeLabel;
                    const textObj = target.getObjects().find(obj => obj.isTagText);
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
            // For paths (curves, freehand), use actual path points
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
        // Get line endpoints in canvas coordinates
        const points = lineObj.calcLinePoints();
        
        // Calculate absolute center of the line
        let center = lineObj.getCenterPoint();
        if (lineObj.group) {
            const groupMatrix = lineObj.group.calcTransformMatrix();
            center = fabric.util.transformPoint(center, groupMatrix);
        }
        
        // Calculate the vector from center to endpoints using the matrix for rotation/scale only
        // We do this by transforming (0,0) and (x,y) and taking the difference
        // This avoids any translation issues in the matrix multiplication
        
        // 1. Get the total transform matrix
        let matrix = lineObj.calcTransformMatrix();
        if (lineObj.group) {
            const groupMatrix = lineObj.group.calcTransformMatrix();
            matrix = fabric.util.multiplyTransformMatrices(groupMatrix, matrix);
        }
        
        // 2. Calculate vectors
        const origin = fabric.util.transformPoint({ x: 0, y: 0 }, matrix);
        const p1_transformed = fabric.util.transformPoint({ x: points.x1, y: points.y1 }, matrix);
        const p2_transformed = fabric.util.transformPoint({ x: points.x2, y: points.y2 }, matrix);
        
        const vec1 = { x: p1_transformed.x - origin.x, y: p1_transformed.y - origin.y };
        const vec2 = { x: p2_transformed.x - origin.x, y: p2_transformed.y - origin.y };
        
        // 3. Apply vectors to the correct absolute center
        const point1 = { x: center.x + vec1.x, y: center.y + vec1.y };
        const point2 = { x: center.x + vec2.x, y: center.y + vec2.y };

        // Project targetPoint onto line segment using vector math
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

        return { x: closestX, y: closestY };
    }
    
    // Find closest point on a line within a group (for arrows)
    getClosestPointOnGroupLine(groupObj, lineObj, targetPoint) {
        // Use calcLinePoints to get coordinates relative to the line's center
        const points = lineObj.calcLinePoints();
        
        // Step 1: Transform from Line Local to Group Local
        const lineMatrix = lineObj.calcTransformMatrix();
        let point1 = fabric.util.transformPoint({ x: points.x1, y: points.y1 }, lineMatrix);
        let point2 = fabric.util.transformPoint({ x: points.x2, y: points.y2 }, lineMatrix);
        
        // Step 2: Transform from Group Local to Parent Space (Canvas or ActiveSelection)
        const groupMatrix = groupObj.calcTransformMatrix();
        point1 = fabric.util.transformPoint(point1, groupMatrix);
        point2 = fabric.util.transformPoint(point2, groupMatrix);
        
        // Step 3: If group is in another group (activeSelection), transform to Canvas Space
        if (groupObj.group) {
            const parentMatrix = groupObj.group.calcTransformMatrix();
            point1 = fabric.util.transformPoint(point1, parentMatrix);
            point2 = fabric.util.transformPoint(point2, parentMatrix);
        }
        
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
        
        return { x: closestX, y: closestY };
    }

    // Find closest point on a path (curves, freehand drawings)
    getClosestPointOnPath(pathObj, targetPoint) {
        // Option A: Use customPoints if available (CurveTool curves have these)
        // Disabled because customPoints might be stale if object is moved/transformed
        /* if (pathObj.customPoints && pathObj.customPoints.length > 0) {
            return this.getClosestPointFromArray(pathObj.customPoints, targetPoint);
        } */

        // Option B: Sample SVG path for freehand drawings and other paths
        if (pathObj.path && pathObj.path.length > 0) {
            const sampledPoints = this.samplePathPoints(pathObj, 30);
            if (sampledPoints.length > 0) {
                return this.getClosestPointFromArray(sampledPoints, targetPoint);
            }
        }

        // Option C: Fallback to bounding box edges
        return this.getClosestPointOnBoundingBox(pathObj, targetPoint);
    }

    // Find closest point from an array of points
    getClosestPointFromArray(points, targetPoint) {
        if (points.length === 0) return targetPoint;

        let closestPoint = points[0];
        let minDistance = this.calculateDistance(points[0], targetPoint);

        for (let i = 1; i < points.length; i++) {
            const distance = this.calculateDistance(points[i], targetPoint);
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = points[i];
            }
        }

        return { x: closestPoint.x || closestPoint.x === 0 ? closestPoint.x : 0,
                 y: closestPoint.y || closestPoint.y === 0 ? closestPoint.y : 0 };
    }

    // Sample points along an SVG path
    samplePathPoints(pathObj, numSamples = 30) {
        const points = [];
        const pathData = pathObj.path;
        
        // 1. Calculate the correct absolute center
        let centerAbs = pathObj.getCenterPoint();
        if (pathObj.group) {
            const groupMatrix = pathObj.group.calcTransformMatrix();
            centerAbs = fabric.util.transformPoint(centerAbs, groupMatrix);
        }
        
        // 2. Calculate the "buggy" center (using matrix multiplication which doubles translation)
        // For fabric.Path, (pathOffset.x, pathOffset.y) is the center in local path coordinates
        const pathCenterLocal = { x: pathObj.pathOffset.x, y: pathObj.pathOffset.y };
        
        let matrix = pathObj.calcTransformMatrix();
        if (pathObj.group) {
            const groupMatrix = pathObj.group.calcTransformMatrix();
            matrix = fabric.util.multiplyTransformMatrices(groupMatrix, matrix);
        }
        
        const centerBuggy = fabric.util.transformPoint(pathCenterLocal, matrix);
        
        // Helper to transform point to absolute coordinates using vector from center
        const transformToAbsolute = (p) => {
            // Transform point using the "buggy" matrix
            const pBuggy = fabric.util.transformPoint(p, matrix);
            
            // Calculate vector from center
            const vec = { 
                x: pBuggy.x - centerBuggy.x, 
                y: pBuggy.y - centerBuggy.y 
            };
            
            // Add vector to the correct absolute center
            return { 
                x: centerAbs.x + vec.x, 
                y: centerAbs.y + vec.y 
            };
        };

        let currentPoint = { x: 0, y: 0 };

        for (const segment of pathData) {
            const command = segment[0];

            if (command === 'M') {
                currentPoint = { x: segment[1], y: segment[2] };
                const absPoint = transformToAbsolute(currentPoint);
                points.push(absPoint);
            } else if (command === 'L') {
                const endPoint = { x: segment[1], y: segment[2] };
                const samples = this.sampleLine(currentPoint, endPoint, 5);
                samples.forEach(p => {
                    const absPoint = transformToAbsolute(p);
                    points.push(absPoint);
                });
                currentPoint = endPoint;
            } else if (command === 'C') {
                const cp1 = { x: segment[1], y: segment[2] };
                const cp2 = { x: segment[3], y: segment[4] };
                const endPoint = { x: segment[5], y: segment[6] };

                const samples = this.sampleCubicBezier(currentPoint, cp1, cp2, endPoint, 10);
                samples.forEach(p => {
                    const absPoint = transformToAbsolute(p);
                    points.push(absPoint);
                });
                currentPoint = endPoint;
            } else if (command === 'Q') {
                const cp = { x: segment[1], y: segment[2] };
                const endPoint = { x: segment[3], y: segment[4] };

                const samples = this.sampleQuadraticBezier(currentPoint, cp, endPoint, 10);
                samples.forEach(p => {
                    const absPoint = fabric.util.transformPoint(p, matrix);
                    points.push(absPoint);
                });
                currentPoint = endPoint;
            }
        }

        return points;
    }

    // Sample points along a line
    sampleLine(p0, p1, numSamples = 5) {
        const points = [];
        for (let i = 0; i <= numSamples; i++) {
            const t = i / numSamples;
            points.push({
                x: p0.x + t * (p1.x - p0.x),
                y: p0.y + t * (p1.y - p0.y)
            });
        }
        return points;
    }

    // Sample points along a cubic Bezier curve
    sampleCubicBezier(p0, cp1, cp2, p1, numSamples = 10) {
        const points = [];
        for (let i = 0; i <= numSamples; i++) {
            const t = i / numSamples;
            points.push(this.cubicBezierPoint(p0, cp1, cp2, p1, t));
        }
        return points;
    }

    // Calculate point on cubic Bezier curve at parameter t (0 to 1)
    cubicBezierPoint(p0, cp1, cp2, p1, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;

        return {
            x: mt3 * p0.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * p1.x,
            y: mt3 * p0.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * p1.y
        };
    }

    // Sample points along a quadratic Bezier curve
    sampleQuadraticBezier(p0, cp, p1, numSamples = 10) {
        const points = [];
        for (let i = 0; i <= numSamples; i++) {
            const t = i / numSamples;
            points.push(this.quadraticBezierPoint(p0, cp, p1, t));
        }
        return points;
    }

    // Calculate point on quadratic Bezier curve at parameter t (0 to 1)
    quadraticBezierPoint(p0, cp, p1, t) {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;

        return {
            x: mt2 * p0.x + 2 * mt * t * cp.x + t2 * p1.x,
            y: mt2 * p0.y + 2 * mt * t * cp.y + t2 * p1.y
        };
    }

    // Get closest point on bounding box (fallback)
    getClosestPointOnBoundingBox(pathObj, targetPoint) {
        const bounds = pathObj.getBoundingRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;

        const edgePoints = [
            { x: bounds.left, y: centerY },
            { x: bounds.left + bounds.width, y: centerY },
            { x: centerX, y: bounds.top },
            { x: centerX, y: bounds.top + bounds.height }
        ];

        let closestPoint = edgePoints[0];
        let minDistance = this.calculateDistance(edgePoints[0], targetPoint);

        for (let i = 1; i < edgePoints.length; i++) {
            const distance = this.calculateDistance(edgePoints[i], targetPoint);
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = edgePoints[i];
            }
        }

        return closestPoint;
    }

    // Calculate distance between two points
    calculateDistance(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
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
        
        // Create the connector line (non-interactive, just visual feedback)
        const connector = new fabric.Line([tagCenter.x, tagCenter.y, strokeEndpoint.x, strokeEndpoint.y], {
            stroke: '#666666',
            strokeWidth: 2,
            strokeDashArray: [8, 4],
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
            strokeLabel: strokeLabel
        });

        return connector;
    }
    
    // Update connector line between tag and stroke
    updateConnector(strokeLabel) {
        const canvas = this.canvas;
        if (!canvas) return;

        const tagObj = this.tagObjects.get(strokeLabel);
        if (!tagObj) return;
        const connectedStrokeObj = tagObj.connectedStroke;
        if (!connectedStrokeObj) return;

        // Reposition tag to maintain its offset from the stroke
        // Only if tag is NOT part of an active selection (multi-select)
        // If it IS in active selection, Fabric handles the movement
        const activeObject = canvas.getActiveObject();
        const isTagInSelection = activeObject && 
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
                const tagOffset = tagObj.tagOffset || { x: 20, y: -10 };
                const newTagLeft = strokeCenter.x + tagOffset.x;
                const newTagTop = strokeCenter.y + tagOffset.y;

                // Update tag position to maintain offset from stroke
                tagObj.set({
                    left: newTagLeft,
                    top: newTagTop
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
        
        console.log(`[ConnectorDebug] ${strokeLabel} Tag: (${tagCenter.x.toFixed(0)}, ${tagCenter.y.toFixed(0)}) Stroke: (${strokeEndpoint.x.toFixed(0)}, ${strokeEndpoint.y.toFixed(0)})`);
        
        // Check if connector already exists
        let connector = tagObj.connectorLine;
        
        if (connector && canvas.contains(connector)) {
            // For fabric.Line objects, updating endpoints requires proper recreation
            // Just setting x1,y1,x2,y2 doesn't update the line's visual position correctly

            // Remove the old connector and create a new one
            canvas.remove(connector);

            // Create new connector with updated endpoints
            connector = new fabric.Line([tagCenter.x, tagCenter.y, strokeEndpoint.x, strokeEndpoint.y], {
                stroke: '#666666',
                strokeWidth: 2,
                strokeDashArray: [8, 4],
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
                strokeLabel: strokeLabel
            });

            canvas.add(connector);
            connector.sendToBack();
            tagObj.connectorLine = connector;
        } else {
            // Create new connector
            connector = this.createManipulatableConnector(tagObj, connectedStrokeObj, strokeLabel);
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
    
    // Update tag text when measurement changes
    updateTagText(strokeLabel, imageLabel) {
        const tagObj = this.tagObjects.get(strokeLabel);
        if (!tagObj) {
            console.warn(`[TagManager] No tag found for ${strokeLabel}`);
            return;
        }
        
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
        
        // Force text to recalculate dimensions
        textObj.initDimensions();
        textObj.setCoords();
        
        // Update background size to match new text
        const bgObj = tagObj.getObjects().find(obj => !obj.isTagText);
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
            top: savedTop
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
    
    // Toggle showing measurements on all tags
    setShowMeasurements(show) {
        this.showMeasurements = show;
        
        // Update all existing tags
        const currentViewId = window.app?.projectManager?.currentViewId || 'front';
        const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};
        
        Object.keys(strokes).forEach(strokeLabel => {
            this.updateTagText(strokeLabel, currentViewId);
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

