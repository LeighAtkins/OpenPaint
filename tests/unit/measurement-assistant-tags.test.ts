import { describe, expect, it } from 'vitest';
import { measurementTagShape } from '../../src/modules/measurement-assistant/tag-presentation';
import { renderPlacementSvg } from '../../src/modules/measurement-assistant/svg-preview';
const placement = (value?: string) => ({
  images: [{ id: 'front', view: 'front' }],
  components: [{ id: 'sofa', name: 'Sofa' }],
  features: [
    {
      id: 'left',
      name: 'Left seam',
      componentId: 'sofa',
      kind: 'panel-boundary',
      observations: [
        {
          imageId: 'front',
          point: { x: 0.1, y: 0.5 },
          evidence: 'Visible left seam',
          confidence: 1,
        },
      ],
    },
    {
      id: 'right',
      name: 'Right seam',
      componentId: 'sofa',
      kind: 'panel-boundary',
      observations: [
        {
          imageId: 'front',
          point: { x: 0.9, y: 0.5 },
          evidence: 'Visible right seam',
          confidence: 1,
        },
      ],
    },
  ],
  surfaces: [
    { id: 'panel', name: 'Front', componentId: 'sofa', status: 'covered', reason: 'Visible front' },
  ],
  measurements: [
    {
      id: 'width',
      label: 'A1',
      value,
      componentId: 'sofa',
      surfaceIds: ['panel'],
      imageId: 'front',
      startFeatureId: 'left',
      endFeatureId: 'right',
      path: { kind: 'span' },
      source: { kind: 'freestyle', rationale: 'Visible seam to seam width' },
    },
  ],
});
describe('shared measurement tag presentation', () => {
  it('uses circle for blanks and square for entered values including zero', () => {
    expect(measurementTagShape(undefined)).toBe('circle');
    expect(measurementTagShape(' ')).toBe('circle');
    expect(measurementTagShape(0)).toBe('square');
    expect(measurementTagShape('125')).toBe('square');
  });
  it('renders real white tags with visible connectors without changing line endpoints', () => {
    const empty = renderPlacementSvg(placement(), 'front', { width: 1000, height: 750 });
    expect(empty).toContain('data-tag-shape="circle"');
    expect(empty).toContain('data-tag-connector="width"');
    expect(empty).toContain('fill="white"');
    expect(empty).toContain('x1="100" y1="375" x2="900" y2="375"');
    const filled = renderPlacementSvg(placement('125 cm'), 'front', { width: 1000, height: 750 });
    expect(filled).toContain('data-tag-shape="square"');
    expect(filled).toContain('A1 = 125 cm');
  });
});
