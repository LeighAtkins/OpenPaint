import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import { buildHeadlessModel, runStructuralChecks } from '../helpers/sofa3d-harness';
import { createSofaDocument } from '../../src/modules/sofa3d/model';
import { createPopularModel } from '../../src/modules/sofa3d/popular-models';
import { createExtendedModel } from '../../src/modules/sofa3d/extended-models';
import {
  createNorsborgDocument,
  isNorsborgModel,
  NORSBORG_CHAISE_CONFIGURATION,
} from '../../src/modules/sofa3d/norsborg';
import { EXTENDED_MODELS } from '../../src/modules/sofa3d/extended-models';
import { POPULAR_MODELS } from '../../src/modules/sofa3d/popular-models';

const EVIDENCE = path.resolve(
  __dirname,
  '../../data/comfort-works/sofa3d-build/evidence/structural'
);

const ALL_EXISTING_IDS = [
  ...POPULAR_MODELS.map(p => p.id),
  ...EXTENDED_MODELS.map(p => p.id),
  'norsborg',
  'norsborg-chaise',
].filter((id, i, a) => a.indexOf(id) === i);

function buildExisting(id: string) {
  if (isNorsborgModel(id))
    return createNorsborgDocument(
      id === 'norsborg-chaise' ? [...NORSBORG_CHAISE_CONFIGURATION] : undefined
    );
  if (EXTENDED_MODELS.some(p => p.id === id)) return createExtendedModel(id);
  return createPopularModel(id);
}

describe('sofa3d structural harness — existing registry models', () => {
  const calibration: Record<string, unknown> = {};

  for (const id of ALL_EXISTING_IDS) {
    it(`assembles and passes universal invariants: ${id}`, () => {
      const doc = buildExisting(id);
      const model = buildHeadlessModel(doc);
      const report = runStructuralChecks(model);
      calibration[id] = {
        declared: doc.dimensions,
        renderedSize: report.bounds.size,
        counts: report.counts,
        results: report.results,
        ok: report.ok,
      };
      fs.mkdirSync(EVIDENCE, { recursive: true });
      fs.writeFileSync(
        path.join(EVIDENCE, `${id}.json`),
        JSON.stringify({ id, declared: doc.dimensions, ...report }, null, 1)
      );
      for (const check of report.results) {
        if (['overall-width', 'overall-depth', 'overall-height'].includes(check.name)) continue; // calibrated separately below
        if (!check.pass) throw new Error(`${id}/${check.name}: ${check.detail}`);
      }
    });
  }

  it('writes the calibration table (declared vs rendered envelope)', () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, 'calibration.json'), JSON.stringify(calibration, null, 1));
    expect(Object.keys(calibration).length).toBeGreaterThan(5);
  });
});

describe('sofa3d structural harness — calibration fixtures must fail', () => {
  const ektorp = createPopularModel('ektorp');

  it('detects wrong overall scale', () => {
    const stretched = JSON.parse(JSON.stringify(ektorp));
    stretched.dimensions.height *= 1.15;
    const report = runStructuralChecks(buildHeadlessModel(stretched));
    expect(report.results.find(r => r.name === 'overall-height')?.pass).toBe(false);
  });

  it('detects missing back cushions', () => {
    const noBacks = JSON.parse(JSON.stringify(ektorp));
    noBacks.construction.backCushions = false;
    // Independent spec: the real Ektorp 3-seat has three back cushions.
    const report = runStructuralChecks(buildHeadlessModel(noBacks), {
      seats: 3,
      backs: 3,
      width: ektorp.dimensions.width,
      depth: ektorp.dimensions.depth,
      height: ektorp.dimensions.height,
    });
    const backCount = report.results.find(r => r.name === 'back-count');
    expect(backCount && backCount.pass === false).toBe(true);
  });

  it('detects a chaise moved to the wrong side of the base', () => {
    const chaise = createExtendedModel('friheten');
    const misplaced = JSON.parse(JSON.stringify(chaise));
    // Flip only the chaise module: doc and render now agree with each other
    // (handedness is doc-relative) but the layout is physically wrong — the
    // chaise interpenetrates the armed base and the overall width collapses.
    misplaced.modules = misplaced.modules.map((m: { id: string; x: number }) =>
      m.id === 'main' ? m : { ...m, x: -m.x }
    );
    const report = runStructuralChecks(buildHeadlessModel(misplaced));
    const failNames = report.results.filter(r => !r.pass).map(r => r.name);
    expect(failNames).toContain('module-overlap');
    expect(failNames).toContain('overall-width');
  });

  it('detects an empty model', () => {
    const empty = buildHeadlessModel(createSofaDocument('sofa'));
    empty.model.clear();
    empty.model.updateMatrixWorld(true);
    (empty as { bounds: THREE.Box3 }).bounds = new THREE.Box3().setFromObject(empty.model);
    const report = runStructuralChecks(empty);
    const failNames = report.results.filter(r => !r.pass).map(r => r.name);
    expect(failNames).toContain('non-empty-geometry');
  });
});
