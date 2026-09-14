import { expect, it } from 'vitest';
import * as THREE from 'three';
import { fitCushionToSeats } from '../../src/modules/sofa3d/cushion-contact';
it('fits tilted cushion vertices to the seat without lifting its top or changing its position', () => {
  const seat = new THREE.Mesh(new THREE.BoxGeometry(100, 10, 100), new THREE.MeshBasicMaterial());
  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(30, 30, 12, 12, 12, 6),
    new THREE.MeshBasicMaterial()
  );
  cushion.position.y = 16;
  cushion.rotation.z = 0.3;
  cushion.updateMatrixWorld(true);
  const before = new THREE.Box3().setFromObject(cushion).max.y;
  expect(fitCushionToSeats(cushion, [seat])).toBeGreaterThan(0);
  const p = cushion.geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const world = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(cushion.matrixWorld);
    expect(world.y).toBeGreaterThanOrEqual(4.999);
  }
  expect(cushion.position.y).toBe(16);
  expect(new THREE.Box3().setFromObject(cushion).max.y).toBeCloseTo(before, 4);
  expect(fitCushionToSeats(cushion, [seat])).toBe(0);
  seat.geometry.dispose();
  cushion.geometry.dispose();
});
