/**
 * OCR worker for scanned CW forms. Runs Tesseract.js with its worker, core and
 * English data served from this app (/tesseract/, copied from node_modules at
 * build time), so customer pages never leave the browser and nothing loads
 * from a CDN. Box crops are cut, scaled and contrast stretched here too.
 *
 * Messages: { id, type: 'words', image } -> { id, result: TextLine[] }
 *           { id, type: 'cells', image, rects } -> { id, result: CellRead[] }
 */
import { createWorker } from 'tesseract.js';
import { createTesseractEngine } from './tesseract-engine';
import type { GrayImage } from './scan-image';
import type { OcrEngine } from './scan-reader';

const scope = self as unknown as {
  location: Location;
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

/** A box crop as a small PNG data URL (about 32 px tall) for the review strip. */
async function thumb(crop: GrayImage): Promise<string | undefined> {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const height = 32;
  const width = Math.max(1, Math.round((crop.width * height) / crop.height));
  const full = new OffscreenCanvas(crop.width, crop.height);
  const ctx = full.getContext('2d');
  if (!ctx) return undefined;
  const rgba = new Uint8ClampedArray(crop.width * crop.height * 4);
  for (let i = 0; i < crop.data.length; i += 1) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = crop.data[i];
    rgba[i * 4 + 3] = 255;
  }
  ctx.putImageData(new ImageData(rgba, crop.width, crop.height), 0, 0);
  const small = new OffscreenCanvas(width, height);
  small.getContext('2d')?.drawImage(full, 0, 0, width, height);
  const blob = await small.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

let engine: Promise<OcrEngine> | null = null;

function getEngine(): Promise<OcrEngine> {
  engine ||= (async () => {
    const base = new URL('/tesseract/', scope.location.origin).href;
    const worker = await createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: `${base}lang`,
      gzip: true,
    });
    return createTesseractEngine(worker as any, { thumb });
  })();
  return engine;
}

async function handle(data: any): Promise<void> {
  const { id, type, image, rects } = data || {};
  try {
    const ocr = await getEngine();
    const result =
      type === 'words' ? await ocr.readWords(image) : await ocr.readCells(image, rects);
    scope.postMessage({ id, result });
  } catch (error) {
    scope.postMessage({ id, error: String((error as Error)?.message || error) });
  }
}

scope.onmessage = (event: MessageEvent) => {
  void handle(event.data);
};
