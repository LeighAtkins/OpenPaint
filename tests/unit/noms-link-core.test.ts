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
