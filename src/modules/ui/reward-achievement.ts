let stylesInjected = false;

function ensureStyles(): void {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.textContent = `
    .reward-achievement {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483000;
      min-width: 260px;
      max-width: min(420px, calc(100vw - 32px));
      border-radius: 12px;
      padding: 12px 14px;
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.28);
      border: 1px solid #f59e0b;
      background: linear-gradient(145deg, #fff7da 0%, #fde68a 45%, #fcd34d 100%);
      color: #7c2d12;
      transform: translateY(14px) scale(0.98);
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.24s ease;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .reward-achievement.visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    .reward-achievement-title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .reward-achievement-msg {
      margin: 4px 0 0;
      font-size: 14px;
      font-weight: 600;
      color: #6b210f;
    }

    .reward-achievement-icon {
      width: 24px;
      height: 24px;
      image-rendering: pixelated;
      flex: 0 0 auto;
    }

    .reward-achievement-text {
      min-width: 0;
    }

    @media (max-width: 640px) {
      .reward-achievement {
        left: 12px;
        right: 12px;
        min-width: 0;
      }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function createGemIconCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'reward-achievement-icon';
  const img = new Image();
  img.src = '/assets/coins/spr_coin_strip4.png';
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, 16, 16, 0, 0, size, size);
  };
  return canvas;
}

function positionAchievementPopup(popup: HTMLElement): void {
  const quickNav = document.getElementById('mini-stepper');
  const quickNavStyle = quickNav ? window.getComputedStyle(quickNav) : null;
  const quickNavVisible =
    !!quickNav &&
    !!quickNavStyle &&
    quickNavStyle.display !== 'none' &&
    quickNavStyle.visibility !== 'hidden' &&
    quickNav.getClientRects().length > 0;

  if (!quickNavVisible) {
    popup.style.bottom = window.innerWidth <= 640 ? '12px' : '18px';
    return;
  }

  const quickNavRect = quickNav.getBoundingClientRect();
  const spaceNeeded = Math.max(window.innerHeight - quickNavRect.top + 12, 18);
  popup.style.bottom = `${Math.round(spaceNeeded)}px`;
}

export function showRewardAchievement(message: string): void {
  ensureStyles();
  const existing = document.getElementById('rewardAchievement');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'rewardAchievement';
  popup.className = 'reward-achievement';

  const textWrap = document.createElement('div');
  textWrap.className = 'reward-achievement-text';
  const title = document.createElement('p');
  title.className = 'reward-achievement-title';
  title.textContent = 'Achievement unlocked';
  const details = document.createElement('p');
  details.className = 'reward-achievement-msg';
  details.textContent = message;
  textWrap.appendChild(title);
  textWrap.appendChild(details);

  popup.appendChild(createGemIconCanvas(24));
  popup.appendChild(textWrap);
  positionAchievementPopup(popup);
  document.body.appendChild(popup);

  requestAnimationFrame(() => popup.classList.add('visible'));
  setTimeout(() => {
    popup.classList.remove('visible');
    setTimeout(() => popup.remove(), 260);
  }, 2600);
}

export function getNoRewardMessage(reason?: string): string {
  if (reason === 'cooldown') return 'Save completed. No gems this time (cooldown active).';
  if (reason === 'daily_cap') return 'Save completed. Daily gem cap reached.';
  if (reason === 'already_earned') return 'Save completed. Gems already earned for this save.';
  if (reason === 'not_qualifying')
    return 'Save completed. No gems awarded: add at least one mark on an image.';
  if (reason === 'insufficient_new_marks')
    return 'Save completed. No gems awarded: add at least 2 new lines before next reward.';
  if (reason === 'pdf_cooldown') return 'PDF exported. No gems this time (PDF cooldown active).';
  return 'Save completed. No gems awarded this time.';
}
