
import { PathUtils } from './PathUtils.js';

export class ArrowManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.canvas = null; // Will be set in init()
        
        // Default settings for next line
        this.defaultSettings = {
            startArrow: false,
            endArrow: false,
            arrowSize: 10
        };
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
        const sizeInput = document.getElementById('arrowSize');
        const styleSelect = document.getElementById('arrowStyle');
        
        if (startBtn) {
            startBtn.addEventListener('click', () => this.toggleArrow('start'));
        }
        
        if (endBtn) {
            endBtn.addEventListener('click', () => this.toggleArrow('end'));
        }
        
        if (sizeInput) {
            sizeInput.addEventListener('input', (e) => {
                const size = parseInt(e.target.value, 10);
                this.updateSetting('arrowSize', size);
            });
        }
        
        if (styleSelect) {
            styleSelect.addEventListener('change', (e) => {
                this.updateSetting('arrowStyle', e.target.value);
            });
        }
        
        // Listen for selection changes to update button state
        this.canvas.on('selection:created', (e) => this.updateButtonState(e.selected));
        this.canvas.on('selection:updated', (e) => this.updateButtonState(e.selected));
        this.canvas.on('selection:cleared', () => this.updateButtonState(null));
        
        // Listen for object creation to apply default settings
        this.canvas.on('object:added', (e) => {
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
            const validObjects = activeObjects.filter(obj =>
                obj.type === 'line' || obj.type === 'path'
            );

            if (validObjects.length > 0) {
                // Toggle on all selected objects
                validObjects.forEach(obj => {
                    if (!obj.arrowSettings) {
                        obj.arrowSettings = { ...this.defaultSettings };
                    }

                    if (side === 'start') {
                        obj.arrowSettings.startArrow = !obj.arrowSettings.startArrow;
                    } else {
                        obj.arrowSettings.endArrow = !obj.arrowSettings.endArrow;
                    }

                    this.attachArrowRendering(obj);
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
            const validObjects = activeObjects.filter(obj =>
                obj.type === 'line' || obj.type === 'path'
            );

            if (validObjects.length > 0) {
                // Update all selected objects
                validObjects.forEach(obj => {
                    if (!obj.arrowSettings) {
                        obj.arrowSettings = { ...this.defaultSettings };
                    }

                    obj.arrowSettings[key] = value;
                    this.attachArrowRendering(obj);
                    obj.dirty = true;
                });

                this.canvas.requestRenderAll();
                this.updateButtonState(validObjects);
            }
        } else {
            // Update default settings
            this.defaultSettings[key] = value;
        }
    }
    
    updateButtonState(objOrArray) {
        const startBtn = document.getElementById('arrowStartBtn');
        const endBtn = document.getElementById('arrowEndBtn');
        const sizeInput = document.getElementById('arrowSize');
        const styleSelect = document.getElementById('arrowStyle');

        let startActive = false;
        let startMixed = false;
        let endActive = false;
        let endMixed = false;
        let size = 15;
        let style = 'triangular';
        let isMixedSize = false;
        let isMixedStyle = false;

        // Handle array of objects (multi-selection)
        if (Array.isArray(objOrArray) && objOrArray.length > 0) {
            const validObjects = objOrArray.filter(obj =>
                obj.type === 'line' || obj.type === 'path'
            );

            if (validObjects.length > 0) {
                // Check start arrow state
                const startStates = validObjects.map(obj => obj.arrowSettings?.startArrow ?? false);
                const endStates = validObjects.map(obj => obj.arrowSettings?.endArrow ?? false);
                const sizes = validObjects.map(obj => obj.arrowSettings?.arrowSize ?? 15);
                const styles = validObjects.map(obj => obj.arrowSettings?.arrowStyle ?? 'triangular');

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
            }
        }
        // Handle single object
        else if (objOrArray && (objOrArray.type === 'line' || objOrArray.type === 'path')) {
            const settings = objOrArray.arrowSettings || { startArrow: false, endArrow: false, arrowSize: 15, arrowStyle: 'triangular' };
            startActive = settings.startArrow;
            endActive = settings.endArrow;
            size = settings.arrowSize || 15;
            style = settings.arrowStyle || 'triangular';
        }
        // Default settings when nothing is selected
        else {
            startActive = this.defaultSettings.startArrow;
            endActive = this.defaultSettings.endArrow;
            size = this.defaultSettings.arrowSize || 15;
            style = this.defaultSettings.arrowStyle || 'triangular';
        }

        // Update start arrow button
        if (startBtn) {
            startBtn.classList.toggle('active', startActive && !startMixed);
            startBtn.classList.toggle('mixed', startMixed);
            startBtn.style.backgroundColor = startActive && !startMixed ? '#e0e7ff' : (startMixed ? '#f3e8ff' : '');
            startBtn.style.opacity = startMixed ? '0.6' : '';
        }

        // Update end arrow button
        if (endBtn) {
            endBtn.classList.toggle('active', endActive && !endMixed);
            endBtn.classList.toggle('mixed', endMixed);
            endBtn.style.backgroundColor = endActive && !endMixed ? '#e0e7ff' : (endMixed ? '#f3e8ff' : '');
            endBtn.style.opacity = endMixed ? '0.6' : '';
        }

        // Update size input
        if (sizeInput) {
            sizeInput.value = size;
            sizeInput.style.opacity = isMixedSize ? '0.6' : '';
        }

        // Update style select
        if (styleSelect) {
            styleSelect.value = style;
            styleSelect.style.opacity = isMixedStyle ? '0.6' : '';
        }
    }
    
    applyArrows(object) {
        // Apply current default settings to a new object
        object.arrowSettings = { ...this.defaultSettings };
        this.attachArrowRendering(object);
    }
    
    attachArrowRendering(object) {
        if (object._arrowRenderingAttached) return;
        
        const originalRender = object._render;
        const self = this;
        
        // Cache trigonometry constants
        const ARROW_TAN_30 = Math.tan(Math.PI / 6); // ~0.577
        
        object._render = function(ctx) {
            // Don't render arrows if no settings
            if (!this.arrowSettings || (!this.arrowSettings.startArrow && !this.arrowSettings.endArrow)) {
                originalRender.call(this, ctx);
                return;
            }
            
            ctx.save();
            
            const { startArrow, endArrow, arrowSize, arrowStyle = 'triangular' } = this.arrowSettings;
            const strokeWidth = this.strokeWidth;
            
            // Get current scale (approximation from canvas or object)
            // Ideally we use window.imageScaleByLabel[currentImageLabel] but accessing global state inside render is risky if context changes.
            // However, the plan specifies using it.
            let scale = 1;
            if (window.imageScaleByLabel && window.currentImageLabel) {
                scale = window.imageScaleByLabel[window.currentImageLabel] || 1;
            }
            
            // Calculate effective arrow size
            // Formula: baseArrowSize = arrowSize || (strokeActualWidth * 2)
            // effectiveBaseSize = Math.max(baseArrowSize, strokeActualWidth * 2)
            // scaledArrowSize = effectiveBaseSize * scale
            
            // Note: this.strokeWidth is already the "actual width" in Fabric terms usually, 
            // but if the object is scaled, we might need to account for that?
            // Fabric objects: effective width = width * scaleX. 
            // But strokeWidth is usually constant unless scaling stroke.
            // Let's assume strokeWidth is the base.
            
            const baseArrowSize = arrowSize || (strokeWidth * 2);
            const effectiveBaseSize = Math.max(baseArrowSize, strokeWidth * 2);
            const scaledArrowSize = effectiveBaseSize; // * scale? 
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
            
            // SHORTENING LOGIC
            // extensionDistance = scaledArrowSize + (strokeActualWidth * scale * 2)
            // We use a simplified version: size + padding
            const extensionDistance = effectiveBaseSize * 0.8; // Using 0.8 factor from report for shortening
            
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
                // Re-implement Line rendering with shortening
                const p = this.calcLinePoints();
                let x1 = p.x1;
                let y1 = p.y1;
                let x2 = p.x2;
                let y2 = p.y2;
                
                const dx = x2 - x1;
                const dy = y2 - y1;
                const len = Math.sqrt(dx*dx + dy*dy);
                const angle = Math.atan2(dy, dx);
                
                let startX = x1;
                let startY = y1;
                let endX = x2;
                let endY = y2;
                
                if (startArrow) {
                    startX = x1 + Math.cos(angle) * extensionDistance;
                    startY = y1 + Math.sin(angle) * extensionDistance;
                    
                    // Draw start arrow
                    self.drawArrowhead(ctx, x1, y1, angle + Math.PI, effectiveBaseSize, arrowStyle, this.stroke);
                }
                
                if (endArrow) {
                    endX = x2 - Math.cos(angle) * extensionDistance;
                    endY = y2 - Math.sin(angle) * extensionDistance;
                    
                    // Draw end arrow
                    self.drawArrowhead(ctx, x2, y2, angle, effectiveBaseSize, arrowStyle, this.stroke);
                }
                
                // Draw the shortened line
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.lineWidth = this.strokeWidth;
                ctx.strokeStyle = this.stroke;
                ctx.lineCap = this.strokeLineCap;
                ctx.strokeDashArray = this.strokeDashArray;
                ctx.stroke();
                
            } else if (this.type === 'path') {
                // For paths, shortening is hard.
                // We will draw the original path, then draw arrows on top.
                // To minimize overlap, we can try to draw the arrows with a "cover" if needed,
                // but for now let's just draw them on top.
                
                originalRender.call(this, ctx);
                
                const path = this.path;
                if (!path || path.length < 2) {
                    ctx.restore();
                    return;
                }
                
                // Start Arrow
                if (startArrow) {
                    const start = path[0];
                    const next = path[1];
                    let angle = 0;
                    
                    // Calculate angle based on first segment
                    if (next[0] === 'C') {
                        angle = Math.atan2(next[2] - start[2], next[1] - start[1]);
                    } else if (next[0] === 'Q') {
                        angle = Math.atan2(next[2] - start[2], next[1] - start[1]);
                    } else {
                        angle = Math.atan2(next[2] - start[2], next[1] - start[1]);
                    }
                    
                    // Adjust for offset
                    const offsetX = this.pathOffset.x;
                    const offsetY = this.pathOffset.y;
                    
                    // Angle needs to be reversed for start arrow (pointing OUT from start)
                    // The vector we calculated is Start -> Next.
                    // We want arrow pointing AWAY from Next, i.e., towards Start?
                    // No, "Start Arrow" usually points AT the start point.
                    // So direction is Next -> Start.
                    // So angle + PI.
                    
                    self.drawArrowhead(ctx, start[1] - offsetX, start[2] - offsetY, angle + Math.PI, effectiveBaseSize, arrowStyle, this.stroke);
                }
                
                // End Arrow
                if (endArrow) {
                    const end = path[path.length - 1];
                    const prev = path[path.length - 2];
                    let angle = 0;
                    
                    // Helper to get last point coords
                    const getLastPoint = (cmd) => {
                        const len = cmd.length;
                        return { x: cmd[len-2], y: cmd[len-1] };
                    };
                    
                    const pEnd = getLastPoint(end);
                    let pControl;
                    
                    // Determine the control point to calculate tangent
                    if (end[0] === 'C') {
                        // Cubic Bezier: Control point is (x2, y2) -> indices 3, 4
                        pControl = { x: end[3], y: end[4] };
                    } else if (end[0] === 'Q') {
                        // Quadratic Bezier: Control point is (x1, y1) -> indices 1, 2
                        pControl = { x: end[1], y: end[2] };
                    } else {
                        // Line or other: Use previous point
                        pControl = getLastPoint(prev);
                    }
                    
                    // If control point is same as end point (rare), fallback to previous point
                    if (Math.abs(pEnd.x - pControl.x) < 0.01 && Math.abs(pEnd.y - pControl.y) < 0.01) {
                         pControl = getLastPoint(prev);
                    }
                    
                    // Angle is Control -> End
                    angle = Math.atan2(pEnd.y - pControl.y, pEnd.x - pControl.x);
                    
                    const offsetX = this.pathOffset.x;
                    const offsetY = this.pathOffset.y;
                    
                    self.drawArrowhead(ctx, pEnd.x - offsetX, pEnd.y - offsetY, angle, effectiveBaseSize, arrowStyle, this.stroke);
                }
            }
            
            ctx.restore();
        };
        
        object._arrowRenderingAttached = true;
    }
    
    drawArrowhead(ctx, x, y, angle, size, style, color) {
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
        
        const ARROW_TAN_30 = Math.tan(Math.PI / 6); // ~0.577
        
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
