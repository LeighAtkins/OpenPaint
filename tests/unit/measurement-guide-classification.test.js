import { describe, expect, test } from 'vitest';
import {
  getGuideProductType,
  getGuideSeatCount,
} from '../../src/modules/ui/measurement-guide-flash.js';

describe('measurement guide product classification', () => {
  test.each([
    ['CS3X-NA', 'sectional'],
    ['CS1X-NA', 'sectional'],
    ['CSS-RA-HB', 'sectional'],
    ['CCL-CH-L', 'cushion'],
    ['CCL-CH-R', 'cushion'],
    ['CSXOXO-SQ', 'cushion'],
    ['ROUNDED-FRONT', 'cushion'],
    ['ROUND-OTTOMAN', 'ottoman'],
    ['CS-X', 'misc'],
    ['ST-CS3L', 'misc'],
    ['CS3X-RA-RB', 'misc'],
    ['WA2-HB-L', 'misc'],
    ['NA-R', 'misc'],
    ['NA-S', 'misc'],
    ['NA-HB', 'misc'],
    ['NA-RB', 'misc'],
    ['CS4-SSA-HB-L', 'reclaim'],
    ['CS4-SSA-SB-R', 'reclaim'],
    ['CS1B-RA-HB', 'armchair'],
    ['CS1L-ERA-HB', 'armchair'],
    ['CS1B-SA-SB', 'armchair'],
    ['CS1B-SRA-HB-L', 'sectional'],
    ['CS1B-SWA2-SB-R', 'sectional'],
    ['CS3B-SSA-HB-R', 'sectional'],
    ['CS3B-SSLA2-SB', 'sectional'],
    ['CS3B-SLA-HB', 'sofa'],
    ['CS1-CNR', 'sectional'],
    ['CS1-CNR-W', 'sectional'],
    ['CS0-CNRP', 'ottoman'],
    ['CS0-CNRP-V2', 'ottoman'],
    ['CS5B-RA-SB', 'armchair'],
    ['CS5B-SA-HB', 'armchair'],
    ['CS5B-SA-SB', 'armchair'],
    ['CS5L-RA-SB', 'chaise'],
    ['CSDC-MSKT', 'dining-chair'],
    ['CC-BK-BE', 'cushion'],
    ['CSAP-RA', 'other'],
  ])('classifies %s as %s', (code, expectedType) => {
    expect(getGuideProductType(code)).toBe(expectedType);
  });

  test.each([
    ['CS1B-SA-SB', '1'],
    ['CS3L-RA-HB', '3'],
    ['CS4-SSA-SB-L', '4'],
  ])('extracts the seat count only from sofa code %s', (code, expectedCount) => {
    expect(getGuideSeatCount(code)).toBe(expectedCount);
  });

  test.each(['CS0-CNRP', 'CS5B-RA-SB', 'CSDC-MSKT', 'CC-BK-BE', 'CSAP-RA'])(
    'does not present %s as a seat count',
    code => {
      expect(getGuideSeatCount(code)).toBe('');
    }
  );

  test('uses the manifest category for unique codes with no recognizable prefix', () => {
    expect(getGuideProductType('SPECIAL-01', 'Dining Chair')).toBe('dining-chair');
    expect(getGuideProductType('SPECIAL-02', 'Ottoman')).toBe('ottoman');
    expect(getGuideProductType('SPECIAL-03', 'Cushions')).toBe('cushion');
  });
});
