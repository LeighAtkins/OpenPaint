import { describe, expect, it } from 'vitest';
import {
  agoText,
  classifyDropResult,
  cmPdfFileName,
  conflictingDrift,
  cwGroupsToDropValues,
  dropFlagLines,
  formDrift,
  formModels,
  liveDropReview,
  modelGroups,
  reviewToDropValues,
  szSummaryText,
  type DropValue,
  type NomsFormContent,
} from '../../src/modules/ui/noms-link-core';

const content: NomsFormContent = {
  form_ID: 1,
  unit: 'in',
  products: [
    {
      reference: 'CSDC-SA-SNUG',
      model_list: [
        {
          name: 'CSDC-SA-SNUG',
          label: 'Chair',
          files: [
            { name: 'Front_CSDC', field_data: { A1: '', A2: '', D: '' } },
            { name: 'Side_CSDC', field_data: { F1: '', H1: '12' } },
          ],
          rules: {
            A2: [{ eval: 'A2<A1', message: 'A2 should be less than A1', behaviour: 'warning' }],
          },
        },
      ],
    },
    {
      reference: 'CUSH',
      model_list: [{ name: 'CUSH', label: 'Cushion', files: [{ field_data: { K1: '' } }] }],
    },
  ],
};
const models = formModels(content);
const FRONT = '0:0:0';
const SIDE = '0:0:1';

const value = (over: Partial<DropValue>): DropValue => ({
  id: over.id || `f|1|t|${over.label}`,
  file: 'f.pdf',
  pageNumber: 1,
  title: 'Front',
  label: 'A1',
  value: 10,
  unit: 'inch',
  targets: [],
  ...over,
});

describe('classifyDropResult', () => {
  it('matches clean values and flags letters the PDF left out', () => {
    const review = classifyDropResult(
      [
        value({ label: 'A1', value: 30, targets: [{ key: FRONT, field: 'A1' }] }),
        value({ label: 'A2', value: 20, targets: [{ key: FRONT, field: 'A2' }] }),
        value({ label: 'D', value: 24, targets: [{ key: FRONT, field: 'D' }] }),
        value({ label: 'F1', value: 2.875, targets: [{ key: SIDE, field: 'F1' }] }),
      ],
      models,
      'in',
      { [SIDE]: { H1: '12' } }
    );
    expect(review.filled).toBe(4);
    expect(review.placements.find(p => p.field === 'F1')?.value).toBe('2.88');
    expect(review.rows[`${FRONT}|A1`].flags).toEqual([]);
    expect(review.rows[`${SIDE}|H1`].flags).toEqual([
      { kind: 'not-in-pdf', reason: 'Not in the PDF; keeps 12 in' },
    ]);
    // The cushion model was not touched, so it has no rows.
    expect(review.rows['1:0:0|K1']).toBeUndefined();
    expect(review.toCheck).toBe(1);
  });

  it('flags ranges, assumed units, duplicates, rules and extras, and converts to the form unit', () => {
    const review = classifyDropResult(
      [
        value({
          id: 'a',
          label: 'A1',
          value: 25,
          range: [24.5, 25],
          text: 'approx 24.5 - 25"',
          targets: [{ key: FRONT, field: 'A1' }],
        }),
        value({ id: 'b', label: 'A2', value: 30, targets: [{ key: FRONT, field: 'A2' }] }),
        value({
          id: 'c',
          label: 'A2',
          page: 2,
          value: 31,
          file: 'g.pdf',
          targets: [{ key: FRONT, field: 'A2' }],
        } as any),
        value({
          id: 'd',
          label: 'D',
          value: 60,
          unit: 'cm',
          unitAssumed: true,
          targets: [{ key: FRONT, field: 'D' }],
        }),
        value({ id: 'e', label: 'X9', value: 5, why: 'X9 is not a letter on Chair' }),
      ],
      models,
      'in'
    );
    const flags = (field: string) => review.rows[`${FRONT}|${field}`].flags.map(f => f.kind);
    expect(flags('A1')).toEqual(['range']);
    expect(review.rows[`${FRONT}|A1`].flags[0].reason).toBe(
      'Customer wrote approx 24.5 - 25"; used 25 in'
    );
    expect(flags('A2')).toEqual(['duplicate', 'rule']);
    expect(review.rows[`${FRONT}|A2`].flags[0].reason).toContain('PDF also gives 31');
    expect(review.placements.find(p => p.field === 'A2')?.value).toBe('30');
    expect(flags('D')).toEqual(['unit-assumed']);
    expect(review.placements.find(p => p.field === 'D')?.value).toBe('23.62');
    expect(review.extras).toEqual([
      expect.objectContaining({ label: 'X9', reason: 'X9 is not a letter on Chair' }),
    ]);
    // A1, A2, D, F1, H1 flagged plus the extra.
    expect(review.toCheck).toBe(6);
  });

  it('does not flag the same number given twice', () => {
    const review = classifyDropResult(
      [
        value({ id: 'a', label: 'A1', value: 30, targets: [{ key: FRONT, field: 'A1' }] }),
        value({
          id: 'b',
          label: 'A1',
          value: 76.2,
          unit: 'cm',
          targets: [{ key: FRONT, field: 'A1' }],
        }),
      ],
      models,
      'in'
    );
    expect(review.rows[`${FRONT}|A1`].flags).toEqual([]);
  });

  it('uses a picked range end', () => {
    const v = value({
      id: 'a',
      value: 25,
      range: [24.5, 25],
      targets: [{ key: FRONT, field: 'A1' }],
    });
    const review = classifyDropResult([v], models, 'cm', {}, { picks: { a: 24.5 } });
    expect(review.placements[0].value).toBe('62.23');
    expect(review.rows[`${FRONT}|A1`].flags[0].reason).toContain('used 24.5 in');
  });
});

describe('liveDropReview', () => {
  it('flags a hand-changed value and runs rules on what the panel holds', () => {
    const values = [
      value({ id: 'a', label: 'A1', value: 30, targets: [{ key: FRONT, field: 'A1' }] }),
      value({ id: 'b', label: 'A2', value: 20, targets: [{ key: FRONT, field: 'A2' }] }),
    ];
    const review = liveDropReview(values, models, 'in', {}, { [FRONT]: { A1: '30', A2: '35' } });
    const kinds = review.rows[`${FRONT}|A2`].flags.map(f => f.kind);
    expect(kinds).toEqual(['rule', 'changed']);
    expect(dropFlagLines(review, models)).toContain(
      'CSDC-SA-SNUG · Chair · Front A2: A2 should be less than A1; Changed by hand from 20 in in the PDF'
    );
  });
});

describe('cwGroupsToDropValues', () => {
  it('maps letters to file keys and explains letters with no field', () => {
    const groups = modelGroups(models);
    const out = cwGroupsToDropValues(
      [
        {
          file: 'f.pdf',
          pageNumber: 1,
          title: 'Front',
          unit: 'inch',
          values: [
            { label: 'A1', value: 30 },
            { label: 'H1', value: 5 },
            { label: 'Q', value: 1 },
          ],
        },
        {
          file: 'f.pdf',
          pageNumber: 2,
          title: 'Odd',
          unit: 'cm',
          values: [{ label: 'Z', value: 3 }],
        },
      ],
      [['0:0'], []],
      [{ A1: 'A1', H1: 'H1', Q: '' }, {}],
      groups
    );
    expect(out[0].targets).toEqual([{ key: FRONT, field: 'A1' }]);
    expect(out[1].targets).toEqual([{ key: SIDE, field: 'H1' }]);
    expect(out[2].why).toBe('Q is not a letter on CSDC-SA-SNUG · Chair');
    expect(out[3].why).toBe('Odd matched no form model');
  });
});

describe('reviewToDropValues', () => {
  const manifest = {
    unit: 'inch',
    views: [
      {
        viewId: 'front',
        title: 'Front',
        measurements: [
          { label: 'A1', value: '23"' },
          { label: 'C2', value: '7" see photos' },
          { label: 'Z', value: '' },
        ],
      },
      { viewId: 'side-1', title: 'Side', measurements: [{ label: 'H1', value: '5-5.25"' }] },
      { viewId: 'other', title: 'Other', measurements: [{ label: 'Q', value: 'n/a' }] },
    ],
  };
  it('binds by line link first, then by the same label on views linked to the model', () => {
    const out = reviewToDropValues('ria.pdf', manifest, models, {
      lineLinks: { [`${SIDE}:F1`]: { viewId: 'front', label: 'C2' } },
      viewsByKey: { [FRONT]: ['front'], [SIDE]: ['side-1'] },
      viewBindings: { front: FRONT, 'side-1': SIDE },
    });
    const by = Object.fromEntries(out.map(v => [v.label, v]));
    expect(by.A1.targets).toEqual([{ key: FRONT, field: 'A1' }]);
    expect(by.A1.value).toBe(23);
    expect(by.C2.targets).toEqual([{ key: SIDE, field: 'F1' }]);
    expect(by.H1.targets).toEqual([{ key: SIDE, field: 'H1' }]);
    expect(by.H1.range).toEqual([5, 5.25]);
    expect(by.H1.value).toBe(5.25);
    expect(by.Q.why).toBe('not a number: n/a');
    expect(by.Z).toBeUndefined();
    expect(out.every(v => v.unit === 'inch' && !v.unitAssumed)).toBe(true);
  });
  it('explains values on views not linked to the form', () => {
    const out = reviewToDropValues('ria.pdf', { views: manifest.views.slice(0, 1) }, models, {});
    expect(out[0].why).toBe('Front is not linked to a form model');
    // 23" states its unit even without the manifest's.
    expect(out[0].unitAssumed).toBe(false);
    const bare = reviewToDropValues(
      'x.pdf',
      { views: [{ viewId: 'v', measurements: [{ label: 'A', value: '12' }] }] },
      models,
      { fallbackUnit: 'cm' }
    );
    expect(bare[0]).toMatchObject({ unit: 'cm', unitAssumed: true });
  });
});

describe('szSummaryText', () => {
  it('lists values in cm by model and letter, with flags', () => {
    const text = szSummaryText({
      orderNumber: '125964',
      customerName: 'Ria Ganary',
      models: models.slice(0, 2),
      values: { [FRONT]: { A1: '23', A2: '2.5', D: '' }, [SIDE]: { F1: '2.88', H1: '0' } },
      unit: 'in',
      flags: ['Chair A3: Customer wrote 24.5 - 25'],
      pdfName: '125964 - Ria Ganary - measurements cm.pdf',
    });
    expect(text).toBe(
      [
        'NOMS #125964 - Ria Ganary',
        'Product: CSDC-SA-SNUG',
        'Measurements in cm',
        '',
        'CSDC-SA-SNUG · Chair · Front',
        'A1: 58.4',
        'A2: 6.4',
        'D: -',
        '',
        'CSDC-SA-SNUG · Chair · Side',
        'F1: 7.3',
        'H1: -',
        '',
        'To check (1):',
        '- Chair A3: Customer wrote 24.5 - 25',
        '',
        'Attached: 125964 - Ria Ganary - measurements cm.pdf',
      ].join('\n')
    );
  });
  it('says when nothing is flagged and keeps cm values as they are', () => {
    const text = szSummaryText({
      orderNumber: '1',
      models: models.slice(2),
      values: { '1:0:0': { K1: '4.45' } },
      unit: 'cm',
    });
    expect(text).toContain('K1: 4.5');
    expect(text).toContain('No flagged values.');
  });
  it('names the cm PDF safely', () => {
    expect(cmPdfFileName('125964', 'Ria / Ganary')).toBe(
      '125964 - Ria Ganary - measurements cm.pdf'
    );
    expect(cmPdfFileName('1')).toBe('1 - measurements cm.pdf');
  });
});

describe('formDrift', () => {
  const snapshot = { [FRONT]: { A1: '30', A2: '20', D: '' } };
  it('finds letters NOMS changed since the snapshot and whether the panel also changed them', () => {
    const fresh = { [FRONT]: { A1: '31', A2: '20', D: '24', NEW: '1' } };
    const mine = { [FRONT]: { A1: '30', A2: '19', D: '25' } };
    const drift = formDrift(snapshot, fresh, mine);
    expect(drift).toEqual([
      { key: FRONT, field: 'A1', was: '30', now: '31', mine: '30', touched: false },
      { key: FRONT, field: 'D', was: '', now: '24', mine: '25', touched: true },
    ]);
    expect(conflictingDrift(drift).map(d => d.field)).toEqual(['A1', 'D']);
  });
  it('ignores the same number written differently, and drift the panel already holds', () => {
    const fresh = { [FRONT]: { A1: '30.0', A2: '21', D: '' } };
    const drift = formDrift(snapshot, fresh, { [FRONT]: { A2: '21' } });
    expect(drift.map(d => d.field)).toEqual(['A2']);
    expect(conflictingDrift(drift)).toEqual([]);
    expect(formDrift(null, fresh, {})).toEqual([]);
  });
  it('says how long ago', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(agoText('2026-10-21T10:00:00Z', now)).toBe('2 h ago');
    expect(agoText('2026-10-21T11:55:00Z', now)).toBe('5 min ago');
    expect(agoText('', now)).toBe('earlier');
  });
});

describe('order metadata keeps the send state', () => {
  it('keeps the snapshot, the drop review and the confirm choice, and drops junk', async () => {
    const { normalizeNomsOrders } = await import('../../src/modules/sofa-metadata.js');
    const out = normalizeNomsOrders({
      '125964': {
        orderNumber: '125964',
        formId: '12345678',
        formSnapshot: { [FRONT]: { A1: '30' }, junk: { A: '1' } },
        snapshotAt: '2026-10-21T10:00:00Z',
        skipFlagConfirm: true,
        cmPdfName: '125964 - Ria - measurements cm.pdf',
        lastSentAt: '2026-10-21T11:00:00Z',
        dropReview: {
          at: '2026-10-21T10:00:00Z',
          before: { [FRONT]: { A1: '' } },
          picks: { a: 24.5, bad: 'x' },
          values: [
            value({
              id: 'a',
              range: [24.5, 25],
              text: 'approx 24.5 - 25"',
              targets: [
                { key: FRONT, field: 'A1' },
                { key: 'nope', field: 'A1' },
              ],
            }),
            { id: 'broken', value: 'x', unit: 'inch' },
          ],
        },
      },
    }) as any;
    const entry = out['125964'];
    expect(entry.formSnapshot).toEqual({ [FRONT]: { A1: '30' } });
    expect(entry.skipFlagConfirm).toBe(true);
    expect(entry.cmPdfName).toBe('125964 - Ria - measurements cm.pdf');
    expect(entry.dropReview.picks).toEqual({ a: 24.5 });
    expect(entry.dropReview.values).toHaveLength(1);
    expect(entry.dropReview.values[0]).toMatchObject({
      id: 'a',
      range: [24.5, 25],
      targets: [{ key: FRONT, field: 'A1' }],
    });
  });
});
