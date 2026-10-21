/**
 * Browser side of scan OCR: draws a PDF page to a grey image with pdf.js and
 * hands OCR to the worker (scan-ocr.worker.ts). The worker starts on first use.
 */
import type { NormRect, TextLine } from './pair-letters';
import { toGray, type GrayImage } from './scan-image';
import type { CellRead, OcrEngine } from './scan-reader';

/** Width scanned pages are drawn at: boxes are read at 3x of this. */
export const SCAN_RENDER_WIDTH = 2000;

export interface WorkerOcrEngine extends OcrEngine {
  terminate(): void;
}

export function createWorkerOcrEngine(): WorkerOcrEngine {
  let worker: Worker | null = null;
  let next = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const start = (): Worker => {
    if (worker) return worker;
    worker = new Worker(new URL('./scan-ocr.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      const { id, result, error } = event.data || {};
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    };
    worker.onerror = event => {
      const failure = new Error(event.message || 'OCR worker failed to start');
      for (const job of pending.values()) job.reject(failure);
      pending.clear();
    };
    return worker;
  };
  const call = <T>(message: Record<string, unknown>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = (next += 1);
      pending.set(id, { resolve, reject });
      start().postMessage({ ...message, id });
    });
  return {
    readWords: (image: GrayImage) => call<TextLine[]>({ type: 'words', image }),
    readCells: (image: GrayImage, rects: NormRect[]) =>
      call<CellRead[]>({ type: 'cells', image, rects }),
    terminate() {
      worker?.terminate();
      worker = null;
    },
  };
}

/** A pdf.js page drawn to a grey image about SCAN_RENDER_WIDTH px wide. */
export async function renderPageGray(page: any, width = SCAN_RENDER_WIDTH): Promise<GrayImage> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  return toGray(data, Math.round(viewport.width), Math.round(viewport.height));
}
