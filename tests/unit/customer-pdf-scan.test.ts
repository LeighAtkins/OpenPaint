/**
 * Flattened and scanned customer PDFs: one pairing path for page text and OCR.
 *
 * The OCR fixtures (tests/fixtures/ocr/alana-page-N.txt) are Apple Vision lines
 * for a real scanned return, used as the accuracy target for the pairing. The
 * flattened copy of the same forms is a customer file and stays out of the
 * repository (tests/fixtures/private, gitignored); its test skips without it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  alignToTemplate,
  pairLettersAndValues,
  parseVisionLines,
  type PairedValue,
  type TextLine,
} from '../../src/modules/cw-form-pdf/pair-letters';
import {
  identifyScannedPage,
  readScannedValues,
  type OcrEngine,
} from '../../src/modules/cw-form-pdf/scan-reader';
import {
  OCR_REVIEW,
  readCustomerPdfDocument,
  detectFlattenedUnit,
} from '../../src/modules/cw-form-pdf/read-customer-pdf';
import { extractCwPageData, type CwPageData } from '../../src/modules/cw-form-pdf/parse-cw-form';
import { fingerprintPage } from '../../src/modules/cw-form-pdf/pdf-fingerprint';
import { matchPdfDocument } from '../../src/modules/cw-form-pdf/pdf-template-match';
import {
  createTesseractEngine,
  pickReading,
  restoreDecimal,
  digitsFromFreeText,
} from '../../src/modules/cw-form-pdf/tesseract-engine';
import { readUnitTick, type GrayImage } from '../../src/modules/cw-form-pdf/scan-image';
import type { TemplateGeometryIndex } from '../../src/modules/cw-form-pdf/template-geometry';
import { PDF_TEMPLATES } from '../../src/modules/ui/pdf-template-registry';
import {
  autoMapping,
  classifyDropResult,
  customerPdfToGroups,
  cwGroupsToDropValues,
  modelGroups,
  formModels,
} from '../../src/modules/ui/noms-link-core';

const GEOMETRY: TemplateGeometryIndex = JSON.parse(
  readFileSync(resolve(__dirname, '../../src/data/pdf-template-geometry.json'), 'utf8')
);
const OCR_DIR = resolve(__dirname, '../fixtures/ocr');
const LIBRARY = resolve(__dirname, '../fixtures/pdf-library');
const TYPED = resolve(__dirname, '../fixtures/private/alana-typed.pdf');

/** What the customer wrote, read by eye from the scan (pages 1 to 6). */
const FRAME_PAGES: Record<number, Record<string, string>> = {
  1: {
    A1: '75.25',
    A2: '72.25',
    A3: '17.00',
    B1: '29.00',
    B2: '33.50',
    C1: '3.25',
    C2: '10.25',
    D1: '75.25',
    M1: '39.00',
    M2: '10.50',
  },
  2: {
    E1: '14.25',
    F1: '5.50',
    F2: '0.00',
    F3: 'N/A',
    F4: '0.00',
    G1: '39.25',
    G2: '39.00',
    H1: '24.75',
    H2: '24.50',
    H3: '1.50',
    J1: '24.50',
    L1: '71.25',
    L2: '75.00',
    L3: '75.00',
  },
  4: {
    A1: '31.75',
    A2: '31.25',
    A3: '15.00',
    B1: '28.50',
    B2: '33.75',
    C1: '3.25',
    C3: '10.50',
    D1: '31.00',
    E1: '14.25',
    F1: '5.50',
    F2: '0.00',
    F3: 'N/A',
    F4: '0.00',
    G1: '39.00',
    G2: '39.00',
    H1: '24.50',
    H2: '24.50',
    H3: '1.50',
  },
  5: { J1: '24.50', L1: '31.75', L2: '34.75', L3: '34.50', M1: '54.25', M2: '25.50', M3: '65.00' },
};
const CUSHION_PAGES: Record<number, Record<string, Record<string, string>>> = {
  3: {
    'Box seat cushions, type 1': { Qty: '1', A: '69.25', B: '69.25', C: '29.00', D: '4.25' },
    'Box back cushions, type 1': { Qty: '2', A: '34.00', B: '35.00', C: '17.50', D: '3.00' },
  },
  6: { 'Box back cushions, type 1': { Qty: '1', A: '30.00', B: '30.00', C: '17.25' } },
};
/** Where Apple Vision itself misread the handwriting (not a pairing fault). */
const VISION_MISREADS: Record<string, string> = {
  '3|Box seat cushions, type 1|Qty': '', // a single thin stroke, not read
  '3|Box seat cushions, type 1|C': '299.00*', // 28 over-written as 29
  '4|A2': '31.00025', // 31.?25 corrected by hand
  '5|M3': '05.00',
};

const number = (text: string) => (/^n\/a$/i.test(text) ? null : parseFloat(text));
const sameValue = (v: PairedValue | undefined, text: string) =>
  number(text) === null
    ? Boolean(v) && /n\/a/i.test(v!.text) && v!.value === null
    : Boolean(v?.value) && Math.abs(v!.value!.values[0] - number(text)!) < 0.001;

function visionPage(n: number): TextLine[] {
  return parseVisionLines(readFileSync(join(OCR_DIR, `alana-page-${n}.txt`), 'utf8'));
}

function pairVision(n: number) {
  const lines = visionPage(n);
  const [best] = identifyScannedPage(lines, GEOMETRY);
  return {
    best,
    values: best
      ? pairLettersAndValues(lines, {
          geometry: GEOMETRY.shapes[best.key],
          transform: best.alignment,
        })
      : pairLettersAndValues(lines),
  };
}

describe('pairing letters and values on OCR lines (Apple Vision fixtures)', () => {
  it('identifies the printed form of every scanned page and lines it up', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const { best } = pairVision(n);
      expect(best, `page ${n}`).toBeTruthy();
      expect(best.alignment.score).toBeGreaterThan(0.5);
      // The scan is close to the page size: scale near 1.
      expect(Math.abs(best.alignment.sx - 1)).toBeLessThan(0.05);
      expect(Math.abs(best.alignment.sy - 1)).toBeLessThan(0.05);
    }
  });

  it('reads every frame value beside its letter', () => {
    for (const [n, expected] of Object.entries(FRAME_PAGES)) {
      const { values } = pairVision(Number(n));
      for (const [label, text] of Object.entries(expected)) {
        const got = values.find(v => v.label === label && !v.section);
        const misread = VISION_MISREADS[`${n}|${label}`];
        if (misread !== undefined) {
          expect(got?.text, `page ${n} ${label}`).toBe(misread);
          continue;
        }
        expect(sameValue(got, text), `page ${n} ${label}: ${got?.text} vs ${text}`).toBe(true);
      }
      // Nothing beyond the letters on the form.
      expect(values.filter(v => !expected[v.label]).map(v => v.label)).toEqual([]);
    }
  });

  it('reads cushion tables by shape, seat or back, type and quantity', () => {
    for (const [n, sections] of Object.entries(CUSHION_PAGES)) {
      const { values } = pairVision(Number(n));
      const real = values.filter(v => !v.stray);
      for (const [section, expected] of Object.entries(sections)) {
        for (const [label, text] of Object.entries(expected)) {
          const got = real.find(v => v.section === section && v.label === label);
          const misread = VISION_MISREADS[`${n}|${section}|${label}`];
          if (misread !== undefined) {
            expect(got?.text ?? '', `page ${n} ${section} ${label}`).toBe(misread);
            continue;
          }
          expect(sameValue(got, text), `page ${n} ${section} ${label}: ${got?.text}`).toBe(true);
        }
      }
      // Sketch labels drawn across an empty table are not values.
      expect(
        real.filter(v => !sections[v.section || '']).map(v => `${v.section} ${v.label}`)
      ).toEqual([]);
      expect(values.some(v => v.stray)).toBe(true);
    }
  });

  it('flags corrections, notes and values written under a crossed-out box', () => {
    const page4 = pairVision(4).values;
    expect(page4.find(v => v.label === 'A2')!.review.join(' ')).toMatch(/corrected by hand/);
    const b2 = page4.find(v => v.label === 'B2')!;
    expect(b2.text).toBe('33.75');
    expect(b2.review[0]).toMatch(/below the box/);
    const page5 = pairVision(5).values;
    expect(page5.find(v => v.label === 'M1')).toMatchObject({ text: '54.25' });
    const seatC = pairVision(3).values.find(
      v => v.section === 'Box seat cushions, type 1' && v.label === 'C'
    )!;
    expect(seatC.review.join(' ')).toMatch(/Marked with \*/);
  });

  it('reads "0.00" as zero and "N/A" as words', () => {
    const page2 = pairVision(2).values;
    expect(page2.find(v => v.label === 'F2')!.value!.values).toEqual([0]);
    expect(page2.find(v => v.label === 'F3')).toMatchObject({ text: 'N/A', value: null });
  });

  it('falls back to the nearest number right of a letter when no template fits', () => {
    const { best, values } = pairVision(7);
    expect(best).toBeUndefined();
    expect(values.find(v => v.label === 'B')!.value!.values).toEqual([30.5]);
  });
});

describe('flattened PDF (text layer, no form fields)', () => {
  const present = existsSync(TYPED);
  let read: Awaited<ReturnType<typeof readCustomerPdfDocument>>;
  beforeAll(async () => {
    if (!present) return;
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(TYPED)),
      verbosity: 0,
    }).promise;
    read = await readCustomerPdfDocument(doc, pdfjs.OPS, 'returned.pdf', PDF_TEMPLATES, {
      geometry: GEOMETRY,
    });
  });

  it.skipIf(!present)('identifies both forms in the joined PDF at 0.8 or more', () => {
    expect(read.pages.map(p => p.template?.source)).toEqual([
      'Sectionals/CS3-SSA-HB-R.pdf',
      'Sectionals/CS3-SSA-HB-R.pdf',
      'Sectionals/CS3-SSA-HB-R.pdf',
      'Sectionals/CS5B-SA2-HB-L.pdf',
      'Sectionals/CS5B-SA2-HB-L.pdf',
      'Sectionals/CS5B-SA2-HB-L.pdf',
    ]);
    for (const page of read.pages) expect(page.confidence).toBeGreaterThanOrEqual(0.8);
    expect(read.modelCodes).toEqual(['CS3-SSA-HB-R', 'CS5B-SA2-HB-L']);
  });

  it.skipIf(!present)('reads every value and the drawn INCH dot', () => {
    const typedFrame: Record<number, Record<string, string>> = {
      1: FRAME_PAGES[1],
      2: FRAME_PAGES[2],
      4: FRAME_PAGES[4],
      5: FRAME_PAGES[5],
    };
    for (const page of read.pages) {
      expect(page.read).toBe('text');
      expect(page).toMatchObject({ unit: 'inch', unitAssumed: false });
      const frame = typedFrame[page.pageNumber];
      if (frame) {
        expect(page.unitSource).toBe('ticked');
        expect(page.values.map(v => v.label).sort()).toEqual(Object.keys(frame).sort());
        for (const [label, text] of Object.entries(frame)) {
          const v = page.values.find(x => x.label === label)!;
          if (text === 'N/A') expect(v).toMatchObject({ text: 'N/A', value: null });
          else
            expect(v.value!.values[0], `page ${page.pageNumber} ${label}`).toBeCloseTo(
              parseFloat(text),
              3
            );
          expect(v.from).toBe('text');
        }
        continue;
      }
      for (const [section, expected] of Object.entries(CUSHION_PAGES[page.pageNumber])) {
        for (const [label, text] of Object.entries(expected)) {
          const v = page.values.find(x => x.section === section && x.label === label);
          expect(v?.value?.values[0], `page ${page.pageNumber} ${section} ${label}`).toBeCloseTo(
            parseFloat(text),
            3
          );
        }
      }
      expect(page.values.every(v => CUSHION_PAGES[page.pageNumber][v.section || ''])).toBe(true);
    }
  });

  it.skipIf(!present)('makes one drop group per cushion table, with its quantity', () => {
    const groups = customerPdfToGroups(read as any);
    const cushions = groups.filter(g => g.pageNumber === 3);
    expect(cushions.map(g => g.title)).toEqual([
      'Box seat cushions, type 1 (qty 1)',
      'Box back cushions, type 1 (qty 2)',
    ]);
    expect(cushions[1].values.map(v => v.label)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('document split into runs of pages from different forms', () => {
  let pdfjs: any;
  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  });
  async function fingerprints(rel: string) {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(join(LIBRARY, rel))),
      verbosity: 0,
    }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n += 1)
      out.push(
        fingerprintPage(await extractCwPageData(await doc.getPage(n), pdfjs.OPS), {
          fileName: 'x.pdf',
        })
      );
    return out;
  }

  it('keeps a single library form in one run', async () => {
    const fps = await fingerprints('Sectionals/CS5L-WA-HB-L.pdf');
    const match = matchPdfDocument(fps, PDF_TEMPLATES);
    expect(match.segments).toHaveLength(1);
    expect(match.source).toBe('Sectionals/CS5L-WA-HB-L.pdf');
  });

  it('splits two forms joined into one PDF and identifies each', async () => {
    const a = await fingerprints('Sectionals/CS3-SSA2-HB-R.pdf');
    const b = await fingerprints('Sectionals/CS5B-SA-HB-R.pdf');
    const match = matchPdfDocument([...a, ...b], PDF_TEMPLATES);
    expect(match.segments!.map(s => [s.source, s.first, s.last])).toEqual([
      ['Sectionals/CS3-SSA2-HB-R.pdf', 0, a.length - 1],
      ['Sectionals/CS5B-SA-HB-R.pdf', a.length, a.length + b.length - 1],
    ]);
    expect(match.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe('flattened unit dot', () => {
  const page = (fills: CwPageData['fills']): CwPageData => ({
    pageNumber: 1,
    width: 612,
    height: 792,
    fields: [],
    widgets: [],
    strokes: [],
    texts: [
      { str: 'Please select unit : CM', rect: { x0: 221, y0: 622, x1: 329, y1: 633 } },
      { str: 'INCH', rect: { x0: 348, y0: 621, x1: 373, y1: 633 } },
    ],
    fills,
  });
  it('reads the dark dot right of its caption', () => {
    expect(
      detectFlattenedUnit(
        page([{ bbox: { x0: 381, y0: 626, x1: 387, y1: 632 }, color: '#000000' }])
      )
    ).toBe('inch');
    expect(
      detectFlattenedUnit(
        page([{ bbox: { x0: 335, y0: 626, x1: 341, y1: 632 }, color: '#000000' }])
      )
    ).toBe('cm');
    expect(
      detectFlattenedUnit(
        page([{ bbox: { x0: 381, y0: 626, x1: 387, y1: 632 }, color: '#ffffff' }])
      )
    ).toBeNull();
    expect(detectFlattenedUnit(page([]))).toBeNull();
  });
});

describe('OCR readings', () => {
  it('maps look-alike glyphs and restores faint decimal points', () => {
    expect(digitsFromFreeText('+5.25')).toBe('75.25');
    expect(digitsFromFreeText('Fl.25')).toBe('71.25');
    expect(restoreDecimal('2450')).toBe('24.50');
    expect(restoreDecimal('425')).toBe('4.25');
    expect(restoreDecimal('000')).toBe('0.00');
    expect(restoreDecimal('200')).toBe('200');
    expect(restoreDecimal('10.251')).toBe('10.25');
  });

  it('prefers agreement, then a well-formed number, and keeps N/A as words', () => {
    expect(pickReading('75.25', '+5.25')).toEqual({ text: '75.25', confidence: 0.8 });
    expect(pickReading('45.25', '+5.25').confidence).toBe(0.4);
    expect(pickReading('/', 'N/A')).toEqual({ text: 'N/A', confidence: 0.8 });
    expect(pickReading('', '')).toEqual({ text: '', confidence: 0 });
  });

  it('reads the ticked circle by ink inside it', () => {
    const W = 200;
    const H = 60;
    const img: GrayImage = { width: W, height: H, data: new Uint8Array(W * H).fill(235) };
    const dot = (cx: number, cy: number, r: number, fill: boolean) => {
      for (let y = 0; y < H; y += 1)
        for (let x = 0; x < W; x += 1) {
          const d = Math.hypot(x - cx, y - cy);
          if ((fill && d < r * 0.6) || Math.abs(d - r) < 1.2) img.data[y * W + x] = 40;
        }
    };
    dot(50, 30, 12, false);
    dot(150, 30, 12, true);
    const circles = [
      { unit: 'cm' as const, rect: { x: 38 / W, y: 18 / H, w: 24 / W, h: 24 / H } },
      { unit: 'inch' as const, rect: { x: 140 / W, y: 18 / H, w: 24 / W, h: 24 / H } },
    ];
    expect(readUnitTick(img, circles)).toBe('inch');
  });

  it('runs the Tesseract engine on page words and boxes (worker mocked)', async () => {
    const calls: Array<Record<string, string>> = [];
    const worker = {
      params: {} as Record<string, string>,
      async setParameters(p: Record<string, string>) {
        this.params = { ...this.params, ...p };
        calls.push(p);
      },
      async recognize(_image: Uint8Array) {
        if (this.params.tessedit_pageseg_mode === '11')
          return {
            data: {
              blocks: [
                {
                  paragraphs: [
                    {
                      lines: [
                        {
                          words: [
                            {
                              text: 'INCH',
                              confidence: 90,
                              bbox: { x0: 100, y0: 50, x1: 150, y1: 60 },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          };
        return {
          data: { text: this.params.tessedit_char_whitelist ? '24.50' : '24.50', confidence: 80 },
        };
      },
    };
    const engine: OcrEngine = createTesseractEngine(worker);
    const page: GrayImage = { width: 400, height: 200, data: new Uint8Array(400 * 200).fill(240) };
    const words = await engine.readWords(page);
    expect(words).toEqual([{ x: 0.25, y: 0.25, w: 0.125, h: 0.05, text: 'INCH', confidence: 0.9 }]);
    // Ink in the second box only: the empty box is never sent to Tesseract.
    for (let y = 120; y < 140; y += 1)
      for (let x = 220; x < 300; x += 1) if (x % 7 < 2) page.data[y * 400 + x] = 20;
    const cells = await engine.readCells(page, [
      { x: 0.05, y: 0.55, w: 0.3, h: 0.2 },
      { x: 0.5, y: 0.55, w: 0.3, h: 0.2 },
    ]);
    expect(cells).toEqual([
      { text: '', confidence: 1 },
      { text: '24.50', confidence: 0.8 },
    ]);
    expect(calls.some(c => c.tessedit_char_whitelist?.startsWith('0123456789'))).toBe(true);
  });

  it('reads values from boxes on an aligned scan and tags none as stray when the table has a quantity', async () => {
    const lines = visionPage(6);
    const [best] = identifyScannedPage(lines, GEOMETRY);
    const geo = GEOMETRY.shapes[best.key];
    const page: GrayImage = { width: 100, height: 130, data: new Uint8Array(100 * 130).fill(250) };
    // An engine that "reads" each box from the Vision lines inside it.
    const engine: OcrEngine = {
      readWords: async () => lines,
      readCells: async (_img, rects) =>
        rects.map(r => {
          const hit = lines.find(l => {
            const cx = l.x + l.w / 2;
            const cy = l.y + l.h / 2;
            return cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h;
          });
          return {
            text: hit?.text || '',
            confidence: 0.8,
            thumb: hit ? 'data:image/png;base64,AA' : undefined,
          };
        }),
    };
    const { values } = await readScannedValues(page, engine, geo, best.alignment);
    const back = values.filter(v => v.section === 'Box back cushions, type 1');
    expect(back.map(v => `${v.label}=${v.text}`)).toEqual([
      'Qty=1',
      'A=30.00',
      'B=30.00',
      'C=17.25',
    ]);
    expect(back.every(v => v.thumb)).toBe(true);
  });
});

describe('OCR values in the NOMS drop review', () => {
  it('flags every OCR value with its box picture', () => {
    const form = {
      unit: 'in',
      products: [
        {
          reference: 'CS3-SSA-R',
          model_list: [
            {
              name: 'CS3-SSA-HB-R',
              label: 'Sofa Frame',
              files: [{ field_data: { A1: '', A2: '' } }],
            },
          ],
        },
      ],
    };
    const entries = formModels(form);
    const models = modelGroups(entries);
    const parsed = (n: number) => ({
      kind: 'single' as const,
      values: [n],
      unit: null,
      note: '',
      text: String(n),
    });
    const groups = customerPdfToGroups({
      fileName: 'scan.pdf',
      modelCodes: [],
      confidence: 0,
      pages: [
        {
          pageNumber: 1,
          template: null,
          confidence: 0,
          unit: 'inch',
          unitAssumed: false,
          values: [
            {
              label: 'A1',
              value: parsed(75.25),
              text: '75.25',
              from: 'ocr',
              review: [OCR_REVIEW],
              thumb: 'data:image/png;base64,AA',
            },
            {
              label: 'A2',
              value: parsed(31.25),
              text: '31.25',
              from: 'ocr',
              review: [OCR_REVIEW, 'Looks corrected by hand, check the number'],
            },
          ],
        },
      ],
    });
    const drop = cwGroupsToDropValues(
      groups,
      [[models[0].key]],
      [autoMapping(['A1', 'A2'], [models[0]])],
      models
    );
    const review = classifyDropResult(drop, entries, 'in');
    const a1 = Object.values(review.rows).find(r => r.field === 'A1')!;
    expect(a1.flags).toEqual([
      {
        kind: 'ocr',
        reason: 'Read by OCR, check it: read "75.25"',
        thumb: 'data:image/png;base64,AA',
      },
    ]);
    const a2 = Object.values(review.rows).find(r => r.field === 'A2')!;
    expect(a2.flags.map(f => f.kind)).toEqual(['ocr', 'check']);
    expect(review.filled).toBe(2);
  });
});

describe('alignment', () => {
  it('finds scale and offset of a shifted page', () => {
    const geo = GEOMETRY.shapes[GEOMETRY.byTemplate['sectionals-cs3-ssa-hb-r-p1']];
    const lines: TextLine[] = geo.anchors.map(a => ({
      x: (a.rect[0] / geo.width) * 0.9 + 0.04,
      y: (a.rect[1] / geo.height) * 0.92 + 0.03,
      w: (a.rect[2] / geo.width) * 0.9,
      h: (a.rect[3] / geo.height) * 0.92,
      text: a.text,
      confidence: 1,
    }));
    const fit = alignToTemplate(lines, geo)!;
    expect(fit.sx).toBeCloseTo(0.9, 3);
    expect(fit.sy).toBeCloseTo(0.92, 3);
    expect(fit.tx).toBeCloseTo(0.04, 3);
    expect(fit.ty).toBeCloseTo(0.03, 3);
  });
});
