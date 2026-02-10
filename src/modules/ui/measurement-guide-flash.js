const HOTKEY = 'Backslash';
const VIEWS = ['Front', 'Back', 'Side'];
const FLASH_DURATION_MS = 1200;

let flashOverlay = null;
let hideTimer = null;
let activeIndex = 0;

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
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(148, 163, 184, 0.38);
      border-radius: 14px;
      box-shadow: 0 20px 45px rgba(2, 6, 23, 0.45);
      backdrop-filter: blur(7px);
      color: #f8fafc;
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
      border-bottom: 1px solid rgba(148, 163, 184, 0.26);
    }
    .guide-flash-title { font-size: 13px; font-weight: 700; letter-spacing: .02em; }
    .guide-flash-sub { font-size: 11px; color: rgba(226, 232, 240, 0.88); }
    .guide-flash-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 10px;
    }
    .guide-flash-card {
      background: rgba(30, 41, 59, 0.82);
      border: 1px solid rgba(148, 163, 184, 0.22);
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
      border-bottom: 1px solid rgba(148, 163, 184, 0.24);
      color: #cbd5e1;
    }
    .guide-flash-body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      background: rgba(15, 23, 42, 0.72);
    }
    .guide-flash-body img { width: 100%; height: 100%; max-height: 220px; object-fit: contain; }
    .guide-flash-empty { font-size: 11px; color: #94a3b8; text-align: center; }
    @media (max-width: 900px) {
      .guide-flash-grid { grid-template-columns: 1fr; }
      .guide-flash-card { min-height: 140px; }
    }
  `;
  document.head.appendChild(style);
}

function buildGuideUrl(code, view) {
  return `/measurement-guides/${view}_${encodeURIComponent(code)}.svg`;
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

function showGuideFlash({ cycleNext = false } = {}) {
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

  if (hideTimer) {
    clearTimeout(hideTimer);
  }
  hideTimer = setTimeout(() => {
    hideGuideFlash();
  }, FLASH_DURATION_MS);
}

function hideGuideFlash() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!flashOverlay) return;
  flashOverlay.classList.remove('visible');
}

function onKeyDown(event) {
  if (event.code !== HOTKEY) return;
  if (isTypingContext(event.target)) return;
  if (event.repeat) return;

  event.preventDefault();
  event.stopPropagation();

  if (event.ctrlKey) {
    const codes = promptForCodes();
    if (!codes.length) return;
    activeIndex = 0;
    showGuideFlash();
    return;
  }

  showGuideFlash({ cycleNext: event.shiftKey });
}

export function initMeasurementGuideFlash() {
  window.addEventListener('keydown', onKeyDown, { passive: false });
}
