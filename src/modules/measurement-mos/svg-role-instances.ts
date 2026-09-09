/** Keep separately drawn dimensions with the same printed label independently attached. */
export function separateSvgRoleInstances(root: Element): Map<string, string> {
  const displayLabels = new Map<string, string>();
  const nodes = Array.from(root.querySelectorAll('[id]'));
  for (const node of nodes) {
    const match = /^(mos\d+_)?m([A-Z][A-Z0-9-]*?)(cm|mm|in)_(\d+)_$/i.exec(node.id);
    if (!match) continue;
    const [, prefix = '', role, unit, suffix] = match;
    const original = nodes.find(el => el.id === `${prefix}m${role}${unit}`);
    // Illustrator often gives a wrapper a suffix around the original line.
    // That is one dimension; only separate genuinely distinct occurrences.
    if (!original || node.contains(original) || original.contains(node)) continue;
    const instance = `${role.toUpperCase()}-${Number(suffix) + 1}`;
    for (const kind of ['m', 'b', 'c']) {
      const id = `${prefix}${kind}${role}${unit}_${suffix}_`;
      const companion = nodes.find(el => el.id === id);
      if (companion) companion.id = `${prefix}${kind}${instance}${unit}`;
    }
    displayLabels.set(instance, role.toUpperCase());
  }
  return displayLabels;
}
