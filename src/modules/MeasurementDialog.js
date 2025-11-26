// Measurement Dialog
// Modal dialog for editing measurements

export class MeasurementDialog {
  constructor(measurementSystem) {
    this.measurementSystem = measurementSystem;
    this.currentImageLabel = null;
    this.currentStrokeLabel = null;
    this.dialogElement = null;
    this.isOpen = false;

    this.createDialog();
    this.setupEventListeners();
  }

  createDialog() {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'measurementDialogOverlay';
    overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: none;
            align-items: center;
            justify-content: center;
        `;

    // Create dialog
    const dialog = document.createElement('div');
    dialog.id = 'measurementDialog';
    dialog.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

    dialog.innerHTML = `
            <h2 style="margin-top: 0; margin-bottom: 20px; color: #333; font-size: 20px; font-weight: 600;">Edit Measurement</h2>

            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 4px; color: #555; font-size: 14px; font-weight: 500;">Label</label>
                <div id="dialogStrokeLabel" style="font-size: 18px; font-weight: bold; font-family: monospace; color: #3b82f6;"></div>
            </div>

            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; color: #555; font-size: 14px; font-weight: 500;">Inches</label>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="number" id="dialogInchWhole" min="0" value="0" style="width: 80px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                    <select id="dialogInchFraction" style="padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                        <option value="0">0</option>
                        <option value="0.125">1/8</option>
                        <option value="0.25">1/4</option>
                        <option value="0.375">3/8</option>
                        <option value="0.5">1/2</option>
                        <option value="0.625">5/8</option>
                        <option value="0.75">3/4</option>
                        <option value="0.875">7/8</option>
                    </select>
                </div>
            </div>

            <div style="margin-bottom: 24px;">
                <label style="display: block; margin-bottom: 8px; color: #555; font-size: 14px; font-weight: 500;">Centimeters</label>
                <input type="number" id="dialogCmValue" min="0" step="0.1" value="0.0" style="width: 120px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="dialogCancel" style="
                    padding: 8px 16px;
                    border: 1px solid #d1d5db;
                    background: white;
                    color: #374151;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                ">Cancel</button>
                <button id="dialogSave" style="
                    padding: 8px 16px;
                    border: none;
                    background: #3b82f6;
                    color: white;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                ">Save</button>
            </div>
        `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    this.dialogElement = overlay;
  }

  setupEventListeners() {
    if (!this.dialogElement) return;

    const inchWholeInput = this.dialogElement.querySelector('#dialogInchWhole');
    const inchFractionSelect = this.dialogElement.querySelector('#dialogInchFraction');
    const cmValueInput = this.dialogElement.querySelector('#dialogCmValue');
    const saveButton = this.dialogElement.querySelector('#dialogSave');
    const cancelButton = this.dialogElement.querySelector('#dialogCancel');

    // Inch to CM conversion
    const updateCmFromInch = () => {
      const inchWhole = parseInt(inchWholeInput.value, 10) || 0;
      const inchFraction = parseFloat(inchFractionSelect.value) || 0;
      const cm = this.measurementSystem.convertToCm(inchWhole, inchFraction);
      cmValueInput.value = cm.toFixed(1);
    };

    // CM to Inch conversion
    const updateInchFromCm = () => {
      const cm = parseFloat(cmValueInput.value) || 0;
      const result = this.measurementSystem.convertFromCm(cm);
      inchWholeInput.value = result.inchWhole;
      inchFractionSelect.value = result.inchFraction;
    };

    inchWholeInput.addEventListener('input', updateCmFromInch);
    inchFractionSelect.addEventListener('change', updateCmFromInch);
    cmValueInput.addEventListener('input', updateInchFromCm);

    // Save button
    saveButton.addEventListener('click', () => {
      this.saveMeasurement();
    });

    // Cancel button
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // Close on overlay click
    this.dialogElement.addEventListener('click', e => {
      if (e.target === this.dialogElement) {
        this.close();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  open(imageLabel, strokeLabel) {
    this.currentImageLabel = imageLabel;
    this.currentStrokeLabel = strokeLabel;
    this.isOpen = true;

    // Update label display
    const labelDisplay = this.dialogElement.querySelector('#dialogStrokeLabel');
    labelDisplay.textContent = strokeLabel;

    // Load existing measurement if available
    const measurement = this.measurementSystem.getMeasurement(imageLabel, strokeLabel);
    const inchWholeInput = this.dialogElement.querySelector('#dialogInchWhole');
    const inchFractionSelect = this.dialogElement.querySelector('#dialogInchFraction');
    const cmValueInput = this.dialogElement.querySelector('#dialogCmValue');

    if (measurement) {
      inchWholeInput.value = measurement.inchWhole;
      inchFractionSelect.value = measurement.inchFraction;
      cmValueInput.value = measurement.cm.toFixed(1);
    } else {
      inchWholeInput.value = 0;
      inchFractionSelect.value = 0;
      cmValueInput.value = '0.0';
    }

    // Show dialog
    this.dialogElement.style.display = 'flex';

    // Focus first input
    setTimeout(() => inchWholeInput.focus(), 100);
  }

  close() {
    this.isOpen = false;
    this.currentImageLabel = null;
    this.currentStrokeLabel = null;
    this.dialogElement.style.display = 'none';
  }

  saveMeasurement() {
    const inchWholeInput = this.dialogElement.querySelector('#dialogInchWhole');
    const inchFractionSelect = this.dialogElement.querySelector('#dialogInchFraction');

    const inchWhole = parseInt(inchWholeInput.value, 10) || 0;
    const inchFraction = parseFloat(inchFractionSelect.value) || 0;

    // Save measurement
    this.measurementSystem.setMeasurement(
      this.currentImageLabel,
      this.currentStrokeLabel,
      inchWhole,
      inchFraction
    );

    // Update UI if metadataManager has updateStrokeVisibilityControls
    if (this.measurementSystem.metadataManager.updateStrokeVisibilityControls) {
      this.measurementSystem.metadataManager.updateStrokeVisibilityControls();
    }

    // Close dialog
    this.close();
  }
}
