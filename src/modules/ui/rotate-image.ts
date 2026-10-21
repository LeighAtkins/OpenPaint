// Manual "turn this image" for photos that arrived sideways with no EXIF note
// (for example PNGs converted from HEIC). The pixels themselves are turned and
// the view keeps the same id, name and place in the list.
//
// Measurement lines are stored in image pixel space and would be left behind
// by a pixel turn, so an image that already has lines, text or shapes is not
// turned here; the toolbar rotate buttons turn the view and its lines together.

import { imageRegistry } from '../ImageRegistry.js';
import { rotateImageBlob } from '../utils/exif-orientation';
import { notifyOpenPaint } from './notification-center';

type AnyRecord = Record<string, any>;

const win = (): AnyRecord => window as unknown as AnyRecord;
const projectManager = (): AnyRecord | null =>
  win().app?.projectManager || win().projectManager || null;

function scopeStoreHasEntries(store: unknown, viewId: string): boolean {
  if (!store || typeof store !== 'object') return false;
  return Object.entries(store as AnyRecord).some(([scope, value]) => {
    if (scope !== viewId && !scope.startsWith(`${viewId}::`)) return false;
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value) && typeof value === 'object' && Object.keys(value).length > 0;
  });
}

/** True when the view has lines, text or shapes drawn on it. */
export function viewHasAnnotations(viewId: string): boolean {
  const w = win();
  const strokes = w.app?.metadataManager?.vectorStrokesByImage || w.vectorStrokesByImage;
  return [strokes, w.textElementsByImage, w.shapeElementsByImage].some(store =>
    scopeStoreHasEntries(store, viewId)
  );
}

async function sourceBlob(viewId: string, imageUrl: string): Promise<Blob> {
  const manager = projectManager();
  const kept = manager?.viewImageFiles?.get?.(viewId);
  if (kept instanceof Blob && kept.size > 0) return kept;
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`The image could not be read (${response.status})`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('The image is empty');
  return blob;
}

function fileNameFor(viewId: string, blob: Blob): string {
  const w = win();
  const custom = String(w.customImageNames?.[viewId] || '').trim();
  const fromRegistry = String(imageRegistry?.registered?.get?.(viewId)?.filename || '').trim();
  const base = (custom || fromRegistry || viewId).replace(/\.(png|jpe?g|webp|heic|heif)$/i, '');
  return `${base}${/jpe?g/i.test(blob.type) ? '.jpg' : '.png'}`;
}

/**
 * Turn the pixels of a view's image by 90 degrees (positive = clockwise) and
 * put the result back under the same view id. Returns true when it happened.
 */
export async function rotateViewImage(viewId: string, degrees: 90 | -90): Promise<boolean> {
  const manager = projectManager();
  const view = manager?.views?.[viewId];
  if (!manager || !view?.image) {
    notifyOpenPaint({ message: 'There is no image to rotate.', kind: 'warning' });
    return false;
  }
  if (viewHasAnnotations(viewId)) {
    notifyOpenPaint({
      message:
        'This image has lines on it, so its pixels were not turned. Use the toolbar rotate buttons to turn the image and its lines together.',
      kind: 'warning',
      durationMs: 6000,
    });
    return false;
  }
  notifyOpenPaint({ message: 'Rotating image…', kind: 'loading' });
  try {
    const source = await sourceBlob(viewId, String(view.image));
    const rotated = await rotateImageBlob(source, degrees, fileNameFor(viewId, source));
    const url = URL.createObjectURL(rotated);
    const isCurrent = manager.currentViewId === viewId;
    manager.registerViewImageFile?.(viewId, rotated);
    if (imageRegistry.isEnabled?.() && typeof imageRegistry.registerImage === 'function') {
      await imageRegistry.registerImage(viewId, url, rotated.name, {
        source: 'rotate',
        refreshBackground: isCurrent,
        mimeType: rotated.type,
        originalFilename: rotated.name,
        uploadedAt: new Date().toISOString(),
      });
    } else {
      await manager.addImage(viewId, url, { refreshBackground: isCurrent });
    }
    const w = win();
    if (w.originalImages) w.originalImages[viewId] = url;
    if (w.originalImageDimensions) delete w.originalImageDimensions[viewId];
    const thumb = document.querySelector<HTMLImageElement>(
      `#imageList [data-label="${CSS.escape(viewId)}"] img`
    );
    if (thumb) thumb.src = url;
    const card = document.querySelector<HTMLElement>(
      `#imageList [data-label="${CSS.escape(viewId)}"]`
    );
    if (card) card.dataset.originalImageUrl = url;
    window.dispatchEvent(
      new CustomEvent('openpaint:project-dirty', { detail: { source: 'rotate-image', viewId } })
    );
    window.dispatchEvent(
      new CustomEvent('openpaint:image-rotated', { detail: { viewId, degrees, url } })
    );
    notifyOpenPaint({
      message: `Rotated the image 90 degrees ${degrees > 0 ? 'clockwise' : 'anticlockwise'}.`,
      kind: 'success',
    });
    return true;
  } catch (error) {
    console.warn('[rotate-image] failed', viewId, error);
    notifyOpenPaint({
      message: `The image could not be rotated: ${(error as Error)?.message || error}`,
      kind: 'error',
    });
    return false;
  }
}

/** Two small buttons (anticlockwise, clockwise) for an image card. */
export function createRotateButtons(viewId: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rotate-image-controls opacity-0 group-hover:opacity-100 transition-opacity';
  wrap.style.cssText =
    'position: absolute; top: 6px; left: 6px; display: flex; gap: 4px; z-index: 10;';
  const make = (degrees: 90 | -90, glyph: string, title: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rotate-image-btn';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.textContent = glyph;
    button.style.cssText =
      'cursor: pointer; background: rgba(255, 255, 255, 0.9); border: 1px solid rgb(204, 204, 204); border-radius: 50%; width: 22px; height: 22px; font-size: 13px; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; color: rgb(71, 85, 105); line-height: 1; padding: 0; margin: 0;';
    button.addEventListener('click', event => {
      event.stopPropagation();
      event.preventDefault();
      button.disabled = true;
      void rotateViewImage(viewId, degrees).finally(() => {
        button.disabled = false;
      });
    });
    return button;
  };
  wrap.append(
    make(-90, '↶', 'Rotate image 90 degrees anticlockwise'),
    make(90, '↷', 'Rotate image 90 degrees clockwise')
  );
  return wrap;
}
