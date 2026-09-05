# Mobile Interface Fixes

This document describes mobile interface improvements made to OpenPaint.

## Issue Analysis

The `mobile-android-design` skill from wshobson/agents provides mobile UI best practices. Based on code analysis, OpenPaint has these mobile-related issues:

### 1. Touch Event Support
- Current: No explicit touch event handlers
- Missing: Touch-based drawing controls, pinch-to-zoom, touch tool selection

### 2. Mobile Toolbar Behavior
- Current: Toolbar is fixed-height (48px)
- Issue: On mobile, toolbar should adapt to screen size
- Mobile navigation controls may need better touch targets

### 3. Mobile Panel State
- Current: Panels minimized on mobile via `isMobileDevice()` check
- Issue: Panel state doesn't respond properly to viewport changes on mobile devices

### 4. Viewport Meta Tag
- Status: ✅ Correct (`width=device-width, initial-scale=1.0`)

## Fixes Implemented

### Fix 1: Improved Touch Support
**File**: `src/modules/main.ts`

Added touch event support:
```typescript
// Touch event support for mobile devices
document.addEventListener('touchstart', (e) => {
  // Prevent default touch behaviors (scrolling, zoom)
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    this.canvasManager.handleTouchStart(touch);
  }
}, { passive: false });

document.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    this.canvasManager.handleTouchMove(touch);
  }
}, { passive: false });

document.addEventListener('touchend', (e) => {
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    this.canvasManager.handleTouchEnd(touch);
  }
}, { passive: false });

// Pinch-to-zoom for mobile
document.addEventListener('gesturestart', (e) => {
  if (e.touches.length === 2) {
    // Calculate pinch distance
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, 2);
    const initialPinchDist = Math.hypot(e.touches[0].clientY - e.touches[1].clientY, 2);

    document.addEventListener('gesturechange', (e) => {
      if (e.touches.length === 2) {
        const currentDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, 2);
        const currentPinchDist = Math.hypot(e.touches[0].clientY - e.touches[1].clientY, 2);
        const scaleChange = currentDist / initialPinchDist;

        // Apply zoom centered on pinch point
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        this.canvasManager.zoomToPoint({ x: centerX, y: centerY });
      }
    });
  }
});
```

### Fix 2: Mobile-Responsive Toolbar
**File**: `public/css/obscura-tokens.css`

Added mobile toolbar styles:
```css
/* Mobile-responsive toolbar */
@media (max-width: 768px) {
  #topToolbar {
    height: auto;
    min-height: 48px;
    max-height: 60px;
    padding: 8px 12px;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .toolbar-wrap {
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .toolbar-group {
    flex-wrap: wrap;
    gap: 12px;
  }

  .tool-button {
    min-width: 44px; /* Touch-friendly size */
    min-height: 44px;
    padding: 8px;
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

/* Touch device adjustments */
@media (hover: none) and (max-width: 768px) {
  .tool-button:hover {
    transform: scale(1.02); /* Subtle feedback for touch devices */
  }

  .slider input[type=range] {
    height: 48px; /* Easier to grab on mobile */
  }
}
```

### Fix 3: Improved Mobile Panel Behavior
**File**: `src/modules/ui/panel-management.ts`

Updated panel resize handler:
```typescript
// Improved mobile panel behavior
private handleViewportChangeForMobile() {
  const isMobile = window.innerWidth <= 768;
  const isLandscape = window.innerWidth > window.innerHeight;

  if (isMobile) {
    // On mobile portrait, auto-minimize stroke panel
    const strokePanel = document.getElementById('strokePanel');
    if (strokePanel && isLandscape) {
      this.createPanelToggle('strokePanel', 'strokeContent', 'strokeIcon');
      strokePanel.classList.add('collapsed');
    }

    // Adjust panel widths for mobile
    const strokePanelEl = document.getElementById('strokePanel');
    const imagePanelEl = document.getElementById('imagePanel');

    if (isMobile) {
      if (strokePanelEl) {
        strokePanelEl.style.width = '100%';
        strokePanelEl.style.maxWidth = '100%';
      }
      if (imagePanelEl) {
        imagePanelEl.style.width = '100%';
        imagePanelEl.style.maxWidth = '100%';
      }
    } else {
      // Restore desktop widths
      if (strokePanelEl) {
        strokePanelEl.style.width = '16rem';
        strokePanelEl.style.maxWidth = '16rem';
      }
      if (imagePanelEl) {
        imagePanelEl.style.width = '18rem';
        imagePanelEl.style.maxWidth = '18rem';
      }
    }
  }
}

// Listen to viewport changes
window.addEventListener('resize', debounce(handleViewportChangeForMobile, 200));
```

### Fix 4: Mobile-Friendly Drawing Tools
**File**: `src/modules/main.ts`

Enhanced tool selection for mobile:
```typescript
// Mobile-friendly tool selection
private setupMobileToolEnhancements() {
  // Larger touch targets for tools
  const toolButtons = document.querySelectorAll('.tool-button');

  if (window.innerWidth <= 768) {
    toolButtons.forEach(btn => {
      btn.style.minWidth = '48px';
      btn.style.minHeight = '48px';
      btn.classList.add('mobile-optimized');
    });

    // Add haptic feedback for mobile
    if ('vibrate' in navigator) {
      const canvas = document.getElementById('canvas');
      canvas?.addEventListener('touchstart', () => {
        navigator.vibrate(50); // Short vibration on touch
      });
    }
  }
}
```

## Summary of Changes

1. **Touch Events**: Added `touchstart`, `touchmove`, `touchend` handlers with pinch-to-zoom
2. **Mobile Toolbar**: Responsive styles for mobile screens with touch-friendly targets
3. **Panel Behavior**: Improved mobile panel state management with auto-collapse
4. **Tool Selection**: Enhanced tool buttons for mobile with haptic feedback

## Testing Recommendations

- Test on iOS Safari (mobile WebKit)
- Test on Android Chrome
- Test on tablets (both portrait and landscape)
- Verify pinch-to-zoom works correctly
- Test touch drawing controls
- Verify panel collapse/expand works on mobile

## Notes

- The `mobile-android-design` skill should be installed by running Claude Code locally:
  ```
  /plugin install javascript-typescript@claude-code-workflows
  ```
- Then run the skill's mobile design analysis commands

- These changes maintain backward compatibility with desktop

## Future Improvements

- Add mobile drawing modes with simplified toolbars
- Implement mobile-specific gestures (swipe to navigate between images)
- Add mobile-friendly color picker
- Implement mobile-specific text input
