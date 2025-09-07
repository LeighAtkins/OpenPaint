/**
 * JavaScript for shared OpenPaint project viewer
 * Handles loading and displaying shared projects, and collecting customer measurements
 */

class SharedProjectViewer {
    constructor() {
        this.shareId = this.extractShareIdFromUrl();
        this.projectData = null;
        this.shareInfo = null;
        this.canvas = null;
        this.ctx = null;
        this.currentIndex = 0;
        this.currentLabel = null;
        // Label hit rects and drag state
        this.labelRects = [];
        this.isDraggingLabel = false;
        this.draggingStroke = null;
        this.dragAnchorCanvas = null; // {x,y}
        this.dragScale = 1;
        this._renderScheduled = false;
        this.imageCache = {}; // cache HTMLImageElement by imageLabel
        this.showMeasurements = true;
        this.units = 'in'; // 'in' | 'cm'
        
        this.init();
    }
    
    extractShareIdFromUrl() {
        const pathParts = window.location.pathname.split('/');
        return pathParts[pathParts.length - 1];
    }
    
    async init() {
        console.log('Loading shared project:', this.shareId);
        
        this.canvas = document.getElementById('sharedCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Set canvas to responsive sizing like the main canvas
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        
        // Wait for DOM to be ready and get container dimensions
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get the container dimensions and set canvas size
        const container = this.canvas.parentElement;
        const containerRect = container.getBoundingClientRect();
        
        // Use a minimum size if container is not yet sized
        const width = Math.max(containerRect.width, 800);
        const height = Math.max(containerRect.height, 600);
        
        this.canvas.width = width;
        this.canvas.height = height;
        
        console.log('Canvas initialized with dimensions:', this.canvas.width, 'x', this.canvas.height);
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Load the shared project
        await this.loadSharedProject();
    }
    
    scheduleRender() {
        if (this._renderScheduled) return;
        this._renderScheduled = true;
        window.requestAnimationFrame(() => {
            this._renderScheduled = false;
            this.renderProject();
        });
    }

    setupEventListeners() {
        const submitBtn = document.getElementById('submitMeasurements');
        submitBtn.addEventListener('click', () => this.submitMeasurements());
        const prevBtn = document.getElementById('prevImage');
        const nextBtn = document.getElementById('nextImage');
        if (prevBtn) prevBtn.addEventListener('click', () => this.showPreviousImage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.showNextImage());
        const toggle = document.getElementById('toggleShowMeasurements');
        const unitsSel = document.getElementById('unitsSelect');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this.showMeasurements = !!e.target.checked;
                this.renderProject();
            });
        }
        if (unitsSel) {
            unitsSel.addEventListener('change', (e) => {
                this.units = e.target.value === 'cm' ? 'cm' : 'in';
                this.renderProject();
            });
        }
        
        // Handle Enter key in input fields
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                this.submitMeasurements();
            }
        });

        // Canvas click to focus related input and drag-to-move labels
        if (this.canvas) {
            this.canvas.addEventListener('click', () => this.handleCanvasClick());
            this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
            window.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
            window.addEventListener('mouseup', () => this.onCanvasMouseUp());
        }
    }
    
    async loadSharedProject() {
        try {
            this.showLoading(true);
            
            const response = await fetch(`/api/shared/${this.shareId}`);
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || 'Failed to load shared project');
            }
            
            this.projectData = result.projectData;
            this.shareInfo = result.shareInfo;
            
            console.log('Loaded project data:', this.projectData);
            console.log('Project data keys:', Object.keys(this.projectData));
            console.log('Original images:', this.projectData.originalImages);
            console.log('Vector strokes:', this.projectData.vectorStrokesByImage);
            console.log('Line strokes:', this.projectData.lineStrokesByImage);
            console.log('Image scale:', this.projectData.imageScaleByLabel);
            console.log('Image position:', this.projectData.imagePositionByLabel);
            
            // Display project information
            this.displayProjectInfo();
            
            // Render the project on canvas (only once)
            this.renderProject();
            
            // Generate measurement form
            this.generateMeasurementForm();
            
            this.showProject(true);
            console.log('Shared project loaded and displayed successfully');
            
        } catch (error) {
            console.error('Error loading shared project:', error);
            this.showError(error.message);
        } finally {
            this.showLoading(false);
        }
    }
    
    displayProjectInfo() {
        const createdEl = document.getElementById('projectCreated');
        const expiresEl = document.getElementById('projectExpires');
        
        createdEl.textContent = new Date(this.shareInfo.createdAt).toLocaleDateString();
        expiresEl.textContent = new Date(this.shareInfo.expiresAt).toLocaleDateString();
    }
    
    renderProject() {
        if (!this.projectData) return;
        
        // Prevent multiple renders during initialization
        if (this._isRendering) {
            console.log('Render already in progress, skipping');
            return;
        }
        this._isRendering = true;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // TODO: Remove this line if not implementing click-to-focus functionality
        this.labelRects = [];
        
        // Set canvas background
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Get the current image (prioritize first available image)
        let imageLabels = this.projectData.imageLabels || [];
        // Fallbacks if imageLabels missing
        if (!imageLabels.length && this.projectData.originalImages) {
            imageLabels = Object.keys(this.projectData.originalImages);
        }
        if (!imageLabels.length && this.projectData.strokeSequence) {
            imageLabels = Object.keys(this.projectData.strokeSequence);
        }
        if (!imageLabels.length) {
            console.warn('No images available to render');
            return;
        }
        
        // Set current index/label if not set - only set once to avoid cycling
        if (this.currentLabel === null) {
            this.currentIndex = 0;
            this.currentLabel = this.projectData.currentImageLabel || imageLabels[0];
            console.log('Set initial image label:', this.currentLabel);
        }
        
        const currentLabel = this.currentLabel;
        console.log('Rendering image:', currentLabel);
        const nameEl = document.getElementById('currentImageName');
        if (nameEl) nameEl.textContent = (this.projectData.customImageNames?.[currentLabel]) || currentLabel;
        
        // Get scale and position from project data (using saved project structure)
        let scale = this.projectData.imageScales?.[currentLabel];
        let position = this.projectData.imagePositions?.[currentLabel] || { x: 0, y: 0 };
        
        // Safety: clamp/normalize absurd or missing values
        if (!Number.isFinite(scale) || scale <= 0) scale = 1.0;
        scale = Math.max(0.05, Math.min(5, scale));
        
        // Handle extreme position values - if they're very large negative numbers, reset to center
        console.log('Raw position from project data:', JSON.stringify(position));
        if (!Number.isFinite(position.x) || Math.abs(position.x) > 1000) {
            console.log('Resetting extreme X position from', position.x, 'to 0');
            position.x = 0;
        }
        if (!Number.isFinite(position.y) || Math.abs(position.y) > 1000) {
            console.log('Resetting extreme Y position from', position.y, 'to 0');
            position.y = 0;
        }
        console.log('Final position after sanitization:', position);
        
        // Load and display the image if available
        if (currentLabel && this.projectData.originalImages && this.projectData.originalImages[currentLabel]) {
            this.loadAndDisplayImage(currentLabel, scale, position);
        } else {
            // No image; still draw strokes with proper scale and position
            // Use the same logic as main paint.js for blank canvas
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Use default scale and center position when no image
            const canvasCenterX = this.canvas.width / 2;
            const canvasCenterY = this.canvas.height / 2;
            
            // Apply the position offset to the center coordinates
            const imageX = canvasCenterX + position.x;
            const imageY = canvasCenterY + position.y;
            
            this.drawStrokes(currentLabel, scale, imageX, imageY);
        }
        
        this._isRendering = false;
    }

    showPreviousImage() {
        console.log('Manual navigation: Previous image');
        // Get image labels from the same source as renderProject
        let imageLabels = this.projectData.imageLabels || [];
        if (!imageLabels.length && this.projectData.originalImages) {
            imageLabels = Object.keys(this.projectData.originalImages);
        }
        if (!imageLabels.length && this.projectData.strokeSequence) {
            imageLabels = Object.keys(this.projectData.strokeSequence);
        }
        
        if (!imageLabels.length) return;
        
        this.currentIndex = (this.currentIndex - 1 + imageLabels.length) % imageLabels.length;
        this.currentLabel = imageLabels[this.currentIndex];
        this.renderProject();
        this.generateMeasurementForm();
        this.showProject(true);
    }

    showNextImage() {
        console.log('Manual navigation: Next image');
        // Get image labels from the same source as renderProject
        let imageLabels = this.projectData.imageLabels || [];
        if (!imageLabels.length && this.projectData.originalImages) {
            imageLabels = Object.keys(this.projectData.originalImages);
        }
        if (!imageLabels.length && this.projectData.strokeSequence) {
            imageLabels = Object.keys(this.projectData.strokeSequence);
        }
        
        if (!imageLabels.length) return;
        
        this.currentIndex = (this.currentIndex + 1) % imageLabels.length;
        this.currentLabel = imageLabels[this.currentIndex];
        this.renderProject();
        this.generateMeasurementForm();
        this.showProject(true);
    }
    
    async loadAndDisplayImage(imageLabel, scale, position) {
        try {
            const imageUrl = this.projectData.originalImages[imageLabel];
            if (!imageUrl) return;
            const cached = this.imageCache[imageLabel];
            const drawWith = (img) => {
                // Use the same logic as main paint.js for positioning
                // Calculate center of canvas for positioning
                const centerX = (this.canvas.width - img.width * scale) / 2;
                const centerY = (this.canvas.height - img.height * scale) / 2;
                
                // Get final position with offset - use the same logic as main paint.js
                let imageX = centerX + position.x;
                let imageY = centerY + position.y;

                // Safety: if the computed image rect is completely off-canvas, recenter
                const imageRect = { x: imageX, y: imageY, w: img.width * scale, h: img.height * scale };
                const offscreen = (imageRect.x + imageRect.w < 0) || (imageRect.y + imageRect.h < 0) ||
                                  (imageRect.x > this.canvas.width) || (imageRect.y > this.canvas.height);
                if (offscreen) {
                    console.log('Image would be off-screen, recentering');
                    imageX = (this.canvas.width - imageRect.w) / 2;
                    imageY = (this.canvas.height - imageRect.h) / 2;
                }
                
                console.log('Image positioning:', JSON.stringify({
                    canvasSize: `${this.canvas.width}x${this.canvas.height}`,
                    imageSize: `${img.width}x${img.height}`,
                    scale: scale,
                    centerX: centerX,
                    centerY: centerY,
                    position: position,
                    finalX: imageX,
                    finalY: imageY
                }));
                
                // Clear the canvas to white
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.fillStyle = 'white';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

                // Draw the image
                this.ctx.drawImage(img, imageX, imageY, img.width * scale, img.height * scale);
                
                // Redraw strokes on top of image using the same coordinate system
                this.drawStrokes(imageLabel, scale, imageX, imageY);
            };

            if (cached && cached.complete && cached.naturalWidth > 0) {
                drawWith(cached);
                return;
            }

            // If we have started loading before, reuse same element to prevent flicker
            const img = cached || new Image();
            if (!cached) {
                this.imageCache[imageLabel] = img;
                img.onload = () => drawWith(img);
                img.onerror = () => {
                    console.warn('Failed to load image for label:', imageLabel);
                    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    this.ctx.fillStyle = 'white';
                    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                    this.drawStrokes(imageLabel, scale, position);
                };
                img.src = imageUrl;
            } else {
                // Image element exists but not complete yet; keep previous frame, strokes will update once loaded
                // Draw interim frame without redownloading
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.fillStyle = 'white';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.drawStrokes(imageLabel, scale, (this.canvas.width - (this.projectData.originalImageDimensions?.[imageLabel]?.width || 0) * scale) / 2 + position.x, (this.canvas.height - (this.projectData.originalImageDimensions?.[imageLabel]?.height || 0) * scale) / 2 + position.y);
            }
        } catch (error) {
            console.error('Error loading image:', error);
            this.drawStrokes(imageLabel, scale, position);
        }
    }
    
    drawStrokes(imageLabel, imageScale = 1, imageX = 0, imageY = 0) {
        // Use the correct data structure from saved project data
        const strokes = this.projectData.strokes?.[imageLabel] || {};
        const strokeVisibility = this.projectData.strokeVisibility?.[imageLabel] || {};
        const strokeLabels = this.projectData.strokeSequence?.[imageLabel] || [];
        
        // Draw each visible stroke
        strokeLabels.forEach(strokeLabel => {
            if (strokeVisibility[strokeLabel] === false) return;
            
            const strokeData = strokes[strokeLabel];
            if (!strokeData) return;
            
            this.drawSingleStroke(strokeData, strokeLabel, imageScale, imageX, imageY);
        });
    }
    
    drawSingleStroke(strokeData, strokeLabel, scale = 1, offsetX = 0, offsetY = 0) {
        if (!strokeData.points || strokeData.points.length === 0) return;
        
        this.ctx.save();
        
        // Set stroke properties
        this.ctx.strokeStyle = strokeData.color || '#000000';
        this.ctx.lineWidth = (strokeData.width || 2) * scale;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Begin path
        this.ctx.beginPath();
        
        // Draw the stroke
        if (strokeData.type === 'straight' || strokeData.type === 'arrow') {
            // Straight line
            if (strokeData.points.length >= 2) {
                const start = this.transformPoint(strokeData.points[0], scale, offsetX, offsetY);
                const end = this.transformPoint(strokeData.points[strokeData.points.length - 1], scale, offsetX, offsetY);
                
                this.ctx.moveTo(start.x, start.y);
                this.ctx.lineTo(end.x, end.y);
                if (strokeData.type === 'arrow') {
                    this.drawArrowHead(end, start, 10 * Math.max(1, scale), strokeData.color || '#000');
                }
            }
        } else {
            // Freehand or curved line
            strokeData.points.forEach((point, index) => {
                const transformedPoint = this.transformPoint(point, scale, offsetX, offsetY);
                
                if (index === 0) {
                    this.ctx.moveTo(transformedPoint.x, transformedPoint.y);
                } else {
                    this.ctx.lineTo(transformedPoint.x, transformedPoint.y);
                }
            });
        }
        
        this.ctx.stroke();
        
        // Draw label if available
        this.drawStrokeLabel(strokeData, strokeLabel, scale, offsetX, offsetY);
        
        this.ctx.restore();
    }

    drawArrowHead(tip, tail, size, color) {
        const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
        this.ctx.save();
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(tip.x, tip.y);
        this.ctx.lineTo(tip.x - size * Math.cos(angle - Math.PI / 6), tip.y - size * Math.sin(angle - Math.PI / 6));
        this.ctx.lineTo(tip.x - size * Math.cos(angle + Math.PI / 6), tip.y - size * Math.sin(angle + Math.PI / 6));
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();
    }
    
    drawStrokeLabel(strokeData, strokeLabel, scale, offsetX, offsetY) {
        if (!strokeData.points || strokeData.points.length === 0) return;

        // Respect label visibility if provided
        const labelVisible = this.projectData.strokeLabelVisibility?.[this.currentLabel]?.[strokeLabel];
        if (labelVisible === false) return;

        // Anchor similar to editor
        let anchor;
        if (strokeData.type === 'straight' || strokeData.type === 'arrow') {
            const a = this.transformPoint(strokeData.points[0], scale, offsetX, offsetY);
            const b = this.transformPoint(strokeData.points[strokeData.points.length - 1], scale, offsetX, offsetY);
            anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        } else {
            const midIndex = Math.floor(strokeData.points.length / 2);
            anchor = this.transformPoint(strokeData.points[midIndex], scale, offsetX, offsetY);
        }

        // Apply custom offset (image space → canvas space using scale)
        // Use the same logic as main paint.js for label positioning
        const customOffset = this.projectData.customLabelPositions?.[this.currentLabel]?.[strokeLabel] || { x: 0, y: 0 };
        
        // Use custom offset (calculatedLabelOffsets might not be saved in project data)
        const finalOffset = customOffset;
        
        const labelCenter = {
            x: anchor.x + (finalOffset.x || 0) * scale,
            y: anchor.y + (finalOffset.y || 0) * scale
        };

        // Compose label text (just tag inside circle)
        const labelText = strokeLabel;
        // Optional measurement text shown alongside
        const rawMeasurement = this.projectData.strokeMeasurements?.[this.currentLabel]?.[strokeLabel]?.value;
        const measurementText = this.showMeasurements && rawMeasurement ? this.formatMeasurement(rawMeasurement) : null;

        // Sizing
        const radius = Math.max(10, 14 * scale);
        const fontSize = Math.max(10, 12 * scale);
        this.ctx.font = `${fontSize}px Arial`;
        const textMetrics = this.ctx.measureText(labelText);
        const textHalfWidth = textMetrics.width / 2;

        // Circle background
        this.ctx.fillStyle = 'rgba(255,255,255,0.95)';
        this.ctx.beginPath();
        this.ctx.arc(labelCenter.x, labelCenter.y, radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = strokeData.color || '#000';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        // Dotted connector from anchor to label box center
        this.ctx.save();
        this.ctx.setLineDash([4, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(anchor.x, anchor.y);
        this.ctx.lineTo(labelCenter.x, labelCenter.y);
        this.ctx.stroke();
        this.ctx.restore();

        // Label text centered inside circle
        this.ctx.fillStyle = '#000';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(labelText, labelCenter.x - textHalfWidth, labelCenter.y);

        // Optional measurement text to the right of the circle
        if (measurementText) {
            const mFont = Math.max(10, 11 * scale);
            this.ctx.font = `${mFont}px Arial`;
            const mx = labelCenter.x + radius + 6 * Math.max(1, scale);
            const my = labelCenter.y;
            this.ctx.fillText(measurementText, mx, my);
        }

        // Track rects for hit-testing during drag
        // Hit circle as rect bounds for simplicity
        const box = { x: labelCenter.x - radius, y: labelCenter.y - radius, w: radius * 2, h: radius * 2 };
        this.labelRects.push({ imageLabel: this.currentLabel, strokeLabel, rect: box, anchor, scale });
    }

    formatMeasurement(raw) {
        // If stored string already has unit, just return as-is
        if (typeof raw === 'string') {
            if (this.units === 'in') return raw;
            // best-effort parse number and convert to cm
            const num = parseFloat(raw);
            if (Number.isFinite(num)) {
                const cm = num * 2.54;
                return `${cm.toFixed(1)} cm`;
            }
            return raw;
        }
        if (typeof raw === 'number') {
            if (this.units === 'in') return `${raw.toFixed(2)} in`;
            return `${(raw * 2.54).toFixed(1)} cm`;
        }
        if (raw && typeof raw === 'object' && ('value' in raw)) {
            return this.formatMeasurement(raw.value);
        }
        return '';
    }
    
    transformPoint(point, scale, offsetX, offsetY) {
        // Use the same coordinate transformation as main paint.js
        // Points are stored in image-relative coordinates, need to transform to canvas coordinates
        return {
            x: point.x * scale + offsetX,
            y: point.y * scale + offsetY
        };
    }
    
    generateMeasurementForm() {
        const formContainer = document.getElementById('measurementsForm');
        const strokes = this.extractStrokesForCurrent();
        
        if (strokes.length === 0) {
            formContainer.innerHTML = '<p style="text-align: center; color: #666;">No measurements found in this project.</p>';
            return;
        }
        
        formContainer.innerHTML = '<div class="measurement-grid"></div>';
        const grid = formContainer.querySelector('.measurement-grid');
        
        strokes.forEach(stroke => {
            const formGroup = document.createElement('div');
            formGroup.className = 'form-group';
            
            formGroup.innerHTML = `
                <label for="measure_${stroke.label}">
                    ${stroke.label} <span style="color: #666;">(${stroke.imageLabel})</span>:
                </label>
                <input 
                    type="text" 
                    id="measure_${stroke.label}" 
                    data-stroke="${stroke.label}"
                    data-image="${stroke.imageLabel}"
                    placeholder="Enter measurement (e.g., 24 inches, 60cm)"
                >
            `;
            
            grid.appendChild(formGroup);
        });

        // Attach listeners to update labels live
        const inputs = formContainer.querySelectorAll('input[data-stroke]');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                const strokeLabel = input.dataset.stroke;
                const imageLabel = input.dataset.image;
                const value = input.value.trim();
                this.projectData.strokeMeasurements = this.projectData.strokeMeasurements || {};
                this.projectData.strokeMeasurements[imageLabel] = this.projectData.strokeMeasurements[imageLabel] || {};
                this.projectData.strokeMeasurements[imageLabel][strokeLabel] = { value, submittedAt: new Date().toISOString() };
                this.renderProject();
            });
        });
    }
    
    extractStrokesForCurrent() {
        const result = [];
        const label = this.currentLabel;
        if (!label || !this.projectData.strokeSequence) return result;
        const strokeLabels = this.projectData.strokeSequence[label] || [];
        strokeLabels.forEach(strokeLabel => result.push({ label: strokeLabel, imageLabel: label }));
        return result;
    }

    handleCanvasClick() {
        // Naive hit test: focus the first input (enhance later with per-stroke proximity)
        const first = document.querySelector('#measurementsForm input[data-stroke]');
        if (first) first.focus();
    }

    // ===== Label Dragging =====
    getMousePos(evt) {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((evt.clientX - rect.left) / rect.width) * this.canvas.width;
        const y = ((evt.clientY - rect.top) / rect.height) * this.canvas.height;
        return { x, y };
    }

    onCanvasMouseDown(evt) {
        if (!this.projectData) return;
        const pos = this.getMousePos(evt);
        // Check top-most label first
        for (let i = this.labelRects.length - 1; i >= 0; i--) {
            const entry = this.labelRects[i];
            const r = entry.rect;
            if (pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h) {
                this.isDraggingLabel = true;
                this.draggingStroke = { imageLabel: entry.imageLabel, strokeLabel: entry.strokeLabel };
                this.dragAnchorCanvas = entry.anchor; // canvas coords
                this.dragScale = entry.scale || 1;
                evt.preventDefault();
                break;
            }
        }
    }

    onCanvasMouseMove(evt) {
        if (!this.isDraggingLabel || !this.draggingStroke) return;
        const pos = this.getMousePos(evt);
        const newOffset = {
            x: (pos.x - this.dragAnchorCanvas.x) / this.dragScale,
            y: (pos.y - this.dragAnchorCanvas.y) / this.dragScale
        };
        const { imageLabel, strokeLabel } = this.draggingStroke;
        this.projectData.customLabelPositions = this.projectData.customLabelPositions || {};
        this.projectData.customLabelPositions[imageLabel] = this.projectData.customLabelPositions[imageLabel] || {};
        this.projectData.customLabelPositions[imageLabel][strokeLabel] = newOffset;
        this.scheduleRender();
    }

    onCanvasMouseUp() {
        if (this.isDraggingLabel) {
            this.isDraggingLabel = false;
            this.draggingStroke = null;
            this.dragAnchorCanvas = null;
        }
    }
    
    async submitMeasurements() {
        try {
            this.showSubmitLoading(true);
            
            // Collect measurements
            const measurements = {};
            const measurementInputs = document.querySelectorAll('input[data-stroke]');
            
            measurementInputs.forEach(input => {
                const value = input.value.trim();
                if (value) {
                    const strokeLabel = input.dataset.stroke;
                    const imageLabel = input.dataset.image;
                    
                    if (!measurements[imageLabel]) {
                        measurements[imageLabel] = {};
                    }
                    
                    measurements[imageLabel][strokeLabel] = {
                        value: value,
                        submittedAt: new Date().toISOString()
                    };
                }
            });
            
            // Collect customer info
            const customerInfo = {
                name: document.getElementById('customerName').value.trim(),
                email: document.getElementById('customerEmail').value.trim()
            };
            
            // Validate that at least some measurements were provided
            const totalMeasurements = Object.values(measurements).reduce((total, imageMeasurements) => {
                return total + Object.keys(imageMeasurements).length;
            }, 0);
            
            if (totalMeasurements === 0) {
                throw new Error('Please provide at least one measurement');
            }
            
            // Submit to server
            const response = await fetch(`/api/shared/${this.shareId}/measurements`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    measurements: measurements,
                    customerInfo: customerInfo
                })
            });
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || 'Failed to submit measurements');
            }
            
            this.showSubmitResult('success', 'Measurements submitted successfully! Thank you for your input.');
            
            // Disable the form
            measurementInputs.forEach(input => input.disabled = true);
            document.getElementById('customerName').disabled = true;
            document.getElementById('customerEmail').disabled = true;
            document.getElementById('submitMeasurements').disabled = true;
            
        } catch (error) {
            console.error('Error submitting measurements:', error);
            this.showSubmitResult('error', error.message);
        } finally {
            this.showSubmitLoading(false);
        }
    }
    
    showLoading(show) {
        document.getElementById('loadingSection').style.display = show ? 'block' : 'none';
    }
    
    showProject(show) {
        document.getElementById('projectSection').style.display = show ? 'block' : 'none';
    }
    
    showError(message) {
        document.getElementById('errorMessage').textContent = message;
        document.getElementById('errorSection').style.display = 'block';
    }
    
    showSubmitLoading(show) {
        document.getElementById('submitLoading').style.display = show ? 'block' : 'none';
    }
    
    showSubmitResult(type, message) {
        const resultDiv = document.getElementById('submitResult');
        resultDiv.className = `alert alert-${type}`;
        resultDiv.innerHTML = `<strong>${type === 'success' ? 'Success!' : 'Error:'}</strong> ${message}`;
        resultDiv.style.display = 'block';
    }
}

// Initialize the shared project viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new SharedProjectViewer();
});
