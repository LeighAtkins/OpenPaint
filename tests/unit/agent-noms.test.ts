import { describe, expect, it } from 'vitest';
import snapshot from '../fixtures/noms-snapshot-126383.json';
import { formatValue } from '../../src/modules/agent/agent-card';
import type { AgentView } from '../../src/modules/agent/agent-geometry';
import {
  autoMapView,
  compareWithNoms,
  type NomsSnapshot,
} from '../../src/modules/agent/agent-noms';

const nom = snapshot as NomsSnapshot;
const line = (label: string, inch: number | null) =>
  ({ label, inch, cm: inch === null ? null : inch * 2.54 }) as any;
const view = (viewId: string, title: string, lines: any[]): AgentView => ({
  viewId,
  title,
  imageWidth: 100,
  imageHeight: 100,
  lines: lines.map(l => ({ viewId, ...l })),
});

describe('agent NOMS comparison', () => {
  it('maps frame views by order reference and cushion views by model and label', () => {
    expect(autoMapView('Right-arm section (CS2B-SRA-R) · front', nom.products)?.row.rowId).toBe(
      '8123'
    );
    expect(autoMapView('Back cushion size 2 (CC-BK-BE) · square', nom.products)?.row.rowId).toBe(
      '15085'
    );
    expect(
      autoMapView('Seat cushions (CC-ST-BE) · all 5 the same size', nom.products)?.row.rowId
    ).toBe('15083');
    // Two back cushion rows and no size in the title: no guess.
    expect(autoMapView('Back cushion (CC-BK-BE)', nom.products)).toBeNull();
  });

  it('compares per NOMS row across all of its views', () => {
    const views = [
      view('front', 'Right-arm section (CS2B-SRA-R) · front', [
        line('B2', 37), // 94.0 cm, matches
        line('C3', 14), // 35.6 cm vs 57.2
        line('A1', 61.5), // not in NOMS
      ]),
      view('back', 'Right-arm section (CS2B-SRA-R) · back', [line('L2', 68)]), // 172.7, matches
      view('side', 'Right-arm section (CS2B-SRA-R) · outside', [line('B2', 38)]), // disagrees with front
      view('mystery', 'Back cushion (CC-BK-BE)', [line('A', 36)]),
    ];
    const result = compareWithNoms(views, nom);
    expect(result.mapping.front).toMatchObject({
      rowId: '8123',
      reference: 'CS2B-SRA-R',
      how: 'auto',
    });
    expect(result.differences.map(d => [d.label, d.status, d.diffCm])).toEqual([
      ['A1', 'missing_in_noms', null],
      ['B2', 'sofapaint_disagrees', null],
      ['C3', 'differs', -21.6],
      ['C4', 'missing_in_sofapaint', null],
    ]);
    expect(result.differences[1].sofapaintValues).toEqual({ front: 94, side: 96.5 });
    expect(result.summary.match).toBe(1);
    expect(result.unmappedViews).toEqual(['mystery']);
  });

  it('uses a given mapping for views it cannot place', () => {
    const result = compareWithNoms(
      [view('back-2', 'Back cushion (CC-BK-BE)', [line('A', 36), line('D', 5)])],
      nom,
      { 'back-2': '15084' }
    );
    expect(result.mapping['back-2'].how).toBe('given');
    expect(result.differences).toEqual([]);
  });
});

describe('agent card units', () => {
  it('prints inches with cm, cm only, or inches only', () => {
    expect(formatValue(37)).toBe('37" (94.0 cm)');
    expect(formatValue(37, 'cm')).toBe('94.0 cm');
    expect(formatValue(5.25, 'in')).toBe('5¼"');
  });
});
