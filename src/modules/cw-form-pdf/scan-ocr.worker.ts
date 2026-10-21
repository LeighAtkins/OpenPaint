/**
 * OCR worker for scanned CW forms. Printed words (which form, where it sits)
 * come from Tesseract.js; handwritten values from the PP-OCRv4 recogniser run
 * by onnxruntime-web (ppocr-cells.ts), with Tesseract as the fallback when the
 * model cannot load. Every file is served from this app (/tesseract/, the
 * model in /ocr/, the onnxruntime .wasm bundled into /assets/), so customer
 * pages never leave the browser and nothing loads from a CDN.
 *
 * Messages: { id, type: 'words', image } -> { id, result: TextLine[] }
 *           { id, type: 'cells', image, rects } -> { id, result: CellRead[] }
 */
import { createWorker } from 'tesseract.js';
import * as ort from 'onnxruntime-web/wasm';
import { createTesseractEngine } from './tesseract-engine';
import { createOrtRecognise, createPpocrEngine, PPOCR_MODEL_PATH } from './ppocr-cells';
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
    const tesseract = createTesseractEngine(worker as any, { thumb });
    try {
      // Single thread (no cross-origin isolation needed). The runtime's .wasm is bundled
      // by Vite from node_modules and served from this app's /assets/.
      ort.env.wasm.numThreads = 1;
      const recognise = await createOrtRecognise(
        ort as any,
        new URL(PPOCR_MODEL_PATH, scope.location.origin).href
      );
      return createPpocrEngine(recognise, tesseract, { thumb });
    } catch (error) {
      console.warn('[scan-ocr] PP-OCR unavailable, reading boxes with Tesseract', error);
      return tesseract;
    }
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
