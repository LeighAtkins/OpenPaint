type MeasurementMetadataManager = {
  getMeasurementString: (imageLabel: string, strokeLabel: string) => string;
  parseAndSaveMeasurement: (imageLabel: string, strokeLabel: string, value: string) => boolean;
  renameStrokeLabel?: (
    imageLabel: string,
    oldLabel: string,
    newLabel: string
  ) => { ok: boolean; label?: string; reason?: string };
  updateStrokeVisibilityControls?: () => void;
};

type QuickMeasurementWindow = Window & {
  focusQuickMeasurementInput?: (strokeLabel: string, imageLabel: string) => void;
  hideQuickMeasurementInput?: () => void;
};

type QueuedMeasurementDetail = {
  active?: boolean;
  rowKey?: string;
  label?: string;
  value?: string;
  sourceLabel?: string;
};

export function initQuickMeasurementEntry(metadataManager: MeasurementMetadataManager): void {
  if (document.getElementById('quickMeasurementEntry')) return;

  const dock = document.getElementById('canvasControlsContent');
  if (!dock) return;

  const entry = document.createElement('div');
  entry.id = 'quickMeasurementEntry';
  entry.hidden = true;
  entry.setAttribute('role', 'group');
  entry.setAttribute('aria-label', 'Quick measurement entry');

  const label = document.createElement('input');
  label.id = 'quickMeasurementLabel';
  label.type = 'text';
  label.autocomplete = 'off';
  label.spellcheck = false;
  label.maxLength = 8;
  label.setAttribute('aria-label', 'Measurement label');
  label.title = 'Click to rename this measurement';

  const input = document.createElement('input');
  input.id = 'quickMeasurementValue';
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Value';

  const unitToggle = document.createElement('div');
  unitToggle.id = 'quickMeasurementUnitToggle';
  unitToggle.setAttribute('role', 'group');
  unitToggle.setAttribute('aria-label', 'Measurement unit');

  const inchButton = document.createElement('button');
  inchButton.type = 'button';
  inchButton.dataset.quickUnit = 'inch';
  inchButton.textContent = 'In';
  inchButton.title = 'Use inches';
  inchButton.setAttribute('aria-pressed', 'true');

  const cmButton = document.createElement('button');
  cmButton.type = 'button';
  cmButton.dataset.quickUnit = 'cm';
  cmButton.textContent = 'Cm';
  cmButton.title = 'Use centimetres';
  cmButton.setAttribute('aria-pressed', 'false');

  unitToggle.append(inchButton, cmButton);
  entry.append(label, input, unitToggle);
  const copyButton = document.getElementById('copyCanvasBtn');
  copyButton?.parentElement === dock
    ? copyButton.insertAdjacentElement('afterend', entry)
    : dock.prepend(entry);

  let activeImageLabel = '';
  let activeStrokeLabel = '';
  let originalStrokeLabel = '';
  let originalValue = '';
  let cancelPending = false;
  let cancelLabelPending = false;
  let editorMode: 'stroke' | 'queue' = 'stroke';
  let queuedMeasurement: QueuedMeasurementDetail | null = null;

  const inspectorIsOpen = (): boolean => {
    const strokePanel = document.getElementById('strokePanel');
    const elementsBody = document.getElementById('elementsBody');
    return Boolean(
      strokePanel?.getAttribute('aria-expanded') !== 'false' &&
        !strokePanel?.classList.contains('collapsed') &&
        !strokePanel?.classList.contains('minimized') &&
        elementsBody &&
        getComputedStyle(elementsBody).display !== 'none'
    );
  };

  const showQueuedMeasurement = (): void => {
    if (!queuedMeasurement?.active || inspectorIsOpen()) return;
    editorMode = 'queue';
    activeImageLabel = '';
    activeStrokeLabel = '';
    originalStrokeLabel = String(queuedMeasurement.label || '')
      .trim()
      .toUpperCase();
    originalValue = String(queuedMeasurement.value || '').trim();
    label.value = originalStrokeLabel;
    input.value = originalValue;
    input.setAttribute(
      'aria-label',
      `Queued value for ${queuedMeasurement.sourceLabel || 'CW measurement'}`
    );
    entry.dataset.mode = 'queue';
    entry.hidden = false;
    label.toggleAttribute('data-invalid', !originalStrokeLabel);
  };

  const hide = () => {
    entry.hidden = true;
    delete entry.dataset.mode;
    activeImageLabel = '';
    activeStrokeLabel = '';
    originalStrokeLabel = '';
  };

  const commitLabel = (): boolean => {
    if (editorMode === 'queue' && queuedMeasurement?.rowKey) {
      const requested = label.value.trim().toUpperCase();
      label.value = requested;
      label.toggleAttribute('data-invalid', !requested);
      window.dispatchEvent(
        new CustomEvent('openpaint:cw-queue-label-change', {
          detail: { rowKey: queuedMeasurement.rowKey, label: requested },
        })
      );
      if (requested) {
        originalStrokeLabel = requested;
        queuedMeasurement.label = requested;
      }
      return Boolean(requested);
    }
    if (!activeImageLabel || !activeStrokeLabel) return false;
    const requested = label.value.trim().toUpperCase();
    if (!requested || requested === originalStrokeLabel) {
      label.value = originalStrokeLabel;
      return Boolean(requested);
    }
    const result = metadataManager.renameStrokeLabel?.(
      activeImageLabel,
      activeStrokeLabel,
      requested
    );
    if (!result?.ok || !result.label) {
      label.value = originalStrokeLabel;
      label.dataset.invalid = 'true';
      setTimeout(() => delete label.dataset.invalid, 700);
      return false;
    }
    activeStrokeLabel = result.label;
    originalStrokeLabel = result.label;
    label.value = result.label;
    input.setAttribute('aria-label', `Measurement for ${result.label}`);
    metadataManager.updateStrokeVisibilityControls?.();
    window.updateNextTagDisplay?.();
    window.dispatchEvent(
      new CustomEvent('openpaint:project-mutated', {
        detail: { source: 'stroke-label', imageLabel: activeImageLabel, strokeLabel: result.label },
      })
    );
    return true;
  };

  const commit = (): boolean => {
    if (editorMode === 'queue' && queuedMeasurement?.rowKey) {
      const value = input.value.trim();
      if (!value) {
        input.value = originalValue;
        return false;
      }
      window.dispatchEvent(
        new CustomEvent('openpaint:cw-queue-value-change', {
          detail: { rowKey: queuedMeasurement.rowKey, value },
        })
      );
      originalValue = value;
      queuedMeasurement.value = value;
      return true;
    }
    if (!activeImageLabel || !activeStrokeLabel) return false;
    const value = input.value.trim();
    if (value === originalValue.trim()) return true;
    const saved = metadataManager.parseAndSaveMeasurement(
      activeImageLabel,
      activeStrokeLabel,
      value
    );
    if (saved) {
      originalValue = metadataManager.getMeasurementString(activeImageLabel, activeStrokeLabel);
      input.value = originalValue;
    } else {
      input.value = originalValue;
      input.select();
    }
    return saved;
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commit()) input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelPending = true;
      input.value = originalValue;
      input.blur();
    }
  });

  input.addEventListener('blur', () => {
    if (cancelPending) {
      cancelPending = false;
      return;
    }
    commit();
  });

  label.addEventListener('focus', () => label.select());
  label.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commitLabel()) input.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelLabelPending = true;
      label.value = originalStrokeLabel;
      label.blur();
    }
  });
  label.addEventListener('blur', () => {
    if (cancelLabelPending) {
      cancelLabelPending = false;
      return;
    }
    commitLabel();
  });

  const quickWindow = window as QuickMeasurementWindow;
  quickWindow.focusQuickMeasurementInput = (strokeLabel, imageLabel) => {
    if (queuedMeasurement?.active) {
      showQueuedMeasurement();
      return;
    }
    editorMode = 'stroke';
    activeStrokeLabel = String(strokeLabel || '').trim();
    originalStrokeLabel = activeStrokeLabel;
    activeImageLabel = String(imageLabel || '').trim();
    if (!activeStrokeLabel || !activeImageLabel) return;

    label.value = activeStrokeLabel;
    originalValue = metadataManager.getMeasurementString(activeImageLabel, activeStrokeLabel) || '';
    input.value = originalValue;
    input.setAttribute('aria-label', `Measurement for ${activeStrokeLabel}`);
    entry.dataset.mode = 'stroke';
    entry.hidden = false;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  };
  quickWindow.hideQuickMeasurementInput = hide;

  window.addEventListener('openpaint:cw-queue-state', event => {
    const detail = (event as CustomEvent<QueuedMeasurementDetail>).detail || {};
    queuedMeasurement = detail.active ? { ...detail } : null;
    if (!queuedMeasurement) {
      if (editorMode === 'queue') hide();
      return;
    }
    showQueuedMeasurement();
  });

  const strokePanel = document.getElementById('strokePanel');
  const elementsBody = document.getElementById('elementsBody');
  const hideWhenInspectorOpens = () => {
    if (inspectorIsOpen()) {
      if (editorMode === 'queue') hide();
      return;
    }
    if (queuedMeasurement?.active) showQueuedMeasurement();
  };

  if (strokePanel) {
    new MutationObserver(hideWhenInspectorOpens).observe(strokePanel, {
      attributes: true,
      attributeFilter: ['class', 'aria-expanded'],
    });
  }
  if (elementsBody) {
    new MutationObserver(hideWhenInspectorOpens).observe(elementsBody, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }
}
