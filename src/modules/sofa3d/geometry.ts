import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SofaDocument, SofaPart } from './model';
import { englishArmGeometry, flushBackToSkirt, roundedFrameGeometry } from './frame-upholstery';
import { cushionGeometry, skirtGeometry } from './upholstery';
import { extrudeArm, extrudeBack, slopeArmGeometry } from './profiles';
import { scannedFrameGeometry } from './scanned-frame';

/**
 * Single source of truth for part geometry, shared by the SofaRenderer and the
 * headless structural harness, so validation measures exactly what renders.
 * Vertex surgery branches are moved verbatim from the renderer build loop.
 */
export function buildPartGeometry(
  part: SofaPart,
  doc: SofaDocument,
  scanned = false
): THREE.BufferGeometry {
  const { x: w, y: h, z: d } = part.size;
  if (scanned && part.id === 'main:frame')
    return scannedFrameGeometry(
      doc.dimensions.width,
      doc.construction.frameHeight,
      doc.dimensions.depth
    );
  let geometry: THREE.BufferGeometry;
  if (part.role === 'skirt') geometry = skirtGeometry(part, doc.construction);
  else if (['seat', 'back', 'pillow'].includes(part.role)) geometry = cushionGeometry(part);
  else if (part.role === 'leg' && part.shape === 'round')
    geometry = new THREE.CylinderGeometry(w * 0.43, w * 0.34, h, 12);
  else if (part.role === 'arm' && doc.catalogueModel === 'pb-english-sleeper')
    geometry = englishArmGeometry(part);
  else if (part.role === 'arm' && part.shape === 'round')
    geometry = extrudeArm(part, doc.construction, doc.catalogueModel === 'pb-charleston' ? 13 : 0);
  else if (part.role === 'arm' && doc.catalogueModel?.startsWith('pb-york-slope'))
    geometry = slopeArmGeometry(part);
  else if (doc.catalogueModel?.startsWith('pb-york-slope') && part.id.endsWith('back-frame')) {
    geometry = roundedFrameGeometry(w, h, d, 3);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const upper = THREE.MathUtils.clamp(positions.getY(i) / h + 0.5, 0, 1);
      // Sweep the upper front face back so the backrest leans away above
      // the arm tails instead of rising as a flat wall behind them.
      const rake = THREE.MathUtils.smoothstep((upper - 0.55) / 0.45, 0, 1);
      if (positions.getZ(i) > 0) positions.setZ(i, positions.getZ(i) - 4 * rake * rake);
    }
    geometry.computeVertexNormals();
  } else if (doc.catalogueModel === 'pb-charleston' && part.id.endsWith('back-frame')) {
    geometry = roundedFrameGeometry(w, h, d, 5);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const u = positions.getX(i) / (w / 2);
      const upper = Math.max(0, positions.getY(i) / h + 0.5);
      positions.setY(i, positions.getY(i) + 6 * (1 - u * u) * upper);
      positions.setZ(i, positions.getZ(i) + 4 * u * u * upper);
    }
    geometry.computeVertexNormals();
  } else if (part.profile === 'raised-back') geometry = extrudeBack(part, doc.construction);
  else if (part.shape === 'knife' || part.shape === 'half-knife') {
    geometry = new THREE.SphereGeometry(1, 48, 32);
    const a = geometry.getAttribute('position');
    const power = (n: number, e: number) => Math.sign(n) * Math.pow(Math.abs(n), e);
    for (let i = 0; i < a.count; i++)
      a.setXYZ(
        i,
        (power(a.getX(i), 0.45) * w) / 2,
        (power(a.getY(i), 0.45) * h) / 2,
        (power(a.getZ(i), 0.9) * d) / 2
      );
    geometry.computeVertexNormals();
  } else {
    const radius =
      Math.min(w, h, d) *
      (part.shape === 'round'
        ? 0.46
        : part.shape === 'rounded'
          ? 0.36
          : part.role === 'leg'
            ? 0.035
            : part.role === 'frame'
              ? 0.07
              : 0.23);
    geometry = new RoundedBoxGeometry(w, h, d, 5, radius);
    if (part.shape === 'wedge') {
      const a = geometry.getAttribute('position');
      for (let i = 0; i < a.count; i++) {
        const factor = 0.66 + 0.34 * (0.5 - a.getY(i) / h);
        a.setX(i, a.getX(i) * factor);
      }
      geometry.computeVertexNormals();
    }
  }
  if (part.id.endsWith('back-frame') && doc.style.base !== 'snug') flushBackToSkirt(geometry, part);
  return geometry;
}
