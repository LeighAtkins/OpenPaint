// Tag prediction and calculation system
(function() {
    'use strict';

    // Simplified Tag System
    let tagMode = 'letters+numbers'; // 'letters' or 'letters+numbers'

    // Helper function to find next available letter (A, B, C...)
    function findNextAvailableLetter() {
        const currentImageLabel = window.currentImageLabel || 'default';
        const lineStrokes = window.lineStrokesByImage?.[currentImageLabel] || [];
        const existingTags = lineStrokes.filter(Boolean);

        // Extract all letters that have been used (from both A and A1 patterns)
        const usedLetters = new Set();
        for (const tag of existingTags) {
            if (/^[A-Z]/.test(tag)) {
                usedLetters.add(tag[0]); // Get the first letter
            }
        }

        // Find the first unused letter
        for (let i = 0; i < 26; i++) {
            const letter = String.fromCharCode(65 + i); // A=65, B=66, etc.
            if (!usedLetters.has(letter)) {
                return letter;
            }
        }

        // If all letters A-Z are used, start over at A
        return 'A';
    }

    // Helper function to find next available letter+number (A1, A2, A3...)
    function findNextAvailableLetterNumber() {
        const currentImageLabel = window.currentImageLabel || 'default';
        const lineStrokes = window.lineStrokesByImage?.[currentImageLabel] || [];
        const existingTags = lineStrokes.filter(Boolean);

        // Extract all base tags (A1, A2, etc.) and track the highest per letter
        const letterCounts = new Map();

        for (const tag of existingTags) {
            // Handle both A1 and A1(1) patterns
            const match = tag.match(/^([A-Z])(\d+)(?:\((\d+)\))?$/);
            if (match) {
                const letter = match[1];
                const number = parseInt(match[2]);
                const currentMax = letterCounts.get(letter) || 0;
                letterCounts.set(letter, Math.max(currentMax, number));
            }
        }

        // Find the next available tag
        for (let letter = 'A'; letter <= 'Z'; letter = String.fromCharCode(letter.charCodeAt(0) + 1)) {
            const maxNumber = letterCounts.get(letter) || 0;
            const nextNumber = maxNumber + 1;

            if (nextNumber <= 9) {
                return letter + nextNumber;
            }
        }

        // If we've exhausted all possibilities up to Z9, start over at A1
        return 'A1';
    }

    // Calculate next tag based on current mode and existing tags
    function calculateNextTag() {
        console.log('[calculateNextTag] Called with tagMode:', tagMode);
        const currentImageLabel = window.currentImageLabel || 'default';
        const lineStrokes = window.lineStrokesByImage?.[currentImageLabel] || [];
        const existingTags = lineStrokes.filter(Boolean);

        console.log('[calculateNextTag] Current image:', currentImageLabel, 'existing tags:', existingTags);

        if (existingTags.length === 0) {
            const result = tagMode === 'letters' ? 'A' : 'A1';
            console.log('[calculateNextTag] No existing tags, returning:', result);
            return result;
        }

        // Extract all base tags (without suffixes)
        const baseTags = new Set();

        for (const tag of existingTags) {
            if (tagMode === 'letters') {
                if (/^[A-Z]$/.test(tag)) {
                    baseTags.add(tag);
                }
            } else {
                // Handle both A1 and A1(1), A1(2) patterns
                const match = tag.match(/^([A-Z]\d+)(?:\((\d+)\))?$/);
                if (match) {
                    const baseTag = match[1];
                    baseTags.add(baseTag);
                }
            }
        }

        if (baseTags.size === 0) {
            // No valid tags found, start fresh
            const result = tagMode === 'letters' ? 'A' : 'A1';
            console.log('[calculateNextTag] No valid tags found, returning:', result);
            return result;
        }

        // Sort tags properly for alphanumeric comparison
        const sortedBaseTags = Array.from(baseTags).sort((a, b) => {
            if (tagMode === 'letters') {
                // Simple alphabetic sort for letter-only mode
                return a.localeCompare(b);
            } else {
                // Alphanumeric sort: compare letter first, then number
                const matchA = a.match(/^([A-Z])(\d+)$/);
                const matchB = b.match(/^([A-Z])(\d+)$/);

                if (!matchA || !matchB) return a.localeCompare(b);

                const [, letterA, numA] = matchA;
                const [, letterB, numB] = matchB;

                // Compare letters first
                if (letterA !== letterB) {
                    return letterA.localeCompare(letterB);
                }

                // If same letter, compare numbers numerically
                return parseInt(numA) - parseInt(numB);
            }
        });

        console.log('[calculateNextTag] Sorted tags:', sortedBaseTags);

        if (tagMode === 'letters') {
            // Letters only mode: Check for gaps first
            for (let i = 0; i < sortedBaseTags.length - 1; i++) {
                const currentLetter = sortedBaseTags[i][0];
                const nextLetter = sortedBaseTags[i + 1][0];
                const expectedNext = String.fromCharCode(currentLetter.charCodeAt(0) + 1);

                if (expectedNext !== nextLetter && expectedNext <= 'Z') {
                    console.log('[calculateNextTag] Letters mode, found gap:', expectedNext);
                    return expectedNext;
                }
            }

            // No gaps, increment from last
            const lastLetter = sortedBaseTags[sortedBaseTags.length - 1][0];
            const nextLetter = String.fromCharCode(lastLetter.charCodeAt(0) + 1);

            if (nextLetter > 'Z') {
                console.log('[calculateNextTag] Letters mode, wrapped to A');
                return 'A';
            }

            console.log('[calculateNextTag] Letters mode, next:', nextLetter);
            return nextLetter;
        } else {
            // Letters + numbers mode: Check for gaps first
            for (let i = 0; i < sortedBaseTags.length; i++) {
                const match = sortedBaseTags[i].match(/^([A-Z])(\d+)$/);
                if (!match) continue;

                const [, letter, number] = match;
                const num = parseInt(number);

                // Check if this is the first tag with this letter
                if (i === 0 || sortedBaseTags[i - 1][0] !== letter) {
                    // If it doesn't start at 1, fill from 1
                    if (num > 1) {
                        const result = letter + '1';
                        console.log('[calculateNextTag] Numbers mode, found gap at start:', result);
                        return result;
                    }
                }

                // Check for gaps within the same letter
                if (i < sortedBaseTags.length - 1) {
                    const nextMatch = sortedBaseTags[i + 1].match(/^([A-Z])(\d+)$/);
                    if (nextMatch) {
                        const [, nextLetter, nextNumber] = nextMatch;
                        const nextNum = parseInt(nextNumber);

                        // If same letter, check for gap
                        if (letter === nextLetter && nextNum > num + 1) {
                            const result = letter + (num + 1);
                            console.log('[calculateNextTag] Numbers mode, found gap:', result);
                            return result;
                        }
                    }
                }
            }

            // No gaps, increment from last
            const lastBaseTag = sortedBaseTags[sortedBaseTags.length - 1];
            const match = lastBaseTag.match(/^([A-Z])(\d+)$/);
            if (match) {
                const [, letter, number] = match;
                const nextNumber = parseInt(number) + 1;

                // Check if we need to move to the next letter
                if (nextNumber > 9) {
                    const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
                    if (nextLetter > 'Z') {
                        console.log('[calculateNextTag] Numbers mode, wrapped to A1');
                        return 'A1';
                    }
                    const result = nextLetter + '1';
                    console.log('[calculateNextTag] Numbers mode, exceeded 9, next:', result);
                    return result;
                }

                const result = letter + nextNumber;
                console.log('[calculateNextTag] Numbers mode, next:', result);
                return result;
            } else {
                console.log('[calculateNextTag] Unexpected tag format, returning A1');
                return 'A1';
            }
        }
    }

    // Calculate the next tag after a specific tag (for manual tag setting)
    // This increments without gap-filling to preserve user intent
    function calculateNextTagFrom(tag) {
        const mode = typeof tagMode === 'string' ? tagMode : 'letters+numbers';

        if (mode === 'letters') {
            // Just increment the letter
            const nextLetter = String.fromCharCode(tag.charCodeAt(0) + 1);
            return nextLetter > 'Z' ? 'A' : nextLetter;
        } else {
            // Letters + numbers mode
            const match = tag.match(/^([A-Z])(\d+)$/);
            if (!match) return 'A1';

            const [, letter, number] = match;
            const nextNumber = parseInt(number) + 1;

            if (nextNumber > 9) {
                // Wrap to next letter
                const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
                if (nextLetter > 'Z') {
                    return 'A1'; // Wrap around
                }
                return nextLetter + '1';
            }

            return letter + nextNumber;
        }
    }

    // Update the next tag display
    function updateNextTagDisplay() {
        const nextTagDisplay = document.getElementById('nextTagDisplay');
        if (nextTagDisplay) {
            const currentImageLabel = window.currentImageLabel || 'default';

            // Priority: 1) labelsByImage (immediate next), 2) manualTagByImage (manual sequence), 3) calculateNextTag (gap-filling)
            let nextTag;
            if (window.labelsByImage && window.labelsByImage[currentImageLabel]) {
                nextTag = window.labelsByImage[currentImageLabel];
                console.log('[updateNextTagDisplay] Using labelsByImage:', nextTag);
            } else if (window.manualTagByImage && window.manualTagByImage[currentImageLabel]) {
                // We're in a manual sequence - use the manual flag value
                nextTag = window.manualTagByImage[currentImageLabel];
                console.log('[updateNextTagDisplay] Using manualTagByImage:', nextTag);
            } else {
                // Normal gap-filling mode
                nextTag = calculateNextTag();
                console.log('[updateNextTagDisplay] Using calculateNextTag (gap-filling):', nextTag);
            }

            nextTagDisplay.textContent = nextTag;
        }
    }

    // Tag Mode Toggle functionality
    function initTagModeToggle() {
        const tagModeToggle = document.getElementById('tagModeToggle');
        if (tagModeToggle) {
            tagModeToggle.addEventListener('click', () => {
                const oldMode = tagMode;
                tagMode = tagMode === 'letters' ? 'letters+numbers' : 'letters';
                tagModeToggle.textContent = tagMode === 'letters' ? 'Letters Only' : 'Letters + Numbers';

                // Automatically set the next appropriate tag when switching modes
                const currentImageLabel = window.currentImageLabel || 'default';
                window.labelsByImage = window.labelsByImage || {};

                if (tagMode === 'letters') {
                    // Switching to letters only - find next available letter
                    const nextLetter = findNextAvailableLetter();
                    window.labelsByImage[currentImageLabel] = nextLetter;
                    console.log(`[tagModeToggle] Switched to letters mode, next tag: ${nextLetter}`);
                } else {
                    // Switching to letters+numbers - find next available letter+number
                    const nextLetterNumber = findNextAvailableLetterNumber();
                    window.labelsByImage[currentImageLabel] = nextLetterNumber;
                    console.log(`[tagModeToggle] Switched to letters+numbers mode, next tag: ${nextLetterNumber}`);
                }

                updateNextTagDisplay();
            });
        }
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initTagModeToggle();
            updateNextTagDisplay();
        });
    } else {
        initTagModeToggle();
        updateNextTagDisplay();
    }

    // Expose functions globally for paint.js to call
    window.updateNextTagDisplay = updateNextTagDisplay;
    window.calculateNextTag = calculateNextTag;
    window.calculateNextTagFrom = calculateNextTagFrom;
    window.findNextAvailableLetter = findNextAvailableLetter;
    window.findNextAvailableLetterNumber = findNextAvailableLetterNumber;

    // Expose tagMode getter/setter
    Object.defineProperty(window, 'tagMode', {
        get: function() { return tagMode; },
        set: function(value) { tagMode = value; }
    });

    console.log('[tag-system.js] Made calculateNextTag available globally:', typeof window.calculateNextTag);
})();
