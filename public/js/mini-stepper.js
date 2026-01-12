/**
 * Mini Stepper Navigation Module
 * Bottom navigation pill system with automatic centering and scroll-based selection
 */
(function () {
  'use strict';

  // Configuration
  const cfg = {
    activeClasses: 'text-white scale-105 shadow-md',

    inactiveClasses: 'bg-white text-slate-600 border border-slate-300',
    pillSize: 'w-8 h-8',
    threshold: 0.3,
  };

  // Initialize programmatic scroll flag if not exists
  if (typeof window.__miniStepperProgrammaticScrollUntil !== 'number') {
    window.__miniStepperProgrammaticScrollUntil = 0;
  }

  /**
   * Update active image in sidebar
   */
  function updateActiveImageInSidebar() {
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
  }

  function positionStepperIndicator(activeButton, { animate = true } = {}) {
    const indicator = document.getElementById('mini-stepper-indicator');
    const stepper = document.getElementById('mini-stepper');
    if (!indicator || !activeButton || !stepper) return;

    const stepperRect = stepper.getBoundingClientRect();
    const btnRect = activeButton.getBoundingClientRect();
    const size = Math.min(btnRect.width, btnRect.height);
    const isInitialized = indicator.dataset.initialized === 'true';
    const shouldAnimate = animate && isInitialized;

    indicator.style.width = `${Math.round(size)}px`;
    indicator.style.height = `${Math.round(size)}px`;
    indicator.style.transition = shouldAnimate ? 'transform 120ms linear' : 'none';

    const offsetX = btnRect.left - stepperRect.left + btnRect.width / 2 - size / 2;
    indicator.style.transform = `translate3d(${Math.round(offsetX)}px, -50%, 0)`;

    if (!shouldAnimate) {
      requestAnimationFrame(() => {
        indicator.style.transition = 'transform 120ms linear';
        indicator.dataset.initialized = 'true';
      });
    }
  }

  /**
   * Update active pill in stepper
   */
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
    let activeButton = null;

    stepButtons.forEach(btn => {
      const isActive = btn.dataset.target === currentLabel;
      if (isActive) {
        btn.classList.remove(...cfg.inactiveClasses.split(' '));
        btn.classList.add(...cfg.activeClasses.split(' '));
        btn.setAttribute('aria-current', 'true');
        activeButton = btn;
      } else {
        btn.classList.remove(...cfg.activeClasses.split(' '));
        btn.classList.add(...cfg.inactiveClasses.split(' '));
        btn.removeAttribute('aria-current');
      }
    });

    positionStepperIndicator(activeButton, { animate });

    // Auto-scroll the active pill to center
    if (activeButton && stepper) {
      const stepperRect = stepper.getBoundingClientRect();
      const btnRect = activeButton.getBoundingClientRect();
      const delta = btnRect.left - stepperRect.left + btnRect.width / 2 - stepperRect.width / 2;
      if (Math.abs(delta) > 1) {
        window.__miniStepperProgrammaticScrollUntil = Date.now() + 400;
        stepper.scrollBy({ left: delta, behavior: 'smooth' });
      }
    }
  }

  /**
   * Initialize image list centering observer
   */
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
    const SCROLL_SWITCH_DEBOUNCE_MS = 70;

    const debouncedSwitch = (label, reason = 'unknown') => {
      const isScrollSelectEnabled = () => window.scrollToSelectEnabled !== false;
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
      const info = window.scrollSelectSystem?.getAlignedContainer?.(imageList);
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

        const alignedInfo = window.scrollSelectSystem?.getAlignedContainer?.(imageList);
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
        rootMargin: '-40% 0px -40% 0px',
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
      const isScrollSelectEnabled = () => window.scrollToSelectEnabled !== false;
      if (closest && isScrollSelectEnabled()) {
        const label = closest.dataset.label;
        if (label) {
          console.log(`[ImageList] Scroll ended, centered image: ${label}`);
          debouncedSwitch(label, 'scroll-end');
        }
      }

      if (typeof window.syncSelectionToCenteredThumbnail === 'function') {
        window.syncSelectionToCenteredThumbnail();
      }
    };

    // Track scroll state for better snap detection
    let isScrolling = false;

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

  /**
   * Ensure image list observer is running
   */
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

  /**
   * Initialize pill centering observer
   */
  function initPillCenteringObserver(stepButtons) {
    if (stepButtons.length === 0) return;

    const stepper = document.getElementById('mini-stepper');
    if (!stepper) return;

    const isScrollSelectEnabled = () => window.scrollToSelectEnabled !== false;

    // Debounce to avoid rapid switching
    let switchTimeout = null;
    const debouncedSwitch = (label, reason = 'mini-stepper') => {
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
      }, 150);
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
              current.boundingClientRect.left + current.boundingClientRect.width / 2 - stepperCenter
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
        rootMargin: '-40% 0px -40% 0px',
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

  /**
   * Get image containers
   */
  function getImageContainers() {
    // Use window.originalImages as the source of truth
    const imageLabelsFromState = window.originalImages
      ? Object.keys(window.originalImages).filter(
          label => !label.includes('Demo') && !label.includes('Blank')
        )
      : [];

    // If we have state, use it as the primary source
    if (imageLabelsFromState.length > 0) {
      const imagePanelContent = document.getElementById('imagePanelContent');
      const imagePanel = document.getElementById('imagePanel');
      const isPanelCollapsed =
        (imagePanelContent && imagePanelContent.classList.contains('hidden')) ||
        (imagePanel && imagePanel.classList.contains('minimized')) ||
        (imagePanel && imagePanel.style.display === 'none');

      const labelToContainer = new Map();

      const imageList = document.getElementById('imageList');
      const imageGallery = document.getElementById('imageGallery');

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

      if (allContainers.length === 0) {
        allContainers.push(
          ...Array.from(document.querySelectorAll('.image-container, .image-thumbnail'))
        );
      }

      imageLabelsFromState.forEach(label => {
        const matchingContainers = allContainers.filter(container => {
          const cLabel =
            container.dataset?.label ||
            container.getAttribute('title') ||
            container.dataset?.imageIndex ||
            container.id;
          return cLabel === label;
        });

        if (matchingContainers.length > 0) {
          const visible = matchingContainers.find(c => c.offsetWidth > 0 && c.offsetHeight > 0);
          const container = visible || (isPanelCollapsed ? matchingContainers[0] : null);

          if (container && !labelToContainer.has(label)) {
            labelToContainer.set(label, container);
          }
        }
      });

      const result = [];
      const seenContainers = new Set();

      imageLabelsFromState.forEach(label => {
        const container = labelToContainer.get(label);
        if (container && !seenContainers.has(container)) {
          seenContainers.add(container);
          result.push(container);
        }
      });

      return result;
    }

    // Fallback: if no state, use the old method
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

    const imagePanelContent = document.getElementById('imagePanelContent');
    const isPanelCollapsed = imagePanelContent && imagePanelContent.classList.contains('hidden');

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

      const isValid =
        label &&
        !label.includes('Demo') &&
        !label.includes('Blank') &&
        (isVisible || isPanelCollapsed) &&
        (isSidebarContainer || container.tagName === 'IMG' || container.dataset?.src);

      if (isValid && !seenContainers.has(container)) {
        if (!labelToContainer.has(label) || isVisible) {
          labelToContainer.set(label, container);
        }
        seenContainers.add(container);
      }
    });

    return Array.from(labelToContainer.values());
  }

  /**
   * Position navigation container
   */
  function positionNavigationContainer() {
    const frameCapture = document.getElementById('frame-capture');
    const navContainer = document.getElementById('navigation-container');

    if (!frameCapture || !navContainer) {
      return;
    }

    navContainer.style.position = 'fixed';
    navContainer.style.bottom = '0';
    navContainer.style.left = '0';
    navContainer.style.right = '0';
    navContainer.style.width = '100%';
    navContainer.style.zIndex = '5000';
  }

  /**
   * Update pills in the stepper
   */
  function updatePills() {
    const stepper = document.getElementById('mini-stepper');

    if (!stepper) {
      return [];
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

    // Fallback to ProjectManager views if sidebar empty
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
          if (seenLabels.has(label)) return false;
          seenLabels.add(label);
          return true;
        })
        .map(item => item?.original?.label || item?.label)
        .filter(Boolean);
    }

    // Final fallback to DOM containers
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
      stepper.className =
        'flex gap-3 px-4 py-3 overflow-x-auto snap-x snap-mandatory justify-center items-center min-h-[60px]';
      return [];
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

    // Initialize states - all start as inactive
    stepButtons.forEach(btn => {
      btn.classList.add(...cfg.inactiveClasses.split(' '));
    });

    // Update active state immediately after creating pills
    setTimeout(() => updateActivePill({ animate: false }), 100);

    // Initialize pill centering observer
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
              new CustomEvent('mini-step-click', { detail: { label, index: btn.dataset.index } })
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

  /**
   * Initialize intersection observer for image containers
   */
  function initIntersectionObserver(stepButtons) {
    if (stepButtons.length === 0) return;

    const io = new IntersectionObserver(
      entries => {
        const imageEntries = entries.filter(entry => {
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

        // Update UI
        stepButtons.forEach(b => {
          const active = b.dataset.target === label;
          b.classList.toggle('aria-current', active);

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
            detail: { label, index: best.target.dataset?.imageIndex || best.target.dataset?.index },
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

  /**
   * Initialize the mini stepper system
   */
  function initialize() {
    positionNavigationContainer();

    // Initial update
    const stepButtons = updatePills();
    initIntersectionObserver(stepButtons);

    // Update active pill immediately
    updateActivePill({ animate: false });

    // Set up periodic updates to handle dynamically added images
    let ticking = false;
    const checkForChanges = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        positionNavigationContainer();
        const currentButtons = Array.from(
          document.querySelectorAll('#mini-stepper button[data-target]')
        );
        const currentContainers = getImageContainers();
        if (currentButtons.length !== currentContainers.length) {
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
    setInterval(checkForChanges, 2000);
  }

  /**
   * Initialize when ready
   */
  function initializeWhenReady() {
    if (typeof window.switchToImage === 'function') {
      initialize();
    } else {
      setTimeout(initializeWhenReady, 500);
    }
  }

  // Expose public API
  window.updateActivePill = updateActivePill;
  window.updateActiveImageInSidebar = updateActiveImageInSidebar;
  window.ensureImageListObserver = ensureImageListObserver;

  // Handle reduced motion preference
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('#mini-stepper .step').forEach(btn => {
      btn.style.transition = 'none';
    });
  }

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeWhenReady();
      ensureImageListObserver();
    });
  } else {
    initializeWhenReady();
    ensureImageListObserver();
  }

  // Handle pending initialization flag
  if (window.__pendingImageListObserverInit) {
    delete window.__pendingImageListObserverInit;
    ensureImageListObserver();
  }
})();
