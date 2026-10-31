import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createExtendedModel, EXTENDED_MODELS } from '../../src/modules/sofa3d/extended-models';
import { buildHeadlessModel, runStructuralChecks } from '../helpers/sofa3d-harness';

const SPECS = path.resolve(__dirname, '../../data/comfort-works/sofa3d-build/specs');

const YORK_SPECS = fs
  .readdirSync(SPECS)
  .filter(f => f.startsWith('PB-') && f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(SPECS, f), 'utf8')));

describe('york family — spec-frozen structural checks (OMS tier-1 dims)', () => {
  it('has a frozen spec and registry entry for every config', () => {
    expect(YORK_SPECS.length).toBe(16);
    for (const spec of YORK_SPECS)
      expect(EXTENDED_MODELS.some(p => p.id === spec.sofa3dModelId)).toBe(true);
  });

  for (const spec of YORK_SPECS) {
    it(`matches its OMS envelope: ${spec.sofa3dModelId} (${spec.configurationId})`, () => {
      const doc = createExtendedModel(spec.sofa3dModelId);
      expect(doc.dimensions.width).toBe(spec.envelope.width);
      expect(doc.dimensions.depth).toBe(spec.envelope.depth);
      expect(doc.dimensions.height).toBe(spec.envelope.height);

      const model = buildHeadlessModel(doc);
      const report = runStructuralChecks(model, {
        width: spec.envelope.width,
        depth: spec.envelope.depth,
        height: spec.envelope.height,
        seats: spec.layout.seats,
        backs: spec.layout.backs,
      });
      for (const check of report.results) {
        if (!check.pass) throw new Error(`${spec.sofa3dModelId}/${check.name}: ${check.detail}`);
      }

      // Seat-top landmark: PB spec 45.7 cm, measured compressed at the front
      // edge; the rendered lofted crown peaks higher — recorded semantic
      // exception (spec semantics.seatHeightNote), so ±3 cm on the crown.
      const seatTop = report.partBounds
        .filter(p => p.role === 'seat')
        .reduce((max, p) => Math.max(max, p.center[1] + p.size[1] / 2), 0);
      expect(Math.abs(seatTop - 45.7)).toBeLessThanOrEqual(3);
    });
  }
});
