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
        this.labelRects = [];
        
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
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Load the shared project
        await this.loadSharedProject();
    }
    
    setupEventListeners() {
        const submitBtn = document.getElementById('submitMeasurements');
        submitBtn.addEventListener('click', () => this.submitMeasurements());
        const prevBtn = document.getElementById('prevImage');
        const nextBtn = document.getElementById('nextImage');
        if (prevBtn) prevBtn.addEventListener('click', () => this.showPreviousImage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.showNextImage());
        
        // Handle Enter key in input fields
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                this.submitMeasurements();
            }
        });

        // Canvas click to focus related input
        this.canvas?.addEventListener('click', (e) => this.handleCanvasClick(e));
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
            
            // Display project information
            this.displayProjectInfo();
            
            // Render the project on canvas
            this.renderProject();
            
            // Generate measurement form
            this.generateMeasurementForm();
            
            this.showProject(true);
            
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
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
        // Set current index/label if not set
        if (this.currentIndex < 0 || this.currentIndex >= imageLabels.length) this.currentIndex = 0;
        this.currentLabel = this.currentLabel || this.projectData.currentImageLabel || imageLabels[0];
        const currentIndexFromLabel = imageLabels.indexOf(this.currentLabel);
        if (currentIndexFromLabel >= 0) this.currentIndex = currentIndexFromLabel;
        const currentLabel = imageLabels[this.currentIndex];
        this.currentLabel = currentLabel;
        const nameEl = document.getElementById('currentImageName');
        if (nameEl) nameEl.textContent = (this.projectData.customImageNames?.[currentLabel]) || currentLabel;
        
        // Load and display the image if available
        if (currentLabel && this.projectData.originalImages && this.projectData.originalImages[currentLabel]) {
            this.loadAndDisplayImage(currentLabel);
        } else {
            // No image; still draw strokes with a default scale
            this.drawStrokes(currentLabel, 1, 0, 0);
        }
    }

    showPreviousImage() {
        if (!this.projectData?.imageLabels?.length) return;
        this.currentIndex = (this.currentIndex - 1 + this.projectData.imageLabels.length) % this.projectData.imageLabels.length;
        this.currentLabel = this.projectData.imageLabels[this.currentIndex];
        this.renderProject();
        this.generateMeasurementForm();
        this.showProject(true);
    }

    showNextImage() {
        if (!this.projectData?.imageLabels?.length) return;
        this.currentIndex = (this.currentIndex + 1) % this.projectData.imageLabels.length;
        this.currentLabel = this.projectData.imageLabels[this.currentIndex];
        this.renderProject();
        this.generateMeasurementForm();
        this.showProject(true);
    }
    
    async loadAndDisplayImage(imageLabel) {
        try {
            const imageUrl = this.projectData.originalImages[imageLabel];
            if (!imageUrl) return;
            
            const img = new Image();
            img.onload = () => {
                // Calculate scaling to fit canvas
                const scale = Math.min(
                    this.canvas.width / img.width,
                    this.canvas.height / img.height
                );
                
                const scaledWidth = img.width * scale;
                const scaledHeight = img.height * scale;
                const x = (this.canvas.width - scaledWidth) / 2;
                const y = (this.canvas.height - scaledHeight) / 2;
                
                // Draw the image
                this.ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
                
                // Redraw strokes on top of image
                this.drawStrokes(imageLabel, scale, x, y);
            };
            
            img.onerror = () => {
                console.warn('Failed to load image for label:', imageLabel);
                // Continue without image
                this.drawStrokes(imageLabel);
            };
            
            img.src = imageUrl;
        } catch (error) {
            console.error('Error loading image:', error);
            this.drawStrokes(imageLabel);
        }
    }
    
    drawStrokes(imageLabel, imageScale = 1, imageX = 0, imageY = 0) {
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
        const customOffset = this.projectData.customLabelPositions?.[this.currentLabel]?.[strokeLabel] || { x: 0, y: 0 };
        const labelCenter = {
            x: anchor.x + (customOffset.x || 0) * scale,
            y: anchor.y + (customOffset.y || 0) * scale
        };

        // Compose text with measurement value if present
        const measurement = this.projectData.strokeMeasurements?.[this.currentLabel]?.[strokeLabel]?.value;
        const text = measurement ? `${strokeLabel}: ${measurement}` : strokeLabel;

        // Sizing
        const fontSize = Math.max(10, 12 * scale);
        const padding = 4 * Math.max(1, scale);
        this.ctx.font = `${fontSize}px Arial`;
        const textWidth = this.ctx.measureText(text).width;

        const box = {
            x: labelCenter.x - textWidth / 2 - padding,
            y: labelCenter.y - fontSize / 2 - padding,
            w: textWidth + padding * 2,
            h: fontSize + padding * 2
        };

        // Background and border in stroke color
        this.ctx.fillStyle = 'rgba(255,255,255,0.92)';
        this.ctx.fillRect(box.x, box.y, box.w, box.h);
        this.ctx.strokeStyle = strokeData.color || '#000';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(box.x, box.y, box.w, box.h);

        // Dotted connector from anchor to label box center
        this.ctx.save();
        this.ctx.setLineDash([4, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(anchor.x, anchor.y);
        this.ctx.lineTo(labelCenter.x, labelCenter.y);
        this.ctx.stroke();
        this.ctx.restore();

        // Text
        this.ctx.fillStyle = '#000';
        this.ctx.fillText(text, labelCenter.x - textWidth / 2, labelCenter.y + fontSize / 3);

        // Track for click mapping
        this.labelRects.push({ imageLabel: this.currentLabel, strokeLabel, rect: box });
    }
    
    transformPoint(point, scale, offsetX, offsetY) {
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

    handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Naive hit test: focus the first input (enhance later with per-stroke proximity)
        const first = document.querySelector('#measurementsForm input[data-stroke]');
        if (first) first.focus();
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
