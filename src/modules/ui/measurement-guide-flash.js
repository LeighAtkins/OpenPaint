const HOTKEY = 'Backslash';
const VIEWS = ['Front', 'Back', 'Side'];
const FLASH_DURATION_MS = 1200;
const GUIDE_HINT_KEY = 'openpaint:guideFlashHintSeen:v1';
const GUIDE_CACHE_KEY = '2026-02-11-1';

let flashOverlay = null;
let galleryOverlay = null;
let hideTimer = null;
let activeIndex = 0;
let hintToastTimer = null;
let bossKeyHeld = false;

function getMetadata() {
  return window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
}

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .toUpperCase();
}

function parseCodes(value) {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map(item => normalizeCode(item))
        .filter(Boolean)
    )
  );
}

function resolveGuideCodes() {
  const metadata = getMetadata();
  const fromArray = Array.isArray(metadata.measurementGuideCodes)
    ? metadata.measurementGuideCodes.map(code => normalizeCode(code)).filter(Boolean)
    : [];
  if (fromArray.length) {
    return fromArray;
  }
  const fallback =
    metadata.measurementGuideCode ||
    metadata.customSofaType ||
    metadata?.naming?.sofaTypeLabel ||
    '';
  return parseCodes(fallback);
}

function isTypingContext(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.closest('[contenteditable="true"]') !== null
  );
}

function ensureStyles() {
  if (document.getElementById('measurementGuideFlashStyles')) return;
  const style = document.createElement('style');
  style.id = 'measurementGuideFlashStyles';
  style.textContent = `
    .guide-flash-overlay {
      position: fixed;
      inset: 12px 12px auto auto;
      width: min(860px, calc(100vw - 24px));
      z-index: 13300;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 14px;
      box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
      backdrop-filter: blur(7px);
      color: #0f172a;
      transform: translateY(-6px) scale(0.98);
      opacity: 0;
      transition: opacity 120ms ease, transform 120ms ease;
      pointer-events: none;
    }
    .guide-flash-overlay.visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .guide-flash-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px 8px;
      border-bottom: 1px solid rgba(203, 213, 225, 0.6);
    }
    .guide-flash-title { font-size: 13px; font-weight: 700; letter-spacing: .02em; color: #0f172a; }
    .guide-flash-sub { font-size: 11px; color: #64748b; }
    .guide-flash-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 10px;
    }
    .guide-flash-card {
      background: #f8fafc;
      border: 1px solid rgba(203, 213, 225, 0.6);
      border-radius: 10px;
      overflow: hidden;
      min-height: 170px;
      display: flex;
      flex-direction: column;
    }
    .guide-flash-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
      padding: 7px 9px;
      border-bottom: 1px solid rgba(203, 213, 225, 0.6);
      color: #475569;
    }
    .guide-flash-body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      background: #ffffff;
    }
    .guide-flash-body img { width: 100%; height: 100%; max-height: 220px; object-fit: contain; }
    .guide-flash-empty { font-size: 11px; color: #94a3b8; text-align: center; }
    @media (max-width: 900px) {
      .guide-flash-grid { grid-template-columns: 1fr; }
      .guide-flash-card { min-height: 140px; }
    }

    .guide-flash-toast {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 13320;
      max-width: min(460px, calc(100vw - 24px));
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 10px;
      box-shadow: 0 14px 28px rgba(2, 6, 23, 0.45);
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.35;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 140ms ease, transform 140ms ease;
      pointer-events: none;
    }
    .guide-flash-toast.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .guide-gallery-overlay {
      position: fixed;
      inset: 0;
      z-index: 13400;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      opacity: 0;
      transition: opacity 150ms ease;
      pointer-events: none;
      overflow-y: auto;
    }
    .guide-gallery-overlay.visible {
      opacity: 1;
      pointer-events: all;
    }
    .guide-gallery-container {
      max-width: 1400px;
      margin: 40px auto;
      padding: 0 20px 40px;
    }
    .guide-gallery-header {
      background: rgba(255, 255, 255, 0.98);
      border-radius: 14px;
      padding: 20px 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    .guide-gallery-title {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 12px;
    }
    .guide-gallery-search {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .guide-gallery-search:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    .guide-gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .guide-gallery-item {
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    .guide-gallery-item:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
    }
    .guide-gallery-item-label {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(203, 213, 225, 0.6);
    }
    .guide-gallery-item-body {
      padding: 12px;
      background: #ffffff;
      min-height: 240px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .guide-gallery-item-body img {
      width: 100%;
      height: auto;
      max-height: 280px;
      object-fit: contain;
    }
    .guide-gallery-close {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      cursor: pointer;
      z-index: 13401;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .guide-gallery-close:hover {
      background: #f1f5f9;
    }
  `;
  document.head.appendChild(style);
}

function shouldShowHintToast() {
  try {
    return localStorage.getItem(GUIDE_HINT_KEY) !== '1';
  } catch {
    return true;
  }
}

function markHintToastShown() {
  try {
    localStorage.setItem(GUIDE_HINT_KEY, '1');
  } catch {
    // no-op
  }
}

function showShortcutToast() {
  if (!shouldShowHintToast()) return;
  ensureStyles();

  let toast = document.getElementById('guideFlashShortcutToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'guideFlashShortcutToast';
    toast.className = 'guide-flash-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = 'Hint: Shift+\\ cycles to next guide image. Ctrl+\\ edits guide codes.';
  requestAnimationFrame(() => toast.classList.add('visible'));

  if (hintToastTimer) {
    clearTimeout(hintToastTimer);
  }
  hintToastTimer = setTimeout(() => {
    toast?.classList.remove('visible');
  }, 2800);

  markHintToastShown();
}

function buildGuideUrl(code, view) {
  return `/api/measurement-guides/svg?code=${encodeURIComponent(code)}&view=${encodeURIComponent(view)}&v=${encodeURIComponent(GUIDE_CACHE_KEY)}`;
}

function attachGuideImageRecovery(root) {
  if (!root) return;
  root.querySelectorAll('img[data-guide-code][data-guide-view]').forEach(img => {
    if (img.dataset.retryBound === '1') return;
    img.dataset.retryBound = '1';
    img.addEventListener('error', () => {
      if (img.dataset.retried === '1') return;
      img.dataset.retried = '1';
      const code = img.dataset.guideCode;
      const view = img.dataset.guideView || 'Front';
      if (!code) return;
      img.src = `${buildGuideUrl(code, view)}&cb=${Date.now()}`;
    });
  });
}

function saveGuideCodes(codes) {
  const manager = window.app?.projectManager;
  const payload = {
    measurementGuideCodes: codes,
    measurementGuideCode: codes[0] || '',
  };
  if (manager?.setProjectMetadata) {
    manager.setProjectMetadata(payload);
    return;
  }
  window.projectMetadata = {
    ...(window.projectMetadata || {}),
    ...payload,
  };
}

function resolveSlides(codes) {
  const slides = [];
  codes.forEach(code => {
    VIEWS.forEach(view => {
      slides.push({ code, view });
    });
  });
  return slides;
}

function ensureOverlay(slide, slideCount) {
  ensureStyles();
  if (!flashOverlay) {
    flashOverlay = document.createElement('section');
    flashOverlay.className = 'guide-flash-overlay';
    document.body.appendChild(flashOverlay);
  }
  const title = `${slide.code} · ${slide.view}`;
  const hint = `${activeIndex + 1}/${slideCount} · \\ show · Shift+\\ next · Ctrl+\\ edit codes`;
  const url = buildGuideUrl(slide.code, slide.view);
  flashOverlay.innerHTML = `
    <div class="guide-flash-head">
      <div class="guide-flash-title">Measurement Guide Flash</div>
      <div class="guide-flash-sub">${hint}</div>
    </div>
    <div class="guide-flash-grid" style="grid-template-columns: 1fr;">
      <article class="guide-flash-card" style="min-height: 360px;">
        <div class="guide-flash-label">${title}</div>
        <div class="guide-flash-body">
          <img src="${url}" alt="${slide.view} model for ${slide.code}" />
        </div>
      </article>
    </div>
  `;
  const img = flashOverlay.querySelector('img');
  if (img) {
    img.dataset.guideCode = slide.code;
    img.dataset.guideView = slide.view;
  }
  attachGuideImageRecovery(flashOverlay);
}

function promptForCodes() {
  const existing = resolveGuideCodes();
  const input = window.prompt(
    'Enter guide code(s), separated by commas (e.g. CS3B-SSA-SB-R, CS4A-LH)',
    existing.join(', ')
  );
  if (typeof input !== 'string') {
    return existing;
  }
  const parsed = parseCodes(input);
  if (!parsed.length) return existing;
  saveGuideCodes(parsed);
  return parsed;
}

function showGuideFlash({ cycleNext = false, holdMode = false } = {}) {
  let codes = resolveGuideCodes();
  if (!codes.length) {
    codes = promptForCodes();
    if (!codes.length) return;
  }

  const slides = resolveSlides(codes);
  if (!slides.length) return;

  if (cycleNext) {
    activeIndex = (activeIndex + 1) % slides.length;
  } else if (activeIndex >= slides.length) {
    activeIndex = 0;
  }

  const slide = slides[activeIndex];
  ensureOverlay(slide, slides.length);

  requestAnimationFrame(() => {
    flashOverlay?.classList.add('visible');
  });

  // In hold mode, don't auto-hide - wait for keyup
  if (!holdMode) {
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(() => {
      hideGuideFlash();
    }, FLASH_DURATION_MS);
  }
}

function hideGuideFlash() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!flashOverlay) return;
  flashOverlay.classList.remove('visible');
}

function showGuideGallery() {
  ensureStyles();

  if (!galleryOverlay) {
    galleryOverlay = document.createElement('div');
    galleryOverlay.className = 'guide-gallery-overlay';
    document.body.appendChild(galleryOverlay);
  }

  // All uploaded guide codes (Worker handles both Front_CODE.svg and CODE.svg)
  const allCodes = [
    'CC-BCH-B',
    'CC-BCH-W',
    'CC-BK-BE',
    'CC-BK-L',
    'CC-BK-T',
    'CC-BK-W',
    'CS1-CNR',
    'CS1-CNR-W',
    'CS1-SRA-HB-L',
    'CS1B-RA-HB',
    'CS1B-RA-RB',
    'CS1B-RA-SB',
    'CS1B-SA-HB',
    'CS1B-SA-HB2',
    'CS1B-SA-SB',
    'CS1B-SRA-HB-L',
    'CS1B-SRA-HB-R',
    'CS1B-SRA-SB-L',
    'CS1B-SRA-SB-R',
    'CS1B-SSA-HB-L',
    'CS1B-SSA-HB-R',
    'CS1B-SSA-SB-L',
    'CS1B-SSA-SB-R',
    'CS1B-SSA2-HB-L',
    'CS1B-SSA2-HB-R',
    'CS1B-SWA-HB-L',
    'CS1B-SWA-HB-R',
    'CS1B-SWA-SB-L',
    'CS1B-SWA-SB-R',
    'CS1B-SWA2-HB-L',
    'CS1B-SWA2-HB-R',
    'CS1B-SWA2-SB-L',
    'CS1B-SWA2-SB-R',
    'CS1B-WA-HB',
    'CS1B-WA-SB',
    'CS1B-WA-SB2',
    'CS1L-ERA-HB',
    'CS1L-RA-HB',
    'CS1L-RA-RB',
    'CS1L-RA-SB',
    'CS1L-RA-WB',
    'CS1L-SA-HB',
    'CS1L-SA-SB',
    'CS1L-WA-SB',
    'CS3B-RA-HB',
    'CS3B-RA-RB',
    'CS3B-RA-SB',
    'CS3B-SA-HB',
    'CS3B-SA-HB2',
    'CS3B-SA-SB',
    'CS3B-SLA-HB',
    'CS3B-SLA-HB2',
    'CS3B-SLA-SB',
    'CS3B-SLA-SB2',
    'CS3B-SRA-HB-L',
    'CS3B-SRA-HB-R',
    'CS3B-SRA-SB-L',
    'CS3B-SRA-SB-R',
    'CS3B-SSA-HB-L',
    'CS3B-SSA-HB-R',
    'CS3B-SSA-SB-L',
    'CS3B-SSA-SB-R',
    'CS3B-SSA2-HB-L',
    'CS3B-SSA2-HB-R',
    'CS3B-SSLA-SB-L',
    'CS3B-SSLA-SB-R',
    'CS3B-SSLA2-SB',
    'CS3B-SSLA2-SB-L',
    'CS3B-SSLA2-SB-R',
    'CS3B-SWA-HB-L',
    'CS3B-SWA-HB-R',
    'CS3B-SWA-SB-L',
    'CS3B-SWA-SB-R',
    'CS3B-SWA2-HB-L',
    'CS3B-SWA2-HB-R',
    'CS3B-SWA2-SB-L',
    'CS3B-SWA2-SB-R',
    'CS3B-WA-HB',
    'CS3B-WA-SB',
    'CS3B-WA-SB2',
    'CS3B-WA2-HB',
    'CS3L-ERA-HB',
    'CS3L-RA-HB',
    'CS3L-RA-RB',
    'CS3L-RA-SB',
    'CS3L-SA-HB',
    'CS3L-SA-SB',
    'CS3L-SSA-SB-L',
    'CS3L-SSA-SB-R',
    'CS3L-WA-SB',
    'CS4-SSA-HB-L',
    'CS4-SSA-HB-R',
    'CS4-SSA-SB-L',
    'CS4-SSA-SB-R',
    'CS5B-RA-HB-L',
    'CS5B-RA-HB-R',
    'CS5B-RA-SB',
    'CS5B-RA-SB-L',
    'CS5B-RA-SB-R',
    'CS5B-RA2-HB-L',
    'CS5B-RA2-HB-R',
    'CS5B-RA2-SB-L',
    'CS5B-RA2-SB-R',
    'CS5B-SA-HB',
    'CS5B-SA-HB-L',
    'CS5B-SA-HB-R',
    'CS5B-SA-SB',
    'CS5B-SA-SB-L',
    'CS5B-SA-SB-R',
    'CS5B-SA2-HB-L',
    'CS5B-SA2-HB-R',
    'CS5B-SA2-SB-L',
    'CS5B-SA2-SB-R',
    'CS5B-SWA2-SB-L',
    'CS5B-SWA2-SB-R',
    'CS5B-WA-HB-L',
    'CS5B-WA-HB-R',
    'CS5B-WA2-HB-L',
    'CS5B-WA2-HB-R',
    'CS5B-WA2-SB-L',
    'CS5B-WA2-SB-R',
    'CS5L-RA-HB-L',
    'CS5L-RA-HB-R',
    'CS5L-RA-SB-L',
    'CS5L-RA-SB-R',
    'CS5L-SA-HB-L',
    'CS5L-SA-HB-R',
    'CS5L-SA-SB-L',
    'CS5L-SA-SB-R',
    'CS5L-WA-HB-L',
    'CS5L-WA-HB-R',
    'CS5L-WA-SB-L',
    'CS5L-WA-SB-R',
    'CSAP-ERA',
    'CSAP-RA',
    'CSAP-SA',
    'CSAP-SSLA',
    'CSAP-WA',
    'CSAP-WA2',
    'CSDC-CNRP',
    'CSDC-MSKT',
    'CSDC-SA-SNUG',
    'CSDC-SNUG',
    'CSS-RA-HB',
  ];

  const renderGallery = filteredCodes => {
    const items = filteredCodes
      .map(code => {
        const url = buildGuideUrl(code, 'Front');
        return `
        <div class="guide-gallery-item" data-code="${code}">
          <div class="guide-gallery-item-label">${code}</div>
          <div class="guide-gallery-item-body">
            <img src="${url}" alt="${code} Front view" loading="lazy" data-guide-code="${code}" data-guide-view="Front" />
          </div>
        </div>
      `;
      })
      .join('');

    galleryOverlay.innerHTML = `
      <button class="guide-gallery-close">Close (Esc)</button>
      <div class="guide-gallery-container">
        <div class="guide-gallery-header">
          <h2 class="guide-gallery-title">Measurement Guide Gallery</h2>
          <input type="text" class="guide-gallery-search" placeholder="Search guide codes..." />
        </div>
        <div class="guide-gallery-grid">${items}</div>
      </div>
    `;

    const searchInput = galleryOverlay.querySelector('.guide-gallery-search');
    const closeBtn = galleryOverlay.querySelector('.guide-gallery-close');

    searchInput?.addEventListener('input', e => {
      const query = e.target.value.toUpperCase();
      const filtered = allCodes.filter(code => code.includes(query));
      const grid = galleryOverlay.querySelector('.guide-gallery-grid');
      if (grid) {
        grid.innerHTML = filtered
          .map(code => {
            const url = buildGuideUrl(code, 'Front');
            return `
            <div class="guide-gallery-item" data-code="${code}">
              <div class="guide-gallery-item-label">${code}</div>
              <div class="guide-gallery-item-body">
                <img src="${url}" alt="${code} Front view" loading="lazy" data-guide-code="${code}" data-guide-view="Front" />
              </div>
            </div>
          `;
          })
          .join('');
        attachGuideImageRecovery(grid);
      }
    });

    closeBtn?.addEventListener('click', hideGuideGallery);

    galleryOverlay.querySelectorAll('.guide-gallery-item').forEach(item => {
      item.addEventListener('click', () => {
        const code = item.getAttribute('data-code');
        if (code) {
          saveGuideCodes([code]);
          hideGuideGallery();
          showGuideFlash();
        }
      });
    });
  };

  renderGallery(allCodes);
  attachGuideImageRecovery(galleryOverlay);
  requestAnimationFrame(() => galleryOverlay?.classList.add('visible'));
}

function hideGuideGallery() {
  if (!galleryOverlay) return;
  galleryOverlay.classList.remove('visible');
}

function onKeyDown(event) {
  if (event.code !== HOTKEY) return;
  if (isTypingContext(event.target)) return;

  event.preventDefault();
  event.stopPropagation();

  // Ctrl+\ = Edit codes
  if (event.ctrlKey && !event.repeat) {
    const codes = promptForCodes();
    if (!codes.length) return;
    activeIndex = 0;
    showGuideFlash();
    showShortcutToast();
    return;
  }

  // Alt+\ = Open gallery browser
  if (event.altKey && !event.repeat) {
    showGuideGallery();
    return;
  }

  // Shift+\ = Cycle to next guide (timed auto-hide)
  if (event.shiftKey && !event.repeat) {
    showGuideFlash({ cycleNext: true });
    showShortcutToast();
    return;
  }

  // \ (no modifiers) = Hold mode - show while key is held
  if (!event.repeat && !bossKeyHeld) {
    bossKeyHeld = true;
    showGuideFlash({ holdMode: true });
    showShortcutToast();
  }
}

function onKeyUp(event) {
  if (event.code !== HOTKEY) return;
  if (bossKeyHeld) {
    bossKeyHeld = false;
    hideGuideFlash();
  }
}

export function initMeasurementGuideFlash() {
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp, { passive: false });

  // Close gallery on Escape
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && galleryOverlay?.classList.contains('visible')) {
      hideGuideGallery();
    }
  });
}
