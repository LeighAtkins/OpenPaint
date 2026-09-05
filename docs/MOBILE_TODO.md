# Mobile Interface Implementation Plan

## Known Issues

1. **Touch Events** - Not implemented
   - Need `touchstart`, `touchmove`, `touchend` handlers
   - Need pinch-to-zoom gesture support

2. **Mobile-Responsive Toolbar**
   - Fixed height (48px) causes issues on mobile
   - Should be `height: auto` with min/max constraints
   - Touch-friendly targets (min 48x48px)

3. **Mobile Panel State**
   - Panels use `isMobileDevice()` check
   - Should respond properly to viewport changes on mobile
   - Auto-collapse on mobile portrait

## Required Changes

### src/modules/ui/panel-management.ts
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
  }
}

// Listen to viewport changes
window.addEventListener('resize', debounce(handleViewportChangeForMobile, 200));
```

### src/modules/ui/image-gallery.ts
```typescript
// Touch event support
document.addEventListener('touchstart', (e) => {
  e.preventDefault();
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

### public/css/obscura-tokens.css
```css
/* Mobile-responsive toolbar */
@media (max-width: 768px) {
  #topToolbar {
    height: auto;
    min-height: 48px;
    max-height: 60px;
    padding: 8px 12px;
  }
}

/* Touch device adjustments */
@media (hover: none) and (max-width: 768px) {
  .tool-button {
    transform: scale(1.02); /* Subtle feedback for touch devices */
  }

  .slider input[type=range] {
    height: 48px; /* Easier to grab on mobile */
  }
}
```

## Priority

1. **High Priority:** Touch events and pinch-to-zoom (critical for mobile drawing)
2. **Medium Priority:** Mobile-responsive toolbar
3. **Low Priority:** Mobile panel state optimization

## Next Steps

1. Review existing `isMobileDevice()` implementation
2. Add touch event handlers to `src/modules/main.ts`
3. Add pinch-to-zoom gesture support
4. Update CSS for mobile toolbar
5. Test on actual mobile devices (emulation or real device)

## Notes

- Coding agent (Codex) cannot access OpenClaw workspace files due to sandbox restrictions
- Manual implementation required for now
- Future: Fix coding agent access or implement mobile features manually
