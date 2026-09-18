import { describe, it, expect } from 'vitest';
import {
  buildSofaParts,
  createSofaDocument,
  parseSofaDocument,
  sofaFitNotes,
  type SofaPart,
} from '../../src/modules/sofa3d/model';
import { createPopularModel } from '../../src/modules/sofa3d/popular-models';
import { slopeArmGeometry, slopeArmWelt } from '../../src/modules/sofa3d/profiles';

const YORK_IDS = [
  'pb-york-slope-95-1s2b',
  'pb-york-slope-95-1s3b',
  'pb-york-slope-95-2s2b',
  'pb-york-slope-95-3s3b',
] as const;

const partsWithRole = (parts: SofaPart[], role: SofaPart['role']) =>
  parts.filter(p => p.role === role);

describe('PB York Slope Arm 95" cushion configurations', () => {
  it('offers all four CW cushion variants and round-trips them', () => {
    for (const id of YORK_IDS) {
      const doc = createPopularModel(id);
      expect(doc.catalogueModel).toBe(id);
      const loaded = parseSofaDocument(JSON.parse(JSON.stringify(doc)));
      expect(loaded.cushionLayout?.backs).toBe(doc.cushionLayout?.backs);
      const parts = buildSofaParts(loaded);
      expect(parts.every(p => [p.size.x, p.size.y, p.size.z].every(n => n > 0))).toBe(true);
      expect(sofaFitNotes(loaded)).toEqual([]);
    }
  });

  it('builds the bench + 2 back variant with back cushions decoupled from seats', () => {
    const doc = createPopularModel('pb-york-slope-95-1s2b');
    expect(doc.dimensions.seatCount).toBe(1);
    expect(doc.cushionLayout).toEqual({ backs: 2 });
    const parts = buildSofaParts(parseSofaDocument(JSON.parse(JSON.stringify(doc))));
    const seats = partsWithRole(parts, 'seat');
    const backs = partsWithRole(parts, 'back');
    expect(seats).toHaveLength(1);
    expect(backs).toHaveLength(2);

    // The bench spans the seating width between the 15.2 cm arms.
    const inner = doc.dimensions.width - doc.dimensions.armWidth * 2;
    expect(seats[0].size.x).toBeCloseTo(inner - 2, 1);

    // Back cushions split the same width evenly, one gap between them.
    const [left, right] = backs.sort((a, b) => a.position.x - b.position.x);
    const expectedWidth = (inner - 2 - 1.4) / 2;
    expect(left.size.x).toBeCloseTo(expectedWidth, 1);
    expect(right.size.x).toBeCloseTo(expectedWidth, 1);
    expect(right.position.x - left.position.x).toBeCloseTo(expectedWidth + 1.4, 1);
  });

  it('builds the bench + 3 back variant to the photographed cushion proportions', () => {
    const doc = createPopularModel('pb-york-slope-95-1s3b');
    const parts = buildSofaParts(doc);
    const backs = partsWithRole(parts, 'back');
    expect(backs).toHaveLength(3);
    // 68.3 wide × 51 tall × 19 thick: wider than tall like the front-view photo,
    // with the shallow lens thickness from the side view.
    for (const back of backs) {
      expect(back.size.x).toBeCloseTo((doc.dimensions.width - 2 * doc.dimensions.armWidth - 4.8) / 3, 1);
      expect(back.size.y).toBeCloseTo(51, 1);
      expect(back.size.z).toBeCloseTo(19, 1);
      expect(back.piping).toBe(true);
      expect((back.rotation.x * 180) / Math.PI).toBeCloseTo(-8, 3);
    }
  });

  it('keeps the equal-count variants on one back cushion per seat', () => {
    for (const [id, seats] of [
      ['pb-york-slope-95-2s2b', 2],
      ['pb-york-slope-95-3s3b', 3],
    ] as const) {
      const doc = createPopularModel(id);
      expect(doc.dimensions.seatCount).toBe(seats);
      expect(doc.cushionLayout).toBeUndefined();
      const parts = buildSofaParts(doc);
      expect(partsWithRole(parts, 'seat')).toHaveLength(seats);
      expect(partsWithRole(parts, 'back')).toHaveLength(seats);
    }
  });

  it('rests the back cushions on the seat in front of the back frame', () => {
    const doc = createPopularModel('pb-york-slope-95-2s2b');
    const parts = buildSofaParts(doc);
    const backFrame = parts.find(p => p.id === 'main:back-frame')!;
    const seat = partsWithRole(parts, 'seat')[0];
    for (const back of partsWithRole(parts, 'back')) {
      // Cushion base lands near the seat top instead of floating or sinking.
      expect(back.position.y - back.size.y / 2).toBeGreaterThan(seat.position.y);
      expect(back.position.y - back.size.y / 2).toBeLessThan(seat.position.y + seat.size.y + 6);
      // The rear face leans onto the back frame (an 8° rake closes the ~3 cm
      // axis-aligned gap at the crown) without burying into it.
      const rear = back.position.z - back.size.z / 2;
      const frameFront = backFrame.position.z + backFrame.size.z / 2;
      expect(rear).toBeGreaterThan(frameFront - 5);
      expect(rear).toBeLessThan(frameFront + 6);
    }
  });

  it('rejects a corrupt cushion layout', () => {
    const doc = createPopularModel('pb-york-slope-95-1s2b');
    const bad = JSON.parse(JSON.stringify(doc));
    bad.cushionLayout.backs = 'two';
    expect(() => parseSofaDocument(bad)).toThrow();
  });

  it('slopes the arm from a rounded nose up into a backrest-blended tail', () => {
    const doc = createPopularModel('pb-york-slope-95-3s3b');
    for (const armId of ['main:arm-left', 'main:arm-right']) {
      const arm = buildSofaParts(doc).find(p => p.id === armId)!;
      const g = slopeArmGeometry(arm);
      const p = g.getAttribute('position');
      const h = arm.size.y,
        d = arm.size.z;
      // t: 0 at the front nose → 1 at the back (the back frame sits at -z).
      let noseTop = -Infinity,
        crestTop = -Infinity,
        tailTop = -Infinity;
      for (let i = 0; i < p.count; i++) {
        expect([p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)).toBe(true);
        const t = (d / 2 - p.getZ(i)) / d;
        const y = p.getY(i);
        if (t < 0.08) noseTop = Math.max(noseTop, y);
        if (t > 0.5 && t < 0.68) crestTop = Math.max(crestTop, y);
        if (t > 0.82 && t < 0.95) tailTop = Math.max(tailTop, y);
      }
      // Nose sits well below the crest; the tail sweeps above it into the back.
      expect(noseTop / h).toBeGreaterThan(0.15);
      expect(noseTop / h).toBeLessThan(0.3);
      expect(crestTop / h).toBeGreaterThan(0.45);
      expect(crestTop / h).toBeLessThan(0.6);
      expect(tailTop).toBeGreaterThan(crestTop + 0.1 * h);
      // The welt hugs the outer face along the whole slope.
      const welt = slopeArmWelt(arm);
      const wp = welt.getAttribute('position');
      for (let i = 0; i < wp.count; i++)
        expect([wp.getX(i), wp.getY(i), wp.getZ(i)].every(Number.isFinite)).toBe(true);
      welt.computeBoundingBox();
      const box = welt.boundingBox!;
      const outerX = armId.endsWith('right') ? -1 : 1;
      expect(outerX > 0 ? box.max.x : box.min.x).toBeCloseTo(
        outerX * (arm.size.x / 2 + 0.04 + 0.12),
        1
      ); // curve x + tube radius
      expect(box.max.z - box.min.z).toBeGreaterThan(arm.size.z * 0.8);
    }
  });

  it('matches the Pottery Barn Grand Sofa frame dimensions', () => {
    const doc = createPopularModel('pb-york-slope-95-3s3b');
    expect(doc.dimensions.width).toBeCloseTo(240.1, 1);
    expect(doc.dimensions.depth).toBeCloseTo(96.5, 1);
    expect(doc.dimensions.height).toBeCloseTo(91.4, 1);
    expect(doc.dimensions.armWidth).toBeCloseTo(15.2, 1);
    expect(doc.dimensions.armHeight).toBeCloseTo(62.2, 1);
    expect(doc.dimensions.seatHeight).toBeCloseTo(45.7, 1);
    const parts = buildSofaParts(doc);
    const backFrame = parts.find(p => p.id === 'main:back-frame')!;
    expect(backFrame.position.y + backFrame.size.y / 2).toBeCloseTo(84, 1); // 33" back frame
    const arm = parts.find(p => p.id === 'main:arm-left')!;
    expect(arm.position.y + arm.size.y / 2).toBeCloseTo(62.2, 1);
    expect(doc.style.base).toBe('long-skirt'); // pleated Original-style skirt
  });

  it('leaves multi-module presets with one back cushion per seat', () => {
    for (const preset of ['sofa', 'chaise', 'corner'] as const) {
      const doc = parseSofaDocument(JSON.parse(JSON.stringify(createSofaDocument(preset))));
      const parts = buildSofaParts(doc);
      const numbered = parts.filter(p => p.role === 'back' && /back-\d+$/.test(p.id));
      // Corner presets add an extra unnumbered corner-return cushion on top.
      expect(numbered).toHaveLength(partsWithRole(parts, 'seat').length);
    }
  });
});
