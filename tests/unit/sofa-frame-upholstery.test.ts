import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createPopularModel } from '../../src/modules/sofa3d/popular-models';
import { buildSofaParts } from '../../src/modules/sofa3d/model';
import {
  englishArmGeometry,
  roundedFrameGeometry,
  flushBackToSkirt,
  backCrownSeam,
} from '../../src/modules/sofa3d/frame-upholstery';

it('puts the notches on the outer backs, not on the seats', () => {
  for (const id of ['ektorp', 'pb-basic']) {
    const parts = buildSofaParts(createPopularModel(id));
    expect(parts.filter(p => p.role === 'seat').map(p => p.outline)).toEqual([
      'rect',
      'rect',
      'rect',
    ]);
    expect(parts.filter(p => p.role === 'back').map(p => p.outline)).toEqual([
      'rl-left',
      'rect',
      'rl-right',
    ]);
  }
});
it('gives the English arm a scooped top and an editable sleeper state', () => {
  const doc = createPopularModel('pb-english-sleeper');
  const part = buildSofaParts(doc).find(p => p.role === 'arm')!;
  const mesh = new THREE.Mesh(
    englishArmGeometry(part),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const height = (z: number) => {
    ray.set(new THREE.Vector3(0, 100, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(mesh)[0].point.y;
  };
  expect(height(-part.size.z * 0.35)).toBeGreaterThan(height(0) + 5);
  expect(height(part.size.z * 0.4)).toBeGreaterThan(height(0));
  doc.sleeper!.open = true;
  expect(buildSofaParts(doc).some(p => p.id.endsWith('bed-extension'))).toBe(true);
  mesh.geometry.dispose();
});
it('joins the rear panel to the skirt plane and traces a top seam', () => {
  const part = buildSofaParts(createPopularModel('pb-charleston')).find(
    p => p.id === 'main:back-frame'
  )!;
  const geometry = roundedFrameGeometry(part.size.x, part.size.y, part.size.z, 5);
  flushBackToSkirt(geometry, part);
  const positions = geometry.getAttribute('position');
  let checked = 0;
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) < -part.size.y / 2 + 0.001 && positions.getZ(i) < 0) {
      expect(positions.getZ(i)).toBeCloseTo(-part.size.z / 2, 4);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
  const seam = backCrownSeam(geometry, part);
  expect(seam).not.toBeNull();
  seam?.dispose();
  geometry.dispose();
});

it('packs the English L seats by their rear section rather than their front wings', () => {
  const parts = buildSofaParts(createPopularModel('pb-english-sleeper'));
  const seats = parts.filter(p => p.role === 'seat');
  expect(seats.map(p => p.outline)).toEqual(['rl-left', 'rl-right']);
  expect(parts.filter(p => p.role === 'back').map(p => p.outline)).toEqual(['rl-left', 'rl-right']);
  const leftInner = seats[0].position.x + seats[0].size.x / 2;
  const rightInner = seats[1].position.x - seats[1].size.x / 2;
  expect(rightInner - leftInner).toBeCloseTo(1.4, 3);
});
