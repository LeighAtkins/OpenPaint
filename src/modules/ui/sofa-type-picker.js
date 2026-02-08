const SOFA_TYPE_OPTIONS = [
  { id: 'two_seater', label: '2-Seater', icon: '🛋️' },
  { id: 'three_seater', label: '3-Seater', icon: '🛋️' },
  { id: 'sectional_l_shape', label: 'Sectional / L-Shape', icon: '🧩' },
  { id: 'armchair', label: 'Armchair', icon: '🪑' },
  { id: 'sofa_bed', label: 'Sofa Bed', icon: '🛏️' },
  { id: 'custom', label: 'Custom', icon: '✏️' },
];

const SOFA_TYPE_LABELS = Object.fromEntries(
  SOFA_TYPE_OPTIONS.map(option => [option.id, option.label])
);

function getCurrentMetadata() {
  const managerMetadata = window.app?.projectManager?.getProjectMetadata?.();
  if (managerMetadata && typeof managerMetadata === 'object') {
    return managerMetadata;
  }
  if (window.projectMetadata && typeof window.projectMetadata === 'object') {
    return window.projectMetadata;
  }
  return { sofaType: null, customSofaType: '' };
}

function setSofaTypeMetadata(sofaType, customSofaType = '') {
  const manager = window.app?.projectManager;
  if (manager?.setSofaType) {
    return manager.setSofaType(sofaType, customSofaType);
  }

  const next = {
    ...(window.projectMetadata || {}),
    sofaType,
    customSofaType,
  };
  window.projectMetadata = next;
  return next;
}

function shouldAutoRenameProject() {
  const nameInput = document.getElementById('projectName');
  const currentName = nameInput?.value?.trim()?.toLowerCase() || '';
  return !currentName || currentName === 'openpaint project' || currentName === 'openpaint';
}

function buildDefaultProjectName(sofaType, customName = '') {
  const baseLabel =
    sofaType === 'custom' ? customName.trim() || 'Custom Sofa' : SOFA_TYPE_LABELS[sofaType];
  const counterKey = `openpaint:projectCounter:${sofaType || 'unknown'}`;
  const current = Number.parseInt(localStorage.getItem(counterKey) || '0', 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  localStorage.setItem(counterKey, String(next));
  return `${baseLabel} - Project ${next}`;
}

function applyProjectNameFromSelection(sofaType, customName = '') {
  const nameInput = document.getElementById('projectName');
  if (!nameInput || !shouldAutoRenameProject()) return;
  nameInput.value = buildDefaultProjectName(sofaType, customName);
}

function ensureStyles() {
  if (document.getElementById('sofaTypePickerStyles')) return;
  const style = document.createElement('style');
  style.id = 'sofaTypePickerStyles';
  style.textContent = `
    .sofa-picker-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.58); z-index: 12000; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .sofa-picker-card { width: min(860px, 100%); background: #ffffff; border-radius: 16px; padding: 20px; box-shadow: 0 24px 50px rgba(15, 23, 42, 0.25); }
    .sofa-picker-title { margin: 0 0 6px; font-size: 24px; color: #0f172a; }
    .sofa-picker-subtitle { margin: 0 0 18px; color: #475569; font-size: 14px; }
    .sofa-picker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .sofa-picker-tile { border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; padding: 14px; text-align: left; min-height: 88px; cursor: pointer; display: flex; gap: 10px; align-items: flex-start; }
    .sofa-picker-tile:hover { border-color: #94a3b8; box-shadow: 0 3px 10px rgba(15, 23, 42, 0.08); }
    .sofa-picker-tile.is-selected { border-color: #1d4ed8; background: #eff6ff; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18); }
    .sofa-picker-icon { font-size: 20px; line-height: 1; }
    .sofa-picker-label { font-size: 14px; font-weight: 600; color: #0f172a; }
    .sofa-picker-custom { margin-top: 12px; display: none; }
    .sofa-picker-custom.is-visible { display: block; }
    .sofa-picker-custom input { width: 100%; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; font-size: 14px; }
    .sofa-picker-actions { margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; }
    .sofa-picker-btn { border: 1px solid transparent; border-radius: 10px; padding: 10px 14px; font-weight: 600; cursor: pointer; }
    .sofa-picker-btn.primary { background: #2563eb; color: white; }
    .sofa-picker-btn.primary:disabled { background: #93c5fd; cursor: not-allowed; }
    .sofa-picker-btn.secondary { background: #fff; border-color: #cbd5e1; color: #334155; }
  `;
  document.head.appendChild(style);
}

function createPickerOverlay({ title, subtitle, showSkip = true, onContinue, onSkip }) {
  ensureStyles();
  const overlay = document.createElement('div');
  overlay.className = 'sofa-picker-overlay';
  overlay.innerHTML = `
    <div class="sofa-picker-card" role="dialog" aria-modal="true" aria-label="Sofa type picker">
      <h2 class="sofa-picker-title">${title}</h2>
      <p class="sofa-picker-subtitle">${subtitle}</p>
      <div class="sofa-picker-grid" id="sofaPickerGrid"></div>
      <div class="sofa-picker-custom" id="sofaPickerCustomWrap">
        <input id="sofaPickerCustomInput" type="text" maxlength="80" placeholder="Enter custom sofa type" />
      </div>
      <div class="sofa-picker-actions">
        ${showSkip ? '<button type="button" class="sofa-picker-btn secondary" id="sofaPickerSkip">Skip for now</button>' : ''}
        <button type="button" class="sofa-picker-btn primary" id="sofaPickerContinue" disabled>Continue</button>
      </div>
    </div>
  `;

  const grid = overlay.querySelector('#sofaPickerGrid');
  const continueBtn = overlay.querySelector('#sofaPickerContinue');
  const skipBtn = overlay.querySelector('#sofaPickerSkip');
  const customWrap = overlay.querySelector('#sofaPickerCustomWrap');
  const customInput = overlay.querySelector('#sofaPickerCustomInput');

  let selectedType = null;

  const updateUiState = () => {
    const needsCustomName = selectedType === 'custom';
    const customName = customInput?.value?.trim() || '';
    const canContinue = !!selectedType && (!needsCustomName || customName.length > 1);
    continueBtn.disabled = !canContinue;
    customWrap.classList.toggle('is-visible', needsCustomName);
    if (needsCustomName) {
      requestAnimationFrame(() => customInput?.focus());
    }
  };

  SOFA_TYPE_OPTIONS.forEach(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sofa-picker-tile';
    button.dataset.sofaType = option.id;
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `<span class="sofa-picker-icon" aria-hidden="true">${option.icon}</span><span class="sofa-picker-label">${option.label}</span>`;
    button.addEventListener('click', () => {
      selectedType = option.id;
      grid.querySelectorAll('.sofa-picker-tile').forEach(tile => {
        const isSelected = tile.dataset.sofaType === selectedType;
        tile.classList.toggle('is-selected', isSelected);
        tile.setAttribute('aria-pressed', String(isSelected));
      });
      updateUiState();
    });
    grid.appendChild(button);
  });

  customInput?.addEventListener('input', updateUiState);

  continueBtn.addEventListener('click', () => {
    const customValue = customInput?.value?.trim() || '';
    onContinue?.({ sofaType: selectedType, customSofaType: customValue });
    overlay.remove();
  });

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      onSkip?.();
      overlay.remove();
    });
  }

  document.body.appendChild(overlay);
}

function hasSofaTypeSelected() {
  const metadata = getCurrentMetadata();
  return typeof metadata.sofaType === 'string' && metadata.sofaType.length > 0;
}

function showInitialPickerIfNeeded() {
  if (hasSofaTypeSelected()) return;

  createPickerOverlay({
    title: 'Step 1: Identify your sofa type',
    subtitle: 'Choose a sofa type to improve naming, photo prompts, and PDF intake guidance.',
    showSkip: true,
    onContinue: ({ sofaType, customSofaType }) => {
      setSofaTypeMetadata(sofaType, customSofaType);
      applyProjectNameFromSelection(sofaType, customSofaType);
    },
    onSkip: () => {
      setSofaTypeMetadata(null, '');
    },
  });
}

function installSaveGuard() {
  const manager = window.app?.projectManager;
  if (!manager || typeof manager.saveProject !== 'function' || manager.__sofaSaveGuardInstalled)
    return;

  const originalSaveProject = manager.saveProject.bind(manager);
  manager.__sofaSaveGuardInstalled = true;

  manager.saveProject = async (...args) => {
    if (hasSofaTypeSelected()) {
      return originalSaveProject(...args);
    }

    return new Promise(resolve => {
      createPickerOverlay({
        title: 'Sofa type missing',
        subtitle: 'Pick sofa type before saving (recommended).',
        showSkip: true,
        onContinue: async ({ sofaType, customSofaType }) => {
          setSofaTypeMetadata(sofaType, customSofaType);
          applyProjectNameFromSelection(sofaType, customSofaType);
          await originalSaveProject(...args);
          resolve();
        },
        onSkip: async () => {
          await originalSaveProject(...args);
          resolve();
        },
      });
    });
  };
}

export function initSofaTypePicker() {
  showInitialPickerIfNeeded();
  installSaveGuard();
}
