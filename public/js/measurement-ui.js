// Measurement UI
// Handles UI interactions for measurements

(function() {
    'use strict';

    // Wait for app to be initialized
    function initMeasurementUI() {
        if (!window.app || !window.app.measurementSystem) {
            console.warn('Measurement system not initialized yet');
            return;
        }

        const measurementSystem = window.app.measurementSystem;
        const measurementDialog = window.app.measurementDialog;

        // Setup unit selector event listener
        const unitSelector = document.getElementById('unitSelector');
        if (unitSelector) {
            unitSelector.addEventListener('change', (e) => {
                const unit = e.target.value === 'inch' ? 'inches' : 'cm';
                measurementSystem.setUnit(unit);

                // Refresh all measurement displays
                if (window.app.metadataManager) {
                    window.app.metadataManager.updateStrokeVisibilityControls();
                }
            });
        }

        // Setup measurement input event listeners for the main inputs (if visible)
        const inchWholeInput = document.getElementById('inchWhole');
        const inchFractionSelect = document.getElementById('inchFraction');
        const cmValueInput = document.getElementById('cmValue');

        if (inchWholeInput && inchFractionSelect && cmValueInput) {
            // Inch to CM conversion
            const updateCmFromInch = () => {
                const inchWhole = parseInt(inchWholeInput.value, 10) || 0;
                const inchFraction = parseFloat(inchFractionSelect.value) || 0;
                const cm = measurementSystem.convertToCm(inchWhole, inchFraction);
                cmValueInput.value = cm.toFixed(1);
            };

            // CM to Inch conversion
            const updateInchFromCm = () => {
                const cm = parseFloat(cmValueInput.value) || 0;
                const result = measurementSystem.convertFromCm(cm);
                inchWholeInput.value = result.inchWhole;
                inchFractionSelect.value = result.inchFraction;
            };

            inchWholeInput.addEventListener('input', updateCmFromInch);
            inchFractionSelect.addEventListener('change', updateCmFromInch);
            cmValueInput.addEventListener('input', updateInchFromCm);
        }

        console.log('Measurement UI initialized');
    }

    // Setup "Edit Measurement" button handlers using event delegation
    function setupEditMeasurementHandlers() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-measurement-btn')) {
                const imageLabel = e.target.dataset.imageLabel;
                const strokeLabel = e.target.dataset.strokeLabel;

                if (window.app && window.app.measurementDialog) {
                    window.app.measurementDialog.open(imageLabel, strokeLabel);
                }
            }
        });
    }

    // Initialize when DOM is ready and app is available
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
    window.initMeasurementUI = initMeasurementUI;
})();
