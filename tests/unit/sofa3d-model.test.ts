import { describe, it, expect } from 'vitest';
import {
  buildSofaParts,
  createSofaDocument,
  setPartSize,
  parseSofaDocument,
  sofaFitNotes,
} from '../../src/modules/sofa3d/model';
describe('Sofa Studio geometry', () => {
  it('resizes a pillow from 30 to 40 cm while preserving the sofa', () => {
    const start = setPartSize(createSofaDocument(), 'main:pillow-0', 'width', 30);
    const end = setPartSize(start, 'main:pillow-0', 'width', 40);
    expect(buildSofaParts(end).find(p => p.id === 'main:pillow-0')?.size.x).toBe(40);
    expect(end.dimensions).toEqual(start.dimensions);
    expect(buildSofaParts(start).find(p => p.id === 'main:pillow-0')?.size.x).toBe(30);
  });
  it('reflows neighboring seats and reports overflow', () => {
    const start = createSofaDocument();
    const end = setPartSize(start, 'main:seat-0', 'width', 160);
    expect(buildSofaParts(end).find(p => p.id === 'main:seat-1')!.position.x).toBeGreaterThan(
      buildSofaParts(start).find(p => p.id === 'main:seat-1')!.position.x
    );
    expect(sofaFitNotes(end)[0]).toContain('overlap');
  });
  it('round trips editable dimensions and rejects impossible input', () => {
    const doc = setPartSize(createSofaDocument(), 'main:pillow-0', 'depth', 12);
    expect(parseSofaDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(() => setPartSize(doc, 'main:pillow-0', 'width', NaN)).toThrow();
    doc.dimensions.width = 10;
    expect(() => parseSofaDocument(doc)).toThrow();
  });
});

import {
  rolledArmOutline,
  backProfile,
  extrudeArm,
  extrudeBack,
} from '../../src/modules/sofa3d/profiles';
import { applyGalleryGuide } from '../../src/modules/sofa3d/gallery';
describe('Gallery construction profiles', () => {
  it('keeps an inset upright below the outward roll, mirrored on the other arm', () => {
    const points = rolledArmOutline(24, 54).getPoints(40);
    const lower = points.filter(p => p.y < 0),
      upper = points.filter(p => p.y > 15);
    expect(Math.min(...lower.map(p => p.x))).toBeGreaterThan(Math.min(...upper.map(p => p.x)) + 5);
    const doc = applyGalleryGuide('CS3B-RA-HB', createSofaDocument());
    const arms = buildSofaParts(doc).filter(p => p.role === 'arm');
    for (const arm of arms) {
      const geometry = extrudeArm(arm);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeCloseTo(25, 1);
      geometry.dispose();
    }
  });
  it('makes high and short frames structurally different and exposes a four-edge raised back', () => {
    const high = applyGalleryGuide('CS3B-RA-HB', createSofaDocument());
    const short = applyGalleryGuide('CS3B-RA-SB', high);
    const part = buildSofaParts(high).find(p => p.profile === 'raised-back')!;
    expect(part).toBeDefined();
    expect(buildSofaParts(short).some(p => p.profile === 'raised-back')).toBe(false);
    const outline = backProfile(part.size.z, part.size.y, high.construction);
    expect(outline[1].z - outline[0].z).toBe(20);
    expect(outline[2].z - outline[3].z).toBe(12);
    expect(outline[2].z).toBeLessThan(outline[1].z);
    const geometry = extrudeBack(part, high.construction);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBe(20);
    geometry.dispose();
  });
  it('extends the deck beyond the arms only for projecting variants', () => {
    for (const [code, extension] of [
      ['CS3B-RA-HB', 0],
      ['CS3L-RA-HB', 14],
    ] as const) {
      const parts = buildSofaParts(applyGalleryGuide(code, createSofaDocument()));
      const deck = parts.find(p => p.id === 'main:frame')!,
        arm = parts.find(p => p.id === 'main:arm-left')!;
      expect(deck.position.z + deck.size.z / 2 - (arm.position.z + arm.size.z / 2)).toBe(extension);
    }
  });
  it('builds a dedicated corner seat with perpendicular backs and cushions', () => {
    const parts = buildSofaParts(createSofaDocument('corner'));
    expect(parts.find(p => p.id === 'corner:seat-0')?.name).toBe('Corner seat cushion');
    const back = parts.find(p => p.id === 'corner:back-frame')!,
      side = parts.find(p => p.id === 'corner:corner-back-frame')!;
    expect(Math.abs(back.rotation.y - side.rotation.y)).toBeCloseTo(Math.PI / 2);
    expect(parts.some(p => p.id === 'corner:corner-back-cushion')).toBe(true);
  });
});

import { createPopularModel, POPULAR_MODELS } from '../../src/modules/sofa3d/popular-models';
import { cushionGeometry, skirtGeometry } from '../../src/modules/sofa3d/upholstery';
describe('Popular sofa refinements', () => {
  it('opens and round-trips every popular model with finite geometry', () => {
    for (const product of POPULAR_MODELS) {
      const doc = parseSofaDocument(JSON.parse(JSON.stringify(createPopularModel(product.id))));
      expect(doc.catalogueModel).toBe(product.id);
      for (const part of buildSofaParts(doc)) {
        expect(
          [part.size.x, part.size.y, part.size.z].every(n => n > 0 && Number.isFinite(n))
        ).toBe(true);
        if (['seat', 'back', 'pillow'].includes(part.role)) {
          const geometry = cushionGeometry(part);
          geometry.computeBoundingBox();
          const bounds = geometry.boundingBox!;
          expect(bounds.max.x - bounds.min.x).toBeCloseTo(part.size.x, 3);
          expect(bounds.max.y - bounds.min.y).toBeCloseTo(part.size.y, 3);
          expect(bounds.max.z - bounds.min.z).toBeCloseTo(part.size.z, 3);
          geometry.dispose();
        }
      }
    }
  });
  it('distinguishes the bases and arm profiles between products', () => {
    const kd = createPopularModel('karlstad'),
      hy = createPopularModel('harmony'),
      ep = createPopularModel('ektorp'),
      pb = createPopularModel('pb-basic');
    expect(
      buildSofaParts(kd)
        .filter(p => p.role === 'leg')
        .every(p => p.shape === 'square')
    ).toBe(true);
    expect(buildSofaParts(hy).filter(p => p.role === 'leg')).toHaveLength(4);
    expect(pb.construction.armFlare).toBeGreaterThan(ep.construction.armFlare);
    const skirt = buildSofaParts(pb).find(p => p.role === 'skirt')!;
    const geometry = skirtGeometry(skirt, pb.construction);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBeCloseTo(skirt.size.y, 3);
    geometry.dispose();
  });
  it('keeps independent rotation and shape edits through save/load', () => {
    const doc = createPopularModel('harmony');
    doc.overrides['main:pillow-0'] = {
      rotation: { x: -20, y: 30, z: 10 },
      loft: 0.8,
      taper: 0.15,
      softness: 0.7,
      outline: 'rect',
    };
    const loaded = parseSofaDocument(JSON.parse(JSON.stringify(doc)));
    const part = buildSofaParts(loaded).find(p => p.id === 'main:pillow-0')!;
    expect(part.rotation.y).toBeCloseTo(Math.PI / 6);
    expect(part.loft).toBe(0.8);
    doc.overrides['main:pillow-0'].rotation!.y = NaN;
    expect(() => parseSofaDocument(doc)).toThrow();
  });
  it('preserves old drafts by filling new construction defaults', () => {
    const old = JSON.parse(JSON.stringify(createSofaDocument()));
    delete old.construction;
    expect(parseSofaDocument(old).construction.legStyle).toBe('round');
  });
});

describe('Skirt attachment and new constructions', () => {
  it.each(['ektorp', 'pb-basic'])('joins %s skirt to the arm upright without a ledge', id => {
    const doc = createPopularModel(id);
    const parts = buildSofaParts(doc);
    const arm = parts.find(p => p.id === 'main:arm-left')!;
    const skirt = parts.find(p => p.role === 'skirt')!;
    const outline = rolledArmOutline(arm.size.x, arm.size.y, doc.construction).getPoints(40);
    const bottom = outline.filter(p => Math.abs(p.y + arm.size.y / 2) < 0.001);
    const outer = Math.min(...bottom.map(p => p.x)) + arm.position.x;
    expect(skirt.position.x - skirt.size.x / 2).toBeCloseTo(outer, 5);
    expect(skirt.position.y + skirt.size.y / 2).toBeCloseTo(arm.position.y - arm.size.y / 2, 5);
    const geometry = skirtGeometry(skirt, doc.construction);
    const vertices = geometry.getAttribute('position');
    const top = Array.from({ length: vertices.count }, (_, i) => i).filter(
      i => Math.abs(vertices.getY(i) - skirt.size.y / 2) < 0.001
    );
    expect(Math.min(...top.map(i => vertices.getX(i)))).toBeCloseTo(-skirt.size.x / 2, 4);
    geometry.dispose();
  });
  it('uses open timber rails outdoors and fixed backs on the double chaise', () => {
    const outdoor = buildSofaParts(createPopularModel('nammaro'));
    expect(outdoor.filter(p => p.profile === 'timber').length).toBeGreaterThan(40);
    expect(outdoor.filter(p => p.role === 'seat')).toHaveLength(3);
    expect(outdoor.some(p => p.id.endsWith(':frame'))).toBe(false);
    const sectional = buildSofaParts(createPopularModel('jattebo'));
    expect(sectional.filter(p => p.role === 'seat')).toHaveLength(3);
    expect(sectional.filter(p => p.role === 'back')).toHaveLength(0);
  });
  it('opens a continuous 204 × 140 cm bed and restores the closed cushions', () => {
    const doc = createPopularModel('friheten');
    const closed = buildSofaParts(doc);
    expect(closed.filter(p => p.role === 'back')).toHaveLength(3);
    doc.sleeper!.open = true;
    const restored = parseSofaDocument(JSON.parse(JSON.stringify(doc)));
    const parts = buildSofaParts(restored),
      seats = parts.filter(p => p.role === 'seat');
    expect(parts.some(p => p.role === 'back')).toBe(false);
    const span = (axis: 'x' | 'z') =>
      Math.max(...seats.map(p => p.position[axis] + p.size[axis] / 2)) -
      Math.min(...seats.map(p => p.position[axis] - p.size[axis] / 2));
    expect(span('x')).toBeCloseTo(204, 4);
    expect(span('z')).toBeCloseTo(140, 4);
    const extension = parts.find(p => p.id === 'main:bed-extension')!;
    const seat = parts.find(p => p.id === 'main:seat-0')!;
    expect(extension.position.z - extension.size.z / 2).toBeCloseTo(
      seat.position.z + seat.size.z / 2,
      4
    );
    doc.sleeper!.open = false;
    expect(buildSofaParts(doc)).toEqual(closed);
    doc.sleeper!.extension = -1;
    expect(() => parseSofaDocument(doc)).toThrow();
  });
});
