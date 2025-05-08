// Project Manager for OpenPaint
// Handles saving and loading projects using ZIP format

console.log('PROJECT-MANAGER.JS LOADED - Version ' + new Date().toISOString());

document.addEventListener('DOMContentLoaded', () => {
    // Get reference to save and load buttons
    const saveProjectBtn = document.getElementById('saveProject');
    const loadProjectBtn = document.getElementById('loadProject');
    
    // Add event listeners
    if (saveProjectBtn) {
        saveProjectBtn.addEventListener('click', () => {
            // Before saving, log the current scales for all images
            console.log('[Save Project] Verifying scales before saving:');
            if (window.imageScaleByLabel) {
                Object.keys(window.imageScaleByLabel).forEach(label => {
                    console.log(`- Scale for ${label}: ${window.imageScaleByLabel[label]}`);
                });
            } else {
                console.log('- imageScaleByLabel is not defined!');
            }
            
            // Now explicitly verify the current view's scale is correct
            const currentLabel = window.currentImageLabel;
            if (currentLabel) {
                console.log(`[Save Project] Current view is ${currentLabel}`);
                console.log(`[Save Project] Current scale for ${currentLabel} is ${window.imageScaleByLabel[currentLabel]}`);
                
                // Get scale from the UI as a backup check
                const scaleEl = document.getElementById('scaleButton');
                if (scaleEl) {
                    const scaleText = scaleEl.textContent;
                    console.log(`[Save Project] Scale shown in UI: ${scaleText}`);
                    
                    // Try to parse the scale from UI text (e.g. "Scale: 25% ▼")
                    const scaleMatch = scaleText.match(/Scale: (\d+)%/);
                    if (scaleMatch && scaleMatch[1]) {
                        const uiScale = parseInt(scaleMatch[1]) / 100;
                        console.log(`[Save Project] Parsed UI scale: ${uiScale}`);
                        
                        // If UI scale doesn't match stored scale, update the stored scale
                        if (uiScale !== window.imageScaleByLabel[currentLabel]) {
                            console.log(`[Save Project] Scale mismatch! Updating scale for ${currentLabel} from ${window.imageScaleByLabel[currentLabel]} to ${uiScale}`);
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
    
    // Add this BEFORE the loadProject function
    // Global variable to store project data across async operations
    window.loadedProjectDataGlobal = null;
    
    // Function to save project as ZIP file
    function saveProject() {
        try {
            // DIAGNOSTIC: Add test measurements if needed for debugging
            console.log('[Save Project] DIAGNOSTIC: Current state of strokeMeasurements before saving:');
            IMAGE_LABELS.forEach(label => {
                if (window.strokeMeasurements && window.strokeMeasurements[label]) {
                    console.log(`- ${label}:`, JSON.stringify(window.strokeMeasurements[label]));
                } else {
                    console.log(`- ${label}: undefined or empty`);
                }
            });

            // Show status message
            showStatusMessage('Preparing project for download...', 'info');
            
            // Create a new JSZip instance
            const zip = new JSZip();
            
            // Get project name with fallback
            const projectName = document.getElementById('projectName').value || 'OpenPaint Project';
            
            // *** MODIFIED: Get actual current image labels ***
            const actualImageLabels = Object.keys(window.imageTags || {});
            if (actualImageLabels.length === 0) {
                // Fallback if imageTags is empty for some reason
                actualImageLabels.push(...(window.IMAGE_LABELS || ['front', 'side', 'back', 'cushion']));
                console.warn("[Save Project] No keys found in window.imageTags, falling back to default labels.");
            }
            console.log("[Save Project] Saving data for labels:", actualImageLabels);
            
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
                strokeSequence: {},
                nextLabels: {},
                originalImageDimensions: {},
                imageTags: {},
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
            console.log('[Save Project] State before saving loop:');
            console.log('  window.lineStrokesByImage:', JSON.parse(JSON.stringify(window.lineStrokesByImage)));
            console.log('  window.labelsByImage:', JSON.parse(JSON.stringify(window.labelsByImage)));
            console.log('  window.imageTags:', JSON.parse(JSON.stringify(window.imageTags || {})));
            // *** END ADDED LOGGING ***
            
            // Add stroke data for each image
            for (const label of actualImageLabels) {
                console.log(`Processing data for ${label}...`);
                
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
                    console.log(`[Save Project] Saving measurements for ${label}:`, 
                        JSON.stringify(window.strokeMeasurements[label]));
                    
                    // Check if there are any actual measurements to save
                    const measurementCount = Object.keys(window.strokeMeasurements[label]).length;
                    console.log(`[Save Project] Found ${measurementCount} measurements for ${label}`);
                    
                    // Add detailed log of each measurement
                    if (measurementCount > 0) {
                        Object.entries(window.strokeMeasurements[label]).forEach(([strokeLabel, measurement]) => {
                            console.log(`[Save Project] - Measurement for ${strokeLabel}:`, measurement);
                        });
                    }
                    
                    // Add measurements to project data
                    projectData.strokeMeasurements[label] = window.strokeMeasurements[label];
                } else {
                    console.log(`[Save Project] No measurements found for ${label}, using empty object`);
                    projectData.strokeMeasurements[label] = {};
                }
                
                // Add image scaling and position
                if (window.imageScaleByLabel && window.imageScaleByLabel[label] !== undefined) {
                    const currentScale = window.imageScaleByLabel[label];
                    projectData.imageScales[label] = currentScale;
                    console.log(`[Save Project] Saving scale for ${label}: ${currentScale}`);
                    
                    // Double-check to ensure it was assigned correctly
                    if (projectData.imageScales[label] !== currentScale) {
                        console.error(`[Save Project] ERROR: Scale was not saved correctly for ${label}. Expected ${currentScale}, got ${projectData.imageScales[label]}. Fixing...`);
                        projectData.imageScales[label] = currentScale;
                    }
                } else {
                    projectData.imageScales[label] = 1.0; // Default to 100% scale
                    console.log(`[Save Project] No scale found for ${label}, using default 1.0`);
                }
                
                if (window.imagePositionByLabel && window.imagePositionByLabel[label]) {
                    projectData.imagePositions[label] = window.imagePositionByLabel[label];
                    console.log(`[Save Project] Saving position for ${label}: x=${window.imagePositionByLabel[label].x}, y=${window.imagePositionByLabel[label].y}`);
                } else {
                    projectData.imagePositions[label] = { x: 0, y: 0 }; // Default position
                    console.log(`[Save Project] No position found for ${label}, using default {x:0, y:0}`);
                }
                
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
                    console.log(`[Save Project] Saving tags for ${label}:`, JSON.stringify(window.imageTags[label]));
                    projectData.imageTags[label] = JSON.parse(JSON.stringify(window.imageTags[label]));
                } else {
                    console.log(`[Save Project] No tags found for ${label}, using empty object`);
                    projectData.imageTags[label] = {};
                }
            }
            
            // Add project.json to the zip
            zip.file("project.json", JSON.stringify(projectData, null, 2));
            
            // Validate that scales were correctly added to the project data
            console.log('[Save Project] VALIDATION - Checking scales in project data:');
            if (projectData.imageScales) {
                Object.keys(projectData.imageScales).forEach(label => {
                    console.log(`- Project data scale for ${label}: ${projectData.imageScales[label]}`);
                    
                    // Compare with the current scale in the app
                    if (window.imageScaleByLabel && window.imageScaleByLabel[label] !== undefined) {
                        const currentScale = window.imageScaleByLabel[label];
                        if (currentScale !== projectData.imageScales[label]) {
                            console.error(`[Save Project] ERROR: Scale mismatch for ${label}! App: ${currentScale}, Project data: ${projectData.imageScales[label]}`);
                        } else {
                            console.log(`[Save Project] ✓ Scale verified for ${label}: ${currentScale}`);
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
                    console.log(`Adding image for ${label}...`);
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
                            console.log(`   Added ${label}.png to zip.`);
                        })
                        .catch(error => {
                            console.error(`Error adding image ${label} to zip:`, error);
                            // Optionally show a user-facing error here
                        });
                        imagePromises.push(promise);
                } else {
                    console.log(`No original image found for ${label}, skipping image file.`);
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
            console.log('[Load Project] Set isLoadingProject = true');
            
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
                        console.log("ZIP file loaded. Contents:", Object.keys(zip.files));
                        const projectJsonFile = zip.file("project.json");
                        if (!projectJsonFile) {
                            throw new Error("Missing project.json"); // This will be caught by the final .catch()
                        }
                        
                        return projectJsonFile.async("string")
                            .then(jsonContent => {
                                console.log("Project data loaded:", jsonContent.substring(0, 100) + "...");
                                const parsedProjectData = JSON.parse(jsonContent);
                                
                                document.getElementById('projectName').value = parsedProjectData.name || 'OpenPaint Project';
                                const imageList = document.getElementById('imageList');
                                if (imageList) imageList.innerHTML = '';

                                window.vectorStrokesByImage = {};
                                window.strokeVisibilityByImage = {};
                                window.strokeLabelVisibility = {};
                                window.strokeMeasurements = {};
                                window.imageScaleByLabel = {};
                                window.imagePositionByLabel = {};
                                window.lineStrokesByImage = {};
                                window.labelsByImage = {};
                                window.originalImages = {};
                                window.originalImageDimensions = {};
                                window.imageTags = {};

                                if (parsedProjectData.folderStructure) {
                                    window.folderStructure = JSON.parse(JSON.stringify(parsedProjectData.folderStructure));
                                } else {
                                    window.folderStructure = { "root": { id: "root", name: "Root", type: "folder", parentId: null, children: [] } };
                                }

                                const imagePromises = [];
                                for (const label of parsedProjectData.imageLabels) {
                                    const safeLabel = label.toLowerCase();
                                    const imageFiles = Object.keys(zip.files).filter(
                                        filename => filename.toLowerCase().startsWith(`${safeLabel}.`) && 
                                        !filename.endsWith('/') && filename !== 'project.json'
                                    );
                                    if (imageFiles.length > 0) {
                                        const imageFile = imageFiles[0];
                                        const promise = zip.file(imageFile).async("blob")
                                            .then(blob => new Promise((resolve, reject) => {
                                                    const reader = new FileReader();
                                                    reader.onload = e => resolve(e.target.result);
                                                    reader.onerror = reject;
                                                    reader.readAsDataURL(blob);
                                            }))
                                            .then(dataUrl => {
                                                window.originalImages[label] = dataUrl;
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
                                                    img.src = dataUrl;
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
                                                if (parsedProjectData.imageScales && parsedProjectData.imageScales[label] !== undefined) window.imageScaleByLabel[label] = parsedProjectData.imageScales[label]; else window.imageScaleByLabel[label] = 1.0;
                                                if (parsedProjectData.imagePositions && parsedProjectData.imagePositions[label]) window.imagePositionByLabel[label] = parsedProjectData.imagePositions[label]; else window.imagePositionByLabel[label] = { x: 0, y: 0 };
                                                if (parsedProjectData.strokeSequence && parsedProjectData.strokeSequence[label]) window.lineStrokesByImage[label] = Array.isArray(parsedProjectData.strokeSequence[label]) ? parsedProjectData.strokeSequence[label].slice() : []; else window.lineStrokesByImage[label] = [];
                                                if (parsedProjectData.nextLabels && parsedProjectData.nextLabels[label]) window.labelsByImage[label] = parsedProjectData.nextLabels[label]; else window.labelsByImage[label] = 'A1';
                                            })
                                            .catch(err => console.error(`Error processing data for label ${label}:`, err)); // Catch per-image errors
                                        imagePromises.push(promise);
                                    } else {
                                        console.log(`No image file found for ${label}`);
                                        if (!window.originalImageDimensions[label]) {
                                           window.originalImageDimensions[label] = { width: 0, height: 0 };
                                        }
                                    }
                                } // End of for...of loop for labels

                                return Promise.all(imagePromises)
                                    .then(() => { // Executed after all images and their data are loaded and processed
                                        console.log('All image files processed. OriginalImageDimensions:', JSON.stringify(window.originalImageDimensions));
                                        
                                        // Main UI update timeout
                                        setTimeout((activeProjectData) => { 
                                            console.log('[Load Project] Main UI Update Timeout. ImageLabels:', activeProjectData.imageLabels);
                                            document.getElementById('loadingIndicator')?.remove();

                                            let targetLabel = activeProjectData.currentImageLabel;
                                            const availableImageKeys = Object.keys(window.originalImages);
                                            if (!targetLabel || !availableImageKeys.includes(targetLabel)) {
                                                targetLabel = availableImageKeys.length > 0 ? availableImageKeys[0] : 'front';
                                            }
                                            console.log(`[Load Project] Initial targetLabel: ${targetLabel}`);

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
                                            if (activeProjectData.imagePositions && activeProjectData.imagePositions[currentActiveLabel]) {
                                                window.imagePositionByLabel[currentActiveLabel] = activeProjectData.imagePositions[currentActiveLabel];
                                            } else window.imagePositionByLabel[currentActiveLabel] = { x: 0, y: 0 };
                                            if (typeof window.updateScaleUI === 'function') window.updateScaleUI();

                                            if (typeof window.redrawCanvasWithVisibility === 'function') {
                                                window.redrawCanvasWithVisibility();
                                            }
                                            
                                            // Final delayed actions timeout
                                            setTimeout((dataForFinalSteps) => { 
                                                console.log('[Load Project] Final Delayed Actions Timeout. ImageLabels:', dataForFinalSteps.imageLabels);
                                                
                                                // MODIFIED: Implement retry mechanism for tag display updates
                                                let attempts = 0;
                                                const maxAttempts = 20; // Try for up to 2 seconds (20 * 100ms)
                                                function attemptTagRefresh() {
                                                    if (typeof window.updateTagsDisplay === 'function' && typeof window.getTagBasedFilename === 'function') {
                                                        console.log('[Load Project] Tag manager functions are now available. Refreshing sidebar tag displays...');
                                                        if (dataForFinalSteps.imageLabels) {
                                                            dataForFinalSteps.imageLabels.forEach(label => {
                                                                if (window.imageTags[label]) { 
                                                                    console.log(`  Refreshing tags for ${label} (attempt ${attempts + 1})`);
                                                                    window.updateTagsDisplay(label);
                                                                } else { 
                                                                    console.warn(`  No tags found in window.imageTags for ${label} during final sidebar refresh.`);
                                                                }
                                                            });
                                                        } else {
                                                            console.warn('[Load Project] No image labels in final project data for tag refresh.');
                                                        }
                                                        // Proceed with the rest of the finalization after successful tag refresh
                                                        finalizeLoadProcess(dataForFinalSteps);
                                            } else {
                                                        attempts++;
                                                        if (attempts < maxAttempts) {
                                                            console.warn(`[Load Project] Tag manager functions (updateTagsDisplay, getTagBasedFilename) not yet available. Retrying in 100ms... (Attempt ${attempts}/${maxAttempts})`);
                                                            setTimeout(attemptTagRefresh, 100);
                                                        } else {
                                                            console.error('[Load Project] Max attempts reached. Tag manager functions did not become available. Tags may not display correctly.');
                                                            // Proceed anyway, but tags might be missing/incorrect
                                                            finalizeLoadProcess(dataForFinalSteps);
                                                        }
                                                    }
                                                }
                                                attemptTagRefresh(); // Start the attempt

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
                console.log('[Load Project] Set isLoadingProject = false (Reader Error)');

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
        console.log('[Load Project] Finalizing load process...');

        // *** ADDED: Loop to update sidebar label text and scale text ***
        if (dataForFinalSteps.imageLabels && typeof window.getTagBasedFilename === 'function' && typeof window.imageScaleByLabel !== 'undefined') {
            console.log('[Load Project] Updating sidebar label text and scale text...');
            dataForFinalSteps.imageLabels.forEach(label => {
                // Update Label Text
                const labelElement = document.querySelector(`.image-container[data-label="${label}"] .image-label`);
                if (labelElement) {
                    const filename = window.getTagBasedFilename(label, label.split('_')[0]); // Get updated filename
                    const newText = filename ? filename.charAt(0).toUpperCase() + filename.slice(1) : label;
                    console.log(`  Updating label text for ${label} to: "${newText}"`);
                    labelElement.textContent = newText; // Update text
                } else {
                    console.warn(`  Could not find labelElement for ${label} during final update.`);
                }

                // Update Scale Text
                const scaleElement = document.getElementById(`scale-${label}`);
                if (scaleElement) {
                    const scaleValue = window.imageScaleByLabel[label] !== undefined ? window.imageScaleByLabel[label] : 1.0;
                    const scaleText = `Scale: ${Math.round(scaleValue * 100)}%`;
                    console.log(`  Updating scale text for ${label} to: "${scaleText}"`);
                    scaleElement.textContent = scaleText;
                } else {
                    console.warn(`  Could not find scaleElement for ${label} during final update.`);
                }
            });
        } else {
            console.warn('[Load Project] Could not update sidebar label/scale text. Necessary functions or data missing.');
        }
        // *** END ADDED BLOCK ***

        if (typeof window.redrawCanvasWithVisibility === 'function') {
            console.log('[Load Project] Performing final redraw before completing load.');
            window.redrawCanvasWithVisibility();
        }

        console.log('[Load Project] FINAL VALIDATION BLOCK');
        try {
            const labelsToCheck = dataForFinalSteps.imageLabels || [];
            labelsToCheck.forEach(label => {
                const currentMeasurements = window.strokeMeasurements[label] || {};
                const loadedMeasurements = dataForFinalSteps.strokeMeasurements[label] || {};
                if (JSON.stringify(currentMeasurements) !== JSON.stringify(loadedMeasurements)) {
                    console.warn(`   MEASUREMENT MISMATCH for ${label}! App: ${JSON.stringify(currentMeasurements)}, Loaded: ${JSON.stringify(loadedMeasurements)}`);
                } else {
                    console.log(`   ✓ Measurements verified for ${label}`);
                }
            });
        } catch(validationError) {
            console.error('[Load Project] Final validation error:', validationError);
        }
        
        window.isLoadingProject = false;
        showStatusMessage('Project loaded successfully.', 'success');
        console.log('[Load Project] Complete.');
    }
});