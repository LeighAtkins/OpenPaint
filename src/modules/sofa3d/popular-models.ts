import { EXTENDED_MODELS, createExtendedModel } from './extended-models';
import { BENCHMARK_PRODUCTS, createBenchmarkDocument } from './benchmarks';
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
];
export function createPopularModel(id: string): SofaDocument {
  if (EXTENDED_MODELS.some(p => p.id === id)) return createExtendedModel(id);
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
    Object.assign(doc.construction, { legStyle: 'square', legWidth: 6, backCushionHeight: 38 });
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
    });
    for (let i = 0; i < 3; i++) {
      set(`main:back-${i}`, {
        height: pb ? 49 : 44,
        depth: pb ? 19 : 17,
        rotation: { x: -11, y: 0, z: i === 1 ? 0 : i === 0 ? -2 : 2 },
        softness: 0.5,
        loft: 0.65,
        taper: pb ? -0.06 : -0.025,
      });
      set(`main:seat-${i}`, {
        loft: 0.45,
        softness: 0.3,
        outline: i === 0 ? 't-left' : i === 2 ? 't-right' : 'rect',
      });
    }
  }
  if (id === 'harmony') {
    Object.assign(doc.construction, { legStyle: 'block', legWidth: 24, backCushionHeight: 41 });
    for (let i = 0; i < 2; i++)
      set(`main:back-${i}`, {
        height: 41,
        depth: 20,
        shape: 'knife',
        softness: 0.55,
        loft: 0.75,
        piping: false,
        rotation: { x: -13, y: 0, z: i === 0 ? -3 : 3 },
      });
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      set(`main:pillow-${i}`, {
        width: i < 2 ? 43 : 42,
        height: i < 2 ? 38 : 35,
        depth: 17,
        softness: 0.55,
        loft: 0.85,
        piping: false,
        rotation: { x: -18, y: side * (i < 2 ? 30 : 4), z: side * (i < 2 ? -24 : 4) },
        offset: { x: side * (i < 2 ? 7 : -7), y: i < 2 ? -8 : -6, z: i < 2 ? 18 : 26 },
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
