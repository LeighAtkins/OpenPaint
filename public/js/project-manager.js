// Project Manager for OpenPaint
// Handles saving and loading projects using ZIP format

console.log('PROJECT-MANAGER.JS LOADED - Version ' + new Date().toISOString());

document.addEventListener('DOMContentLoaded', () => {
    // Get reference to save and load buttons
    const saveProjectBtn = document.getElementById('saveProject');
    const loadProjectBtn = document.getElementById('loadProject');
    
    // Add event listeners
    if (saveProjectBtn) {
        saveProjectBtn.addEventListener('click', saveProject);
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
            // Show status message
            showStatusMessage('Preparing project for download...', 'info');
            
            // Create a new JSZip instance
            const zip = new JSZip();
            
            // Get project name with fallback
            const projectName = document.getElementById('projectName').value || 'OpenPaint Project';
            
            // Create project metadata
            const projectData = {
                name: projectName,
                created: new Date().toISOString(),
                version: '1.0',
                imageLabels: window.IMAGE_LABELS || ['front', 'side', 'back', 'cushion'],
                currentImageLabel: window.currentImageLabel || 'front',
                // Create empty containers for all data
                strokes: {},
                strokeVisibility: {},
                strokeLabelVisibility: {},
                strokeMeasurements: {},
                imageScales: {},
                imagePositions: {},
                strokeSequence: {},
                nextLabels: {},
                originalImageDimensions: {}
            };
            
            // *** ADDED LOGGING BEFORE LOOP ***
            console.log('[Save Project] State before saving loop:');
            console.log('  window.lineStrokesByImage:', JSON.parse(JSON.stringify(window.lineStrokesByImage)));
            console.log('  window.labelsByImage:', JSON.parse(JSON.stringify(window.labelsByImage)));
            // *** END ADDED LOGGING ***
            
            // Add stroke data for each image
            for (const label of projectData.imageLabels) {
                console.log(`Processing strokes for ${label}...`);
                
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
                    projectData.strokeMeasurements[label] = window.strokeMeasurements[label];
                } else {
                    projectData.strokeMeasurements[label] = {};
                }
                
                // Add image scaling and position
                if (window.imageScaleByLabel && window.imageScaleByLabel[label] !== undefined) {
                    projectData.imageScales[label] = window.imageScaleByLabel[label];
                } else {
                    projectData.imageScales[label] = 1.0; // Default to 100% scale
                }
                
                if (window.imagePositionByLabel && window.imagePositionByLabel[label]) {
                    projectData.imagePositions[label] = window.imagePositionByLabel[label];
                } else {
                    projectData.imagePositions[label] = { x: 0, y: 0 }; // Default position
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
                    projectData.originalImageDimensions[label] = { width: 0, height: 0 }; // Default dimensions
                }
            }
            
            // Add project.json to the zip
            zip.file("project.json", JSON.stringify(projectData, null, 2));
            
            // Add image files
            const imagePromises = [];
            
            for (const label of projectData.imageLabels) {
                if (window.originalImages && window.originalImages[label]) {
                    const imageUrl = window.originalImages[label];
                    
                    if (imageUrl && imageUrl.startsWith('data:')) {
                        // It's a base64 data URL
                        const extension = imageUrl.match(/data:image\/(\w+);base64,/)?.[1] || 'png';
                        const base64Data = imageUrl.split(',')[1];
                        
                        // Ensure consistent file naming for images
                        const safeLabel = label.toLowerCase();
                        zip.file(`${safeLabel}.${extension}`, base64Data, {base64: true});
                    } else if (imageUrl) {
                        // It's a URL, need to fetch it
                        const promise = fetch(imageUrl)
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
                                }
                                return response.blob();
                            })
                            .then(blob => {
                                const extension = blob.type.split('/')[1] || 'png';
                                
                                // Ensure consistent file naming for images
                                const safeLabel = label.toLowerCase();
                                zip.file(`${safeLabel}.${extension}`, blob);
                            })
                            .catch(err => {
                                console.error(`Error fetching image for ${label}:`, err);
                                showStatusMessage(`Error processing image for ${label}`, 'error');
                            });
                            
                        imagePromises.push(promise);
                    }
                } else {
                    // Try to capture the current canvas state for this view if no original image exists
                    console.log(`No original image found for ${label}, trying to capture canvas state`);
                    
                    // If this is the current view, grab the canvas directly
                    if (label === window.currentImageLabel && window.canvas) {
                        try {
                            const dataUrl = window.canvas.toDataURL('image/png');
                            const base64Data = dataUrl.split(',')[1];
                            
                            // Ensure consistent file naming for images
                            const safeLabel = label.toLowerCase();
                            zip.file(`${safeLabel}.png`, base64Data, {base64: true});
                        } catch (err) {
                            console.error(`Error capturing canvas for ${label}:`, err);
                            showStatusMessage(`Error capturing canvas for ${label}`, 'error');
                        }
                    }
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
                
                // Load the zip file
                JSZip.loadAsync(data)
                    .then(zip => {
                        console.log("ZIP file loaded. Contents:", Object.keys(zip.files));
                        
                        // First get the project.json file
                        const projectJsonFile = zip.file("project.json");
                        if (!projectJsonFile) {
                            throw new Error("Missing project.json");
                        }
                        
                        return projectJsonFile.async("string")
                            .then(jsonContent => {
                                console.log("Project data loaded:", jsonContent.substring(0, 100) + "...");
                                const projectData = JSON.parse(jsonContent);
                                window.loadedProjectDataGlobal = projectData; // Store in global for timeout access
                                
                                // Set project name
                                document.getElementById('projectName').value = projectData.name || 'OpenPaint Project';
                                
                                // Clear existing image list in sidebar
                                const imageList = document.getElementById('imageList');
                                if (imageList) {
                                    imageList.innerHTML = '';
                                }
                                
                                // Process image files and load project data
                                const imagePromises = [];
                                
                                // Reset global variables to start with a clean slate
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
                                
                                // Process each image label
                                for (const label of projectData.imageLabels) {
                                    console.log(`Processing label: ${label}`);
                                    
                                    // Find any file starting with this label name
                                    // Use lowercase version of the label for consistency with saving
                                    const safeLabel = label.toLowerCase();
                                    const imageFiles = Object.keys(zip.files).filter(
                                        filename => filename.startsWith(`${safeLabel}.`) && 
                                        !filename.endsWith('/') && 
                                        filename !== 'project.json'
                                    );
                                    
                                    if (imageFiles.length > 0) {
                                        const imageFile = imageFiles[0];
                                        console.log(`Processing image file: ${imageFile}`);
                                        
                                        const promise = zip.file(imageFile).async("blob")
                                            .then(blob => {
                                                console.log(`Image blob loaded for ${label}, size:`, blob.size);
                                                // Convert blob to data URL
                                                return new Promise((resolve, reject) => {
                                                    const reader = new FileReader();
                                                    reader.onload = e => resolve(e.target.result);
                                                    reader.onerror = reject;
                                                    reader.readAsDataURL(blob);
                                                });
                                            })
                                            .then(dataUrl => {
                                                console.log(`Data URL created for ${label}, length:`, dataUrl.length);
                                                // Store the image data
                                                window.originalImages[label] = dataUrl;
                                                
                                                // --- Create a promise specifically for dimension loading ---
                                                const dimensionPromise = new Promise((resolveDim) => {
                                                    const img = new Image();
                                                    img.onload = () => {
                                                        window.originalImageDimensions[label] = { width: img.width, height: img.height };
                                                        console.log(`   Dimensions set for ${label}: ${img.width}x${img.height}`);
                                                        resolveDim(); // Resolve when dimensions are set
                                                    };
                                                    img.onerror = () => {
                                                        console.error(`Failed to load image for dimension check: ${label}`);
                                                        window.originalImageDimensions[label] = { width: 0, height: 0 }; // Set default on error
                                                        resolveDim(); // Still resolve so Promise.all doesn't hang
                                                    };
                                                    img.src = dataUrl;
                                                });
                                                // ----------------------------------------------------------

                                                // Update the sidebar (can happen immediately)
                                                if (typeof window.addImageToSidebar === 'function') {
                                                    console.log(`Adding image to sidebar for ${label}`);
                                                    window.addImageToSidebar(dataUrl, label);
                                                } else {
                                                    console.error(`addImageToSidebar function not found for ${label}`);
                                                    throw new Error(`Function addImageToSidebar not found. The paint.js file may not be properly loaded.`);
                                                }
                                                
                                                // Return the dimension promise to be awaited later
                                                return dimensionPromise;
                                            })
                                            .catch(err => {
                                                console.error(`Error processing image for ${label}:`, err);
                                                showStatusMessage(`Error loading image for ${label}`, 'error');
                                                return Promise.resolve(); // Resolve even on error to not break Promise.all
                                            });
                                            
                                        imagePromises.push(promise);
                                    } else {
                                        console.log(`No image file found for ${label}`);
                                        // If no image, ensure default dimensions are set
                                        if (!window.originalImageDimensions[label]) {
                                           window.originalImageDimensions[label] = { width: 0, height: 0 };
                                        }
                                    }
                                    
                                    // Load stroke data
                                    if (projectData.strokes && projectData.strokes[label]) {
                                        window.vectorStrokesByImage[label] = JSON.parse(JSON.stringify(projectData.strokes[label]));
                                        console.log(`Loaded ${Object.keys(window.vectorStrokesByImage[label]).length} vector strokes for ${label}`);
                                    } else {
                                        window.vectorStrokesByImage[label] = {};
                                        console.log(`No vector strokes found for ${label} in project data.`);
                                    }
                                    
                                    // Load stroke visibility
                                    if (projectData.strokeVisibility && projectData.strokeVisibility[label]) {
                                        window.strokeVisibilityByImage[label] = projectData.strokeVisibility[label];
                                    } else {
                                        window.strokeVisibilityByImage[label] = {};
                                    }
                                    
                                    // Load stroke label visibility
                                    if (projectData.strokeLabelVisibility && projectData.strokeLabelVisibility[label]) {
                                        window.strokeLabelVisibility[label] = projectData.strokeLabelVisibility[label];
                                    } else {
                                        window.strokeLabelVisibility[label] = {};
                                    }
                                    
                                    // Load stroke measurements
                                    if (projectData.strokeMeasurements && projectData.strokeMeasurements[label]) {
                                        window.strokeMeasurements[label] = projectData.strokeMeasurements[label];
                                    } else {
                                        window.strokeMeasurements[label] = {};
                                    }
                                    
                                    // Load image scales
                                    if (projectData.imageScales && projectData.imageScales[label] !== undefined) {
                                        window.imageScaleByLabel[label] = projectData.imageScales[label];
                                    } else {
                                        window.imageScaleByLabel[label] = 1.0; // Default scale
                                    }
                                    
                                    // Load image positions
                                    if (projectData.imagePositions && projectData.imagePositions[label]) {
                                        window.imagePositionByLabel[label] = projectData.imagePositions[label];
                                        console.log(`Loaded position for ${label}: x=${projectData.imagePositions[label].x}, y=${projectData.imagePositions[label].y}`);
                                    } else {
                                        window.imagePositionByLabel[label] = { x: 0, y: 0 }; // Default position
                                        console.log(`Using default position for ${label}: x=0, y=0`);
                                    }
                                    
                                    // Load stroke sequence
                                    if (projectData.strokeSequence && projectData.strokeSequence[label]) {
                                        window.lineStrokesByImage[label] = Array.isArray(projectData.strokeSequence[label]) ? 
                                            projectData.strokeSequence[label].slice() : [];
                                        console.log(`Loaded stroke sequence for ${label}:`, window.lineStrokesByImage[label]);
                                    } else {
                                        window.lineStrokesByImage[label] = [];
                                        console.log(`No stroke sequence found for ${label} in project data.`);
                                    }
                                    
                                    // Load next label counters
                                    if (projectData.nextLabels && projectData.nextLabels[label]) {
                                        window.labelsByImage[label] = projectData.nextLabels[label];
                                    } else {
                                        window.labelsByImage[label] = 'A1'; // Default starting label
                                    }
                                }
                                
                                // Wait for all images AND THEIR DIMENSIONS to load
                                return Promise.all(imagePromises).then(() => {
                                    // Now we are sure all dimension onload events have fired
                                    console.log('All images and dimensions loading initiated. Final check before UI update.');
                                    // Ensure dimensions are set for all labels (redundant check, but safe)
                                    projectData.imageLabels.forEach(label => {
                                        if (!window.originalImageDimensions[label] || window.originalImageDimensions[label].width === 0) {
                                            console.warn(`Dimensions for ${label} still not set or zero after loading promises.`);
                                             if (!window.originalImageDimensions[label]) {
                                                 window.originalImageDimensions[label] = { width: 0, height: 0 };
                                             }
                                        }
                                    });
                                    return true; // Indicate completion
                                });
                            })
                            .then(() => {
                                console.log('All promises resolved. Available images:', Object.keys(window.originalImages));
                                console.log('Final Dimensions:', JSON.stringify(window.originalImageDimensions));
                                
                                // Update all UI components with a slight delay to ensure DOM is updated
                                setTimeout(() => {
                                    try {
                                        console.log('>>> INSIDE TIMEOUT - Using global var:', window.loadedProjectDataGlobal ? 'AVAILABLE' : 'MISSING');
                                        
                                        // Remove loading indicator
                                        if (loadingIndicator.parentNode) {
                                            loadingIndicator.parentNode.removeChild(loadingIndicator);
                                        }
                                        
                                        // Switch to the current image label from the project
                                        if (typeof window.switchToImage === 'function' && window.loadedProjectDataGlobal && window.loadedProjectDataGlobal.currentImageLabel) {
                                            console.log(`Switching to image: ${window.loadedProjectDataGlobal.currentImageLabel}`);
                                            window.switchToImage(window.loadedProjectDataGlobal.currentImageLabel);
                                            
                                            // IMPORTANT: After switching to the image, we need to ensure the image position
                                            // is correctly set to match what was saved in the project
                                            setTimeout(() => {
                                                // Get current image label
                                                const currentLabel = window.currentImageLabel;
                                                if (currentLabel) {
                                                    console.log(`*** FIX: Resetting image position and scale for ${currentLabel} after loading ***`);
                                                    
                                                    // Force the canvas to use the position and scale from the loaded project
                                                    // This ensures stroke positions are correct relative to the image
                                                    if (window.imagePositionByLabel && window.imagePositionByLabel[currentLabel]) {
                                                        const savedPosition = window.imagePositionByLabel[currentLabel];
                                                        console.log(`    Setting position to saved values: ${JSON.stringify(savedPosition)}`);
                                                        
                                                        // If redrawCanvasWithVisibility exists, force a redraw with the correct position
                                                        if (typeof window.redrawCanvasWithVisibility === 'function') {
                                                            console.log('    Forcing redraw with correct position...');
                                                            window.redrawCanvasWithVisibility();
                                                        }
                                                    }
                                                }
                                            }, 100); // Short delay to ensure switchToImage has completed
                                        } else {
                                            // Fallback: Try to find any image
                                            const availableImages = Object.keys(window.originalImages);
                                            if (availableImages.length > 0 && typeof window.switchToImage === 'function') {
                                                console.log(`No valid current image label. Switching to first available: ${availableImages[0]}`);
                                                window.switchToImage(availableImages[0]);
                                            } else {
                                                console.error('Cannot switch to any image - none available or switchToImage is missing');
                                            }
                                        }
                                        
                                        // Update UI components if functions exist
                                        if (typeof window.updateStrokeCounter === 'function') {
                                            window.updateStrokeCounter();
                                        }
                                        
                                        if (typeof window.updateStrokeVisibilityControls === 'function') {
                                            window.updateStrokeVisibilityControls();
                                        }
                                        
                                        if (typeof window.updateScaleUI === 'function') {
                                            window.updateScaleUI();
                                        }
                                        
                                        // --- REPLACED forceLoadImages LOGIC --- 
                                        // Add an additional check to force loading all images in sequence
                                        console.log('[Load Project] Starting explicit image pre-load...');
                                        const forceLoadImages = async () => {
                                            const projectData = window.loadedProjectDataGlobal;
                                            if (!projectData || !projectData.imageLabels) {
                                                console.warn('[Pre-Load] No project data or image labels found.');
                                                return;
                                            }

                                            // *** ADDED LOG ***
                                            console.log('[Pre-Load] Checking window.originalImages before loop:', JSON.stringify(Object.keys(window.originalImages)));

                                            // First pass: Apply saved scales and positions to ensure they're set before loading images
                                            for (const label of projectData.imageLabels) {
                                                // Set saved scale
                                                if (projectData.imageScales && projectData.imageScales[label] !== undefined) {
                                                    window.imageScaleByLabel[label] = projectData.imageScales[label];
                                                    console.log(`[Pre-Load] Pre-setting scale for ${label} to ${projectData.imageScales[label]}`);
                                                }
                                                
                                                // Set saved position
                                                if (projectData.imagePositions && projectData.imagePositions[label]) {
                                                    window.imagePositionByLabel[label] = projectData.imagePositions[label];
                                                    console.log(`[Pre-Load] Pre-setting position for ${label} to x=${projectData.imagePositions[label].x}, y=${projectData.imagePositions[label].y}`);
                                                }
                                            }

                                            // Second pass: Load images with the correct scale and position
                                            for (const label of projectData.imageLabels) {
                                                const imageUrl = window.originalImages[label];
                                                // *** ADDED LOG ***
                                                console.log(`[Pre-Load] For label '${label}', imageUrl:`, imageUrl ? imageUrl.substring(0, 50) + '...' : imageUrl);

                                                if (imageUrl && typeof window.pasteImageFromUrl === 'function') {
                                                    console.log(`[Pre-Load] Starting paste for ${label}`);
                                                    try {
                                                        await window.pasteImageFromUrl(imageUrl, label);
                                                        console.log(`[Pre-Load] Completed paste for ${label}`);
                                                    } catch (error) {
                                                        console.error(`[Pre-Load] Error pasting image for ${label}:`, error);
                                                        // Decide if you want to continue or stop loading on error
                                                    }
                                                } else {
                                                    console.log(`[Pre-Load] Skipping ${label} - No image URL or paste function unavailable.`);
                                                }
                                            }

                                            // After pre-loading all images, switch to the target image
                                            const targetLabel = projectData.currentImageLabel;
                                            console.log(`[Pre-Load] Pre-loading complete. Switching to final image: ${targetLabel}`);
                                            
                                            // Ensure all saved scales are applied to each image
                                            for (const label of projectData.imageLabels) {
                                                if (projectData.imageScales && projectData.imageScales[label] !== undefined) {
                                                    // Ensure scale is applied to each image
                                                    window.imageScaleByLabel[label] = projectData.imageScales[label];
                                                    console.log(`[Pre-Load] Applied saved scale ${projectData.imageScales[label]} to ${label}`);
                                                }
                                            }
                                            
                                            // Now switch to the target image with the correct scale
                                            if (typeof window.switchToImage === 'function') {
                                                window.switchToImage(targetLabel);
                                                
                                                // Apply the saved scale explicitly and redraw
                                                if (projectData.imageScales && projectData.imageScales[targetLabel] !== undefined) {
                                                    const savedScale = projectData.imageScales[targetLabel];
                                                    console.log(`[Pre-Load] Ensuring correct scale ${savedScale} for ${targetLabel} after switch`);
                                                    
                                                    // Force a redraw with the saved scale
                                        if (typeof window.redrawCanvasWithVisibility === 'function') {
                                            window.redrawCanvasWithVisibility();
                                                    }
                                                    
                                                    // Update the scale UI to show the correct value
                                                    if (typeof window.updateScaleUI === 'function') {
                                                        window.updateScaleUI();
                                                    }
                                                }
                                            } else {
                                                console.error('[Pre-Load] switchToImage function not found!');
                                            }
                                            
                                            // *** DELAYED: Re-populate sidebar after everything else is done (Diagnostic) ***
                                            setTimeout(() => {
                                                console.log('[Load Project] Re-populating sidebar (delayed)...');
                                                const imageList = document.getElementById('imageList');
                                                if (imageList) {
                                                    imageList.innerHTML = ''; // Clear existing items first
                                                    for (const label of projectData.imageLabels) {
                                                        const imageUrl = window.originalImages[label];
                                                        if (imageUrl && typeof window.addImageToSidebar === 'function') {
                                                            console.log(`[Load Project] Re-adding ${label} to sidebar (delayed).`);
                                                            window.addImageToSidebar(imageUrl, label);
                                                        } else {
                                                            console.log(`[Load Project] Skipping re-add for ${label} - no URL or function (delayed).`);
                                                        }
                                                    }
                                                    // Ensure the active class is set correctly after re-adding
                                                    if (typeof window.updateActiveImageInSidebar === 'function') {
                                                        window.updateActiveImageInSidebar(); 
                                                    }
                                        } else {
                                                    console.warn('[Load Project] Could not find #imageList to re-populate (delayed).');
                                                }
                                                
                                                // Finally, clear the loading flag AFTER the delayed sidebar update
                                                window.isLoadingProject = false;
                                                console.log('[Load Project] Set isLoadingProject = false (End of Delayed Sidebar Update)');
                                            }, 100); // 100ms delay
                                            // *** END Delayed Re-populate sidebar ***
                                            
                                            // NOTE: isLoadingProject is now cleared inside the setTimeout
                                            // window.isLoadingProject = false;
                                            // console.log('[Load Project] Set isLoadingProject = false (End of Pre-load)');
                                        };

                                        // Start the asynchronous pre-loading process
                                        forceLoadImages(); 
                                        // NOTE: We no longer set isLoadingProject = false immediately here.
                                        // It's set inside forceLoadImages after the final switch.
                                        
                                        /* // OLD TIMEOUT LOGIC - Removed
                                        // Start force loading images after a short delay
                                        setTimeout(forceLoadImages, 500);

                                        // *** CLEAR LOADING FLAG (Success Path) ***
                                        window.isLoadingProject = false;
                                        console.log('[Load Project] Set isLoadingProject = false (Success)');
                                        */

                                    } catch (error) {
                                        console.error('Error updating UI after project load:', error);
                                        showStatusMessage(`Error loading project: ${error.message}`, 'error');
                                        // Make sure flag is false even on error
                                        window.isLoadingProject = false;
                                        console.log('[Load Project] Set isLoadingProject = false (UI Update Error)');
                                    }
                                }, 200); // Timeout for UI updates
                            }); // End of Promise.all().then()
                    }) // End of projectJsonFile.async().then()
                    .catch(err => {
                        // *** CLEAR LOADING FLAG (Catch Block) ***
                        window.isLoadingProject = false;
                        console.log('[Load Project] Set isLoadingProject = false (Catch Block)');

                        // Remove loading indicator
                        if (loadingIndicator.parentNode) {
                            loadingIndicator.parentNode.removeChild(loadingIndicator);
                        }
                        
                        console.error('Error loading project from ZIP:', err);
                        showStatusMessage(`Error loading project: ${err.message}`, 'error');
                    });
            };
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
});