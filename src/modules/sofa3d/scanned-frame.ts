import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
let source: THREE.BufferGeometry | undefined;
let pending: Promise<void> | undefined;
export function scannedFrameReady(): boolean {
  return !!source;
}
export function loadScannedFrame(): Promise<void> {
  return (pending ||= fetch('/models/pb-english-frame.bin')
    .then(async response => {
      if (!response.ok) throw new Error('Could not load the English sofa scan.');
      const positions = new Float32Array(await response.arrayBuffer());
      source = new THREE.BufferGeometry();
      source.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const welded = mergeVertices(source, 0.00001);
      source.dispose();
      source = welded;
      source.computeVertexNormals();
      // World-scaled fabric coordinates, independent of the original pink upholstery.
      const points = source.getAttribute('position');
      const uv = new Float32Array(points.count * 2);
      for (let i = 0; i < points.count; i++) {
        uv[i * 2] = points.getX(i) + points.getZ(i);
        uv[i * 2 + 1] = points.getY(i);
      }
      source.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    })
    .catch(error => {
      pending = undefined;
      throw error;
    }));
}
export function scannedFrameGeometry(
  width: number,
  height: number,
  depth: number
): THREE.BufferGeometry {
  if (!source) throw new Error('Scan is not loaded.');
  return source.clone().scale(width, height, depth);
}
