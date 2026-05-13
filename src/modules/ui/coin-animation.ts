// Coin fly animation — temporary coin sprite flies from screen center to HUD pill

import { getHudElement, animateCoinEarned } from './coins-hud';

export function playCoinFlyAnimation(): void {
  const hud = getHudElement();
  if (!hud) {
    animateCoinEarned();
    return;
  }

  const coin = document.createElement('div');
  coin.style.cssText = `
    position: fixed;
    width: 32px;
    height: 32px;
    z-index: 9999;
    pointer-events: none;
    image-rendering: pixelated;
    transition: all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  `;

  // Render coin sprite
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  canvas.style.cssText = 'width:32px;height:32px;image-rendering:pixelated;';

  const img = new Image();
  img.src = '/assets/coins/spr_coin_strip4.png';
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32);
    }
  };
  coin.appendChild(canvas);

  // Start at screen center
  const startX = window.innerWidth / 2 - 16;
  const startY = window.innerHeight / 2 - 16;
  coin.style.left = `${startX}px`;
  coin.style.top = `${startY}px`;
  coin.style.opacity = '1';

  document.body.appendChild(coin);

  // Fly to HUD position
  requestAnimationFrame(() => {
    const hudRect = hud.getBoundingClientRect();
    coin.style.left = `${hudRect.left + hudRect.width / 2 - 16}px`;
    coin.style.top = `${hudRect.top + hudRect.height / 2 - 16}px`;
    coin.style.transform = 'scale(0.5)';
    coin.style.opacity = '0.6';
  });

  // Remove after animation + trigger HUD pulse
  setTimeout(() => {
    coin.remove();
    animateCoinEarned();
  }, 650);
}
