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
            
            // Now call the actual save function
            saveProject();
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
        const ordered = (imageOrder && imageOrder.length) ? imageOrder : imageLabels;
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
                    children: []
                }))
            }
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
        const needBuild = !migrated.folderStructure || !migrated.folderStructure.root || children.length === 0;
        
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
        
        // 5) Bump version to prevent re-migration
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
        return function(...args) {
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

            // Show status message
            showStatusMessage('Preparing project for download...', 'info');
            
            // Create a new JSZip instance
            const zip = new JSZip();
            
            // Get project name with fallback
            const projectName = document.getElementById('projectName').value || 'OpenPaint Project';
            
            // *** MODIFIED: Get actual current image labels ***
            let actualImageLabels = Object.keys(window.imageTags || {});
            if (actualImageLabels.length === 0) {
                // Fallback if imageTags is empty for some reason
                actualImageLabels = [...(window.IMAGE_LABELS || ['front', 'side', 'back', 'cushion'])];
                console.warn("[Save Project] No keys found in window.imageTags, falling back to default labels.");
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
                    "root": {
                        id: "root",
                        name: "Root",
                        type: "folder",
                        parentId: null,
                        children: []
                    }
                }
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
                    projectData.strokes[label] = JSON.parse(JSON.stringify(window.vectorStrokesByImage[label]));
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
                        Object.entries(window.strokeMeasurements[label]).forEach(([strokeLabel, measurement]) => {
//                             console.log(`[Save Project] - Measurement for ${strokeLabel}:`, measurement);
                        });
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
                        console.error(`[Save Project] ERROR: Scale was not saved correctly for ${label}. Expected ${currentScale}, got ${projectData.imageScales[label]}. Fixing...`);
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
            
            // Add custom label positions and rotation stamps after the main loop
            if (!projectData.customLabelPositions) projectData.customLabelPositions = {};
            if (!projectData.customLabelRotationStamps) projectData.customLabelRotationStamps = {};
            
            for (const label of actualImageLabels) {
                projectData.customLabelPositions[label] =
                    (window.customLabelPositions && window.customLabelPositions[label])
                        ? JSON.parse(JSON.stringify(window.customLabelPositions[label]))
                        : {};

                projectData.customLabelRotationStamps[label] =
                    (window.customLabelOffsetsRotationByImageAndStroke && window.customLabelOffsetsRotationByImageAndStroke[label])
                        ? JSON.parse(JSON.stringify(window.customLabelOffsetsRotationByImageAndStroke[label]))
                        : {};
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
            zip.file("project.json", JSON.stringify(projectData, null, 2));
            
            // Validate that scales were correctly added to the project data
//             console.log('[Save Project] VALIDATION - Checking scales in project data:');
            if (projectData.imageScales) {
                Object.keys(projectData.imageScales).forEach(label => {
//                     console.log(`- Project data scale for ${label}: ${projectData.imageScales[label]}`);
                    
                    // Compare with the current scale in the app
                    if (window.imageScaleByLabel && window.imageScaleByLabel[label] !== undefined) {
                        const currentScale = window.imageScaleByLabel[label];
                        if (currentScale !== projectData.imageScales[label]) {
                            console.error(`[Save Project] ERROR: Scale mismatch for ${label}! App: ${currentScale}, Project data: ${projectData.imageScales[label]}`);
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
            for (const label of actualImageLabels) {
                const imageUrl = window.originalImages ? window.originalImages[label] : null;
                if (imageUrl) {
//                     console.log(`Adding image for ${label}...`);
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
//                             console.log(`   Added ${label}.png to zip.`);
                        })
                        .catch(error => {
                            console.error(`Error adding image ${label} to zip:`, error);
                            // Optionally show a user-facing error here
                        });
                        imagePromises.push(promise);
                } else {
//                     console.log(`No original image found for ${label}, skipping image file.`);
                }
            }
            
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
                    // Generate the zip file
                    return zip.generateAsync({
                        type: 'blob',
                        compression: 'DEFLATE',
                        compressionOptions: { level: 6 }
                    });
                })
                .then(content => {
                    // Remove the save indicator
                    if (saveIndicator.parentNode) {
                        saveIndicator.parentNode.removeChild(saveIndicator);
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
                    showStatusMessage('Project saved successfully!', 'success');
                })
                .catch(err => {
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
    
    // Function to load project from a ZIP file
    function loadProject() {
        // Create a file input element
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        
        // Handle file selection
        input.onchange = function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            // *** SET LOADING FLAG ***
            window.isLoadingProject = true; 
//             console.log('[Load Project] Set isLoadingProject = true');
            
            showStatusMessage('Loading project...', 'info');
            
            // Create loading indicator
            const loadingIndicator = document.createElement('div');
            loadingIndicator.id = 'loadingIndicator';
            loadingIndicator.style.cssText = `
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
            loadingIndicator.innerHTML = `
                <div style="margin-bottom: 10px;">Loading project...</div>
                <div class="spinner" style="border: 5px solid #f3f3f3; border-top: 5px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 2s linear infinite; margin: 0 auto;"></div>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            `;
            document.body.appendChild(loadingIndicator);
            
            // Read the selected file
            const reader = new FileReader();
            reader.onload = function(e) {
                const data = e.target.result;
                
                JSZip.loadAsync(data)
                    .then(zip => {
//                         console.log("ZIP file loaded. Contents:", Object.keys(zip.files));
                        const projectJsonFile = zip.file("project.json");
                        if (!projectJsonFile) {
                            throw new Error("Missing project.json"); // This will be caught by the final .catch()
                        }
                        
                        return projectJsonFile.async("string")
                            .then(jsonContent => {
//                                 console.log("Project data loaded:", jsonContent.substring(0, 100) + "...");
                                const rawProjectData = JSON.parse(jsonContent);
                                
                                // PERFORMANCE FIX: Apply migration to prevent repeated processing
                                const parsedProjectData = migrateProject(rawProjectData);
                                
                                document.getElementById('projectName').value = parsedProjectData.name || 'OpenPaint Project';
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
                                    window.folderStructure = JSON.parse(JSON.stringify(parsedProjectData.folderStructure));
                                } else {
                                    window.folderStructure = { "root": { id: "root", name: "Root", type: "folder", parentId: null, children: [] } };
                                }

                                // Determine the order for processing images
                                const imageOrder = parsedProjectData.imageOrder || [];
                                let labelsToProcess = [];
                                
                                if (imageOrder.length > 0) {
                                    // Filter imageOrder to only include labels that actually exist in the project
                                    labelsToProcess = imageOrder.filter(label => parsedProjectData.imageLabels.includes(label));
                                    
                                    // Add any images present in imageLabels but missing from imageOrder (for backward compatibility)
                                    parsedProjectData.imageLabels.forEach(label => {
                                        if (!labelsToProcess.includes(label)) {
                                            labelsToProcess.push(label);
                                        }
                                    });
                                } else {
                                    // Fallback for older projects without imageOrder
                                    labelsToProcess = [...parsedProjectData.imageLabels];
                                }
                                
//                                 console.log('[Project Load] Processing images in order:', JSON.stringify(labelsToProcess));
                                
                                // Initialize paint.js's ordered list with the loaded order
                                window.orderedImageLabels = [...labelsToProcess];

                                const imagePromises = [];
                                for (const label of labelsToProcess) {
                                    const safeLabel = label.toLowerCase();
                                    const imageFiles = Object.keys(zip.files).filter(
                                        filename => filename.toLowerCase().startsWith(`${safeLabel}.`) && 
                                        !filename.endsWith('/') && filename !== 'project.json'
                                    );
                                    if (imageFiles.length > 0) {
                                        const imageFile = imageFiles[0];
                                        const promise = zip.file(imageFile).async("blob")
                                            .then(blob => {
                                                // PERFORMANCE FIX: Use object URL instead of data URL (faster, no base64 encoding)
                                                const objectUrl = URL.createObjectURL(blob);
                                                window.originalImages[label] = objectUrl;
                                                return new Promise((resolveDim) => {
                                                    const img = new Image();
                                                    img.onload = () => {
                                                        window.originalImageDimensions[label] = { width: img.width, height: img.height };
                                                        resolveDim();
                                                    };
                                                    img.onerror = () => {
                                                        window.originalImageDimensions[label] = { width: 0, height: 0 };
                                                        resolveDim();
                                                    };
                                                    img.src = objectUrl;
                                                });
                                            })
                                            .then(() => { // After image and dimensions are loaded for this label
                                                if (typeof window.addImageToSidebar === 'function') {
                                                    window.addImageToSidebar(window.originalImages[label], label);
                                                }
                                                // Load other per-label data from parsedProjectData
                                                if (parsedProjectData.strokes && parsedProjectData.strokes[label]) window.vectorStrokesByImage[label] = JSON.parse(JSON.stringify(parsedProjectData.strokes[label])); else window.vectorStrokesByImage[label] = {};
                                                if (parsedProjectData.strokeVisibility && parsedProjectData.strokeVisibility[label]) window.strokeVisibilityByImage[label] = parsedProjectData.strokeVisibility[label]; else window.strokeVisibilityByImage[label] = {};
                                                if (parsedProjectData.strokeLabelVisibility && parsedProjectData.strokeLabelVisibility[label]) window.strokeLabelVisibility[label] = parsedProjectData.strokeLabelVisibility[label]; else window.strokeLabelVisibility[label] = {};
                                                if (parsedProjectData.strokeMeasurements && parsedProjectData.strokeMeasurements[label]) window.strokeMeasurements[label] = JSON.parse(JSON.stringify(parsedProjectData.strokeMeasurements[label])); else window.strokeMeasurements[label] = {};
                                                if (parsedProjectData.imageTags && parsedProjectData.imageTags[label]) window.imageTags[label] = JSON.parse(JSON.stringify(parsedProjectData.imageTags[label])); 
                                                else { 
                                                    if (typeof window.initializeNewImageStructures === 'function') window.initializeNewImageStructures(label); 
                                                    else window.imageTags[label] = { furnitureType: 'sofa', viewType: label }; 
                                                }
                                                if (parsedProjectData.customImageNames && parsedProjectData.customImageNames[label]) {
                                                    window.customImageNames[label] = parsedProjectData.customImageNames[label];
                                                }
                                                if (parsedProjectData.imageScales && parsedProjectData.imageScales[label] !== undefined) window.imageScaleByLabel[label] = parsedProjectData.imageScales[label]; else window.imageScaleByLabel[label] = 1.0;
                                                // Force recalculation of centered positions instead of using saved positions
                                                // This ensures images are centered properly regardless of saved project data
                                                window.imagePositionByLabel[label] = { x: 0, y: 0 }; // Will be recalculated by calculateFitScale
                if (parsedProjectData.imageRotations && parsedProjectData.imageRotations[label] !== undefined) window.imageRotationByLabel[label] = parsedProjectData.imageRotations[label]; else window.imageRotationByLabel[label] = 0;
                                                if (parsedProjectData.strokeSequence && parsedProjectData.strokeSequence[label]) window.lineStrokesByImage[label] = Array.isArray(parsedProjectData.strokeSequence[label]) ? parsedProjectData.strokeSequence[label].slice() : []; else window.lineStrokesByImage[label] = [];
                                                if (parsedProjectData.nextLabels && parsedProjectData.nextLabels[label]) window.labelsByImage[label] = parsedProjectData.nextLabels[label]; else window.labelsByImage[label] = 'A1';
                                                
                                                // Restore custom label positions and rotation stamps
                                                if (!window.customLabelPositions) window.customLabelPositions = {};
                                                if (!window.customLabelOffsetsRotationByImageAndStroke) window.customLabelOffsetsRotationByImageAndStroke = {};

                                                window.customLabelPositions[label] =
                                                    (parsedProjectData.customLabelPositions && parsedProjectData.customLabelPositions[label])
                                                        ? JSON.parse(JSON.stringify(parsedProjectData.customLabelPositions[label]))
                                                        : {};

                                                window.customLabelOffsetsRotationByImageAndStroke[label] =
                                                    (parsedProjectData.customLabelRotationStamps && parsedProjectData.customLabelRotationStamps[label])
                                                        ? JSON.parse(JSON.stringify(parsedProjectData.customLabelRotationStamps[label]))
                                                        : {};

                                                // Legacy: if a custom offset exists without a stamp, stamp it to current rotation without rotating
                                                const curTheta = window.imageRotationByLabel && window.imageRotationByLabel[label] ? window.imageRotationByLabel[label] : 0;
                                                Object.keys(window.customLabelPositions[label]).forEach(stroke => {
                                                    if (window.customLabelOffsetsRotationByImageAndStroke[label][stroke] === undefined) {
                                                        window.customLabelOffsetsRotationByImageAndStroke[label][stroke] = curTheta;
                                                    }
                                                });
                                            })
                                            .catch(err => console.error(`Error processing data for label ${label}:`, err)); // Catch per-image errors
                                        imagePromises.push(promise);
                                    } else {
//                                         console.log(`No image file found for ${label}`);
                                        if (!window.originalImageDimensions[label]) {
                                           window.originalImageDimensions[label] = { width: 0, height: 0 };
                                        }
                                    }
                                } // End of for...of loop for labels

                                return Promise.all(imagePromises)
                                    .then(() => { // Executed after all images and their data are loaded and processed
//                                         console.log('All image files processed. OriginalImageDimensions:', JSON.stringify(window.originalImageDimensions));
                                        
                                        // Main UI update timeout
                                        setTimeout((activeProjectData) => { 
//                                             console.log('[Load Project] Main UI Update Timeout. ImageLabels:', activeProjectData.imageLabels);
                                            document.getElementById('loadingIndicator')?.remove();

                                            let targetLabel = activeProjectData.currentImageLabel;
                                            const availableImageKeys = Object.keys(window.originalImages);
                                            if (!targetLabel || !availableImageKeys.includes(targetLabel)) {
                                                targetLabel = availableImageKeys.length > 0 ? availableImageKeys[0] : 'front';
                                            }
//                                             console.log(`[Load Project] Initial targetLabel: ${targetLabel}`);

                                            if (typeof window.switchToImage === 'function') {
                                                window.currentImageLabel = targetLabel;
                                                window.switchToImage(targetLabel);
                                            } else {
                                                console.error('[Load Project] switchToImage function not found!');
                                                window.isLoadingProject = false;
                                                showStatusMessage('Error: switchToImage function missing.', 'error');
                                                return;
                                            }

                                            try {
                                                if (typeof window.updateSidebarStrokeCounts === 'function') window.updateSidebarStrokeCounts();
                                                if (typeof window.updateScaleUI === 'function') window.updateScaleUI();
                                                if (typeof window.updateActiveImageInSidebar === 'function') window.updateActiveImageInSidebar();
                                                if (typeof window.updateStrokeVisibilityControls === 'function') window.updateStrokeVisibilityControls();
                                            } catch (uiError) { console.error('[Load Project] UI component update error:', uiError); }

                                            const currentActiveLabel = window.currentImageLabel;
                                            if (activeProjectData.imageScales && activeProjectData.imageScales[currentActiveLabel] !== undefined) {
                                                window.imageScaleByLabel[currentActiveLabel] = activeProjectData.imageScales[currentActiveLabel];
                                            } else window.imageScaleByLabel[currentActiveLabel] = 1.0;
                                            // Force recalculation of centered positions instead of using saved positions
                                            window.imagePositionByLabel[currentActiveLabel] = { x: 0, y: 0 }; // Will be recalculated by calculateFitScale
                                            if (typeof window.updateScaleUI === 'function') window.updateScaleUI();

                                            // Note: resizeCanvas will be called after all images are loaded
                                            
                                            // PERFORMANCE FIX: Start debounced sync instead of interval
                                            queueMicrotask(() => scheduleLegacySync());
                                            
                                            // Final delayed actions timeout
                                            setTimeout((dataForFinalSteps) => { 
//                                                 console.log('[Load Project] Final Delayed Actions Timeout. ImageLabels:', dataForFinalSteps.imageLabels);
                                                
                                                // PERFORMANCE FIX: Non-blocking finalization with deferred tag refresh
                                                const labelsForTagRefresh = Array.isArray(dataForFinalSteps.imageLabels) ? dataForFinalSteps.imageLabels.slice() : [];
                                                finalizeLoadProcess(dataForFinalSteps);

                                                // Non-blocking tag refresh - runs after load completes
                                                (function tryTagRefresh(attempts = 0) {
                                                    if (typeof window.updateTagsDisplay === 'function' && typeof window.getTagBasedFilename === 'function') {
//                                                         console.log('[Load Project] Tag manager functions available, refreshing tags...');
                                                        labelsForTagRefresh.forEach(label => {
                                                            if (window.imageTags[label]) {
                                                                try { 
                                                                    window.updateTagsDisplay(label); 
                                                                } catch (e) {
                                                                    console.warn(`[Load Project] Error refreshing tags for ${label}:`, e);
                                                                }
                                                            }
                                                        });
                                                    } else if (attempts < 20) {
                                                        setTimeout(() => tryTagRefresh(attempts + 1), 100);
                                                    } else {
                                                        console.warn('[Load Project] Tag manager functions unavailable after retries; skipping tag refresh.');
                                                        // Let tag-manager run a catch-up when it initializes
                                                        window.__pendingTagRefresh = labelsForTagRefresh;
                                                    }
                                                })();

                                            }, 100, activeProjectData); // Pass activeProjectData (which is parsedProjectData)
                                        }, 200, parsedProjectData); // Pass parsedProjectData to the main UI timeout
                            }); // End of Promise.all().then()
                            }); // End of projectJsonFile.async().then()
                    }) // End of JSZip.loadAsync().then()
                    .catch(err => { // Catch for JSZip.loadAsync() and its chained promises
                        window.isLoadingProject = false;
                        document.getElementById('loadingIndicator')?.remove();
                        console.error('Error loading project from ZIP (outer catch):', err);
                        showStatusMessage(`Error loading project: ${err.message}`, 'error');
                    });
            }; // End of reader.onload
            reader.onerror = function(e) {
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
        
        // Set color based on message type
        switch (type) {
            case 'success':
                statusElement.style.backgroundColor = '#4CAF50';
                break;
            case 'error':
                statusElement.style.backgroundColor = '#F44336';
                break;
            case 'info':
            default:
                statusElement.style.backgroundColor = '#2196F3';
                break;
        }
        
        // Hide after a timeout
        clearTimeout(statusElement.timer);
        statusElement.timer = setTimeout(() => {
            statusElement.style.opacity = '0';
        }, 3000);
    }
    
    // Make these functions available globally if needed
    window.projectManager = {
        saveProject,
        loadProject,
        showStatusMessage
    };

    function finalizeLoadProcess(dataForFinalSteps) { // ADDED FUNCTION
//         console.log('[Load Project] Finalizing load process...');

        // *** ADDED: Loop to update sidebar label text and scale text ***
        if (dataForFinalSteps.imageLabels && typeof window.imageScaleByLabel !== 'undefined') {
//             console.log('[Load Project] Updating sidebar label text and scale text...');
            dataForFinalSteps.imageLabels.forEach(label => {
                // Update Label Text (prefer custom names)
                const labelElement = document.querySelector(`.image-container[data-label="${label}"] .image-label`);
                if (labelElement) {
                    const displayName = (typeof window.getUserFacingImageName === 'function')
                        ? window.getUserFacingImageName(label)
                        : (typeof window.getTagBasedFilename === 'function' ? window.getTagBasedFilename(label, label.split('_')[0]) : label);
                    const newText = displayName ? displayName.charAt(0).toUpperCase() + displayName.slice(1) : label;
                    labelElement.textContent = newText;
                } else {
                    console.warn(`  Could not find labelElement for ${label} during final update.`);
                }

                // Update Scale Text
                const scaleElement = document.getElementById(`scale-${label}`);
                if (scaleElement) {
                    const scaleValue = window.imageScaleByLabel[label] !== undefined ? window.imageScaleByLabel[label] : 1.0;
                    const scaleText = `Scale: ${Math.round(scaleValue * 100)}%`;
//                     console.log(`  Updating scale text for ${label} to: "${scaleText}"`);
                    scaleElement.textContent = scaleText;
                } else {
                    console.warn(`  Could not find scaleElement for ${label} during final update.`);
                }
            });
        } else {
            console.warn('[Load Project] Could not update sidebar label/scale text. Necessary functions or data missing.');
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
                console.log('[Load Project] Updating position for', window.currentImageLabel, 'to', fitResult.position);
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
                    console.warn(`   MEASUREMENT MISMATCH for ${label}! App: ${JSON.stringify(currentMeasurements)}, Loaded: ${JSON.stringify(loadedMeasurements)}`);
                } else {
//                     console.log(`   ✓ Measurements verified for ${label}`);
                }
            });
        } catch(validationError) {
            console.error('[Load Project] Final validation error:', validationError);
        }
        
        window.isLoadingProject = false;
        showStatusMessage('Project loaded successfully.', 'success');
//         console.log('[Load Project] Complete.');
    }
});