// @ts-nocheck
/**
 * MOS Edit Controls — endpoint drag, label drag, and follower movement.
 *
 * Integrates with the MeasurementOverlayManager to update the model
 * on mouseup (for undo/redo snapshots) and avoids history spam during drag.
 */

import type { MeasurementOverlayElement, MosFabricCustomData } from './types';
import { canvasToMos, getImageRect } from './mos-transform';

declare const fabric: any;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wire up MOS-specific edit events on the Fabric canvas.
 * Called once after the canvas is ready.
 */
export function initMosEditControls(
  canvas: any,
  getOverlayElement: (fabricObj: any) => MeasurementOverlayElement | undefined,
  onElementModified: (element: MeasurementOverlayElement) => void
): () => void {
  // Track drag state for snapshot-on-mouseup
  let dragStartSnapshot: { elementId: string; endpoints: any[] } | null = null;

  // --- object:moving — track MOS line/label drag start ---
  const onMoving = (e: any) => {
    const obj = e.target;
    if (!obj) return;
    const cd = obj.customData as MosFabricCustomData | undefined;
    if (cd?.layerType !== 'mos-overlay') return;

    // Capture snapshot on first move (drag start)
    if (!dragStartSnapshot) {
      const element = getOverlayElement(obj);
      if (element) {
        dragStartSnapshot = {
          elementId: element.id,
          endpoints: JSON.parse(JSON.stringify(element.endpoints)),
        };
      }
    }
  };

  // --- mouse:up — commit model update + fire modified ---
  const onMouseUp = (_e: any) => {
    if (!dragStartSnapshot) return;

    const imageRect = getImageRect(canvas);
    const element = findElementById(canvas, dragStartSnapshot.elementId, getOverlayElement);

    if (element) {
      // Update MOS model from current Fabric object positions
      updateElementFromFabric(element, canvas, imageRect);
      element.dirty = true;
      onElementModified(element);
    }

    dragStartSnapshot = null;
  };

  // --- Attach listeners ---
  canvas.on('object:moving', onMoving);
  canvas.on('mouse:up', onMouseUp);

  // Return cleanup function
  return () => {
    canvas.off('object:moving', onMoving);
    canvas.off('mouse:up', onMouseUp);
  };
}

// ---------------------------------------------------------------------------
// Model update from Fabric positions
// ---------------------------------------------------------------------------

/**
 * Read current Fabric object positions and update the MOS element model.
 */
export function updateElementFromFabric(
  element: MeasurementOverlayElement,
  canvas: any,
  imageRect: ImageRect
): void {
  for (const ep of element.endpoints) {
    if (!ep.fabricObjectId) continue;

    const obj = canvas.getObjects().find((o: any) => o.__mosId === ep.fabricObjectId);
    if (!obj) continue;

    // For lines, read world-space endpoint positions
    if (obj.type === 'line') {
      const points = obj.calcLinePoints();
      const matrix = obj.calcTransformMatrix();

      const epIndex = element.endpoints.indexOf(ep);
      const worldPt =
        epIndex === 0
          ? fabric.util.transformPoint({ x: points.x1, y: points.y1 }, matrix)
          : fabric.util.transformPoint({ x: points.x2, y: points.y2 }, matrix);

      ep.point = canvasToMos(worldPt, imageRect);
    }
    // For other objects (labels, markers), read left/top
    else if (obj.left !== undefined && obj.top !== undefined) {
      ep.point = canvasToMos({ x: obj.left, y: obj.top }, imageRect);
    }
  }

  // Update label position if present
  if (element.label) {
    const labelObj = canvas.getObjects().find((o: any) => o.__mosId === `${element.id}_label`);
    if (labelObj) {
      const mosPt = canvasToMos({ x: labelObj.left, y: labelObj.top }, imageRect);
      element.label.cx = mosPt.x;
      element.label.cy = mosPt.y;
      element.label.rotation = labelObj.angle || 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findElementById(
  canvas: any,
  elementId: string,
  getOverlayElement: (fabricObj: any) => MeasurementOverlayElement | undefined
): MeasurementOverlayElement | undefined {
  for (const obj of canvas.getObjects()) {
    const cd = obj.customData as MosFabricCustomData | undefined;
    if (cd?.layerType === 'mos-overlay' && cd?.elementId === elementId) {
      return getOverlayElement(obj);
    }
  }
  return undefined;
}
