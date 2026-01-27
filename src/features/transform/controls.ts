/**
 * Rotation Controls Module
 * Binds rotation buttons to TypeScript rotation service
 */

import { rotationService } from './rotation.service';

/**
 * Bind rotation buttons to TypeScript rotation service
 */
export function initializeRotationControls(): void {
  const legacyApp = (window as Window & { app?: unknown }).app;
  if (legacyApp !== undefined) {
    console.warn('[RotationControls] Legacy app detected, skipping TS rotation binding');
    return;
  }
  const rotateLeftCtrl = document.getElementById('rotateLeftCtrl');
  const rotateRightCtrl = document.getElementById('rotateRightCtrl');

  if (!(rotateLeftCtrl instanceof HTMLButtonElement)) {
    console.warn('[RotationControls] Rotate left button not found in DOM');
    return;
  }

  if (!(rotateRightCtrl instanceof HTMLButtonElement)) {
    console.warn('[RotationControls] Rotate right button not found in DOM');
    return;
  }

  rotateLeftCtrl.addEventListener('click', () => {
    const imageLabel = rotationService.getCurrentImageLabel();
    if (imageLabel !== null && imageLabel !== undefined && imageLabel !== '') {
      rotationService.rotateLeft(imageLabel);
    }
  });

  rotateRightCtrl.addEventListener('click', () => {
    const imageLabel = rotationService.getCurrentImageLabel();
    if (imageLabel !== null && imageLabel !== undefined && imageLabel !== '') {
      rotationService.rotateRight(imageLabel);
    }
  });
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
}
