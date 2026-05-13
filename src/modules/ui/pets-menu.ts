// Pets Menu — Ctrl+Shift+P overlay for browsing, buying, equipping pixel pets
// Follows the help menu overlay pattern (fixed, z-index 10000, backdrop, Escape)

import { authService } from '@/services/auth/authService';
import { walletService, type PetCatalogEntry } from '@/services/wallet/walletService';
import { petFollowerRenderer } from '@/services/pets/petFollowerRenderer';
import { buildPetConfig } from '@/services/pets/petConfig';

let overlayEl: HTMLElement | null = null;

function renderPetPreview(petId: string): HTMLCanvasElement {
  const config = buildPetConfig(petId);
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  canvas.style.cssText = 'width:48px;height:48px;image-rendering:pixelated;';

  if (!config) return canvas;

  const img = new Image();
  img.src = config.animations.idle.path;
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      // Draw first frame of idle
      ctx.drawImage(img, 0, 0, config.frameSize, config.frameSize, 0, 0, 48, 48);
    }
  };

  return canvas;
}

function createPetCard(pet: PetCatalogEntry, state: 'locked' | 'owned' | 'equipped'): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = `
    background: ${state === 'equipped' ? '#eef6ff' : '#f9fafb'};
    border: 2px solid ${state === 'equipped' ? '#3b82f6' : '#e5e7eb'};
    border-radius: 10px;
    padding: 12px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    transition: border-color 0.2s;
  `;

  // Preview
  const preview = renderPetPreview(pet.id);
  card.appendChild(preview);

  // Name
  const name = document.createElement('div');
  name.textContent = pet.name;
  name.style.cssText = 'font-size:12px;font-weight:600;color:#374151;';
  card.appendChild(name);

  // Action button
  const btn = document.createElement('button');
  btn.style.cssText = `
    border: none;
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  `;

  if (state === 'locked') {
    btn.style.background = '#f59e0b';
    btn.style.color = 'white';
    btn.textContent = `Buy (${pet.cost} coins)`;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Buying...';
      walletService
        .purchasePet(pet.id)
        .then(ok => {
          if (ok) {
            refreshMenu();
          } else {
            btn.textContent = 'Failed';
            setTimeout(() => {
              btn.textContent = `Buy (${pet.cost} coins)`;
              btn.disabled = false;
            }, 1500);
          }
        })
        .catch(() => {
          btn.disabled = false;
        });
    });
  } else if (state === 'owned') {
    btn.style.background = '#3b82f6';
    btn.style.color = 'white';
    btn.textContent = 'Equip';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      walletService
        .equipPet(pet.id)
        .then(ok => {
          if (ok) {
            petFollowerRenderer
              .mount(pet.id)
              .then(() => closePetsMenu())
              .catch(() => closePetsMenu());
          }
        })
        .catch(() => {
          btn.disabled = false;
        });
    });
  } else {
    // equipped
    btn.style.background = '#ef4444';
    btn.style.color = 'white';
    btn.textContent = 'Unequip';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      walletService
        .equipPet(null)
        .then(() => {
          petFollowerRenderer.unmount();
          refreshMenu();
        })
        .catch(() => {
          btn.disabled = false;
        });
    });
  }

  card.appendChild(btn);
  return card;
}

function refreshMenu(): void {
  if (overlayEl) {
    closePetsMenu();
    openPetsMenu();
  }
}

function openPetsMenu(): void {
  const overlay = document.createElement('div');
  overlay.id = 'petsMenuOverlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.7);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const menuCard = document.createElement('div');
  menuCard.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 560px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
  `;

  if (!authService.isAuthenticated()) {
    menuCard.innerHTML = `
      <h2 style="margin:0 0 16px;color:#333;font-size:20px;">Pixel Pets</h2>
      <p style="color:#666;font-size:14px;">Sign in with Google to unlock pixel pets that follow your cursor!</p>
      <div style="text-align:center;margin-top:20px;">
        <button id="closePetsMenu" style="background:#3b82f6;color:white;border:none;padding:8px 20px;border-radius:6px;font-size:14px;cursor:pointer;">Close</button>
      </div>
    `;
    overlay.appendChild(menuCard);
    document.body.appendChild(overlay);
    overlayEl = overlay;

    menuCard.querySelector('#closePetsMenu')?.addEventListener('click', closePetsMenu);
    setupMenuCloseHandlers(overlay);
    return;
  }

  // Header with balance
  const state = walletService.getState();
  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;';
  header.innerHTML = `
    <h2 style="margin:0;color:#333;font-size:20px;">Pixel Pets</h2>
    <div style="display:flex;align-items:center;gap:6px;background:rgba(255,215,0,0.15);border:1px solid rgba(255,215,0,0.4);border-radius:16px;padding:4px 12px;">
      <span style="font-size:16px;font-weight:700;color:#b8860b;">${state.balance}</span>
      <span style="font-size:12px;color:#b8860b;">coins</span>
    </div>
  `;
  menuCard.appendChild(header);

  // Pet grid
  const grid = document.createElement('div');
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;';

  const catalog = state.catalog.length > 0 ? state.catalog : [];
  for (const pet of catalog) {
    let cardState: 'locked' | 'owned' | 'equipped';
    if (state.equippedPet === pet.id) {
      cardState = 'equipped';
    } else if (state.unlockedPets.includes(pet.id)) {
      cardState = 'owned';
    } else {
      cardState = 'locked';
    }
    grid.appendChild(createPetCard(pet, cardState));
  }

  menuCard.appendChild(grid);

  // Close button
  const closeArea = document.createElement('div');
  closeArea.style.cssText = 'text-align:center;margin-top:20px;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText =
    'background:#6b7280;color:white;border:none;padding:8px 20px;border-radius:6px;font-size:14px;cursor:pointer;';
  closeBtn.addEventListener('click', closePetsMenu);
  closeArea.appendChild(closeBtn);
  menuCard.appendChild(closeArea);

  overlay.appendChild(menuCard);
  document.body.appendChild(overlay);
  overlayEl = overlay;

  setupMenuCloseHandlers(overlay);
}

function setupMenuCloseHandlers(overlay: HTMLElement): void {
  // Close on backdrop click
  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) closePetsMenu();
  });

  // Close on Escape
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closePetsMenu();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

function closePetsMenu(): void {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

export function togglePetsMenu(): void {
  if (overlayEl) {
    closePetsMenu();
  } else {
    openPetsMenu();
  }
}
