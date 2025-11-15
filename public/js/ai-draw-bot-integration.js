/**
 * AI Draw Bot Integration for OpenPaint
 * Adds UI controls and integrates AI drawing suggestions into the paint application
 */

console.log('[AI Draw Bot Integration] Script file loaded');

(function() {
    'use strict';
    
    console.log('[AI Draw Bot Integration] IIFE executing...');

    // Wait for paint.js to be fully loaded
    function initAIDrawBotIntegration() {
        if (typeof window.aiDrawBot === 'undefined') {
            console.warn('[AI Draw Bot Integration] aiDrawBot not loaded, retrying...');
            setTimeout(initAIDrawBotIntegration, 100);
            return;
        }

        console.log('[AI Draw Bot Integration] Initializing AI Draw Bot integration...');

        // State for current suggestions
        let currentSuggestion = null;
        let ghostStrokeInterval = null;

        // Measurement codes (can be expanded)
        const measurementCodes = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'];
        
        // Viewpoint options
        const viewpointOptions = [
            'front-center',
            'front-arm',
            'side-arm',
            'back-view',
            'round-arm',
            'square-arm',
            'high-back',
            'short-back'
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

            // Viewpoint selector
            const viewpointGroup = document.createElement('div');
            viewpointGroup.className = 'mb-3';
            viewpointGroup.innerHTML = `
                <label class="block text-xs font-medium text-gray-700 mb-1">Viewpoint</label>
                <select id="aiViewpointSelect" class="w-full px-2 py-1 text-sm border border-gray-300 rounded">
                    <option value="">Select viewpoint...</option>
                    ${viewpointOptions.map(v => `<option value="${v}">${v}</option>`).join('')}
                </select>
                <button id="aiClassifyBtn" class="mt-1 w-full px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">
                    Auto-Classify Image
                </button>
            `;
            panel.appendChild(viewpointGroup);

            // Measurement code selector
            const measurementGroup = document.createElement('div');
            measurementGroup.className = 'mb-3';
            measurementGroup.innerHTML = `
                <label class="block text-xs font-medium text-gray-700 mb-1">Measurement Code</label>
                <select id="aiMeasurementSelect" class="w-full px-2 py-1 text-sm border border-gray-300 rounded">
                    <option value="">Select code...</option>
                    ${measurementCodes.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
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

            // Update suggestion button state
            const viewpointSelect = document.getElementById('aiViewpointSelect');
            const measurementSelect = document.getElementById('aiMeasurementSelect');
            
            function updateSuggestionButtonState() {
                const btn = document.getElementById('aiGetSuggestionBtn');
                const hasViewpoint = viewpointSelect.value !== '';
                const hasMeasurement = measurementSelect.value !== '';
                btn.disabled = !(hasViewpoint && hasMeasurement);
            }

            viewpointSelect.addEventListener('change', updateSuggestionButtonState);
            measurementSelect.addEventListener('change', updateSuggestionButtonState);

            // Load saved viewpoint if available
            if (window.currentImageLabel && window.imageTags && window.imageTags[window.currentImageLabel]) {
                const tags = window.imageTags[window.currentImageLabel];
                if (tags.viewpoint) {
                    viewpointSelect.value = tags.viewpoint;
                }
            }
        }

        /**
         * Create toggle button to show/hide AI panel
         */
        function createAIToggleButton() {
            // Check if button already exists
            if (document.getElementById('aiDrawBotToggle')) {
                return;
            }

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
        }

        /**
         * Classify the current image
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
                
                // Update viewpoint selector
                const viewpointSelect = document.getElementById('aiViewpointSelect');
                if (result.viewpoint && viewpointOptions.includes(result.viewpoint)) {
                    viewpointSelect.value = result.viewpoint;
                } else if (result.tags && result.tags.length > 0) {
                    // Try to match first tag
                    const matchedTag = result.tags.find(t => viewpointOptions.includes(t));
                    if (matchedTag) {
                        viewpointSelect.value = matchedTag;
                    }
                }

                statusEl.textContent = `Classified: ${result.viewpoint || result.tags.join(', ')} (${(result.confidence * 100).toFixed(0)}% confidence)`;
                updateTagsDisplay();
            } catch (error) {
                console.error('[AI Integration] Classification error:', error);
                statusEl.textContent = `Error: ${error.message}`;
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

            const viewpoint = viewpointSelect.value;
            const measurementCode = measurementSelect.value;

            if (!viewpoint || !measurementCode) {
                alert('Please select both viewpoint and measurement code');
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

            // Stop ghost rendering
            dismissSuggestion();

            // Accept the suggestion
            window.aiDrawBot.acceptSuggestion(
                currentSuggestion.points,
                currentSuggestion.width,
                imageLabel,
                measurementCode
            );

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

        // Initialize UI
        createAIToggleButton();

        // Update tags display when image changes
        if (typeof window.switchToImage === 'function') {
            const originalSwitchToImage = window.switchToImage;
            window.switchToImage = function(...args) {
                originalSwitchToImage.apply(this, args);
                setTimeout(() => {
                    updateTagsDisplay();
                    // Update viewpoint selector if tags exist
                    const imageLabel = window.currentImageLabel;
                    if (imageLabel && window.imageTags && window.imageTags[imageLabel]) {
                        const tags = window.imageTags[imageLabel];
                        const viewpointSelect = document.getElementById('aiViewpointSelect');
                        if (viewpointSelect && tags.viewpoint) {
                            viewpointSelect.value = tags.viewpoint;
                        }
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

