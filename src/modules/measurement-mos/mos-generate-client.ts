// @ts-nocheck
/**
 * MOS Generate Client — calls the server-side Gemini generate endpoint.
 */

import type { MosGenerateRequest, MosGenerateResponse } from './types';

const GENERATE_ENDPOINT = '/api/measurements/generate';

/**
 * Call the MOS generate endpoint and return the response.
 */
export async function generateMosOverlay(
  request: MosGenerateRequest
): Promise<MosGenerateResponse> {
  const response = await fetch(GENERATE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      success: false,
      error: data.error || `Server returned ${response.status}`,
      rawSvg: data.rawSvg,
      validationErrors: data.validationErrors,
    };
  }

  return data as MosGenerateResponse;
}

/**
 * Capture the current background image as a base64 data URL.
 * Used as a dev fallback when no R2 key is available.
 */
export function captureBackgroundImageDataUrl(canvas: any): string | null {
  const bgImg = canvas?.backgroundImage;
  if (!bgImg) return null;

  try {
    const el = bgImg.getElement?.();
    if (!el) return null;

    const tmpCanvas = document.createElement('canvas');
    const MAX_EDGE = 1024;
    const w = el.naturalWidth || el.width;
    const h = el.naturalHeight || el.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));

    tmpCanvas.width = Math.round(w * scale);
    tmpCanvas.height = Math.round(h * scale);

    const ctx = tmpCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(el, 0, 0, tmpCanvas.width, tmpCanvas.height);
    return tmpCanvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.error('[MOS] Failed to capture background image:', err);
    return null;
  }
}
