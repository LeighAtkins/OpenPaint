// Measurement UI
// Handles UI interactions for measurements

type MeasurementWindow = Window & {
  app?: {
    measurementSystem?: {
      setUnit: (unit: string) => void;
      convertToCm: (inchWhole: number, inchFraction: number) => number;
      convertFromCm: (cm: number) => { inchWhole: number; inchFraction: number };
      parseMeasurementInput: (
        value: string,
        unit?: string
      ) => { inchWhole: number; inchFraction: number; cm: number } | null;
      formatInchInputValue: (
        inchWhole: number,
        inchFraction: number,
        options?: { inchValue?: number; decimalPlaces?: number }
      ) => string;
    };
    measurementDialog?: { open: (imageLabel?: string, strokeLabel?: string) => void };
    metadataManager?: { updateStrokeVisibilityControls: () => void };
  };
  initMeasurementUI?: () => void;
};

export function initMeasurementUI(): void {
  const win = window as unknown as MeasurementWindow;
  if (!win.app || !win.app.measurementSystem) {
    console.warn('Measurement system not initialized yet');
    return;
  }

  const measurementSystem = win.app.measurementSystem;

  // Unit selector handling is centralized in main.ts to avoid duplicate handlers.

  // Setup measurement input event listeners for the main inputs (if visible)
  const inchValueInput = document.getElementById('inchValue') as HTMLInputElement | null;
  const inchWholeInput = document.getElementById('inchWhole') as HTMLInputElement | null;
  const inchFractionSelect = document.getElementById('inchFraction') as HTMLSelectElement | null;
  const cmValueInput = document.getElementById('cmValue') as HTMLInputElement | null;

  if (cmValueInput && inchValueInput) {
    const updateCmFromInch = (): void => {
      const parsed = measurementSystem.parseMeasurementInput(inchValueInput.value, 'inches');
      if (!parsed) return;
      cmValueInput.value = parsed.cm.toFixed(1);
      if (inchWholeInput) inchWholeInput.value = String(parsed.inchWhole);
      if (inchFractionSelect) inchFractionSelect.value = String(parsed.inchFraction);
    };

    const updateInchFromCm = (): void => {
      const cm = parseFloat(cmValueInput.value) || 0;
      const result = measurementSystem.convertFromCm(cm);
      inchValueInput.value = measurementSystem.formatInchInputValue(
        result.inchWhole,
        result.inchFraction,
        { inchValue: cm / 2.54, decimalPlaces: 1 }
      );
      if (inchWholeInput) inchWholeInput.value = String(result.inchWhole);
      if (inchFractionSelect) inchFractionSelect.value = String(result.inchFraction);
    };

    inchValueInput.addEventListener('input', updateCmFromInch);
    cmValueInput.addEventListener('input', updateInchFromCm);
  } else if (inchWholeInput && inchFractionSelect && cmValueInput) {
    // Legacy hidden compatibility path
    const updateCmFromInch = (): void => {
      const inchWhole = parseInt(inchWholeInput.value, 10) || 0;
      const inchFraction = parseFloat(inchFractionSelect.value) || 0;
      const cm = measurementSystem.convertToCm(inchWhole, inchFraction);
      cmValueInput.value = cm.toFixed(1);
    };

    const updateInchFromCm = (): void => {
      const cm = parseFloat(cmValueInput.value) || 0;
      const result = measurementSystem.convertFromCm(cm);
      inchWholeInput.value = String(result.inchWhole);
      inchFractionSelect.value = String(result.inchFraction);
    };

    inchWholeInput.addEventListener('input', updateCmFromInch);
    inchFractionSelect.addEventListener('change', updateCmFromInch);
    cmValueInput.addEventListener('input', updateInchFromCm);
  }

  console.log('Measurement UI initialized');
}

function setupEditMeasurementHandlers(): void {
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    if (target?.classList.contains('edit-measurement-btn')) {
      const imageLabel = target.dataset['imageLabel'];
      const strokeLabel = target.dataset['strokeLabel'];

      const win = window as unknown as MeasurementWindow;
      if (win.app?.measurementDialog) {
        win.app.measurementDialog.open(imageLabel, strokeLabel);
      }
    }
  });
}

export function startMeasurementUI(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        initMeasurementUI();
        setupEditMeasurementHandlers();
      }, 100);
    });
  } else {
    setTimeout(() => {
      initMeasurementUI();
      setupEditMeasurementHandlers();
    }, 100);
  }

  // Expose initialization function for manual initialization if needed
  (window as unknown as MeasurementWindow).initMeasurementUI = initMeasurementUI;
}

startMeasurementUI();
