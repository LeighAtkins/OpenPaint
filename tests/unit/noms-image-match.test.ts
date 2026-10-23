import { describe, expect, it } from 'vitest';
import {
  planImageMatches,
  suggestImageMatches,
  type NomsModelEntry,
} from '../../src/modules/ui/noms-link-core';

const model = (
  key: string,
  reference: string,
  modelName: string,
  title: string,
  fields: string[]
): NomsModelEntry => ({
  key,
  reference,
  modelName,
  title,
  fields,
  values: {},
  rules: {},
  enabled: true,
});
// Two loveseats, a corner with a seat and two back cushions, an armless chair.
const models: NomsModelEntry[] = [
  model('0:0:0', 'CS2B-SSA-L', 'CS3B-SSA-SB-L', 'CS2B-SSA-L · Sofa Frame · Front', ['A1', 'D']),
  model('0:0:1', 'CS2B-SSA-L', 'CS3B-SSA-SB-L', 'CS2B-SSA-L · Sofa Frame · Side', ['E1', 'G2']),
  model('0:0:2', 'CS2B-SSA-L', 'CS3B-SSA-SB-L', 'CS2B-SSA-L · Sofa Frame · Back', ['J1', 'L1']),
  model('2:0:0', 'CS1-CNR', 'CS1-CNR', 'CS1-CNR · Frame', ['L1', 'L2']),
  model('2:1:0', 'CS1-CNR', 'CC-ST-BE', 'CS1-CNR · Seat Cushion', ['A', 'B']),
  model('2:2:0', 'CS1-CNR', 'CC-BK-BE', 'CS1-CNR · Back Cushion', ['A', 'B']),
  model('2:3:0', 'CS1-CNR', 'CC-BK-BE', 'CS1-CNR · Back Cushion', ['A', 'B']),
  model('3:0:0', 'CS1X-NA', 'CS1B-NA', 'CS1X-NA · Frame', ['C', 'D']),
  model('3:1:0', 'CS1X-NA', 'CC-ST-BE', 'CS1X-NA · Seat Cushion', ['A', 'B']),
];
const line = (viewId: string, label: string, value: string) => ({
  viewId,
  scope: viewId,
  label,
  value,
});

describe('suggestImageMatches', () => {
  const views = [
    { viewId: 'front', title: 'P1 · Left arm piece (CS3B-SSA-HB-L) · front, cushions off' },
    { viewId: 'side', title: 'P1 · Left arm piece (CS3B-SSA-HB-L) · outside end' },
    { viewId: 'odd', title: 'P1 · Left arm piece (CS3B-SSA-HB-L) · detail' },
    { viewId: 'corner', title: 'P3 · Corner piece (CS1-CNR) · back' },
    { viewId: 'chair', title: 'P2 · Armless piece (CS1X-NA) · front' },
    { viewId: 'seat4', title: 'Seat cushion 4 (purple) · corner seat (CC-ST-BE)' },
    { viewId: 'seat4p', title: 'Seat cushion 4 on P3 · corner seat (CC-ST-BE)' },
    { viewId: 'wedge', title: 'Back cushion 4L · corner wedge (CC-BK-W)' },
    { viewId: 'key', title: 'Seat cushion key' },
  ];
  const byView = Object.fromEntries(suggestImageMatches(models, views).map(m => [m.viewId, m]));

  it('matches frames by code and picks the file from front, side or back in the label', () => {
    expect(byView.front).toMatchObject({ key: '0:0:0', how: 'code' });
    expect(byView.side).toMatchObject({ key: '0:0:1', how: 'code' });
    expect(byView.odd.key).toBe('');
    expect(byView.odd.choices).toEqual(['0:0:0', '0:0:1', '0:0:2']);
    expect(byView.corner).toMatchObject({ key: '2:0:0', how: 'code' });
    expect(byView.chair).toMatchObject({ key: '3:0:0', how: 'code' });
  });

  it('never picks a cushion that is on several pieces, unless the label names a matched piece', () => {
    expect(byView.seat4.key).toBe('');
    expect(byView.seat4.choices).toEqual(['2:1:0', '3:1:0']);
    expect(byView.seat4p).toMatchObject({ key: '2:1:0', how: 'piece' });
    expect(byView.wedge).toMatchObject({ key: '', note: 'CC-BK-W is not on the form' });
    expect(byView.key).toMatchObject({ key: '', note: 'No model code in its label' });
  });

  it('keeps a saved match', () => {
    const [m] = suggestImageMatches(
      models,
      [{ viewId: 'seat4', title: 'Seat cushion 4 (CC-ST-BE)' }],
      { seat4: '3:1:0' }
    );
    expect(m).toMatchObject({ key: '3:1:0', how: 'saved' });
  });
});

describe('planImageMatches', () => {
  it('fills the letters drawn on each image, on any file of its piece, matched file first', () => {
    const plan = planImageMatches(
      models,
      [
        { viewId: 'front', key: '0:0:0' },
        { viewId: 'side', key: '0:0:1' },
        { viewId: 'seat4', key: '2:1:0' },
        { viewId: 'odd', key: '' },
      ],
      [
        line('front', 'A1', '149.86'),
        line('front', 'E1', '35.56'), // the arm, drawn on the front photo
        line('side', 'E1', '34.29'),
        line('side', 'G2', '91.44'),
        line('seat4', 'A', '68.58'),
        line('seat4', 'B', '68.58'),
        line('odd', 'D', '1'),
      ],
      {
        '0:0:1:G2': { viewId: 'elsewhere', label: 'X' },
        '0:0:0:D': { viewId: 'old', label: 'D', by: 'match' },
      }
    );
    expect(plan.byView).toEqual({
      front: { '0:0:0': ['A1'] },
      side: { '0:0:1': ['E1'] },
      seat4: { '2:1:0': ['A', 'B'] },
    });
    expect(plan.conflicts.map(c => `${c.key}:${c.letter}`)).toEqual(['0:0:1:E1']);
    expect(plan.missing).toEqual({ '0:0:0': ['D'] }); // G2 is linked by hand, D was only an old match
    expect(plan.links.find(l => l.letter === 'E1')?.viewId).toBe('side');
  });
});
