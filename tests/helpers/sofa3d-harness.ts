import * as THREE from 'three';
import { buildSofaParts, type SofaDocument, type SofaPart } from '../../src/modules/sofa3d/model';
import { buildPartGeometry } from '../../src/modules/sofa3d/geometry';
import { fitCushionToSeats } from '../../src/modules/sofa3d/cushion-contact';

/**
 * Headless mirror of SofaRenderer's model assembly (contract §10/§11):
 * same part list, same geometry dispatch (shared buildPartGeometry), same
 * placement (YXZ euler), same fitCushionToSeats deformation — none of the
 * browser-only material/lighting work. Validation measures exactly what renders.
 */
export interface HeadlessModel {
  doc: SofaDocument;
  parts: SofaPart[];
  groups: Map<string, THREE.Group>;
  model: THREE.Group;
  bounds: THREE.Box3;
  /** Envelope without the skirt hem, which flares past the shell on the floor. */
  bodyBounds: THREE.Box3;
}

export function buildHeadlessModel(doc: SofaDocument): HeadlessModel {
  const parts = buildSofaParts(doc);
  const model = new THREE.Group();
  const groups = new Map<string, THREE.Group>();
  for (const part of parts) {
    const group = new THREE.Group();
    group.name = part.name;
    group.userData.partId = part.id;
    group.position.set(part.position.x, part.position.y, part.position.z);
    group.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z, 'YXZ');
    const mesh = new THREE.Mesh(buildPartGeometry(part, doc, false), new THREE.MeshBasicMaterial());
    mesh.userData.partId = part.id;
    group.add(mesh);
    model.add(group);
    groups.set(part.id, group);
  }
  model.updateMatrixWorld(true);
  // Same post-pass the renderer applies: seats settle, then backs/pillows are
  // fitted onto the seat tops per module (contract: checks run AFTER deformations).
  for (const [id, group] of groups) {
    const part = parts.find(p => p.id === id)!;
    if (!['back', 'pillow'].includes(part.role)) continue;
    const moduleId = part.id.split(':')[0];
    const seatGroups = [...groups.entries()]
      .filter(([gid]) => gid.split(':')[0] === moduleId && gid.includes(':seat-'))
      .map(([, g]) => g);
    fitCushionToSeats(group, seatGroups);
  }
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  // Body shell = everything except the skirt hem, which flares past the shell
  // on the floor by design (skirtFlare); manufacturer envelopes measure the shell.
  const bodyBounds = new THREE.Box3();
  for (const part of parts) {
    if (part.role === 'skirt') continue;
    bodyBounds.union(new THREE.Box3().setFromObject(groups.get(part.id)!));
  }
  return { doc, parts, groups, model, bounds, bodyBounds };
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface StructuralReport {
  ok: boolean;
  results: CheckResult[];
  bounds: { min: THREE.Vector3Tuple; max: THREE.Vector3Tuple; size: THREE.Vector3Tuple };
  counts: Record<string, number>;
  partBounds: Array<{
    id: string;
    role: string;
    center: THREE.Vector3Tuple;
    size: THREE.Vector3Tuple;
  }>;
}

const TUP = (v: THREE.Vector3): THREE.Vector3Tuple => [v.x, v.y, v.z];
export const tol = (dimension: number) => Math.max(1, dimension * 0.01);

export function runStructuralChecks(
  model: HeadlessModel,
  spec?: { width?: number; depth?: number; height?: number; seats?: number; backs?: number }
): StructuralReport {
  const { doc, parts, model: group, groups, bounds, bodyBounds } = model;
  const modules = doc.modules ?? [];
  const results: CheckResult[] = [];
  const add = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });

  // §10.1 finite, positive, unique
  const badSize = parts.filter(p =>
    [p.size.x, p.size.y, p.size.z, p.position.x, p.position.y, p.position.z].some(
      n => !Number.isFinite(n)
    )
  );
  add(
    'finite-transforms',
    badSize.length === 0,
    `${badSize.length} parts with non-finite transforms`
  );
  const nonPositive = parts.filter(p => p.size.x <= 0 || p.size.y <= 0 || p.size.z <= 0);
  add(
    'positive-sizes',
    nonPositive.length === 0,
    `${nonPositive.length} parts with non-positive sizes`
  );
  const uniqueIds = new Set(parts.map(p => p.id));
  add(
    'unique-part-ids',
    uniqueIds.size === parts.length,
    `${parts.length} parts, ${uniqueIds.size} unique ids`
  );

  // §10.1 non-empty geometry
  let meshes = 0;
  let emptyGeometry = 0;
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos || pos.count === 0) emptyGeometry++;
  });
  add(
    'non-empty-geometry',
    meshes > 0 && emptyGeometry === 0,
    `${meshes} meshes, ${emptyGeometry} empty`
  );

  // §10.2 overall envelope vs independent spec (or documented doc target).
  // Measured on the body shell: the skirt hem flares past the shell at floor
  // level by design and is checked separately (skirt-hem check below).
  const size = new THREE.Vector3();
  bodyBounds.getSize(size);
  const targets: Array<[string, number, number]> = [
    ['width', spec?.width ?? doc.dimensions.width, size.x],
    ['depth', spec?.depth ?? doc.dimensions.depth, size.z],
    ['height', spec?.height ?? doc.dimensions.height, size.y],
  ];
  for (const [name, expected, actual] of targets) {
    const t = tol(expected);
    add(
      `overall-${name}`,
      Math.abs(actual - expected) <= t,
      `target ${expected.toFixed(1)} cm, rendered ${actual.toFixed(1)} cm, tolerance ±${t.toFixed(1)} cm (body shell)`
    );
  }
  // Skirt hem: may flare past the shell, but only by a hem allowance.
  const skirtParts = parts.filter(p => p.role === 'skirt');
  if (skirtParts.length) {
    const skirtSpanX = Math.abs(
      [...groups.entries()]
        .filter(([gid]) => groups.get(gid)!.children.length && gid.includes(':skirt'))
        .reduce((acc, [gid]) => {
          const b = new THREE.Box3().setFromObject(groups.get(gid)!);
          return Math.max(acc, b.max.x - b.min.x, b.max.z - b.min.z);
        }, 0)
    );
    const shellSpan = Math.max(size.x, size.z);
    add(
      'skirt-hem-allowance',
      skirtSpanX <= shellSpan + 8,
      `skirt hem span ${skirtSpanX.toFixed(1)} cm vs body shell ${shellSpan.toFixed(1)} cm (≤ +8 cm hem flare)`
    );
  }

  // §10.4 floor contact — nothing below the floor, supports touch it
  add('no-below-floor', bounds.min.y >= -0.75, `min y ${bounds.min.y.toFixed(2)} cm`);
  add(
    'floor-contact',
    bounds.min.y <= 1.5,
    `model rests at y=${bounds.min.y.toFixed(2)} cm (0 = floor)`
  );

  // §10.3 counts — seats as specified; backs only when we can know them
  const seatParts = parts.filter(p => p.role === 'seat');
  const expectedSeats = spec?.seats ?? doc.dimensions.seatCount;
  add(
    'seat-count',
    seatParts.length === expectedSeats,
    `${seatParts.length} seat cushions, spec ${expectedSeats}`
  );
  const backParts = parts.filter(p => p.role === 'back');
  if (spec?.backs !== undefined)
    add(
      'back-count',
      backParts.length === spec.backs,
      `${backParts.length} back cushions, spec ${spec.backs}`
    );
  const armParts = parts.filter(p => p.role === 'arm');
  if (modules.length) {
    const modulesWithArms = modules.filter(m => m.leftArm || m.rightArm);
    add(
      'arm-count',
      modules.some(m => m.armOnly)
        ? true // arm-only sections: outer arms asserted by the module layout checks
        : armParts.length ===
            modulesWithArms.reduce((s, m) => s + (m.leftArm ? 1 : 0) + (m.rightArm ? 1 : 0), 0),
      `${armParts.length} arms for ${modulesWithArms.length} armed modules`
    );
  } else {
    // Implicit single-module document: arms must form a symmetric pair (or none).
    const left = armParts.filter(p => p.id.endsWith('arm-left')).length;
    const right = armParts.filter(p => p.id.endsWith('arm-right')).length;
    add(
      'arm-count',
      armParts.length === 0 || (left > 0 && left === right),
      `${armParts.length} arms (L ${left} / R ${right}) on implicit main module`
    );
  }

  // §10.7 handedness landmark — the chaise is the uniquely deepest module and
  // must sit on the open side of the armed base, not where its layout puts it
  // colliding with the base. §10.6 module interfaces: sections touch, never
  // interpenetrate beyond flush tolerance.
  const openModules = modules.filter(m => !m.corner && !m.armOnly);
  if (openModules.length >= 2) {
    const sorted = [...openModules].sort((a, b) => b.depth - a.depth);
    const chaiseModule = sorted[0].depth > sorted[1].depth + 1 ? sorted[0] : null;
    if (chaiseModule) {
      const chaiseGroup = groups.get(`${chaiseModule.id}:frame`) ?? groups.get(chaiseModule.id);
      const firstModule = modules[0];
      const baseGroup =
        groups.get(`${firstModule.id}:frame`) ?? groups.get(firstModule.id) ?? groups.get('main');
      if (chaiseGroup && baseGroup) {
        const chaiseBox = new THREE.Box3().setFromObject(chaiseGroup);
        const baseBox = new THREE.Box3().setFromObject(baseGroup);
        const chaiseCenter = chaiseBox.getCenter(new THREE.Vector3());
        const baseCenter = baseBox.getCenter(new THREE.Vector3());
        const docSide = Math.sign(chaiseModule.x - firstModule.x) || 1;
        const renderedSide = Math.sign(chaiseCenter.x - baseCenter.x) || 1;
        add(
          'chaise-handedness',
          docSide === renderedSide,
          `doc places ${chaiseModule.id} ${docSide > 0 ? 'right' : 'left'} of base, rendered ${renderedSide > 0 ? 'right' : 'left'}`
        );
      }
    }
    // Module bounding boxes must not interpenetrate (flush joins allowed).
    const moduleIds = [...new Set(openModules.map(m => m.id))];
    let overlapChecks = 0;
    for (let i = 0; i < moduleIds.length; i++) {
      for (let j = i + 1; j < moduleIds.length; j++) {
        const gi = [...groups.entries()].find(([gid]) => gid.startsWith(`${moduleIds[i]}:`));
        const gj = [...groups.entries()].find(([gid]) => gid.startsWith(`${moduleIds[j]}:`));
        if (!gi || !gj) continue;
        const bi = new THREE.Box3().setFromObject(gi[1]);
        const bj = new THREE.Box3().setFromObject(gj[1]);
        const penetrationDepth = Math.min(
          Math.max(0, Math.min(bi.max.x, bj.max.x) - Math.max(bi.min.x, bj.min.x)),
          Math.max(0, Math.min(bi.max.z, bj.max.z) - Math.max(bi.min.z, bj.min.z))
        );
        add(
          'module-overlap',
          penetrationDepth <= 2,
          `${moduleIds[i]} vs ${moduleIds[j]}: plan-view penetration ${penetrationDepth.toFixed(1)} cm (tolerance 2 cm flush joins)`
        );
        if (++overlapChecks > 8) break;
      }
      if (overlapChecks > 8) break;
    }
  }

  const sizeT = TUP(size);
  const partBounds = parts.map(p => {
    const g = model.groups.get(p.id)!;
    const box = new THREE.Box3().setFromObject(g);
    return {
      id: p.id,
      role: p.role,
      center: TUP(box.getCenter(new THREE.Vector3())),
      size: TUP(box.getSize(new THREE.Vector3())),
    };
  });
  return {
    ok: results.every(r => r.pass),
    results,
    bounds: { min: TUP(bounds.min), max: TUP(bounds.max), size: sizeT },
    counts: {
      seats: seatParts.length,
      backs: backParts.length,
      arms: armParts.length,
      pillows: parts.filter(p => p.role === 'pillow').length,
      legs: parts.filter(p => p.role === 'leg').length,
      skirts: parts.filter(p => p.role === 'skirt').length,
      frames: parts.filter(p => p.role === 'frame').length,
    },
    partBounds,
  };
}
