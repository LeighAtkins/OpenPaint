import products from './extended-products.json';
import { createSofaDocument, type SofaDocument, type SofaModule } from './model';
export const EXTENDED_MODELS = products;

/** CW cushion variants for the PB York Slope Arm 95" cover (SKU codes 1S-2B … 3S-3B). */
const YORK_CONFIGS: Record<string, { seats: number; backs: number }> = {
  'pb-york-slope-95-1s2b': { seats: 1, backs: 2 },
  'pb-york-slope-95-1s3b': { seats: 1, backs: 3 },
  'pb-york-slope-95-2s2b': { seats: 2, backs: 2 },
  'pb-york-slope-95-3s3b': { seats: 3, backs: 3 },
};

export function createExtendedModel(id: string): SofaDocument {
  const product = products.find(p => p.id === id);
  if (!product) throw new Error('Unknown sofa model.');
  const doc = createSofaDocument('sofa');
  doc.catalogueModel = id;
  doc.title = product.title;
  Object.assign(doc.dimensions, product.dimensions);
  doc.style.back = 'short';
  doc.pillows = 0;
  const module = (
    id: string,
    width: number,
    depth: number,
    x: number,
    z: number,
    leftArm = false,
    rightArm = false
  ): SofaModule => ({
    id,
    width,
    depth,
    x,
    z,
    leftArm,
    rightArm,
    back: true,
    rotation: 0,
    seats: 1,
  });
  if (id === 'pb-english-sleeper') {
    Object.assign(doc.dimensions, {
      depth: 116.7,
      armWidth: 21,
      armHeight: 60,
      seatHeight: 46,
      seatThickness: 15,
      backThickness: 15,
      legHeight: 4,
      seatCount: 2,
    });
    Object.assign(doc.construction, {
      armRollRadius: 9,
      armStemWidth: 15,
      armFlare: 1,
      armSetback: 7,
      backCushionHeight: 48,
      skirtPleatDepth: 2,
      skirtFlare: 0.5,
      frameHeight: 91,
    });
    doc.style.arm = 'square';
    doc.style.base = 'long-skirt';
    doc.fabric.colour = '#d2c3af';
    doc.sleeper = { open: false, moduleId: 'main', extension: 100 };
    for (let i = 0; i < 2; i++) {
      doc.overrides[`main:seat-${i}`] = {
        outline: i === 0 ? 'rl-left' : 'rl-right',
        width: 110.5,
        depth: 81,
        offset: { x: 0, y: 0, z: -4 },
        loft: 0.6,
        piping: true,
      };
      doc.overrides[`main:back-${i}`] = {
        height: 44,
        depth: 16,
        shape: 'knife',
        outline: i === 0 ? 'rl-left' : 'rl-right',
        width: 99,
        notchDrop: 27,
        offset: { x: i === 0 ? -5 : 5, y: -2, z: 10 },
        softness: 0.6,
        piping: true,
        rotation: { x: -14, y: 0, z: i ? -1 : 1 },
      };
    }
  }
  if (id === 'pb-charleston') {
    Object.assign(doc.dimensions, {
      armWidth: 25,
      armHeight: 64,
      seatHeight: 48,
      seatThickness: 16,
      backThickness: 13,
      legHeight: 3,
      seatCount: 2,
    });
    Object.assign(doc.construction, {
      armRollRadius: 12,
      armStemWidth: 12,
      armFlare: 5,
      backCushionHeight: 48,
      skirtPleatDepth: 3,
      skirtFlare: 2,
      frameHeight: 77,
    });
    doc.style.arm = 'round';
    doc.style.base = 'long-skirt';
    doc.fabric.colour = '#d5cdbc';
    doc.pillows = 4;
    for (let i = 0; i < 2; i++) {
      doc.overrides[`main:seat-${i}`] = { loft: 0.6, softness: 0.5, piping: true };
      doc.overrides[`main:back-${i}`] = {
        width: 72,
        height: 49,
        depth: 15,
        shape: 'knife',
        softness: 0.7,
        piping: true,
        rotation: { x: -12, y: 0, z: i ? -7 : 7 },
        offset: { x: 0, y: 0, z: -2 },
      };
    }
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      doc.overrides[`main:pillow-${i}`] = {
        width: i < 2 ? 35 : 57,
        height: i < 2 ? 42 : 53,
        depth: 14,
        shape: 'knife',
        piping: true,
        softness: 0.7,
        loft: 0.8,
        rotation: { x: -12, y: i < 2 ? side * 65 : 0, z: side * (i < 2 ? -10 : -5) },
        offset: { x: side * (i < 2 ? 10 : 6), y: i < 2 ? -4 : 3, z: i < 2 ? 9 : 13 },
      };
    }
  }
  if (YORK_CONFIGS[id]) {
    const { seats, backs } = YORK_CONFIGS[id];
    // Pottery Barn York Slope Arm Grand Sofa (94.5"/240 cm, slipcovered):
    // overall 240.1 × 96.5 × 91.4, inside seating 209.5 wide, arms 15.2 × 62.2,
    // seat height 45.7, back frame 84, turned 2.5" legs under a pleated skirt.
    Object.assign(doc.dimensions, {
      armWidth: 15.2,
      armHeight: 62.2,
      seatHeight: 45.7,
      seatThickness: 14.5,
      backThickness: 18,
      legHeight: 6.4,
      seatCount: seats,
      height: 91.4,
    });
    // Only the bench variants decouple the back row; equal-count configs stay
    // on the default one-back-per-seat layout.
    if (backs !== seats) doc.cushionLayout = { backs };
    Object.assign(doc.construction, {
      legStyle: 'round',
      legWidth: 5.7,
      backCushionHeight: 51,
      frameHeight: 84,
      skirtPleatDepth: 3.5,
      skirtFlare: 1.2,
    });
    doc.style = { arm: 'square', back: 'short', cushion: 'rounded', base: 'long-skirt' };
    doc.fabric.colour = '#d8d1c2';
    // Down-blend-wrapped reversible covers: seats keep a low gusset with a
    // broad crowned panel; backs are plump pillow-top lenses — rounded corners
    // and a welt ringing the face, thickness kept shallow so the side profile
    // reads as the reversible-cover lens (zipper gusset on the bottom edge).
    for (let i = 0; i < seats; i++)
      doc.overrides[`main:seat-${i}`] = { depth: 67, loft: 0.5, softness: 0.4, piping: true };
    for (let i = 0; i < backs; i++)
      doc.overrides[`main:back-${i}`] = {
        height: 51,
        depth: 19,
        softness: 0.6,
        loft: 0.6,
        piping: true,
        rotation: { x: -8, y: 0, z: 0 },
        offset: { x: 0, y: 0, z: 2 },
      };
  }
  // Klippan: boxy low-back sofa on exposed square legs. Arms are slim square
  // posts at full back height; loose baggy cushions form the back's crown.
  // Dimensions: IKEA PDP for the 2-seat (180/88/66, seat 43, legs 11), same
  // platform carried to the 4-seat (width tier-3 estimated, provisional) and
  // the footstool (53/53/32, tier-3, two cover makers concur).
  if (id === 'klippan-2-seat' || id === 'klippan-4-seat' || id === 'klippan-footstool') {
    const footstool = id === 'klippan-footstool';
    const seats = footstool ? 1 : id === 'klippan-4-seat' ? 4 : 2;
    if (footstool) doc.preset = 'ottoman';
    Object.assign(doc.dimensions, {
      armWidth: footstool ? 0 : 11,
      armHeight: 66,
      seatHeight: footstool ? 32 : 43,
      seatThickness: footstool ? 13 : 14,
      backThickness: 14,
      legHeight: 11,
      seatCount: seats,
    });
    Object.assign(doc.construction, {
      backCushions: !footstool,
      backCushionHeight: footstool ? 0 : 24,
      frameHeight: footstool ? 19 : 62,
      legStyle: 'square',
      legWidth: 6,
      skirtPleatDepth: 0,
      skirtFlare: 0,
    });
    doc.style = { arm: 'square', back: 'short', cushion: 'rounded', base: 'snug' };
    doc.pillows = 0;
    doc.fabric.colour = '#c9c4b8';
    for (let i = 0; i < seats; i++) {
      doc.overrides[`main:seat-${i}`] = {
        depth: footstool ? 46 : 71,
        loft: 0.55,
        softness: 0.5,
        piping: false,
      };
      if (!footstool)
        doc.overrides[`main:back-${i}`] = {
          height: 26,
          depth: 15,
          softness: 0.75,
          loft: 0.7,
          shape: 'rounded',
          rotation: { x: -8, y: 0, z: 0 },
          offset: { x: 0, y: -1, z: 3 },
        };
    }
  }
  if (id === 'nammaro') {
    Object.assign(doc.dimensions, {
      armWidth: 4,
      armHeight: 70,
      seatHeight: 38,
      seatThickness: 8,
      backThickness: 12,
      legHeight: 24,
      seatCount: 3,
    });
    Object.assign(doc.construction, {
      frameStyle: 'slatted',
      legStyle: 'square',
      legWidth: 4,
      backCushionHeight: 51,
    });
    doc.modules = [-81, 0, 81].map((x, i) =>
      module(i === 0 ? 'main' : `module-${i}`, 81, 92, x, 0)
    );
    for (const m of doc.modules) {
      doc.overrides[`${m.id}:seat-0`] = { width: 80, depth: 80, loft: 0.1, piping: true };
      // Back cushions span the full 81 cm module so neighbouring sections'
      // cushions connect, and rest against the slatted backrest.
      doc.overrides[`${m.id}:back-0`] = {
        width: 81,
        height: 51,
        depth: 8,
        rotation: { x: -12, y: 0, z: 0 },
        offset: { x: 0, y: 2.4, z: -13.1 },
        loft: 0.35,
      };
    }
    doc.fabric.colour = '#c8c3ad';
  }
  if (id === 'soderhamn') {
    Object.assign(doc.dimensions, {
      armWidth: 6,
      armHeight: 69,
      seatHeight: 40,
      seatThickness: 9,
      backThickness: 8,
      legHeight: 14,
      seatCount: 2,
    });
    Object.assign(doc.construction, { backCushionHeight: 44, frameHeight: 69, legWidth: 2.5 });
    doc.pillows = 2;
    for (let i = 0; i < 2; i++) {
      doc.overrides[`main:back-${i}`] = {
        height: 44,
        depth: 15,
        shape: 'knife',
        rotation: { x: -12, y: 0, z: 0 },
        loft: 0.6,
      };
      doc.overrides[`main:pillow-${i}`] = {
        width: 46,
        height: 37,
        depth: 14,
        rotation: { x: -18, y: i ? -8 : 8, z: i ? 5 : -5 },
        offset: { x: i ? -5 : 5, y: -4, z: 6 },
        loft: 0.75,
      };
    }
    doc.fabric.colour = '#bcb9b0';
  }
  if (id === 'jattebo') {
    doc.preset = 'chaise';
    Object.assign(doc.dimensions, {
      armWidth: 25,
      armHeight: 71,
      seatHeight: 46,
      seatThickness: 18,
      backThickness: 25,
      legHeight: 2,
      seatCount: 3,
    });
    Object.assign(doc.construction, { backCushions: false, legStyle: 'plinth', frameHeight: 71 });
    doc.modules = [
      module('main', 95, 160, -95, 0, true, false),
      module('middle', 95, 95, 0, -32.5),
      module('chaise', 95, 160, 95, 0, false, true),
    ];
    doc.fabric.colour = '#747961';
    for (const m of doc.modules)
      doc.overrides[`${m.id}:seat-0`] = { loft: 0.18, softness: 0.4, piping: false };
  }
  if (id === 'friheten') {
    doc.preset = 'chaise';
    Object.assign(doc.dimensions, {
      armWidth: 13,
      armHeight: 66,
      seatHeight: 44,
      seatThickness: 12,
      backThickness: 11,
      legHeight: 3,
      seatCount: 3,
    });
    Object.assign(doc.construction, {
      backCushionHeight: 45,
      frameHeight: 66,
      legStyle: 'square',
      legWidth: 5,
    });
    doc.modules = [
      module('main', 149, 90, -40.5, -30.5, true, false),
      module('chaise', 81, 151, 74.5, 0, false, true),
    ];
    doc.modules[0].seats = 2;
    // The sleeping surface joins the chaise: 136 + 68 cm wide and 140 cm deep.
    doc.overrides['main:seat-0'] = {
      depth: 79,
      width: 67.3,
      offset: { x: -1, y: 0, z: 0 },
      loft: 0.05,
      piping: false,
    };
    doc.overrides['main:seat-1'] = {
      depth: 79,
      width: 67.3,
      offset: { x: -1, y: 0, z: 0 },
      loft: 0.05,
      piping: false,
    };
    doc.overrides['chaise:seat-0'] = {
      width: 68,
      depth: 140,
      offset: { x: -1, y: 0, z: 0 },
      loft: 0.05,
      piping: false,
    };
    doc.sleeper = { open: false, moduleId: 'main', extension: 61 };
    doc.fabric.colour = '#777d80';
  }
  doc.source = {
    kind: 'manufacturer',
    reference: product.reference,
    notes: [
      `${product.brand} reference dimensions: ${product.dimensions.width} × ${product.dimensions.depth} × ${product.dimensions.height} cm. ${product.version}.`,
      'Manufacturer overall dimensions; component geometry is an adjustable visual estimate. This reference preset does not imply a verified Comfort Works cover match.',
      ...(id === 'friheten'
        ? [
            'Open bed shows the extended sleeping surface with back cushions removed. Linkage and storage internals are not simulated.',
          ]
        : []),
    ],
  };
  if (id === 'pb-english-sleeper')
    doc.source = {
      kind: 'cw',
      reference: product.reference,
      notes: [
        'Actual photogrammetry frame mesh, aligned to the front; loose cushions remain separately editable.',
        'Scan proportions preserved at an estimated 221 cm width. Absolute scale is not verified.',
        'Open bed is a simplified extended surface; the folding mechanism is not reconstructed.',
      ],
    };
  if (YORK_CONFIGS[id])
    doc.source = {
      kind: 'cw',
      reference: product.reference,
      notes: [
        'Pottery Barn factory dimensions for the York Slope Arm Grand Sofa: 240.1 × 96.5 × 91.4 cm overall, inside seating 209.5 wide on a 45.7 cm seat, arms 15.2 × 62.2, 84 cm back frame on 2.5" turned legs.',
        'Down-blend-wrapped reversible cushion covers: plump pillow-top backs with a welt ringing the face (CNRP corner piping) and a shallow lens side profile; low-gusset seats. Original style: plain seams, pleated skirt.',
        'Slope arms: the cap runs from a full-height crest at the back down a long diagonal to a rounded front nose, with the welt seam inset along the outer face.',
        'One of the four CW cushion variants (1S-2B, 1S-3B, 2S-2B, 3S-3B) — pick another York entry to switch the configuration.',
      ],
    };
  return doc;
}
