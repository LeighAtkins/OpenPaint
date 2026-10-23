import { describe, expect, it } from 'vitest';
import { strokesMissingFromCanvas } from '../../src/modules/stroke-recovery';

const rec = (label: string) => ({ type: 'group', strokeMetadata: { strokeLabel: label } });

describe('strokesMissingFromCanvas', () => {
  it('returns saved strokes of the view that have no object on the canvas', () => {
    const scoped = {
      front: { A1: rec('A1'), A2: rec('A2') },
      'front::tab:tab-1': { F1: rec('F1') },
      side: { G1: rec('G1') },
    };
    const canvas = [{ strokeMetadata: { imageLabel: 'front::tab:tab-1', strokeLabel: 'F1' } }];
    const missing = strokesMissingFromCanvas(scoped, canvas, 'front');
    expect(missing.map(m => `${m.scope}|${m.label}`)).toEqual(['front|A1', 'front|A2']);
  });

  it('treats an object without an image label as the base view', () => {
    const scoped = { front: { A1: rec('A1') } };
    const canvas = [{ strokeMetadata: { strokeLabel: 'A1' } }];
    expect(strokesMissingFromCanvas(scoped, canvas, 'front')).toEqual([]);
  });

  it('skips live fabric objects and records without a type', () => {
    const live = { type: 'group', toObject: () => ({}) };
    const scoped = { front: { A1: live, B1: { strokeLabel: 'B1' }, C1: rec('C1') } };
    const missing = strokesMissingFromCanvas(scoped, [], 'front');
    expect(missing.map(m => m.label)).toEqual(['C1']);
  });

  it('copes with empty metadata', () => {
    expect(strokesMissingFromCanvas(undefined, [], 'front')).toEqual([]);
    expect(strokesMissingFromCanvas({ front: undefined }, [], 'front')).toEqual([]);
  });
});
