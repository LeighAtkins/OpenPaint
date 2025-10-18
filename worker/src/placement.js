/**
 * Label placement utilities
 * Implements greedy placement algorithm to avoid overlaps
 */

/**
 * Place label using greedy algorithm
 * @param {{x:number,y:number}} anchor - Anchor point for label
 * @param {Array<Object>} occupiedRects - Array of already placed rectangles
 * @param {{width:number,height:number}} imageDims - Image dimensions
 * @param {{width:number,height:number}} labelSize - Label size
 * @returns {{x:number,y:number}} Label position
 */
export function placeLabelGreedy(anchor, occupiedRects, imageDims, labelSize = { width: 60, height: 20 }) {
    // Try different offsets in order of preference
    const offsets = [
        { x: 10, y: -10 },   // Top-right
        { x: -10, y: -10 },  // Top-left
        { x: 10, y: 10 },    // Bottom-right
        { x: -10, y: 10 },   // Bottom-left
        { x: 0, y: -15 },    // Top-center
        { x: 0, y: 15 },     // Bottom-center
        { x: 15, y: 0 },     // Right-center
        { x: -15, y: 0 }     // Left-center
    ];
    
    for (const offset of offsets) {
        const pos = {
            x: anchor.x + offset.x,
            y: anchor.y + offset.y
        };
        
        const rect = {
            x: pos.x,
            y: pos.y,
            width: labelSize.width,
            height: labelSize.height
        };
        
        // Check if this position is valid
        if (!overlapsAny(rect, occupiedRects) && inBounds(rect, imageDims)) {
            occupiedRects.push(rect);
            return pos;
        }
    }
    
    // Fallback: place at anchor with small offset
    const fallbackPos = { x: anchor.x + 5, y: anchor.y - 5 };
    occupiedRects.push({
        x: fallbackPos.x,
        y: fallbackPos.y,
        width: labelSize.width,
        height: labelSize.height
    });
    
    return fallbackPos;
}

/**
 * Check if rectangle overlaps with any in array
 * @param {Object} rect - Rectangle to check
 * @param {Array<Object>} rects - Array of rectangles
 * @returns {boolean} True if overlaps
 */
function overlapsAny(rect, rects) {
    for (const other of rects) {
        if (rectsOverlap(rect, other)) {
            return true;
        }
    }
    return false;
}

/**
 * Check if two rectangles overlap
 * @param {Object} rect1 - First rectangle
 * @param {Object} rect2 - Second rectangle
 * @returns {boolean} True if they overlap
 */
function rectsOverlap(rect1, rect2) {
    return !(
        rect1.x + rect1.width < rect2.x ||
        rect2.x + rect2.width < rect1.x ||
        rect1.y + rect1.height < rect2.y ||
        rect2.y + rect2.height < rect1.y
    );
}

/**
 * Check if rectangle is within image bounds
 * @param {Object} rect - Rectangle to check
 * @param {{width:number,height:number}} dims - Image dimensions
 * @returns {boolean} True if in bounds
 */
function inBounds(rect, dims) {
    const margin = 5; // Small margin from edges
    return (
        rect.x >= margin &&
        rect.y >= margin &&
        rect.x + rect.width <= dims.width - margin &&
        rect.y + rect.height <= dims.height - margin
    );
}

/**
 * Estimate label dimensions based on text
 * @param {string} text - Label text
 * @param {number} fontSize - Font size in pixels
 * @returns {{width:number,height:number}} Estimated dimensions
 */
export function estimateLabelSize(text, fontSize = 14) {
    // Rough estimation: average character width is 0.6 * fontSize
    const charWidth = fontSize * 0.6;
    const padding = 8;
    
    return {
        width: Math.max(40, text.length * charWidth + padding * 2),
        height: fontSize + padding * 2
    };
}

