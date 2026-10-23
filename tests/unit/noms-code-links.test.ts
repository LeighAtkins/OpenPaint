import { describe, expect, it } from 'vitest';
import {
  codeLinksForProject,
  codesInTitle,
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

// Shawn's form: two loveseats, a corner and an armless chair, as NOMS made it.
const models: NomsModelEntry[] = [
  model('0:0:0', 'CS2B-SSA-L', 'CS3B-SSA-SB-L', 'CS2B-SSA-L · Sofa Frame · Front', [
    'A1',
    'A2',
    'C1',
    'D',
  ]),
  model('0:0:1', 'CS2B-SSA-L', 'CS3B-SSA-SB-L', 'CS2B-SSA-L · Sofa Frame · Side', [
    'E1',
    'G2',
    'H1',
  ]),
  model('1:0:0', 'CS2B-SSA-R', 'CS3B-SSA-SB-R', 'CS2B-SSA-R · Sofa Frame · Front', ['A1', 'D']),
  model('2:0:0', 'CS1-CNR', 'CS1-CNR', 'CS1-CNR · Frame', ['L1', 'L2']),
  model('2:1:0', 'CS1-CNR', 'CC-ST-BE', 'CS1-CNR · Seat Cushion', ['A', 'B']),
  model('3:0:0', 'CS1X-NA', 'CS1B-NA', 'CS1X-NA · Frame', ['C', 'D']),
  model('3:1:0', 'CS1X-NA', 'CC-ST-BE', 'CS1X-NA · Seat Cushion', ['A', 'B']),
];
const line = (viewId: string, label: string, value: string) => ({
  viewId,
  scope: viewId,
  label,
  value,
});

describe('codeLinksForProject', () => {
  it('reads the codes in an image label', () => {
    expect(codesInTitle('P1 · Left arm piece (CS3B-SSA-HB-L) · front, cushions off')).toEqual([
      'CS3B-SSA-HB-L',
    ]);
    expect(codesInTitle('Seat cushions 2 and 6 · boxed (CC-ST-BE)')).toEqual(['CC-ST-BE']);
    expect(codesInTitle('image-2')).toEqual([]);
  });

  it("links each piece's letters to the lines drawn on its images and leaves the rest out", () => {
    const views = [
      { viewId: 'front', title: 'P1 · Left arm piece (CS3B-SSA-HB-L) · front, cushions off' },
      { viewId: 'side', title: 'P1 · Left arm piece (CS3B-SSA-HB-L) · outside end' },
      { viewId: 'front-1', title: 'P2 · Armless piece (CS1X-NA) · front, cushions off' },
      { viewId: 'back-1', title: 'P3 · Corner piece (CS1-CNR) · back' },
      { viewId: 'front-4', title: 'P5 · Right arm piece (CS3B-SSA-HB-R) · front' },
      { viewId: 'seat', title: 'Seat cushions 2 and 6 (blue) · boxed (CC-ST-BE)' },
      { viewId: 'back-5', title: 'Back cushion 4L · corner wedge (CC-BK-W)' },
      { viewId: 'image', title: 'image' },
    ];
    const lines = [
      line('front', 'A1', '149.86'),
      line('front', 'C1', '17.78'),
      line('front', 'D', '149.86'),
      line('front', 'E1', '35.56'),
      line('side', 'E1', '34.29'),
      line('side', 'G2', '91.44'),
      line('front-1', 'C', '25.4'),
      line('front-1', 'D', '77.47'),
      line('back-1', 'L2', '104.14'),
      line('front-4', 'D', '149.86'),
      line('seat', 'B', '66.04'),
      line('back-5', 'A', '81.28'),
    ];
    const plan = codeLinksForProject(models, views, lines, {});
    const byView = Object.fromEntries(plan.views.map(v => [v.viewId, v]));
    expect(byView.front.target).toBe('0:0');
    expect(byView.front.how).toBe('close');
    expect(byView['front-4'].target).toBe('1:0');
    expect(byView['front-1'].target).toBe('3:0');
    expect(byView['back-1'].target).toBe('2:0');
    expect(byView.seat.target).toBeUndefined();
    expect(byView.seat.why).toMatch(/on 2 pieces/);
    expect(byView['back-5'].why).toMatch(/not on the form/);
    expect(byView.image.why).toMatch(/no model code/);

    const links = Object.fromEntries(
      plan.links.map(l => [`${l.key}:${l.letter}`, `${l.viewId}|${l.value}`])
    );
    expect(links).toEqual({
      '0:0:0:A1': 'front|149.86',
      '0:0:0:C1': 'front|17.78',
      '0:0:0:D': 'front|149.86',
      '0:0:1:E1': 'side|34.29', // the side image wins for the Side file
      '0:0:1:G2': 'side|91.44',
      '1:0:0:D': 'front-4|149.86',
      '2:0:0:L2': 'back-1|104.14',
      '3:0:0:C': 'front-1|25.4',
      '3:0:0:D': 'front-1|77.47',
    });
    expect(plan.conflicts).toEqual([
      {
        key: '0:0:1',
        letter: 'E1',
        values: [
          { viewId: 'side', value: '34.29' },
          { viewId: 'front', value: '35.56' },
        ],
      },
    ]);
    expect(plan.missing.map(m => `${m.key}:${m.letter}`)).toContain('0:0:0:A2');
  });

  it('keeps letters that are already linked', () => {
    const plan = codeLinksForProject(
      models,
      [{ viewId: 'front', title: '(CS3B-SSA-HB-L) front' }],
      [line('front', 'A1', '100'), line('front', 'D', '150')],
      { '0:0:0:A1': { viewId: 'other', label: 'X' } }
    );
    expect(plan.links.map(l => l.letter)).toEqual(['D']);
  });
});
