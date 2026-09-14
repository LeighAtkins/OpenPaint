import * as THREE from 'three';
import type { SofaPart } from './model';

/** Dense panels retain enough vertices for a continuous sweep along the frame. */
export function roundedFrameGeometry(
  w: number,
  h: number,
  d: number,
  radius: number
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d, 48, 16, 48);
  const positions = geometry.getAttribute('position');
  const point = new THREE.Vector3(),
    core = new THREE.Vector3(),
    delta = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    core.set(
      THREE.MathUtils.clamp(point.x, -w / 2 + radius, w / 2 - radius),
      THREE.MathUtils.clamp(point.y, -h / 2 + radius, h / 2 - radius),
      THREE.MathUtils.clamp(point.z, -d / 2 + radius, d / 2 - radius)
    );
    delta.copy(point).sub(core).normalize().multiplyScalar(radius);
    point.copy(core).add(delta);
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Low English arm: padded front, scooped middle, rising into the rear frame. */
export function englishArmGeometry(part: SofaPart): THREE.BufferGeometry {
  const { x: w, y: h, z: d } = part.size;
  const geometry = roundedFrameGeometry(w, h, d, Math.min(7, w * 0.35));
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const t = THREE.MathUtils.clamp(0.5 - positions.getZ(i) / d, 0, 1);
    const upper = THREE.MathUtils.clamp(positions.getY(i) / h + 0.5, 0, 1);
    const rise = 18 * t * t - 10 * Math.sin(t * Math.PI);
    const side = part.id.endsWith('arm-left') ? -1 : 1;
    const roll = Math.exp(-Math.pow((upper - 0.78) / 0.24, 2));
    const outer = (side * w) / 2;
    positions.setX(i, outer + (positions.getX(i) - outer) * (0.62 + 0.38 * roll));
    positions.setY(i, positions.getY(i) + rise * upper);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Keep the lower rear panel on the same plane as the skirt attachment. */
export function flushBackToSkirt(geometry: THREE.BufferGeometry, part: SofaPart): void {
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const blend =
      1 - THREE.MathUtils.smoothstep(positions.getY(i), -part.size.y / 2, -part.size.y / 2 + 8);
    if (positions.getZ(i) < 0)
      positions.setZ(i, THREE.MathUtils.lerp(positions.getZ(i), -part.size.z / 2, blend));
  }
  geometry.computeVertexNormals();
}

/** Follow the actual crown so the back seam remains attached when resized. */
export function backCrownSeam(
  geometry: THREE.BufferGeometry,
  part: SofaPart
): THREE.BufferGeometry | null {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const probe = new THREE.Mesh(geometry, material);
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(),
    points: THREE.Vector3[] = [];
  for (let i = 0; i <= 100; i++) {
    ray.set(
      new THREE.Vector3(
        part.size.x * (-0.48 + (0.96 * i) / 100),
        part.size.y + 20,
        -part.size.z * 0.24
      ),
      new THREE.Vector3(0, -1, 0)
    );
    const hit = ray.intersectObject(probe)[0];
    if (hit) points.push(hit.point.clone().add(new THREE.Vector3(0, 0.12, 0)));
  }
  material.dispose();
  return points.length > 2
    ? new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 120, 0.14, 5, false)
    : null;
}
