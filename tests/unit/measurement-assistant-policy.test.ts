import { describe, expect, it } from 'vitest';
import {
  decideObjectCategory,
  rankMeasurementGuides,
} from '../../src/modules/measurement-assistant/decision-policy';
import { measurementPlacementSchema } from '../../src/modules/measurement-assistant/placement-model';
import { buildPlacementOverlayElements } from '../../src/modules/measurement-assistant/overlay-elements';

const fixture = () => ({
  images: [
    { id: 'front', view: 'front' },
    { id: 'side', view: 'side' },
  ],
  components: [{ id: 'frame', name: 'Sofa frame' }],
  features: [
    {
      id: 'join-left',
      componentId: 'frame',
      name: 'Left piping corner',
      kind: 'piping-corner',
      observations: [
        {
          imageId: 'front',
          point: { x: 0.2, y: 0.6 },
          confidence: 0.9,
          evidence: 'Visible piping joins seat-front panel.',
        },
      ],
    },
    {
      id: 'join-right',
      componentId: 'frame',
      name: 'Right piping corner',
      kind: 'piping-corner',
      observations: [
        {
          imageId: 'front',
          point: { x: 0.8, y: 0.6 },
          confidence: 0.9,
          evidence: 'Visible piping joins seat-front panel.',
        },
        {
          imageId: 'side',
          point: { x: 0.3, y: 0.7 },
          confidence: 0.8,
          evidence: 'Same front corner seen from right side.',
        },
      ],
    },
    {
      id: 'join-back',
      componentId: 'frame',
      name: 'Rear side seam intersection',
      kind: 'seam-intersection',
      observations: [
        {
          imageId: 'side',
          point: { x: 0.9, y: 0.7 },
          confidence: 0.8,
          evidence: 'Side piping meets rear vertical seam.',
        },
      ],
    },
  ],
  surfaces: [
    {
      id: 'front-panel',
      componentId: 'frame',
      name: 'Front seat panel',
      status: 'covered',
      reason: 'Visible seam span drawn.',
    },
    {
      id: 'side-panel',
      componentId: 'frame',
      name: 'Right side panel',
      status: 'partial',
      reason: 'Top contour visible; lower boundary is hidden.',
    },
    {
      id: 'back-panel',
      componentId: 'frame',
      name: 'Rear panel',
      status: 'unseen',
      reason: 'No rear photo.',
      requestedView: 'back',
    },
  ],
  measurements: [
    {
      id: 'front-width',
      label: 'A',
      componentId: 'frame',
      surfaceIds: ['front-panel'],
      imageId: 'front',
      startFeatureId: 'join-left',
      endFeatureId: 'join-right',
      path: { kind: 'span' },
      source: { kind: 'guide', guideId: 'sofa-square', guideVersion: '1', roleId: 'A' },
    },
    {
      id: 'side-contour',
      label: 'B',
      componentId: 'frame',
      surfaceIds: ['side-panel'],
      imageId: 'side',
      startFeatureId: 'join-right',
      endFeatureId: 'join-back',
      path: {
        kind: 'surface-path',
        points: [
          { x: 0.3, y: 0.7 },
          { x: 0.6, y: 0.65 },
          { x: 0.9, y: 0.7 },
        ],
      },
      source: {
        kind: 'freestyle',
        rationale: 'Guide has a straight side; this sofa has a curved piping contour.',
      },
    },
  ],
});

describe('measurement assistant decisions', () => {
  it.each(['present', 'absent', 'unknown'] as const)(
    'uses the sofa frame, not loose cushions (%s)',
    looseCushions => {
      expect(
        decideObjectCategory({
          target: 'whole-furniture',
          furnitureKind: 'seating',
          seatingCapacity: 3,
          looseCushions,
        }).category
      ).toBe('sofa');
    }
  );
  it('recognizes an individual cushion separately from furniture', () => {
    expect(decideObjectCategory({ target: 'individual-cushion' }).category).toBe('cushion');
  });
  it('identifies sectionals before counting seats', () => {
    expect(
      decideObjectCategory({
        target: 'whole-furniture',
        furnitureKind: 'seating',
        seatingCapacity: 1,
        layout: 'corner-module',
      }).category
    ).toBe('sectional');
    expect(
      decideObjectCategory({
        target: 'whole-furniture',
        furnitureKind: 'seating',
        seatingCapacity: 1,
      }).category
    ).toBe('armchair');
  });
  it('leaves an unsupported classification unresolved', () => {
    expect(
      decideObjectCategory({ target: 'whole-furniture', looseCushions: 'absent' }).category
    ).toBe('unknown');
  });
  it('filters guide category and view before comparing construction', () => {
    const ranked = rankMeasurementGuides(
      {
        target: 'whole-furniture',
        furnitureKind: 'seating',
        seatingCapacity: 3,
        armShape: 'square',
      },
      'front',
      [
        { id: 'wrong-category', category: 'cushion', view: 'front', armShape: 'square' },
        { id: 'wrong-view', category: 'sofa', view: 'side', armShape: 'square' },
        { id: 'rounded', category: 'sofa', view: 'front', armShape: 'round' },
        { id: 'square', category: 'sofa', view: 'front', armShape: 'square' },
      ]
    );
    expect(ranked.guides.map(item => item.guide.id)).toEqual(['square', 'rounded']);
    expect(ranked.guides[1].differences).toEqual(['armShape']);
  });
});

describe('connected seam placement', () => {
  it('accepts shared physical joins across front and side photos and freestyle paths', () => {
    const plan = measurementPlacementSchema.parse(fixture());
    expect(plan.measurements[0].endFeatureId).toBe(plan.measurements[1].startFeatureId);
  });
  it('rejects drawing an endpoint without evidence in that photograph', () => {
    const plan = fixture();
    plan.features[1].observations = plan.features[1].observations.slice(0, 1);
    expect(measurementPlacementSchema.safeParse(plan).success).toBe(false);
  });
  it('rejects paths that stop short of their physical seam endpoint', () => {
    const plan = fixture();
    plan.measurements[1].path.points![2].x = 0.85;
    expect(measurementPlacementSchema.safeParse(plan).success).toBe(false);
  });
  it('rejects a drawing assigned to an unseen surface', () => {
    const plan = fixture();
    plan.measurements[0].surfaceIds = ['back-panel'];
    expect(measurementPlacementSchema.safeParse(plan).success).toBe(false);
  });
  it('rejects duplicate feature identities and out-of-image points', () => {
    const plan = fixture();
    plan.features.push(plan.features[0]);
    expect(measurementPlacementSchema.safeParse(plan).success).toBe(false);
    const outside = fixture();
    outside.features[0].observations[0].point.x = 1.1;
    expect(measurementPlacementSchema.safeParse(outside).success).toBe(false);
  });
  it('keeps identical printed labels separate and maps only the requested photo', () => {
    const plan = fixture();
    plan.measurements[1].label = 'A';
    const front = buildPlacementOverlayElements(plan, 'front');
    const side = buildPlacementOverlayElements(plan, 'side');
    expect(front[0].endpoints[1].point).toEqual({ x: 800, y: 600 });
    expect(side[0].endpoints[0].point).toEqual({ x: 300, y: 700 });
    expect(side[0].curvePoints).toHaveLength(3);
    expect(front[0].roleToken).not.toBe(side[0].roleToken);
    expect(front[0].displayLabel).toBe(side[0].displayLabel);
  });
});
