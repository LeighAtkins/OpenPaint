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
    .project-naming-grid .span-2 { grid-column: 1 / -1; }
    .project-naming-guide-row { display: flex; gap: 8px; align-items: flex-end; }
    .project-naming-guide-row input { flex: 1; }
    .project-naming-link-btn { border-radius: 8px; padding: 8px 10px; font-size: 11px; font-weight: 600; border: 1px solid #cbd5e1; background: #fff; color: #334155; cursor: pointer; }
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
    jobDate: '',
    extraLabel: '',
  };
}

function parseGuideCodes(raw) {
  return Array.from(
    new Set(
      String(raw || '')
        .split(',')
        .map(code =>
          String(code || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    )
  );
}

function upsertGuideLibraryFromInput(rawCodes, viewId = getCurrentViewId()) {
  const metadata = getMetadata();
  const codes = parseGuideCodes(rawCodes);
  if (!codes.length) return;
  const existingLibrary = Array.isArray(metadata.measurementGuideLibraryCodes)
    ? metadata.measurementGuideLibraryCodes
    : [];
  const nextLibrary = Array.from(new Set([...existingLibrary, ...codes]));
  const nextBindings = {
    ...(metadata.measurementGuideBindingsByScope || {}),
    [viewId]: {
      codes,
      activeCode: codes[0],
      locked: true,
      tagModeHint: 'auto',
    },
  };
  setMetadata({
    measurementGuideLibraryCodes: nextLibrary,
    measurementGuideCodes: codes,
    measurementGuideCode: codes[0] || '',
    measurementGuideProjectDefaults: { codes, activeCode: codes[0] || '' },
    measurementGuideBindingsByScope: nextBindings,
    measurementGuideCodesByView: {
      ...(metadata.measurementGuideCodesByView || {}),
      [viewId]: codes,
    },
    measurementGuideLockByView: {
      ...(metadata.measurementGuideLockByView || {}),
      [viewId]: true,
    },
  });
}

function getInitialGuideCodeValue(metadata, viewId) {
  const binding = metadata?.measurementGuideBindingsByScope?.[viewId];
  if (binding && Array.isArray(binding.codes) && binding.codes.length) {
    return binding.codes.join(', ');
  }
  const byView = metadata?.measurementGuideCodesByView?.[viewId];
  if (Array.isArray(byView) && byView.length) return byView.join(', ');
  if (Array.isArray(metadata?.measurementGuideCodes) && metadata.measurementGuideCodes.length) {
    return metadata.measurementGuideCodes.join(', ');
  }
  return String(metadata?.measurementGuideCode || '').trim();
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
    guideCodes: getInitialGuideCodeValue(metadata, getCurrentViewId()),
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
        <div class="span-2">
          <label>Guide Template Codes (project + this image/frame)</label>
          <div class="project-naming-guide-row">
            <input id="projectNamingGuideCodes" type="text" value="${initial.guideCodes}" placeholder="e.g. CC-BK-BE, CS3B-SSA-SB-R" />
            <button id="projectNamingGuideGallery" type="button" class="project-naming-link-btn">Browse Gallery</button>
          </div>
        </div>
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
  const guideInput = overlay.querySelector('#projectNamingGuideCodes');
  const guideGalleryBtn = overlay.querySelector('#projectNamingGuideGallery');

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

  guideGalleryBtn?.addEventListener('click', () => {
    if (typeof window.openMeasurementGuideGallery === 'function') {
      window.openMeasurementGuideGallery({
        onSelect: ({ code }) => {
          if (!code || !guideInput) return;
          const next = parseGuideCodes(`${guideInput.value}, ${code}`);
          guideInput.value = next.join(', ');
          updatePreview();
        },
      });
      return;
    }
    const manual = window.prompt(
      'Enter guide code(s), separated by commas',
      guideInput?.value || ''
    );
    if (typeof manual === 'string' && guideInput) {
      guideInput.value = parseGuideCodes(manual).join(', ');
      updatePreview();
    }
  });

  continueBtn?.addEventListener('click', () => {
    const payload = getNamingPayloadFromInputs(overlay);
    upsertNaming(payload, { forceTitle: false });
    upsertGuideLibraryFromInput(guideInput?.value || '', getCurrentViewId());
    const metadata = getMetadata();
    const firstSavedAt = metadata?.naming?.firstSavedAt;
    if (!firstSavedAt) {
      upsertNaming({ firstSavedAt: new Date().toISOString().slice(0, 10) }, { forceTitle: false });
    }
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
  const guideCodesInput = overlay.querySelector('#projectNamingGuideCodes');
  const firstTarget =
    (!customerInput?.value && customerInput) ||
    (!sofaTypeInput?.value && sofaTypeInput) ||
    (!guideCodesInput?.value && guideCodesInput) ||
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
    String(naming.customerName || '').trim() && String(naming.sofaTypeLabel || '').trim()
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
      const metadata = getMetadata();
      if (!String(metadata?.naming?.firstSavedAt || '').trim()) {
        upsertNaming(
          { firstSavedAt: new Date().toISOString().slice(0, 10) },
          { forceTitle: false }
        );
      }
      return originalSaveProject(...args);
    }

    return new Promise(resolve => {
      openProjectNamingModal({
        title: 'Project details before save',
        subtitle:
          'Add customer, sofa type, and guide template codes for cleaner project naming and guide linking.',
        continueLabel: 'Save details + Save project',
        secondaryLabel: 'Save anyway',
        onComplete: async () => {
          await originalSaveProject(...args);
          resolve();
        },
        onSkip: async () => {
          const metadata = getMetadata();
          if (!String(metadata?.naming?.firstSavedAt || '').trim()) {
            upsertNaming(
              { firstSavedAt: new Date().toISOString().slice(0, 10) },
              { forceTitle: false }
            );
          }
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
      subtitle: 'Optional now, but recommended for clear save naming and cloud-ready metadata.',
      continueLabel: 'Save details',
      secondaryLabel: 'Skip for now',
      onComplete: () => {},
      onSkip: () => {},
    });
  }, 250);
}

export function ensureCloudSaveDetails() {
  const metadata = getMetadata();
  const naming = metadata.naming || {};
  const hasNaming =
    String(naming.customerName || '').trim() && String(naming.sofaTypeLabel || '').trim();
  const hasGuide =
    (Array.isArray(metadata.measurementGuideLibraryCodes) &&
      metadata.measurementGuideLibraryCodes.length > 0) ||
    (Array.isArray(metadata.measurementGuideCodes) && metadata.measurementGuideCodes.length > 0) ||
    String(metadata.measurementGuideCode || '').trim();

  if (hasNaming && hasGuide) {
    if (!String(naming.firstSavedAt || '').trim()) {
      upsertNaming({ firstSavedAt: new Date().toISOString().slice(0, 10) }, { forceTitle: false });
    }
    return Promise.resolve(true);
  }

  return new Promise(resolve => {
    openProjectNamingModal({
      title: 'Cloud save needs project details',
      subtitle: 'Customer, sofa type, and at least one guide template are required for cloud save.',
      continueLabel: 'Save details',
      secondaryLabel: 'Cancel',
      onComplete: () => resolve(true),
      onSkip: () => resolve(false),
    });
  });
}

export function initProjectNaming() {
  setSofaTypeLabelDefaults();
  bindImagePartLabelInput();
  applyNamingToProjectName({ force: false });
  installSaveNamingPrompt();
}
