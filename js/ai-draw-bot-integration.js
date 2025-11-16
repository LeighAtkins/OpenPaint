/**
 * AI Draw Bot Integration for OpenPaint
 * Adds UI controls and integrates AI drawing suggestions into the paint application
 */

console.log('[AI Draw Bot Integration] Script file loaded');

(function() {
    'use strict';
    
    console.log('[AI Draw Bot Integration] IIFE executing...');
    console.log('[AI Draw Bot Integration] Checking for aiDrawBot:', typeof window.aiDrawBot);

    // Wait for aiDrawBot to be ready (event-based initialization)
    function initAIDrawBotIntegration() {
        // Check if aiDrawBot is already available
        if (typeof window.aiDrawBot !== 'undefined') {
            console.log('[AI Draw Bot Integration] aiDrawBot already available, initializing...');
            initializeIntegration();
            return;
        }
        
        console.log('[AI Draw Bot Integration] aiDrawBot not found, setting up event listener...');

        // Listen for the ready event
        console.log('[AI Draw Bot Integration] Waiting for aiDrawBotReady event...');
        window.addEventListener('aiDrawBotReady', function onReady() {
            console.log('[AI Draw Bot Integration] Received aiDrawBotReady event');
            window.removeEventListener('aiDrawBotReady', onReady);
            if (typeof window.aiDrawBot !== 'undefined') {
                initializeIntegration();
            } else {
                console.error('[AI Draw Bot Integration] Event received but aiDrawBot still undefined');
                // Fallback to polling
                setTimeout(initAIDrawBotIntegration, 100);
            }
        }, { once: true });

        // Fallback: if event doesn't fire within 5 seconds, try polling
        setTimeout(() => {
            if (typeof window.aiDrawBot === 'undefined') {
                console.warn('[AI Draw Bot Integration] aiDrawBotReady event not received, falling back to polling...');
                let attempts = 0;
                const maxAttempts = 50; // 5 seconds total
                const pollInterval = setInterval(() => {
                    attempts++;
                    if (typeof window.aiDrawBot !== 'undefined') {
                        clearInterval(pollInterval);
                        initializeIntegration();
                    } else if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                        console.error('[AI Draw Bot Integration] aiDrawBot failed to load after polling');
                    }
                }, 100);
            }
        }, 1000);
    }

    // Actual initialization logic
    function initializeIntegration() {
        if (typeof window.aiDrawBot === 'undefined') {
            console.error('[AI Draw Bot Integration] Cannot initialize: aiDrawBot is undefined');
            return;
        }

        console.log('[AI Draw Bot Integration] Initializing AI Draw Bot integration...');

        // State for current suggestions
        let currentSuggestion = null;
        let ghostStrokeInterval = null;

        // Measurement codes (can be expanded)
        const measurementCodes = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'];
        
        // Viewpoint options (camera angles only - back styles are in facets.json)
        const viewpointOptions = [
            'front-center',
            'front-arm',
            'side-arm',
            'back-view',
            'round-arm',
            'square-arm',
            'top',
            '3/4'
        ];

        /**
         * Create AI controls panel
         */
        function createAIControlsPanel() {
            // Check if panel already exists
            if (document.getElementById('aiDrawBotPanel')) {
                return;
            }

            const panel = document.createElement('div');
            panel.id = 'aiDrawBotPanel';
            panel.className = 'fixed top-20 right-4 bg-white border border-gray-300 rounded-lg shadow-lg p-4 z-50';
            panel.style.cssText = 'min-width: 280px; max-width: 320px; display: none;';

            // Panel header
            const header = document.createElement('div');
            header.className = 'flex items-center justify-between mb-3';
            header.innerHTML = `
                <h3 class="text-sm font-semibold text-gray-800">AI Drawing Assistant</h3>
                <button id="aiPanelClose" class="text-gray-500 hover:text-gray-700">×</button>
            `;
            panel.appendChild(header);

            // Viewpoint selector (freeform input with datalist)
            const viewpointGroup = document.createElement('div');
            viewpointGroup.className = 'mb-3';
            const viewpointDatalistId = 'aiViewpointOptions';
            viewpointGroup.innerHTML = `
                <label class="block text-xs font-medium text-gray-700 mb-1">Viewpoint</label>
                <input type="text" id="aiViewpointSelect" list="${viewpointDatalistId}" 
                       class="w-full px-2 py-1 text-sm border border-gray-300 rounded" 
                       placeholder="Type or select viewpoint...">
                <datalist id="${viewpointDatalistId}">
                    ${viewpointOptions.map(v => `<option value="${v}">${v}</option>`).join('')}
                </datalist>
                <button id="aiClassifyBtn" class="mt-1 w-full px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">
                    Auto-Classify Image
                </button>
            `;
            panel.appendChild(viewpointGroup);

            // Measurement code selector (freeform input with datalist)
            const measurementGroup = document.createElement('div');
            measurementGroup.className = 'mb-3';
            const measurementDatalistId = 'aiMeasurementOptions';
            // Add common measurement codes to datalist
            const commonCodes = [...measurementCodes, 'A', 'B', 'C', 'D', 'E', 'F', 'F1', 'F2', 'F3', 'F4'];
            measurementGroup.innerHTML = `
                <label class="block text-xs font-medium text-gray-700 mb-1">Measurement Code</label>
                <input type="text" id="aiMeasurementSelect" list="${measurementDatalistId}" 
                       class="w-full px-2 py-1 text-sm border border-gray-300 rounded" 
                       placeholder="Type or select code (e.g., A1, A2, B, F1)...">
                <datalist id="${measurementDatalistId}">
                    ${commonCodes.map(c => `<option value="${c}">${c}</option>`).join('')}
                </datalist>
            `;
            panel.appendChild(measurementGroup);

            // Suggestion controls
            const suggestionGroup = document.createElement('div');
            suggestionGroup.className = 'mb-3';
            suggestionGroup.innerHTML = `
                <button id="aiGetSuggestionBtn" class="w-full px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 mb-2" disabled>
                    Get Suggestion
                </button>
                <div id="aiSuggestionStatus" class="text-xs text-gray-600 mb-2"></div>
                <div class="flex gap-2">
                    <button id="aiAcceptBtn" class="flex-1 px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600" disabled>
                        Accept
                    </button>
                    <button id="aiDismissBtn" class="flex-1 px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600" disabled>
                        Dismiss
                    </button>
                </div>
            `;
            panel.appendChild(suggestionGroup);

            // Current tags display
            const tagsDisplay = document.createElement('div');
            tagsDisplay.id = 'aiTagsDisplay';
            tagsDisplay.className = 'text-xs text-gray-600 mt-3 pt-3 border-t border-gray-200';
            panel.appendChild(tagsDisplay);

            // Feedback sync section
            const feedbackGroup = document.createElement('div');
            feedbackGroup.className = 'mt-3 pt-3 border-t border-gray-200';
            feedbackGroup.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                    <label class="text-xs font-medium text-gray-700">AI Learning</label>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="aiFeedbackEnabled" class="sr-only peer" checked>
                        <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
                    </label>
                </div>
                <div id="aiFeedbackStatus" class="text-xs text-gray-500 mb-2">Ready to learn</div>
                <button id="aiSyncFeedbackBtn" class="w-full px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600">
                    Sync Feedback Now
                </button>
            `;
            panel.appendChild(feedbackGroup);

            document.body.appendChild(panel);

            // Event listeners
            document.getElementById('aiPanelClose').addEventListener('click', () => {
                panel.style.display = 'none';
                dismissSuggestion();
            });

            document.getElementById('aiClassifyBtn').addEventListener('click', classifyCurrentImage);
            document.getElementById('aiGetSuggestionBtn').addEventListener('click', getSuggestion);
            document.getElementById('aiAcceptBtn').addEventListener('click', acceptSuggestion);
            document.getElementById('aiDismissBtn').addEventListener('click', dismissSuggestion);
            document.getElementById('aiSyncFeedbackBtn').addEventListener('click', syncFeedback);

            // Update suggestion button state
            const viewpointSelect = document.getElementById('aiViewpointSelect');
            const measurementSelect = document.getElementById('aiMeasurementSelect');
            
            function updateSuggestionButtonState() {
                const btn = document.getElementById('aiGetSuggestionBtn');
                const hasViewpoint = viewpointSelect.value !== '';
                const hasMeasurement = measurementSelect.value !== '';
                btn.disabled = !(hasViewpoint && hasMeasurement);
            }

            // Use 'input' event for text inputs (fires on typing), 'change' for when focus leaves
            viewpointSelect.addEventListener('input', function() {
                updateSuggestionButtonState();
            });
            viewpointSelect.addEventListener('change', function() {
                updateSuggestionButtonState();
                // Save viewpoint to imageTags when changed (dedupe logs)
                const imageLabel = window.currentImageLabel;
                if (imageLabel && viewpointSelect.value.trim()) {
                    if (!window.imageTags) window.imageTags = {};
                    if (!window.imageTags[imageLabel]) window.imageTags[imageLabel] = {};
                    const newViewpoint = viewpointSelect.value.trim();
                    // Only log if value actually changed
                    if (window.imageTags[imageLabel].viewpoint !== newViewpoint) {
                        window.imageTags[imageLabel].viewpoint = newViewpoint;
                        console.log('[AI Integration] Saved viewpoint:', {
                            imageLabel: imageLabel,
                            viewpoint: newViewpoint
                        });
                    }
                }
            });
            measurementSelect.addEventListener('input', updateSuggestionButtonState);
            measurementSelect.addEventListener('change', updateSuggestionButtonState);

            // Load saved viewpoint if available and auto-classify on image switch
            function loadViewpointForCurrentImage() {
                if (window.currentImageLabel && window.imageTags && window.imageTags[window.currentImageLabel]) {
                    const tags = window.imageTags[window.currentImageLabel];
                    if (tags.viewpoint && viewpointOptions.includes(tags.viewpoint)) {
                        viewpointSelect.value = tags.viewpoint;
                        viewpointSelect.dispatchEvent(new Event('change'));
                        
                        // Auto-predict measurements if viewpoint is set
                        if (tags.viewpoint) {
                            setTimeout(() => {
                                predictMeasurementsForViewpoint(tags.viewpoint);
                            }, 300);
                        }
                    }
                }
            }
            
            // Load on panel creation
            loadViewpointForCurrentImage();
            
            // Also load when image changes (hooked into switchToImage below)
        }

        /**
         * Create toggle button to show/hide AI panel
         */
        function createAIToggleButton() {
            // Check if button already exists
            if (document.getElementById('aiDrawBotToggle')) {
                console.log('[AI Draw Bot Integration] Toggle button already exists, skipping creation');
                return;
            }

            console.log('[AI Draw Bot Integration] Creating AI Assistant toggle button...');
            const btn = document.createElement('button');
            btn.id = 'aiDrawBotToggle';
            btn.className = 'px-3 py-1 text-sm bg-indigo-500 text-white rounded hover:bg-indigo-600';
            btn.textContent = 'AI Assistant';
            btn.style.cssText = 'position: fixed; top: 80px; right: 4px; z-index: 50;';
            
            btn.addEventListener('click', () => {
                const panel = document.getElementById('aiDrawBotPanel');
                if (panel) {
                    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                    updateTagsDisplay();
                } else {
                    createAIControlsPanel();
                    const newPanel = document.getElementById('aiDrawBotPanel');
                    if (newPanel) newPanel.style.display = 'block';
                    updateTagsDisplay();
                }
            });

            document.body.appendChild(btn);
            console.log('[AI Draw Bot Integration] Toggle button created and appended to body:', btn.id);
        }

        /**
         * Classify the current image and auto-set viewpoint
         */
        async function classifyCurrentImage() {
            const imageLabel = window.currentImageLabel;
            if (!imageLabel || !window.originalImages || !window.originalImages[imageLabel]) {
                alert('No image selected');
                return;
            }

            const imageUrl = window.originalImages[imageLabel];
            const statusEl = document.getElementById('aiSuggestionStatus');
            statusEl.textContent = 'Classifying...';

            try {
                const result = await window.aiDrawBot.classifyImage(imageUrl, imageLabel);
                
                // Auto-set viewpoint selector based on classification result
                const viewpointSelect = document.getElementById('aiViewpointSelect');
                // Accept any viewpoint from result, or try to find one in tags
                const selectedViewpoint = result.viewpoint 
                    ? result.viewpoint 
                    : (result.tags && result.tags.length > 0 
                        ? result.tags.find(t => t && t.trim()) 
                        : null);
                
                if (selectedViewpoint) {
                    // Normalize viewpoint before saving (dedupe front/front-center)
                    const normalizedViewpoint = window.aiDrawBot?.normalizeViewpoint?.(selectedViewpoint) || selectedViewpoint;
                    viewpointSelect.value = normalizedViewpoint;
                    
                    // Save to imageTags (only once, avoid duplicate logs)
                    if (imageLabel) {
                        if (!window.imageTags) window.imageTags = {};
                        if (!window.imageTags[imageLabel]) window.imageTags[imageLabel] = {};
                        // Only log if value actually changed (dedupe)
                        const currentViewpoint = window.imageTags[imageLabel].viewpoint;
                        if (currentViewpoint !== normalizedViewpoint) {
                            window.imageTags[imageLabel].viewpoint = normalizedViewpoint;
                            console.log('[AI Integration] Saved viewpoint from classification:', {
                                imageLabel: imageLabel,
                                viewpoint: normalizedViewpoint
                            });
                        }
                    }
                    // Trigger input and change events to update UI state
                    viewpointSelect.dispatchEvent(new Event('input'));
                    viewpointSelect.dispatchEvent(new Event('change'));
                }

                // Prefill name box with classification result if empty
                const nameBox = document.getElementById('currentImageNameBox');
                if (nameBox && !nameBox.value.trim()) {
                    // Build description from classification tags
                    const parts = [];
                    if (result.tags && result.tags.length > 0) {
                        parts.push(...result.tags.filter(t => !viewpointOptions.includes(t)));
                    }
                    if (selectedViewpoint) {
                        parts.push(selectedViewpoint.replace(/-/g, ' '));
                    }
                    if (parts.length > 0) {
                        const description = parts.join(' ').toLowerCase();
                        nameBox.value = description;
                        // Trigger input event to parse and show chips
                        nameBox.dispatchEvent(new Event('input'));
                    }
                }

                // Show confidence in status
                const confidencePercent = (result.confidence * 100).toFixed(0);
                statusEl.textContent = `Classified: ${result.viewpoint || result.tags.join(', ')} (${confidencePercent}% confidence)`;
                
                // Update tags display
                updateTagsDisplay();
                
                // If viewpoint was set, optionally trigger measurement prediction
                if (viewpointSelect.value) {
                    // Auto-predict measurements after a short delay
                    setTimeout(() => {
                        predictMeasurementsForViewpoint(viewpointSelect.value);
                    }, 500);
                }
            } catch (error) {
                console.error('[AI Integration] Classification error:', error);
                statusEl.textContent = `Error: ${error.message}`;
            }
        }

        /**
         * Predict measurements for a viewpoint and populate UI
         */
        async function predictMeasurementsForViewpoint(viewpoint) {
            const imageLabel = window.currentImageLabel;
            if (!imageLabel || !viewpoint) return;

            const statusEl = document.getElementById('aiSuggestionStatus');
            const canvas = document.getElementById('canvas');
            const viewport = {
                width: canvas ? canvas.width : 800,
                height: canvas ? canvas.height : 600
            };

            try {
                statusEl.textContent = 'Predicting measurements...';
                // Normalize viewpoint before calling predictMeasurements
                const normalizedViewpoint = window.aiDrawBot?.normalizeViewpoint?.(viewpoint) || viewpoint;
                
                // Get measurement code from input if available (worker requires it)
                const measurementSelect = document.getElementById('aiMeasurementSelect');
                const measurementCode = measurementSelect?.value?.trim() || null;
                
                const predictions = await window.aiDrawBot.predictMeasurements(
                    normalizedViewpoint, 
                    imageLabel, 
                    viewport,
                    measurementCode
                );
                
                if (predictions && predictions.length > 0) {
                    // Sort by confidence (highest first)
                    predictions.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
                    
                    // Update measurement selector with predicted codes
                    const measurementSelect = document.getElementById('aiMeasurementSelect');
                    const topPrediction = predictions[0];
                    
                    // Set the highest confidence measurement as default (accept any code, not just preset ones)
                    if (topPrediction.code) {
                        measurementSelect.value = topPrediction.code;
                        measurementSelect.dispatchEvent(new Event('change'));
                        
                        // Auto-render the top prediction as a ghost stroke
                        if (topPrediction.stroke && topPrediction.stroke.points) {
                            currentSuggestion = {
                                points: topPrediction.stroke.points,
                                width: topPrediction.stroke.width || 2,
                                confidence: topPrediction.confidence || 0.8,
                                measurementCode: topPrediction.code
                            };
                            
                            // Enable accept/dismiss buttons
                            document.getElementById('aiAcceptBtn').disabled = false;
                            document.getElementById('aiDismissBtn').disabled = false;
                            
                            // Start rendering ghost stroke
                            startGhostStrokeRendering(currentSuggestion);
                            
                            statusEl.textContent = `Predicted: ${topPrediction.code} (${((topPrediction.confidence || 0) * 100).toFixed(0)}% confidence)`;
                        } else {
                            statusEl.textContent = `Predicted: ${predictions.map(p => p.code).join(', ')}`;
                        }
                    } else {
                        statusEl.textContent = `Found ${predictions.length} prediction(s)`;
                    }
                } else {
                    statusEl.textContent = 'No predictions available';
                }
            } catch (error) {
                console.error('[AI Integration] Prediction error:', error);
                statusEl.textContent = `Prediction error: ${error.message}`;
            }
        }

        /**
         * Get stroke suggestion
         */
        async function getSuggestion() {
            const imageLabel = window.currentImageLabel;
            const viewpointSelect = document.getElementById('aiViewpointSelect');
            const measurementSelect = document.getElementById('aiMeasurementSelect');
            const statusEl = document.getElementById('aiSuggestionStatus');

            const viewpoint = viewpointSelect.value.trim();
            const measurementCode = measurementSelect.value.trim();

            if (!viewpoint || !measurementCode) {
                alert('Please enter both viewpoint and measurement code');
                return;
            }

            statusEl.textContent = 'Fetching suggestion...';

            try {
                const canvas = document.getElementById('canvas');
                const viewport = {
                    width: canvas ? canvas.width : 800,
                    height: canvas ? canvas.height : 600
                };

                const suggestion = await window.aiDrawBot.getStrokeSuggestion(
                    measurementCode,
                    viewpoint,
                    imageLabel,
                    viewport
                );

                if (!suggestion) {
                    statusEl.textContent = 'No suggestion found for this combination';
                    return;
                }

                currentSuggestion = suggestion;
                statusEl.textContent = `Suggestion ready (${(suggestion.confidence * 100).toFixed(0)}% confidence)`;

                // Enable accept/dismiss buttons
                document.getElementById('aiAcceptBtn').disabled = false;
                document.getElementById('aiDismissBtn').disabled = false;

                // Start rendering ghost stroke
                startGhostStrokeRendering(suggestion);
            } catch (error) {
                console.error('[AI Integration] Suggestion error:', error);
                statusEl.textContent = `Error: ${error.message}`;
            }
        }

        /**
         * Start rendering ghost stroke
         */
        function startGhostStrokeRendering(suggestion) {
            // Clear any existing interval
            if (ghostStrokeInterval) {
                clearInterval(ghostStrokeInterval);
            }

            // Render ghost stroke periodically
            ghostStrokeInterval = setInterval(() => {
                if (!currentSuggestion) {
                    clearInterval(ghostStrokeInterval);
                    return;
                }

                const canvas = document.getElementById('canvas');
                if (!canvas) return;

                const ctx = canvas.getContext('2d');
                const imageLabel = window.currentImageLabel;

                // Redraw canvas first (to clear previous ghost)
                if (typeof window.redrawCanvasWithVisibility === 'function') {
                    window.redrawCanvasWithVisibility(imageLabel);
                }

                // Render ghost stroke
                window.aiDrawBot.renderGhostStroke(
                    ctx,
                    currentSuggestion.points,
                    currentSuggestion.width,
                    imageLabel
                );
            }, 100); // Update every 100ms
        }

        /**
         * Accept the current suggestion
         */
        function acceptSuggestion() {
            if (!currentSuggestion) return;

            const imageLabel = window.currentImageLabel;
            const measurementSelect = document.getElementById('aiMeasurementSelect');
            const measurementCode = measurementSelect.value;
            const viewpointSelect = document.getElementById('aiViewpointSelect');
            const viewpoint = viewpointSelect.value;

            // Stop ghost rendering
            dismissSuggestion();

            // Accept the suggestion
            window.aiDrawBot.acceptSuggestion(
                currentSuggestion.points,
                currentSuggestion.width,
                imageLabel,
                measurementCode
            );

            // Queue feedback for accepted suggestion
            const feedbackEnabled = document.getElementById('aiFeedbackEnabled');
            if (window.aiDrawBot && window.aiDrawBot.queueFeedback && (!feedbackEnabled || feedbackEnabled.checked)) {
                const canvas = document.getElementById('canvas');
                window.aiDrawBot.queueFeedback({
                    imageLabel,
                    measurementCode,
                    viewpoint: viewpoint || (window.imageTags?.[imageLabel]?.viewpoint) || 'unknown',
                    stroke: {
                        points: currentSuggestion.points,
                        width: currentSuggestion.width
                    },
                    source: 'accepted',
                    meta: {
                        canvas: {
                            width: canvas?.width || 800,
                            height: canvas?.height || 600
                        },
                        confidence: currentSuggestion.confidence
                    }
                }).catch(err => {
                    console.warn('[AI Integration] Failed to queue feedback:', err);
                });
            }

            const statusEl = document.getElementById('aiSuggestionStatus');
            statusEl.textContent = 'Suggestion accepted!';

            // Clear suggestion
            currentSuggestion = null;
        }

        /**
         * Dismiss the current suggestion
         */
        function dismissSuggestion() {
            if (ghostStrokeInterval) {
                clearInterval(ghostStrokeInterval);
                ghostStrokeInterval = null;
            }

            currentSuggestion = null;

            // Redraw canvas to remove ghost
            const imageLabel = window.currentImageLabel;
            if (typeof window.redrawCanvasWithVisibility === 'function') {
                window.redrawCanvasWithVisibility(imageLabel);
            }

            // Disable buttons
            document.getElementById('aiAcceptBtn').disabled = true;
            document.getElementById('aiDismissBtn').disabled = true;

            const statusEl = document.getElementById('aiSuggestionStatus');
            if (statusEl) statusEl.textContent = '';
        }

        /**
         * Update tags display
         */
        function updateTagsDisplay() {
            const displayEl = document.getElementById('aiTagsDisplay');
            if (!displayEl) return;

            const imageLabel = window.currentImageLabel;
            if (!imageLabel || !window.imageTags || !window.imageTags[imageLabel]) {
                displayEl.textContent = 'No tags for current image';
                return;
            }

            const tags = window.imageTags[imageLabel];
            const parts = [];
            
            if (tags.viewpoint) parts.push(`Viewpoint: ${tags.viewpoint}`);
            if (tags.tags && tags.tags.length > 0) parts.push(`Tags: ${tags.tags.join(', ')}`);
            if (tags.confidence !== undefined) parts.push(`Confidence: ${(tags.confidence * 100).toFixed(0)}%`);

            displayEl.textContent = parts.length > 0 ? parts.join(' | ') : 'No classification data';
        }

        /**
         * Sync feedback queue
         */
        async function syncFeedback() {
            const statusEl = document.getElementById('aiFeedbackStatus');
            const syncBtn = document.getElementById('aiSyncFeedbackBtn');
            
            if (!window.aiDrawBot || !window.aiDrawBot.flushFeedbackQueue) {
                statusEl.textContent = 'AI Draw Bot not available';
                return;
            }

            syncBtn.disabled = true;
            syncBtn.textContent = 'Syncing...';
            statusEl.textContent = 'Sending feedback...';

            try {
                const result = await window.aiDrawBot.flushFeedbackQueue();
                console.log('[AI Integration] Sync result:', result);
                statusEl.textContent = `Sent: ${result.sent}, Failed: ${result.failed}, Remaining: ${result.remaining}`;
                
                if (result.sent > 0) {
                    statusEl.textContent = `✓ Sent ${result.sent} feedback item(s) successfully`;
                    setTimeout(() => {
                        statusEl.textContent = 'Ready to learn';
                    }, 3000);
                } else if (result.failed > 0) {
                    statusEl.textContent = `⚠ ${result.failed} failed, ${result.remaining} queued. Check console for details.`;
                } else if (result.remaining === 0) {
                    statusEl.textContent = 'No feedback to sync';
                }
            } catch (error) {
                console.error('[AI Integration] Sync error:', error);
                statusEl.textContent = `Error: ${error.message}`;
            } finally {
                syncBtn.disabled = false;
                syncBtn.textContent = 'Sync Feedback Now';
            }
        }

        /**
         * Update feedback status display
         */
        function updateFeedbackStatus() {
            const statusEl = document.getElementById('aiFeedbackStatus');
            if (!statusEl) return;

            const queueSize = window.aiFeedbackQueue?.length || 0;
            const enabled = document.getElementById('aiFeedbackEnabled')?.checked !== false;

            if (!enabled) {
                statusEl.textContent = 'Learning disabled';
                return;
            }

            if (queueSize === 0) {
                statusEl.textContent = 'Ready to learn';
            } else {
                statusEl.textContent = `${queueSize} feedback item(s) queued`;
            }
        }

        // Update feedback status periodically
        setInterval(updateFeedbackStatus, 5000);
        updateFeedbackStatus();

        // Initialize UI
        createAIToggleButton();

        // Update tags display when image changes and auto-classify
        if (typeof window.switchToImage === 'function') {
            const originalSwitchToImage = window.switchToImage;
            window.switchToImage = function(...args) {
                originalSwitchToImage.apply(this, args);
                setTimeout(() => {
                    updateTagsDisplay();
                    // Update viewpoint selector if tags exist
                    const imageLabel = window.currentImageLabel;
                    const viewpointSelect = document.getElementById('aiViewpointSelect');
                    
                    if (imageLabel && window.imageTags && window.imageTags[imageLabel]) {
                        const tags = window.imageTags[imageLabel];
                        if (viewpointSelect && tags.viewpoint) {
                            viewpointSelect.value = tags.viewpoint;
                            viewpointSelect.dispatchEvent(new Event('input'));
                            viewpointSelect.dispatchEvent(new Event('change'));
                            
                            // Auto-predict measurements for this viewpoint
                            if (tags.viewpoint) {
                                setTimeout(() => {
                                    predictMeasurementsForViewpoint(tags.viewpoint);
                                }, 300);
                            }
                        }
                    } else if (imageLabel && window.originalImages && window.originalImages[imageLabel]) {
                        // Clear any ghost stroke rendering when switching images
                        if (ghostStrokeInterval) {
                            clearInterval(ghostStrokeInterval);
                            ghostStrokeInterval = null;
                            currentSuggestion = null;
                        }
                        
                        // Auto-classify if no tags exist yet
                        setTimeout(() => {
                            classifyCurrentImage();
                        }, 500);
                    }
                }, 100);
            };
        }

        console.log('[AI Draw Bot Integration] Initialization complete');
    }

    // Start initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('[AI Draw Bot Integration] DOM loaded, starting initialization...');
            setTimeout(initAIDrawBotIntegration, 500);
        });
    } else {
        console.log('[AI Draw Bot Integration] DOM already ready, starting initialization...');
        setTimeout(initAIDrawBotIntegration, 500);
    }
})();

