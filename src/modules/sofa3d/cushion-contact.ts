import * as THREE from 'three';

/** Resolve cushion/seat contact from rendered surfaces, including cushion rotation. */
export function fitCushionToSeats(cushion: THREE.Object3D, seats: THREE.Object3D[]): number {
  if (!seats.length) return 0;
  cushion.updateWorldMatrix(true, true);
  seats.forEach(seat => seat.updateWorldMatrix(true, true));
  const seatBounds = seats.map(seat => new THREE.Box3().setFromObject(seat));
  const vertices: THREE.Vector3[] = [];
  cushion.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    const p = obj.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      vertices.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(obj.matrixWorld));
  });
  // Keep the lowest point in each small footprint cell, including tilted corners.
  const samples = new Map<string, THREE.Vector3>();
  for (const p of vertices) {
    const key = `${Math.round(p.x / 2)},${Math.round(p.z / 2)}`;
    if (!samples.has(key) || samples.get(key)!.y > p.y) samples.set(key, p);
  }
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let lift = 0;
  const supportHeight = new Map<string, number>();
  for (const p of samples.values()) {
    const candidates = seats.filter(
      (_, i) =>
        p.x >= seatBounds[i].min.x &&
        p.x <= seatBounds[i].max.x &&
        p.z >= seatBounds[i].min.z &&
        p.z <= seatBounds[i].max.z
    );
    if (!candidates.length) continue;
    const top = Math.max(...seatBounds.map(b => b.max.y));
    if (p.y > top + 0.1) continue;
    ray.set(new THREE.Vector3(p.x, top + 1, p.z), down);
    const hit = ray.intersectObjects(candidates, true)[0];
    if (hit) {
      lift = Math.max(lift, hit.point.y - p.y);
      supportHeight.set(`${Math.round(p.x / 2)},${Math.round(p.z / 2)}`, hit.point.y + 0.04);
    }
  }
  if (lift > 0) {
    // Compress the lower fabric panel against the support rather than lifting
    // a tilted cushion onto one corner and leaving the rest floating.
    cushion.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      const p = obj.geometry.getAttribute('position');
      const inverse = obj.matrixWorld.clone().invert();
      for (let i = 0; i < p.count; i++) {
        const world = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(obj.matrixWorld);
        const floor = supportHeight.get(`${Math.round(world.x / 2)},${Math.round(world.z / 2)}`);
        if (floor !== undefined && world.y < floor) {
          world.y = floor;
          world.applyMatrix4(inverse);
          p.setXYZ(i, world.x, world.y, world.z);
        }
      }
      p.needsUpdate = true;
      obj.geometry.computeVertexNormals();
      obj.geometry.computeBoundingBox();
      obj.geometry.computeBoundingSphere();
    });
  }
  return lift;
}
