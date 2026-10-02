import { EXTENDED_MODELS, createExtendedModel } from './extended-models';
import { BENCHMARK_PRODUCTS, createBenchmarkDocument } from './benchmarks';
import {
  NORSBORG_PRODUCTS,
  NORSBORG_CHAISE_CONFIGURATION,
  createNorsborgDocument,
  isNorsborgModel,
} from './norsborg';
import { buildSofaParts, type SofaDocument, type PartOverride } from './model';
export const POPULAR_MODELS = [
  ...BENCHMARK_PRODUCTS.map(p => ({
    ...p,
    brand:
      p.id === 'harmony'
        ? 'West Elm'
        : p.id === 'pb-basic'
          ? 'Pottery Barn'
          : p.id === 'cloud-corner'
            ? 'Restoration Hardware'
            : 'IKEA',
  })),
  ...EXTENDED_MODELS,
  ...NORSBORG_PRODUCTS,
];
export function createPopularModel(id: string): SofaDocument {
  if (EXTENDED_MODELS.some(p => p.id === id)) return createExtendedModel(id);
  if (isNorsborgModel(id)) {
    const doc = createNorsborgDocument(
      id === 'norsborg-chaise' ? [...NORSBORG_CHAISE_CONFIGURATION] : undefined
    );
    doc.catalogueModel = id;
    return doc;
  }
  const doc = createBenchmarkDocument(id);
  doc.catalogueModel = id;
  doc.fabric.colour = '#cec9bd';
  const set = (part: string, values: PartOverride) =>
    (doc.overrides[part] = { ...doc.overrides[part], ...values });
  for (const part of buildSofaParts(doc))
    if (['seat', 'back', 'pillow'].includes(part.role))
      set(part.id, {
        loft: part.role === 'seat' ? 0.32 : 0.55,
        softness: part.role === 'seat' ? 0.25 : 0.5,
        piping: part.role !== 'pillow',
      });
  if (id === 'karlstad') {
    Object.assign(doc.construction, {
      legStyle: 'square',
      legWidth: 6,
      backCushionHeight: 38,
      frameHeight: doc.dimensions.height,
    });
    for (let i = 0; i < 2; i++)
      set(`main:back-${i}`, {
        height: 38,
        depth: 16,
        rotation: { x: -10, y: 0, z: i === 0 ? -1 : 1 },
        loft: 0.4,
        softness: 0.35,
      });
  }
  if (id === 'ektorp' || id === 'pb-basic') {
    const pb = id === 'pb-basic';
    Object.assign(doc.construction, {
      armRollRadius: pb ? 13 : 11,
      armStemWidth: pb ? 12 : 16,
      armFlare: pb ? 4 : 1.5,
      armSetback: pb ? 3 : 0,
      skirtPleatDepth: pb ? 5 : 2.5,
      skirtFlare: pb ? 3 : 1,
      backCushionHeight: pb ? 49 : 44,
      frameHeight: pb ? 96.5 : 88,
    });
    for (let i = 0; i < 3; i++) {
      set(`main:back-${i}`, {
        height: pb ? 49 : 44,
        depth: pb ? 19 : 17,
        rotation: { x: -11, y: 0, z: i === 1 ? 0 : i === 0 ? -2 : 2 },
        softness: 0.5,
        loft: 0.65,
        taper: pb ? -0.06 : -0.025,
        outline: i === 0 ? 'rl-left' : i === 2 ? 'rl-right' : 'rect',
        notchDrop: doc.dimensions.seatHeight + (pb ? 49 : 44) - doc.dimensions.armHeight - 5,
        width: (doc.dimensions.width - doc.dimensions.armWidth * 2 - 4.8) / 3 + (i === 1 ? 0 : 12),
        offset: { x: i === 0 ? -6 : i === 2 ? 6 : 0, y: 0, z: 0 },
      });
      set(`main:seat-${i}`, {
        loft: 0.7,
        height: pb ? 17 : 16,
        softness: 0.45,
        outline: 'rect',
      });
    }
  }
  if (id === 'harmony') {
    Object.assign(doc.construction, { legStyle: 'square', legWidth: 6.5, backCushionHeight: 38 });
    doc.fabric.colour = '#c5b8a4';
    Object.assign(doc.dimensions, {
      armHeight: 55,
      seatHeight: 48,
      seatThickness: 21,
      legHeight: 11,
    });
    // Seat the large backs against the frame, then place the lumbar pillows just in front.
    for (let i = 0; i < 2; i++) set(`main:seat-${i}`, { loft: 0.9, softness: 0.65, piping: true });
    for (let i = 0; i < 2; i++)
      set(`main:back-${i}`, {
        height: 38,
        depth: 18,
        shape: 'knife',
        softness: 0.55,
        loft: 0.75,
        piping: false,
        rotation: { x: -9, y: 0, z: i === 0 ? -1 : 1 },
        offset: { x: 0, y: 2, z: 0 },
      });
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      set(`main:pillow-${i}`, {
        width: i < 2 ? 39 : 70,
        height: i < 2 ? 42 : 29,
        depth: i < 2 ? 18 : 17,
        softness: 0.55,
        loft: 0.85,
        piping: false,
        rotation: { x: -10, y: side * (i < 2 ? 78 : 0), z: side * (i < 2 ? -14 : 1) },
        offset: { x: side * (i < 2 ? 12 : 11), y: i < 2 ? -6 : -3, z: i < 2 ? 24 : -3 },
      });
    }
  }
  if (id === 'cloud-corner') {
    Object.assign(doc.construction, { legStyle: 'plinth', legWidth: 5, backCushionHeight: 42 });
    set('main:seat-0', { loft: 0.55, softness: 0.35, piping: true });
    set('main:back-0', {
      width: 82,
      height: 42,
      depth: 19,
      shape: 'knife',
      softness: 0.5,
      loft: 0.8,
      piping: false,
      rotation: { x: -16, y: 0, z: -3 },
      offset: { x: -7, y: -3, z: 3 },
    });
    set('main:corner-back-cushion', {
      width: 78,
      height: 42,
      depth: 19,
      shape: 'knife',
      softness: 0.5,
      loft: 0.8,
      piping: false,
      rotation: { x: -16, y: -90, z: 0 },
      offset: { x: -3, y: -3, z: 11 },
    });
    set('main:pillow-0', {
      width: 52,
      height: 50,
      depth: 17,
      shape: 'knife',
      loft: 0.9,
      softness: 0.55,
      piping: false,
      rotation: { x: -14, y: 45, z: 0 },
      offset: { x: 12, y: -5, z: 12 },
    });
  }
  doc.source!.notes[0] = doc.source!.notes[0].replace('Benchmark:', 'Catalogue variant:');
  doc.source!.notes[1] =
    'Overall catalogue dimensions are supplied by CW. Arm, cushion, skirt and support profiles are adjustable estimates fitted to the product photograph.';
  return doc;
}
