// Capture frame lock/unlock and drag/resize functionality
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
(function () {
  'use strict';

  // Capture frame lock functionality
  let isCaptureLocked = true; // Start locked for minimal appearance

  function initCaptureFrame() {
    const captureFrame = document.getElementById('captureFrame');
    if (!captureFrame) {
      console.warn('Capture frame element not found');
      return;
    }

    // Initialize capture frame on load
    updateCaptureFrameLockState();

    // Lock/unlock button functionality
    const lockButton = document.getElementById('captureLockButton');
    lockButton?.addEventListener('click', e => {
      e.stopPropagation();
      toggleCaptureLock();
    });

    // Keyboard shortcut for lock/unlock (L key) - ignore when typing in inputs/textareas/selects or contenteditable
    document.addEventListener('keydown', e => {
      const target = e.target;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isTyping) return;
      if (e.key && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleCaptureLock();
      }
    });

    function toggleCaptureLock() {
      isCaptureLocked = !isCaptureLocked;
      updateCaptureFrameLockState();
      showLockPopup();
    }

    function showLockPopup() {
      const popup = document.getElementById('lockPopup');
      const icon = document.getElementById('lockPopupIcon');
      const text = document.getElementById('lockPopupText');

      if (isCaptureLocked) {
        text.textContent = 'Locked';
        icon.innerHTML =
          '<path d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"></path>';
      } else {
        text.textContent = 'Unlocked';
        icon.innerHTML =
          '<path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z"></path>';
      }

      popup.classList.add('show');
      setTimeout(() => {
        popup.classList.remove('show');
      }, 1500);
    }

    function updateCaptureFrameLockState() {
      const lockButton = document.getElementById('captureLockButton');
      const instructions = document.getElementById('unlockInstructions');
      const applyAllButton = document.getElementById('applyFitAll');

      if (isCaptureLocked) {
        captureFrame.classList.add('locked');
        captureFrame.classList.remove('unlocked');
        lockButton.classList.add('locked');
        lockButton.title = 'Unlock frame (L)';
        instructions.classList.add('hidden');
        document.body.classList.remove('capture-unlocked');

        // Hide Apply All button for safety
        if (applyAllButton) {
          applyAllButton.style.display = 'none';
        }

        // Use white overlay outside the frame for clarity
        captureFrame.style.boxShadow = '0 0 0 2000px rgba(255,255,255,1)';

        // Enable pointer events for lock button only
        captureFrame.style.pointerEvents = 'none';
        lockButton.style.pointerEvents = 'auto';
      } else {
        captureFrame.classList.remove('locked');
        captureFrame.classList.add('unlocked');
        lockButton.classList.remove('locked');
        lockButton.title = 'Lock frame (L)';
        instructions.classList.remove('hidden');
        document.body.classList.add('capture-unlocked');

        // Show Apply All button when unlocked
        if (applyAllButton) {
          applyAllButton.style.display = 'inline-block';
        }

        // Remove overlay when unlocked for transparent background while adjusting
        captureFrame.style.boxShadow = 'none';

        // Enable pointer events for dragging and resizing
        captureFrame.style.pointerEvents = 'auto';
        lockButton.style.pointerEvents = 'auto';
      }
    }

    // Color picker functionality
    const colorButtons = document.querySelectorAll('[data-color]');
    colorButtons.forEach(button => {
      button.addEventListener('click', () => {
        // Remove active class from all buttons
        colorButtons.forEach(btn => btn.classList.remove('active'));
        // Add active class to clicked button
        button.classList.add('active');
        // Update color picker value
        const colorPicker = document.getElementById('colorPicker');
        if (colorPicker) {
          colorPicker.value = button.getAttribute('data-color');
          // Trigger change event for existing functionality
          colorPicker.dispatchEvent(new Event('change'));
        }
      });
    });

    // Update active color button styling
    const style = document.createElement('style');
    style.textContent = `
            [data-color].active {
                border-color: #374151 !important;
                box-shadow: 0 0 0 2px white, 0 0 0 4px #374151 !important;
                transform: scale(1.1);
            }
        `;
    document.head.appendChild(style);

    // Capture frame resize functionality
    let isResizing = false;
    let currentHandle = null;
    let startPos = { x: 0, y: 0 };
    let startRect = { x: 0, y: 0, width: 0, height: 0 };

    const resizeHandles = document.querySelectorAll('.resize-handle');
    resizeHandles.forEach(handle => {
      handle.addEventListener('mousedown', e => {
        // Don't allow resizing when locked
        if (isCaptureLocked) return;

        e.preventDefault();
        isResizing = true;
        currentHandle = handle.getAttribute('data-direction');
        startPos = { x: e.clientX, y: e.clientY };

        const rect = captureFrame.getBoundingClientRect();
        startRect = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };

        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);
      });
    });

    function handleResize(e) {
      if (!isResizing || !currentHandle) return;

      const deltaX = e.clientX - startPos.x;
      const deltaY = e.clientY - startPos.y;

      let newX = startRect.x;
      let newY = startRect.y;
      let newWidth = startRect.width;
      let newHeight = startRect.height;

      // Handle different resize directions (mirrored resize from center)
      const centerX = startRect.x + startRect.width / 2;
      const centerY = startRect.y + startRect.height / 2;
      if (currentHandle.includes('e')) {
        newWidth = startRect.width + deltaX * 2;
      }
      if (currentHandle.includes('w')) {
        newWidth = startRect.width - deltaX * 2;
      }
      if (currentHandle.includes('s')) {
        newHeight = startRect.height + deltaY * 2;
      }
      if (currentHandle.includes('n')) {
        newHeight = startRect.height - deltaY * 2;
      }

      // Apply minimum size constraints
      const minSize = 100;
      newWidth = Math.max(minSize, newWidth);
      newHeight = Math.max(minSize, newHeight);

      // Apply maximum size constraints (viewport bounds) with symmetric resizing
      const maxWidth = 2 * Math.min(centerX, window.innerWidth - centerX);
      const maxHeight = 2 * Math.min(centerY, window.innerHeight - centerY);
      if (Number.isFinite(maxWidth)) {
        newWidth = Math.min(newWidth, maxWidth);
      }
      if (Number.isFinite(maxHeight)) {
        newHeight = Math.min(newHeight, maxHeight);
      }

      newX = centerX - newWidth / 2;
      newY = centerY - newHeight / 2;

      // Apply minimum size constraints
      const maxX = window.innerWidth - newWidth;
      const maxY = window.innerHeight - newHeight;
      newX = Math.max(0, Math.min(maxX, newX));
      newY = Math.max(0, Math.min(maxY, newY));

      // Update capture frame position and size
      captureFrame.style.left = newX + 'px';
      captureFrame.style.top = newY + 'px';
      captureFrame.style.width = newWidth + 'px';
      captureFrame.style.height = newHeight + 'px';
    }

    function updateCanvasManagerFrameState() {
      if (window.app && window.app.canvasManager && window.app.canvasManager.fabricCanvas) {
        const canvas = window.app.canvasManager.fabricCanvas;
        const zoom = canvas.getZoom() || 1;
        const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        const panX = vpt[4];
        const panY = vpt[5];

        const rect = captureFrame.getBoundingClientRect();
        // We need the style values (relative to viewport), not getBoundingClientRect (which is also relative to viewport but includes transforms if any)
        // Actually, captureFrame is fixed position (or absolute), so style.left/top are what we want.
        // But style.left might be unset or 'px'.
        // Let's use parseFloat(style.left) as we set it explicitly during drag/resize.

        const currentLeft = parseFloat(captureFrame.style.left) || 0;
        const currentTop = parseFloat(captureFrame.style.top) || 0;
        const currentWidth = parseFloat(captureFrame.style.width) || captureFrame.offsetWidth;
        const currentHeight = parseFloat(captureFrame.style.height) || captureFrame.offsetHeight;

        window.app.canvasManager.baseFrameState = {
          width: currentWidth / zoom,
          height: currentHeight / zoom,
          left: (currentLeft - panX) / zoom,
          top: (currentTop - panY) / zoom,
        };
        console.log(
          '[FRAME] Updated CanvasManager baseFrameState:',
          window.app.canvasManager.baseFrameState
        );
      }
    }

    function stopResize() {
      isResizing = false;
      currentHandle = null;
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', stopResize);

      // Update CanvasManager state
      updateCanvasManagerFrameState();

      // Save per-image frame when resizing ends
      if (
        typeof window.currentImageLabel !== 'undefined' &&
        typeof window.saveCurrentCaptureFrameForLabel === 'function'
      ) {
        window.saveCurrentCaptureFrameForLabel(window.currentImageLabel);

        // Store the frame dimensions as a ratio of canvas size
        const canvas = document.getElementById('canvas');
        const frameRect = captureFrame.getBoundingClientRect();

        if (!window.manualFrameRatios) {
          window.manualFrameRatios = {};
        }

        window.manualFrameRatios[window.currentImageLabel] = {
          widthRatio: frameRect.width / canvas.clientWidth,
          heightRatio: frameRect.height / canvas.clientHeight,
          leftRatio: frameRect.left / canvas.clientWidth,
          topRatio: frameRect.top / canvas.clientHeight,
        };

        console.log(
          `[FRAME] Saved ${window.currentImageLabel} frame ratios: ${(window.manualFrameRatios[window.currentImageLabel].widthRatio * 100).toFixed(1)}% width, ${(window.manualFrameRatios[window.currentImageLabel].heightRatio * 100).toFixed(1)}% height`
        );
      }
    }

    // Optimized capture frame dragging - 1:1 movement with no lag
    let isCaptureDragging = false;
    let captureDragOffset = { x: 0, y: 0 };
    let lastCaptureMousePos = { x: 0, y: 0 };
    let captureRafId = null;

    captureFrame.addEventListener('mousedown', e => {
      // Don't drag if locked, clicking on handles, or buttons
      if (
        isCaptureLocked ||
        e.target.classList.contains('resize-handle') ||
        e.target.closest('button')
      ) {
        return;
      }

      // Allow Shift+click to pass through for canvas dragging
      if (e.shiftKey) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      isCaptureDragging = true;

      const rect = captureFrame.getBoundingClientRect();
      captureDragOffset.x = e.clientX - rect.left;
      captureDragOffset.y = e.clientY - rect.top;

      // Add dragging class for no transitions
      captureFrame.classList.add('dragging');

      document.addEventListener('mousemove', handleCaptureDrag, { passive: true });
      document.addEventListener('mouseup', stopCaptureDrag);
    });

    function handleCaptureDrag(e) {
      if (!isCaptureDragging || isCaptureLocked) return;

      // Store mouse position for RAF
      lastCaptureMousePos.x = e.clientX;
      lastCaptureMousePos.y = e.clientY;

      // Cancel previous RAF if still pending
      if (captureRafId) {
        cancelAnimationFrame(captureRafId);
      }

      // Schedule position update for next frame
      captureRafId = requestAnimationFrame(updateCapturePosition);
    }

    function updateCapturePosition() {
      if (!isCaptureDragging) return;

      const newX = Math.max(
        0,
        Math.min(
          window.innerWidth - captureFrame.offsetWidth,
          lastCaptureMousePos.x - captureDragOffset.x
        )
      );
      const newY = Math.max(
        0,
        Math.min(
          window.innerHeight - captureFrame.offsetHeight,
          lastCaptureMousePos.y - captureDragOffset.y
        )
      );

      // Apply position immediately
      captureFrame.style.left = newX + 'px';
      captureFrame.style.top = newY + 'px';

      captureRafId = null;
    }

    function stopCaptureDrag() {
      if (!isCaptureDragging) return;

      isCaptureDragging = false;

      // Cancel any pending RAF
      if (captureRafId) {
        cancelAnimationFrame(captureRafId);
        captureRafId = null;
      }

      // Remove dragging class
      captureFrame.classList.remove('dragging');

      document.removeEventListener('mousemove', handleCaptureDrag);
      document.removeEventListener('mouseup', stopCaptureDrag);

      // Update CanvasManager state
      updateCanvasManagerFrameState();

      // Save per-image frame when dragging ends
      if (
        typeof window.currentImageLabel !== 'undefined' &&
        typeof window.saveCurrentCaptureFrameForLabel === 'function'
      ) {
        window.saveCurrentCaptureFrameForLabel(window.currentImageLabel);
      }
    }

    // Expose lock state getter
    window.getCaptureFrameLockState = function () {
      return isCaptureLocked;
    };

    window.setCaptureFrameLockState = function (locked) {
      if (isCaptureLocked !== locked) {
        toggleCaptureLock();
      }
    };
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCaptureFrame);
  } else {
    initCaptureFrame();
  }
})();
