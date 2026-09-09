import products from './benchmark-products.json';
import { createSofaDocument, type SofaDocument } from './model';
export const BENCHMARK_PRODUCTS = products;
export const BENCHMARK_FINDINGS: Record<string, { fit: string; works: string; gaps: string[] }> = {
  karlstad: {
    fit: 'Closest starting point',
    works: 'Two seat and back cushions, narrow square arms and raised base are reproducible.',
    gaps: [
      'The legs remain tapered cylinders instead of square timber blocks.',
      'Separate frame height, cushion height and back lean need direct controls.',
      'Seat crown, front boxing and seam positions are still generic.',
    ],
  },
  ektorp: {
    fit: 'Recognisable, not accurate',
    works: 'Rolled arms, three cushions and floor-length skirt establish the right family.',
    gaps: [
      'Roll radius and upright thickness are fixed ratios; the arm cannot be tuned independently.',
      'The skirt is a solid box: no corner openings, pleats or drape.',
      'End cushions cannot wrap around the arms with T/L-shaped edges.',
    ],
  },
  'pb-basic': {
    fit: 'Too similar to Ektorp',
    works: 'Rolled arms, three tall back cushions and a skirt are representable.',
    gaps: [
      'Arm flare and the scroll profile distinguish this sofa, but have no independent controls.',
      'Pleated skirt panels and piping must be real geometry.',
      'The current primitives lose the visual differences between PB Basic and Ektorp.',
    ],
  },
  harmony: {
    fit: 'Basic proportions only',
    works: 'Two seats, low straight arms and separate accent pillows can be placed.',
    gaps: [
      'The platform uses narrow legs instead of broad recessed timber supports.',
      'Pillows need independent rotation, loft, sag and placement; translation alone is insufficient.',
      'The same boxed cushion cannot reproduce soft feather-filled back pillows.',
    ],
  },
  'cloud-corner': {
    fit: 'Corner topology works; upholstery does not',
    works: 'The new corner module provides one seat enclosed by two perpendicular low backs.',
    gaps: [
      'The public 46.99 cm height appears to be a frame datum; total cushion height is not verified.',
      'Corner back cushions intersect and need mitered or independently shaped edges.',
      'Oversized pillows, lean and soft loft cannot be matched with the current fixed corner arrangement.',
    ],
  },
};
/** A best-effort exercise using existing model parameters, without bespoke product geometry. */
export function createBenchmarkDocument(id: string): SofaDocument {
  const product = products.find(p => p.id === id);
  if (!product) throw new Error('Unknown benchmark product.');
  const doc = createSofaDocument(id === 'cloud-corner' ? 'armchair' : 'sofa');
  doc.title = product.title;
  Object.assign(doc.dimensions, product.dimensions);
  doc.style.back = 'short';
  doc.pillows = 0;
  doc.fabric.colour = '#c9c4b8';
  const choices: Record<
    string,
    {
      armWidth: number;
      armHeight: number;
      seatHeight: number;
      seatThickness: number;
      backThickness: number;
      legHeight: number;
      seatCount: number;
    }
  > = {
    karlstad: {
      armWidth: 12,
      armHeight: 60,
      seatHeight: 45,
      seatThickness: 12,
      backThickness: 16,
      legHeight: 16,
      seatCount: 2,
    },
    ektorp: {
      armWidth: 23,
      armHeight: 63,
      seatHeight: 45,
      seatThickness: 13,
      backThickness: 17,
      legHeight: 4,
      seatCount: 3,
    },
    'pb-basic': {
      armWidth: 23,
      armHeight: 63,
      seatHeight: 48,
      seatThickness: 13,
      backThickness: 18,
      legHeight: 3,
      seatCount: 3,
    },
    harmony: {
      armWidth: 13,
      armHeight: 62,
      seatHeight: 44,
      seatThickness: 13,
      backThickness: 16,
      legHeight: 12,
      seatCount: 2,
    },
    'cloud-corner': {
      armWidth: 15,
      armHeight: 46.99,
      seatHeight: 43,
      seatThickness: 14,
      backThickness: 15,
      legHeight: 1,
      seatCount: 1,
    },
  };
  Object.assign(doc.dimensions, choices[id]);
  if (id === 'ektorp' || id === 'pb-basic') {
    doc.style.arm = 'round';
    doc.style.base = 'long-skirt';
  }
  if (id === 'harmony') {
    doc.pillows = 4;
    for (let i = 0; i < 4; i++)
      doc.overrides[`main:pillow-${i}`] = {
        width: 40,
        height: 38,
        depth: 12,
        offset: { x: 0, y: 0, z: i < 2 ? 12 : 0 },
      };
  }
  if (id === 'cloud-corner') {
    doc.dimensions.height = 80; // Photo estimate for loose cushions; deliberately not relabelled as measured.
    doc.modules = [
      {
        id: 'main',
        width: 114.3,
        depth: 114.3,
        x: 0,
        z: 0,
        rotation: 0,
        leftArm: false,
        rightArm: false,
        back: true,
        seats: 1,
        corner: true,
        cornerSide: 'right',
      },
    ];
    doc.style.cushion = 'rounded';
    doc.pillows = 1;
    doc.overrides['main:pillow-0'] = {
      width: 52,
      height: 52,
      depth: 15,
      offset: { x: 20, y: 1, z: 16 },
    };
  }
  doc.source = {
    kind: 'cw',
    reference: product.reference,
    notes: [
      `Benchmark: ${product.version}. Public overall dimensions: ${product.dimensions.width} × ${product.dimensions.depth} × ${product.dimensions.height} cm.`,
      'Component proportions were estimated visually, not authenticated PID component measurements.',
      ...(id === 'cloud-corner'
        ? [
            'The public height is treated provisionally as a frame datum. Loose-cushion height is estimated at 80 cm.',
          ]
        : []),
    ],
  };
  return doc;
}
