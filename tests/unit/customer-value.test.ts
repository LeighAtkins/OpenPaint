import { describe, expect, it } from 'vitest';
import {
  RANGE_DEFAULT,
  formatCustomerNumber,
  parseCustomerValue,
  rangeNote,
  rangeOptions,
  rangeText,
  rangeValue,
} from '../../src/modules/utils/customer-value';

describe('parseCustomerValue', () => {
  it('keeps both numbers when the customer wrote a range', () => {
    expect(parseCustomerValue('approx 24.5 - 25"')).toMatchObject({
      kind: 'range',
      values: [24.5, 25],
      unit: 'in',
      note: '',
    });
    expect(parseCustomerValue('approx 21.5- 21.75"')).toMatchObject({
      kind: 'range',
      values: [21.5, 21.75],
      unit: 'in',
    });
    expect(parseCustomerValue('16.25-16.5')).toMatchObject({
      kind: 'range',
      values: [16.25, 16.5],
      unit: null,
    });
    expect(parseCustomerValue('5-5.25"')).toMatchObject({
      kind: 'range',
      values: [5, 5.25],
      unit: 'in',
    });
    expect(parseCustomerValue('24.5 to 25')).toMatchObject({ kind: 'range', values: [24.5, 25] });
    expect(parseCustomerValue('24.5 or 25')).toMatchObject({ kind: 'range', values: [24.5, 25] });
    expect(parseCustomerValue('24.5 / 25')).toMatchObject({ kind: 'range', values: [24.5, 25] });
    expect(parseCustomerValue('24.5 – 25 cm')).toMatchObject({
      kind: 'range',
      values: [24.5, 25],
      unit: 'cm',
    });
    expect(parseCustomerValue('about 25" to 24.5"').values).toEqual([24.5, 25]);
  });

  it('reads fractions, decimals and units as one number', () => {
    expect(parseCustomerValue('2 7/8"')).toMatchObject({
      kind: 'single',
      values: [2.875],
      unit: 'in',
    });
    expect(parseCustomerValue('2-7/8')).toMatchObject({
      kind: 'single',
      values: [2.875],
      unit: null,
    });
    expect(parseCustomerValue('2⅞')).toMatchObject({ kind: 'single', values: [2.875] });
    expect(parseCustomerValue('22-1/4"')).toMatchObject({
      kind: 'single',
      values: [22.25],
      unit: 'in',
    });
    expect(parseCustomerValue('36 3/4”')).toMatchObject({
      kind: 'single',
      values: [36.75],
      unit: 'in',
    });
    expect(parseCustomerValue('104.78')).toMatchObject({
      kind: 'single',
      values: [104.78],
      unit: null,
    });
    expect(parseCustomerValue('48,9')).toMatchObject({ kind: 'single', values: [48.9] });
    expect(parseCustomerValue('33,5 cm')).toMatchObject({
      kind: 'single',
      values: [33.5],
      unit: 'cm',
    });
    expect(parseCustomerValue('38 in')).toMatchObject({ kind: 'single', values: [38], unit: 'in' });
    expect(parseCustomerValue('38 inches')).toMatchObject({
      kind: 'single',
      values: [38],
      unit: 'in',
    });
    expect(parseCustomerValue('71"')).toMatchObject({ kind: 'single', values: [71], unit: 'in' });
    expect(parseCustomerValue("45'")).toMatchObject({ kind: 'single', values: [45], unit: 'in' });
    expect(parseCustomerValue('~ 30 cm')).toMatchObject({
      kind: 'single',
      values: [30],
      unit: 'cm',
    });
    expect(parseCustomerValue('roughly 30')).toMatchObject({ kind: 'single', values: [30] });
    expect(parseCustomerValue('ca. 30')).toMatchObject({ kind: 'single', values: [30] });
  });

  it('keeps trailing words as the note', () => {
    expect(parseCustomerValue('7" see photos')).toMatchObject({
      kind: 'single',
      values: [7],
      unit: 'in',
      note: 'see photos',
    });
    expect(parseCustomerValue('14”  (13” to floor)')).toMatchObject({
      kind: 'single',
      values: [14],
      note: '(13" to floor)',
      text: '14" (13" to floor)',
    });
    expect(parseCustomerValue('27" to floor').note).toBe('to floor');
    expect(parseCustomerValue('approx 24.5 - 25" tight').note).toBe('tight');
  });

  it('gives none for text and a lone fraction', () => {
    expect(parseCustomerValue('1/2')).toMatchObject({ kind: 'none', values: [] });
    expect(parseCustomerValue('n/a')).toMatchObject({ kind: 'none', note: 'n/a' });
    expect(parseCustomerValue('see photos')).toMatchObject({ kind: 'none', note: 'see photos' });
    expect(parseCustomerValue('')).toMatchObject({ kind: 'none', note: '' });
    expect(parseCustomerValue(null)).toMatchObject({ kind: 'none' });
    expect(parseCustomerValue('0')).toMatchObject({ kind: 'none' });
  });

  it('offers lower, upper and mid for a range with the upper end as default', () => {
    const range = parseCustomerValue('approx 24.5 - 25"');
    expect(RANGE_DEFAULT).toBe('upper');
    expect(rangeOptions(range)).toEqual([
      { choice: 'lower', value: 24.5 },
      { choice: 'upper', value: 25 },
      { choice: 'mid', value: 24.75 },
    ]);
    expect(rangeValue(range)).toBe(25);
    expect(rangeValue(range, 'lower')).toBe(24.5);
    expect(rangeValue(range, 'mid')).toBe(24.75);
    expect(rangeText(range)).toBe('24.5 to 25');
    expect(rangeNote(range)).toBe('customer wrote approx 24.5 - 25"');
    expect(rangeOptions(parseCustomerValue('25'))).toEqual([]);
    expect(formatCustomerNumber(24.75)).toBe('24.75');
    expect(formatCustomerNumber(25)).toBe('25');
  });
});
