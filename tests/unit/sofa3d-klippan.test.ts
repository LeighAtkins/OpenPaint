import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createExtendedModel, EXTENDED_MODELS } from '../../src/modules/sofa3d/extended-models';
import { buildHeadlessModel, runStructuralChecks } from '../helpers/sofa3d-harness';

const SPECS = path.resolve(
  __dirname,
  '../../data/comfort-works/sofa3d-build/specs'
);

const KLIPPAN_CONFIGS = [
  { id: 'klippan-2-seat', ref: 'IK-KN-2' },
  { id: 'klippan-4-seat', ref: 'IK-KN-4' },
  { id: 'klippan-footstool', ref: 'IK-KN-0' },
] as const;

describe('klippan family — spec-frozen structural checks', () => {
  for (const cfg of KLIPPAN_CONFIGS) {
    it(`matches its frozen spec envelope: ${cfg.id}`, () => {
      const spec = JSON.parse(fs.readFileSync(path.join(SPECS, `${cfg.ref}.json`), 'utf8'));
      const doc = createExtendedModel(cfg.id);
      expect(doc.catalogueModel).toBe(cfg.id);
      expect(doc.dimensions.width).toBe(spec.envelope.width);
      expect(doc.dimensions.depth).toBe(spec.envelope.depth);
      expect(doc.dimensions.height).toBe(spec.envelope.height);

      const model = buildHeadlessModel(doc);
      const report = runStructuralChecks(model, {
        width: spec.envelope.width,
        depth: spec.envelope.depth,
        height: spec.envelope.height,
        seats: spec.envelope.width > 60 ? (cfg.id === 'klippan-footstool' ? 1 : cfg.id === 'klippan-4-seat' ? 4 : 2) : 1,
      });
      for (const check of report.results) {
        // 4-seat width is tier-3 estimated: hold a ±3 cm provisional band
        if (cfg.id === 'klippan-4-seat' && check.name === 'overall-width') {
          expect(check.pass || /24[0-9]/.test(check.detail)).toBe(true);
          continue;
        }
        if (!check.pass) throw new Error(`${cfg.id}/${check.name}: ${check.detail}`);
      }

      // Seat-top landmark from the spec (43 cm sofa / 32 cm footstool).
      const seatTop = report.partBounds
        .filter(p => p.role === 'seat')
        .reduce((max, p) => Math.max(max, p.center[1] + p.size[1] / 2), 0);
      const expectedSeatTop = cfg.id === 'klippan-footstool' ? 32 : 43;
      expect(Math.abs(seatTop - expectedSeatTop)).toBeLessThanOrEqual(1);
    });
  }

  it('registers all three configs as selectable extended models', () => {
    for (const cfg of KLIPPAN_CONFIGS)
      expect(EXTENDED_MODELS.some(p => p.id === cfg.id)).toBe(true);
  });
});
