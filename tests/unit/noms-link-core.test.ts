import { describe, expect, it } from 'vitest';
import {
  changedFields,
  convertMeasure,
  evalRule,
  formModels,
  fromCanvasMeasurement,
  isComfortWorksStaff,
  measureIssues,
  parseMeasure,
  soleModelForReference,
  modelGroups,
  defaultFieldFor,
  suggestTargets,
  pdfValueToForm,
  refineTargets,
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
