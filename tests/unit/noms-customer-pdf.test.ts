import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readCustomerPdfDocument } from '../../src/modules/cw-form-pdf/read-customer-pdf';
import { PDF_TEMPLATES, findCwSvg } from '../../src/modules/ui/pdf-template-registry';
import { parseCustomerValue } from '../../src/modules/utils/customer-value';
import {
  autoMapping,
  classifyDropResult,
  customerPdfToGroups,
  cwGroupsToDropValues,
  diagramOffers,
  dropFlagLines,
  formModels,
  mappingNeedsReview,
  modelGroups,
  refineTargets,
  type CustomerPdfLike,
} from '../../src/modules/ui/noms-link-core';

const FIXTURE = resolve(__dirname, '../fixtures/pdf-library/Sectionals/CS5L-WA-HB-L.pdf');

const value = (label: string, text: string) => {
  const parsed = parseCustomerValue(text);
  return { label, value: parsed.kind === 'none' ? null : parsed, text: parsed.text };
};

function page(
  values: ReturnType<typeof value>[],
  unit: 'cm' | 'inch',
  unitAssumed: boolean,
  template: CustomerPdfLike['pages'][number]['template'] = null
): CustomerPdfLike['pages'][number] {
  return { pageNumber: 1, template, confidence: template ? 1 : 0, values, unit, unitAssumed };
}

// Two sectional pieces whose frames share every letter: only the model code tells them apart.
const form = {
  unit: 'in',
  products: [
    {
      reference: 'CS5L-SA-L',
      model_list: [
        {
          name: 'CS5L-SA-HB-L',
          label: 'Sofa Frame',
          files: [{ field_data: { A1: '', A2: '', B1: '', C1: '', D: '' } }],
        },
      ],
    },
    {
      reference: 'CS5L-WA-L',
      model_list: [
        {
          name: 'CS5L-WA-HB-L',
          label: 'Sofa Frame',
          files: [{ field_data: { A1: '', A2: '', B1: '', C1: '', D: '' } }],
        },
      ],
    },
  ],
};
const entries = formModels(form);
const models = modelGroups(entries);
const titles = Object.fromEntries(models.map(m => [m.key, m.title]));
const frameValues = [
  value('A1', '81'),
  value('A2', '24 - 25'),
  value('B1', '30'),
  value('C1', '20'),
  value('D', '5'),
];

describe('customer PDF unit flag', () => {
  it('flags the unit only when the page assumed it', () => {
    for (const assumed of [false, true]) {
      const groups = customerPdfToGroups({
        fileName: 'f.pdf',
        modelCodes: [],
        confidence: 0,
        pages: [page(frameValues, assumed ? 'cm' : 'inch', assumed)],
      });
      expect(groups[0]).toMatchObject({ unit: assumed ? 'cm' : 'inch', unitAssumed: assumed });
      const drop = cwGroupsToDropValues(
        groups,
        [['0:0']],
        [autoMapping(['A1', 'A2', 'B1', 'C1', 'D'], [models[0]])],
        models
      );
      const review = classifyDropResult(drop, entries, 'in');
      const unitFlags = Object.values(review.rows).filter(r =>
        r.flags.some(f => f.kind === 'unit-assumed')
      );
      expect(unitFlags.length).toBe(assumed ? 5 : 0);
      expect(review.filled).toBe(5);
    }
  });

  it('keeps both numbers of a range and uses the upper one', () => {
    const [group] = customerPdfToGroups({
      fileName: 'f.pdf',
      modelCodes: [],
      confidence: 0,
      pages: [page(frameValues, 'inch', false)],
    });
    expect(group.values.find(v => v.label === 'A2')).toMatchObject({ value: 25, range: [24, 25] });
  });
});

describe('customer PDF model codes', () => {
  let read: Awaited<ReturnType<typeof readCustomerPdfDocument>>;
  beforeAll(async () => {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(FIXTURE)),
      verbosity: 0,
    }).promise;
    // A renamed copy: the code comes from the form itself, not the file name.
    read = await readCustomerPdfDocument(doc, pdfjs.OPS, 'R and L Sofa.pdf', PDF_TEMPLATES);
  });

  it('maps a recognised form straight to its model when letters alone are ambiguous', () => {
    expect(read.modelCodes).toEqual(['CS5L-WA-HB-L']);
    const filled = {
      ...read,
      pages: [{ ...read.pages[0], values: frameValues, unit: 'inch' as const, unitAssumed: false }],
    };
    const groups = customerPdfToGroups(filled);
    expect(groups[0]).toMatchObject({ modelCodes: ['CS5L-WA-HB-L'], view: 'frame' });

    const plain = groups.map(g => ({
      file: g.file,
      title: g.title,
      labels: ['A1', 'A2', 'B1', 'C1', 'D'],
    }));
    const byLetters = refineTargets(plain, models, titles);
    expect(byLetters[0]).toHaveLength(2);
    expect(mappingNeedsReview(plain, byLetters, models)).not.toEqual([]);

    const coded = groups.map(g => ({
      file: g.file,
      title: g.title,
      labels: g.values.map(v => v.label),
      modelCodes: g.modelCodes,
      view: g.view,
    }));
    const picks = refineTargets(coded, models, titles);
    expect(picks).toEqual([['1:0']]);
    expect(mappingNeedsReview(coded, picks, models)).toEqual([]);
  });

  it('ignores the code when the letters disagree, and on a weak template match', () => {
    const cushion = [
      { file: 'x', title: 'Cushion', labels: ['P', 'Q', 'R'], modelCodes: ['CS5L-WA-HB-L'] },
    ];
    expect(refineTargets(cushion, models, titles)).toEqual([[]]);
    const weak = customerPdfToGroups({
      ...read,
      pages: [{ ...read.pages[0], confidence: 0.5, values: frameValues }],
    });
    expect(weak[0].modelCodes).toEqual([]);
  });

  it('offers the library diagram for the model when there is no form', () => {
    const groups = customerPdfToGroups({
      ...read,
      pages: [{ ...read.pages[0], values: frameValues, unit: 'inch', unitAssumed: false }],
    });
    const offers = diagramOffers(groups, findCwSvg);
    expect(offers).toHaveLength(1);
    expect(offers[0].code).toBe('CS5L-WA-HB-L');
    expect(offers[0].url).toMatch(/^\/cw-svgs\//);
    expect(offers[0].values.map(v => v.label)).toEqual(['A1', 'A2', 'B1', 'C1', 'D']);
    expect(diagramOffers(groups, () => null)).toEqual([]);
  });
});

describe('customer PDF words-only answers', () => {
  const groups = customerPdfToGroups({
    fileName: 'f.pdf',
    modelCodes: [],
    confidence: 0,
    pages: [
      page(
        [value('A1', '81'), value('A2', 'n/a'), value('B1', 'see photo'), value('Z9', 'n/a')],
        'inch',
        false
      ),
    ],
  });

  it('keeps them as notes rather than dropping them', () => {
    expect(groups[0].values.map(v => v.label)).toEqual(['A1']);
    expect(groups[0].notes).toEqual([
      { label: 'A2', text: 'n/a' },
      { label: 'B1', text: 'see photo' },
      { label: 'Z9', text: 'n/a' },
    ]);
  });

  it('shows them as flags and extras in the review, without filling a value', () => {
    const drop = cwGroupsToDropValues(
      groups,
      [['0:0']],
      [autoMapping(['A1', 'A2', 'B1', 'Z9'], [models[0]])],
      models
    );
    expect(drop.filter(v => v.textOnly).map(v => v.label)).toEqual(['A2', 'B1', 'Z9']);
    const review = classifyDropResult(drop, entries, 'in');
    expect(review.placements.map(p => p.field)).toEqual(['A1']);
    const a2 = review.rows['0:0:0|A2'];
    expect(a2.from).toBe('');
    expect(a2.flags.map(f => f.kind)).toEqual(['text-only']);
    expect(a2.flags[0].reason).toMatch(/"n\/a"/);
    expect(review.rows['0:0:0|B1'].flags[0].reason).toMatch(/see photo/);
    expect(review.extras).toEqual([
      expect.objectContaining({ label: 'Z9', text: 'n/a', reason: expect.stringMatching(/note/) }),
    ]);
    expect(
      dropFlagLines(review, entries).some(line => /A2: Customer wrote "n\/a"/.test(line))
    ).toBe(true);
  });
});
