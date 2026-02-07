/**
 * Migration system for converting legacy offset formats to normalized format
 * Handles pixel-based offsets → normalized offsets (v2 schema)
 */

import { pixelOffsetToNorm, type NormalizationReference, type NormalizedOffset } from './geometry';

interface LegacyOffset {
  x?: number;
  y?: number;
  kind?: string;
  version?: number;
}

interface NormalizedOffsetV2 extends NormalizedOffset {
  kind: 'norm';
  normRef: NormalizationReference;
  version: 2;
}

type Offset = LegacyOffset | NormalizedOffsetV2;

interface MigrationWindow extends Window {
  calculatedLabelOffsets?: Record<string, Record<string, Offset>>;
  originalImageDimensions?: Record<string, NormalizationReference>;
  labelReprojectDebug?: () => boolean;
  _offsetMigrationComplete?: boolean;
}

const win = window as MigrationWindow;

/**
 * Detect if an offset is in legacy format
 * @param offset - Offset object to check
 * @returns True if legacy format
 */
export function isLegacyOffset(offset: Offset | null | undefined): offset is LegacyOffset {
  if (!offset) return false;
  // Legacy format: has x,y properties but no kind/version fields
  return (
    (typeof offset.x === 'number' || typeof offset.y === 'number') &&
    (!offset.kind || offset.kind === 'px')
  );
}

/**
 * Migrate pixel-based offset to normalized format
 * @param offsetPx - Legacy pixel offset {x, y}
 * @param natural - Natural image dimensions {w, h}
 * @returns Normalized offset with v2 schema
 */
export function migratePixelOffsetToNorm(
  offsetPx: LegacyOffset,
  natural: NormalizationReference
): NormalizedOffsetV2 {
  if (!offsetPx || !natural || !natural.w || !natural.h) {
    console.warn('[MIGRATION] Invalid parameters for pixel offset migration:', {
      offsetPx,
      natural,
    });
    return {
      kind: 'norm',
      dx_norm: 0,
      dy_norm: 0,
      normRef: { w: natural?.w ?? 800, h: natural?.h ?? 600 },
      version: 2,
    };
  }

  const dx_px = typeof offsetPx.x === 'number' ? offsetPx.x : 0;
  const dy_px = typeof offsetPx.y === 'number' ? offsetPx.y : 0;

  const normOffset = pixelOffsetToNorm(dx_px, dy_px, natural);

  return {
    kind: 'norm',
    dx_norm: normOffset.dx_norm,
    dy_norm: normOffset.dy_norm,
    normRef: { w: natural.w, h: natural.h },
    version: 2,
  };
}

/**
 * Migrate all calculatedLabelOffsets for an image label
 * @param imageLabel - Image label identifier
 * @param natural - Natural image dimensions {w, h}
 */
export function migrateImageOffsets(imageLabel: string, natural: NormalizationReference): void {
  if (!win.calculatedLabelOffsets) {
    console.warn('[MIGRATION] calculatedLabelOffsets not available');
    return;
  }

  const imageOffsets = win.calculatedLabelOffsets[imageLabel];
  if (!imageOffsets) {
    if (win.labelReprojectDebug?.()) {
      console.log(`[MIGRATION] No offsets to migrate for ${imageLabel}`);
    }
    return;
  }

  let migratedCount = 0;
  Object.keys(imageOffsets).forEach(strokeLabel => {
    const offset = imageOffsets[strokeLabel];

    if (isLegacyOffset(offset)) {
      const migrated = migratePixelOffsetToNorm(offset, natural);
      imageOffsets[strokeLabel] = migrated;
      migratedCount++;

      if (win.labelReprojectDebug?.()) {
        console.log(`[MIGRATION] Migrated ${strokeLabel}:`, {
          from: offset,
          to: migrated,
          natural,
        });
      }
    }
  });

  if (migratedCount > 0) {
    console.log(`[MIGRATION] Migrated ${migratedCount} offsets for ${imageLabel}`);
  }
}

/**
 * Full migration for all images - run once on application load
 */
export function runOffsetMigration(): void {
  if (!win.calculatedLabelOffsets || !win.originalImageDimensions) {
    console.warn('[MIGRATION] Missing required globals for migration');
    return;
  }

  console.log('[MIGRATION] Starting offset migration to v2 format');

  let totalMigrated = 0;
  Object.keys(win.calculatedLabelOffsets).forEach(imageLabel => {
    const natural = win.originalImageDimensions?.[imageLabel];
    if (natural) {
      const beforeCount = Object.keys(win.calculatedLabelOffsets?.[imageLabel] ?? {}).length;
      migrateImageOffsets(imageLabel, natural);
      const afterCount = Object.keys(win.calculatedLabelOffsets?.[imageLabel] ?? {}).length;
      totalMigrated += afterCount - beforeCount;
    } else {
      console.warn(`[MIGRATION] Missing natural dimensions for ${imageLabel}, skipping`);
    }
  });

  console.log(`[MIGRATION] Migration complete: ${totalMigrated} offsets migrated to v2 format`);

  // Mark migration as complete
  win._offsetMigrationComplete = true;
}

/**
 * Check if migration has been completed
 * @returns True if migration is complete
 */
export function isMigrationComplete(): boolean {
  return !!win._offsetMigrationComplete;
}

/**
 * Validate migrated offset format
 * @param offset - Offset to validate
 * @returns True if valid v2 format
 */
export function validateOffsetFormat(
  offset: Offset | null | undefined
): offset is NormalizedOffsetV2 {
  if (!offset) return false;

  return (
    offset.kind === 'norm' &&
    typeof offset.dx_norm === 'number' &&
    typeof offset.dy_norm === 'number' &&
    !!offset.normRef &&
    typeof offset.normRef.w === 'number' &&
    typeof offset.normRef.h === 'number' &&
    offset.version === 2
  );
}
