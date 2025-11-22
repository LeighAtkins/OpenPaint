// Smart label system for responsive button text
(function() {
    'use strict';

    // Track previous state to prevent thrashing
    const compactStateCache = new Map();

    // Apply compact labels to containers based on overflow detection
    function applyCompactLabels(container) {
        if (!container) return;

        // Skip toolbar containers - they're handled by data-toolbar-mode
        if (container.closest('#topToolbar')) {
            return;
        }

        // Check if we're on desktop - never add compact class on desktop
        const isMobile = window.innerWidth <= 768;

        // Skip smart labels on desktop - always show full labels
        if (!isMobile) {
            container.classList.remove('compact');
            return;
        }

        // Simpler, more reliable overflow detection with hysteresis
        const containerWidth = container.clientWidth;
        const containerScrollWidth = container.scrollWidth;

        // Add 2px threshold to prevent rapid toggling near the boundary
        const threshold = 2;
        const needsCompact = containerScrollWidth > (containerWidth + threshold);
        const wasCompact = container.classList.contains('compact');
        const cachedState = compactStateCache.get(container);

        // Only toggle if state actually changed and difference is significant
        if (needsCompact !== wasCompact) {
            // Check if we're near the boundary - if so, keep current state to prevent thrashing
            const nearBoundary = Math.abs(containerScrollWidth - containerWidth) < threshold * 2;
            if (nearBoundary && cachedState === wasCompact) {
                // Near boundary and state hasn't changed - keep current state
                return;
            }

            // Update state
            if (needsCompact) {
                container.classList.add('compact');
            } else {
                container.classList.remove('compact');
            }
            compactStateCache.set(container, needsCompact);
        }
    }

    // Pre-calculate toolbar layout before making it visible
    // NOTE: Toolbar label sizing is now handled by data-toolbar-mode attribute
    // This function now only handles final layout stabilization
    function calculateInitialToolbarLayout() {
        const toolbarWrap = document.querySelector('.toolbar-wrap');
        if (!toolbarWrap) {
            return;
        }

        // Toolbar mode should already be set by the earlier script
        // Just ensure layout is stable

        // Force initial layout calculation to ensure all styles are applied
        void toolbarWrap.offsetWidth;

        // Final layout stabilization - force calculation on all toolbar elements
        const allButtons = toolbarWrap.querySelectorAll('button, input, select');
        allButtons.forEach(el => {
            void el.offsetWidth; // Force layout calculation
        });

        // One final layout calculation to ensure everything is stable
        void toolbarWrap.offsetWidth;

        // Toolbar-ready class should already be added (done earlier to prevent opacity transitions)
        // But ensure it's set here as well for consistency
        const topToolbar = document.getElementById('topToolbar');
        if (topToolbar && !topToolbar.classList.contains('toolbar-ready')) {
            topToolbar.classList.add('toolbar-ready');
        }
        if (!toolbarWrap.classList.contains('toolbar-ready')) {
            toolbarWrap.classList.add('toolbar-ready');
        }

        // After layout is stable, enable smooth transitions
        setTimeout(() => {
            if (topToolbar) {
                topToolbar.classList.add('toolbar-stable');
            }
            if (toolbarWrap) {
                toolbarWrap.classList.add('toolbar-stable');
            }
        }, 100);
    }

    // Smart label system initialization
    function initSmartLabels(skipInitialCheck = false) {
        // Helper to wrap button with smart label spans
        function wrapSmartLabel(buttonEl, longText, shortText) {
            if (!buttonEl || buttonEl.querySelector('.label-long')) return; // Already wrapped

            buttonEl.innerHTML = `<span class="label-long">${longText}</span><span class="label-short">${shortText}</span>`;
            buttonEl.setAttribute('title', longText);
            buttonEl.setAttribute('aria-label', longText);
        }

        // Setup ResizeObserver for each smart-label-scope container
        const containers = document.querySelectorAll('.smart-label-scope');
        const observers = new Map();

        // Flag to prevent ResizeObserver from firing during initial setup
        let isInitializing = !skipInitialCheck;
        const initStartTime = Date.now();

        containers.forEach(container => {
            let debounceTimer = null;
            let lastWidth = 0;
            let lastHeight = 0;
            let isProcessing = false; // Prevent concurrent processing

            const debouncedApply = (entries) => {
                // Skip if we're still initializing or already processing
                if (isInitializing || isProcessing) return;

                // Check if enough time has passed since initialization started
                const timeSinceInit = Date.now() - initStartTime;
                if (timeSinceInit < 800) return; // Wait 800ms before allowing ResizeObserver to fire

                // Check if size actually changed significantly (prevent micro-adjustments)
                const entry = entries && entries[0];
                if (entry) {
                    const { width, height } = entry.contentRect;
                    const widthDiff = Math.abs(width - lastWidth);
                    const heightDiff = Math.abs(height - lastHeight);

                    // Only process if change is significant (more than 2px to prevent micro-adjustments)
                    if (widthDiff < 2 && heightDiff < 2) {
                        return;
                    }

                    lastWidth = width;
                    lastHeight = height;
                }

                if (debounceTimer) clearTimeout(debounceTimer);
                isProcessing = true;
                debounceTimer = setTimeout(() => {
                    applyCompactLabels(container);
                    // Also check parent containers
                    const parent = container.closest('.smart-label-scope');
                    if (parent && parent !== container) {
                        applyCompactLabels(parent);
                    }
                    isProcessing = false;
                }, 200); // Increased debounce time to prevent rapid toggling
            };

            // STEP 4: Performance guardrails - Don't observe toolbar containers
            // Toolbar sizing is handled by data-toolbar-mode attribute, not ResizeObserver
            // This prevents flicker loops and performance issues
            const isToolbarContainer = container.closest('#topToolbar') !== null;

            if (isToolbarContainer) {
                // Skip ResizeObserver for toolbar - data-toolbar-mode handles sizing
                return; // Don't observe toolbar containers at all
            }

            // For non-toolbar containers, set up ResizeObserver normally
            const observer = new ResizeObserver(debouncedApply);
            observer.observe(container);
            observers.set(container, observer);

            // Store initial dimensions
            const rect = container.getBoundingClientRect();
            lastWidth = rect.width;
            lastHeight = rect.height;

            // Initial check with immediate execution (skip if already calculated)
            if (!skipInitialCheck) {
                applyCompactLabels(container);
            }
        });

        // Clear initialization flag after a longer delay to ensure everything is stable
        if (isInitializing) {
            setTimeout(() => {
                isInitializing = false;
            }, 1000); // Increased to 1 second
        }

        // Setup buttons that get created dynamically by toolbar initialization
        setTimeout(() => {
            // Load Project button (created by reparent)
            const loadBtn = document.getElementById('loadProject');
            if (loadBtn) {
                wrapSmartLabel(loadBtn, 'Load Project', 'Load');
            }

            // Save Project button (created dynamically)
            const saveBtn = document.getElementById('saveProjectTop');
            if (saveBtn) {
                wrapSmartLabel(saveBtn, 'Save Project', 'Save');
                // Make it visually distinct from bottom save button
                saveBtn.style.background = '#3b82f6'; // Blue instead of green
                saveBtn.style.borderColor = '#2563eb';
                saveBtn.style.fontWeight = '700';
                saveBtn.style.fontSize = '14px';
                saveBtn.style.padding = '8px 16px';
            }

            // Immediate check for all containers (skip if already calculated)
            if (!skipInitialCheck) {
                containers.forEach(container => {
                    applyCompactLabels(container);
                });

                // Additional check after a short delay to ensure everything is rendered
                setTimeout(() => {
                    containers.forEach(container => {
                        applyCompactLabels(container);
                    });
                }, 100);
            }
        }, 150);

        // Global function to update drawing mode toggle labels
        window.updateDrawingModeLabels = function(mode) {
            const toggle = document.getElementById('drawingModeToggle');
            if (!toggle) return;

            const longSpan = toggle.querySelector('.label-long');
            const shortSpan = toggle.querySelector('.label-short');

            if (mode === true || mode === 'freehand') {
                const longText = 'Freehand';
                const shortText = 'Free';
                if (longSpan) longSpan.textContent = longText;
                if (shortSpan) shortSpan.textContent = shortText;
                toggle.setAttribute('title', longText);
                toggle.setAttribute('aria-label', longText);
            } else if (mode === 'curved') {
                const longText = 'Curved Line';
                const shortText = 'Curved';
                if (longSpan) longSpan.textContent = longText;
                if (shortSpan) shortSpan.textContent = shortText;
                toggle.setAttribute('title', longText);
                toggle.setAttribute('aria-label', longText);
            } else {
                // Straight mode (false or 'straight')
                const longText = 'Straight Line';
                const shortText = 'Straight';
                if (longSpan) longSpan.textContent = longText;
                if (shortSpan) shortSpan.textContent = shortText;
                toggle.setAttribute('title', longText);
                toggle.setAttribute('aria-label', longText);
            }

            // Re-check container after label change
            const container = toggle.closest('.smart-label-scope');
            if (container) applyCompactLabels(container);
        };

        // Store observers for cleanup if needed
        window.smartLabelObservers = observers;
    }

    // Expose functions globally
    window.initSmartLabels = initSmartLabels;
    window.calculateInitialToolbarLayout = calculateInitialToolbarLayout;
    window.applyCompactLabels = applyCompactLabels;
})();
