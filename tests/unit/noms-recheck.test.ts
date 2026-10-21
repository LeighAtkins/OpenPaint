import { describe, expect, it } from 'vitest';
import {
  allChanged,
  bothUnits,
  changeText,
  flaggedLetters,
  newRecheck,
  openItems,
  prefillFromFlags,
  reasonText,
  recheckLabel,
  recheckListText,
  recheckStates,
  resolveItem,
  resolveRecheck,
  type Recheck,
} from '../../src/modules/ui/noms-recheck-core';
import type { NomsModelEntry } from '../../src/modules/ui/noms-link-core';

const model = (over: Partial<NomsModelEntry> = {}): NomsModelEntry => ({
  key: '0:0:0',
  reference: 'CS5L',
  modelName: 'CS5L',
  title: 'CS5L · Sofa Frame',
  fields: ['A1', 'A3', 'B1', 'C2'],
  values: {},
  rules: {},
  ...over,
});

const recheck = (): Recheck => ({
  ...newRecheck('in', '2026-10-21T08:00:00.000Z'),
  items: [
    { key: '0:0:0', field: 'B1', pick: 'large', value: '29' },
    { key: '0:0:0', field: 'C2', pick: 'factory', detail: 'looks short', value: '30' },
  ],
});

describe('bothUnits and recheckLabel', () => {
  it('shows the form unit first and the other in brackets', () => {
    expect(bothUnits('29', 'in')).toBe('29 in (73.7 cm)');
    expect(bothUnits('73.7', 'cm')).toBe('73.7 cm (29.02 in)');
    expect(bothUnits('29 1/2', 'in')).toBe('29.5 in (74.9 cm)');
    expect(bothUnits('', 'in')).toBe('');
  });
  it('builds the canvas label with the reason as a second line', () => {
    expect(recheckLabel('B1', '29', 'in', 'Too large')).toEqual({
      text: 'B1 = 29 in (73.7 cm)',
      reason: 'Too large',
    });
    expect(recheckLabel('C2', '', 'cm', '').text).toBe('C2 = no value');
  });
});

describe('reasonText', () => {
  it('turns each quick pick into words', () => {
    expect(reasonText({ pick: 'rule', ruleText: 'A3 cannot be smaller than A1' })).toBe(
      'Rule failed: A3 cannot be smaller than A1'
    );
    expect(reasonText({ pick: 'large' })).toBe('Too large');
    expect(reasonText({ pick: 'small', detail: 'check the arm' })).toBe('Too small. check the arm');
    expect(reasonText({ pick: 'mismatch', other: 'A1' })).toBe('Does not match A1');
    expect(reasonText({ pick: 'unclear' })).toBe('Unclear in the photo');
    expect(reasonText({ pick: 'factory', detail: 'B1 looks wrong' })).toBe(
      'Factory asked: B1 looks wrong'
    );
    expect(reasonText({ pick: '', detail: 'free text' })).toBe('free text');
    expect(reasonText({ pick: '' })).toBe('');
  });
});

describe('reason prefill from flags', () => {
  it('prefers a failed rule, then the review flags', () => {
    expect(prefillFromFlags([], 'A3 >= A1')).toEqual({ pick: 'rule', ruleText: 'A3 >= A1' });
    expect(prefillFromFlags([{ kind: 'rule', reason: 'Check A3' }])).toEqual({
      pick: 'rule',
      ruleText: 'Check A3',
    });
    expect(
      prefillFromFlags([
        { kind: 'range', reason: 'Customer wrote a range' },
        { kind: 'unit-assumed', reason: 'Unit assumed' },
      ])
    ).toEqual({ pick: '', detail: 'Customer wrote a range; Unit assumed' });
    expect(prefillFromFlags(undefined)).toBeNull();
  });

  it('lists every flagged letter: failed rules and review flags', () => {
    const m = model({
      rules: {
        A3: [{ eval: 'A3>=A1', message: 'A3 cannot be smaller than A1', behaviour: 'warning' }],
      },
    });
    const flagged = flaggedLetters([m], { '0:0:0': { A1: '30', A3: '20', B1: '29' } }, 'in', {
      '0:0:0|B1': { flags: [{ kind: 'duplicate', reason: 'Two values for B1' }] },
    });
    expect(flagged).toEqual([
      { key: '0:0:0', field: 'A3', pick: 'rule', ruleText: 'A3 cannot be smaller than A1' },
      { key: '0:0:0', field: 'B1', pick: '', detail: 'Two values for B1' },
    ]);
  });
});

describe('recheckListText', () => {
  it('writes one line per letter with both units and the reason', () => {
    const text = recheckListText({
      orderNumber: '123456',
      customerName: 'Jenna',
      unit: 'in',
      items: recheck().items,
      values: { '0:0:0': { B1: '29', C2: '30' } },
    });
    expect(text).toBe(
      [
        'Order #123456 (Jenna): please recheck',
        'B1: 29 in (73.7 cm). Reason: Too large',
        'C2: 30 in (76.2 cm). Reason: Factory asked: looks short',
      ].join('\n')
    );
    expect(text.includes(String.fromCharCode(8212))).toBe(false);
  });
  it('names the model when the recheck spans more than one', () => {
    const text = recheckListText({
      orderNumber: '1',
      unit: 'cm',
      items: [
        { key: 'a', field: 'A1', pick: '', value: '' },
        { key: 'b', field: 'A1', pick: 'unclear', value: '50' },
      ],
      values: { b: { A1: '50' } },
      titles: { a: 'Sofa', b: 'Chaise' },
    });
    expect(text.split('\n').slice(1)).toEqual([
      'A1 (Sofa): no value',
      'A1 (Chaise): 50 cm (19.69 in). Reason: Unclear in the photo',
    ]);
  });
});

describe('resolution when values change', () => {
  it('shows was and now for a changed letter', () => {
    const states = recheckStates(recheck(), { '0:0:0': { B1: '31.5', C2: '30.0' } });
    expect(states.map(s => [s.item.field, s.changed])).toEqual([
      ['B1', true],
      ['C2', false],
    ]);
    expect(changeText(states[0].was, states[0].now)).toBe('was 29, now 31.5');
    expect(changeText('30', '30.0')).toBe('');
    expect(allChanged(recheck(), { '0:0:0': { B1: '31.5', C2: '30' } })).toBe(false);
    expect(allChanged(recheck(), { '0:0:0': { B1: '31.5', C2: '32' } })).toBe(true);
  });

  it('resolves the whole recheck and keeps the values it ended with', () => {
    const done = resolveRecheck(recheck(), { '0:0:0': { B1: '31.5', C2: '30' } }, 'T1');
    expect(done.status).toBe('resolved');
    expect(done.resolvedAt).toBe('T1');
    expect(done.items.map(i => i.resolvedValue)).toEqual(['31.5', '30']);
    // Later edits do not rewrite the history.
    const later = recheckStates(done, { '0:0:0': { B1: '40', C2: '40' } });
    expect(later.map(s => changeText(s.was, s.now))).toEqual(['was 29, now 31.5', '']);
  });

  it('resolves one letter at a time and closes on the last', () => {
    const values = { '0:0:0': { B1: '31.5', C2: '33' } };
    const one = resolveItem(recheck(), '0:0:0', 'B1', values, 'T1');
    expect(one.status).toBe('open');
    expect(openItems(one).map(i => i.field)).toEqual(['C2']);
    const two = resolveItem(one, '0:0:0', 'C2', values, 'T2');
    expect(two.status).toBe('resolved');
    expect(two.resolvedAt).toBe('T2');
    expect(two.items[0].resolvedAt).toBe('T1');
  });
});
