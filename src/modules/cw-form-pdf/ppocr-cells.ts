/**
 * Value boxes read with the PaddleOCR PP-OCRv4 English text recogniser (an
 * ONNX model served from /ocr/ and run by onnxruntime-web in the OCR worker;
 * Apache 2.0, github.com/PaddlePaddle/PaddleOCR). The detection model is not
 * needed: the template says where every box is.
 *
 * Each box is cleaned to its handwriting (cell-image.ts) and read once. A
 * reading below EARLY_ACCEPT is read again from five more framings (other
 * margins, black ink or the scan's grey) and the framings vote.
 */
import type { NormRect } from './pair-letters';
import { CELL_PAD, cleanCell, cropCell, frameInk, scaleToHeight } from './cell-image';
import { classesOf, ctcGreedy, isNotApplicable, parseMeasurement, PPOCR_EN_CHARS } from './ctc';
import { hasInk, type GrayImage } from './scan-image';
import type { CellRead, OcrEngine } from './scan-reader';

/** Input height of the recogniser. */
export const REC_HEIGHT = 48;

/** Model file under the app's public folder. */
export const PPOCR_MODEL_PATH = '/ocr/en_PP-OCRv4_rec_fp16.onnx';

/** A first reading at least this sure is kept without a vote. */
export const EARLY_ACCEPT = 0.9;

/** Runs the recogniser on a [1, 3, 48, width] tensor; returns [steps x classes] probabilities. */
export type Recognise = (
  input: Float32Array,
  width: number
) => Promise<{ probs: Float32Array; steps: number; classes: number }>;

export interface PpocrOptions {
  /** Makes a small picture of a box crop (browser only). */
  thumb?: (crop: GrayImage) => Promise<string | undefined>;
}

const DIGITS = classesOf(PPOCR_EN_CHARS, '0123456789. ');

/** A measurement as customers write it: 1 to 3 digits, maybe a decimal part. */
const WELL_FORMED = /^\d{1,3}(?:\.\d{1,2})?$/;

const FRAMINGS: Array<{ margin: number; style: 'ink' | 'grey' }> = [
  { margin: 0.25, style: 'ink' },
  { margin: 0.15, style: 'ink' },
  { margin: 0.4, style: 'ink' },
  { margin: 0.15, style: 'grey' },
  { margin: 0.25, style: 'grey' },
  { margin: 0.4, style: 'grey' },
];

/** Grey image as the recogniser's input: 48 px tall, three equal channels, -1 (ink) .. 1. */
export function toTensor(img: GrayImage): { data: Float32Array; width: number } {
  const scaled = scaleToHeight(img, REC_HEIGHT);
  const plane = scaled.width * REC_HEIGHT;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    const v = scaled.data[i] / 127.5 - 1;
    data[i] = data[plane + i] = data[plane * 2 + i] = v;
  }
  return { data, width: scaled.width };
}

/** Text and confidence of one framed box. */
export async function readFramed(recognise: Recognise, img: GrayImage): Promise<CellRead> {
  const { data, width } = toTensor(img);
  const { probs, steps, classes } = await recognise(data, width);
  const free = ctcGreedy(probs, steps, classes, PPOCR_EN_CHARS);
  if (isNotApplicable(free.text)) return { text: 'N/A', confidence: free.confidence };
  const digits = ctcGreedy(probs, steps, classes, PPOCR_EN_CHARS, DIGITS);
  const { text, fixed } = parseMeasurement(digits.text);
  if (!text) {
    const words = free.text.trim();
    return /[a-z]{3,}/i.test(words)
      ? { text: words, confidence: 0.3 }
      : { text: '', confidence: 0 };
  }
  let confidence = digits.confidence;
  if (fixed) confidence = Math.min(confidence, 0.5);
  if (!WELL_FORMED.test(text)) confidence = Math.min(confidence, 0.4);
  return { text, confidence };
}

/** Pick the reading most framings agree on (then the surer one); confidence shrinks with dissent. */
export function vote(reads: CellRead[]): CellRead {
  const groups = new Map<string, number[]>();
  for (const r of reads) groups.set(r.text, [...(groups.get(r.text) || []), r.confidence]);
  let best: [string, number[]] | null = null;
  for (const entry of groups) {
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    if (
      !best ||
      entry[1].length > best[1].length ||
      (entry[1].length === best[1].length && sum(entry[1]) > sum(best[1]))
    )
      best = entry;
  }
  if (!best) return { text: '', confidence: 0 };
  const mean = best[1].reduce((a, b) => a + b, 0) / best[1].length;
  return { text: best[0], confidence: (best[1].length / reads.length) * mean };
}

/** One value box (a crop made with cropCell) read through the framings. */
export async function readCellCrop(recognise: Recognise, crop: GrayImage): Promise<CellRead> {
  const cell = cleanCell(crop);
  if (!cell.bounds) return { text: '', confidence: 0 };
  const reads: CellRead[] = [];
  for (const framing of FRAMINGS) {
    const framed = frameInk(crop, cell, framing.margin, framing.style);
    if (!framed) break;
    reads.push(await readFramed(recognise, framed));
    if (reads.length === 1 && reads[0].text && reads[0].confidence >= EARLY_ACCEPT) return reads[0];
  }
  return vote(reads);
}

/** Value boxes read with PP-OCRv4; printed words still come from `words` (Tesseract). */
export function createPpocrEngine(
  recognise: Recognise,
  words: OcrEngine,
  options: PpocrOptions = {}
): OcrEngine {
  return {
    readWords: image => words.readWords(image),
    async readCells(image: GrayImage, rects: NormRect[]): Promise<CellRead[]> {
      const out: CellRead[] = [];
      for (const rect of rects) {
        if (!hasInk(image, rect)) {
          out.push({ text: '', confidence: 1 });
          continue;
        }
        const crop = cropCell(image, rect, CELL_PAD);
        const read = await readCellCrop(recognise, crop);
        const thumb = options.thumb && read.text ? await options.thumb(crop) : undefined;
        out.push({ ...read, ...(thumb ? { thumb } : {}) });
      }
      return out;
    },
  };
}

/** What we use of onnxruntime-web (the worker and Node tests pass the module in). */
export interface OrtLike {
  InferenceSession: {
    create(
      model: string | Uint8Array,
      options?: unknown
    ): Promise<{
      inputNames: readonly string[];
      outputNames: readonly string[];
      run(
        feeds: Record<string, unknown>
      ): Promise<Record<string, { dims: readonly number[]; data: unknown }>>;
    }>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}

/** The recogniser on an onnxruntime-web session (model URL or bytes). */
export async function createOrtRecognise(
  ort: OrtLike,
  model: string | Uint8Array
): Promise<Recognise> {
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const input = session.inputNames[0];
  const output = session.outputNames[0];
  // One run at a time: a session does not take overlapping runs.
  let queue: Promise<unknown> = Promise.resolve();
  return (data, width) => {
    const run = queue.then(async () => {
      const result = await session.run({
        [input]: new ort.Tensor('float32', data, [1, 3, REC_HEIGHT, width]),
      });
      const t = result[output];
      return { probs: t.data as Float32Array, steps: t.dims[1], classes: t.dims[2] };
    });
    queue = run.catch(() => undefined);
    return run;
  };
}
