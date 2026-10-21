import { describe, expect, it } from 'vitest';
import {
  changedFields,
  convertMeasure,
  evalRule,
  formModels,
  fromCanvasMeasurement,
  hasMeasure,
  refreshLineTag,
  resolveLineForLetter,
  suggestLineLinks,
  lineLinkKey,
  type MeasuredLine,
  canvasMeasurementCm,
  formToTyped,
  typedToForm,
  pickInputUnit,
  isComfortWorksStaff,
  measureIssues,
  parseMeasure,
  soleModelForReference,
  modelGroups,
  defaultFieldFor,
  suggestTargets,
  pdfValueToForm,
  refineTargets,
  autoMapping,
  mappingNeedsReview,
} from '../../src/modules/ui/noms-link-core';
import { normalizeSofaMetadata, mergeSofaMetadata } from '../../src/modules/sofa-metadata.js';

// Shape of the CW40 measure form for NOMS order #126202 (values in inches).
const form = {
  form_ID: 6988281905460,
  unit: 'in',
  confirmed: true,
  products: [
    {
      reference: 'CC-ST-L',
      enabled: true,
      model_list: [
        {
          name: 'CC-ST-L',
          label: 'L-Shaped Seat Cushion',
          files: [
            {
              name: 'Front_CC-ST-L',
              quantity: 1,
              field_data: { A: '32', B: '27', C: '53', D: '5', E: '27' },
            },
          ],
          rules: {
            A: [
              { eval: 'A>0', message: 'Please enter a value', behaviour: 'error' },
              { eval: 'A<130', message: 'Too big', behaviour: 'warning' },
            ],
            E: [{ eval: 'E<50', message: 'Too big', behaviour: 'warning' }],
          },
        },
      ],
    },
    {
      reference: 'OFF',
      enabled: false,
      model_list: [{ name: 'OFF', files: [{ field_data: { A: '1' } }] }],
    },
  ],
};

describe('NOMS measurement link helpers', () => {
  it('only treats confirmed @comfort-works.com accounts as staff', () => {
    expect(isComfortWorksStaff({ email: 'leigh@comfort-works.com', emailConfirmed: true })).toBe(
      true
    );
    expect(isComfortWorksStaff({ email: 'leigh@comfort-works.com', emailConfirmed: false })).toBe(
      false
    );
    expect(isComfortWorksStaff({ email: 'x@evilcomfort-works.com', emailConfirmed: true })).toBe(
      false
    );
    expect(
      isComfortWorksStaff({ email: 'x@comfort-works.com.evil.io', emailConfirmed: true })
    ).toBe(false);
    expect(isComfortWorksStaff(null)).toBe(false);
  });

  it('lists each measured model on the form, skipping disabled products', () => {
    const models = formModels(form);
    expect(models.map(m => [m.key, m.title, m.fields.join('')])).toEqual([
      ['0:0:0', 'CC-ST-L · L-Shaped Seat Cushion', 'ABCDE'],
    ]);
    expect(soleModelForReference(models, 'cc-st-l')).toBe('0:0:0');
    expect(soleModelForReference(models, 'OTHER')).toBe('');
  });

  it('reads the ways people type measurements', () => {
    expect(parseMeasure('32 1/2')).toBe('32.5');
    expect(parseMeasure('39¾')).toBe('39.75');
    expect(parseMeasure('32,5')).toBe('32.5');
    expect(parseMeasure('81.28 cm')).toBe('81.28');
    expect(parseMeasure('')).toBe('');
    expect(parseMeasure('abc')).toBeNull();
    expect(convertMeasure('32', 'in', 'cm')).toBe('81.28');
    expect(fromCanvasMeasurement({ cm: 81.28, inch: 32 }, 'in')).toBe('32');
    expect(fromCanvasMeasurement({ cm: 81.28, inch: 32 }, 'cm')).toBe('81.28');
    expect(fromCanvasMeasurement({ cm: 0, inch: 0 }, 'in')).toBe('');
  });

  it('fills the box from a line that has a number in either unit', () => {
    // Saved by older code or loaded from a project where only one unit survived.
    expect(fromCanvasMeasurement({ cm: 0, inch: 23 }, 'cm')).toBe('58.42');
    expect(fromCanvasMeasurement({ inch: 23.5 }, 'cm')).toBe('59.69');
    expect(fromCanvasMeasurement({ cm: 58.42 }, 'in')).toBe('23');
    expect(fromCanvasMeasurement({ cm: NaN, inch: 23 }, 'cm')).toBe('58.42');
    expect(fromCanvasMeasurement({ cm: 0, inch: 0, inchWhole: 23, inchFraction: 0.5 }, 'cm')).toBe(
      '59.69'
    );
    expect(fromCanvasMeasurement({ cm: 0, inch: 0, inchWhole: 23, inchFraction: 0.5 }, 'in')).toBe(
      '23.5'
    );
    // inputUnit missing or odd does not matter.
    expect(fromCanvasMeasurement({ cm: 58.42, inch: 23, inputUnit: undefined }, 'in')).toBe('23');
    expect(fromCanvasMeasurement({ cm: 58.42, inch: 23, inputUnit: 'see photos' }, 'cm')).toBe(
      '58.42'
    );
    // The stored value in the asked-for unit wins over a conversion.
    expect(fromCanvasMeasurement({ cm: 129, inch: 50.8125 }, 'in')).toBe('50.81');
    expect(fromCanvasMeasurement({ cm: 129, inch: 50.8125 }, 'cm')).toBe('129');
  });

  it('reads a line stored as inchWhole/inchFraction only, as the line list shows it', () => {
    // Leigh's project: the list showed H3 = 11.5" while the panel box said 0.
    const parts = { cm: 0, inch: 0, inchWhole: 11, inchFraction: 0.5, inputUnit: 'inches' };
    expect(fromCanvasMeasurement(parts, 'in')).toBe('11.5');
    expect(fromCanvasMeasurement(parts, 'cm')).toBe('29.21');
    expect(fromCanvasMeasurement({ cm: 0, inch: 11.5 }, 'in')).toBe('11.5');
    expect(fromCanvasMeasurement({ cm: 0, inch: 11.5 }, 'cm')).toBe('29.21');
  });

  it('treats "0" or text on the form as no measurement so the line can fill it', () => {
    expect(hasMeasure('0')).toBe(false);
    expect(hasMeasure('')).toBe(false);
    expect(hasMeasure(undefined)).toBe(false);
    expect(hasMeasure('abc')).toBe(false);
    expect(hasMeasure('11.5')).toBe(true);
    expect(hasMeasure('11 1/2')).toBe(true);
  });

  it('refreshes the canvas label of a line after its measurement was written', () => {
    const calls: string[] = [];
    const tags = {
      getTagObject: (label: string, scope: string) => (label === 'H3' ? { scope } : null),
      updateTagText: (label: string, scope: string) => calls.push(`${scope}|${label}`),
    };
    expect(refreshLineTag(tags, 'side', 'H3')).toBe(true);
    expect(refreshLineTag(tags, 'side', 'Z9')).toBe(false);
    expect(refreshLineTag(null, 'side', 'H3')).toBe(false);
    expect(calls).toEqual(['side|H3']);
  });

  it('treats a note or a bare value stored on a line sensibly', () => {
    expect(fromCanvasMeasurement('see photos', 'cm')).toBe('');
    expect(fromCanvasMeasurement({ cm: 'see photos', inch: 'see photos' }, 'cm')).toBe('');
    expect(fromCanvasMeasurement({}, 'in')).toBe('');
    expect(fromCanvasMeasurement(null, 'in')).toBe('');
    expect(fromCanvasMeasurement('23"', 'cm')).toBe('58.42');
    expect(fromCanvasMeasurement('58.42 cm', 'in')).toBe('23');
    expect(fromCanvasMeasurement('23 1/2', 'in')).toBe('23.5');
    expect(fromCanvasMeasurement('60', 'cm')).toBe('60');
    expect(canvasMeasurementCm({ cm: 0, inch: 10 })).toBe(25.4);
    expect(canvasMeasurementCm({ cm: 0, inch: 0 })).toBeNull();
    expect(canvasMeasurementCm('see photos')).toBeNull();
  });

  it('converts what is typed in one unit to the form unit and back', () => {
    expect(typedToForm('23', 'in', 'cm')).toBe('58.42');
    expect(typedToForm('23 1/2', 'in', 'cm')).toBe('59.69');
    expect(typedToForm('23.5', 'in', 'cm')).toBe('59.69');
    expect(typedToForm('23½', 'in', 'cm')).toBe('59.69');
    expect(typedToForm('58.42', 'cm', 'in')).toBe('23');
    expect(typedToForm('60', 'cm', 'in')).toBe('23.62');
    expect(typedToForm('60', 'cm', 'cm')).toBe('60');
    expect(typedToForm('32 1/2', 'in', 'in')).toBe('32.5');
    expect(typedToForm('', 'in', 'cm')).toBe('');
    expect(typedToForm('abc', 'in', 'cm')).toBeNull();
    expect(formToTyped('58.42', 'cm', 'in')).toBe('23');
    expect(formToTyped('59.69', 'cm', 'in')).toBe('23.5');
    expect(formToTyped('23.5', 'in', 'cm')).toBe('59.69');
    expect(formToTyped('23.5', 'in', 'in')).toBe('23.5');
    expect(formToTyped('abc', 'cm', 'in')).toBe('abc');
    expect(formToTyped('', 'cm', 'in')).toBe('');
    // Round trips at two decimals.
    for (const typed of ['23', '23.5', '23.25', '40.75', '12.13']) {
      expect(formToTyped(typedToForm(typed, 'in', 'cm') as string, 'cm', 'in')).toBe(typed);
    }
    for (const typed of ['58.42', '2.54', '25.4', '127']) {
      expect(formToTyped(typedToForm(typed, 'cm', 'in') as string, 'in', 'cm')).toBe(typed);
    }
    expect(pickInputUnit('in', 'cm')).toBe('in');
    expect(pickInputUnit('cm', 'in')).toBe('cm');
    expect(pickInputUnit(null, 'cm')).toBe('cm');
    expect(pickInputUnit('inches', 'cm')).toBe('cm');
  });

  it('checks rules in centimetres without running code', () => {
    expect(evalRule('abs(A-C)<5 && B<=100', { A: '80', B: '100', C: '82' })).toBe(true);
    expect(evalRule('alert(1)', {})).toBeNull();
    const rules = formModels(form)[0].rules;
    expect(measureIssues(rules, { A: '', E: '27' }, 'in')).toEqual({
      errors: { A: 'Please enter a value' },
      warnings: { E: 'Too big' },
    });
  });

  it('lists the values that differ from the saved form', () => {
    expect(
      changedFields({ '0:0:0': { A: '32', B: '27' } }, { '0:0:0': { A: '32.5', B: '27' } })
    ).toEqual(['0:0:0|A']);
  });

  it('keeps letter links through project metadata normalisation', () => {
    const metadata = normalizeSofaMetadata({
      externalSources: {
        nomsOrders: {
          '125964': {
            formId: '6988281905460',
            lineLinks: {
              '0:0:1:H1': { viewId: 'side', label: 'H1' },
              '0:0:1:A3': { viewId: 'top-down', label: 'A3' },
              'junk:H1': { viewId: 'side', label: 'H1' },
              '0:0:1:B1': { viewId: '', label: 'B1' },
              '0:0:1:<x>': { viewId: 'side', label: 'B1' },
            },
          },
        },
      },
    });
    expect(metadata.externalSources.nomsOrders['125964'].lineLinks).toEqual({
      '0:0:1:H1': { viewId: 'side', label: 'H1' },
      '0:0:1:A3': { viewId: 'top-down', label: 'A3' },
    });
  });

  it('keeps a NOMS order link through project metadata normalisation', () => {
    const metadata = normalizeSofaMetadata({
      externalSources: {
        nomsOrders: {
          '126202': {
            formId: '6988281905460',
            lang: 'en',
            customerName: 'Jason Bonsignore',
            unit: 'in',
            confirmed: true,
            values: { '0:0:0': { A: '32', B: 27, '<bad>': '1' }, junk: { A: '1' } },
            viewBindings: { 'cw-cc-st-l-diagram': '0:0:0', photo: 'nope' },
            diagramViews: { '0:0:0': 'cw-cc-st-l-diagram' },
            importedImageHashes: ['ABC', 'abc'],
          },
          bad: { formId: '1' },
        },
      },
    });
    expect(Object.keys(metadata.externalSources.nomsOrders)).toEqual(['126202']);
    expect(metadata.externalSources.nomsOrders['126202']).toMatchObject({
      orderNumber: '126202',
      formId: '6988281905460',
      values: { '0:0:0': { A: '32', B: '27' } },
      viewBindings: { 'cw-cc-st-l-diagram': '0:0:0' },
      diagramViews: { '0:0:0': 'cw-cc-st-l-diagram' },
      importedImageHashes: ['abc'],
    });
    const merged = mergeSofaMetadata(metadata, { naming: { customerName: 'Jason' } });
    expect(merged.externalSources.nomsOrders['126202'].formId).toBe('6988281905460');
    expect(merged.externalSources.gorgiasTickets).toEqual({});
  });
});

describe('Filling the form from a measuring PDF', () => {
  // Ben's order: chaise frame model (front/side/back files) and armless frame.
  const benForm = {
    unit: 'cm',
    products: [
      {
        reference: 'CS5L-SSA-L',
        enabled: false,
        model_list: [
          {
            name: 'CS5L-SSA-HB2-L',
            label: 'Sofa Frame',
            files: [
              {
                label: 'Front',
                field_data: {
                  A1: '',
                  A2: '',
                  A3: '',
                  B1: '',
                  B2: '',
                  C1: '',
                  C2: '',
                  C4: '',
                  D: '',
                },
              },
              {
                label: 'Side',
                field_data: {
                  F1: '',
                  F2: '',
                  F3: '',
                  F4: '',
                  G1: '',
                  G2: '',
                  H1: '',
                  H3: '',
                  M1: '',
                  M2: '',
                  M3: '',
                },
              },
              { label: 'Back', field_data: { J1: '', L1: '', L2: '', M4: '' } },
            ],
          },
        ],
      },
      {
        reference: 'CS3X-NA',
        model_list: [
          {
            name: 'CS3B-NA',
            label: 'Frame',
            files: [
              { label: 'Front', field_data: { A2: '', A3: '', C: '', D: '' } },
              {
                label: 'Side',
                field_data: { F: '', G1: '', G2: '', H1: '', H2: '', H3: '', M4: '' },
              },
              { label: 'Back', field_data: { J1: '', L1: '', L2: '' } },
            ],
          },
          {
            name: 'CC-ST-BE',
            label: 'Seat Cushion',
            files: [{ field_data: { A: '', B: '', C: '', D: '' } }],
          },
        ],
      },
    ],
  };
  const groups = modelGroups(formModels(benForm, { includeDisabled: true }));

  it('groups a model’s front, side and back files', () => {
    expect(groups[0].title).toBe('CS5L-SSA-L · Sofa Frame (not enabled on the form)');
    expect(groups.map(g => [g.key, Object.keys(g.fields).length])).toEqual([
      ['0:0', 24],
      ['1:0', 14],
      ['1:1', 4],
    ]);
    expect(groups[0].fields.F1).toBe('0:0:1');
    expect(groups[0].fields.J1).toBe('0:0:2');
    expect(formModels(benForm).map(m => m.key)).not.toContain('0:0:0');
    expect(formModels(benForm, { includeDisabled: true })[0].title).toMatch(
      /not enabled on the form/
    );
  });

  it('maps PDF letters onto form fields, including D1 to D', () => {
    const fields = Object.keys(groups[0].fields);
    expect(defaultFieldFor('A1', fields)).toBe('A1');
    expect(defaultFieldFor('D1', fields)).toBe('D');
    expect(defaultFieldFor('C3', fields)).toBe('');
    expect(defaultFieldFor('F*', ['F'])).toBe('F');
  });

  it('suggests the models that share most of a diagram’s letters', () => {
    const chaise = [
      'A1',
      'A2',
      'A3',
      'B1',
      'B2',
      'C1',
      'C2',
      'C3',
      'D1',
      'F1',
      'F2',
      'F3',
      'F4',
      'G1',
      'G2',
      'H3',
      'M1',
      'M2',
      'M3',
    ];
    expect(suggestTargets(chaise, groups)).toEqual(['0:0']);
    const middle = [
      'A1',
      'A2',
      'A3',
      'B',
      'C',
      'D',
      'F',
      'G1',
      'G2',
      'H1',
      'H2',
      'H3',
      'J1',
      'L1',
      'L2',
    ];
    expect(suggestTargets(middle, groups)).toEqual(['1:0']);
  });

  it('converts PDF inches to the form unit', () => {
    expect(pdfValueToForm(22.25, 'inch', 'cm')).toBe('56.52');
    expect(pdfValueToForm(22.25, 'inch', 'in')).toBe('22.25');
    expect(pdfValueToForm(81.28, 'cm', 'in')).toBe('32');
  });

  it('keeps a PDF to the products its frame matched, and picks seat/back by title', () => {
    const models = modelGroups(formModels(benForm, { includeDisabled: true }));
    const labels = Object.fromEntries(models.map(m => [m.key, m.title]));
    const picks = refineTargets(
      [
        {
          file: 'R and L',
          title: 'Front and Side',
          labels: [
            'A1',
            'A2',
            'A3',
            'B1',
            'B2',
            'C1',
            'C2',
            'D1',
            'F1',
            'G1',
            'G2',
            'M1',
            'M2',
            'M3',
          ],
        },
        { file: 'R and L', title: 'Back', labels: ['J1', 'L1', 'L2'] },
        {
          file: 'Middle',
          title: 'Page 1',
          labels: ['A2', 'A3', 'C', 'D', 'F', 'G1', 'G2', 'H1', 'H2', 'H3', 'J1', 'L1', 'L2'],
        },
        {
          file: 'Middle',
          title: 'BOX SHAPED CUSHION, seat cushions',
          labels: ['A', 'B', 'C', 'D'],
        },
      ],
      models,
      labels
    );
    expect(picks).toEqual([['0:0'], ['0:0'], ['1:0'], ['1:1']]);
  });
});

describe('Deciding whether a dropped PDF needs the mapping window', () => {
  const form = {
    unit: 'in',
    products: [
      {
        reference: 'CS3X-NA',
        model_list: [
          {
            name: 'CS3B-NA',
            label: 'Frame',
            files: [
              { label: 'Front', field_data: { A2: '', A3: '', C: '', D: '' } },
              { label: 'Side', field_data: { F: '', G1: '', G2: '', H1: '', H2: '', H3: '' } },
              { label: 'Back', field_data: { J1: '', L1: '', L2: '' } },
            ],
          },
          {
            name: 'CC-ST-BE',
            label: 'Seat Cushion',
            files: [{ field_data: { A: '', B: '', C: '', D: '' } }],
          },
        ],
      },
    ],
  };
  const models = modelGroups(formModels(form));
  const frame = {
    file: 'Sofa.pdf',
    title: 'Front and Side',
    labels: ['A2', 'A3', 'C', 'D', 'F', 'G1', 'G2', 'H1', 'H2', 'H3'],
  };
  const back = { file: 'Sofa.pdf', title: 'Back', labels: ['J1', 'L1', 'L2'] };
  const cushion = { file: 'Sofa.pdf', title: 'Seat cushion', labels: ['A', 'B', 'C', 'D'] };

  it('needs nothing when every letter lands on one field of one model', () => {
    expect(mappingNeedsReview([frame, back, cushion], [['0:0'], ['0:0'], ['0:1']], models)).toEqual(
      []
    );
  });

  it('accepts D1 for D and bare letters for numbered fields, as the mapping does', () => {
    const group = { ...frame, labels: ['A2', 'A3', 'C', 'D1', 'F', 'G1', 'G2', 'H1', 'H2', 'H3'] };
    expect(mappingNeedsReview([group], [['0:0']], models)).toEqual([]);
    expect(
      autoMapping(
        ['D1', 'C', 'Z'],
        models.filter(m => m.key === '0:0')
      )
    ).toEqual({
      D1: 'D',
      C: 'C',
      Z: '',
    });
  });

  it('asks when a diagram matched no model', () => {
    const reasons = mappingNeedsReview([cushion], [[]], models);
    expect(reasons).toEqual(['Sofa.pdf (Seat cushion): no form model matched']);
  });

  it('asks when a diagram could fill more than one model', () => {
    expect(mappingNeedsReview([cushion], [['0:0', '0:1']], models)).toEqual([
      'Sofa.pdf (Seat cushion): could fill 2 models',
    ]);
  });

  it('asks when a letter has no field on the chosen model', () => {
    const group = { ...frame, labels: [...frame.labels, 'Q', 'M4'] };
    expect(mappingNeedsReview([group], [['0:0']], models)).toEqual([
      'Sofa.pdf (Front and Side): no field for Q, M4',
    ]);
  });

  it('asks when two diagrams write the same field on the same model', () => {
    const second = { file: 'Other.pdf', title: 'Front', labels: ['A2', 'C'] };
    const reasons = mappingNeedsReview([frame, second], [['0:0'], ['0:0']], models);
    expect(reasons).toEqual([
      'CS3X-NA · Frame A2: filled by both Sofa.pdf (Front and Side) and Other.pdf (Front)',
      'CS3X-NA · Frame C: filled by both Sofa.pdf (Front and Side) and Other.pdf (Front)',
    ]);
  });

  it('asks when the PDF did not state its unit', () => {
    expect(mappingNeedsReview([{ ...back, unitAssumed: true }], [['0:0']], models)).toEqual([
      'Sofa.pdf (Back): unit not stated in the PDF',
    ]);
  });

  it('works end to end with refineTargets on a clean customer PDF', () => {
    const labels = Object.fromEntries(models.map(m => [m.key, m.title]));
    const groups = [frame, back, cushion];
    const picks = refineTargets(groups, models, labels);
    expect(picks).toEqual([['0:0'], ['0:0'], ['0:1']]);
    expect(mappingNeedsReview(groups, picks, models)).toEqual([]);
  });
});

describe('letter links', () => {
  // Leigh's #125964: her own letters on the photos, the form's letters on the frame.
  const lines: MeasuredLine[] = [
    { viewId: 'side', scope: 'side', label: 'H1', value: '5.13' },
    { viewId: 'side', scope: 'side::tab:t1', label: 'H1', value: '5.13' },
    { viewId: 'side', scope: 'side', label: 'A3', value: '24.75' },
    { viewId: 'back', scope: 'back', label: 'J1', value: '30' },
    { viewId: 'cw-back-diagram', scope: 'cw-back-diagram', label: 'H1', value: '11.5' },
    { viewId: 'front', scope: 'front', label: 'A1', value: '' },
  ];
  const backKey = '0:0:1';
  const sameLabelViews = ['back', 'cw-back-diagram'];

  it('follows same-label lines on the model views when nothing is linked', () => {
    const result = resolveLineForLetter(backKey, 'H1', {}, lines, sameLabelViews);
    expect(result.linked).toBe(false);
    expect(result.lines.map(l => l.scope)).toEqual(['cw-back-diagram']);
    expect(
      resolveLineForLetter(backKey, 'J1', undefined, lines, sameLabelViews).lines
    ).toHaveLength(1);
    expect(resolveLineForLetter(backKey, 'L1', null, lines, sameLabelViews).lines).toEqual([]);
  });

  it('follows the linked line, whatever its label, on every tab of its view', () => {
    const links = { [lineLinkKey(backKey, 'L1')]: { viewId: 'side', label: 'H1' } };
    const result = resolveLineForLetter(backKey, 'L1', links, lines, sameLabelViews);
    expect(result.linked).toBe(true);
    expect(result.link).toEqual({ viewId: 'side', label: 'H1' });
    expect(result.lines.map(l => l.scope)).toEqual(['side', 'side::tab:t1']);
    // The link replaces the same-label rule even when a same-label line exists.
    const h1 = resolveLineForLetter(
      backKey,
      'H1',
      { [lineLinkKey(backKey, 'H1')]: { viewId: 'side', label: 'A3' } },
      lines,
      sameLabelViews
    );
    expect(h1.lines.map(l => l.value)).toEqual(['24.75']);
    // A linked line that was deleted gives no lines but stays linked.
    const gone = resolveLineForLetter(
      backKey,
      'H2',
      { [lineLinkKey(backKey, 'H2')]: { viewId: 'under', label: 'K1' } },
      lines,
      sameLabelViews
    );
    expect(gone).toMatchObject({ linked: true, lines: [] });
  });

  it('suggests same-label lines on linked photos, with both values, never from the diagram', () => {
    const models = [
      { key: backKey, fields: ['H1', 'L1'] },
      { key: '0:0:0', fields: ['A1', 'A3'] },
    ];
    const bindings = { side: backKey, 'cw-back-diagram': backKey, front: '0:0:0' };
    const values = { [backKey]: { H1: '11.5' } };
    const suggestions = suggestLineLinks(
      models,
      lines,
      bindings,
      values,
      {},
      {
        [backKey]: 'cw-back-diagram',
      }
    );
    expect(suggestions).toEqual([
      { key: backKey, letter: 'H1', viewId: 'side', label: 'H1', value: '5.13', formValue: '11.5' },
      { key: '0:0:0', letter: 'A1', viewId: 'front', label: 'A1', value: '', formValue: '' },
    ]);
    // Letters already linked are not offered again.
    expect(
      suggestLineLinks(models, lines, bindings, values, {
        [lineLinkKey(backKey, 'H1')]: { viewId: 'side', label: 'H1' },
      })
    ).toEqual([
      { key: '0:0:0', letter: 'A1', viewId: 'front', label: 'A1', value: '', formValue: '' },
    ]);
    expect(suggestLineLinks(models, lines, {}, values, {})).toEqual([]);
  });
});
