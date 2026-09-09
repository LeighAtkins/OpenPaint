/** Explicit gallery assignments take precedence over code-pattern inference. */
const productTypeOverrides: Readonly<Record<string, string>> = {
  'CS3X-NA': 'sectional',
  'CS1X-NA': 'sectional',
  'CSS-RA-HB': 'sectional',
  'CCL-CH-L': 'cushion',
  'CCL-CH-R': 'cushion',
  'CSXOXO-SQ': 'cushion',
  'ROUNDED-FRONT': 'cushion',
  'ROUND-OTTOMAN': 'ottoman',
  'CS-X': 'misc',
  'ST-CS3L': 'misc',
  'CS3X-RA-RB': 'misc',
  'WA2-HB-L': 'misc',
  'NA-R': 'misc',
  'NA-S': 'misc',
  'NA-HB': 'misc',
  'NA-RB': 'misc',
};
export function getGuideProductTypeOverride(code: string): string | undefined {
  return Object.hasOwn(productTypeOverrides, code) ? productTypeOverrides[code] : undefined;
}

/** Construction codes: SRA/SSA/SWA/SSLA identify a single arm. */
export function getGuideSeatingType(code: string): string | undefined {
  if (['CS5B-RA-SB', 'CS5B-SA-HB', 'CS5B-SA-SB'].includes(code)) return 'armchair';
  if (/^CS1-CNR(?:-|$)/.test(code)) return 'sectional';
  if (/^CS4[A-Z0-9]*(?:-|$)/.test(code)) return 'reclaim';
  if (!/^CS[13][A-Z0-9]*(?:-|$)/.test(code)) return undefined;
  const parts = code.split('-');
  const singleArm =
    parts.some(part => /^S(?:RA|SA|WA|SLA)\d*$/.test(part)) || /-(?:L|R)$/.test(code);
  if (singleArm) return 'sectional';
  if (
    /^CS1[A-Z0-9]*(?:-|$)/.test(code) &&
    parts.some(part => /^(?:RA|SA|WA|ERA|SLA)\d*$/.test(part))
  ) {
    return 'armchair';
  }
  return undefined;
}
