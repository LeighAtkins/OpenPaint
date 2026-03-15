// Pets System — registers Ctrl+Shift+P shortcut, auto-mounts equipped pet on login

import { isAuthEnabled } from '@/utils/env';
import { authService } from '@/services/auth/authService';
import { walletService } from '@/services/wallet/walletService';
import { petFollowerRenderer } from '@/services/pets/petFollowerRenderer';
import { togglePetsMenu } from './pets-menu';

const RED_SWATCH_SELECTOR = '[data-color="#ef4444"]';
const TOY_DRAG_THRESHOLD = 6;

export function initPetsSystem(): void {
  if (!isAuthEnabled()) return;

  // Register Ctrl+Shift+P keyboard shortcut
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Don't interfere if typing in input fields
    const target = e.target as HTMLElement | null;
    if (
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable
    ) {
      return;
    }

    const key = (e.key || '').toLowerCase();
    const isPetsShortcut = (e.ctrlKey || e.metaKey) && e.shiftKey && key === 'p';
    if (isPetsShortcut && !e.repeat) {
      e.preventDefault();
      togglePetsMenu();
    }
  });

  // Auto-mount equipped pet on login, unmount on logout
  authService.onAuthStateChange(user => {
    if (user) {
      // Wait for wallet to load, then mount equipped pet
      const unsub = walletService.onChange(state => {
        if (state.equippedPet && !petFollowerRenderer.isMounted()) {
          petFollowerRenderer.mount(state.equippedPet);
        }
        unsub();
      });
    } else {
      // Logout: unmount pet and clear wallet
      petFollowerRenderer.unmount();
      walletService.clear();
    }
  });

  // Wake the pet after a project load so it doesn't appear frozen
  window.addEventListener('openpaint:project-loaded', () => {
    petFollowerRenderer.nudge();
  });

  initRedSwatchToyDrag();
}

function initRedSwatchToyDrag(): void {
  let draggingMouse = false;
  let startX = 0;
  let startY = 0;
  let dragStarted = false;
  let dragConsumedClick = false;
  let swatchEl: HTMLElement | null = null;

  const getRenderer = (): typeof petFollowerRenderer | null => {
    const globalRenderer = (window as any).__petFollowerRenderer as
      | typeof petFollowerRenderer
      | null;
    if (globalRenderer && globalRenderer.isMounted()) return globalRenderer;
    if (petFollowerRenderer.isMounted()) return petFollowerRenderer;
    return null;
  };

  const cleanup = () => {
    if (swatchEl) swatchEl.style.opacity = '';
    draggingMouse = false;
    dragStarted = false;
    window.removeEventListener('mousemove', handleMouseMove, true);
    window.removeEventListener('mouseup', handleMouseUp, true);
    window.removeEventListener('blur', handleMouseCancel, true);
  };

  const suppressClickIfNeeded = (event: MouseEvent) => {
    if (!dragConsumedClick) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest?.(RED_SWATCH_SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    dragConsumedClick = false;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!draggingMouse) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    if (!dragStarted && moved >= TOY_DRAG_THRESHOLD) {
      dragStarted = true;
      dragConsumedClick = true;
      const rect = swatchEl?.getBoundingClientRect();
      const homeX = rect ? rect.left + rect.width / 2 : event.clientX;
      const homeY = rect ? rect.top + rect.height / 2 : event.clientY;
      const renderer = getRenderer();
      if (!renderer) {
        cleanup();
        return;
      }
      renderer.startToyDrag(event.clientX, event.clientY, homeX, homeY);
      if (!renderer.isToyActive()) {
        cleanup();
        return;
      }
      // Hide swatch to prevent visual doubling
      if (swatchEl) swatchEl.style.opacity = '0';
    }
    if (dragStarted) {
      event.preventDefault();
      const renderer = getRenderer();
      if (!renderer) {
        cleanup();
        return;
      }
      renderer.moveToyDrag(event.clientX, event.clientY);
    }
  };

  const handleMouseUp = (event: MouseEvent) => {
    if (!draggingMouse) return;
    if (dragStarted) {
      event.preventDefault();
      getRenderer()?.endToyDrag();
    }
    cleanup();
  };

  const handleMouseCancel = () => {
    if (!draggingMouse) return;
    getRenderer()?.cancelToyDrag();
    cleanup();
  };

  document.addEventListener(
    'mousedown',
    event => {
      if (draggingMouse || event.button !== 0) return;
      if (!getRenderer()) return;
      const target = event.target as HTMLElement | null;
      const swatch = target?.closest?.(RED_SWATCH_SELECTOR) as HTMLElement | null;
      if (!swatch) return;
      draggingMouse = true;
      startX = event.clientX;
      startY = event.clientY;
      swatchEl = swatch;
      dragStarted = false;
      window.addEventListener('mousemove', handleMouseMove, true);
      window.addEventListener('mouseup', handleMouseUp, true);
      window.addEventListener('blur', handleMouseCancel, true);
    },
    true
  );

  document.addEventListener('click', suppressClickIfNeeded, true);
  document.addEventListener(
    'dragstart',
    event => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(RED_SWATCH_SELECTOR)) {
        event.preventDefault();
      }
    },
    true
  );
}
