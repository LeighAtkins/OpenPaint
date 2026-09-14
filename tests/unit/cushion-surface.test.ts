import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createPopularModel } from '../../src/modules/sofa3d/popular-models';
import { buildSofaParts } from '../../src/modules/sofa3d/model';
import { cushionGeometry } from '../../src/modules/sofa3d/upholstery';
it('gives Harmony cushions filled panels with thin sewn edges and exact editable dimensions', () => {
  const parts = buildSofaParts(createPopularModel('harmony')).filter(p => p.shape === 'knife');
  expect(parts.length).toBeGreaterThan(0);
  for (const part of parts) {
    const geometry = cushionGeometry(part);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(part.size.x, 3);
    expect(size.y).toBeCloseTo(part.size.y, 3);
    expect(size.z).toBeCloseTo(part.size.z, 3);
    const position = geometry.getAttribute('position');
    let centre = 0,
      edge = 0;
    for (let i = 0; i < position.count; i++) {
      const x = Math.abs(position.getX(i)) / (part.size.x / 2),
        y = Math.abs(position.getY(i)) / (part.size.y / 2);
      if (x < 0.1 && y < 0.1) centre = Math.max(centre, Math.abs(position.getZ(i)));
      if (x > 0.98 && y < 0.5) edge = Math.max(edge, Math.abs(position.getZ(i)));
      expect(Number.isFinite(position.getZ(i))).toBe(true);
    }
    expect(centre).toBeGreaterThan(edge * 2);
    geometry.dispose();
  }
});
it('keeps the centre and notched outer seats equally full', () => {
  for (const id of ['ektorp', 'pb-basic']) {
    const seats = buildSofaParts(createPopularModel(id)).filter(p => p.role === 'seat');
    const frontHeights = seats.map(part => {
      const geometry = cushionGeometry(part);
      const positions = geometry.getAttribute('position');
      let low = Infinity,
        high = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        if (positions.getZ(i) > part.size.z * 0.47) {
          low = Math.min(low, positions.getY(i));
          high = Math.max(high, positions.getY(i));
        }
      }
      geometry.dispose();
      return (high - low) / part.size.y;
    });
    expect(Math.min(...frontHeights)).toBeGreaterThan(0.6);
    expect(Math.max(...frontHeights) - Math.min(...frontHeights)).toBeLessThan(0.08);
  }
});
