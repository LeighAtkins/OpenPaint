// @ts-nocheck
/**
 * MOS Generate UI — adds the "Generate Overlay" button and modal to the editor.
 *
 * Integrates into the existing toolbar/measurement area. Creates a modal dialog
 * matching the MeasurementDialog.js visual style for configuration and feedback.
 */

import type { MosGenerateRequest } from './types';
import { generateMosOverlay, captureBackgroundImageDataUrl } from './mos-generate-client';
import type { MeasurementOverlayManager } from './MeasurementOverlayManager';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the MOS generate UI. Call once after deferred managers are ready.
 * Returns a cleanup function.
 */
export function initMosGenerateUI(
  manager: MeasurementOverlayManager,
  canvasManager: any,
  projectManager: any
): () => void {
  const { overlay, destroy } = createGenerateDialog(manager, canvasManager, projectManager);
  document.body.appendChild(overlay);

  // Add toolbar button
  const btn = createToolbarButton(() => openDialog(overlay));
  const toolbar = document.querySelector(
    '.measurement-toolbar, #measurementPanel, .toolbar-bottom'
  );
  if (toolbar) {
    toolbar.appendChild(btn);
  } else {
    // Fallback: add to body as floating button
    btn.style.position = 'fixed';
    btn.style.bottom = '80px';
    btn.style.right = '20px';
    btn.style.zIndex = '9999';
    document.body.appendChild(btn);
  }

  return () => {
    overlay.remove();
    btn.remove();
    destroy();
  };
}

// ---------------------------------------------------------------------------
// Dialog creation
// ---------------------------------------------------------------------------

function createGenerateDialog(
  manager: MeasurementOverlayManager,
  canvasManager: any,
  projectManager: any
): { overlay: HTMLElement; destroy: () => void } {
  const overlay = document.createElement('div');
  overlay.id = 'mosGenerateOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(11, 13, 16, 0.5);
    z-index: 10000;
    display: none;
    align-items: center;
    justify-content: center;
  `;

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('tabindex', '-1');
  dialog.style.cssText = `
    background: #fff;
    border-radius: 16px;
    padding: 28px;
    max-width: 480px;
    width: 90%;
    box-shadow: 0 24px 48px rgba(11, 13, 16, 0.18), 0 8px 16px rgba(11, 13, 16, 0.08);
    font-family: 'Instrument Sans', 'Inter', sans-serif;
  `;

  dialog.innerHTML = `
    <h2 style="margin-top: 0; margin-bottom: 16px; color: #151A20; font-size: 22px; font-weight: 600;">
      Generate Measurement Overlay
    </h2>
    <p style="margin-top: 0; margin-bottom: 20px; color: #3E4752; font-size: 13px;">
      Use AI to generate measurement lines for the current image.
    </p>

    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 6px; color: #3E4752; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">
        Measurement Roles
      </label>
      <div id="mosRolesContainer" style="display: flex; flex-wrap: wrap; gap: 8px;">
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #3E4752;">
          <input type="checkbox" value="W" checked> Width
        </label>
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #3E4752;">
          <input type="checkbox" value="H" checked> Height
        </label>
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #3E4752;">
          <input type="checkbox" value="D1"> Depth
        </label>
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #3E4752;">
          <input type="checkbox" value="D2"> Diagonal
        </label>
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #3E4752;">
          <input type="checkbox" value="SH"> Seat Height
        </label>
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #3E4752;">
          <input type="checkbox" value="SD"> Seat Depth
        </label>
      </div>
    </div>

    <div style="margin-bottom: 16px;">
      <label for="mosUnits" style="display: block; margin-bottom: 6px; color: #3E4752; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">
        Units
      </label>
      <select id="mosUnits" style="padding: 10px 14px; border: 1px solid #E7EAEE; border-radius: 12px; font-size: 14px; background: #fff; outline: none;">
        <option value="cm" selected>Centimeters</option>
        <option value="mm">Millimeters</option>
        <option value="in">Inches</option>
      </select>
    </div>

    <div id="mosGenerateStatus" style="margin-bottom: 16px; display: none;">
      <div id="mosGenerateSpinner" style="display: flex; align-items: center; gap: 8px; color: #3E4752; font-size: 13px;">
        <svg width="16" height="16" viewBox="0 0 16 16" style="animation: mos-spin 1s linear infinite;">
          <circle cx="8" cy="8" r="6" fill="none" stroke="#2D6BFF" stroke-width="2" stroke-dasharray="32" stroke-dashoffset="8" />
        </svg>
        <span>Generating overlay...</span>
      </div>
      <div id="mosGenerateError" style="display: none; color: #DC2626; font-size: 13px; margin-top: 8px;"></div>
      <div id="mosGenerateSuccess" style="display: none; color: #059669; font-size: 13px; margin-top: 8px;"></div>
    </div>

    <div style="display: flex; gap: 10px; justify-content: flex-end;">
      <button id="mosGenerateCancel" type="button" style="
        padding: 10px 20px;
        border: 1px solid #E7EAEE;
        background: #F6F7F9;
        color: #0B0D10;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'Instrument Sans', 'Inter', sans-serif;
      ">Cancel</button>
      <button id="mosGenerateSubmit" type="button" style="
        padding: 10px 20px;
        border: none;
        background: #0B0D10;
        color: #fff;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'Instrument Sans', 'Inter', sans-serif;
      ">Generate</button>
    </div>
  `;

  overlay.appendChild(dialog);

  // Add spinner animation style
  if (!document.getElementById('mos-spin-style')) {
    const style = document.createElement('style');
    style.id = 'mos-spin-style';
    style.textContent = `@keyframes mos-spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }

  // --- Wire events ---
  const cancelBtn = dialog.querySelector('#mosGenerateCancel')!;
  const submitBtn = dialog.querySelector('#mosGenerateSubmit')!;
  const statusDiv = dialog.querySelector('#mosGenerateStatus')!;
  const spinnerDiv = dialog.querySelector('#mosGenerateSpinner')!;
  const errorDiv = dialog.querySelector('#mosGenerateError')!;
  const successDiv = dialog.querySelector('#mosGenerateSuccess')!;

  cancelBtn.addEventListener('click', () => closeDialog(overlay));

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeDialog(overlay);
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  submitBtn.addEventListener('click', async () => {
    // Gather selected roles
    const roleCheckboxes = dialog.querySelectorAll(
      '#mosRolesContainer input[type="checkbox"]:checked'
    );
    const roles = Array.from(roleCheckboxes).map((cb: HTMLInputElement) => cb.value);
    const units = dialog.querySelector('#mosUnits')!.value as 'cm' | 'mm' | 'in';

    if (roles.length === 0) {
      errorDiv.textContent = 'Select at least one measurement role.';
      errorDiv.style.display = 'block';
      statusDiv.style.display = 'block';
      return;
    }

    // Show spinner
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    statusDiv.style.display = 'block';
    spinnerDiv.style.display = 'flex';
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    try {
      const canvas = canvasManager.fabricCanvas;
      const bgImg = canvas?.backgroundImage;

      // Determine image dimensions
      const imageWidth = bgImg?.width || canvas?.width || 1;
      const imageHeight = bgImg?.height || canvas?.height || 1;

      // Build request
      const request: MosGenerateRequest = {
        viewId: projectManager?.currentViewId || 'front',
        imageWidth,
        imageHeight,
        requestedRoles: roles,
        units,
      };

      // Attach guide code from sofa metadata so the server can fetch a reference template SVG
      const sofaMeta = projectManager?.getProjectMetadata?.() || (window as any).projectMetadata;
      const guideCodes = sofaMeta?.measurementGuideCodes || [];
      if (guideCodes.length > 0) {
        request.templateId = guideCodes[0];
      }

      // Try to get R2 key from current image, fallback to data URL
      const imageDataUrl = captureBackgroundImageDataUrl(canvas);
      if (imageDataUrl) {
        request.imageDataUrl = imageDataUrl;
      } else {
        throw new Error('No background image available to generate overlay from.');
      }

      const response = await generateMosOverlay(request);

      if (response.success && response.svg) {
        // Import the generated SVG as an overlay
        const viewId = projectManager?.currentViewId || 'front';
        await manager.importSvg(response.svg, viewId, {
          sourceR2Key: response.r2Key,
          supabaseId: response.supabaseId,
        });

        successDiv.textContent = `Overlay generated (attempt ${response.attempt || 1}). ${response.usage ? `Tokens: ${response.usage.totalTokenCount}` : ''}`;
        successDiv.style.display = 'block';
        spinnerDiv.style.display = 'none';

        // Auto-close after brief delay
        setTimeout(() => closeDialog(overlay), 1500);
      } else {
        throw new Error(response.error || 'Unknown generation error');
      }
    } catch (err) {
      spinnerDiv.style.display = 'none';
      errorDiv.textContent = err.message || 'Generation failed';
      errorDiv.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  const destroy = () => {
    // Cleanup if needed
  };

  return { overlay, destroy };
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

function createToolbarButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'mosGenerateBtn';
  btn.title = 'Generate Measurement Overlay (AI)';
  btn.setAttribute('aria-label', 'Generate Measurement Overlay');
  btn.style.cssText = `
    padding: 8px 14px;
    border: 1px solid #E7EAEE;
    background: #fff;
    color: #0B0D10;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: 'Instrument Sans', 'Inter', sans-serif;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s, border-color 0.15s;
  `;

  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1v14M1 8h14M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    MOS Overlay
  `;

  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#F6F7F9';
    btn.style.borderColor = '#D1D5DB';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#fff';
    btn.style.borderColor = '#E7EAEE';
  });
  btn.addEventListener('click', onClick);

  return btn;
}

// ---------------------------------------------------------------------------
// Dialog open/close helpers
// ---------------------------------------------------------------------------

function openDialog(overlay: HTMLElement): void {
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');

  // Reset state
  const statusDiv = overlay.querySelector('#mosGenerateStatus')!;
  if (statusDiv) statusDiv.style.display = 'none';

  const dialog = overlay.querySelector('[role="dialog"]')!;
  dialog?.focus();
}

function closeDialog(overlay: HTMLElement): void {
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
}
