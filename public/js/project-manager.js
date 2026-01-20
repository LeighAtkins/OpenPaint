// Project Manager for OpenPaint
// Handles saving and loading projects using ZIP format

// console.log('PROJECT-MANAGER.JS LOADED - Version ' + new Date().toISOString());

document.addEventListener('DOMContentLoaded', () => {
  // Get reference to save and load buttons
  const saveProjectBtn = document.getElementById('saveProject');
  const loadProjectBtn = document.getElementById('loadProject');

  // Add event listeners
  if (saveProjectBtn) {
    saveProjectBtn.addEventListener('click', () => {
      // Before saving, log the current scales for all images
      // console.log('[Save Project] Verifying scales before saving:');
      if (window.imageScaleByLabel) {
        Object.keys(window.imageScaleByLabel).forEach(label => {
          // console.log(`- Scale for ${label}: ${window.imageScaleByLabel[label]}`);
        });
      } else {
        // console.log('- imageScaleByLabel is not defined!');
      }

      // Now explicitly verify the current view's scale is correct
      const currentLabel = window.currentImageLabel;
      if (currentLabel) {
        // console.log(`[Save Project] Current view is ${currentLabel}`);
        // console.log(`[Save Project] Current scale for ${currentLabel} is ${window.imageScaleByLabel[currentLabel]}`);

        // Get scale from the UI as a backup check
        const scaleEl = document.getElementById('scaleButton');
        if (scaleEl) {
          const scaleText = scaleEl.textContent;
          // console.log(`[Save Project] Scale shown in UI: ${scaleText}`);

          // Try to parse the scale from UI text (e.g. "Scale: 25% ▼")
          const scaleMatch = scaleText.match(/Scale: (\d+)%/);
          if (scaleMatch && scaleMatch[1]) {
            const uiScale = parseInt(scaleMatch[1]) / 100;
            // console.log(`[Save Project] Parsed UI scale: ${uiScale}`);

            // If UI scale doesn't match stored scale, update the stored scale
            if (uiScale !== window.imageScaleByLabel[currentLabel]) {
              // console.log(`[Save Project] Scale mismatch! Updating scale for ${currentLabel} from ${window.imageScaleByLabel[currentLabel]} to ${uiScale}`);
              window.imageScaleByLabel[currentLabel] = uiScale;
            }
          }
        }
      }

      // Call modern Fabric.js save function
      if (
        window.app &&
        window.app.canvasManager &&
        typeof window.saveFabricProject === 'function'
      ) {
        window.saveFabricProject();
      } else {
        // Fallback to legacy save if modern system not available
        saveProject();
      }
    });
  }

  if (loadProjectBtn) {
    loadProjectBtn.addEventListener('click', loadProject);
  }

  // Add event listeners for new buttons
  const generateMeasurementsBtn = document.getElementById('generateMeasurements');
  if (generateMeasurementsBtn) {
    generateMeasurementsBtn.addEventListener('click', () => {
      if (typeof generateMeasurementsList === 'function') {
        generateMeasurementsList();
      } else {
        console.error('generateMeasurementsList function not found');
      }
    });
  }

  const saveAllImagesBtn = document.getElementById('saveAllImages');
  if (saveAllImagesBtn) {
    saveAllImagesBtn.addEventListener('click', () => {
      if (typeof saveAllImages === 'function') {
        saveAllImages();
      } else {
        console.error('saveAllImages function not found');
      }
    });
  }

  // Add this BEFORE the loadProject function
  // Global variable to store project data across async operations
  window.loadedProjectDataGlobal = null;

  // PERFORMANCE FIX: Global guards and utilities to prevent loading loops
  window.isLoadingProject = window.isLoadingProject || false;
  window.isSyncingLegacy = window.isSyncingLegacy || false;
  window.pendingLegacySync = window.pendingLegacySync || false;
  window.lastLegacySyncHash = window.lastLegacySyncHash || '';
  window.legacySyncTimer = window.legacySyncTimer || null;

  // Utility functions for migration and stability
  function normalizeFurnitureTag(tag) {
    if (Array.isArray(tag)) return tag[0] || '';
    if (typeof tag === 'string') return tag;
    return '';
  }

  function ensureStrokeMapsForImage(obj, imageLabel, strokeIds) {
    obj[imageLabel] = obj[imageLabel] || {};
    for (const id of strokeIds) {
      if (typeof obj[imageLabel][id] !== 'boolean') obj[imageLabel][id] = true;
    }
  }

  function buildDefaultFolderStructure(imageLabels, imageOrder) {
    const ordered = imageOrder && imageOrder.length ? imageOrder : imageLabels;
    return {
      root: {
        id: 'root',
        name: 'Root',
        type: 'folder',
        parentId: null,
        children: ordered.map(l => ({
          id: l,
          name: l,
          type: 'image',
          parentId: 'root',
          children: [],
        })),
      },
    };
  }

  function migrateProject(project) {
    console.log('[Migration] Starting project migration...');
    const migrated = JSON.parse(JSON.stringify(project));

    // 1) Normalize imageTags.furnitureType to string (fixes mixed array/string issue)
    if (!migrated.imageTags) migrated.imageTags = {};
    for (const img of Object.keys(migrated.imageTags)) {
      const ft = migrated.imageTags[img]?.furnitureType;
      if (ft !== undefined) {
        migrated.imageTags[img].furnitureType = normalizeFurnitureTag(ft);
      }
    }

    // 2) Ensure scales/positions/rotations for every imageLabel
    migrated.imageScales = migrated.imageScales || {};
    migrated.imagePositions = migrated.imagePositions || {};
    migrated.imageRotations = migrated.imageRotations || {};
    for (const label of migrated.imageLabels || []) {
      if (!migrated.imageScales[label] && migrated.imageScales[label] !== 0) {
        migrated.imageScales[label] = 1.0;
      }
      if (!migrated.imagePositions[label]) {
        migrated.imagePositions[label] = { x: 0, y: 0 };
      }
      if (!migrated.imageRotations[label] && migrated.imageRotations[label] !== 0) {
        migrated.imageRotations[label] = 0;
      }
    }

    // 3) Ensure strokeVisibility and strokeLabelVisibility contain booleans for all strokes
    migrated.strokeVisibility = migrated.strokeVisibility || {};
    migrated.strokeLabelVisibility = migrated.strokeLabelVisibility || {};
    for (const img of Object.keys(migrated.strokes || {})) {
      const strokeIds = Object.keys(migrated.strokes[img] || {});
      ensureStrokeMapsForImage(migrated.strokeVisibility, img, strokeIds);
      ensureStrokeMapsForImage(migrated.strokeLabelVisibility, img, strokeIds);
    }

    // 4) CRITICAL FIX: Ensure folderStructure includes all images (prevents legacy gallery loops)
    const children = migrated.folderStructure?.root?.children || [];
    const knownIds = new Set(children.map(c => c.id));
    const needBuild =
      !migrated.folderStructure || !migrated.folderStructure.root || children.length === 0;

    if (needBuild) {
      console.log('[Migration] Building missing folderStructure from imageLabels');
      migrated.folderStructure = buildDefaultFolderStructure(
        migrated.imageLabels || [],
        migrated.imageOrder || []
      );
    } else {
      // Append any missing labels into folder root
      const root = migrated.folderStructure.root;
      for (const l of migrated.imageLabels || []) {
        if (!knownIds.has(l)) {
          console.log(`[Migration] Adding missing image ${l} to folderStructure`);
          root.children.push({ id: l, name: l, type: 'image', parentId: 'root', children: [] });
        }
      }
    }

    // 5) Migrate label offsets from legacy absolute coordinates to normalized format
    migrated.customLabelPositions = migrated.customLabelPositions || {};
    migrated.calculatedLabelOffsets = migrated.calculatedLabelOffsets || {};

    console.log(
      '[Migration] Starting offset migration. originalImageDimensions:',
      migrated.originalImageDimensions
    );

    for (const label of migrated.imageLabels || []) {
      const dims = migrated.originalImageDimensions && migrated.originalImageDimensions[label];
      const refPx = dims && dims.width ? dims.width : 1;
      console.log(`[Migration] Processing label ${label}: dims=`, dims, `refPx=${refPx}`);

      // Migrate customLabelPositions
      if (migrated.customLabelPositions[label]) {
        const posMap = migrated.customLabelPositions[label];
        for (const strokeLabel of Object.keys(posMap)) {
          const offset = posMap[strokeLabel];
          // Check if this is legacy format (has x,y but no 'kind' field, indicating it needs normalization)
          if (
            offset &&
            typeof offset.x === 'number' &&
            typeof offset.y === 'number' &&
            !offset.kind
          ) {
            // Legacy format detected - convert to normalized
            console.log(
              `[Migration] Converting legacy offset for ${label}.${strokeLabel}: (${offset.x}, ${offset.y}) with refPx=${refPx}`
            );
            posMap[strokeLabel] = {
              kind: 'norm',
              dx_norm: offset.x / refPx,
              dy_norm: offset.y / refPx,
              normRef: 'width',
            };
          }
        }
      }

      // Migrate calculatedLabelOffsets
      if (migrated.calculatedLabelOffsets[label]) {
        const offsetMap = migrated.calculatedLabelOffsets[label];
        for (const strokeLabel of Object.keys(offsetMap)) {
          const offset = offsetMap[strokeLabel];
          // Check if this is legacy format
          if (
            offset &&
            typeof offset.x === 'number' &&
            typeof offset.y === 'number' &&
            !offset.kind
          ) {
            console.log(
              `[Migration] Converting legacy calculated offset for ${label}.${strokeLabel}: (${offset.x}, ${offset.y}) with refPx=${refPx}`
            );
            offsetMap[strokeLabel] = {
              kind: 'norm',
              dx_norm: offset.x / refPx,
              dy_norm: offset.y / refPx,
              normRef: 'width',
            };
          }
        }
      }
    }

    // 6) Bump version to prevent re-migration
    migrated.version = '2.0';
    migrated.migrated = true;

    console.log('[Migration] Project migration completed');
    return migrated;
  }

  // Debounced legacy sync (replaces interval-based loops)
  function stableGalleryHash(images, folderStructure) {
    const ids = [];
    if (folderStructure?.root?.children) {
      for (const c of folderStructure.root.children) {
        if (c?.type === 'image') ids.push(c.id);
      }
    }
    ids.sort();
    return ids.join('|');
  }

  function debounce(fn, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  const scheduleLegacySync = debounce(async function syncLegacyOnce() {
    if (window.isLoadingProject) return;
    if (window.isSyncingLegacy) {
      window.pendingLegacySync = true;
      return;
    }

    window.isSyncingLegacy = true;
    try {
      const hash = stableGalleryHash(window.originalImages, window.folderStructure);
      if (hash === window.lastLegacySyncHash) {
        console.log('[Legacy Sync] Hash unchanged, skipping sync');
        return;
      }
      window.lastLegacySyncHash = hash;

      console.log('[Legacy Sync] Processing gallery changes...');
      // Add minimal, idempotent sync logic here if needed
    } finally {
      window.isSyncingLegacy = false;
      if (window.pendingLegacySync) {
        window.pendingLegacySync = false;
        queueMicrotask(() => scheduleLegacySync());
      }
    }
  }, 400);

  // Function to save project as ZIP file
  function saveProject() {
    try {
      // DEBUG: Track images being saved
      console.log('[DEBUG SAVE] ===== Starting Project Save =====');
      let actualImageLabels = Object.keys(window.imageTags || {});
      if (actualImageLabels.length === 0) {
        const fallbackLabels = [...(window.IMAGE_LABELS || ['front', 'side', 'back', 'cushion'])];
        console.log(
          '[DEBUG SAVE] No images found in imageTags, using fallback labels:',
          fallbackLabels
        );
      } else {
        console.log(
          `[DEBUG SAVE] Found ${actualImageLabels.length} image(s) to save:`,
          actualImageLabels
        );
        actualImageLabels.forEach(label => {
          const hasImage = !!(window.originalImages && window.originalImages[label]);
          const hasStrokes = !!(
            window.vectorStrokesByImage &&
            window.vectorStrokesByImage[label] &&
            Object.keys(window.vectorStrokesByImage[label]).length > 0
          );
          const strokeCount = hasStrokes
            ? Object.keys(window.vectorStrokesByImage[label]).length
            : 0;
          console.log(
            `[DEBUG SAVE]   - ${label}: image=${hasImage ? 'YES' : 'NO'}, strokes=${strokeCount}, scale=${window.imageScaleByLabel?.[label] ?? 'N/A'}`
          );
        });
      }

      // DIAGNOSTIC: Add test measurements if needed for debugging
      // console.log('[Save Project] DIAGNOSTIC: Current state of strokeMeasurements before saving:');
      const IMAGE_LABELS = window.IMAGE_LABELS || ['front', 'side', 'back', 'cushion'];
      IMAGE_LABELS.forEach(label => {
        if (window.strokeMeasurements && window.strokeMeasurements[label]) {
          // console.log(`- ${label}:`, JSON.stringify(window.strokeMeasurements[label]));
        } else {
          // console.log(`- ${label}: undefined or empty`);
        }
      });

      // Show status message and loading indicator
      showStatusMessage('Preparing project for download...', 'info');
      const loadingIndicator = document.createElement('div');
      loadingIndicator.id = 'saveLoadingIndicator';
      loadingIndicator.innerHTML = `
                <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                           background: rgba(0,0,0,0.8); color: white; padding: 20px; border-radius: 8px; 
                           z-index: 10000; text-align: center;">
                    <div style="margin-bottom: 10px;">Saving project...</div>
                    <div style="width: 200px; height: 4px; background: #333; border-radius: 2px; overflow: hidden;">
                        <div id="saveProgressBar" style="width: 0%; height: 100%; background: #4CAF50; transition: width 0.3s;"></div>
                    </div>
                </div>
            `;
      document.body.appendChild(loadingIndicator);

      // Create a new JSZip instance with async option
      const zip = new JSZip();

      // Get project name with fallback
      const projectName = document.getElementById('projectName').value || 'OpenPaint Project';

      // Use actualImageLabels already declared above (line 297) for debug logging
      // If it was empty, we need to handle fallback here
      if (actualImageLabels.length === 0) {
        // Fallback if imageTags is empty for some reason
        actualImageLabels = [...(window.IMAGE_LABELS || ['front', 'side', 'back', 'cushion'])];
        console.warn(
          '[Save Project] No keys found in window.imageTags, falling back to default labels.'
        );
      }
      // console.log("[Save Project] Saving data for labels:", actualImageLabels);

      // Create project metadata
      const projectData = {
        name: projectName,
        created: new Date().toISOString(),
        version: '1.0',
        imageLabels: actualImageLabels, // *** MODIFIED: Use actual labels ***
        currentImageLabel: window.currentImageLabel || actualImageLabels[0] || 'front', // Use first actual label as fallback
        // Create empty containers for all data
        strokes: {},
        strokeVisibility: {},
        strokeLabelVisibility: {},
        strokeMeasurements: {},
        imageScales: {},
        imagePositions: {},
        imageRotations: {},
        strokeSequence: {},
        nextLabels: {},
        originalImageDimensions: {},
        imageTags: {},
        customImageNames: {},
        folderStructure: window.folderStructure || {
          root: {
            id: 'root',
            name: 'Root',
            type: 'folder',
            parentId: null,
            children: [],
          },
        },
        pdfFrames: window.pdfFramesByImage || {},
      };

      // *** ADDED LOGGING BEFORE LOOP ***
      // console.log('[Save Project] State before saving loop:');
      // console.log('  window.lineStrokesByImage:', JSON.parse(JSON.stringify(window.lineStrokesByImage)));
      // console.log('  window.labelsByImage:', JSON.parse(JSON.stringify(window.labelsByImage)));
      // console.log('  window.imageTags:', JSON.parse(JSON.stringify(window.imageTags || {})));
      // *** END ADDED LOGGING ***

      // Add stroke data for each image
      for (const label of actualImageLabels) {
        // console.log(`Processing data for ${label}...`);

        // Get vector strokes data - ensure we have data for each label
        if (window.vectorStrokesByImage && window.vectorStrokesByImage[label]) {
          projectData.strokes[label] = JSON.parse(
            JSON.stringify(window.vectorStrokesByImage[label])
          );
        } else {
          projectData.strokes[label] = {};
        }

        // Add stroke visibility settings
        if (window.strokeVisibilityByImage && window.strokeVisibilityByImage[label]) {
          projectData.strokeVisibility[label] = window.strokeVisibilityByImage[label];
        } else {
          projectData.strokeVisibility[label] = {};
        }

        // Add stroke label visibility settings
        if (window.strokeLabelVisibility && window.strokeLabelVisibility[label]) {
          projectData.strokeLabelVisibility[label] = window.strokeLabelVisibility[label];
        } else {
          projectData.strokeLabelVisibility[label] = {};
        }

        // Add stroke measurements
        if (window.strokeMeasurements && window.strokeMeasurements[label]) {
          // console.log(`[Save Project] Saving measurements for ${label}:`,
          //     JSON.stringify(window.strokeMeasurements[label]));

          // Check if there are any actual measurements to save
          const measurementCount = Object.keys(window.strokeMeasurements[label]).length;
          // console.log(`[Save Project] Found ${measurementCount} measurements for ${label}`);

          // Add detailed log of each measurement
          if (measurementCount > 0) {
            Object.entries(window.strokeMeasurements[label]).forEach(
              ([strokeLabel, measurement]) => {
                //                             console.log(`[Save Project] - Measurement for ${strokeLabel}:`, measurement);
              }
            );
          }

          // Add measurements to project data
          projectData.strokeMeasurements[label] = window.strokeMeasurements[label];
        } else {
          //                     console.log(`[Save Project] No measurements found for ${label}, using empty object`);
          projectData.strokeMeasurements[label] = {};
        }

        // Add image scaling and position
        if (window.imageScaleByLabel && window.imageScaleByLabel[label] !== undefined) {
          const currentScale = window.imageScaleByLabel[label];
          projectData.imageScales[label] = currentScale;
          //                     console.log(`[Save Project] Saving scale for ${label}: ${currentScale}`);

          // Double-check to ensure it was assigned correctly
          if (projectData.imageScales[label] !== currentScale) {
            console.error(
              `[Save Project] ERROR: Scale was not saved correctly for ${label}. Expected ${currentScale}, got ${projectData.imageScales[label]}. Fixing...`
            );
            projectData.imageScales[label] = currentScale;
          }
        } else {
          projectData.imageScales[label] = 1.0; // Default to 100% scale
          //                     console.log(`[Save Project] No scale found for ${label}, using default 1.0`);
        }

        if (window.imagePositionByLabel && window.imagePositionByLabel[label]) {
          projectData.imagePositions[label] = window.imagePositionByLabel[label];
          //                     console.log(`[Save Project] Saving position for ${label}: x=${window.imagePositionByLabel[label].x}, y=${window.imagePositionByLabel[label].y}`);
        } else {
          projectData.imagePositions[label] = { x: 0, y: 0 }; // Default position
        }

        // Add image rotation
        if (window.imageRotationByLabel && window.imageRotationByLabel[label] !== undefined) {
          projectData.imageRotations[label] = window.imageRotationByLabel[label];
        } else {
          projectData.imageRotations[label] = 0; // Default to 0 rotation
        }
        //                     console.log(`[Save Project] No position found for ${label}, using default {x:0, y:0}`);

        // Add stroke sequence
        if (window.lineStrokesByImage && window.lineStrokesByImage[label]) {
          projectData.strokeSequence[label] = window.lineStrokesByImage[label].slice();
        } else {
          projectData.strokeSequence[label] = [];
        }

        // Add next label counter
        if (window.labelsByImage && window.labelsByImage[label]) {
          projectData.nextLabels[label] = window.labelsByImage[label];
        } else {
          projectData.nextLabels[label] = 'A1'; // Default starting label
        }

        // Add original image dimensions
        if (window.originalImageDimensions && window.originalImageDimensions[label]) {
          projectData.originalImageDimensions[label] = window.originalImageDimensions[label];
        } else {
          projectData.originalImageDimensions[label] = { width: 0, height: 0 };
        }

        // Add image tags
        if (window.imageTags && window.imageTags[label]) {
          //                     console.log(`[Save Project] Saving tags for ${label}:`, JSON.stringify(window.imageTags[label]));
          projectData.imageTags[label] = JSON.parse(JSON.stringify(window.imageTags[label]));
        } else {
          //                     console.log(`[Save Project] No tags found for ${label}, using empty object`);
          projectData.imageTags[label] = {};
        }

        // Persist custom image name if set
        if (window.customImageNames && window.customImageNames[label]) {
          projectData.customImageNames[label] = window.customImageNames[label];
        }
      }

      // Add custom label positions, calculated offsets, rotation stamps, and text elements after the main loop
      if (!projectData.customLabelPositions) projectData.customLabelPositions = {};
      if (!projectData.calculatedLabelOffsets) projectData.calculatedLabelOffsets = {};
      if (!projectData.customLabelRotationStamps) projectData.customLabelRotationStamps = {};
      if (!projectData.textElementsByImage) projectData.textElementsByImage = {};

      for (const label of actualImageLabels) {
        projectData.customLabelPositions[label] =
          window.customLabelPositions && window.customLabelPositions[label]
            ? JSON.parse(JSON.stringify(window.customLabelPositions[label]))
            : {};

        projectData.calculatedLabelOffsets[label] =
          window.calculatedLabelOffsets && window.calculatedLabelOffsets[label]
            ? JSON.parse(JSON.stringify(window.calculatedLabelOffsets[label]))
            : {};

        projectData.customLabelRotationStamps[label] =
          window.customLabelOffsetsRotationByImageAndStroke &&
          window.customLabelOffsetsRotationByImageAndStroke[label]
            ? JSON.parse(JSON.stringify(window.customLabelOffsetsRotationByImageAndStroke[label]))
            : {};

        projectData.textElementsByImage[label] =
          window.paintApp?.state?.textElementsByImage &&
          window.paintApp.state.textElementsByImage[label]
            ? JSON.parse(JSON.stringify(window.paintApp.state.textElementsByImage[label]))
            : [];
      }

      // Add image order for sidebar persistence
      if (window.orderedImageLabels && window.orderedImageLabels.length > 0) {
        projectData.imageOrder = [...window.orderedImageLabels];
        //                 console.log('[Save Project] Saving image order:', JSON.stringify(projectData.imageOrder));
      } else {
        // Fallback to actual image labels for backward compatibility
        projectData.imageOrder = [...actualImageLabels];
        //                 console.log('[Save Project] No orderedImageLabels found, using actualImageLabels as order:', JSON.stringify(projectData.imageOrder));
      }

      // Add project.json to the zip
      zip.file('project.json', JSON.stringify(projectData, null, 2));

      // Save AI exports if they exist
      if (window.aiExports && typeof window.aiExports === 'object') {
        for (const label of actualImageLabels) {
          const aiExport = window.aiExports[label];
          if (aiExport && aiExport.svg && aiExport.vectors) {
            console.log(`[Save Project] Saving AI export for ${label}`);
            zip.file(`exports/${label}/ai-latest.svg`, aiExport.svg);
            zip.file(
              `exports/${label}/ai-latest.json`,
              JSON.stringify(
                {
                  vectors: aiExport.vectors,
                  summary: aiExport.summary,
                  timestamp: aiExport.timestamp,
                },
                null,
                2
              )
            );
          }
        }
      }

      // Validate that scales were correctly added to the project data
      //             console.log('[Save Project] VALIDATION - Checking scales in project data:');
      if (projectData.imageScales) {
        Object.keys(projectData.imageScales).forEach(label => {
          //                     console.log(`- Project data scale for ${label}: ${projectData.imageScales[label]}`);

          // Compare with the current scale in the app
          if (window.imageScaleByLabel && window.imageScaleByLabel[label] !== undefined) {
            const currentScale = window.imageScaleByLabel[label];
            if (currentScale !== projectData.imageScales[label]) {
              console.error(
                `[Save Project] ERROR: Scale mismatch for ${label}! App: ${currentScale}, Project data: ${projectData.imageScales[label]}`
              );
            } else {
              //                             console.log(`[Save Project] ✓ Scale verified for ${label}: ${currentScale}`);
            }
          }
        });
      } else {
        console.error('[Save Project] ERROR: No imageScales in project data!');
      }

      // Add image files
      const imagePromises = [];

      // *** MODIFIED: Iterate over actual labels for image saving ***
      console.log('[DEBUG SAVE] Processing images for ZIP file...');
      for (const label of actualImageLabels) {
        const imageUrl = window.originalImages ? window.originalImages[label] : null;
        if (imageUrl) {
          console.log(
            `[DEBUG SAVE]   Adding image for ${label} (URL type: ${imageUrl.substring(0, 20)}...)`
          );
          const promise = fetch(imageUrl)
            .then(response => {
              if (!response.ok) {
                throw new Error(`Failed to fetch image for ${label}: ${response.statusText}`);
              }
              return response.blob();
            })
            .then(blob => {
              // *** MODIFIED: Use label as filename base ***
              zip.file(`${label}.png`, blob);
              console.log(
                `[DEBUG SAVE]   ✓ Successfully added ${label}.png to zip (${(blob.size / 1024).toFixed(2)} KB)`
              );
            })
            .catch(error => {
              console.error(`[DEBUG SAVE]   ✗ Error adding image ${label} to zip:`, error);
              // Optionally show a user-facing error here
            });
          imagePromises.push(promise);
        } else {
          console.log(
            `[DEBUG SAVE]   ⚠ No original image found for ${label}, skipping image file.`
          );
        }
      }
      console.log(`[DEBUG SAVE] Total image promises created: ${imagePromises.length}`);

      // Add a special spinner or indicator while saving
      const saveIndicator = document.createElement('div');
      saveIndicator.id = 'saveIndicator';
      saveIndicator.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 20px;
                border-radius: 10px;
                z-index: 10000;
                text-align: center;
            `;
      saveIndicator.innerHTML = `
                <div style="margin-bottom: 10px;">Saving project...</div>
                <div class="spinner" style="border: 5px solid #f3f3f3; border-top: 5px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 2s linear infinite; margin: 0 auto;"></div>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            `;
      document.body.appendChild(saveIndicator);

      // Wait for all image fetches to complete
      Promise.all(imagePromises)
        .then(() => {
          // Update progress
          const progressBar = document.getElementById('saveProgressBar');
          if (progressBar) progressBar.style.width = '70%';

          // Generate the zip file with optimized settings
          return zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 3 }, // Reduced compression for faster generation
            streamFiles: true, // Enable streaming for better performance
          });
        })
        .then(content => {
          // Update progress to complete
          const progressBar = document.getElementById('saveProgressBar');
          if (progressBar) progressBar.style.width = '100%';

          // Remove the save indicator
          if (saveIndicator.parentNode) {
            saveIndicator.parentNode.removeChild(saveIndicator);
          }

          // Remove loading indicator
          const loadingIndicator = document.getElementById('saveLoadingIndicator');
          if (loadingIndicator && loadingIndicator.parentNode) {
            loadingIndicator.parentNode.removeChild(loadingIndicator);
          }

          // Create download link
          const link = document.createElement('a');
          link.href = URL.createObjectURL(content);

          // Generate a filename based on project name and date
          const safeProjectName = projectName.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
          const dateString = new Date().toISOString().split('T')[0];
          link.download = `${safeProjectName}_${dateString}.zip`;

          // Trigger download
          link.click();

          // Clean up the URL object
          setTimeout(() => URL.revokeObjectURL(link.href), 100);

          // Show success message
          console.log('[DEBUG SAVE] ===== Project Save Complete =====');
          showStatusMessage('Project saved successfully!', 'success');
        })
        .catch(err => {
          console.error('[DEBUG SAVE] ===== Project Save Failed =====', err);
          // Remove the save indicator
          if (saveIndicator.parentNode) {
            saveIndicator.parentNode.removeChild(saveIndicator);
          }

          console.error('Error creating ZIP file:', err);
          showStatusMessage('Error saving project. See console for details.', 'error');
        });
    } catch (err) {
      console.error('Error in saveProject:', err);
      showStatusMessage('Error saving project. See console for details.', 'error');
    }
  }

  // Function to load project from a JSON file
  function loadProjectFromJSON(file) {
    window.isLoadingProject = true;
    console.log('[Load JSON] Loading project from JSON file:', file.name);

    showStatusMessage('Loading JSON project...', 'info');

    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'loadingIndicator';
    loadingIndicator.innerHTML = `
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                 background: rgba(0,0,0,0.8); color: white; padding: 20px; border-radius: 8px; 
                 z-index: 10000; text-align: center;">
          <div style="margin-bottom: 10px;">Loading JSON project...</div>
          <div style="width: 200px; height: 4px; background: #333; border-radius: 2px; overflow: hidden;">
              <div id="loadProgressBar" style="width: 0%; height: 100%; background: #4CAF50; transition: width 0.3s;"></div>
          </div>
      </div>
    `;
    document.body.appendChild(loadingIndicator);

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const progressBar = document.getElementById('loadProgressBar');
        if (progressBar) progressBar.style.width = '30%';

        const jsonContent = e.target.result;
        const rawProjectData = JSON.parse(jsonContent);

        console.log('[Load JSON] Parsed project data:', rawProjectData.name || 'Unnamed');

        if (progressBar) progressBar.style.width = '50%';

        // Apply migration to ensure data compatibility
        const parsedProjectData = migrateProject(rawProjectData);

        // Initialize all data structures
        document.getElementById('projectName').value =
          parsedProjectData.name || 'OpenPaint Project';

        const imageList = document.getElementById('imageList');
        if (imageList) imageList.innerHTML = '';

        window.vectorStrokesByImage = {};
        window.strokeVisibilityByImage = {};
        window.strokeLabelVisibility = {};
        window.strokeMeasurements = {};
        window.imageScaleByLabel = {};
        window.imagePositionByLabel = {};
        window.imageRotationByLabel = {};
        window.lineStrokesByImage = {};
        window.labelsByImage = {};
        window.originalImages = {};
        window.originalImageDimensions = {};
        window.imageTags = {};
        window.customImageNames = {};

        if (window.legacySyncTimer) {
          clearInterval(window.legacySyncTimer);
          window.legacySyncTimer = null;
        }

        if (parsedProjectData.folderStructure) {
          window.folderStructure = JSON.parse(JSON.stringify(parsedProjectData.folderStructure));
        } else {
          window.folderStructure = {
            root: { id: 'root', name: 'Root', type: 'folder', parentId: null, children: [] },
          };
        }

        if (parsedProjectData.pdfFrames) {
          window.pdfFramesByImage = JSON.parse(JSON.stringify(parsedProjectData.pdfFrames));
        } else {
          window.pdfFramesByImage = {};
        }

        if (progressBar) progressBar.style.width = '70%';

        // Determine image processing order
        const imageOrder = parsedProjectData.imageOrder || [];
        let labelsToProcess = [];

        if (imageOrder.length > 0) {
          const uniqueImageOrder = [...new Set(imageOrder)];
          labelsToProcess = uniqueImageOrder.filter(label =>
            parsedProjectData.imageLabels.includes(label)
          );
          parsedProjectData.imageLabels.forEach(label => {
            if (!labelsToProcess.includes(label)) {
              labelsToProcess.push(label);
            }
          });
        } else {
          labelsToProcess = [...new Set(parsedProjectData.imageLabels)];
        }

        labelsToProcess = [...new Set(labelsToProcess)];
        window.orderedImageLabels = [...labelsToProcess];

        console.log(
          '[Load JSON] Processing',
          labelsToProcess.length,
          'image labels (no image files in JSON)'
        );

        // Load all data for each label
        for (const label of labelsToProcess) {
          console.log('[Load JSON] Processing label:', label);

          // Initialize structures
          if (typeof window.initializeNewImageStructures === 'function') {
            window.initializeNewImageStructures(label);
          }

          // Load stroke data
          if (parsedProjectData.strokes && parsedProjectData.strokes[label]) {
            window.vectorStrokesByImage[label] = JSON.parse(
              JSON.stringify(parsedProjectData.strokes[label])
            );
            console.log(
              '[Load JSON] Loaded',
              Object.keys(window.vectorStrokesByImage[label]).length,
              'strokes for',
              label
            );
          }

          if (parsedProjectData.strokeSequence && parsedProjectData.strokeSequence[label]) {
            window.lineStrokesByImage[label] = Array.isArray(
              parsedProjectData.strokeSequence[label]
            )
              ? parsedProjectData.strokeSequence[label].slice()
              : [];
          }

          // Load visibility
          if (parsedProjectData.strokeVisibility && parsedProjectData.strokeVisibility[label]) {
            window.strokeVisibilityByImage[label] = parsedProjectData.strokeVisibility[label];
          }
          if (
            parsedProjectData.strokeLabelVisibility &&
            parsedProjectData.strokeLabelVisibility[label]
          ) {
            window.strokeLabelVisibility[label] = parsedProjectData.strokeLabelVisibility[label];
          }

          // Load measurements
          if (parsedProjectData.strokeMeasurements && parsedProjectData.strokeMeasurements[label]) {
            window.strokeMeasurements[label] = JSON.parse(
              JSON.stringify(parsedProjectData.strokeMeasurements[label])
            );
            Object.keys(window.strokeMeasurements[label]).forEach(strokeLabel => {
              const measurement = window.strokeMeasurements[label][strokeLabel];
              if (measurement && measurement.underReview === undefined) {
                measurement.underReview = false;
              }
            });
          }

          // Load tags and names
          if (parsedProjectData.imageTags && parsedProjectData.imageTags[label]) {
            window.imageTags[label] = JSON.parse(
              JSON.stringify(parsedProjectData.imageTags[label])
            );
          }
          if (parsedProjectData.customImageNames && parsedProjectData.customImageNames[label]) {
            window.customImageNames[label] = parsedProjectData.customImageNames[label];
          }

          // Load transforms
          if (parsedProjectData.imageScales && parsedProjectData.imageScales[label] !== undefined) {
            window.imageScaleByLabel[label] = parsedProjectData.imageScales[label];
          } else {
            window.imageScaleByLabel[label] = 1.0;
          }

          window.imagePositionByLabel[label] = { x: 0, y: 0 };

          if (
            parsedProjectData.imageRotations &&
            parsedProjectData.imageRotations[label] !== undefined
          ) {
            window.imageRotationByLabel[label] = parsedProjectData.imageRotations[label];
          } else {
            window.imageRotationByLabel[label] = 0;
          }

          if (parsedProjectData.nextLabels && parsedProjectData.nextLabels[label]) {
            window.labelsByImage[label] = parsedProjectData.nextLabels[label];
          }

          // Load dimensions
          if (
            parsedProjectData.originalImageDimensions &&
            parsedProjectData.originalImageDimensions[label]
          ) {
            window.originalImageDimensions[label] =
              parsedProjectData.originalImageDimensions[label];
          } else {
            window.originalImageDimensions[label] = { width: 0, height: 0 };
          }

          // Load label positions and offsets
          if (!window.customLabelPositions) window.customLabelPositions = {};
          if (!window.calculatedLabelOffsets) window.calculatedLabelOffsets = {};
          if (!window.customLabelOffsetsRotationByImageAndStroke)
            window.customLabelOffsetsRotationByImageAndStroke = {};
          if (!window.paintApp) window.paintApp = { state: {} };
          if (!window.paintApp.state) window.paintApp.state = {};
          if (!window.paintApp.state.textElementsByImage)
            window.paintApp.state.textElementsByImage = {};

          window.customLabelPositions[label] =
            parsedProjectData.customLabelPositions && parsedProjectData.customLabelPositions[label]
              ? JSON.parse(JSON.stringify(parsedProjectData.customLabelPositions[label]))
              : {};

          window.calculatedLabelOffsets[label] =
            parsedProjectData.calculatedLabelOffsets &&
            parsedProjectData.calculatedLabelOffsets[label]
              ? JSON.parse(JSON.stringify(parsedProjectData.calculatedLabelOffsets[label]))
              : {};

          window.customLabelOffsetsRotationByImageAndStroke[label] =
            parsedProjectData.customLabelRotationStamps &&
            parsedProjectData.customLabelRotationStamps[label]
              ? JSON.parse(JSON.stringify(parsedProjectData.customLabelRotationStamps[label]))
              : {};

          window.paintApp.state.textElementsByImage[label] =
            parsedProjectData.textElementsByImage && parsedProjectData.textElementsByImage[label]
              ? JSON.parse(JSON.stringify(parsedProjectData.textElementsByImage[label]))
              : [];

          // Ensure text elements have useCanvasCoords set
          if (window.paintApp.state.textElementsByImage[label]) {
            window.paintApp.state.textElementsByImage[label].forEach(textEl => {
              if (textEl && textEl.useCanvasCoords === undefined) {
                textEl.useCanvasCoords = true;
              }
            });
          }
        }

        if (progressBar) progressBar.style.width = '90%';

        // Set current image and finalize
        setTimeout(() => {
          const availableLabels = labelsToProcess;
          const targetLabel = availableLabels.length > 0 ? availableLabels[0] : 'front';

          console.log('[Load JSON] Setting current image to:', targetLabel);

          if (typeof window.switchToImage === 'function') {
            window.currentImageLabel = targetLabel;
            window.switchToImage(targetLabel);
          }

          // Update UI
          try {
            if (typeof window.updateSidebarStrokeCounts === 'function')
              window.updateSidebarStrokeCounts();
            if (typeof window.updateScaleUI === 'function') window.updateScaleUI();
            if (typeof window.updateActiveImageInSidebar === 'function')
              window.updateActiveImageInSidebar();
            if (typeof window.updateStrokeVisibilityControls === 'function')
              window.updateStrokeVisibilityControls();
          } catch (uiError) {
            console.error('[Load JSON] UI update error:', uiError);
          }

          // Finalize
          setTimeout(() => {
            if (typeof window.redrawCanvasWithVisibility === 'function') {
              window.redrawCanvasWithVisibility();
            }

            if (progressBar) progressBar.style.width = '100%';

            const loadingIndicator = document.getElementById('loadingIndicator');
            if (loadingIndicator && loadingIndicator.parentNode) {
              loadingIndicator.parentNode.removeChild(loadingIndicator);
            }

            window.isLoadingProject = false;
            queueMicrotask(() => scheduleLegacySync());

            showStatusMessage('JSON project loaded successfully (no images included)', 'success');
            console.log('[Load JSON] Complete');
          }, 100);
        }, 200);
      } catch (err) {
        window.isLoadingProject = false;
        document.getElementById('loadingIndicator')?.remove();
        console.error('[Load JSON] Error loading JSON project:', err);
        showStatusMessage(`Error loading JSON: ${err.message}`, 'error');
      }
    };

    reader.onerror = function (e) {
      window.isLoadingProject = false;
      const loadingIndicator = document.getElementById('loadingIndicator');
      if (loadingIndicator && loadingIndicator.parentNode) {
        loadingIndicator.parentNode.removeChild(loadingIndicator);
      }
      console.error('[Load JSON] Error reading file:', e);
      showStatusMessage('Error reading JSON file', 'error');
    };

    reader.readAsText(file);
  }

  // Function to load project from a ZIP or JSON file
  function loadProject() {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.json';

    // Handle file selection
    input.onchange = function (e) {
      const file = e.target.files[0];
      if (!file) return;

      // Determine file type
      const isJSON = file.name.toLowerCase().endsWith('.json');
      const isZIP = file.name.toLowerCase().endsWith('.zip');

      if (!isJSON && !isZIP) {
        showStatusMessage('Please select a .zip or .json project file', 'error');
        return;
      }

      // Route to appropriate loader
      if (isJSON) {
        loadProjectFromJSON(file);
        return;
      }

      // Continue with ZIP loading for .zip files

      // *** SET LOADING FLAG ***
      window.isLoadingProject = true;
      //             console.log('[Load Project] Set isLoadingProject = true');

      showStatusMessage('Loading project...', 'info');

      // Create loading indicator with progress bar
      const loadingIndicator = document.createElement('div');
      loadingIndicator.id = 'loadingIndicator';
      loadingIndicator.innerHTML = `
                <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                           background: rgba(0,0,0,0.8); color: white; padding: 20px; border-radius: 8px; 
                           z-index: 10000; text-align: center;">
                    <div style="margin-bottom: 10px;">Loading project...</div>
                    <div style="width: 200px; height: 4px; background: #333; border-radius: 2px; overflow: hidden;">
                        <div id="loadProgressBar" style="width: 0%; height: 100%; background: #4CAF50; transition: width 0.3s;"></div>
                    </div>
                </div>
            `;
      document.body.appendChild(loadingIndicator);

      // Read the selected file
      const reader = new FileReader();
      reader.onload = function (e) {
        const data = e.target.result;

        // Update progress
        const progressBar = document.getElementById('loadProgressBar');
        if (progressBar) progressBar.style.width = '20%';

        JSZip.loadAsync(data)
          .then(zip => {
            // Update progress
            if (progressBar) progressBar.style.width = '40%';
            //                         console.log("ZIP file loaded. Contents:", Object.keys(zip.files));
            const projectJsonFile = zip.file('project.json');
            if (!projectJsonFile) {
              throw new Error('Missing project.json'); // This will be caught by the final .catch()
            }

            return projectJsonFile.async('string').then(jsonContent => {
              // Update progress
              if (progressBar) progressBar.style.width = '60%';
              //                                 console.log("Project data loaded:", jsonContent.substring(0, 100) + "...");
              const rawProjectData = JSON.parse(jsonContent);

              // PERFORMANCE FIX: Apply migration to prevent repeated processing
              const parsedProjectData = migrateProject(rawProjectData);

              document.getElementById('projectName').value =
                parsedProjectData.name || 'OpenPaint Project';
              const imageList = document.getElementById('imageList');
              if (imageList) imageList.innerHTML = '';

              window.vectorStrokesByImage = {};
              window.strokeVisibilityByImage = {};
              window.strokeLabelVisibility = {};
              window.strokeMeasurements = {};
              window.imageScaleByLabel = {};
              window.imagePositionByLabel = {};
              window.imageRotationByLabel = {};
              window.lineStrokesByImage = {};
              window.labelsByImage = {};
              window.originalImages = {};
              window.originalImageDimensions = {};
              window.imageTags = {};
              window.customImageNames = {};

              // PERFORMANCE FIX: Clear any legacy sync timers during load
              if (window.legacySyncTimer) {
                clearInterval(window.legacySyncTimer);
                window.legacySyncTimer = null;
              }

              if (parsedProjectData.folderStructure) {
                window.folderStructure = JSON.parse(
                  JSON.stringify(parsedProjectData.folderStructure)
                );
              } else {
                window.folderStructure = {
                  root: { id: 'root', name: 'Root', type: 'folder', parentId: null, children: [] },
                };
              }

              // Load PDF frames data
              if (parsedProjectData.pdfFrames) {
                window.pdfFramesByImage = JSON.parse(JSON.stringify(parsedProjectData.pdfFrames));
                console.log(
                  '[DEBUG LOAD] Loaded PDF frames:',
                  Object.keys(window.pdfFramesByImage).length,
                  'images with frames'
                );
              } else {
                window.pdfFramesByImage = {};
              }

              // Determine the order for processing images
              console.log('[DEBUG LOAD] ===== loadProject: Loading Images =====');
              console.log(`[DEBUG LOAD]   Project name: ${parsedProjectData.name || 'Unnamed'}`);
              console.log(
                `[DEBUG LOAD]   Images in project: ${parsedProjectData.imageLabels?.length || 0}`,
                parsedProjectData.imageLabels
              );

              const imageOrder = parsedProjectData.imageOrder || [];
              let labelsToProcess = [];

              if (imageOrder.length > 0) {
                // Filter imageOrder to only include labels that actually exist in the project
                // Use Set to deduplicate imageOrder first
                const uniqueImageOrder = [...new Set(imageOrder)];
                labelsToProcess = uniqueImageOrder.filter(label =>
                  parsedProjectData.imageLabels.includes(label)
                );

                // Add any images present in imageLabels but missing from imageOrder (for backward compatibility)
                parsedProjectData.imageLabels.forEach(label => {
                  if (!labelsToProcess.includes(label)) {
                    labelsToProcess.push(label);
                  }
                });
              } else {
                // Fallback for older projects without imageOrder
                // Deduplicate imageLabels as well
                labelsToProcess = [...new Set(parsedProjectData.imageLabels)];
              }

              // Final deduplication to ensure no duplicates
              labelsToProcess = [...new Set(labelsToProcess)];

              console.log(
                `[DEBUG LOAD]   Processing ${labelsToProcess.length} image(s) in order:`,
                labelsToProcess
              );

              // Initialize paint.js's ordered list with the loaded order
              window.orderedImageLabels = [...labelsToProcess];

              const imagePromises = [];
              for (const label of labelsToProcess) {
                console.log(`[DEBUG LOAD]   Processing label: ${label}`);
                const safeLabel = label.toLowerCase();
                const imageFiles = Object.keys(zip.files).filter(
                  filename =>
                    filename.toLowerCase().startsWith(`${safeLabel}.`) &&
                    !filename.endsWith('/') &&
                    filename !== 'project.json'
                );
                if (imageFiles.length > 0) {
                  const imageFile = imageFiles[0];
                  console.log(`[DEBUG LOAD]     Found image file: ${imageFile}`);
                  const promise = zip
                    .file(imageFile)
                    .async('blob')
                    .then(blob => {
                      // PERFORMANCE FIX: Use object URL instead of data URL (faster, no base64 encoding)
                      const objectUrl = URL.createObjectURL(blob);
                      window.originalImages[label] = objectUrl;
                      console.log(
                        `[DEBUG LOAD]     Created object URL for ${label} (${(blob.size / 1024).toFixed(2)} KB)`
                      );
                      return new Promise(resolveDim => {
                        const img = new Image();
                        img.onload = () => {
                          window.originalImageDimensions[label] = {
                            width: img.width,
                            height: img.height,
                          };
                          console.log(
                            `[DEBUG LOAD]     ${label} dimensions: ${img.width}x${img.height}`
                          );
                          resolveDim();
                        };
                        img.onerror = () => {
                          window.originalImageDimensions[label] = { width: 0, height: 0 };
                          console.error(
                            `[DEBUG LOAD]     ✗ ${label} failed to load, dimensions set to zero`
                          );
                          resolveDim();
                        };
                        img.src = objectUrl;
                      });
                    })
                    .then(() => {
                      // After image and dimensions are loaded for this label
                      console.log(`[DEBUG LOAD]     Loading data for ${label}`);

                      // Store stroke data temporarily before initializeNewImageStructures clears it
                      const savedVectorStrokes =
                        parsedProjectData.strokes && parsedProjectData.strokes[label]
                          ? JSON.parse(JSON.stringify(parsedProjectData.strokes[label]))
                          : null;
                      const savedLineStrokes =
                        parsedProjectData.strokeSequence && parsedProjectData.strokeSequence[label]
                          ? Array.isArray(parsedProjectData.strokeSequence[label])
                            ? parsedProjectData.strokeSequence[label].slice()
                            : []
                          : null;

                      // Initialize structures (this will clear stroke data, which we'll restore after)
                      if (typeof window.initializeNewImageStructures === 'function') {
                        window.initializeNewImageStructures(label);
                      }

                      // CRITICAL: Restore stroke data AFTER initializeNewImageStructures clears it
                      if (savedVectorStrokes) {
                        window.vectorStrokesByImage[label] = savedVectorStrokes;
                        console.log(
                          `[DEBUG LOAD]     ✓ Loaded ${Object.keys(window.vectorStrokesByImage[label]).length} vector strokes for ${label}`
                        );
                      }

                      if (savedLineStrokes) {
                        window.lineStrokesByImage[label] = savedLineStrokes;
                        console.log(
                          `[DEBUG LOAD]     ✓ Loaded ${window.lineStrokesByImage[label].length} line strokes for ${label}`
                        );
                      }

                      if (typeof window.addImageToSidebar === 'function') {
                        window.addImageToSidebar(window.originalImages[label], label);
                        console.log(`[DEBUG LOAD]     ✓ Added ${label} to sidebar`);
                      }

                      // Load other per-label data from parsedProjectData (overwrite defaults from initializeNewImageStructures)
                      if (
                        parsedProjectData.strokeVisibility &&
                        parsedProjectData.strokeVisibility[label]
                      )
                        window.strokeVisibilityByImage[label] =
                          parsedProjectData.strokeVisibility[label];
                      if (
                        parsedProjectData.strokeLabelVisibility &&
                        parsedProjectData.strokeLabelVisibility[label]
                      )
                        window.strokeLabelVisibility[label] =
                          parsedProjectData.strokeLabelVisibility[label];
                      if (
                        parsedProjectData.strokeMeasurements &&
                        parsedProjectData.strokeMeasurements[label]
                      ) {
                        window.strokeMeasurements[label] = JSON.parse(
                          JSON.stringify(parsedProjectData.strokeMeasurements[label])
                        );
                        // Ensure underReview flag exists for backward compatibility
                        // Also ensure originalMeasurement exists if underReview is true
                        Object.keys(window.strokeMeasurements[label]).forEach(strokeLabel => {
                          const measurement = window.strokeMeasurements[label][strokeLabel];
                          if (measurement) {
                            if (measurement.underReview === undefined) {
                              measurement.underReview = false;
                            }
                            // If underReview is true but originalMeasurement is missing, try to reconstruct it
                            // This handles backward compatibility with old projects
                            if (
                              measurement.underReview === true &&
                              !measurement.originalMeasurement
                            ) {
                              // Store current measurement values as original (best guess for old projects)
                              measurement.originalMeasurementValues = {
                                inchWhole: measurement.inchWhole || 0,
                                inchFraction: measurement.inchFraction || 0,
                                cm: measurement.cm || 0.0,
                              };
                              // Note: originalMeasurement string will be reconstructed in paint.js when rendering
                              // We can't call getMeasurementString here as it might not be available in this context
                            }
                          }
                        });
                      }
                      if (parsedProjectData.imageTags && parsedProjectData.imageTags[label])
                        window.imageTags[label] = JSON.parse(
                          JSON.stringify(parsedProjectData.imageTags[label])
                        );
                      if (
                        parsedProjectData.customImageNames &&
                        parsedProjectData.customImageNames[label]
                      ) {
                        window.customImageNames[label] = parsedProjectData.customImageNames[label];
                      }
                      if (
                        parsedProjectData.imageScales &&
                        parsedProjectData.imageScales[label] !== undefined
                      )
                        window.imageScaleByLabel[label] = parsedProjectData.imageScales[label];
                      // Force recalculation of centered positions instead of using saved positions
                      // This ensures images are centered properly regardless of saved project data
                      window.imagePositionByLabel[label] = { x: 0, y: 0 }; // Will be recalculated by calculateFitScale
                      if (
                        parsedProjectData.imageRotations &&
                        parsedProjectData.imageRotations[label] !== undefined
                      )
                        window.imageRotationByLabel[label] =
                          parsedProjectData.imageRotations[label];
                      if (parsedProjectData.nextLabels && parsedProjectData.nextLabels[label])
                        window.labelsByImage[label] = parsedProjectData.nextLabels[label];

                      // Restore custom label positions, calculated offsets, rotation stamps, and text elements
                      if (!window.customLabelPositions) window.customLabelPositions = {};
                      if (!window.calculatedLabelOffsets) window.calculatedLabelOffsets = {};
                      if (!window.customLabelOffsetsRotationByImageAndStroke)
                        window.customLabelOffsetsRotationByImageAndStroke = {};
                      if (!window.paintApp) window.paintApp = { state: {} };
                      if (!window.paintApp.state) window.paintApp.state = {};
                      if (!window.paintApp.state.textElementsByImage)
                        window.paintApp.state.textElementsByImage = {};

                      window.customLabelPositions[label] =
                        parsedProjectData.customLabelPositions &&
                        parsedProjectData.customLabelPositions[label]
                          ? JSON.parse(
                              JSON.stringify(parsedProjectData.customLabelPositions[label])
                            )
                          : {};

                      window.calculatedLabelOffsets[label] =
                        parsedProjectData.calculatedLabelOffsets &&
                        parsedProjectData.calculatedLabelOffsets[label]
                          ? JSON.parse(
                              JSON.stringify(parsedProjectData.calculatedLabelOffsets[label])
                            )
                          : {};

                      window.customLabelOffsetsRotationByImageAndStroke[label] =
                        parsedProjectData.customLabelRotationStamps &&
                        parsedProjectData.customLabelRotationStamps[label]
                          ? JSON.parse(
                              JSON.stringify(parsedProjectData.customLabelRotationStamps[label])
                            )
                          : {};

                      window.paintApp.state.textElementsByImage[label] =
                        parsedProjectData.textElementsByImage &&
                        parsedProjectData.textElementsByImage[label]
                          ? JSON.parse(JSON.stringify(parsedProjectData.textElementsByImage[label]))
                          : [];

                      // MIGRATION: Ensure all loaded text elements have useCanvasCoords set to true
                      // This fixes misalignment issues with text loaded from older projects
                      if (window.paintApp.state.textElementsByImage[label]) {
                        window.paintApp.state.textElementsByImage[label].forEach(textEl => {
                          if (textEl && textEl.useCanvasCoords === undefined) {
                            console.log(
                              `[Migration] Setting useCanvasCoords=true for text element ${textEl.id} in ${label}`
                            );
                            textEl.useCanvasCoords = true;
                          }
                        });
                      }

                      // Ensure rotation system is initialized for old projects
                      if (!window.imageRotationByLabel) {
                        window.imageRotationByLabel = {};
                        console.log(
                          '[Legacy Migration] Initialized window.imageRotationByLabel for old project'
                        );
                      }
                      if (typeof window.imageRotationByLabel[label] === 'undefined') {
                        window.imageRotationByLabel[label] = 0;
                        console.log(
                          `[Legacy Migration] Initialized rotation for ${label} to 0° for old project`
                        );
                      }

                      // Legacy offset handling: For projects without rotation stamps, we can't know
                      // what rotation state the offsets were calculated at. Rather than guessing,
                      // we clear offsets when the image is currently rotated and let them recalculate.
                      // This is safer than potentially double-rotating offsets.
                      const curTheta =
                        window.imageRotationByLabel && window.imageRotationByLabel[label]
                          ? window.imageRotationByLabel[label]
                          : 0;
                      const isRotated = Math.abs(curTheta) > 0.01; // Small threshold to account for floating point

                      // Ensure rotation stamp object exists
                      if (!window.customLabelOffsetsRotationByImageAndStroke[label]) {
                        window.customLabelOffsetsRotationByImageAndStroke[label] = {};
                      }

                      // Helper function to validate an offset would produce reasonable positions
                      // Returns true if the offset is reasonable, false if it should be cleared
                      const validateOffset = (offset, label, stroke) => {
                        if (!offset) return false;
                        const pixelOffset = window.normalizeToPixels
                          ? window.normalizeToPixels(offset, label)
                          : offset;
                        if (
                          !pixelOffset ||
                          typeof pixelOffset.x !== 'number' ||
                          typeof pixelOffset.y !== 'number'
                        ) {
                          return false;
                        }

                        // Check if offset magnitude is reasonable (should be within ~2x image dimensions)
                        const dims =
                          window.originalImageDimensions && window.originalImageDimensions[label];
                        if (dims && dims.width && dims.height) {
                          const maxReasonableOffset = Math.max(dims.width, dims.height) * 2;
                          const offsetMagnitude = Math.sqrt(
                            pixelOffset.x * pixelOffset.x + pixelOffset.y * pixelOffset.y
                          );
                          if (offsetMagnitude > maxReasonableOffset) {
                            console.log(
                              `[LEGACY-OFFSET] Clearing unreasonable offset for ${label}.${stroke}: magnitude ${offsetMagnitude.toFixed(1)} > max ${maxReasonableOffset.toFixed(1)}`
                            );
                            return false;
                          }
                        }

                        return true;
                      };

                      // For rotated images, clear legacy offsets without stamps and let them recalculate
                      // This is safer than guessing their original rotation state
                      if (isRotated) {
                        // Clear custom label positions that don't have rotation stamps
                        if (
                          window.customLabelPositions[label] &&
                          typeof window.customLabelPositions[label] === 'object'
                        ) {
                          Object.keys(window.customLabelPositions[label]).forEach(stroke => {
                            if (
                              window.customLabelOffsetsRotationByImageAndStroke[label][stroke] ===
                              undefined
                            ) {
                              // Legacy offset without rotation stamp on rotated image - clear it for safety
                              const offset = window.customLabelPositions[label][stroke];
                              if (!validateOffset(offset, label, stroke)) {
                                console.log(
                                  `[LEGACY-OFFSET] Clearing custom offset for ${label}.${stroke} (rotated image without stamp)`
                                );
                                delete window.customLabelPositions[label][stroke];
                              } else {
                                // Offset seems reasonable, stamp it with current rotation
                                console.log(
                                  `[LEGACY-OFFSET] Stamping custom offset for ${label}.${stroke} with current rotation ${((curTheta * 180) / Math.PI).toFixed(1)}°`
                                );
                                window.customLabelOffsetsRotationByImageAndStroke[label][stroke] =
                                  curTheta;
                              }
                            }
                          });
                        }

                        // Clear calculated label offsets that don't have rotation stamps
                        if (
                          window.calculatedLabelOffsets[label] &&
                          typeof window.calculatedLabelOffsets[label] === 'object'
                        ) {
                          Object.keys(window.calculatedLabelOffsets[label]).forEach(stroke => {
                            if (
                              !window.customLabelOffsetsRotationByImageAndStroke[label] ||
                              window.customLabelOffsetsRotationByImageAndStroke[label][stroke] ===
                                undefined
                            ) {
                              // Legacy offset without rotation stamp on rotated image - clear it for safety
                              const offset = window.calculatedLabelOffsets[label][stroke];
                              if (!validateOffset(offset, label, stroke)) {
                                console.log(
                                  `[LEGACY-OFFSET] Clearing calculated offset for ${label}.${stroke} (rotated image without stamp)`
                                );
                                delete window.calculatedLabelOffsets[label][stroke];
                              } else {
                                // Offset seems reasonable, stamp it with current rotation
                                console.log(
                                  `[LEGACY-OFFSET] Stamping calculated offset for ${label}.${stroke} with current rotation ${((curTheta * 180) / Math.PI).toFixed(1)}°`
                                );
                                if (!window.customLabelOffsetsRotationByImageAndStroke[label]) {
                                  window.customLabelOffsetsRotationByImageAndStroke[label] = {};
                                }
                                window.customLabelOffsetsRotationByImageAndStroke[label][stroke] =
                                  curTheta;
                              }
                            }
                          });
                        }
                      } else {
                        // Image is at 0° rotation - stamp all legacy offsets with 0° so they're tracked
                        if (
                          window.customLabelPositions[label] &&
                          typeof window.customLabelPositions[label] === 'object'
                        ) {
                          Object.keys(window.customLabelPositions[label]).forEach(stroke => {
                            if (
                              window.customLabelOffsetsRotationByImageAndStroke[label][stroke] ===
                              undefined
                            ) {
                              window.customLabelOffsetsRotationByImageAndStroke[label][stroke] = 0;
                            }
                          });
                        }
                        if (
                          window.calculatedLabelOffsets[label] &&
                          typeof window.calculatedLabelOffsets[label] === 'object'
                        ) {
                          Object.keys(window.calculatedLabelOffsets[label]).forEach(stroke => {
                            if (
                              !window.customLabelOffsetsRotationByImageAndStroke[label] ||
                              window.customLabelOffsetsRotationByImageAndStroke[label][stroke] ===
                                undefined
                            ) {
                              if (!window.customLabelOffsetsRotationByImageAndStroke[label]) {
                                window.customLabelOffsetsRotationByImageAndStroke[label] = {};
                              }
                              window.customLabelOffsetsRotationByImageAndStroke[label][stroke] = 0;
                            }
                          });
                        }
                      }
                    })
                    .catch(err => console.error(`Error processing data for label ${label}:`, err)); // Catch per-image errors
                  imagePromises.push(promise);
                } else {
                  // No image file found, but still load stroke data if it exists
                  console.log(
                    `[DEBUG LOAD]     No image file found for ${label}, loading stroke data only`
                  );

                  // Check if this label has stroke data
                  const hasStrokeData =
                    (parsedProjectData.strokes && parsedProjectData.strokes[label]) ||
                    (parsedProjectData.strokeSequence && parsedProjectData.strokeSequence[label]);

                  if (hasStrokeData) {
                    // Initialize structures first
                    if (typeof window.initializeNewImageStructures === 'function') {
                      window.initializeNewImageStructures(label);
                    }

                    // Load stroke data
                    if (parsedProjectData.strokes && parsedProjectData.strokes[label]) {
                      window.vectorStrokesByImage[label] = JSON.parse(
                        JSON.stringify(parsedProjectData.strokes[label])
                      );
                      console.log(
                        `[DEBUG LOAD]     ✓ Loaded ${Object.keys(window.vectorStrokesByImage[label]).length} vector strokes for ${label} (no image)`
                      );
                    }

                    if (
                      parsedProjectData.strokeSequence &&
                      parsedProjectData.strokeSequence[label]
                    ) {
                      window.lineStrokesByImage[label] = Array.isArray(
                        parsedProjectData.strokeSequence[label]
                      )
                        ? parsedProjectData.strokeSequence[label].slice()
                        : [];
                      console.log(
                        `[DEBUG LOAD]     ✓ Loaded ${window.lineStrokesByImage[label].length} line strokes for ${label} (no image)`
                      );
                    }

                    // Load other per-label data
                    if (
                      parsedProjectData.strokeVisibility &&
                      parsedProjectData.strokeVisibility[label]
                    ) {
                      window.strokeVisibilityByImage[label] =
                        parsedProjectData.strokeVisibility[label];
                    }
                    if (
                      parsedProjectData.strokeLabelVisibility &&
                      parsedProjectData.strokeLabelVisibility[label]
                    ) {
                      window.strokeLabelVisibility[label] =
                        parsedProjectData.strokeLabelVisibility[label];
                    }
                    if (
                      parsedProjectData.strokeMeasurements &&
                      parsedProjectData.strokeMeasurements[label]
                    ) {
                      window.strokeMeasurements[label] = JSON.parse(
                        JSON.stringify(parsedProjectData.strokeMeasurements[label])
                      );
                      // Ensure underReview flag exists for backward compatibility
                      Object.keys(window.strokeMeasurements[label]).forEach(strokeLabel => {
                        if (
                          window.strokeMeasurements[label][strokeLabel] &&
                          window.strokeMeasurements[label][strokeLabel].underReview === undefined
                        ) {
                          window.strokeMeasurements[label][strokeLabel].underReview = false;
                        }
                      });
                    }
                    if (parsedProjectData.imageTags && parsedProjectData.imageTags[label]) {
                      window.imageTags[label] = JSON.parse(
                        JSON.stringify(parsedProjectData.imageTags[label])
                      );
                    }
                    if (parsedProjectData.nextLabels && parsedProjectData.nextLabels[label]) {
                      window.labelsByImage[label] = parsedProjectData.nextLabels[label];
                    }
                  }

                  // Set dimensions to zero if no image
                  if (!window.originalImageDimensions[label]) {
                    window.originalImageDimensions[label] = { width: 0, height: 0 };
                  }
                }
              } // End of for...of loop for labels

              console.log(
                `[DEBUG LOAD] Waiting for ${imagePromises.length} image promises to complete...`
              );

              return Promise.all(imagePromises)
                .then(() => {
                  // Executed after all images and their data are loaded and processed
                  // Update progress
                  console.log('[DEBUG LOAD] ✓ All imagePromises resolved successfully');
                  if (progressBar) progressBar.style.width = '80%';
                  const loadedImages = Object.keys(window.originalImages || {}).length;
                  console.log(
                    `[DEBUG LOAD]   All image files processed. Total loaded: ${loadedImages}`
                  );
                  console.log(
                    '[DEBUG LOAD]   Loaded image labels:',
                    Object.keys(window.originalImages || {})
                  );
                  console.log('[DEBUG LOAD] ===== loadProject: Images Loaded =====');

                  // Load AI exports if they exist
                  if (!window.aiExports) window.aiExports = {};
                  const aiExportPromises = [];

                  for (const label of labelsToProcess) {
                    const aiSvgFile = zip.file(`exports/${label}/ai-latest.svg`);
                    const aiJsonFile = zip.file(`exports/${label}/ai-latest.json`);

                    if (aiSvgFile && aiJsonFile) {
                      const promise = Promise.all([
                        aiSvgFile.async('text'),
                        aiJsonFile.async('text'),
                      ])
                        .then(([svg, jsonStr]) => {
                          const data = JSON.parse(jsonStr);
                          window.aiExports[label] = {
                            svg,
                            vectors: data.vectors,
                            summary: data.summary,
                            timestamp: data.timestamp,
                          };
                          console.log(`[Load Project] Loaded AI export for ${label}`);
                        })
                        .catch(err => {
                          console.error(
                            `[Load Project] Error loading AI export for ${label}:`,
                            err
                          );
                        });
                      aiExportPromises.push(promise);
                    }
                  }

                  return Promise.all(aiExportPromises);
                })
                .catch(err => {
                  console.error('[DEBUG LOAD] ERROR in Promise.all chain:', err);
                  throw err; // Re-throw to continue to outer catch
                })
                .then(() => {
                  // Main UI update timeout
                  console.log('[DEBUG LOAD] About to enter Main UI update timeout...');
                  setTimeout(
                    activeProjectData => {
                      console.log(
                        '[DEBUG LOAD] Inside Main UI Update Timeout. ImageLabels:',
                        activeProjectData.imageLabels
                      );
                      document.getElementById('loadingIndicator')?.remove();

                      // CRITICAL: Preserve all stroke data before switchToImage (which might clear it)
                      const preservedStrokeData = {};
                      const preservedLineStrokes = {};
                      const preservedVisibility = {};
                      const preservedLabelVisibility = {};
                      const preservedMeasurements = {};

                      activeProjectData.imageLabels.forEach(label => {
                        if (window.vectorStrokesByImage && window.vectorStrokesByImage[label]) {
                          preservedStrokeData[label] = JSON.parse(
                            JSON.stringify(window.vectorStrokesByImage[label])
                          );
                        }
                        if (window.lineStrokesByImage && window.lineStrokesByImage[label]) {
                          preservedLineStrokes[label] = [...window.lineStrokesByImage[label]];
                        }
                        if (
                          window.strokeVisibilityByImage &&
                          window.strokeVisibilityByImage[label]
                        ) {
                          preservedVisibility[label] = JSON.parse(
                            JSON.stringify(window.strokeVisibilityByImage[label])
                          );
                        }
                        if (window.strokeLabelVisibility && window.strokeLabelVisibility[label]) {
                          preservedLabelVisibility[label] = JSON.parse(
                            JSON.stringify(window.strokeLabelVisibility[label])
                          );
                        }
                        if (window.strokeMeasurements && window.strokeMeasurements[label]) {
                          preservedMeasurements[label] = JSON.parse(
                            JSON.stringify(window.strokeMeasurements[label])
                          );
                        }
                      });

                      console.log(
                        `[DEBUG LOAD] Preserved stroke data for ${Object.keys(preservedStrokeData).length} images before switchToImage`
                      );

                      // Debug: Log what we preserved
                      Object.keys(preservedStrokeData).forEach(label => {
                        console.log(
                          `[DEBUG LOAD] Preserved ${Object.keys(preservedStrokeData[label]).length} strokes for ${label}:`,
                          Object.keys(preservedStrokeData[label])
                        );
                      });

                      // Determine target label: prioritize first image in order, then saved currentImageLabel, then first available
                      const availableImageKeys = Object.keys(window.originalImages);
                      const orderedLabels =
                        window.orderedImageLabels || activeProjectData.imageLabels || [];

                      // CRITICAL: Always use the first image in the processing order (not saved currentImageLabel)
                      // This ensures the first image appears first when loading a project
                      const firstImageInOrder = orderedLabels.find(label =>
                        availableImageKeys.includes(label)
                      );

                      let targetLabel;
                      if (firstImageInOrder) {
                        // Use first image in order (this is what user expects)
                        targetLabel = firstImageInOrder;
                        console.log(`[DEBUG LOAD] Using first image in order: ${targetLabel}`);
                      } else if (
                        activeProjectData.currentImageLabel &&
                        availableImageKeys.includes(activeProjectData.currentImageLabel)
                      ) {
                        // Fallback to saved currentImageLabel if first image not found
                        targetLabel = activeProjectData.currentImageLabel;
                        console.log(`[DEBUG LOAD] Using saved currentImageLabel: ${targetLabel}`);
                      } else {
                        // Final fallback to first available image
                        targetLabel =
                          availableImageKeys.length > 0 ? availableImageKeys[0] : 'front';
                        console.log(`[DEBUG LOAD] Using first available image: ${targetLabel}`);
                      }
                      console.log(
                        `[DEBUG LOAD] Initial targetLabel: ${targetLabel} (orderedLabels: ${orderedLabels.slice(0, 3).join(', ')}...)`
                      );

                      if (typeof window.switchToImage === 'function') {
                        window.currentImageLabel = targetLabel;
                        window.switchToImage(targetLabel);
                      } else {
                        console.error('[Load Project] switchToImage function not found!');
                        window.isLoadingProject = false;
                        showStatusMessage('Error: switchToImage function missing.', 'error');
                        return;
                      }

                      // CRITICAL: Restore stroke data after switchToImage (in case it was cleared)
                      setTimeout(() => {
                        let restoredCount = 0;
                        activeProjectData.imageLabels.forEach(label => {
                          if (preservedStrokeData[label]) {
                            window.vectorStrokesByImage[label] = JSON.parse(
                              JSON.stringify(preservedStrokeData[label])
                            );
                            restoredCount++;
                          }
                          if (preservedLineStrokes[label]) {
                            window.lineStrokesByImage[label] = [...preservedLineStrokes[label]];
                          }
                          if (preservedVisibility[label]) {
                            window.strokeVisibilityByImage[label] = JSON.parse(
                              JSON.stringify(preservedVisibility[label])
                            );
                          }
                          if (preservedLabelVisibility[label]) {
                            window.strokeLabelVisibility[label] = JSON.parse(
                              JSON.stringify(preservedLabelVisibility[label])
                            );
                          }
                          if (preservedMeasurements[label]) {
                            window.strokeMeasurements[label] = JSON.parse(
                              JSON.stringify(preservedMeasurements[label])
                            );
                          }
                        });
                        console.log(
                          `[DEBUG LOAD] ✓ Restored stroke data for ${restoredCount} images after switchToImage`
                        );

                        // Debug: Verify what was restored
                        Object.keys(preservedStrokeData).forEach(label => {
                          const currentStrokes = window.vectorStrokesByImage[label];
                          if (currentStrokes) {
                            console.log(
                              `[DEBUG LOAD] After restoration: ${label} has ${Object.keys(currentStrokes).length} strokes`
                            );
                          } else {
                            console.error(
                              `[DEBUG LOAD] ERROR: ${label} has NO strokes after restoration!`
                            );
                          }
                        });

                        // Sync restored data to StrokeMetadataManager
                        if (window.app && window.app.metadataManager) {
                          console.log(
                            '[DEBUG LOAD] Syncing restored data to StrokeMetadataManager'
                          );
                          Object.keys(preservedStrokeData).forEach(label => {
                            if (window.vectorStrokesByImage[label]) {
                              window.app.metadataManager.vectorStrokesByImage[label] =
                                window.vectorStrokesByImage[label];
                              console.log(
                                `[DEBUG LOAD] Synced ${Object.keys(window.vectorStrokesByImage[label]).length} strokes to metadataManager for ${label}`
                              );
                            }
                            if (window.strokeVisibility && window.strokeVisibility[label]) {
                              window.app.metadataManager.strokeVisibilityByImage[label] =
                                window.strokeVisibility[label];
                            }
                            if (
                              window.strokeLabelVisibility &&
                              window.strokeLabelVisibility[label]
                            ) {
                              window.app.metadataManager.strokeLabelVisibility[label] =
                                window.strokeLabelVisibility[label];
                            }
                            if (window.strokeMeasurements && window.strokeMeasurements[label]) {
                              window.app.metadataManager.strokeMeasurements[label] =
                                window.strokeMeasurements[label];
                            }
                          });
                        }

                        // Legacy projects loaded - data available in window.vectorStrokesByImage
                        // User can manually re-save to convert to modern Fabric.js format
                        console.log(
                          '[DEBUG LOAD] Legacy project loaded. Save again to convert to modern format.'
                        );

                        // Update UI to show loaded measurements
                        if (window.app && window.app.metadataManager) {
                          console.log(
                            '[DEBUG LOAD] Updating stroke visibility controls to show loaded data'
                          );
                          window.app.metadataManager.updateStrokeVisibilityControls();
                        }
                      }, 50);

                      try {
                        if (typeof window.updateSidebarStrokeCounts === 'function')
                          window.updateSidebarStrokeCounts();
                        if (typeof window.updateScaleUI === 'function') window.updateScaleUI();
                        if (typeof window.updateActiveImageInSidebar === 'function')
                          window.updateActiveImageInSidebar();
                        if (typeof window.updateStrokeVisibilityControls === 'function')
                          window.updateStrokeVisibilityControls();
                      } catch (uiError) {
                        console.error('[Load Project] UI component update error:', uiError);
                      }

                      const currentActiveLabel = window.currentImageLabel;
                      if (
                        activeProjectData.imageScales &&
                        activeProjectData.imageScales[currentActiveLabel] !== undefined
                      ) {
                        window.imageScaleByLabel[currentActiveLabel] =
                          activeProjectData.imageScales[currentActiveLabel];
                      } else window.imageScaleByLabel[currentActiveLabel] = 1.0;
                      // Force recalculation of centered positions instead of using saved positions
                      window.imagePositionByLabel[currentActiveLabel] = { x: 0, y: 0 }; // Will be recalculated by calculateFitScale
                      if (typeof window.updateScaleUI === 'function') window.updateScaleUI();

                      // Note: resizeCanvas will be called after all images are loaded

                      // PERFORMANCE FIX: Start debounced sync instead of interval
                      queueMicrotask(() => scheduleLegacySync());

                      // Final delayed actions timeout
                      setTimeout(
                        dataForFinalSteps => {
                          //                                                 console.log('[Load Project] Final Delayed Actions Timeout. ImageLabels:', dataForFinalSteps.imageLabels);

                          // PERFORMANCE FIX: Non-blocking finalization with deferred tag refresh
                          const labelsForTagRefresh = Array.isArray(dataForFinalSteps.imageLabels)
                            ? dataForFinalSteps.imageLabels.slice()
                            : [];
                          finalizeLoadProcess(dataForFinalSteps);

                          // Non-blocking tag refresh - runs after load completes
                          (function tryTagRefresh(attempts = 0) {
                            if (
                              typeof window.updateTagsDisplay === 'function' &&
                              typeof window.getTagBasedFilename === 'function'
                            ) {
                              //                                                         console.log('[Load Project] Tag manager functions available, refreshing tags...');
                              labelsForTagRefresh.forEach(label => {
                                if (window.imageTags[label]) {
                                  try {
                                    window.updateTagsDisplay(label);
                                  } catch (e) {
                                    console.warn(
                                      `[Load Project] Error refreshing tags for ${label}:`,
                                      e
                                    );
                                  }
                                }
                              });
                            } else if (attempts < 20) {
                              setTimeout(() => tryTagRefresh(attempts + 1), 100);
                            } else {
                              console.warn(
                                '[Load Project] Tag manager functions unavailable after retries; skipping tag refresh.'
                              );
                              // Let tag-manager run a catch-up when it initializes
                              window.__pendingTagRefresh = labelsForTagRefresh;
                            }
                          })();
                        },
                        100,
                        activeProjectData
                      ); // Pass activeProjectData (which is parsedProjectData)
                    },
                    200,
                    parsedProjectData
                  ); // Pass parsedProjectData to the main UI timeout
                }); // End of Promise.all().then()
            }); // End of projectJsonFile.async().then()
          }) // End of JSZip.loadAsync().then()
          .catch(err => {
            // Catch for JSZip.loadAsync() and its chained promises
            window.isLoadingProject = false;
            document.getElementById('loadingIndicator')?.remove();
            console.error('Error loading project from ZIP (outer catch):', err);
            showStatusMessage(`Error loading project: ${err.message}`, 'error');
          });
      }; // End of reader.onload
      reader.onerror = function (e) {
        // *** CLEAR LOADING FLAG (Reader Error) ***
        window.isLoadingProject = false;
        //                 console.log('[Load Project] Set isLoadingProject = false (Reader Error)');

        // Remove loading indicator
        if (loadingIndicator.parentNode) {
          loadingIndicator.parentNode.removeChild(loadingIndicator);
        }

        console.error('Error reading file:', e);
        showStatusMessage('Error reading file', 'error');
      };
      reader.readAsArrayBuffer(file);
    };

    // Trigger file selection
    input.click();
  }

  // Function to show status message
  function showStatusMessage(message, type = 'info') {
    // Get or create status element
    let statusElement = document.getElementById('statusMessage');
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = 'statusMessage';
      statusElement.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                padding: 12px 24px;
                border-radius: 4px;
                color: white;
                font-weight: bold;
                z-index: 9999;
                opacity: 0;
                transition: opacity 0.3s ease;
                max-width: 80%;
                text-align: center;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            `;
      document.body.appendChild(statusElement);
    }

    // Set message and type
    statusElement.textContent = message;
    statusElement.style.opacity = '1';

    // Add spinner for loading type
    if (type === 'loading') {
      if (!statusElement.querySelector('.spinner')) {
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        spinner.style.cssText = `
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-right: 8px;
          vertical-align: middle;
        `;
        // Add spin animation if not already in document
        if (!document.getElementById('spinner-style')) {
          const style = document.createElement('style');
          style.id = 'spinner-style';
          style.textContent = `
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `;
          document.head.appendChild(style);
        }
        statusElement.insertBefore(spinner, statusElement.firstChild);
      }
    } else {
      // Remove spinner if present
      const spinner = statusElement.querySelector('.spinner');
      if (spinner) spinner.remove();
    }

    // Set color based on message type
    switch (type) {
      case 'success':
        statusElement.style.backgroundColor = '#4CAF50';
        break;
      case 'error':
        statusElement.style.backgroundColor = '#F44336';
        break;
      case 'loading':
        statusElement.style.backgroundColor = '#FF9800';
        break;
      case 'info':
      default:
        statusElement.style.backgroundColor = '#2196F3';
        break;
    }

    // Hide after a timeout (don't auto-hide loading messages)
    clearTimeout(statusElement.timer);
    if (type !== 'loading') {
      statusElement.timer = setTimeout(() => {
        statusElement.style.opacity = '0';
      }, 3000);
    }
  }

  // Make these functions available globally if needed
  window.projectManager = {
    saveProject,
    loadProject,
    showStatusMessage,
  };

  function finalizeLoadProcess(dataForFinalSteps) {
    // ADDED FUNCTION
    //         console.log('[Load Project] Finalizing load process...');

    // *** ADDED: Loop to update sidebar label text and scale text ***
    if (dataForFinalSteps.imageLabels && typeof window.imageScaleByLabel !== 'undefined') {
      //             console.log('[Load Project] Updating sidebar label text and scale text...');
      dataForFinalSteps.imageLabels.forEach(label => {
        // Update Label Text (prefer custom names)
        const labelElement = document.querySelector(
          `.image-container[data-label="${label}"] .image-label`
        );
        if (labelElement) {
          const displayName =
            typeof window.getUserFacingImageName === 'function'
              ? window.getUserFacingImageName(label)
              : typeof window.getTagBasedFilename === 'function'
                ? window.getTagBasedFilename(label, label.split('_')[0])
                : label;
          const newText = displayName
            ? displayName.charAt(0).toUpperCase() + displayName.slice(1)
            : label;
          labelElement.textContent = newText;
        }
        // Silently skip if label element doesn't exist (e.g., default labels without images, or during reordering)

        // Update Scale Text
        const scaleElement = document.getElementById(`scale-${label}`);
        if (scaleElement) {
          const scaleValue =
            window.imageScaleByLabel[label] !== undefined ? window.imageScaleByLabel[label] : 1.0;
          const scaleText = `Scale: ${Math.round(scaleValue * 100)}%`;
          //                     console.log(`  Updating scale text for ${label} to: "${scaleText}"`);
          scaleElement.textContent = scaleText;
        }
        // Silently skip if scale element doesn't exist (e.g., default labels without images, or during reordering)
      });
    } else {
      console.warn(
        '[Load Project] Could not update sidebar label/scale text. Necessary functions or data missing.'
      );
    }
    // *** END ADDED BLOCK ***

    // Force recalculation of centered positions now that all images are loaded
    console.log('[Load Project] Checking resizeCanvas availability:', typeof window.resizeCanvas);
    if (typeof window.resizeCanvas === 'function') {
      console.log('[Load Project] Calling resizeCanvas to recalculate centered positions');
      window.resizeCanvas();
    } else {
      console.log('[Load Project] resizeCanvas not available, trying redrawCanvasWithVisibility');
      if (typeof window.redrawCanvasWithVisibility === 'function') {
        //             console.log('[Load Project] Performing final redraw before completing load.');
        window.redrawCanvasWithVisibility();
      } else {
        console.log('[Load Project] Neither resizeCanvas nor redrawCanvasWithVisibility available');
      }
    }

    // Additional fallback: force centering by calling calculateFitScale directly
    if (typeof window.calculateFitScale === 'function' && window.currentImageLabel) {
      console.log('[Load Project] Fallback: calling calculateFitScale directly for current image');
      const fitResult = window.calculateFitScale('fit-width'); // or appropriate fit mode
      if (fitResult && fitResult.position && window.imagePositionByLabel) {
        console.log(
          '[Load Project] Updating position for',
          window.currentImageLabel,
          'to',
          fitResult.position
        );
        window.imagePositionByLabel[window.currentImageLabel] = fitResult.position;
        // Trigger a redraw
        if (typeof window.redrawCanvasWithVisibility === 'function') {
          window.redrawCanvasWithVisibility();
        }
      }
    }

    //         console.log('[Load Project] FINAL VALIDATION BLOCK');
    try {
      const labelsToCheck = dataForFinalSteps.imageLabels || [];
      labelsToCheck.forEach(label => {
        const currentMeasurements = window.strokeMeasurements[label] || {};
        const loadedMeasurements = dataForFinalSteps.strokeMeasurements[label] || {};
        if (JSON.stringify(currentMeasurements) !== JSON.stringify(loadedMeasurements)) {
          console.warn(
            `   MEASUREMENT MISMATCH for ${label}! App: ${JSON.stringify(currentMeasurements)}, Loaded: ${JSON.stringify(loadedMeasurements)}`
          );
        } else {
          //                     console.log(`   ✓ Measurements verified for ${label}`);
        }
      });
    } catch (validationError) {
      console.error('[Load Project] Final validation error:', validationError);
    }

    // Update progress to complete
    const progressBar = document.getElementById('loadProgressBar');
    if (progressBar) progressBar.style.width = '100%';

    // Remove loading indicator
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator && loadingIndicator.parentNode) {
      loadingIndicator.parentNode.removeChild(loadingIndicator);
    }

    window.isLoadingProject = false;
    showStatusMessage('Project loaded successfully.', 'success');

    // Auto-fix text rotation for loaded text elements
    if (typeof window.autoFixTextRotation === 'function') {
      setTimeout(window.autoFixTextRotation, 100);
    }

    //         console.log('[Load Project] Complete.');
  }

  // Modern Fabric.js save/load system

  /**
   * Save project using modern Fabric.js format
   * Saves Fabric canvas JSON along with images and metadata in a ZIP file
   */
  window.saveFabricProject = async function saveFabricProject() {
    console.log('[Save Fabric] Starting modern Fabric.js project save...');

    if (!window.app || !window.app.canvasManager || !window.app.canvasManager.fabricCanvas) {
      showStatusMessage('Canvas not available', 'error');
      return;
    }

    const fabricCanvas = window.app.canvasManager.fabricCanvas;
    const projectManager = window.app.projectManager;

    // Get all views/images
    const viewIds = Object.keys(projectManager.views);
    console.log(`[Save Fabric] Saving ${viewIds.length} views:`, viewIds);

    const projectData = {
      version: '2.0-fabric',
      projectName: window.projectName || 'Unnamed Project',
      createdAt: new Date().toISOString(),
      views: {},
    };

    // Save current view's canvas state
    const currentViewId = projectManager.currentViewId;
    projectData.currentViewId = currentViewId;

    // For each view, save canvas JSON and metadata
    for (const viewId of viewIds) {
      const view = projectManager.views[viewId];

      projectData.views[viewId] = {
        canvasJSON: null,
        imageDataURL: null,
        metadata: {},
      };

      // If this is the current view, save its live canvas state
      if (viewId === currentViewId) {
        projectData.views[viewId].canvasJSON = fabricCanvas.toJSON([
          'strokeMetadata',
          'isTag',
          'isConnectorLine',
          'tagLabel',
          'connectedTo',
        ]);
        console.log(`[Save Fabric] Saved canvas JSON for ${viewId}`);
      } else if (view.canvasData) {
        // Use stored canvas data for other views
        projectData.views[viewId].canvasJSON = view.canvasData;
      }

      // Save background image as data URL if exists
      if (view.image) {
        try {
          const response = await fetch(view.image);
          const blob = await response.blob();
          const reader = new FileReader();
          const imageDataURL = await new Promise(resolve => {
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          projectData.views[viewId].imageDataURL = imageDataURL;
          console.log(`[Save Fabric] Saved image for ${viewId}`);
        } catch (err) {
          console.warn(`[Save Fabric] Could not save image for ${viewId}:`, err);
        }
      }

      // Save metadata from metadataManager
      if (window.app.metadataManager) {
        const meta = window.app.metadataManager;
        projectData.views[viewId].metadata = {
          strokeVisibility: meta.strokeVisibilityByImage[viewId] || {},
          strokeLabelVisibility: meta.strokeLabelVisibility[viewId] || {},
          strokeMeasurements: meta.strokeMeasurements[viewId] || {},
        };
      }
    }

    // Convert to JSON and download
    const jsonStr = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectData.projectName}_fabric.json`;
    a.click();
    URL.revokeObjectURL(url);

    showStatusMessage('Project saved successfully', 'success');
    console.log('[Save Fabric] Project saved successfully');
  };

  // Remove legacy migration hook
  if (typeof window.StrokeMetadataManager !== 'undefined') {
    console.log('[Fabric Save/Load] Modern save system ready');
  }
});
