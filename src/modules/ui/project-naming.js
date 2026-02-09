import {
  composeProjectTitle,
  composeProjectTitleParts,
  hasInvalidFilenameChars,
  sanitizeFilenamePart,
} from '../utils/naming-utils.js';

const SOFA_TYPE_LABELS = {
  two_seater: '2 Seater Sofa',
  three_seater: '3 Seater Sofa',
  sectional_l_shape: 'Sectional / L-Shape Sofa',
  armchair: 'Armchair',
  sofa_bed: 'Sofa Bed',
  custom: 'Custom Sofa',
};

function getMetadata() {
  const metadata = window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata;
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function setMetadata(patch) {
  if (window.app?.projectManager?.setProjectMetadata) {
    return window.app.projectManager.setProjectMetadata(patch);
  }
  window.projectMetadata = { ...(window.projectMetadata || {}), ...patch };
  return window.projectMetadata;
}

function getCurrentViewId() {
  return window.app?.projectManager?.currentViewId || window.currentImageLabel || 'front';
}

function getCurrentImagePartLabel(viewId) {
  const metadata = getMetadata();
  const map =
    metadata?.imagePartLabels && typeof metadata.imagePartLabels === 'object'
      ? metadata.imagePartLabels
      : {};
  return map[viewId] || '';
}

function setImagePartLabel(viewId, label) {
  const metadata = getMetadata();
  const imagePartLabels = {
    ...(metadata.imagePartLabels || {}),
    [viewId]: String(label || '').trim(),
  };
  return setMetadata({ imagePartLabels });
}

function deriveSofaTypeLabel(metadata) {
  const namingLabel = metadata?.naming?.sofaTypeLabel?.trim();
  if (namingLabel) return namingLabel;
  const sofaType = metadata?.sofaType;
  if (sofaType === 'custom') {
    return metadata?.customSofaType?.trim() || SOFA_TYPE_LABELS.custom;
  }
  return SOFA_TYPE_LABELS[sofaType] || '';
}

function applyNamingToProjectName({ force = false } = {}) {
  const metadata = getMetadata();
  const naming = metadata.naming || {};
  const projectNameInput = document.getElementById('projectName');
  if (!projectNameInput) return;

  const parts = composeProjectTitleParts({
    customerName: naming.customerName,
    sofaTypeLabel: naming.sofaTypeLabel,
    jobDate: naming.jobDate,
    extraLabel: naming.extraLabel,
  });
  const autoTitle = composeProjectTitle(
    parts,
    projectNameInput.value?.trim() || 'OpenPaint Project'
  );
  const previousAuto = naming.autoProjectTitle || '';
  const current = projectNameInput.value?.trim() || '';
  const shouldOverwrite = force || !current || current === previousAuto;

  if (shouldOverwrite) {
    projectNameInput.value = autoTitle;
  }

  if (autoTitle !== previousAuto) {
    setMetadata({ naming: { ...naming, autoProjectTitle: autoTitle } });
  }
}

function ensureModalStyles() {
  if (document.getElementById('projectNamingModalStyles')) return;
  const style = document.createElement('style');
  style.id = 'projectNamingModalStyles';
  style.textContent = `
    .project-naming-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.56); z-index: 12200; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .project-naming-card { width: min(680px, 100%); background: #fff; border-radius: 14px; box-shadow: 0 22px 42px rgba(15,23,42,.26); padding: 18px; }
    .project-naming-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
    .project-naming-grid label { font-size: 12px; color: #334155; font-weight: 600; }
    .project-naming-grid input { margin-top: 4px; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 8px; font-size: 12px; }
    .project-naming-footer { margin-top: 12px; display: flex; justify-content: space-between; gap: 8px; }
    .project-naming-btn { border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #334155; }
    .project-naming-btn.primary { border-color: transparent; background: #1d4ed8; color: #fff; }
    .project-naming-warning { margin-top: 8px; font-size: 11px; color: #b45309; display: none; }
  `;
  document.head.appendChild(style);
}

function getNamingPayloadFromInputs(overlay) {
  return {
    customerName: overlay.querySelector('#projectNamingCustomer')?.value?.trim() || '',
    sofaTypeLabel: overlay.querySelector('#projectNamingSofaType')?.value?.trim() || '',
    jobDate: overlay.querySelector('#projectNamingDate')?.value || '',
    extraLabel: overlay.querySelector('#projectNamingExtra')?.value?.trim() || '',
  };
}

function upsertNaming(namingPatch, { forceTitle = false } = {}) {
  const metadata = getMetadata();
  setMetadata({ naming: { ...(metadata.naming || {}), ...namingPatch } });
  applyNamingToProjectName({ force: forceTitle });
}

function openProjectNamingModal({
  title,
  subtitle,
  continueLabel = 'Save details',
  secondaryLabel = 'Skip for now',
  onComplete,
  onSkip,
}) {
  ensureModalStyles();
  const previousActiveElement = document.activeElement;
  const metadata = getMetadata();
  const naming = metadata.naming || {};
  const initialSofa = naming.sofaTypeLabel || deriveSofaTypeLabel(metadata);
  const initial = {
    customerName: naming.customerName || '',
    sofaTypeLabel: initialSofa || '',
    jobDate: naming.jobDate || '',
    extraLabel: naming.extraLabel || '',
  };

  const overlay = document.createElement('div');
  overlay.className = 'project-naming-overlay';
  overlay.innerHTML = `
    <section class="project-naming-card" role="dialog" aria-modal="true" aria-label="Project naming details">
      <h2 style="margin:0;font-size:20px;color:#0f172a;">${title}</h2>
      <p style="margin:4px 0 0;font-size:12px;color:#475569;">${subtitle}</p>

      <div class="project-naming-grid">
        <label>Customer<input id="projectNamingCustomer" type="text" value="${initial.customerName}" /></label>
        <label>Sofa Type<input id="projectNamingSofaType" type="text" value="${initial.sofaTypeLabel}" /></label>
        <label>Date<input id="projectNamingDate" type="date" value="${initial.jobDate}" /></label>
        <label>Extra Label<input id="projectNamingExtra" type="text" value="${initial.extraLabel}" /></label>
      </div>

      <p id="projectNamingPreview" style="margin:10px 0 0;font-size:12px;color:#334155;"></p>
      <p id="projectNamingWarning" class="project-naming-warning">Some characters are not valid for saved filenames and will be replaced.</p>

      <div class="project-naming-footer">
        <button id="projectNamingSecondary" type="button" class="project-naming-btn">${secondaryLabel}</button>
        <button id="projectNamingContinue" type="button" class="project-naming-btn primary">${continueLabel}</button>
      </div>
    </section>
  `;

  const close = () => {
    overlay.remove();
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
    }
  };
  const preview = overlay.querySelector('#projectNamingPreview');
  const warning = overlay.querySelector('#projectNamingWarning');
  const continueBtn = overlay.querySelector('#projectNamingContinue');
  const secondaryBtn = overlay.querySelector('#projectNamingSecondary');

  const focusables = () =>
    Array.from(
      overlay.querySelectorAll(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

  const updatePreview = () => {
    const namingPayload = getNamingPayloadFromInputs(overlay);
    const parts = composeProjectTitleParts(namingPayload);
    const previewName = composeProjectTitle(parts, 'OpenPaint Project');
    preview.textContent = `Preview title: ${previewName}`;
    const hasInvalid = hasInvalidFilenameChars(previewName);
    warning.style.display = hasInvalid ? 'block' : 'none';
  };

  overlay
    .querySelectorAll('input')
    .forEach(input => input.addEventListener('input', updatePreview));
  updatePreview();

  continueBtn?.addEventListener('click', () => {
    const payload = getNamingPayloadFromInputs(overlay);
    upsertNaming(payload, { forceTitle: false });
    close();
    onComplete?.();
  });
  secondaryBtn?.addEventListener('click', () => {
    close();
    onSkip?.();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      continueBtn?.click();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      secondaryBtn?.click();
    }
  });
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      close();
    }
  });

  document.body.appendChild(overlay);
  const customerInput = overlay.querySelector('#projectNamingCustomer');
  const sofaTypeInput = overlay.querySelector('#projectNamingSofaType');
  const dateInput = overlay.querySelector('#projectNamingDate');
  const firstTarget =
    (!customerInput?.value && customerInput) ||
    (!sofaTypeInput?.value && sofaTypeInput) ||
    (!dateInput?.value && dateInput) ||
    customerInput ||
    continueBtn;
  firstTarget?.focus();
}

function bindImagePartLabelInput() {
  const input = document.getElementById('currentImageNameBox');
  if (!input || input.dataset.boundPartLabel === 'true') return;
  input.dataset.boundPartLabel = 'true';
  input.setAttribute('placeholder', 'Image part label (e.g. front, left arm, cushion top)');

  const syncFromView = () => {
    const viewId = getCurrentViewId();
    const label = getCurrentImagePartLabel(viewId);
    if (input.dataset.activeViewId !== viewId || document.activeElement !== input) {
      input.value = label;
      input.dataset.activeViewId = viewId;
    }
  };

  input.addEventListener('change', () => {
    const viewId = getCurrentViewId();
    setImagePartLabel(viewId, input.value);
    input.dataset.activeViewId = viewId;
  });

  syncFromView();
  const watch = setInterval(syncFromView, 500);
  window.addEventListener('beforeunload', () => clearInterval(watch), { once: true });
}

function setSofaTypeLabelDefaults() {
  const metadata = getMetadata();
  const naming = metadata.naming || {};
  const hasCustom = naming.sofaTypeLabel && naming.sofaTypeLabel.trim().length > 0;
  if (hasCustom) return;
  const derived = deriveSofaTypeLabel(metadata);
  if (!derived) return;
  setMetadata({ naming: { ...naming, sofaTypeLabel: derived } });
}

export function getProjectDisplayName() {
  const projectNameInput = document.getElementById('projectName');
  return projectNameInput?.value?.trim() || 'OpenPaint Project';
}

export function getProjectSafeFilenameBase() {
  return sanitizeFilenamePart(getProjectDisplayName(), 'OpenPaint Project');
}

export function getImagePartLabelForView(viewId, index = 0) {
  const label = getCurrentImagePartLabel(viewId);
  if (label) return label;
  return `view-${String(index + 1).padStart(2, '0')}`;
}

function hasCoreNamingFields() {
  const naming = getMetadata().naming || {};
  return Boolean(
    String(naming.customerName || '').trim() &&
    String(naming.sofaTypeLabel || '').trim() &&
    String(naming.jobDate || '').trim()
  );
}

function installSaveNamingPrompt() {
  const manager = window.app?.projectManager;
  if (!manager || typeof manager.saveProject !== 'function' || manager.__namingSavePromptInstalled)
    return;
  manager.__namingSavePromptInstalled = true;
  const originalSaveProject = manager.saveProject.bind(manager);

  manager.saveProject = async (...args) => {
    if (hasCoreNamingFields()) {
      return originalSaveProject(...args);
    }

    return new Promise(resolve => {
      openProjectNamingModal({
        title: 'Project details before save',
        subtitle: 'Add customer, sofa type, and date for clearer filenames and PDF context.',
        continueLabel: 'Save details + Save project',
        secondaryLabel: 'Save anyway',
        onComplete: async () => {
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

function promptInitialNamingIfNeeded() {
  if (hasCoreNamingFields()) return;
  if (window.__projectNamingPromptShown) return;
  window.__projectNamingPromptShown = true;
  setTimeout(() => {
    openProjectNamingModal({
      title: 'Set project details',
      subtitle: 'Optional now, but recommended for clear save/PDF naming.',
      continueLabel: 'Save details',
      secondaryLabel: 'Skip for now',
      onComplete: () => {},
      onSkip: () => {},
    });
  }, 250);
}

export function initProjectNaming() {
  setSofaTypeLabelDefaults();
  bindImagePartLabelInput();
  applyNamingToProjectName({ force: false });
  installSaveNamingPrompt();
}
