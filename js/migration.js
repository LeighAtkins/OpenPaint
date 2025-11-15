/**
 * Migration system for converting legacy offset formats to normalized format
 * Handles pixel-based offsets → normalized offsets (v2 schema)
 */
(function() {
    'use strict';

    /**
     * Detect if an offset is in legacy format
     * @param {Object} offset - Offset object to check
     * @returns {boolean} True if legacy format
     */
    window.isLegacyOffset = function(offset) {
        if (!offset) return false;
        // Legacy format: has x,y properties but no kind/version fields
        return (typeof offset.x === 'number' || typeof offset.y === 'number') &&
               (!offset.kind || offset.kind === 'px');
    };

    /**
     * Migrate pixel-based offset to normalized format
     * @param {Object} offsetPx - Legacy pixel offset {x, y}
     * @param {Object} natural - Natural image dimensions {w, h}
     * @returns {Object} Normalized offset with v2 schema
     */
    window.migratePixelOffsetToNorm = function(offsetPx, natural) {
        if (!offsetPx || !natural || !natural.w || !natural.h) {
            console.warn('[MIGRATION] Invalid parameters for pixel offset migration:', { offsetPx, natural });
            return {
                kind: 'norm',
                dx_norm: 0,
                dy_norm: 0,
                normRef: { w: natural?.w || 800, h: natural?.h || 600 },
                version: 2
            };
        }

        const dx_px = typeof offsetPx.x === 'number' ? offsetPx.x : 0;
        const dy_px = typeof offsetPx.y === 'number' ? offsetPx.y : 0;

        const normOffset = window.pixelOffsetToNorm(dx_px, dy_px, natural);

        return {
            kind: 'norm',
            dx_norm: normOffset.dx_norm,
            dy_norm: normOffset.dy_norm,
            normRef: { w: natural.w, h: natural.h },
            version: 2
        };
    };

    /**
     * Migrate all calculatedLabelOffsets for an image label
     * @param {string} imageLabel - Image label identifier
     * @param {Object} natural - Natural image dimensions {w, h}
     */
    window.migrateImageOffsets = function(imageLabel, natural) {
        if (!window.calculatedLabelOffsets) {
            console.warn('[MIGRATION] calculatedLabelOffsets not available');
            return;
        }

        const imageOffsets = window.calculatedLabelOffsets[imageLabel];
        if (!imageOffsets) {
            if (window.labelReprojectDebug && labelReprojectDebug()) {
                console.log(`[MIGRATION] No offsets to migrate for ${imageLabel}`);
            }
            return;
        }

        let migratedCount = 0;
        Object.keys(imageOffsets).forEach(strokeLabel => {
            const offset = imageOffsets[strokeLabel];

            if (window.isLegacyOffset(offset)) {
                const migrated = window.migratePixelOffsetToNorm(offset, natural);
                imageOffsets[strokeLabel] = migrated;
                migratedCount++;

                if (window.labelReprojectDebug && labelReprojectDebug()) {
                    console.log(`[MIGRATION] Migrated ${strokeLabel}:`, {
                        from: offset,
                        to: migrated,
                        natural
                    });
                }
            }
        });

        if (migratedCount > 0) {
            console.log(`[MIGRATION] Migrated ${migratedCount} offsets for ${imageLabel}`);
        }
    };

    /**
     * Full migration for all images - run once on application load
     */
    window.runOffsetMigration = function() {
        if (!window.calculatedLabelOffsets || !window.originalImageDimensions) {
            console.warn('[MIGRATION] Missing required globals for migration');
            return;
        }

        console.log('[MIGRATION] Starting offset migration to v2 format');

        let totalMigrated = 0;
        Object.keys(window.calculatedLabelOffsets).forEach(imageLabel => {
            const natural = window.originalImageDimensions[imageLabel];
            if (natural) {
                const beforeCount = Object.keys(window.calculatedLabelOffsets[imageLabel]).length;
                window.migrateImageOffsets(imageLabel, natural);
                const afterCount = Object.keys(window.calculatedLabelOffsets[imageLabel]).length;
                totalMigrated += (afterCount - beforeCount);
            } else {
                console.warn(`[MIGRATION] Missing natural dimensions for ${imageLabel}, skipping`);
            }
        });

        console.log(`[MIGRATION] Migration complete: ${totalMigrated} offsets migrated to v2 format`);

        // Mark migration as complete
        window._offsetMigrationComplete = true;
    };

    /**
     * Check if migration has been completed
     * @returns {boolean} True if migration is complete
     */
    window.isMigrationComplete = function() {
        return !!window._offsetMigrationComplete;
    };

    /**
     * Validate migrated offset format
     * @param {Object} offset - Offset to validate
     * @returns {boolean} True if valid v2 format
     */
    window.validateOffsetFormat = function(offset) {
        if (!offset) return false;

        return offset.kind === 'norm' &&
               typeof offset.dx_norm === 'number' &&
               typeof offset.dy_norm === 'number' &&
               offset.normRef &&
               typeof offset.normRef.w === 'number' &&
               typeof offset.normRef.h === 'number' &&
               offset.version === 2;
    };

    // Export for debugging
    window._migrationDebug = {
        isLegacyOffset: window.isLegacyOffset,
        migratePixelOffsetToNorm: window.migratePixelOffsetToNorm,
        migrateImageOffsets: window.migrateImageOffsets,
        runOffsetMigration: window.runOffsetMigration,
        isMigrationComplete: window.isMigrationComplete,
        validateOffsetFormat: window.validateOffsetFormat
    };

})();
