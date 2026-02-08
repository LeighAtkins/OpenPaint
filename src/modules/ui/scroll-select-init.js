// Scroll-select and mini-stepper initialization
import { isImagePanelCollapsed } from './panel-state.js';

// Extracted from index.html inline scripts

export function initScrollSelectSystem() {
  function updateImageListPadding() {
    const imageList = document.getElementById('imageList');
    if (!imageList) return;

    const sampleContainer = imageList.querySelector('.image-container');
    if (!sampleContainer) {
      // Fall back to default padding if no samples
      imageList.style.paddingTop = 'calc(30vh - 5rem)';
      imageList.style.paddingBottom = 'calc(30vh - 5rem)';
      return;
    }

    const listHeight = imageList.getBoundingClientRect().height;
    const itemHeight = sampleContainer.getBoundingClientRect().height;

    if (!listHeight || !itemHeight) return;

    const padding = Math.max(0, listHeight / 2 - itemHeight / 2);

    imageList.style.paddingTop = `${padding}px`;
    imageList.style.paddingBottom = `${padding}px`;
  }
  window.updateImageListPadding = updateImageListPadding;

  let __imageListPaddingResizeTimeout = null;
  window.addEventListener('resize', () => {
    if (__imageListPaddingResizeTimeout) {
      clearTimeout(__imageListPaddingResizeTimeout);
    }
    __imageListPaddingResizeTimeout = setTimeout(() => {
      __imageListPaddingResizeTimeout = null;
      updateImageListPadding();
    }, 150);
  });

  const SCROLL_SELECT_STORAGE_KEY = 'scrollSelectEnabled';
  const SCROLL_SWITCH_DEBOUNCE_MS = 70;

  function loadScrollSelectState() {
    try {
      const stored = localStorage.getItem(SCROLL_SELECT_STORAGE_KEY);
      if (stored === null) return true;
      return stored === 'true';
    } catch (error) {
      return true;
    }
  }

  function persistScrollSelectState(enabled) {
    try {
      localStorage.setItem(SCROLL_SELECT_STORAGE_KEY, String(enabled));
    } catch (error) {
      // Ignore storage errors (e.g., private mode)
    }
  }

  function setScrollSelectEnabled(enabled, source = 'auto') {
    window.scrollToSelectEnabled = enabled;
    persistScrollSelectState(enabled);
    console.debug(`[ScrollSelect] Mode set to ${enabled ? 'AUTO' : 'MANUAL'} (source: ${source})`);
    if (document?.body) {
      document.body.setAttribute('data-scroll-select', enabled ? 'auto' : 'manual');
    }
    const modeLabel = document.getElementById('scrollSelectModeLabel');
    if (modeLabel) {
      modeLabel.textContent = enabled ? 'Auto' : 'Manual';
      modeLabel.classList.toggle('text-blue-600', enabled);
      modeLabel.classList.toggle('text-slate-500', !enabled);
    }
    const toggle = document.getElementById('scrollSelectToggle');
    if (toggle) {
      toggle.checked = enabled;
    }
  }

  function isScrollSelectEnabled() {
    return window.scrollToSelectEnabled !== false;
  }

  const MIN_CENTER_TOLERANCE = 8;
  const MAX_CENTER_TOLERANCE = 48;

  function getListCenterMetrics(listRect) {
    if (!listRect) {
      return { center: 0, tolerance: MIN_CENTER_TOLERANCE };
    }
    const center = listRect.top + listRect.height / 2;
    const tolerance = Math.max(
      MIN_CENTER_TOLERANCE,
      Math.min(MAX_CENTER_TOLERANCE, listRect.height * 0.04)
    );
    return { center, tolerance };
  }

  function getAlignedImageContainer(imageList) {
    if (!imageList) return null;
    const listRect = imageList.getBoundingClientRect();
    if (!listRect || !listRect.height) return null;
    const { center, tolerance } = getListCenterMetrics(listRect);
    let closest = null;
    let closestDistance = Infinity;
    imageList.querySelectorAll('.image-container').forEach(container => {
      const rect = container.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      const containerCenter = rect.top + rect.height / 2;
      const distance = Math.abs(containerCenter - center);
      const isVisible = rect.bottom > listRect.top && rect.top < listRect.bottom;
      if (isVisible && distance < closestDistance) {
        closestDistance = distance;
        closest = container;
      }
    });
    if (closest && closestDistance <= tolerance) {
      console.debug(
        `[ScrollSelect] Candidate ${closest.dataset.label} within tolerance (${closestDistance.toFixed(1)} <= ${tolerance.toFixed(1)})`
      );
      return {
        container: closest,
        distance: closestDistance,
        tolerance,
        center,
      };
    }
    if (closest) {
      console.debug(
        `[ScrollSelect] No centered thumbnail (best ${closest.dataset.label} at ${closestDistance.toFixed(1)}px, tolerance ${tolerance.toFixed(1)}px)`
      );
    } else {
      console.debug('[ScrollSelect] No thumbnail candidates found while scanning list');
    }
    return null;
  }

  function syncSelectionToCenteredThumbnail() {
    if (!isScrollSelectEnabled()) return;
    const imageList = document.getElementById('imageList');
    if (!imageList) return;
    const alignedInfo = getAlignedImageContainer(imageList);
    if (!alignedInfo) return;
    const { container: aligned, distance, tolerance } = alignedInfo;
    const label = aligned.dataset.label;
    console.debug(
      `[ScrollSelect] Centered thumbnail ${label} (distance ${distance.toFixed(1)}px / tolerance ${tolerance.toFixed(1)}px)`
    );
    if (
      label &&
      window.projectManager &&
      typeof window.projectManager.switchView === 'function' &&
      window.projectManager.currentViewId !== label
    ) {
      console.debug(`[ScrollSelect] syncSelectionToCenteredThumbnail switching to ${label}`);
      window.projectManager.switchView(label);
      setTimeout(() => {
        if (typeof window.updateActivePill === 'function') {
          window.updateActivePill();
        }
      }, 30);
    }
  }
  window.syncSelectionToCenteredThumbnail = syncSelectionToCenteredThumbnail;

  function initScrollSelectToggle() {
    const initial = loadScrollSelectState();
    setScrollSelectEnabled(initial, 'init');
    const toggle = document.getElementById('scrollSelectToggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        setScrollSelectEnabled(toggle.checked, 'toggle');
        if (toggle.checked) {
          updateImageListPadding();
          syncSelectionToCenteredThumbnail();
        }
      });
    }
  }

  initScrollSelectToggle();

  if (typeof window.__miniStepperProgrammaticScrollUntil !== 'number') {
    window.__miniStepperProgrammaticScrollUntil = 0;
  }

  (function initMiniStepper() {
    // Configuration
    const cfg = {
      activeClasses: 'text-white scale-105 shadow-md',
      inactiveClasses: 'bg-white text-slate-600 border border-slate-300',
      pillSize: 'w-8 h-8',
      threshold: 0.3,
    };

    window.updateActiveImageInSidebar = function () {
      const imageList = document.getElementById('imageList');
      if (!imageList) return;

      const currentViewId = window.projectManager?.currentViewId;
      if (!currentViewId) return;

      const containers = imageList.querySelectorAll('.image-container');
      containers.forEach(container => {
        const isActive = container.dataset.label === currentViewId;

        // Toggle active class
        container.classList.toggle('active', isActive);
        container.setAttribute('aria-selected', isActive);

        // Visual styling for active state
        if (isActive) {
          container.classList.add('bg-slate-50', 'ring-1', 'ring-slate-200');
        } else {
          container.classList.remove('bg-slate-50', 'ring-1', 'ring-slate-200');
        }
      });
    };

    function positionStepperIndicator(activeButton, { animate = true } = {}) {
      const indicator = document.getElementById('mini-stepper-indicator');
      const stepper = document.getElementById('mini-stepper');
      if (!indicator || !activeButton || !stepper) return;

      const stepperRect = stepper.getBoundingClientRect();
      const btnRect = activeButton.getBoundingClientRect();
      const size = Math.min(btnRect.width, btnRect.height);
      const isInitialized = indicator.dataset.initialized === 'true';
      const shouldAnimate = animate && isInitialized;
      const offsetX = btnRect.left - stepperRect.left + btnRect.width / 2 - size / 2;
      const roundedOffsetX = Math.round(offsetX);
      const lastX = Number.parseInt(indicator.dataset.lastX || '', 10);
      const hasLastX = Number.isFinite(lastX);
      // Ignore sub-pixel/tiny jitter to prevent visible pulsing.
      if (hasLastX && Math.abs(lastX - roundedOffsetX) <= 1) {
        return;
      }

      indicator.style.width = `${Math.round(size)}px`;
      indicator.style.height = `${Math.round(size)}px`;
      indicator.style.transition = shouldAnimate ? 'transform 120ms linear' : 'none';
      indicator.style.transform = `translate3d(${roundedOffsetX}px, -50%, 0)`;
      indicator.dataset.lastX = String(roundedOffsetX);

      if (!shouldAnimate && animate) {
        requestAnimationFrame(() => {
          indicator.style.transition = 'transform 120ms linear';
          indicator.dataset.initialized = 'true';
        });
      } else if (!animate) {
        // Keep transition disabled while callers request non-animated updates
        // (e.g., collapsed image panel), preventing visible pulsing.
        indicator.style.transition = 'none';
      }
    }

    function updateActivePill({ animate = true } = {}) {
      // Update sidebar active state as well
      if (typeof window.updateActiveImageInSidebar === 'function') {
        window.updateActiveImageInSidebar();
      }

      // Get current label from ProjectManager if available, otherwise fallback to legacy
      const currentLabel =
        window.projectManager?.currentViewId ||
        window.currentImageLabel ||
        window.paintApp?.state?.currentImageLabel;
      if (!currentLabel) return;

      const stepper = document.getElementById('mini-stepper');
      const stepButtons = Array.from(stepper?.querySelectorAll('button[data-target]') || []);
      const activeButton = stepButtons.find(btn => btn.dataset.target === currentLabel) || null;

      // During view switches, current label can be temporarily out of sync with
      // rendered pills. Keep previous active styling instead of flashing to all-white.
      if (!activeButton) {
        return;
      }

      stepButtons.forEach(btn => {
        const isActive = btn.dataset.target === currentLabel;
        if (isActive) {
          btn.classList.remove(...cfg.inactiveClasses.split(' '));
          btn.classList.add(...cfg.activeClasses.split(' '));
          btn.setAttribute('aria-current', 'true');
        } else {
          btn.classList.remove(...cfg.activeClasses.split(' '));
          btn.classList.add(...cfg.inactiveClasses.split(' '));
          btn.removeAttribute('aria-current');
        }
      });

      const panelCollapsed = isImagePanelCollapsed();
      positionStepperIndicator(activeButton, { animate: panelCollapsed ? false : animate });

      // Auto-scroll the active pill to center
      if (activeButton && stepper && !panelCollapsed) {
        const activeLabel = activeButton.dataset.target || '';
        const lastAutoScrollLabel = window.__miniStepperLastAutoScrollLabel || '';
        // Don't keep re-centering the same active pill on every refresh.
        if (activeLabel && activeLabel === lastAutoScrollLabel) {
          return;
        }

        const stepperRect = stepper.getBoundingClientRect();
        const btnRect = activeButton.getBoundingClientRect();
        const delta = btnRect.left - stepperRect.left + btnRect.width / 2 - stepperRect.width / 2;
        if (Math.abs(delta) > 1) {
          window.__miniStepperProgrammaticScrollUntil = Date.now() + 400;
          stepper.scrollBy({ left: delta, behavior: 'smooth' });
          window.__miniStepperLastAutoScrollLabel = activeLabel;
        } else if (activeLabel) {
          window.__miniStepperLastAutoScrollLabel = activeLabel;
        }
      }
    }

    window.updateActivePill = updateActivePill;

    // Track which image container is centered in the sidebar and switch to that image
    // Initialize observer only once - guard against multiple initializations
    function initImageListCenteringObserver() {
      // If observer already exists, don't reinitialize
      if (window.__imageListCenteringObserver) {
        console.log('[ImageList] Observer already initialized, skipping');
        return;
      }

      const imageList = document.getElementById('imageList');
      if (!imageList) {
        console.warn('[ImageList] imageList element not found, cannot initialize observer');
        return;
      }

      console.log('[ImageList] Initializing centering observer');

      if (typeof updateImageListPadding === 'function') {
        updateImageListPadding();
      }

      // Debounce to avoid rapid switching
      let switchTimeout = null;
      const debouncedSwitch = (label, reason = 'unknown') => {
        if (!isScrollSelectEnabled()) return;
        if (switchTimeout) clearTimeout(switchTimeout);
        switchTimeout = setTimeout(() => {
          if (!isScrollSelectEnabled()) return;
          // Skip if this is a programmatic scroll
          if (
            window.__imageListProgrammaticScrollUntil &&
            Date.now() < window.__imageListProgrammaticScrollUntil
          ) {
            return;
          }

          if (label && window.projectManager && window.projectManager.currentViewId !== label) {
            console.log(`[ScrollSelect] ${reason} requesting switch to ${label}`);
            const switchResult = window.projectManager.switchView(label);
            Promise.resolve(switchResult).then(() => {
              if (typeof window.updateActivePill === 'function') {
                setTimeout(() => window.updateActivePill(), 30);
              }
            });
          }
        }, SCROLL_SWITCH_DEBOUNCE_MS);
      };

      // Function to find which container is closest to center
      const findCenteredContainer = () => {
        const info = getAlignedImageContainer(imageList);
        return info ? info.container : null;
      };

      // Use IntersectionObserver with a center-focused rootMargin
      const imageObserver = new IntersectionObserver(
        entries => {
          // Skip if this is a programmatic scroll
          if (
            window.__imageListProgrammaticScrollUntil &&
            Date.now() < window.__imageListProgrammaticScrollUntil
          ) {
            return;
          }

          const alignedInfo = getAlignedImageContainer(imageList);
          if (!alignedInfo) return;
          const { container: alignedContainer, distance, tolerance } = alignedInfo;

          const matchesObserver = entries.some(
            entry => entry.target === alignedContainer && entry.intersectionRatio > 0.1
          );
          if (matchesObserver) {
            const label = alignedContainer.dataset.label;
            if (label) {
              console.log(
                `[ImageList] IntersectionObserver confirmed centered image: ${label} (distance ${distance.toFixed(1)} / tol ${tolerance.toFixed(1)})`
              );
              debouncedSwitch(label, 'observer');
            }
          } else {
            const label = alignedContainer.dataset.label;
            if (label) {
              console.log(
                `[ImageList] Fallback detected centered image: ${label} (distance ${distance.toFixed(1)} / tol ${tolerance.toFixed(1)})`
              );
              debouncedSwitch(label, 'observer-fallback');
            }
          }
        },
        {
          root: imageList,
          rootMargin: '-40% 0px -40% 0px', // Create a center zone (20% top/bottom margin = 60% center zone)
          threshold: [0.1, 0.3, 0.5, 0.7, 1.0],
        }
      );

      // Also listen to scroll events for manual scrolling and scroll-snap completion
      let scrollTimeout = null;
      let lastScrollTop = imageList.scrollTop;
      let scrollEndTimeout = null;

      const handleScrollEnd = () => {
        // Skip if this is a programmatic scroll
        if (
          window.__imageListProgrammaticScrollUntil &&
          Date.now() < window.__imageListProgrammaticScrollUntil
        ) {
          return;
        }

        const closest = findCenteredContainer();
        if (closest && isScrollSelectEnabled()) {
          const label = closest.dataset.label;
          if (label) {
            console.log(`[ImageList] Scroll ended, centered image: ${label}`);
            debouncedSwitch(label, 'scroll-end');
          }
        }

        syncSelectionToCenteredThumbnail();
      };

      // Track scroll state for better snap detection
      let isScrolling = false;
      let scrollCheckInterval = null;

      imageList.addEventListener(
        'scroll',
        () => {
          // Skip if this is a programmatic scroll
          if (
            window.__imageListProgrammaticScrollUntil &&
            Date.now() < window.__imageListProgrammaticScrollUntil
          ) {
            return;
          }

          // Mark as scrolling
          if (!isScrolling) {
            isScrolling = true;
          }

          // Clear any pending timeouts
          if (scrollTimeout) clearTimeout(scrollTimeout);
          if (scrollEndTimeout) clearTimeout(scrollEndTimeout);

          // Detect when scrolling has stopped (for scroll-snap completion)
          const currentScrollTop = imageList.scrollTop;
          const scrollChanged = currentScrollTop !== lastScrollTop;
          lastScrollTop = currentScrollTop;

          if (scrollChanged) {
            // While scrolling, continuously check for snap completion
            scrollTimeout = setTimeout(() => {
              // Check if scroll position has stabilized (snap completed)
              const newScrollTop = imageList.scrollTop;
              if (newScrollTop === lastScrollTop) {
                isScrolling = false;
                // Scroll has stopped, check for centered container after snap
                setTimeout(() => {
                  handleScrollEnd();
                }, 100); // Allow time for scroll-snap to complete
              } else {
                // Still scrolling, check again
                lastScrollTop = newScrollTop;
                scrollTimeout = setTimeout(() => {
                  handleScrollEnd();
                }, 50);
              }
            }, 100);
          }
        },
        { passive: true }
      );

      // Listen for scrollend event (if browser supports it) for immediate detection
      if ('onscrollend' in window) {
        imageList.addEventListener(
          'scrollend',
          () => {
            // Skip if this is a programmatic scroll
            if (
              window.__imageListProgrammaticScrollUntil &&
              Date.now() < window.__imageListProgrammaticScrollUntil
            ) {
              return;
            }

            // Clear any pending timeouts
            if (scrollTimeout) clearTimeout(scrollTimeout);
            if (scrollEndTimeout) clearTimeout(scrollEndTimeout);

            // Immediately check which image is centered after scroll-snap
            setTimeout(() => {
              handleScrollEnd();
            }, 50); // Small delay to ensure DOM has updated
          },
          { passive: true }
        );
      }

      // Observe all existing containers
      const observeContainers = () => {
        const containers = imageList.querySelectorAll('.image-container');
        containers.forEach(container => {
          imageObserver.observe(container);
        });
      };

      // Observe existing containers
      observeContainers();

      // Watch for new containers being added and observe them automatically
      const containerObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              // Element node
              // Check if it's an image container or contains one
              const container = node.classList?.contains('image-container')
                ? node
                : node.querySelector?.('.image-container');

              if (container && container.classList?.contains('image-container')) {
                console.log(
                  `[ImageList] New container detected, observing: ${container.dataset.label || 'unknown'}`
                );
                imageObserver.observe(container);

                if (typeof updateImageListPadding === 'function') {
                  updateImageListPadding();
                }
              }
            }
          });
        });
      });

      containerObserver.observe(imageList, {
        childList: true,
        subtree: true,
      });

      // Store observers for cleanup if needed
      window.__imageListCenteringObserver = imageObserver;
      window.__imageListContainerObserver = containerObserver;

      console.log('[ImageList] Observer initialized successfully');
    }

    function ensureImageListObserver() {
      if (window.__imageListCenteringObserver) {
        return;
      }
      const imageList = document.getElementById('imageList');
      if (!imageList) return;
      const hasThumb = !!imageList.querySelector('.image-container');
      if (hasThumb) {
        console.log('[ImageList] Auto-starting centering observer (content detected)');
        initImageListCenteringObserver();
        return;
      }
      if (!window.__imageListObserverBootstrap) {
        window.__imageListObserverBootstrap = new MutationObserver(() => {
          if (imageList.querySelector('.image-container')) {
            console.log('[ImageList] Detected first thumbnail, starting centering observer');
            if (window.__imageListObserverBootstrap) {
              window.__imageListObserverBootstrap.disconnect();
              window.__imageListObserverBootstrap = null;
            }
            initImageListCenteringObserver();
          }
        });
        window.__imageListObserverBootstrap.observe(imageList, { childList: true });
        console.log('[ImageList] Waiting for thumbnails to bootstrap centering observer');
      }
    }
    window.ensureImageListObserver = ensureImageListObserver;
    if (window.__pendingImageListObserverInit) {
      delete window.__pendingImageListObserverInit;
      ensureImageListObserver();
    }

    // Track which pill is centered and switch to that image
    function initPillCenteringObserver(stepButtons) {
      if (stepButtons.length === 0) return;

      const stepper = document.getElementById('mini-stepper');
      if (!stepper) return;

      // Debounce to avoid rapid switching
      let switchTimeout = null;
      const debouncedSwitch = (label, reason = 'mini-stepper') => {
        if (isImagePanelCollapsed()) return;
        if (!isScrollSelectEnabled()) return;
        if (
          window.__miniStepperProgrammaticScrollUntil &&
          Date.now() < window.__miniStepperProgrammaticScrollUntil
        ) {
          return;
        }
        if (switchTimeout) clearTimeout(switchTimeout);
        switchTimeout = setTimeout(() => {
          if (!isScrollSelectEnabled()) return;
          if (
            window.__miniStepperProgrammaticScrollUntil &&
            Date.now() < window.__miniStepperProgrammaticScrollUntil
          ) {
            return;
          }
          if (label && window.projectManager && window.projectManager.currentViewId !== label) {
            console.log(`[ScrollSelect] ${reason} requesting switch to ${label}`);
            window.projectManager.switchView(label);
          }
        }, 150); // Small delay to avoid rapid switching
      };

      // Function to find which pill is closest to center
      const findCenteredPill = () => {
        const stepperRect = stepper.getBoundingClientRect();
        const stepperCenter = stepperRect.left + stepperRect.width / 2;

        let closestPill = null;
        let closestDistance = Infinity;
        const tolerance = Math.max(8, Math.min(40, stepperRect.width * 0.05));

        stepButtons.forEach(btn => {
          const btnRect = btn.getBoundingClientRect();
          const btnCenter = btnRect.left + btnRect.width / 2;
          const distance = Math.abs(btnCenter - stepperCenter);

          // Only consider pills that are at least partially visible
          if (btnRect.right > stepperRect.left && btnRect.left < stepperRect.right) {
            if (distance < closestDistance) {
              closestDistance = distance;
              closestPill = btn;
            }
          }
        });

        if (closestPill && closestDistance <= tolerance) {
          return closestPill;
        }
        return null;
      };

      // Use IntersectionObserver with a center-focused rootMargin
      // This creates a "center zone" that pills must intersect
      const pillObserver = new IntersectionObserver(
        entries => {
          // Find pills that intersect the center zone
          const centeredPills = entries.filter(entry => entry.intersectionRatio > 0.3);

          if (centeredPills.length > 0) {
            // Find the one closest to center
            const centeredPill = centeredPills.reduce((best, current) => {
              const stepperRect = stepper.getBoundingClientRect();
              const stepperCenter = stepperRect.left + stepperRect.width / 2;
              const bestCenter = Math.abs(
                best.boundingClientRect.left + best.boundingClientRect.width / 2 - stepperCenter
              );
              const currentCenter = Math.abs(
                current.boundingClientRect.left +
                  current.boundingClientRect.width / 2 -
                  stepperCenter
              );
              return currentCenter < bestCenter ? current : best;
            });

            const label = centeredPill.target.dataset.target;
            if (label) {
              debouncedSwitch(label, 'mini-stepper-observer');
            }
          } else {
            // Fallback: find closest pill if none intersect center zone
            const closest = findCenteredPill();
            if (closest) {
              const label = closest.dataset.target;
              if (label) {
                debouncedSwitch(label, 'mini-stepper-fallback');
              }
            }
          }
        },
        {
          root: stepper,
          rootMargin: '-40% 0px -40% 0px', // Create a center zone (20% top/bottom margin = 60% center zone)
          threshold: [0.1, 0.3, 0.5, 0.7, 1.0],
        }
      );

      // Also listen to scroll events for manual scrolling
      let scrollTimeout = null;
      stepper.addEventListener(
        'scroll',
        () => {
          if (
            window.__miniStepperProgrammaticScrollUntil &&
            Date.now() < window.__miniStepperProgrammaticScrollUntil
          ) {
            return;
          }
          if (scrollTimeout) clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            const closest = findCenteredPill();
            if (closest) {
              const label = closest.dataset.target;
              if (label) {
                debouncedSwitch(label, 'mini-stepper-scroll');
              }
            }
          }, 100);
        },
        { passive: true }
      );

      // Observe all pills
      stepButtons.forEach(btn => {
        pillObserver.observe(btn);
      });

      // Store observer for cleanup if needed
      window.__pillCenteringObserver = pillObserver;
    }

    function getImageContainers() {
      const imagePanelContent = document.getElementById('imagePanelContent');
      const imagePanel = document.getElementById('imagePanel');
      const isPanelCollapsed = !!(
        (imagePanelContent &&
          (imagePanelContent.classList.contains('hidden') ||
            imagePanelContent.style.display === 'none')) ||
        (imagePanel &&
          (imagePanel.classList.contains('collapsed') ||
            imagePanel.classList.contains('minimized') ||
            imagePanel.style.display === 'none'))
      );

      // Use window.originalImages as the source of truth for which images exist
      // This ensures we can detect images even when the panel is collapsed
      const imageLabelsFromState = window.originalImages
        ? Object.keys(window.originalImages).filter(
            label => !label.includes('Demo') && !label.includes('Blank')
          )
        : [];

      // If we have state, use it as the primary source and find matching containers
      if (imageLabelsFromState.length > 0) {
        // Map each label to its container, preferring visible ones
        const labelToContainer = new Map();

        // First, try to find containers in the expected locations
        const imageList = document.getElementById('imageList');
        const imageGallery = document.getElementById('imageGallery');

        // Collect all potential containers
        const allContainers = [];
        if (imageList) {
          allContainers.push(
            ...Array.from(imageList.querySelectorAll('.image-container, .image-thumbnail'))
          );
        }
        if (imageGallery) {
          allContainers.push(
            ...Array.from(imageGallery.querySelectorAll('.image-container, .image-thumbnail'))
          );
        }

        // Also search broadly if needed
        if (allContainers.length === 0) {
          allContainers.push(
            ...Array.from(document.querySelectorAll('.image-container, .image-thumbnail'))
          );
        }

        // Map labels to containers, preferring visible ones
        imageLabelsFromState.forEach(label => {
          // Find all containers with this label
          const matchingContainers = allContainers.filter(container => {
            const cLabel =
              container.dataset?.label ||
              container.getAttribute('title') ||
              container.dataset?.imageIndex ||
              container.id;
            return cLabel === label;
          });

          if (matchingContainers.length > 0) {
            // Prefer visible containers, but if panel is collapsed, accept any
            const visible = matchingContainers.find(c => c.offsetWidth > 0 && c.offsetHeight > 0);
            const container = visible || (isPanelCollapsed ? matchingContainers[0] : null);

            if (container && !labelToContainer.has(label)) {
              labelToContainer.set(label, container);
            }
          }
        });

        // Return containers in the order of imageLabelsFromState, deduplicated
        // If panel is collapsed and we have state but no containers, return empty array
        // updatePills() will handle creating virtual containers from state
        const result = [];
        const seenContainers = new Set();

        imageLabelsFromState.forEach(label => {
          const container = labelToContainer.get(label);
          if (container && !seenContainers.has(container)) {
            seenContainers.add(container);
            result.push(container);
          }
        });

        // If we have state but no containers found (panel closed), return empty array
        // This will trigger the fallback in updatePills() to use state directly
        return result;
      }

      // Fallback: if no state, use the old method but deduplicate
      const imageList = document.getElementById('imageList');
      const imageGallery = document.getElementById('imageGallery');

      let containers = [];

      if (imageList) {
        const listContainers = Array.from(
          imageList.querySelectorAll('.image-container, .image-thumbnail')
        );
        containers.push(...listContainers);
      }

      if (imageGallery) {
        const galleryContainers = Array.from(
          imageGallery.querySelectorAll('.image-container, .image-thumbnail')
        );
        containers.push(...galleryContainers);
      }

      // Filter to valid image containers and deduplicate by label
      const labelToContainer = new Map();
      const seenContainers = new Set();

      containers.forEach(container => {
        const label =
          container.dataset?.label ||
          container.getAttribute('title') ||
          container.dataset?.imageIndex ||
          container.id;
        const isVisible = container.offsetWidth > 0 && container.offsetHeight > 0;
        const isSidebarContainer =
          container.classList && container.classList.contains('image-container');

        // Accept if valid and (visible OR panel collapsed)
        const isValid =
          label &&
          !label.includes('Demo') &&
          !label.includes('Blank') &&
          (isVisible || isPanelCollapsed) &&
          (isSidebarContainer || container.tagName === 'IMG' || container.dataset?.src);

        if (isValid && !seenContainers.has(container)) {
          // Prefer visible containers for each label
          if (!labelToContainer.has(label) || isVisible) {
            labelToContainer.set(label, container);
          }
          seenContainers.add(container);
        }
      });

      // Return deduplicated containers
      return Array.from(labelToContainer.values());
    }

    function positionNavigationContainer() {
      const frameCapture = document.getElementById('frame-capture');
      const navContainer = document.getElementById('navigation-container');

      if (!frameCapture || !navContainer) {
        return;
      }

      // Position the navigation container directly under frame-capture
      const frameRect = frameCapture.getBoundingClientRect();
      navContainer.style.position = 'fixed';
      navContainer.style.bottom = '0';
      navContainer.style.left = '0';
      navContainer.style.right = '0';
      navContainer.style.width = '100%';
      navContainer.style.zIndex = '5000';
    }

    function updatePills() {
      const stepper = document.getElementById('mini-stepper');

      if (!stepper) {
        return []; // Return empty array instead of undefined
      }

      let imageLabels = [];

      // Primary source: actual sidebar thumbnail order
      const imageList = document.getElementById('imageList');
      if (imageList) {
        const seenLabels = new Set();
        imageLabels = Array.from(imageList.querySelectorAll('.image-container'))
          .map(container => container.dataset?.label?.trim())
          .filter(label => {
            if (!label || label.includes('Demo') || label.includes('Blank')) return false;
            if (seenLabels.has(label)) return false;
            seenLabels.add(label);
            return true;
          });
      }

      // Fallback to ProjectManager views if sidebar empty (e.g., before DOM sync)
      if (imageLabels.length === 0 && window.projectManager && window.projectManager.views) {
        imageLabels = Object.keys(window.projectManager.views)
          .filter(viewId => {
            const view = window.projectManager.views[viewId];
            return view && view.image && !viewId.includes('Demo') && !viewId.includes('Blank');
          })
          .sort((a, b) => {
            const preference = ['front', 'side', 'back', 'cushion'];
            const aIdx = preference.indexOf(a);
            const bIdx = preference.indexOf(b);
            if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
            if (aIdx !== -1) return -1;
            if (bIdx !== -1) return 1;
            return a.localeCompare(b);
          });
      }

      // Fallback to gallery data
      if (
        imageLabels.length === 0 &&
        typeof imageGalleryData !== 'undefined' &&
        imageGalleryData.length > 0
      ) {
        const seenLabels = new Set();
        imageLabels = imageGalleryData
          .filter(item => {
            const label = item?.original?.label || item?.label;
            if (!label || label.includes('Demo') || label.includes('Blank')) return false;
            if (seenLabels.has(label)) return false; // Deduplicate
            seenLabels.add(label);
            return true;
          })
          .map(item => item?.original?.label || item?.label)
          .filter(Boolean);
      }

      // Final fallback to DOM containers (legacy helper)
      if (imageLabels.length === 0) {
        const imageContainers = getImageContainers();
        const seenLabels = new Set();
        imageLabels = imageContainers
          .map(container => {
            const label =
              container.dataset?.label ||
              container.getAttribute('title') ||
              container.dataset?.imageIndex ||
              container.id;
            return label;
          })
          .filter(label => {
            if (!label || label.includes('Demo') || label.includes('Blank')) return false;
            if (seenLabels.has(label)) return false;
            seenLabels.add(label);
            return true;
          });
      }

      if (imageLabels.length === 0) {
        stepper.innerHTML = '<li class="px-4 py-2 text-slate-500 text-sm">No images yet</li>';
        // Ensure base classes are applied even when empty
        stepper.className =
          'flex gap-3 px-4 py-3 overflow-x-auto snap-x snap-mandatory justify-center items-center min-h-[60px]';
        return []; // Return empty array instead of undefined
      }

      // Ensure stepper has base classes
      stepper.className =
        'flex gap-3 px-4 py-3 overflow-x-auto snap-x snap-mandatory justify-center items-center min-h-[60px]';

      // Build pills for each unique image label
      const pillsHTML = imageLabels
        .map((label, idx) => {
          const n = idx + 1;
          return `
                          <li class="snap-center">
                              <button
                                  type="button"
                                  class="step w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-200 bg-white text-slate-600 border border-slate-300 hover:scale-105 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                  aria-label="Go to ${label}"
                                  data-target="${label}"
                                  data-index="${idx}">
                                  ${n}
                              </button>
                          </li>`;
        })
        .join('');

      const indicatorMarkup = '<span id="mini-stepper-indicator" aria-hidden="true"></span>';
      stepper.innerHTML = indicatorMarkup + pillsHTML;

      const stepButtons = Array.from(stepper.querySelectorAll('button[data-target]'));

      // Initialise states - all start as inactive
      stepButtons.forEach(btn => {
        btn.classList.add(...cfg.inactiveClasses.split(' '));
      });

      // Update active state immediately after creating pills
      setTimeout(() => updateActivePill({ animate: false }), 100);

      // Initialize pill centering observer to track which pill is centered
      initPillCenteringObserver(stepButtons);

      // Click to switch to image and center the pill
      stepButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const label = btn.dataset.target;
          const stepper = document.getElementById('mini-stepper');

          if (!stepper) return;

          // First, center the pill in the stepper
          const stepperRect = stepper.getBoundingClientRect();
          const btnRect = btn.getBoundingClientRect();
          const delta = btnRect.left - stepperRect.left + btnRect.width / 2 - stepperRect.width / 2;
          stepper.scrollBy({ left: delta, behavior: 'smooth' });

          // Then switch to the image
          if (window.switchToImage && typeof window.switchToImage === 'function') {
            try {
              window.switchToImage(label);

              // Also scroll the sidebar to center the corresponding thumbnail
              const list = document.getElementById('imageList');
              if (list) {
                const container = list.querySelector(`.image-container[data-label="${label}"]`);
                if (container) {
                  const listRect = list.getBoundingClientRect();
                  const elRect = container.getBoundingClientRect();
                  const delta = elRect.top - listRect.top + elRect.height / 2 - listRect.height / 2;
                  // Suppress scroll-driven switching during this smooth scroll
                  window.__imageListProgrammaticScrollUntil = Date.now() + 500;
                  list.scrollBy({ top: delta, behavior: 'smooth' });
                }
              }

              // Update active state immediately
              setTimeout(() => updateActivePill(), 50);
              // Dispatch event
              window.dispatchEvent(
                new CustomEvent('mini-step-click', {
                  detail: { label, index: btn.dataset.index },
                })
              );
              console.debug(`[ScrollSelect] mini-step click switched to ${label}`);
            } catch (error) {
              console.error('[MiniStepper] Error switching to image:', label, error);
            }
          } else {
            console.error('[MiniStepper] switchToImage function not available');
          }
        });

        // Keyboard activation
        btn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            btn.click();
          }
        });
      });

      return stepButtons;
    }

    function initIntersectionObserver(stepButtons) {
      if (stepButtons.length === 0) return;

      let lastObservedLabel = '';

      const io = new IntersectionObserver(
        entries => {
          if (isImagePanelCollapsed()) {
            return;
          }
          // Find the image container with the highest intersection ratio
          const imageEntries = entries.filter(entry => {
            // Convert className to string (it might be a DOMTokenList)
            const className =
              typeof entry.target.className === 'string'
                ? entry.target.className
                : entry.target.className
                  ? entry.target.className.toString()
                  : '';
            const id = entry.target.id || '';
            const hasImageData =
              entry.target.dataset &&
              (entry.target.dataset.label ||
                entry.target.dataset.imageIndex ||
                entry.target.dataset.src);

            return (
              className.includes('image') ||
              id.includes('image') ||
              hasImageData ||
              entry.target.tagName === 'IMG' ||
              (entry.target.style &&
                entry.target.style.backgroundImage &&
                (entry.target.style.backgroundImage.includes('data:image') ||
                  entry.target.style.backgroundImage.includes('blob:') ||
                  entry.target.style.backgroundImage.includes('http')))
            );
          });
          if (imageEntries.length === 0) return;

          let best = imageEntries.reduce((a, b) =>
            a.intersectionRatio > b.intersectionRatio ? a : b
          );
          const label =
            best.target.dataset?.label ||
            best.target.getAttribute('title') ||
            best.target.dataset?.imageIndex ||
            best.target.id ||
            `Image ${Array.from(best.target.parentNode?.children || []).indexOf(best.target)}`;

          if (!label) return;

          // Ignore repeated callbacks for the same active label to prevent
          // continuous class transitions/scroll nudges that cause indicator pulsing.
          if (label === lastObservedLabel) {
            return;
          }
          lastObservedLabel = label;

          // Update UI
          stepButtons.forEach(b => {
            const active = b.dataset.target === label;

            if (active) {
              b.setAttribute('aria-current', 'true');
              b.classList.remove(...cfg.inactiveClasses.split(' '));
              b.classList.add(...cfg.activeClasses.split(' '));
              b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            } else {
              b.removeAttribute('aria-current');
              b.classList.remove(...cfg.activeClasses.split(' '));
              b.classList.add(...cfg.inactiveClasses.split(' '));
            }
          });

          const activeButton = stepButtons.find(b => b.dataset.target === label);
          positionStepperIndicator(activeButton, { animate: true });

          // Dispatch event for external listeners
          window.dispatchEvent(
            new CustomEvent('mini-step-change', {
              detail: {
                label,
                index: best.target.dataset?.imageIndex || best.target.dataset?.index,
              },
            })
          );
        },
        { threshold: [cfg.threshold], rootMargin: '-50% 0px -50% 0px' }
      );

      // Observe all image containers
      getImageContainers().forEach(container => {
        io.observe(container);
      });
    }

    // Initialize when DOM is ready and wait for paint.js to load
    function initializeWhenReady() {
      if (typeof window.switchToImage === 'function') {
        initialize();
      } else {
        setTimeout(initializeWhenReady, 500);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeWhenReady);
    } else {
      initializeWhenReady();
    }

    ensureImageListObserver();

    function initialize() {
      positionNavigationContainer();

      // Initial update
      const stepButtons = updatePills();
      initIntersectionObserver(stepButtons);

      // Update active pill immediately
      updateActivePill({ animate: false });

      // Set up periodic updates to handle dynamically added images (optimized with requestAnimationFrame)
      let ticking = false;
      const checkForChanges = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const stepper = document.getElementById('mini-stepper');
          positionNavigationContainer();
          const currentButtons = Array.from(
            document.querySelectorAll('#mini-stepper button[data-target]')
          );
          const currentContainers = getImageContainers();
          const hasNoImagesPlaceholder =
            !!stepper && (stepper.textContent || '').includes('No images yet');
          const hasProjectImages =
            !!window.projectManager?.views &&
            Object.values(window.projectManager.views).some(view => !!view?.image);
          const shouldRebuildFromProjectState = hasNoImagesPlaceholder && hasProjectImages;

          if (currentButtons.length !== currentContainers.length || shouldRebuildFromProjectState) {
            // Clean up old observer if it exists
            if (window.__pillCenteringObserver) {
              window.__pillCenteringObserver.disconnect();
            }
            const newButtons = updatePills();
            initIntersectionObserver(newButtons);
            // Re-initialize pill centering observer
            initPillCenteringObserver(newButtons);
            // Snap indicator for newly built pills
            updateActivePill({ animate: false });
          }
          ticking = false;
        });
      };
      setInterval(checkForChanges, 2000); // Check less frequently (every 2 seconds)
    }

    // Reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Adjust behaviors for reduced motion
      document.querySelectorAll('#mini-stepper .step').forEach(btn => {
        btn.style.transition = 'none';
      });
    }

    // Example listeners for external integration
    window.addEventListener('mini-step-change', e => {
      // Event fired when active image changes
    });

    window.addEventListener('mini-step-click', e => {
      // Event fired when image pill is clicked
    });
  })();
}
