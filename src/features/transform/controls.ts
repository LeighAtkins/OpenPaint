/**
 * Rotation Controls Module
 * Binds rotation buttons to TypeScript rotation service
 */

import { rotationService } from './rotation.service';

/**
 * Bind rotation buttons to TypeScript rotation service
 */
export function initializeRotationControls(): void {
  if ((window as any).app) {
    console.warn('[RotationControls] Legacy app detected, skipping TS rotation binding');
    return;
  }
  const rotateLeftCtrl = document.getElementById('rotateLeftCtrl') as HTMLButtonElement;
  const rotateRightCtrl = document.getElementById('rotateRightCtrl') as HTMLButtonElement;

  if (!rotateLeftCtrl || !rotateRightCtrl) {
    console.warn('[RotationControls] Rotation buttons not found in DOM');
    return;
  }

  rotateLeftCtrl.addEventListener('click', () => {
    const imageLabel = rotationService.getCurrentImageLabel();
    if (imageLabel) {
      console.log(`[RotationControls] Rotating ${imageLabel} left`);
      rotationService.rotateLeft(imageLabel);
    }
  });

  rotateRightCtrl.addEventListener('click', () => {
    const imageLabel = rotationService.getCurrentImageLabel();
    if (imageLabel) {
      console.log(`[RotationControls] Rotating ${imageLabel} right`);
      rotationService.rotateRight(imageLabel);
    }
  });

  console.log('[RotationControls] Rotation controls initialized');
}

/**
 * Unbind rotation controls
 */
export function cleanupRotationControls(): void {
  const rotateLeftCtrl = document.getElementById('rotateLeftCtrl') as HTMLButtonElement;
  const rotateRightCtrl = document.getElementById('rotateRightCtrl') as HTMLButtonElement;

  if (rotateLeftCtrl) {
    const newLeftCtrl = rotateLeftCtrl.cloneNode(true) as HTMLButtonElement;
    rotateLeftCtrl.parentNode?.replaceChild(newLeftCtrl, rotateLeftCtrl);
  }

  if (rotateRightCtrl) {
    const newRightCtrl = rotateRightCtrl.cloneNode(true) as HTMLButtonElement;
    rotateRightCtrl.parentNode?.replaceChild(newRightCtrl, rotateRightCtrl);
  }

  console.log('[RotationControls] Rotation controls cleaned up');
}
