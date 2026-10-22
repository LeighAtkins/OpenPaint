// Live-test fixes: form runs matched to NOMS models by code, review flags and
// thumbnails kept through a save, value counts that add up, and recheck ticks
// kept in the order metadata.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCustomerPdfDocument } from '../../src/modules/cw-form-pdf/read-customer-pdf';
import {
  attachCushionPages,
  type PdfTemplate,
} from '../../src/modules/cw-form-pdf/pdf-template-match';
import { PDF_TEMPLATES } from '../../src/modules/ui/pdf-template-registry';
import { parseCustomerValue } from '../../src/modules/utils/customer-value';
import {
  autoMapping,
  classifyDropResult,
  codeSimilarity,
  customerPdfToGroups,
  cwGroupsToDropValues,
  dropCounts,
  dropCountsText,
  formModels,
  isCleanNumber,
  mappingNeedsReview,
  matchPdfRuns,
  modelGroups,
  pagesText,
  type CustomerPdfLike,
  type DropValue,
  type MeasuredLine,
  type NomsFormContent,
  type PdfGroupLike,
} from '../../src/modules/ui/noms-link-core';
import {
  newRecheck,
  recheckLines,
  resolveItem,
  type Recheck,
} from '../../src/modules/ui/noms-recheck-core';
import { normalizeNomsOrders, NOMS_THUMB_MAX } from '../../src/modules/sofa-metadata.js';

const ALANA_PDF = resolve(__dirname, '../fixtures/private/alana-typed.pdf');
const haveAlana = existsSync(ALANA_PDF);

const fields = (letters: string): Record<string, string> =>
  Object.fromEntries(letters.split(' ').map(l => [l, '']));

// NOMS #125927: a left-arm chaise (frame and cushions) and a right-arm loveseat (frame).
const alanaForm: NomsFormContent = {
  unit: 'in',
  products: [
    {
      reference: 'CS5L-SSA-L',
      model_list: [
        {
          name: 'CS5L-SSA-L',
          label: 'Sofa Frame',
          files: [
            { name: 'Front_CS5L', field_data: fields('A1 A2 A3 B1 B2 C1 C2 D') },
            { name: 'Side_CS5L', field_data: fields('F1 F2 F3 F4 G1 G2 H1 H3 M1 M2 M3') },
            { name: 'Back_CS5L', field_data: fields('J1 L1 L2') },
          ],
        },
        { name: 'CC-ST-BE', label: 'Seat Cushion', files: [{ field_data: fields('A B C D') }] },
        { name: 'CC-BK-BE', label: 'Back Cushion', files: [{ field_data: fields('A B C D') }] },
      ],
    },
    {
      reference: 'CS2B-SSA-R',
      model_list: [
        {
          name: 'CS2B-SSA-R',
          label: 'Sofa Frame',
          files: [
            { name: 'Front_CS2B', field_data: fields('A1 A2 A3 B1 B2 C1 C2 D') },
            { name: 'Side_CS2B', field_data: fields('E1 F1 F2 F3 F4 G1 G2 H1 H2 H3 M1 M2') },
            { name: 'Back_CS2B', field_data: fields('J1 L1 L2 L3') },
          ],
        },
      ],
    },
  ],
};
const alanaEntries = formModels(alanaForm);
const alanaModels = modelGroups(alanaEntries);
const alanaTitles = Object.fromEntries(alanaModels.map(m => [m.key, m.title]));

const page = (
  file: string,
  pageNumber: number,
  run: string,
  runTitle: string,
  title: string,
  labels: string,
  view = 'frame'
): PdfGroupLike => ({
  file,
  pageNumber,
  run,
  runTitle,
  modelCodes: [runTitle],
  title,
  view,
  labels: labels.split(' '),
});

// The pages as the reader identifies them: CS3-SSA-HB-R (pages 1 to 3), CS5B-SA2-HB-L (4 to 6).
const alanaPages: PdfGroupLike[] = [
  page('typed.pdf', 1, 'r1', 'CS3-SSA-HB-R', 'SOFA FRAME', 'A1 A2 A3 B1 B2 C1 C2 D1 M1 M2'),
  page(
    'typed.pdf',
    2,
    'r1',
    'CS3-SSA-HB-R',
    'SOFA FRAME',
    'E1 F1 F2 F3 F4 G1 G2 H1 H2 H3 J1 L1 L2 L3'
  ),
  page('typed.pdf', 3, 'r1', 'CS3-SSA-HB-R', 'Box seat cushions, type 1', 'A B C D', 'cushion'),
  page('typed.pdf', 3, 'r1', 'CS3-SSA-HB-R', 'Box back cushions, type 1', 'A B C D', 'cushion'),
  page(
    'typed.pdf',
    4,
    'r2',
    'CS5B-SA2-HB-L',
    'SOFA FRAME',
    'A1 A2 A3 B1 B2 C1 C3 D1 E1 F1 F2 F3 F4 G1 G2 H1 H2 H3'
  ),
  page('typed.pdf', 5, 'r2', 'CS5B-SA2-HB-L', 'SOFA FRAME', 'J1 L1 L2 L3 M1 M2 M3'),
  page('typed.pdf', 6, 'r2', 'CS5B-SA2-HB-L', 'Box back cushions, type 1', 'A B C', 'cushion'),
];

describe('model code similarity', () => {
  it('weighs family digits, side and arm/back tokens', () => {
    // Loveseat form on the loveseat: same side and arm beat the chaise.
    expect(codeSimilarity('CS3-SSA-HB-R', 'CS2B-SSA-R')).toBeGreaterThan(
      codeSimilarity('CS3-SSA-HB-R', 'CS5L-SSA-L') + 2
    );
    // Chaise form on the chaise: same family digits and side.
    expect(codeSimilarity('CS5B-SA2-HB-L', 'CS5L-SSA-L')).toBeGreaterThan(
      codeSimilarity('CS5B-SA2-HB-L', 'CS2B-SSA-R') + 2
    );
    expect(codeSimilarity('CS5L-SA-HB-L', 'CS5L-SA-HB-L')).toBe(100);
    // A different side counts against.
    expect(codeSimilarity('CS5L-SA-L', 'CS5L-SA-R')).toBeLessThan(
      codeSimilarity('CS5L-SA-L', 'CS5L-WA-L')
    );
  });

  it('writes page lists as words', () => {
    expect(pagesText([3, 1, 2])).toBe('pages 1 to 3');
    expect(pagesText([4])).toBe('page 4');
    expect(pagesText([1, 3])).toBe('pages 1 and 3');
  });
});

describe('form runs to NOMS models', () => {
  it('Alana: the loveseat form fills the loveseat, the chaise form the chaise, no window', () => {
    const match = matchPdfRuns(alanaPages, alanaModels, alanaTitles);
    expect(match.review).toEqual([]);
    expect(match.runs.map(r => [r.title, r.pages, r.product])).toEqual([
      ['CS3-SSA-HB-R', [1, 2, 3], '1'],
      ['CS5B-SA2-HB-L', [4, 5, 6], '0'],
    ]);
    expect(match.targets).toEqual([
      ['1:0'],
      ['1:0'],
      [], // the loveseat has no cushion model on the form: set aside, never the chaise's
      [],
      ['0:0'],
      ['0:0'],
      ['0:2'],
    ]);
    // Nothing writes one letter twice and no product takes two forms.
    expect(
      mappingNeedsReview(alanaPages, match.targets, alanaModels).filter(r =>
        /both|forms|equally|close/.test(r)
      )
    ).toEqual([]);
  });

  describe("Ben's two chaises", () => {
    const chaise = (reference: string) => ({
      reference,
      model_list: [
        {
          name: reference,
          label: 'Sofa Frame',
          files: [
            { name: 'Front_X', field_data: fields('A1 A2 A3 B1 B2 C1 C2 D') },
            { name: 'Side_X', field_data: fields('F1 F2 G1 G2 H1 H3 M1 M2 M3') },
            { name: 'Back_X', field_data: fields('J1 L1 L2') },
          ],
        },
      ],
    });
    const pages = [
      page('R and L Sofa.pdf', 1, 'b', 'CS5L-SA-HB-L', 'SOFA FRAME', 'A1 A2 A3 B1 B2 C1 C2 D1'),
      page('R and L Sofa.pdf', 2, 'b', 'CS5L-SA-HB-L', 'SOFA FRAME', 'F1 F2 G1 G2 J1 L1 L2'),
    ];
    const values = pages.map((p, i) => ({
      file: p.file,
      pageNumber: p.pageNumber!,
      title: p.title,
      unit: 'inch' as const,
      values: p.labels.map((label, j) => ({ label, value: 10 + i * 10 + j })),
    }));

    it('fills one chaise; both only when the person ticks both', () => {
      const models = modelGroups(
        formModels({ unit: 'in', products: [chaise('CS5L-SSA-L'), chaise('CS5L-SSA-L')] })
      );
      const match = matchPdfRuns(pages, models);
      // Two equal chaises: the window opens with one preselected.
      expect(match.review.join(' ')).toMatch(/about equally/);
      expect(match.targets).toEqual([['0:0'], ['0:0']]);
      const fillsBoth = (targets: string[][]) => {
        const drop = cwGroupsToDropValues(
          values,
          targets,
          values.map((v, i) =>
            autoMapping(
              v.values.map(x => x.label),
              models.filter(m => targets[i].includes(m.key))
            )
          ),
          models
        );
        const products = new Set(drop.flatMap(v => v.targets.map(t => t.key.split(':')[0])));
        return Array.from(products).sort();
      };
      expect(fillsBoth(match.targets)).toEqual(['0']);
      // The person ticks both chaises in the window.
      expect(
        fillsBoth([
          ['0:0', '1:0'],
          ['0:0', '1:0'],
        ])
      ).toEqual(['0', '1']);
    });

    it('a left and a right chaise: the left form fills the left one only, no window', () => {
      const models = modelGroups(
        formModels({ unit: 'in', products: [chaise('CS5R-SSA-R'), chaise('CS5L-SSA-L')] })
      );
      const match = matchPdfRuns(pages, models);
      expect(match.review).toEqual([]);
      expect(match.targets).toEqual([['1:0'], ['1:0']]);
    });
  });

  it('two forms that both fit one model best open the window, each preselected apart', () => {
    const pages = [
      page('a.pdf', 1, 'a', 'CS3-SSA-HB-R', 'SOFA FRAME', 'A1 A2 A3 B1 B2 C1 C2 D1 M1 M2'),
      page('b.pdf', 1, 'b', 'CS3-SA-HB-R', 'SOFA FRAME', 'A1 A2 A3 B1 B2 C1 C2 D1 M1 M2'),
    ];
    const match = matchPdfRuns(pages, alanaModels, alanaTitles);
    expect(match.review.some(r => /both fit CS2B-SSA-R best/.test(r))).toBe(true);
    expect(match.runs.find(r => r.title === 'CS3-SSA-HB-R')!.product).toBe('1');
    expect(match.runs.find(r => r.title === 'CS3-SA-HB-R')!.product).toBe('0');
    expect(mappingNeedsReview(pages, match.targets, alanaModels).join(' ')).toMatch(/both fit/);
    // Both forms on one product is caught too.
    expect(mappingNeedsReview(pages, [['1:0'], ['1:0']], alanaModels).join(' ')).toMatch(
      /filled by 2 forms/
    );
  });
});

// The cushion sheet is the same on every CW form: on a scan it was identified
// as "CS3-SSA-HB-R page 6" and set aside instead of following the chaise frame
// (pages 4 to 5) before it.
describe('shared cushion pages follow the frame run before them', () => {
  const byId = (id: string): PdfTemplate => {
    const t = PDF_TEMPLATES.find(x => x.id === id);
    if (!t) throw new Error(`no template ${id}`);
    return t;
  };
  const cs3 = (n: number) => byId(`sectionals-cs3-ssa-hb-r-p${n}`);
  const cs5 = (n: number) => byId(`sectionals-cs5b-sa2-hb-l-p${n}`);
  // As the scan reader picked them: page 6 took the CS3 cushion page (most votes).
  const scanned = [cs3(1), cs3(2), cs3(3), cs5(1), cs5(2), cs3(3)].map((template, i) => ({
    pageNumber: i + 1,
    template,
    confidence: 0.9,
  }));

  it('frame A (1, 2), cushion 3, frame B (4, 5), cushion 6: 3 joins A, 6 joins B', () => {
    const pages = attachCushionPages(scanned, PDF_TEMPLATES);
    expect(pages.map(p => p.template!.source)).toEqual([
      ...Array(3).fill('Sectionals/CS3-SSA-HB-R.pdf'),
      ...Array(3).fill('Sectionals/CS5B-SA2-HB-L.pdf'),
    ]);
    expect(pages[2].template).toBe(cs3(3)); // already its frame's own page
    expect(pages[5].template!.id).toBe('sectionals-cs5b-sa2-hb-l-p3');
    expect(pages[5].template!.modelCodes).toEqual(['CS5B-SA2-HB-L']);
    expect(pages[5].template!.attachedTo).toBe('sectionals-cs5b-sa2-hb-l-p2');
    expect(scanned[5].template).toBe(cs3(3)); // input untouched
  });

  it("takes the frame's codes when its file has no cushion page, capped at its confidence", () => {
    const frame: PdfTemplate = {
      ...cs5(2),
      id: 'solo-p1',
      source: 'Solo/CS9-X-L.pdf',
      modelCodes: ['CS9-X-L'],
    };
    const pages = attachCushionPages(
      [
        { template: frame, confidence: 0.7 },
        { template: cs3(3), confidence: 0.9 },
      ],
      PDF_TEMPLATES
    );
    expect(pages[1].template).toMatchObject({
      id: cs3(3).id,
      view: 'cushion',
      source: 'Solo/CS9-X-L.pdf',
      modelCodes: ['CS9-X-L'],
      attachedTo: 'solo-p1',
    });
    expect(pages[1].confidence).toBe(0.7);
  });

  it('keeps a cushion page with no frame page before it as it was', () => {
    const lone = [{ template: cs3(3), confidence: 0.9 }];
    expect(attachCushionPages(lone, PDF_TEMPLATES)[0]).toBe(lone[0]);
    const afterUnknown = [
      { template: cs5(1), confidence: 0.9 },
      { template: null, confidence: 0 },
      { template: cs3(3), confidence: 0.9 },
    ];
    expect(attachCushionPages(afterUnknown, PDF_TEMPLATES)[2].template).toBe(cs3(3));
  });

  // Read values as the panel gets them, page 6 still on the CS3 cushion template.
  const value = (label: string, text: string, section?: string) => ({
    label,
    value: parseCustomerValue(text),
    text,
    ...(section ? { section } : {}),
  });
  const frameValues = (labels: string) => labels.split(' ').map(l => value(l, '10'));
  const cushion = (section: string, labels: string) =>
    labels.split(' ').map(l => value(l, '20', section));
  const values = [
    frameValues('A1 A2 A3 B1 B2 C1 C2 D1 M1 M2'),
    frameValues('E1 F1 F2 F3 F4 G1 G2 H1 H2 H3 J1 L1 L2 L3'),
    [
      ...cushion('Box seat cushions, type 1', 'A B C D'),
      ...cushion('Box back cushions, type 1', 'A B C D'),
    ],
    frameValues('A1 A2 A3 B1 B2 C1 C3 D1 E1 F1 F2 F3 F4 G1 G2 H1 H2 H3'),
    frameValues('J1 L1 L2 L3 M1 M2 M3'),
    cushion('Box back cushions, type 1', 'A B C'),
  ];
  const result = (withAttach: boolean): CustomerPdfLike => ({
    fileName: 'scan.pdf',
    modelCodes: ['CS3-SSA-HB-R', 'CS5B-SA2-HB-L'],
    confidence: 0.9,
    pages: (withAttach ? attachCushionPages(scanned, PDF_TEMPLATES) : scanned).map((p, i) => ({
      pageNumber: p.pageNumber,
      template: p.template,
      confidence: p.confidence,
      values: values[i],
      unit: 'inch' as const,
      unitAssumed: false,
    })),
  });

  for (const withAttach of [true, false])
    it(`page 6 fills the chaise back cushion, never the loveseat frame (${withAttach ? 'reader' : 'panel'} attaches)`, () => {
      const groups = customerPdfToGroups(result(withAttach));
      const page6 = groups.filter(g => g.pageNumber === 6);
      expect(page6).toHaveLength(1);
      expect(page6[0]).toMatchObject({
        run: groups.find(g => g.pageNumber === 4)!.run,
        runTitle: 'CS5B-SA2-HB-L',
        modelCodes: ['CS5B-SA2-HB-L'],
      });
      expect(groups.find(g => g.pageNumber === 3)!.run).toBe(groups[0].run);
      const asLike = groups.map(g => ({
        ...g,
        labels: [...g.values.map(v => v.label), ...g.notes.map(n => n.label)],
      }));
      const match = matchPdfRuns(asLike, alanaModels, alanaTitles);
      expect(match.review).toEqual([]);
      expect(match.runs.map(r => [r.title, r.pages, r.product])).toEqual([
        ['CS3-SSA-HB-R', [1, 2, 3], '1'],
        ['CS5B-SA2-HB-L', [4, 5, 6], '0'],
      ]);
      const i6 = groups.indexOf(page6[0]);
      expect(match.targets[i6]).toEqual(['0:2']); // CS5L-SSA-L Back Cushion
      const mapping = autoMapping(
        asLike[i6].labels,
        alanaModels.filter(m => match.targets[i6].includes(m.key))
      );
      expect(mapping).toEqual({ A: 'A', B: 'B', C: 'C' });
    });
});

describe.skipIf(!haveAlana)('Alana typed PDF end to end', () => {
  it('fills each model from its own form and the counts add up', async () => {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(ALANA_PDF)),
      verbosity: 0,
    }).promise;
    const read = await readCustomerPdfDocument(doc, pdfjs.OPS, 'typed.pdf', PDF_TEMPLATES);
    const groups = customerPdfToGroups(read);
    expect(new Set(groups.map(g => g.run)).size).toBe(2);
    const match = matchPdfRuns(
      groups.map(g => ({
        ...g,
        labels: [...g.values.map(v => v.label), ...g.notes.map(n => n.label)],
      })),
      alanaModels,
      alanaTitles
    );
    expect(match.review).toEqual([]);
    const drop = cwGroupsToDropValues(
      groups,
      match.targets,
      groups.map((g, i) =>
        autoMapping(
          [...g.values.map(v => v.label), ...g.notes.map(n => n.label)],
          alanaModels.filter(m => match.targets[i].includes(m.key))
        )
      ),
      alanaModels
    );
    const review = classifyDropResult(drop, alanaEntries, 'in');
    const at = (key: string, field: string) =>
      review.placements.find(p => p.key === key && p.field === field)?.value;
    expect(at('1:0:0', 'A1')).toBe('75.25'); // loveseat front
    expect(at('1:0:2', 'L3')).toBe('75');
    expect(at('0:0:0', 'A1')).toBe('31.75'); // chaise front
    expect(at('0:0:1', 'M1')).toBe('54.25');
    expect(at('0:2:0', 'A')).toBe('30'); // chaise back cushion, not the loveseat's
    expect(review.placements.some(p => p.field === 'F3')).toBe(false); // N/A is a note
    expect(review.rows['1:0:1|F3'].flags.map(f => f.kind)).toEqual(['text-only']);
    const { counts } = review;
    expect(counts.read).toBe(drop.length);
    expect(counts.filled + counts.flagged + counts.setAside).toBe(counts.read);
    expect(counts.read).toBe(60); // 63 values on the forms less the 3 cushion quantities
  });
});

describe('drop review fields survive a save', () => {
  const thumb = `data:image/png;base64,${'A'.repeat(400)}`;
  const big = `data:image/png;base64,${'A'.repeat(NOMS_THUMB_MAX)}`;
  const base = {
    file: 'scan.pdf',
    pageNumber: 3,
    title: 'Box seat cushions, type 1',
    unit: 'inch' as const,
  };
  const values: DropValue[] = [
    {
      ...base,
      id: 'scan.pdf|3|seat|A',
      label: 'A',
      value: 69.25,
      text: '69.25',
      targets: [{ key: '0:1:0', field: 'A' }],
    },
    {
      ...base,
      id: 'scan.pdf|3|seat|C',
      label: 'C',
      value: 209,
      text: '209.00',
      ocr: true,
      review: ['Read by OCR, check it'],
      thumb,
      targets: [{ key: '0:1:0', field: 'C' }],
    },
    {
      ...base,
      id: 'scan.pdf|3|seat|B',
      label: 'B',
      value: 69.25,
      text: '69.25',
      ocr: true,
      thumb: big,
      targets: [{ key: '0:1:0', field: 'B' }],
    },
    {
      ...base,
      id: 'scan.pdf|3|seat|D',
      label: 'D',
      value: 4.25,
      text: '4.25*',
      targets: [{ key: '0:1:0', field: 'D' }],
    },
    {
      ...base,
      id: 'scan.pdf|2|frame|F3|note',
      pageNumber: 2,
      label: 'F3',
      value: 0,
      text: 'N/A',
      textOnly: true,
      targets: [{ key: '0:0:1', field: 'F3' }],
    },
  ];
  const saved = normalizeNomsOrders({
    '125927': {
      orderNumber: '125927',
      formId: '6988281905460',
      dropReview: { at: '2026-10-22T08:00:00Z', values, before: {}, picks: {} },
    },
  })['125927'].dropReview!.values as DropValue[];

  it('keeps review, small thumbnails, ocr and textOnly; drops a large thumbnail only', () => {
    const byLabel = Object.fromEntries(saved.map(v => [v.label, v]));
    expect(byLabel.C).toMatchObject({ ocr: true, thumb, review: ['Read by OCR, check it'] });
    expect(byLabel.B.ocr).toBe(true);
    expect(byLabel.B.thumb).toBeUndefined();
    expect(byLabel.F3).toMatchObject({ textOnly: true, text: 'N/A' });
    expect(byLabel.A.ocr).toBeUndefined();
  });

  it('flags OCR doubts and unclean numbers in the strip, keeps N/A as a note', () => {
    const review = classifyDropResult(saved, alanaEntries, 'in');
    const row = (key: string, field: string) => review.rows[`${key}|${field}`];
    // ✓ for a clean typed number, ⚠ for the rest.
    expect(row('0:1:0', 'A').flags).toEqual([]);
    const c = row('0:1:0', 'C').flags.find(f => f.kind === 'ocr')!;
    expect(c.reason).toMatch(/^Read by OCR, check it/);
    expect(c.thumb).toBe(thumb);
    expect(row('0:1:0', 'B').flags.map(f => f.kind)).toEqual(['ocr']);
    expect(row('0:1:0', 'D').flags[0].reason).toMatch(/not a plain number/);
    expect(review.placements.some(p => p.field === 'F3')).toBe(false);
    expect(row('0:0:1', 'F3').flags.map(f => f.kind)).toEqual(['text-only']);
    expect(review.counts).toEqual({ read: 5, filled: 1, flagged: 4, setAside: 0 });
  });

  it('marks low OCR scores and unclean OCR text when reading the page', () => {
    const v = (label: string, text: string, confidence: number) => {
      const parsed = parseCustomerValue(text);
      return {
        label,
        value: parsed.kind === 'none' ? null : parsed,
        text,
        from: 'ocr',
        confidence,
      };
    };
    const result: CustomerPdfLike = {
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
            v('A1', '31.75', 0.99),
            v('A2', '31.2', 0.28),
            v('B1', '28.50*', 0.95),
            v('C1', '3.25', 0.8),
          ],
        },
      ],
    };
    const [group] = customerPdfToGroups(result);
    expect(group.values.filter(x => x.ocr).map(x => x.label)).toEqual(['A2', 'B1']);
    expect(isCleanNumber('22 1/4"')).toBe(true);
    expect(isCleanNumber('2\\')).toBe(false);
  });
});

describe('value counts', () => {
  it('count every value once: filled, to check, or set aside', () => {
    const drop: DropValue[] = [
      ['a', 'A1', 10, '0:0:0'],
      ['b', 'A1', 12, '0:0:0'], // a second value on one letter: both to check
      ['c', 'Z9', 5, ''],
    ].map(([id, label, value, key]) => ({
      id: String(id),
      file: 'x.pdf',
      pageNumber: 1,
      title: 'Front',
      label: String(label),
      value: Number(value),
      unit: 'inch',
      targets: key ? [{ key: String(key), field: String(label) }] : [],
    }));
    const review = classifyDropResult(drop, alanaEntries, 'in');
    expect(dropCounts(drop, review)).toEqual({ read: 3, filled: 0, flagged: 2, setAside: 1 });
    expect(dropCountsText(review.counts)).toBe('3 values read: 0 filled, 2 to check, 1 set aside');
  });
});

describe('recheck ticks are kept', () => {
  const order = (rechecks: Recheck[]) =>
    normalizeNomsOrders({
      '125927': { orderNumber: '125927', formId: '6988281905460', rechecks },
    })['125927'].rechecks as Recheck[];

  it('keeps ticked letters, reasons and resolutions through save and load', () => {
    let recheck = newRecheck('in', '2026-10-22T08:00:00.000Z');
    recheck = {
      ...recheck,
      items: [
        { key: '0:1:0', field: 'C', pick: 'large', detail: 'Read as 209', value: '209' },
        {
          key: '0:0:0',
          field: 'A2',
          pick: 'rule',
          ruleText: 'A2 should be less than A1',
          value: '31.2',
        },
        { key: '1:0:1', field: 'G2', pick: 'factory', detail: 'Measure again', value: '39' },
      ],
    };
    const loaded = order([recheck]);
    expect(loaded).toEqual([recheck]);
    const resolved = resolveItem(
      loaded[0],
      '0:1:0',
      'C',
      { '0:1:0': { C: '29' } },
      '2026-10-23T08:00:00.000Z'
    );
    const again = order([resolved]);
    expect(again[0].items[0]).toMatchObject({
      resolvedValue: '29',
      resolvedAt: '2026-10-23T08:00:00.000Z',
    });
    expect(again[0].status).toBe('open');
    // Bad entries are dropped, not the whole list.
    expect(
      order([
        recheck,
        { id: '', items: [] } as any,
        { ...recheck, id: 'x', items: [{ key: 'bad', field: 'A' }] } as any,
      ]).map(r => [r.id, r.items.length])
    ).toEqual([
      [recheck.id, 3],
      ['x', 0],
    ]);
  });

  it('Show for recheck selects the lines of the ticked letters still open', () => {
    const lines: MeasuredLine[] = [
      { viewId: 'cushion', scope: 'cushion', label: 'C', value: '209' },
      { viewId: 'front', scope: 'front', label: 'A2', value: '31.2' },
      { viewId: 'side', scope: 'side', label: 'G2', value: '39' },
      { viewId: 'front', scope: 'front', label: 'A1', value: '31.75' },
    ];
    const byLetter: Record<string, string> = {
      '0:1:0|C': 'C',
      '0:0:0|A2': 'A2',
      '1:0:1|G2': 'G2',
      '0:0:0|A1': 'A1',
    };
    const linesFor = (key: string, field: string) =>
      lines.filter(l => l.label === byLetter[`${key}|${field}`]);
    let recheck: Recheck = {
      ...newRecheck('in', '2026-10-22T08:00:00.000Z'),
      items: [
        { key: '0:1:0', field: 'C', pick: 'large', value: '209' },
        { key: '0:0:0', field: 'A2', pick: 'unclear', value: '31.2' },
        { key: '1:0:1', field: 'G2', pick: '', value: '39' },
      ],
    };
    recheck = resolveItem(recheck, '1:0:1', 'G2', {}, '2026-10-23T08:00:00.000Z');
    const shown = recheckLines(order([recheck]), linesFor);
    expect(shown.lines.map(s => s.line.label)).toEqual(['C', 'A2']);
    expect(shown.views).toEqual(['cushion', 'front']);
    expect(recheckLines([], linesFor).lines).toEqual([]);
  });
});
