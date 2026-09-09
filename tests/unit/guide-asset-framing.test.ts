import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { stripSvgLabels } from '../../src/modules/ui/measurement-guide-flash.js';
const base = 'public/measurement-guides/Modular MT /';
it('frames NA-S around its artwork instead of the empty page', () => {
  const svg = readFileSync(base + 'Arm Shape/Nose Square, High back/-NA-S.svg', 'utf8');
  expect(svg).toContain('viewBox="82 164 712 543"');
});
it.each([
  ['Cushions/Bolster/Archive/-BOL (1).svg', ['A', 'B', 'C', 'D']],
  ['Ottoman/Round Ottoman/Round Ottoman.svg', ['A', 'B', 'C', 'D', 'E']],
])('keeps %s measurements separate from the furniture raster', (path, roles) => {
  const svg = readFileSync(base + path, 'utf8');
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  for (const role of roles) {
    expect(doc.querySelector(`[id="m${role}cm"]`)).not.toBeNull();
    expect(doc.querySelector(`[id="c${role}cm"]`)?.textContent).toBe(role);
  }
  const cleaned = new DOMParser().parseFromString(stripSvgLabels(svg), 'image/svg+xml');
  expect(cleaned.querySelectorAll('g[id^="m"]')).toHaveLength(0);
  expect(cleaned.querySelector('circle,ellipse,path')).not.toBeNull();
});
