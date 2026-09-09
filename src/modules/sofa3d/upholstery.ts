import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SofaPart, SofaConstruction } from './model';

export function cushionPlan(part: SofaPart): THREE.Shape {
  const w = part.size.x / 2,
    d = part.size.z / 2,
    n = Math.min(12, part.size.x * 0.15),
    front = d * 0.48;
  let points: number[][];
  if (part.outline.startsWith('miter'))
    points =
      part.outline === 'miter-left'
        ? [
            [-w, -d + n],
            [w, -d],
            [w, d],
            [-w, d],
          ]
        : [
            [-w, -d],
            [w, -d + n],
            [w, d],
            [-w, d],
          ];
  else {
    const left = part.outline === 't' || part.outline === 't-left' ? n : 0,
      right = part.outline === 't' || part.outline === 't-right' ? n : 0;
    points = [
      [-w + left, -d],
      [w - right, -d],
      [w - right, front],
      [w, front],
      [w, d],
      [-w, d],
      [-w, front],
      [-w + left, front],
    ];
  }
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return shape;
}
function normalizeSize(geometry: THREE.BufferGeometry, part: SofaPart) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!,
    size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(part.size.x / size.x, part.size.y / size.y, part.size.z / size.z);
  geometry.computeVertexNormals();
  return geometry;
}
export function cushionGeometry(part: SofaPart): THREE.BufferGeometry {
  const { x: w, y: h, z: d } = part.size;
  const seat = part.role === 'seat';
  let geometry: THREE.BufferGeometry;
  if (part.outline !== 'rect') {
    geometry = new THREE.ExtrudeGeometry(
      cushionPlan(seat ? part : { ...part, size: { x: w, y: d, z: h } }),
      {
        depth: seat ? h : d,
        bevelEnabled: true,
        bevelSize: 1,
        bevelThickness: 1,
        bevelSegments: 3,
        steps: 3,
      }
    );
    if (seat) geometry.rotateX(Math.PI / 2);
    geometry.center();
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const dome =
        Math.max(0, 1 - Math.pow(x / (w / 2), 4)) *
        Math.max(0, 1 - Math.pow(seat ? z / (d / 2) : y / (h / 2), 4));
      if (seat) positions.setY(i, y + Math.sign(y) * part.loft * h * 0.24 * dome);
      else positions.setZ(i, z + Math.sign(z) * part.loft * d * 0.24 * dome);
      positions.setX(i, x * (1 + part.taper * (seat ? (z / d) * 2 : (y / h) * 2)));
    }
  } else if (part.shape === 'knife' || part.shape === 'half-knife') {
    geometry = new THREE.SphereGeometry(1, 64, 40);
    const positions = geometry.getAttribute('position');
    const power = (n: number, e: number) => Math.sign(n) * Math.pow(Math.abs(n), e);
    for (let i = 0; i < positions.count; i++) {
      let x = (power(positions.getX(i), 0.25 + part.softness * 0.27) * w) / 2;
      let y =
        (power(positions.getY(i), seat ? 1.8 - part.loft * 1.25 : 0.25 + part.softness * 0.27) *
          h) /
        2;
      let z =
        (power(positions.getZ(i), seat ? 0.25 + part.softness * 0.27 : 1.8 - part.loft * 1.25) *
          d) /
        2;
      x *= 1 + part.taper * (seat ? (z / d) * 2 : (y / h) * 2);
      // Half-knife retains a boxed lower edge and tapers toward the knife top.
      if (part.shape === 'half-knife') {
        if (seat) y *= 0.35 + 0.65 * (0.5 - z / d);
        else z *= 0.35 + 0.65 * (0.5 - y / h);
      }
      positions.setXYZ(i, x, y, z);
    }
  } else {
    geometry = new RoundedBoxGeometry(w, h, d, 12, Math.min(w, h, d) * (0.1 + part.softness * 0.3));
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      let x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const edge = seat
        ? Math.min(1, Math.pow(Math.abs(x / (w / 2)), 4) + Math.pow(Math.abs(z / (d / 2)), 4))
        : Math.min(1, Math.pow(Math.abs(x / (w / 2)), 4) + Math.pow(Math.abs(y / (h / 2)), 4));
      if (seat) y *= 1 - part.loft * 0.5 * edge;
      else z *= 1 - part.loft * 0.65 * edge;
      x *= 1 + part.taper * (seat ? (z / d) * 2 : (y / h) * 2);
      positions.setXYZ(i, x, y, z);
    }
  }
  return normalizeSize(geometry, part);
}
/** Four separate cloth panels, with recessed folds near each corner. */
export function skirtGeometry(
  part: SofaPart,
  construction: SofaConstruction
): THREE.BufferGeometry {
  const panels: THREE.BufferGeometry[] = [];
  const { x: w, y: h, z: d } = part.size;
  const attachment = part.skirtAttachment;
  for (let side = 0; side < 4; side++) {
    const length = side % 2 ? d : w,
      depth = side % 2 ? w : d;
    const panel = new THREE.PlaneGeometry(length, h, 140, 24);
    const positions = panel.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      let x = positions.getX(i);
      const y = positions.getY(i),
        drop = 0.5 - y / h;
      const distance = length / 2 - Math.abs(x);
      // Folds emerge below the seam rather than cutting gaps into its attachment.
      const pleat =
        -construction.skirtPleatDepth *
        Math.exp(-Math.pow((distance - 7) / 1.8, 2)) *
        Math.pow(drop, 0.6);
      const drape = Math.sin(x * 0.21) * 0.12 * drop * Math.min(1, distance / 3);
      let z = depth / 2 + construction.skirtFlare * drop + pleat + drape;
      x *= 1 + (2 * construction.skirtFlare * drop) / length;
      if (attachment && side === 0) {
        const wing = x < 0 ? attachment.leftWing : attachment.rightWing;
        const t = Math.max(0, Math.min(1, (distance - wing + 1) / 2));
        z += -attachment.setback * (1 - t) + attachment.projection * t;
      }
      if (attachment && side % 2) {
        // Both side panels terminate at the arm front rather than the projecting deck.
        const front = side === 1 ? -x : x;
        const t = Math.max(0, Math.min(1, (front + length / 2) / length));
        x += (side === 1 ? 1 : -1) * attachment.setback * t;
      }
      positions.setXYZ(i, x, y, z);
    }
    panel.rotateY((side * Math.PI) / 2);
    panels.push(panel);
  }
  const result = mergeGeometries(panels);
  panels.forEach(p => p.dispose());
  result.computeVertexNormals();
  return result;
}

/** Trace the actual deformed mesh so piping follows loft, taper and notches. */
export function cushionPiping(
  part: SofaPart,
  geometry: THREE.BufferGeometry
): THREE.BufferGeometry | null {
  const probe = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const points: THREE.Vector3[] = [];
  const seat = part.role === 'seat',
    radius = Math.max(part.size.x, part.size.y, part.size.z) * 2;
  for (let i = 0; i < 128; i++) {
    const angle = (i / 128) * Math.PI * 2,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const origin = seat
      ? new THREE.Vector3(c * radius, part.size.y * 0.24, s * radius)
      : new THREE.Vector3(c * radius, s * radius, 0);
    const direction = seat ? new THREE.Vector3(-c, 0, -s) : new THREE.Vector3(-c, -s, 0);
    ray.set(origin, direction);
    const hit = ray.intersectObject(probe, false)[0];
    if (hit) points.push(hit.point.clone().addScaledVector(direction, -0.07));
  }
  (probe.material as THREE.Material).dispose();
  if (points.length < 16) return null;
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points, true, 'centripetal'),
    160,
    0.12,
    4,
    true
  );
}
