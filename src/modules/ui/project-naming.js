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

function ensureNamingUi() {
  const projectNameInput = document.getElementById('projectName');
  if (!projectNameInput) return null;
  const parent = projectNameInput.parentElement;
  if (!parent) return null;
  if (document.getElementById('projectNamingWrap')) {
    return document.getElementById('projectNamingWrap');
  }

  const wrap = document.createElement('div');
  wrap.id = 'projectNamingWrap';
  wrap.style.cssText =
    'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;';
  wrap.innerHTML = `
    <span style="font-size:11px;font-weight:700;color:#334155;">Naming</span>
    <input id="projectCustomerName" type="text" placeholder="Customer" style="min-width:120px;max-width:170px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:7px;font-size:11px;" />
    <input id="projectSofaTypeLabel" type="text" placeholder="Sofa type" style="min-width:130px;max-width:190px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:7px;font-size:11px;" />
    <input id="projectJobDate" type="date" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:7px;font-size:11px;" />
    <input id="projectExtraLabel" type="text" placeholder="Extra label" style="min-width:100px;max-width:160px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:7px;font-size:11px;" />
    <span id="projectNameWarn" style="display:none;font-size:10px;color:#b45309;">Some characters are not valid for saved filenames and will be replaced.</span>
  `;
  parent.insertBefore(wrap, projectNameInput.nextSibling);
  return wrap;
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

function bindNamingInputs() {
  const metadata = getMetadata();
  const naming = metadata.naming || {};

  const customerInput = document.getElementById('projectCustomerName');
  const sofaTypeInput = document.getElementById('projectSofaTypeLabel');
  const dateInput = document.getElementById('projectJobDate');
  const extraInput = document.getElementById('projectExtraLabel');
  const projectNameInput = document.getElementById('projectName');
  const warning = document.getElementById('projectNameWarn');

  if (!customerInput || !sofaTypeInput || !dateInput || !extraInput || !projectNameInput) return;

  customerInput.value = naming.customerName || '';
  sofaTypeInput.value = naming.sofaTypeLabel || deriveSofaTypeLabel(metadata);
  dateInput.value = naming.jobDate || '';
  extraInput.value = naming.extraLabel || '';

  const updateWarning = () => {
    const hasInvalid = hasInvalidFilenameChars(projectNameInput.value);
    if (!warning) return;
    warning.style.display = hasInvalid ? 'inline' : 'none';
  };

  const saveNaming = ({ forceTitle = false } = {}) => {
    const nextNaming = {
      ...(getMetadata().naming || {}),
      customerName: customerInput.value.trim(),
      sofaTypeLabel: sofaTypeInput.value.trim(),
      jobDate: dateInput.value || '',
      extraLabel: extraInput.value.trim(),
    };
    setMetadata({ naming: nextNaming });
    applyNamingToProjectName({ force: forceTitle });
  };

  [customerInput, sofaTypeInput, dateInput, extraInput].forEach(input => {
    input.addEventListener('change', () => saveNaming({ forceTitle: false }));
  });

  projectNameInput.addEventListener('input', updateWarning);
  updateWarning();
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

export function initProjectNaming() {
  setSofaTypeLabelDefaults();
  ensureNamingUi();
  bindNamingInputs();
  bindImagePartLabelInput();
  applyNamingToProjectName({ force: false });
}
