import { roundedFrameGeometry } from './frame-upholstery';
import * as THREE from 'three';
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
    // Use filled panels for notched seats too, rather than flat extruded caps.
    geometry = cushionGeometry({ ...part, outline: 'rect' });
    const positions = geometry.getAttribute('position');
    const notch = Math.min(12, w * 0.15);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        z = positions.getZ(i);
      const rear = seat
        ? 1 - THREE.MathUtils.smoothstep(z, d * 0.17, d * 0.3)
        : 1 - THREE.MathUtils.smoothstep(positions.getY(i), -h * 0.3, -h * 0.17);
      let left = 0,
        right = 0;
      if (['t', 't-left'].includes(part.outline)) left = notch * rear;
      if (['t', 't-right'].includes(part.outline)) right = notch * rear;
      if (part.outline.startsWith('rl-')) {
        const n = Math.min(w * 0.23, (seat ? d : h) * 0.28);
        const coordinate = seat ? z : positions.getY(i);
        const length = seat ? d : h;
        const drop = THREE.MathUtils.clamp(
          (length / 2 - (part.notchDrop ?? length * 0.33) - coordinate) / n,
          0,
          1
        );
        const inset = n * Math.sqrt(Math.max(0, 1 - (1 - drop) * (1 - drop)));
        if (part.outline === 'rl-left') left = inset;
        else right = inset;
      }
      if (part.outline.startsWith('miter')) {
        const side = part.outline === 'miter-left' ? -1 : 1;
        positions.setZ(i, z + notch * rear * (0.5 - (side * x) / w));
      }
      positions.setX(i, -w / 2 + left + (x / w + 0.5) * (w - left - right));
    }
  } else if (part.shape === 'knife' || part.shape === 'half-knife') {
    // Sewn panels meet at a narrow perimeter; the centre carries the filling.
    // A rounded sphere cannot reproduce the square corners and pinched seam.
    geometry = new THREE.BoxGeometry(w, h, d, 40, seat ? 8 : 40, seat ? 40 : 8);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      let x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const u = x / (w / 2),
        v = seat ? z / (d / 2) : y / (h / 2);
      const panel = Math.pow(Math.max(0, (1 - u * u * u * u) * (1 - v * v * v * v)), 0.42);
      const fullness = 0.1 + 0.9 * panel;
      const phase = [...part.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) * 0.37;
      // A few seam-origin creases, rather than regular ripples around every edge.
      const crease =
        Math.exp(-Math.pow((u - 0.68) / 0.09, 2)) -
        0.65 * Math.exp(-Math.pow((u + 0.52) / 0.12, 2));
      const folds =
        -crease * Math.exp(-Math.pow((v + 0.82) / 0.23, 2)) * panel * part.softness * 0.12;
      const thickness = fullness + folds;
      if (seat) y *= thickness;
      else {
        z *= thickness;
        // Filling settles toward the lower panel, leaving a softer upper edge.
        y -= part.softness * Math.min(1.6, h * 0.04) * (1 - u * u) * (1 - v * v);
        z *= 1 - 0.18 * v * part.softness;
        // Soft upper edge and unequal lobes give the panel a relaxed silhouette.
        y -=
          h *
          0.095 *
          part.softness *
          Math.exp(-Math.pow((u - 0.16) / 0.65, 2)) *
          Math.pow(Math.max(0, (v + 1) / 2), 4);
        z += d * 0.018 * panel * Math.sin(u * 3.1 + phase) * part.softness;
        x += w * 0.008 * panel * Math.sin(v * 2.4 + phase) * part.softness;
      }
      x *= (1 + part.taper * v) * (1 - 0.045 * Math.pow(Math.abs(v), 8));
      if (seat) z *= 1 - 0.045 * Math.pow(Math.abs(u), 8);
      else y *= 1 - 0.045 * Math.pow(Math.abs(u), 8);
      if (part.shape === 'half-knife') {
        const boxedEdge = 0.5 - v * 0.5;
        if (seat) y = y * (1 - boxedEdge * 0.35) + positions.getY(i) * boxedEdge * 0.35;
        else z = z * (1 - boxedEdge * 0.35) + positions.getZ(i) * boxedEdge * 0.35;
      }
      positions.setXYZ(i, x, y, z);
    }
  } else if (seat) {
    // A boxed seat has a low gusset and a broad filled upper panel, not a flat slab.
    geometry = new THREE.BoxGeometry(w, h, d, 48, 12, 48);
    const positions = geometry.getAttribute('position');
    const radius = Math.min(w, d) * 0.055;
    for (let i = 0; i < positions.count; i++) {
      let x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const u = x / (w / 2),
        v = z / (d / 2),
        t = y / h + 0.5;
      const crown = Math.pow(Math.max(0, (1 - u * u) * (1 - v * v)), 0.62);
      const cx = Math.max(-w / 2 + radius, Math.min(w / 2 - radius, x));
      const cz = Math.max(-d / 2 + radius, Math.min(d / 2 - radius, z));
      const dx = x - cx,
        dz = z - cz,
        length = Math.hypot(dx, dz);
      if (length > radius) {
        x = cx + (dx * radius) / length;
        z = cz + (dz * radius) / length;
      }
      // Keep the underside supported; the crown takes most of the thickness.
      y = -h / 2 + h * t * (0.65 + 0.35 * crown);
      const bulge = 1 + 0.018 * Math.sin(t * Math.PI);
      positions.setXYZ(i, x * bulge, y, z * bulge);
    }
  } else {
    geometry = roundedFrameGeometry(w, h, d, Math.min(w, h, d) * (0.1 + part.softness * 0.3));
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
      ? new THREE.Vector3(c * radius, -part.size.y * 0.3, s * radius)
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
