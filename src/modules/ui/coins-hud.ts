// Coins HUD — small pill in toolbar showing coin balance
// Gated by isAuthEnabled(), subscribes to auth + wallet state

import { isAuthEnabled } from '@/utils/env';
import { authService } from '@/services/auth/authService';
import { walletService } from '@/services/wallet/walletService';
import { togglePetsMenu } from './pets-menu';

let hudEl: HTMLElement | null = null;
let balanceEl: HTMLElement | null = null;
let coinIconCanvas: HTMLCanvasElement | null = null;

function createCoinIcon(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  canvas.style.cssText = 'width:16px;height:16px;image-rendering:pixelated;vertical-align:middle;';

  const img = new Image();
  img.src = '/assets/coins/spr_coin_strip4.png';
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 16, 16);
      ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16);
    }
  };

  return canvas;
}

function createHud(): HTMLElement {
  const pill = document.createElement('div');
  pill.id = 'coinsHud';
  pill.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: rgba(255, 215, 0, 0.15);
    border: 1px solid rgba(255, 215, 0, 0.4);
    border-radius: 12px;
    font-size: 13px;
    font-weight: 600;
    color: #b8860b;
    cursor: pointer;
    user-select: none;
    transition: transform 0.2s ease;
    margin-right: 4px;
  `;

  coinIconCanvas = createCoinIcon();
  pill.appendChild(coinIconCanvas);

  balanceEl = document.createElement('span');
  balanceEl.textContent = '0';
  pill.appendChild(balanceEl);

  pill.title = 'Pixel Pets (Ctrl+Shift+P)';
  pill.addEventListener('click', () => togglePetsMenu());

  return pill;
}

export function animateCoinEarned(): void {
  if (!hudEl) return;
  hudEl.style.transform = 'scale(1.3)';
  setTimeout(() => {
    if (hudEl) hudEl.style.transform = 'scale(1)';
  }, 300);
}

export function getHudElement(): HTMLElement | null {
  return hudEl;
}

export function initCoinsHud(): void {
  if (!isAuthEnabled()) return;

  hudEl = createHud();
  hudEl.style.display = 'none';

  const tbLeft = document.getElementById('tbLeft');
  if (tbLeft) {
    tbLeft.insertBefore(hudEl, tbLeft.firstChild);
  }

  // Show/hide based on auth state
  authService.onAuthStateChange(user => {
    if (!hudEl) return;
    if (user) {
      hudEl.style.display = 'inline-flex';
      void walletService.loadWallet();
    } else {
      hudEl.style.display = 'none';
      walletService.clear();
    }
  });

  const refreshWalletIfVisible = () => {
    if (!hudEl || hudEl.style.display === 'none' || !authService.isAuthenticated()) {
      return;
    }
    if (!walletService.isLoaded()) {
      void walletService.loadWallet();
    }
  };

  window.addEventListener('focus', refreshWalletIfVisible);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshWalletIfVisible();
    }
  });

  // Update balance reactively
  walletService.onChange(state => {
    if (balanceEl) {
      balanceEl.textContent = String(state.balance);
    }
  });
}
