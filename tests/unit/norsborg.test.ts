import { describe, it, expect } from 'vitest';
import {
  buildSofaParts,
  parseSofaDocument,
  sofaFitNotes,
  type NorsborgSectionKind,
  type SofaDocument,
  type SofaModule,
} from '../../src/modules/sofa3d/model';
import {
  NORSBORG_CHAISE_CONFIGURATION,
  applyNorsborgLayout,
  createNorsborgDocument,
  insertNorsborgSection,
  norsborgCoverSummary,
  norsborgCoverTotal,
} from '../../src/modules/sofa3d/norsborg';
import { createPopularModel } from '../../src/modules/sofa3d/popular-models';

const footprint = (m: SofaModule) => {
  const rotated = Math.abs(m.rotation % 180) > 45;
  const w = rotated ? m.depth : m.width;
  const d = rotated ? m.width : m.depth;
  return { x0: m.x - w / 2, x1: m.x + w / 2, z0: m.z - d / 2, z1: m.z + d / 2 };
};

const overlapArea = (a: SofaModule, b: SofaModule) => {
  const A = footprint(a),
    B = footprint(b);
  const w = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
  const d = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
  return w > 0.01 && d > 0.01 ? w * d : 0;
};

const assertAssembles = (doc: SofaDocument) => {
  const modules = doc.modules!;
  expect(modules.length).toBeGreaterThan(0);
  for (let i = 0; i < modules.length; i++)
    for (let j = i + 1; j < modules.length; j++)
      expect(overlapArea(modules[i], modules[j])).toBe(0);
  for (const part of buildSofaParts(doc))
    expect([part.size.x, part.size.y, part.size.z].every(n => n > 0 && Number.isFinite(n))).toBe(
      true
    );
};

describe('Norsborg configurator', () => {
  it('reproduces the reference order: 2 × three-seat + corner + armrest pair', () => {
    const lines = norsborgCoverSummary(createNorsborgDocument().norsborg!.sections);
    expect(lines).toEqual([
      expect.objectContaining({
        kind: 'armrest',
        code: 'IK-NG-8',
        quantity: 1,
        unitPrice: 79,
        lineTotal: 79,
      }),
      expect.objectContaining({
        kind: 'three-seat',
        code: 'IK-NG-3X',
        quantity: 2,
        unitPrice: 289,
        lineTotal: 578,
      }),
      expect.objectContaining({
        kind: 'corner',
        code: 'IK-NG-6',
        quantity: 1,
        unitPrice: 209,
        lineTotal: 209,
      }),
    ]);
    expect(norsborgCoverTotal(lines)).toBe(866);
  });

  it('assembles the corner combination into a 285 × 285 L with arms only at the outer ends', () => {
    const doc = createNorsborgDocument();
    expect(doc.dimensions.width).toBe(285);
    expect(doc.dimensions.depth).toBe(285);
    assertAssembles(doc);
    const armModules = doc.modules!.filter(m => m.armOnly);
    expect(armModules).toHaveLength(2);
    const arms = buildSofaParts(doc).filter(p => p.role === 'arm');
    expect(arms).toHaveLength(2);
    for (const arm of arms) expect(arm.name).toBe('Armrest');
    // Backs share one plane per leg: the run along z = 0, the return leg along x.
    const run = doc.modules!.filter(m => Math.abs(m.rotation) < 45);
    for (const m of run) expect(m.z - m.depth / 2).toBeCloseTo(0, 6);
    const leg = doc.modules!.filter(m => Math.abs(m.rotation) > 45);
    expect(leg.length).toBeGreaterThan(0);
    for (const m of leg) expect(m.x + m.depth / 2).toBeCloseTo(285, 6);
    // Back cushions on the turned leg keep the leg's yaw and lean out locally.
    const legBack = buildSofaParts(doc).find(p => p.id === `${leg[0].id}:back-0`)!;
    expect(legBack.rotation.y).toBeCloseTo((-90 * Math.PI) / 180, 4);
    expect((legBack.rotation.x * 180) / Math.PI).toBeCloseTo(20, 3);
    // Armrest sections carry no cushions, so the fit check must stay quiet.
    expect(sofaFitNotes(doc)).toEqual([]);
  });

  it('configures a chaise plus a three-seat plus armrests', () => {
    const doc = createNorsborgDocument([...NORSBORG_CHAISE_CONFIGURATION]);
    expect(doc.dimensions.width).toBe(293);
    expect(doc.dimensions.depth).toBe(157);
    assertAssembles(doc);
    const chaise = doc.modules!.find(m => m.depth === 157)!;
    expect(chaise.z - chaise.depth / 2).toBeCloseTo(0, 6);
  });

  it('adds and removes sections through the layout while staying loadable', () => {
    const doc = createNorsborgDocument();
    doc.norsborg!.sections.push({ id: 'extra', kind: 'two-seat' });
    applyNorsborgLayout(doc);
    // Appending after the corner extends the return leg, so the depth grows.
    expect(doc.dimensions.depth).toBe(285 + 121);
    assertAssembles(doc);
    const loaded = parseSofaDocument(JSON.parse(JSON.stringify(doc)));
    expect(loaded.norsborg!.sections.map(s => s.kind)).toContain('two-seat');
    loaded.norsborg!.sections = loaded.norsborg!.sections.filter(s => s.id !== 'extra');
    applyNorsborgLayout(loaded);
    expect(loaded.dimensions.depth).toBe(285);
    assertAssembles(loaded);
  });

  it('slots a new section before the trailing armrest so the open leg grows', () => {
    const doc = createNorsborgDocument();
    insertNorsborgSection(doc, 'two-seat');
    expect(doc.norsborg!.sections.map(s => s.kind)).toEqual([
      'armrest',
      'three-seat',
      'corner',
      'three-seat',
      'two-seat',
      'armrest',
    ]);
    // The return leg was open, so the new section deepens it; armrests stay at the ends.
    expect(doc.dimensions.width).toBe(285);
    expect(doc.dimensions.depth).toBe(285 + 121);
    assertAssembles(doc);
    const lines = norsborgCoverSummary(doc.norsborg!.sections);
    expect(norsborgCoverTotal(lines)).toBe(866); // the two-seat cover carries no price in the order data
    expect(lines.find(l => l.kind === 'three-seat')?.quantity).toBe(2);
  });

  it('builds every section to the CW PID measurements', () => {
    const size = (doc: SofaDocument, partId: string) =>
      buildSofaParts(doc).find(p => p.id.endsWith(`:${partId}`))!;
    const single = (kind: NorsborgSectionKind) => createNorsborgDocument([kind]);

    // IK-NG-2X · two-seat: seats 65 top / 60 base × 73, backs 61 × 44 × 12, frame 52.
    const two = single('two-seat');
    expect(size(two, 'seat-0').size).toMatchObject({ x: 65, y: 11.75, z: 73 });
    expect(size(two, 'seat-0').taper).toBeCloseTo(65 / 60 - 1, 3);
    expect(size(two, 'back-0').size).toMatchObject({ x: 61, y: 44, z: 12 });
    const twoBack = size(two, 'back-frame');
    expect(twoBack.position.y + twoBack.size.y / 2).toBe(52);

    // IK-NG-3X · three-seat: seats 66 top / 61 base × 73, backs 62 × 44 × 12, frame 60.
    const three = single('three-seat');
    expect(size(three, 'seat-1').size).toMatchObject({ x: 66, y: 11.5, z: 73 });
    expect(size(three, 'seat-1').taper).toBeCloseTo(66 / 61 - 1, 3);
    expect(size(three, 'back-2').size).toMatchObject({ x: 62, y: 44, z: 12 });
    // Back cushions lean out towards the seat on every section.
    expect((size(three, 'back-2').rotation.x * 180) / Math.PI).toBeCloseTo(20, 3);
    const threeBack = size(three, 'back-frame');
    expect(threeBack.size.y).toBe(42); // 60 cm frame on 18 cm legs
    expect(threeBack.position.y - threeBack.size.y / 2).toBe(18);
    expect(threeBack.position.y + threeBack.size.y / 2).toBe(60);

    // IK-NG-6 · corner: 72.5 × 72.5 seat, 74/63 and 87/76 tapered back cushions
    // whose sloped edges face the corner and which lean out towards the seat.
    const corner = single('corner');
    expect(size(corner, 'seat-0').size).toMatchObject({ x: 72.5, y: 12, z: 72.5 });
    const cornerBack = size(corner, 'back-0');
    expect(cornerBack.size).toMatchObject({ x: 74, y: 45, z: 12 });
    expect(cornerBack.taper).toBeCloseTo(74 / 63 - 1, 3);
    expect(cornerBack.outline).toBe('wedge-right');
    expect((cornerBack.rotation.x * 180) / Math.PI).toBeCloseTo(20, 3);
    const sideBack = size(corner, 'corner-back-cushion');
    expect(sideBack.size).toMatchObject({ x: 87, y: 45, z: 12 });
    expect(sideBack.taper).toBeCloseTo(87 / 76 - 1, 3);
    expect(sideBack.outline).toBe('wedge-left');
    expect(sideBack.rotation.y).toBeCloseTo(-Math.PI / 2, 4);
    expect((sideBack.rotation.x * 180) / Math.PI).toBeCloseTo(20, 3);
    // The side cushion rests on the return-leg back wall's edge, centred on the
    // 88 cm side, leaning out of the wall instead of intersecting it.
    const cornerModule = corner.modules![0];
    expect(sideBack.position.x - cornerModule.x).toBeCloseTo(17.5, 1);
    expect(sideBack.position.z - cornerModule.z).toBeCloseTo(0, 1);

    // Back cushions sit in front of the 15 cm back frame, resting on its top
    // edge — not buried inside it.
    const twoBackCushion = size(two, 'back-0');
    const twoModule = two.modules![0];
    expect(twoBackCushion.position.z - twoModule.z).toBeCloseTo(-17.5, 1);
    expect(twoBackCushion.position.z - twoModule.z + twoBackCushion.size.z / 2).toBeGreaterThan(
      -29
    );

    // IK-NG-5X · chaise: 78 × 142 seat flush with the section front, back 81 × 44 × 12.
    const chaise = single('chaise');
    const chaiseSeat = size(chaise, 'seat-0');
    expect(chaiseSeat.size).toMatchObject({ x: 78, y: 12, z: 142 });
    expect(chaiseSeat.position.z + chaiseSeat.size.z / 2).toBeCloseTo(157, 1);
    expect(size(chaise, 'back-0').size).toMatchObject({ x: 81, y: 44, z: 12 });

    // IK-NG-8 · armrest: a 16 × 88 × 52 upholstered post.
    const arm = size(single('armrest'), 'arm-left');
    expect(arm.size).toMatchObject({ x: 16, z: 88 });
    expect(arm.position.y + arm.size.y / 2).toBe(52);
  });

  it('rejects corrupt Norsborg state', () => {
    const doc = createNorsborgDocument();
    const bad = JSON.parse(JSON.stringify(doc));
    bad.norsborg.sections[0].kind = 'wing';
    expect(() => parseSofaDocument(bad)).toThrow();
  });

  it('opens both catalogue entries and renders their seats', () => {
    for (const id of ['norsborg', 'norsborg-chaise'] as const) {
      const doc = createPopularModel(id);
      expect(doc.catalogueModel).toBe(id);
      const loaded = parseSofaDocument(JSON.parse(JSON.stringify(doc)));
      const parts = buildSofaParts(loaded);
      expect(parts.filter(p => p.role === 'seat').length).toBeGreaterThan(2);
      expect(parts.filter(p => p.role === 'arm')).toHaveLength(2);
    }
  });
});
