import products from './extended-products.json';
import { createSofaDocument, type SofaDocument, type SofaModule } from './model';
export const EXTENDED_MODELS = products;

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
      backCushionHeight: 48,
    });
    doc.modules = [-81, 0, 81].map((x, i) =>
      module(i === 0 ? 'main' : `module-${i}`, 81, 92, x, 0)
    );
    for (const m of doc.modules) {
      doc.overrides[`${m.id}:seat-0`] = { width: 80, depth: 80, loft: 0.1, piping: true };
      doc.overrides[`${m.id}:back-0`] = {
        height: 48,
        depth: 8,
        rotation: { x: -12, y: 0, z: 0 },
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
      backCushionHeight: 43,
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
      `IKEA reference dimensions: ${product.dimensions.width} × ${product.dimensions.depth} × ${product.dimensions.height} cm. ${product.version}.`,
      'Manufacturer overall dimensions; component geometry is an adjustable visual estimate. This reference preset does not imply a verified Comfort Works cover match.',
      ...(id === 'friheten'
        ? [
            'Open bed shows the extended sleeping surface with back cushions removed. Linkage and storage internals are not simulated.',
          ]
        : []),
    ],
  };
  return doc;
}
