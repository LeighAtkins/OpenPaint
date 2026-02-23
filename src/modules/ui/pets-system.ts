// Pets System — registers Ctrl+Shift+P shortcut, auto-mounts equipped pet on login

import { isAuthEnabled } from '@/utils/env';
import { authService } from '@/services/auth/authService';
import { walletService } from '@/services/wallet/walletService';
import { petFollowerRenderer } from '@/services/pets/petFollowerRenderer';
import { togglePetsMenu } from './pets-menu';

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
}
