export function assistantPlacement(imageId: string, view: 'front' | 'side' = 'front') {
  return {
    images: [{ id: imageId, view }],
    components: [{ id: 'frame', name: 'Sofa frame' }],
    features: [
      {
        id: 'left',
        componentId: 'frame',
        name: 'Left seam intersection',
        kind: 'seam-intersection',
        observations: [
          { imageId, point: { x: 0.2, y: 0.3 }, evidence: 'Visible panel join', confidence: 0.9 },
        ],
      },
      {
        id: 'right',
        componentId: 'frame',
        name: 'Right piping corner',
        kind: 'piping-corner',
        observations: [
          {
            imageId,
            point: { x: 0.8, y: 0.3 },
            evidence: 'Visible piping corner',
            confidence: 0.9,
          },
        ],
      },
      {
        id: 'lower',
        componentId: 'frame',
        name: 'Lower seam corner',
        kind: 'seam-intersection',
        observations: [
          {
            imageId,
            point: { x: 0.8, y: 0.8 },
            evidence: 'Visible lower panel join',
            confidence: 0.9,
          },
        ],
      },
    ],
    surfaces: [
      {
        id: 'front',
        componentId: 'frame',
        name: 'Front panel',
        status: 'partial',
        reason: 'Upper and side panel edges are visible; rear is unseen.',
      },
    ],
    measurements: [
      {
        id: 'width',
        label: 'A',
        componentId: 'frame',
        surfaceIds: ['front'],
        imageId,
        startFeatureId: 'left',
        endFeatureId: 'right',
        path: { kind: 'span' },
        source: { kind: 'freestyle', rationale: 'Visible panel width between seam joins.' },
      },
      {
        id: 'contour',
        label: 'A',
        componentId: 'frame',
        surfaceIds: ['front'],
        imageId,
        startFeatureId: 'right',
        endFeatureId: 'lower',
        path: {
          kind: 'surface-path',
          points: [
            { x: 0.8, y: 0.3 },
            { x: 0.85, y: 0.55 },
            { x: 0.8, y: 0.8 },
          ],
        },
        source: { kind: 'freestyle', rationale: 'Side piping follows a bent panel edge.' },
      },
    ],
  };
}
