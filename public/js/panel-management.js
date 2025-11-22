// Panel management - toggle and layout functionality
(function() {
    'use strict';

    // Toolbar expand/collapse functionality
    (function initToolbarToggle() {
        const toolbarWrap = document.querySelector('.toolbar-wrap');
        if (!toolbarWrap) return;

        function isMobileDevice() {
            return window.innerWidth <= 768;
        }

        // Track if we've shown the initial glow (only once per page load)
        let hasShownInitialGlow = false;
        let wasScrollable = false;
        let wasExpanded = false;

        // Check if toolbar is scrollable (can be expanded)
        function checkIfExpandable() {
            const isMobile = isMobileDevice();
            const isExpanded = toolbarWrap.classList.contains('expanded');


            if (!isMobile || isExpanded) {
                toolbarWrap.removeAttribute('data-scrollable');
                toolbarWrap.classList.remove('expandable');
                // Don't reset flags when expanded - preserve state for when collapsed
                if (!isMobile) {
                    hasShownInitialGlow = false;
                    wasScrollable = false;
                }
                wasExpanded = isExpanded;
                return;
            }

            // Check if content overflows
            const isScrollable = toolbarWrap.scrollWidth > toolbarWrap.clientWidth;
            const hadScrollable = toolbarWrap.hasAttribute('data-scrollable');


            // Set data attribute for CSS hover detection
            if (isScrollable) {
                toolbarWrap.setAttribute('data-scrollable', 'true');

                // Show glow once when transitioning from non-scrollable to scrollable
                // BUT only if we haven't shown it before AND we're not coming from expanded state
                const shouldShowGlow = !wasScrollable && !hasShownInitialGlow && !wasExpanded;

                if (shouldShowGlow) {
                    // Remove inline style to allow animation
                    toolbarWrap.style.removeProperty('box-shadow');
                    toolbarWrap.classList.add('expandable');
                    hasShownInitialGlow = true;

                    // Remove the class after animation completes and clear inline style
                    setTimeout(() => {
                        toolbarWrap.classList.remove('expandable');
                        // Clear inline style so hover can work
                        toolbarWrap.style.removeProperty('box-shadow');
                    }, 500);
                } else {
                    // Only clear inline style if not hovering and not animating
                    if (!toolbarWrap.matches(':hover') && !toolbarWrap.classList.contains('expanded') && !toolbarWrap.classList.contains('expandable') && !toolbarWrap.classList.contains('tapped')) {
                        toolbarWrap.style.removeProperty('box-shadow');
                    }
                }
            } else {
                toolbarWrap.removeAttribute('data-scrollable');
                toolbarWrap.classList.remove('expandable');
                // Reset glow flag when not scrollable (but preserve if we were expanded)
                if (!wasExpanded) {
                    hasShownInitialGlow = false;
                }
            }

            // Update previous state
            wasScrollable = isScrollable;
            wasExpanded = isExpanded;
        }

        // Initial check and periodic checks
        setTimeout(() => {
            checkIfExpandable();
        }, 500);

        // Only run periodic checks on mobile (where expand/collapse matters)
        const checkInterval = isMobileDevice() ? setInterval(() => {
            checkIfExpandable();
        }, 2000) : null;

        // Clean up interval if not needed
        if (!checkInterval && !isMobileDevice()) {
            // On desktop, only check once after initial setup
            setTimeout(() => {
                checkIfExpandable();
            }, 1000);
        }

        // Also check on scroll
        toolbarWrap.addEventListener('scroll', () => {
            clearTimeout(checkIfExpandable.timeout);
            checkIfExpandable.timeout = setTimeout(() => {
                checkIfExpandable();
            }, 300);
        });

        function handleToolbarTap(e) {
            if (!isMobileDevice()) {
                return;
            }

            // Only process if the event target is the toolbar or a child of the toolbar
            const target = e.target;
            if (!toolbarWrap.contains(target) && target !== toolbarWrap) {
                return; // Not a toolbar event, let it pass through
            }

            const rect = toolbarWrap.getBoundingClientRect();
            const tapY = e.clientY || (e.changedTouches && e.changedTouches[0]?.clientY) || 0;
            const tapX = e.clientX || (e.changedTouches && e.changedTouches[0]?.clientX) || 0;

            // Check if tap is in the bottom 12px of the toolbar
            const bottomThreshold = 12;
            const isBottomTap = tapY >= rect.bottom - bottomThreshold && tapY <= rect.bottom;

            // Also check if tap is on the toolbar itself (not on a button)
            const isToolbarArea = tapY >= rect.top && tapY <= rect.bottom &&
                                 tapX >= rect.left && tapX <= rect.right;

            // Don't toggle if clicking on a button or input
            const isInteractiveElement = target.tagName === 'BUTTON' ||
                                        target.tagName === 'INPUT' ||
                                        target.closest('button') ||
                                        target.closest('input') ||
                                        target.closest('.color-swatches');


            if (isBottomTap && isToolbarArea && !isInteractiveElement) {
                e.preventDefault();
                e.stopPropagation();

                const wasExpanded = toolbarWrap.classList.contains('expanded');

                // Add glow animation on tap
                toolbarWrap.classList.remove('tapped');
                // Remove inline style to allow animation
                toolbarWrap.style.removeProperty('box-shadow');
                void toolbarWrap.offsetWidth; // Force reflow
                toolbarWrap.classList.add('tapped');

                // Remove tapped class after animation and clear inline style
                setTimeout(() => {
                    toolbarWrap.classList.remove('tapped');
                    // Clear inline style so hover can work
                    toolbarWrap.style.removeProperty('box-shadow');
                }, 1000);

                toolbarWrap.classList.toggle('expanded');

                // Update topToolbar height
                const topToolbar = document.getElementById('topToolbar');
                if (topToolbar) {
                    if (toolbarWrap.classList.contains('expanded')) {
                        topToolbar.style.height = 'auto';
                        topToolbar.style.maxHeight = 'calc(5 * (32px + 6px) + 16px)'; // 5 rows + padding
                    } else {
                        topToolbar.style.height = '48px';
                        topToolbar.style.maxHeight = 'none';
                        // Remove animation classes and clear inline style
                        toolbarWrap.classList.remove('expandable', 'tapped');
                        // Add no-glow class to prevent hover glow from persisting
                        toolbarWrap.classList.add('no-glow');
                        // Temporarily remove data-scrollable to clear any hover glow
                        toolbarWrap.removeAttribute('data-scrollable');
                        toolbarWrap.style.removeProperty('box-shadow');
                        // Force clear any glow immediately
                        toolbarWrap.style.boxShadow = 'none';

                        // Check if mouse is already outside the toolbar (not hovering)
                        const isCurrentlyHovered = toolbarWrap.matches(':hover');

                        // If mouse is already outside, remove no-glow immediately
                        if (!isCurrentlyHovered) {
                            setTimeout(() => {
                                toolbarWrap.classList.remove('no-glow');
                            }, 100); // Small delay to ensure collapse animation completes
                        } else {
                            // Remove no-glow class when mouse leaves (to allow hover glow again)
                            const removeNoGlowOnLeave = () => {
                                if (toolbarWrap.classList.contains('no-glow')) {
                                    toolbarWrap.classList.remove('no-glow');
                                }
                            };
                            toolbarWrap.addEventListener('mouseleave', removeNoGlowOnLeave, { once: true });

                            // Also remove after a delay as fallback (for touch devices or if mouseleave doesn't fire)
                            setTimeout(() => {
                                if (toolbarWrap.classList.contains('no-glow')) {
                                    toolbarWrap.classList.remove('no-glow');
                                    toolbarWrap.removeEventListener('mouseleave', removeNoGlowOnLeave);
                                }
                            }, 1000);
                        }
                    }
                }

                // Recheck expandability after toggle
                setTimeout(() => {
                    // Double-check glow is cleared after collapse
                    if (!toolbarWrap.classList.contains('expanded')) {
                        toolbarWrap.style.boxShadow = 'none';
                        toolbarWrap.style.removeProperty('box-shadow');
                        // Don't remove data-scrollable if no-glow is active (it will prevent glow anyway)
                        if (!toolbarWrap.classList.contains('no-glow')) {
                            toolbarWrap.removeAttribute('data-scrollable');
                        }
                        // Force reflow to ensure CSS applies
                        void toolbarWrap.offsetWidth;
                    }
                    checkIfExpandable();
                }, 150);
            }
        }

        // Add event listeners for both click and touch
        toolbarWrap.addEventListener('click', handleToolbarTap);
        toolbarWrap.addEventListener('touchend', handleToolbarTap);

        // Handle window resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (!isMobileDevice() && toolbarWrap.classList.contains('expanded')) {
                    toolbarWrap.classList.remove('expanded');
                    const topToolbar = document.getElementById('topToolbar');
                    if (topToolbar) {
                        topToolbar.style.height = '48px';
                        topToolbar.style.maxHeight = 'none';
                    }
                }
                checkIfExpandable();
            }, 150);
        });

        // Cleanup interval on page unload
        window.addEventListener('beforeunload', () => {
            clearInterval(checkInterval);
        });
    })();

    // Enhanced panel toggle functionality with minimize-to-header behavior
    function createPanelToggle(panelId, contentId, buttonId) {
        const panel = document.getElementById(panelId);
        const content = document.getElementById(contentId);
        const button = document.getElementById(buttonId);
        const icon = button?.querySelector('svg');

        if (!panel || !content || !button || !icon) return;

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            // Use the specified content element
            const body = content;
            const isMinimized = body.classList.contains('hidden');

            // Special handling for imagePanel: ensure navigation container stays visible
            if (panelId === 'imagePanel') {
                const navContainer = document.getElementById('navigation-container');
                const miniStepper = document.getElementById('mini-stepper');
                if (navContainer) {
                    // Explicitly ensure navigation container stays visible
                    navContainer.style.display = 'block';
                    navContainer.style.visibility = 'visible';
                    navContainer.style.opacity = '1';
                    navContainer.style.pointerEvents = 'auto';
                }
                if (miniStepper) {
                    miniStepper.style.display = 'flex';
                    miniStepper.style.visibility = 'visible';
                    miniStepper.style.opacity = '1';
                    miniStepper.style.pointerEvents = 'auto';
                }
            }

            if (isMinimized) {
                // Expand panel
                // starting from hidden (max-height:0), set explicit height to animate open
                body.classList.remove('hidden');
                body.style.maxHeight = body.scrollHeight + 'px';
                // after transition completes, allow natural growth
                const onEnd = () => {
                    body.style.maxHeight = 'none';
                    body.removeEventListener('transitionend', onEnd);
                };
                body.addEventListener('transitionend', onEnd);
                icon.style.transform = 'rotate(0deg)';
                panel.classList.remove('minimized');
                panel.setAttribute('aria-expanded', 'true');
            } else {
                // Minimize panel
                // if maxHeight is none (auto), set current height to enable smooth collapse
                if (!body.style.maxHeight || body.style.maxHeight === 'none') {
                    body.style.maxHeight = body.scrollHeight + 'px';
                    // force reflow
                    void body.offsetHeight;
                }
                // add hidden to animate to max-height:0 via CSS
                body.classList.add('hidden');
                icon.style.transform = 'rotate(-90deg)';
                panel.classList.add('minimized');
                panel.setAttribute('aria-expanded', 'false');

                // For imagePanel, ensure navigation stays visible after collapse
                if (panelId === 'imagePanel') {
                    const navContainer = document.getElementById('navigation-container');
                    const miniStepper = document.getElementById('mini-stepper');
                    if (navContainer) {
                        navContainer.style.display = 'block';
                        navContainer.style.visibility = 'visible';
                        navContainer.style.opacity = '1';
                    }
                    if (miniStepper) {
                        miniStepper.style.display = 'flex';
                        miniStepper.style.visibility = 'visible';
                        miniStepper.style.opacity = '1';
                    }
                }
            }
        });
    }

    // Mobile panel toggle icons functionality
    function isMobileDevice() {
        return window.innerWidth <= 768;
    }

    function initializePanelToggleIcons() {
        const strokePanel = document.getElementById('strokePanel');
        const imagePanel = document.getElementById('imagePanel');
        const strokeIcon = document.getElementById('strokePanelIcon');
        const imageIcon = document.getElementById('imagePanelIcon');

        if (!strokePanel || !imagePanel || !strokeIcon || !imageIcon) {
            console.warn('Panel toggle icons or panels not found');
            return;
        }

        // Initialize panel states - start minimized on mobile, expanded on desktop
        const isMobile = isMobileDevice();
        if (!strokePanel.getAttribute('data-mobile-state')) {
            strokePanel.setAttribute('data-mobile-state', isMobile ? 'minimized' : 'expanded');
        }
        if (!imagePanel.getAttribute('data-mobile-state')) {
            imagePanel.setAttribute('data-mobile-state', isMobile ? 'minimized' : 'expanded');
        }

        // Sync icon visual state with panel state
        function syncIconState(panel, icon) {
            icon.classList.remove('minimized', 'expanded');
            panel.classList.remove('minimized', 'expanded');

            const isOpen = panel.getAttribute('data-mobile-state') === 'expanded';
            if (isOpen) {
                icon.classList.add('expanded');
                panel.classList.add('expanded');
                panel.style.display = 'flex';
                // Ensure panel content is visible
                const contentId = panel.id === 'strokePanel' ? 'elementsBody' : 'imagePanelContent';
                const content = document.getElementById(contentId);
                if (content) {
                    content.classList.remove('hidden');
                    content.style.maxHeight = 'none';
                }
            } else {
                icon.classList.add('minimized');
                panel.classList.add('minimized');
                // On mobile, hide the panel when minimized
                if (isMobileDevice()) {
                    panel.style.display = 'none';
                }
            }
        }

        // Toggle panel on icon click
        function setupIconToggle(panel, icon) {
            icon.addEventListener('click', (e) => {
                if (!isMobileDevice()) return;
                e.stopPropagation();

                const isCurrentlyOpen = panel.getAttribute('data-mobile-state') === 'expanded';
                panel.setAttribute('data-mobile-state', isCurrentlyOpen ? 'minimized' : 'expanded');
                syncIconState(panel, icon);
            });
        }

        // Show/hide icons and panels based on device type
        function updatePanelVisibility() {
            const isMobile = isMobileDevice();

            // On desktop, always show panels and ensure content is visible
            if (!isMobile) {
                strokePanel.style.display = 'flex';
                imagePanel.style.display = 'flex';
                // Hide icons on desktop
                strokeIcon.style.display = 'none';
                imageIcon.style.display = 'none';
                // Ensure content is visible on desktop
                const strokeContent = document.getElementById('elementsBody');
                const imageContent = document.getElementById('imagePanelContent');
                if (strokeContent) {
                    strokeContent.classList.remove('hidden');
                    strokeContent.style.maxHeight = 'none';
                }
                if (imageContent) {
                    imageContent.classList.remove('hidden');
                    imageContent.style.maxHeight = 'none';
                }
            } else {
                // On mobile, show icons with smooth fade-in
                strokeIcon.style.display = 'flex';
                imageIcon.style.display = 'flex';
                // Fade in icons smoothly
                requestAnimationFrame(() => {
                    strokeIcon.style.opacity = '1';
                    imageIcon.style.opacity = '1';
                });
                // Sync panel state with icons
                syncIconState(strokePanel, strokeIcon);
                syncIconState(imagePanel, imageIcon);
            }
        }

        // Initialize
        setupIconToggle(strokePanel, strokeIcon);
        setupIconToggle(imagePanel, imageIcon);
        updatePanelVisibility();

        // Update on window resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(updatePanelVisibility, 150);
        });
    }

    // Ensure Vectors and tags and Images are open by default on desktop, closed on mobile
    function expandPanelsByDefault() {
        function ensurePanelsExpanded() {
            const strokePanel = document.getElementById('strokePanel');
            const imagePanel = document.getElementById('imagePanel');
            const strokeContent = document.getElementById('elementsBody');
            const imageContent = document.getElementById('imagePanelContent');
            const isMobile = isMobileDevice();

            if (!strokePanel || !imagePanel) {
                return;
            }

            // On mobile: start minimized (closed), on desktop: start expanded (open)
            if (isMobile) {
                // Mobile: minimize panels by default
                strokePanel.classList.remove('expanded');
                strokePanel.classList.add('minimized');
                strokePanel.setAttribute('data-mobile-state', 'minimized');
                strokePanel.setAttribute('aria-expanded', 'false');
                strokePanel.style.display = 'none'; // Hide on mobile when minimized

                imagePanel.classList.remove('expanded');
                imagePanel.classList.add('minimized');
                imagePanel.setAttribute('data-mobile-state', 'minimized');
                imagePanel.setAttribute('aria-expanded', 'false');
                imagePanel.style.display = 'none'; // Hide on mobile when minimized

                // Hide content on mobile when minimized
                if (strokeContent) {
                    strokeContent.classList.add('hidden');
                }
                if (imageContent) {
                    imageContent.classList.add('hidden');
                }
            } else {
                // Desktop: expand panels by default
                strokePanel.classList.remove('minimized', 'expanded');
                strokePanel.setAttribute('data-mobile-state', 'expanded');
                strokePanel.setAttribute('aria-expanded', 'true');
                strokePanel.style.display = 'flex';

                imagePanel.classList.remove('minimized', 'expanded');
                imagePanel.setAttribute('data-mobile-state', 'expanded');
                imagePanel.setAttribute('aria-expanded', 'true');
                imagePanel.style.display = 'flex';

                // Aggressively ensure content is visible on desktop
                if (strokeContent) {
                    strokeContent.classList.remove('hidden');
                    strokeContent.style.maxHeight = 'none';
                    strokeContent.style.display = '';
                    strokeContent.style.visibility = '';
                    strokeContent.style.opacity = '';
                }
                if (imageContent) {
                    imageContent.classList.remove('hidden');
                    imageContent.style.maxHeight = 'none';
                    imageContent.style.display = '';
                    imageContent.style.visibility = '';
                    imageContent.style.opacity = '';
                }
            }

            // Mark panels as loaded to enable transitions after initial render
            strokePanel.setAttribute('data-loaded', 'true');
            imagePanel.setAttribute('data-loaded', 'true');
            if (strokeContent) strokeContent.setAttribute('data-loaded', 'true');
            if (imageContent) imageContent.setAttribute('data-loaded', 'true');
        }

        // Run immediately
        ensurePanelsExpanded();

        // Also run after a short delay to catch any late initialization
        setTimeout(ensurePanelsExpanded, 50);
        setTimeout(ensurePanelsExpanded, 200);
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Apply toggle functionality to all panels (default open for Stroke & Images)
            createPanelToggle('projectPanel', 'projectPanelContent', 'toggleProjectPanel');
            createPanelToggle('toolsPanel', 'toolsPanelContent', 'toggleToolsPanel');
            createPanelToggle('strokePanel', 'elementsBody', 'toggleStrokePanel');
            createPanelToggle('imagePanel', 'imagePanelContent', 'toggleImagePanel');
            createPanelToggle('canvasControls', 'canvasControlsContent', 'toggleCanvasControls');

            expandPanelsByDefault();

            // Initialize panel toggle icons after a short delay to ensure DOM is ready
            setTimeout(initializePanelToggleIcons, 100);
        });
    } else {
        createPanelToggle('projectPanel', 'projectPanelContent', 'toggleProjectPanel');
        createPanelToggle('toolsPanel', 'toolsPanelContent', 'toggleToolsPanel');
        createPanelToggle('strokePanel', 'elementsBody', 'toggleStrokePanel');
        createPanelToggle('imagePanel', 'imagePanelContent', 'toggleImagePanel');
        createPanelToggle('canvasControls', 'canvasControlsContent', 'toggleCanvasControls');

        expandPanelsByDefault();
        setTimeout(initializePanelToggleIcons, 100);
    }

    // Expose functions globally
    window.createPanelToggle = createPanelToggle;
})();
