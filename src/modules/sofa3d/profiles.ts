import * as THREE from 'three';
import { DEFAULT_CONSTRUCTION, type SofaConstruction, type SofaPart } from './model';

/** Cross-sections follow the gallery: RA has a roll overhanging an inset upright. */
export function rolledArmOutline(
  width: number,
  height: number,
  construction: SofaConstruction = DEFAULT_CONSTRUCTION
): THREE.Shape {
  const x = width / 2,
    bottom = -height / 2,
    top = height / 2;
  const r = Math.min(construction.armRollRadius || width * 0.5, height * 0.4);
  const stem = x - Math.min(width * 0.95, construction.armStemWidth || width * 0.66);
  const flare = Math.min(construction.armFlare, width * 0.3);
  const shape = new THREE.Shape();
  shape.moveTo(stem + flare, bottom);
  shape.lineTo(x - flare * 0.25, bottom);
  shape.lineTo(x, top - r);
  shape.bezierCurveTo(x, top - r * 0.43, x - width * 0.18, top, 0, top);
  shape.bezierCurveTo(-width * 0.48, top, -x, top - r * 0.47, -x, top - r);
  shape.bezierCurveTo(-x, top - r * 1.6, stem - width * 0.05, top - r * 1.77, stem, top - r * 1.78);
  shape.lineTo(stem + flare, bottom);
  shape.closePath();
  return shape;
}
export function extrudeArm(
  part: SofaPart,
  construction: SofaConstruction = DEFAULT_CONSTRUCTION
): THREE.BufferGeometry {
  const { x: w, y: h, z: d } = part.size;
  const geometry = new THREE.ExtrudeGeometry(rolledArmOutline(w, h, construction), {
    depth: d,
    bevelEnabled: false,
    curveSegments: 24,
    steps: 1,
  });
  geometry.translate(0, 0, -d / 2);
  if (part.id.endsWith('arm-right')) {
    geometry.rotateY(Math.PI);
    geometry.computeVertexNormals();
  }
  return geometry;
}
/** Coordinates in the upper back's yz cross section, ordered around its perimeter. */
export function backProfile(depth: number, rise: number, construction: SofaConstruction) {
  const topDepth = Math.min(depth, construction.backTopThickness);
  const rake = Math.min(depth - topDepth, construction.backRake);
  const rear = -depth / 2,
    front = depth / 2;
  return [
    { z: rear, y: -rise / 2 },
    { z: front, y: -rise / 2 },
    { z: front - rake, y: rise / 2 },
    { z: front - rake - topDepth, y: rise / 2 - construction.backTopDrop },
  ];
}
export function extrudeBack(part: SofaPart, construction: SofaConstruction): THREE.BufferGeometry {
  const points = backProfile(part.size.z, part.size.y, construction);
  const shape = new THREE.Shape();
  points.forEach((p, i) => (i ? shape.lineTo(p.z, p.y) : shape.moveTo(p.z, p.y)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: part.size.x, bevelEnabled: false });
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const z = positions.getX(i),
      x = positions.getZ(i) - part.size.x / 2;
    positions.setXYZ(i, x, positions.getY(i), z);
  }
  // The axis permutation reverses winding.
  const index = geometry.index;
  if (index)
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
  else
    for (let i = 0; i < positions.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, i);
      const b = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
      positions.setXYZ(i, b.x, b.y, b.z);
      positions.setXYZ(i + 2, a.x, a.y, a.z);
    }
  geometry.computeVertexNormals();
  return geometry;
}
