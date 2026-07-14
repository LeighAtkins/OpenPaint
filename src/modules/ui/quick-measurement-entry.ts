type MeasurementMetadataManager = {
  getMeasurementString: (imageLabel: string, strokeLabel: string) => string;
  parseAndSaveMeasurement: (imageLabel: string, strokeLabel: string, value: string) => boolean;
};

type QuickMeasurementWindow = Window & {
  focusQuickMeasurementInput?: (strokeLabel: string, imageLabel: string) => void;
  hideQuickMeasurementInput?: () => void;
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

  const label = document.createElement('span');
  label.id = 'quickMeasurementLabel';

  const input = document.createElement('input');
  input.id = 'quickMeasurementValue';
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Value';

  entry.append(label, input);
  const copyButton = document.getElementById('copyCanvasBtn');
  copyButton?.parentElement === dock
    ? copyButton.insertAdjacentElement('afterend', entry)
    : dock.prepend(entry);

  let activeImageLabel = '';
  let activeStrokeLabel = '';
  let originalValue = '';
  let cancelPending = false;

  const hide = () => {
    entry.hidden = true;
    activeImageLabel = '';
    activeStrokeLabel = '';
  };

  const commit = (): boolean => {
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
      if (commit()) input.select();
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

  const quickWindow = window as QuickMeasurementWindow;
  quickWindow.focusQuickMeasurementInput = (strokeLabel, imageLabel) => {
    activeStrokeLabel = String(strokeLabel || '').trim();
    activeImageLabel = String(imageLabel || '').trim();
    if (!activeStrokeLabel || !activeImageLabel) return;

    label.textContent = activeStrokeLabel;
    originalValue = metadataManager.getMeasurementString(activeImageLabel, activeStrokeLabel) || '';
    input.value = originalValue;
    input.setAttribute('aria-label', `Measurement for ${activeStrokeLabel}`);
    entry.hidden = false;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  };
  quickWindow.hideQuickMeasurementInput = hide;

  const strokePanel = document.getElementById('strokePanel');
  const elementsBody = document.getElementById('elementsBody');
  const hideWhenInspectorOpens = () => {
    const isOpen =
      strokePanel?.getAttribute('aria-expanded') !== 'false' &&
      !strokePanel?.classList.contains('collapsed') &&
      !strokePanel?.classList.contains('minimized') &&
      elementsBody &&
      getComputedStyle(elementsBody).display !== 'none';
    if (isOpen) hide();
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
