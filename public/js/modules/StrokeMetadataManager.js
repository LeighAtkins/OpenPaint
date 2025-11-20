// Stroke Metadata Manager
// Handles attaching labels, measurements, visibility flags to Fabric objects

export class StrokeMetadataManager {
    constructor() {
        // Mirror legacy data structures for compatibility
        this.vectorStrokesByImage = {};
        this.strokeVisibilityByImage = {};
        this.strokeLabelVisibility = {};
        this.strokeMeasurements = {};
        this.customLabelPositions = {};
        this.calculatedLabelOffsets = {};
    }
    
    // Attach metadata to a Fabric object
    attachMetadata(obj, imageLabel, strokeLabel) {
        if (!obj) return;
        
        // Store reference in legacy structure
        if (!this.vectorStrokesByImage[imageLabel]) {
            this.vectorStrokesByImage[imageLabel] = {};
        }
        this.vectorStrokesByImage[imageLabel][strokeLabel] = obj;
        
        // Also update legacy window.lineStrokesByImage for tag prediction system compatibility
        window.lineStrokesByImage = window.lineStrokesByImage || {};
        if (!window.lineStrokesByImage[imageLabel]) {
            window.lineStrokesByImage[imageLabel] = [];
        }
        // Add stroke label to array if not already present
        if (!window.lineStrokesByImage[imageLabel].includes(strokeLabel)) {
            window.lineStrokesByImage[imageLabel].push(strokeLabel);
        }
        
        // Store metadata directly on Fabric object
        obj.strokeMetadata = {
            imageLabel: imageLabel,
            strokeLabel: strokeLabel,
            visible: true,
            labelVisible: true
        };
        
        // Initialize visibility maps
        if (!this.strokeVisibilityByImage[imageLabel]) {
            this.strokeVisibilityByImage[imageLabel] = {};
        }
        if (!this.strokeLabelVisibility[imageLabel]) {
            this.strokeLabelVisibility[imageLabel] = {};
        }
        
        this.strokeVisibilityByImage[imageLabel][strokeLabel] = true;
        this.strokeLabelVisibility[imageLabel][strokeLabel] = true;
    }
    
    // Get metadata for an object
    getMetadata(obj) {
        return obj.strokeMetadata || null;
    }
    
    // Set visibility for a stroke
    setStrokeVisibility(imageLabel, strokeLabel, visible) {
        if (!this.strokeVisibilityByImage[imageLabel]) {
            this.strokeVisibilityByImage[imageLabel] = {};
        }
        this.strokeVisibilityByImage[imageLabel][strokeLabel] = visible;
        
        // Update Fabric object if it exists
        const obj = this.vectorStrokesByImage[imageLabel]?.[strokeLabel];
        if (obj) {
            obj.visible = visible;
            obj.strokeMetadata.visible = visible;
        }
    }
    
    // Set label visibility for a stroke
    setLabelVisibility(imageLabel, strokeLabel, visible) {
        if (!this.strokeLabelVisibility[imageLabel]) {
            this.strokeLabelVisibility[imageLabel] = {};
        }
        this.strokeLabelVisibility[imageLabel][strokeLabel] = visible;
        
        // Update Fabric object if it exists
        const obj = this.vectorStrokesByImage[imageLabel]?.[strokeLabel];
        if (obj && obj.strokeMetadata) {
            obj.strokeMetadata.labelVisible = visible;
        }
    }
    
    // Set measurement for a stroke
    setMeasurement(imageLabel, strokeLabel, measurement) {
        if (!this.strokeMeasurements[imageLabel]) {
            this.strokeMeasurements[imageLabel] = {};
        }
        this.strokeMeasurements[imageLabel][strokeLabel] = measurement;
    }
    
    // Get measurement for a stroke
    getMeasurement(imageLabel, strokeLabel) {
        return this.strokeMeasurements[imageLabel]?.[strokeLabel] || null;
    }
    
    // Generate next label (A1, A2, B1, etc.) - integrates with tag prediction system
    getNextLabel(imageLabel, mode = 'letters+numbers') {
        // First, try to use the tag prediction system from index.html
        if (window.calculateNextTag) {
            try {
                const tag = window.calculateNextTag();
                if (tag && this.isValidTag(tag, mode)) {
                    // Use the predicted tag and update the display
                    this.updateTagPredictionAfterUse(imageLabel, tag);
                    return tag;
                }
            } catch (e) {
                console.warn('Error calling calculateNextTag:', e);
            }
        }
        
        // Fallback: check nextTagDisplay directly
        const nextTagDisplay = document.getElementById('nextTagDisplay');
        if (nextTagDisplay) {
            const tag = nextTagDisplay.textContent.trim().toUpperCase();
            if (tag && this.isValidTag(tag, mode)) {
                // Use the predicted tag and update the display
                this.updateTagPredictionAfterUse(imageLabel, tag);
                return tag;
            }
        }
        
        // Fallback: calculate next tag
        const existing = Object.keys(this.vectorStrokesByImage[imageLabel] || {});
        
        if (mode === 'letters') {
            // Letters only mode
            if (existing.length === 0) return 'A';
            
            const letters = existing
                .filter(label => /^[A-Z]$/.test(label))
                .map(label => label.charCodeAt(0))
                .sort((a, b) => a - b);
            
            if (letters.length === 0) return 'A';
            
            // Find first gap or next letter
            for (let i = 0; i < 26; i++) {
                const letterCode = 65 + i; // A = 65
                if (!letters.includes(letterCode)) {
                    return String.fromCharCode(letterCode);
                }
            }
            return String.fromCharCode(letters[letters.length - 1] + 1);
        } else {
            // Letters + numbers mode
            if (existing.length === 0) return 'A1';
            
            // Find highest label
            let maxNum = 0;
            let maxLetter = 'A';
            
            existing.forEach(label => {
                const match = label.match(/^([A-Z])(\d+)$/);
                if (match) {
                    const letter = match[1];
                    const num = parseInt(match[2], 10);
                    if (num > maxNum || (num === maxNum && letter > maxLetter)) {
                        maxNum = num;
                        maxLetter = letter;
                    }
                }
            });
            
            // Increment
            if (maxNum < 99) {
                return `${maxLetter}${maxNum + 1}`;
            } else {
                // Move to next letter
                const nextLetter = String.fromCharCode(maxLetter.charCodeAt(0) + 1);
                return `${nextLetter}1`;
            }
        }
    }
    
    isValidTag(tag, mode = 'letters+numbers') {
        if (mode === 'letters') {
            return /^[A-Z]$/.test(tag);
        } else {
            return /^[A-Z]\d+$/.test(tag);
        }
    }
    
    // Update tag prediction after a tag is used
    updateTagPredictionAfterUse(imageLabel, usedTag) {
        // Update the global labelsByImage to track the used tag
        window.labelsByImage = window.labelsByImage || {};
        window.labelsByImage[imageLabel] = usedTag;
        
        // Ensure lineStrokesByImage is updated for tag prediction
        window.lineStrokesByImage = window.lineStrokesByImage || {};
        if (!window.lineStrokesByImage[imageLabel]) {
            window.lineStrokesByImage[imageLabel] = [];
        }
        if (!window.lineStrokesByImage[imageLabel].includes(usedTag)) {
            window.lineStrokesByImage[imageLabel].push(usedTag);
        }
        
        // Update currentImageLabel for tag prediction system
        window.currentImageLabel = imageLabel;
        
        // Update the next tag display
        if (window.updateNextTagDisplay) {
            window.updateNextTagDisplay();
        } else {
            // Fallback: calculate and update manually
            const nextTagDisplay = document.getElementById('nextTagDisplay');
            if (nextTagDisplay && window.calculateNextTag) {
                const nextTag = window.calculateNextTag();
                nextTagDisplay.textContent = nextTag;
            }
        }
    }
    
    // Clear metadata for an image
    clearImageMetadata(imageLabel) {
        delete this.vectorStrokesByImage[imageLabel];
        delete this.strokeVisibilityByImage[imageLabel];
        delete this.strokeLabelVisibility[imageLabel];
        delete this.strokeMeasurements[imageLabel];
        delete this.customLabelPositions[imageLabel];
        delete this.calculatedLabelOffsets[imageLabel];
    }
}

