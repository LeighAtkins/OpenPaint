/**
 * OcrEngine on a Tesseract.js worker. The same code runs in the browser OCR
 * worker (scan-ocr.worker.ts) and in Node tests; only the way the Tesseract
 * worker is created differs.
 */
import type { NormRect, TextLine } from './pair-letters';
import { cropForOcr, downscale, encodePgm, hasInk, type GrayImage } from './scan-image';
import type { CellRead, OcrEngine } from './scan-reader';

/** What we use of a Tesseract.js worker. */
export interface TesseractWorkerLike {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(image: Uint8Array, options?: unknown, output?: unknown): Promise<{ data: any }>;
}

export const DIGIT_WHITELIST = '0123456789.,/\'" ';

/** Width the whole page is read at; printed words need no more. */
export const PAGE_OCR_WIDTH = 1600;

export interface TesseractEngineOptions {
  /** Makes a small picture of a box crop (browser only). */
  thumb?: (crop: GrayImage) => Promise<string | undefined>;
}

/** The writing area of a box: past its border on every side. */
export function valueArea(rect: NormRect): NormRect {
  const dy = rect.h * 0.08;
  const dx = Math.max(rect.w * 0.04, dy);
  return { x: rect.x + dx, y: rect.y + dy, w: rect.w - 2 * dx, h: rect.h - 2 * dy };
}

const LOOK_ALIKE: Record<string, string> = {
  '+': '7',
  F: '7',
  f: '7',
  T: '7',
  t: '7',
  I: '1',
  l: '1',
  '|': '1',
  '!': '1',
  ']': '1',
  i: '1',
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  q: '9',
  g: '9',
  S: '5',
  s: '5',
  Z: '2',
  z: '2',
  B: '8',
  b: '6',
  G: '6',
  ',': '.',
};

/** Free-text OCR of a box as digits. */
export function digitsFromFreeText(raw: string): string {
  return raw
    .split('')
    .map(ch => LOOK_ALIKE[ch] ?? ch)
    .join('')
    .replace(/[^0-9./ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A measurement as customers write it: 1 to 3 digits, maybe a decimal part. */
const WELL_FORMED = /^\d{1,3}(?:\.\d{1,2})?$/;

/**
 * Choose between the digits-only and the free-text reading of a box. Words
 * ("N/A") win when the free reading is clearly words; equal readings are
 * confident; otherwise the well-formed one, flagged as unsure.
 */
export function pickReading(
  digitsOnly: string,
  freeText: string
): { text: string; confidence: number } {
  const words = freeText.replace(/[|[\]]/g, '').trim();
  if (/^n\s*[/\\]?\s*a\.?$/i.test(words)) return { text: 'N/A', confidence: 0.8 };
  const a = digitsOnly.replace(/\s+/g, '').replace(/,/g, '.');
  const b = digitsFromFreeText(freeText).replace(/\s+/g, '');
  if (!a && !b) {
    return /[a-z]{3,}/i.test(words)
      ? { text: words, confidence: 0.3 }
      : { text: '', confidence: 0 };
  }
  if (a && a === b) return { text: restoreDecimal(a), confidence: 0.8 };
  const good = [a, b].filter(t => WELL_FORMED.test(t));
  const quarter = good.filter(t => /\.(?:00|25|5|50|75)$/.test(t) || !t.includes('.'));
  return { text: restoreDecimal(quarter[0] || good[0] || a || b), confidence: 0.4 };
}

/**
 * Handwritten decimal points are faint: "2450" is 24.50 and "425" is 4.25 when
 * the last two digits are a quarter. A trailing "1" after two decimals is the
 * box border. Round hundreds ("200") stay as written.
 */
export function restoreDecimal(text: string): string {
  if (/^\d+\.\d\d1$/.test(text)) return text.slice(0, -1);
  if (/^0{3,4}$/.test(text)) return '0.00';
  const m = /^(\d{1,2})(00|25|50|75)$/.exec(text);
  if (m && !(m[1].length === 1 && m[2] === '00')) return `${m[1]}.${m[2]}`;
  return text;
}

function wordsOf(data: any): any[] {
  if (Array.isArray(data?.words)) return data.words;
  return (data?.blocks || []).flatMap((b: any) =>
    (b.paragraphs || []).flatMap((p: any) => (p.lines || []).flatMap((l: any) => l.words || []))
  );
}

export function createTesseractEngine(
  worker: TesseractWorkerLike,
  options: TesseractEngineOptions = {}
): OcrEngine {
  // One worker, so reads run one at a time and parameters never mix.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const readWords = (image: GrayImage) =>
    serial(async () => {
      const page = downscale(image, PAGE_OCR_WIDTH);
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '11' });
      const { data } = await worker.recognize(encodePgm(page), {}, { blocks: true, text: false });
      return wordsOf(data)
        .filter((w: any) => String(w.text || '').trim())
        .map(
          (w: any): TextLine => ({
            x: w.bbox.x0 / page.width,
            y: w.bbox.y0 / page.height,
            w: (w.bbox.x1 - w.bbox.x0) / page.width,
            h: (w.bbox.y1 - w.bbox.y0) / page.height,
            text: String(w.text).trim(),
            confidence: Math.max(0, Math.min(1, (w.confidence ?? 0) / 100)),
          })
        );
    });

  const readCells = (image: GrayImage, rects: NormRect[]) =>
    serial(async () => {
      const out: CellRead[] = [];
      const crops: Array<GrayImage | null> = rects.map(rect =>
        hasInk(image, rect) ? cropForOcr(image, valueArea(rect), 3) : null
      );
      // Two readings of every box: digits only, and free text with look-alike glyphs mapped
      // to digits (a crossed 7 reads as "+" or "F"). Agreement means a confident reading.
      const digits: string[] = [];
      await worker.setParameters({
        tessedit_char_whitelist: DIGIT_WHITELIST,
        tessedit_pageseg_mode: '8',
      });
      for (const crop of crops) {
        if (!crop) {
          digits.push('');
          continue;
        }
        const { data } = await worker.recognize(encodePgm(crop));
        digits.push(
          String(data?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
        );
      }
      const free: string[] = [];
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' });
      for (const crop of crops) {
        if (!crop) {
          free.push('');
          continue;
        }
        const { data } = await worker.recognize(encodePgm(crop));
        free.push(
          String(data?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
        );
      }
      // A lone digit (a quantity) can defeat line reading: read those as one character.
      const lone = crops
        .map((crop, i) => (crop && !digits[i].trim() && !free[i].trim() ? i : -1))
        .filter(i => i >= 0);
      if (lone.length) {
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: '10',
        });
        for (const i of lone) {
          const { data } = await worker.recognize(encodePgm(crops[i]!));
          digits[i] = String(data?.text || '').trim();
        }
      }
      for (let i = 0; i < rects.length; i += 1) {
        const crop = crops[i];
        if (!crop) {
          out.push({ text: '', confidence: 1 });
          continue;
        }
        const read = pickReading(digits[i], free[i]);
        const thumb = options.thumb ? await options.thumb(crop) : undefined;
        out.push({ ...read, ...(thumb ? { thumb } : {}) });
      }
      return out;
    });

  return { readWords, readCells };
}
