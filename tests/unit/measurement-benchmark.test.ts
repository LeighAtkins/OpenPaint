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

function oneLine() {
  const plan = measurementPlacementSchema.parse(assistantPlacement('photo'));
  plan.measurements = [plan.measurements[0]];
  plan.measurements[0].label = 'A1';
  return plan;
}

it('detects a bowed line even when both endpoints exactly match', () => {
  const plan = oneLine();
  plan.measurements[0].path = {
    kind: 'surface-path',
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.5, y: 0.9 },
      { x: 0.8, y: 0.3 },
    ],
  };
  const result = scoreMeasurementPlacement(plan, [
    {
      view: 'front',
      label: 'A1',
      pathKind: 'span',
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.3 },
      ],
    },
  ]);
  expect(result.rows[0].maxEndpointError).toBe(0);
  expect(result.rows[0].maxPathDeviation).toBeCloseTo(0.6);
  expect(result.rows[0].pathTypeMismatch).toBe(true);
  expect(result.rows[0].maxPathDeviationUpperBound).toBeGreaterThanOrEqual(0.6);
});

it('does not swap two photos merely because they share the front view and labels', () => {
  const plan = oneLine();
  plan.images.push({ id: 'other-photo', view: 'front' });
  for (const feature of plan.features)
    feature.observations.push({ ...feature.observations[0], imageId: 'other-photo' });
  plan.measurements.push({ ...plan.measurements[0], id: 'other-width', imageId: 'other-photo' });
  const result = scoreMeasurementPlacement(plan, [
    {
      view: 'front',
      imageId: 'photo',
      label: 'A1',
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.3 },
      ],
    },
  ]);
  expect(result.rows[0].status).toBe('matched');
  expect(result.unexpected).toEqual([]);
  expect(result.unscoredImages).toEqual(['other-photo']);
});

it('uses component identity for repeated labels on different cushions', () => {
  const plan = oneLine();
  plan.components.push({ id: 'second', name: 'Second cushion' });
  const more = plan.features.map(f => ({ ...f, id: 'second-' + f.id, componentId: 'second' }));
  plan.features.push(...more);
  plan.measurements.push({
    ...plan.measurements[0],
    id: 'second-width',
    componentId: 'second',
    startFeatureId: 'second-left',
    endFeatureId: 'second-right',
  });
  const refs = ['frame', 'second'].map(componentId => ({
    view: 'front' as const,
    imageId: 'photo',
    componentId,
    label: 'A1',
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.3 },
    ],
  }));
  expect(scoreMeasurementPlacement(plan, refs).rows.map(r => r.status)).toEqual([
    'matched',
    'matched',
  ]);
});

it('refuses source-hash and dimension mismatches instead of returning favourable scores', () => {
  const frame = { sha256: 'a'.repeat(64), width: 1000, height: 2000 };
  const reference = [
    {
      view: 'front' as const,
      imageId: 'photo',
      label: 'A1',
      frame,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.3 },
      ],
    },
  ];
  for (const actual of [
    { ...frame, sha256: 'b'.repeat(64) },
    { ...frame, height: 1000 },
  ]) {
    const result = scoreMeasurementPlacement(oneLine(), reference, { photo: actual });
    expect(result.rows[0].status).toBe('framing-mismatch');
    expect(result.rows[0].maxEndpointError).toBeUndefined();
  }
  expect(scoreMeasurementPlacement(oneLine(), reference).rows[0].status).toBe('unverified-framing');
});

it('reports aspect-aware pixel errors only when the photo frame is bound', () => {
  const frame = { sha256: 'a'.repeat(64), width: 1000, height: 2000 };
  const result = scoreMeasurementPlacement(
    oneLine(),
    [
      {
        view: 'front',
        imageId: 'photo',
        label: 'A1',
        frame,
        pathKind: 'span',
        points: [
          { x: 0.2, y: 0.31 },
          { x: 0.8, y: 0.31 },
        ],
      },
    ],
    { photo: frame }
  );
  expect(result.rows[0].maxEndpointErrorPixels).toBeCloseTo(20);
  expect(result.rows[0].maxPathDeviationPixels).toBeCloseTo(20);
  expect(result.rows[0].framingVerified).toBe(true);
  expect(result.claimsPhysicalAccuracy).toBe(false);
});

it('preserves explicit two-point surface-path semantics and drawing direction', () => {
  const plan = oneLine();
  plan.measurements[0].path = {
    kind: 'surface-path',
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.3 },
    ],
  };
  const result = scoreMeasurementPlacement(plan, [
    {
      view: 'front',
      label: 'A1',
      pathKind: 'surface-path',
      points: [
        { x: 0.8, y: 0.3 },
        { x: 0.2, y: 0.3 },
      ],
    },
  ]);
  expect(result.rows[0].pathTypeMismatch).toBe(false);
  expect(result.rows[0].maxPathDeviation).toBeCloseTo(0, 12);
  expect(result.rows[0].framingVerified).toBe(false);
});

it('chooses pixel endpoint correspondence in pixel space on anisotropic photos', () => {
  const plan = oneLine();
  plan.features.find(f => f.id === 'left')!.observations[0].point = { x: 0.1, y: 0.1 };
  plan.features.find(f => f.id === 'right')!.observations[0].point = { x: 0.6, y: 0.6 };
  const frame = { sha256: 'a'.repeat(64), width: 100, height: 1000 };
  const result = scoreMeasurementPlacement(
    plan,
    [
      {
        view: 'front',
        imageId: 'photo',
        label: 'A1',
        frame,
        points: [
          { x: 0.2, y: 0.8 },
          { x: 0.7, y: 0.3 },
        ],
      },
    ],
    { photo: frame }
  );
  expect(result.rows[0].maxEndpointErrorPixels).toBeCloseTo(Math.hypot(60, 200));
});

it('does not score invalid, degenerate or off-image reference geometry', () => {
  for (const points of [
    [
      { x: NaN, y: 0.3 },
      { x: 0.8, y: 0.3 },
    ],
    [
      { x: -0.1, y: 0.3 },
      { x: 0.8, y: 0.3 },
    ],
    [
      { x: 0.2, y: 0.3 },
      { x: 0.2, y: 0.3 },
    ],
  ])
    expect(
      scoreMeasurementPlacement(oneLine(), [{ view: 'front', label: 'A1', points }]).rows[0].status
    ).toBe('invalid-reference');
});
