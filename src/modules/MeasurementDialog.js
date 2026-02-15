// Measurement Dialog
// Modal dialog for editing measurements

export class MeasurementDialog {
  constructor(measurementSystem) {
    this.measurementSystem = measurementSystem;
    this.currentImageLabel = null;
    this.currentStrokeLabel = null;
    this.dialogElement = null;
    this.isOpen = false;
    this.previouslyFocusedElement = null;
    this.boundDocumentKeydown = e => this.handleDocumentKeydown(e);

    this.createDialog();
    this.setupEventListeners();
  }

  createDialog() {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'measurementDialogOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(11, 13, 16, 0.5);
            z-index: 10000;
            display: none;
            align-items: center;
            justify-content: center;
        `;

    // Create dialog
    const dialog = document.createElement('div');
    dialog.id = 'measurementDialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'measurementDialogTitle');
    dialog.setAttribute('aria-describedby', 'measurementDialogDescription');
    dialog.setAttribute('tabindex', '-1');
    dialog.style.cssText = `
            background: #fff;
            border-radius: 16px;
            padding: 28px;
            max-width: 460px;
            width: 90%;
            box-shadow: 0 24px 48px rgba(11, 13, 16, 0.18), 0 8px 16px rgba(11, 13, 16, 0.08);
            font-family: 'Instrument Sans', 'Inter', sans-serif;
        `;

    dialog.innerHTML = `
            <h2 id="measurementDialogTitle" style="margin-top: 0; margin-bottom: 20px; color: #151A20; font-size: 24px; font-weight: 600; font-family: 'Instrument Sans', 'Inter', sans-serif;">Edit Measurement</h2>
            <p id="measurementDialogDescription" style="margin-top: 0; margin-bottom: 16px; color: #3E4752; font-size: 13px;">
                Update inches or centimeters. Values stay synchronized automatically.
            </p>

            <div style="margin-bottom: 20px;">
                <div style="display: block; margin-bottom: 6px; color: #3E4752; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">Label</div>
                <div id="dialogStrokeLabel" aria-live="polite" style="font-size: 18px; font-weight: bold; font-family: 'JetBrains Mono', monospace; color: #2D6BFF;"></div>
            </div>

            <div style="margin-bottom: 20px;">
                <label for="dialogInchWhole" style="display: block; margin-bottom: 8px; color: #3E4752; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">Inches</label>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="number" id="dialogInchWhole" min="0" value="0" inputmode="numeric" aria-label="Whole inches" style="width: 90px; padding: 12px 14px; border: 1px solid #E7EAEE; border-radius: 12px; font-size: 16px; font-family: 'JetBrains Mono', monospace; outline: none; transition: border-color 0.15s, box-shadow 0.15s;" onfocus="this.style.borderColor='#2D6BFF';this.style.boxShadow='0 0 0 2px rgba(45,107,255,0.35)'" onblur="this.style.borderColor='#E7EAEE';this.style.boxShadow='none'">
                    <select id="dialogInchFraction" aria-label="Inch fraction" style="padding: 12px 14px; border: 1px solid #E7EAEE; border-radius: 12px; font-size: 16px; font-family: 'JetBrains Mono', monospace; background: #fff; outline: none; transition: border-color 0.15s, box-shadow 0.15s;" onfocus="this.style.borderColor='#2D6BFF';this.style.boxShadow='0 0 0 2px rgba(45,107,255,0.35)'" onblur="this.style.borderColor='#E7EAEE';this.style.boxShadow='none'">
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

            <div style="margin-bottom: 28px;">
                <label for="dialogCmValue" style="display: block; margin-bottom: 8px; color: #3E4752; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">Centimeters</label>
                <input type="number" id="dialogCmValue" min="0" step="0.1" value="0.0" inputmode="decimal" style="width: 140px; padding: 12px 14px; border: 1px solid #E7EAEE; border-radius: 12px; font-size: 16px; font-family: 'JetBrains Mono', monospace; outline: none; transition: border-color 0.15s, box-shadow 0.15s;" onfocus="this.style.borderColor='#2D6BFF';this.style.boxShadow='0 0 0 2px rgba(45,107,255,0.35)'" onblur="this.style.borderColor='#E7EAEE';this.style.boxShadow='none'">
            </div>

            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="dialogCancel" type="button" style="
                    padding: 10px 20px;
                    border: 1px solid #E7EAEE;
                    background: #F6F7F9;
                    color: #0B0D10;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.15s;
                    font-family: 'Instrument Sans', 'Inter', sans-serif;
                ">Cancel</button>
                <button id="dialogSave" type="button" style="
                    padding: 10px 20px;
                    border: none;
                    background: #0B0D10;
                    color: #fff;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.15s;
                    font-family: 'Instrument Sans', 'Inter', sans-serif;
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

    // Keyboard support
    document.addEventListener('keydown', this.boundDocumentKeydown);
  }

  open(imageLabel, strokeLabel) {
    this.currentImageLabel = imageLabel;
    this.currentStrokeLabel = strokeLabel;
    this.isOpen = true;
    this.previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

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
    this.dialogElement.setAttribute('aria-hidden', 'false');
    this.dialogElement.style.display = 'flex';

    // Focus first input
    setTimeout(() => inchWholeInput.focus(), 100);
  }

  close() {
    this.isOpen = false;
    this.currentImageLabel = null;
    this.currentStrokeLabel = null;
    this.dialogElement.setAttribute('aria-hidden', 'true');
    this.dialogElement.style.display = 'none';
    if (
      this.previouslyFocusedElement &&
      typeof this.previouslyFocusedElement.focus === 'function'
    ) {
      this.previouslyFocusedElement.focus();
    }
    this.previouslyFocusedElement = null;
  }

  getFocusableElements() {
    if (!this.dialogElement) return [];
    return Array.from(
      this.dialogElement.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  handleDocumentKeydown(event) {
    if (!this.isOpen || !this.dialogElement) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = this.getFocusableElements();
    if (!focusable.length) return;

    const active = document.activeElement;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
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
