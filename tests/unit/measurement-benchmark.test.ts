import { expect, it } from 'vitest';
import { measurementPlacementSchema } from '../../src/modules/measurement-assistant/placement-model';
import { scoreMeasurementPlacement } from '../../src/modules/measurement-assistant/measurement-benchmark';
import { assistantPlacement } from '../helpers/assistant-placement';

it('scores endpoints independent of drawing direction and reports missing and unnecessary labels', () => {
  const p = measurementPlacementSchema.parse(assistantPlacement('photo'));
  p.measurements[0].label = 'A1';
  p.measurements[1].label = 'G3';
  const result = scoreMeasurementPlacement(p, [
    {
      view: 'front',
      label: 'A1',
      points: [
        { x: 0.8, y: 0.3 },
        { x: 0.2, y: 0.3 },
      ],
    },
    {
      view: 'front',
      label: 'B2',
      points: [
        { x: 0.8, y: 0.3 },
        { x: 0.8, y: 0.8 },
      ],
    },
  ]);
  expect(result.rows[0].maxEndpointError).toBe(0);
  expect(result.missing).toBe(1);
  expect(result.unexpected).toEqual([{ view: 'front', label: 'G3' }]);
});

it('does not silently match duplicate labels to arbitrary components', () => {
  const result = scoreMeasurementPlacement(
    measurementPlacementSchema.parse(assistantPlacement('photo')),
    [
      {
        view: 'front',
        label: 'A',
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.8, y: 0.3 },
        ],
      },
    ]
  );
  expect(result.rows[0].status).toBe('ambiguous');
});
