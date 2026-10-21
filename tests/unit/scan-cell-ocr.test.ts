// @vitest-environment node
/**
 * Synthetic checks of the value-box recogniser plumbing: CTC decoding, the
 * measurement parser, connected components and cleaning a box down to its
 * handwriting, and the framing vote.
 */
import { describe, it, expect } from 'vitest';
import {
  cleanCell,
  components,
  cropCell,
  findBorders,
  frameInk,
  scaleToHeight,
} from '../../src/modules/cw-form-pdf/cell-image';
import {
  classesOf,
  ctcGreedy,
  isNotApplicable,
  parseMeasurement,
  PPOCR_EN_CHARS,
} from '../../src/modules/cw-form-pdf/ctc';
import {
  readCellCrop,
  readFramed,
  REC_HEIGHT,
  toTensor,
  vote,
  type Recognise,
} from '../../src/modules/cw-form-pdf/ppocr-cells';
import type { GrayImage } from '../../src/modules/cw-form-pdf/scan-image';

const C = PPOCR_EN_CHARS.length;
const idx = (ch: string) => PPOCR_EN_CHARS.indexOf(ch);

/** Probabilities for a CTC path: each step puts `p` on its class, the rest spread evenly. */
function path(steps: Array<string | null>, p = 0.9): Float32Array {
  const out = new Float32Array(steps.length * C).fill((1 - p) / (C - 1));
  steps.forEach((ch, t) => {
    out[t * C + (ch === null ? 0 : idx(ch))] = p;
  });
  return out;
}

describe('CTC decoding', () => {
  it('has the 97 PP-OCRv4 English classes', () => {
    expect(C).toBe(97);
    expect(PPOCR_EN_CHARS[1]).toBe('0');
    expect(PPOCR_EN_CHARS[idx('.')]).toBe('.');
  });

  it('merges repeats, drops blanks and keeps doubled letters split by a blank', () => {
    const probs = path(['7', '7', null, '5', '.', '.', '2', null, '2', '5', null]);
    expect(ctcGreedy(probs, 11, C, PPOCR_EN_CHARS)).toEqual({
      text: '75.225',
      confidence: expect.closeTo(0.9, 5),
    });
  });

  it('reports the least sure character as the confidence', () => {
    const probs = path(['3', null, '9']);
    probs[2 * C + idx('9')] = 0.55;
    expect(ctcGreedy(probs, 3, C, PPOCR_EN_CHARS).confidence).toBeCloseTo(0.55, 5);
  });

  it('only lets allowed classes compete when restricted', () => {
    const probs = path(['I', null, '0']);
    probs[idx('1')] = 0.08;
    const free = ctcGreedy(probs, 3, C, PPOCR_EN_CHARS);
    const digits = ctcGreedy(probs, 3, C, PPOCR_EN_CHARS, classesOf(PPOCR_EN_CHARS, '0123456789.'));
    expect(free.text).toBe('I0');
    expect(digits.text).toBe('10');
  });

  it('reads nothing from all blanks', () => {
    expect(ctcGreedy(path([null, null]), 2, C, PPOCR_EN_CHARS)).toEqual({
      text: '',
      confidence: 0,
    });
  });
});

describe('measurement text', () => {
  it.each([
    ['75.25', '75.25', false],
    ['39 00', '39.00', false],
    ['.30.00.', '30.00', false],
    ['2450', '24.50', false],
    ['425', '4.25', false],
    ['200', '200', false],
    ['17.507', '17.50', true],
    ['3.1.25', '31.25', true],
    ['5,50', '5.50', false],
    ['1', '1', false],
  ])('%s reads as %s', (raw, text, fixed) => {
    expect(parseMeasurement(raw)).toEqual({ text, fixed });
  });

  it('knows N/A however it is written', () => {
    for (const t of ['N/A', 'n/a', 'NA', 'N|A', ' N / A ']) expect(isNotApplicable(t)).toBe(true);
    for (const t of ['NAN', '4.25', 'N/AB']) expect(isNotApplicable(t)).toBe(false);
  });
});

/** White page with a printed box (1 px border) and some dark blobs inside. */
function boxImage(blobs: Array<[number, number, number, number]>): GrayImage {
  const width = 240;
  const height = 100;
  const data = new Uint8Array(width * height).fill(235);
  const fill = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y += 1)
      for (let x = x0; x < x0 + w; x += 1) data[y * width + x] = v;
  };
  // Box border at x 20..220, y 15..85.
  fill(20, 15, 201, 2, 90);
  fill(20, 84, 201, 2, 90);
  fill(20, 15, 2, 71, 90);
  fill(219, 15, 2, 71, 90);
  for (const [x, y, w, h] of blobs) fill(x, y, w, h, 20);
  return { width, height, data };
}

describe('cleaning a value box', () => {
  it('labels 8-connected components with their boxes', () => {
    const mask = new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1]);
    const { parts, labels } = components(mask, 4, 3);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ x: 0, y: 0, w: 1, h: 2, area: 2 });
    expect(parts[1]).toEqual({ x: 2, y: 2, w: 2, h: 1, area: 2 });
    expect(labels[0]).toBe(1);
    expect(labels[10]).toBe(2);
  });

  it('finds the printed border and keeps only what is written inside', () => {
    const page = boxImage([
      [50, 30, 10, 40], // a "1"
      [80, 30, 30, 40], // a digit
      [120, 62, 6, 6], // the point
    ]);
    // The box as a normalised rect of the page; cropCell adds the border margin.
    const rect = { x: 20 / 240, y: 15 / 100, w: 201 / 240, h: 71 / 100 };
    const crop = cropCell(page, rect, 0.12);
    const ink = new Uint8Array(crop.width * crop.height);
    for (let i = 0; i < ink.length; i += 1) ink[i] = crop.data[i] < 128 ? 1 : 0;
    const borders = findBorders(ink, crop.width, crop.height, 0.12);
    expect(borders.left).not.toBeNull();
    expect(borders.right).not.toBeNull();
    expect(borders.top).not.toBeNull();
    expect(borders.bottom).not.toBeNull();
    const cell = cleanCell(crop, 0.12);
    const b = cell.bounds!;
    expect(b).not.toBeNull();
    // From the left of the "1" to the right of the point, top of the digits to their foot.
    const x0 = Math.max(0, Math.floor((rect.x - 0.12 * rect.w) * 240));
    const y0 = Math.max(0, Math.floor((rect.y - 0.12 * rect.h) * 100));
    expect(b.x + x0).toBeCloseTo(50, -1);
    expect(b.x + b.w + x0).toBeCloseTo(126, -1);
    expect(b.y + y0).toBeCloseTo(30, -1);
    expect(b.y + b.h + y0).toBeCloseTo(70, -1);
    const framed = frameInk(crop, cell, 0.25, 'ink')!;
    expect(framed.height).toBe(b.h + 2 * (Math.floor(b.h * 0.25) + 2));
    expect(Math.min(...framed.data)).toBe(0);
    expect(framed.data[0]).toBe(255);
  });

  it('finds nothing in an empty box', () => {
    const page = boxImage([]);
    const crop = cropCell(page, { x: 20 / 240, y: 15 / 100, w: 201 / 240, h: 71 / 100 });
    expect(cleanCell(crop).bounds).toBeNull();
  });

  it('scales to the recogniser height and fills three channels from -1 to 1', () => {
    const img: GrayImage = { width: 20, height: 10, data: new Uint8Array(200).fill(255) };
    img.data[0] = 0;
    expect(scaleToHeight(img, REC_HEIGHT).width).toBe(96);
    const { data, width } = toTensor(img);
    expect(width).toBe(96);
    expect(data.length).toBe(3 * REC_HEIGHT * 96);
    expect(data[0]).toBe(-1);
    expect(data[REC_HEIGHT * 96]).toBe(-1);
    expect(data[REC_HEIGHT * 96 - 1]).toBe(1);
  });
});

describe('reading a framed box', () => {
  const fake =
    (steps: Array<string | null>, p = 0.95): Recognise =>
    async () => ({ probs: path(steps, p), steps: steps.length, classes: C });
  const blank: GrayImage = { width: 40, height: 20, data: new Uint8Array(800).fill(255) };

  it('reads digits and N/A', async () => {
    expect(await readFramed(fake(['3', '9', ' ', '0', null, '0']), blank)).toEqual({
      text: '39.00',
      confidence: expect.closeTo(0.95, 5),
    });
    expect((await readFramed(fake(['N', '/', 'A']), blank)).text).toBe('N/A');
  });

  it('lowers the confidence of a reading that needed repair', async () => {
    const read = await readFramed(fake(['1', '7', '.', '5', '0', '7']), blank);
    expect(read.text).toBe('17.50');
    expect(read.confidence).toBeLessThanOrEqual(0.5);
  });

  it('votes for the reading most framings agree on', () => {
    expect(
      vote([
        { text: '39.00', confidence: 0.7 },
        { text: '31.00', confidence: 0.75 },
        { text: '39.00', confidence: 0.6 },
      ])
    ).toEqual({ text: '39.00', confidence: expect.closeTo((2 / 3) * 0.65, 5) });
  });

  it('keeps a sure first reading and votes on an unsure one', async () => {
    const page = boxImage([[80, 30, 30, 40]]);
    const crop = cropCell(page, { x: 20 / 240, y: 15 / 100, w: 201 / 240, h: 71 / 100 });
    let calls = 0;
    const sure: Recognise = async (input, width) => {
      calls += 1;
      return fake(['8'])(input, width);
    };
    expect((await readCellCrop(sure, crop)).text).toBe('8');
    expect(calls).toBe(1);
    calls = 0;
    const unsure: Recognise = async (input, width) => {
      calls += 1;
      return fake(['8'], 0.5)(input, width);
    };
    const read = await readCellCrop(unsure, crop);
    expect(calls).toBe(6);
    expect(read.text).toBe('8');
    expect(read.confidence).toBeCloseTo(0.5, 5);
  });
});
