import { describe, expect, it } from 'vitest';
import {
  applySharedComparisonFabric,
  cleanCatalogueComparisonTitle,
  parseCatalogueComparisonInput,
} from '../../src/modules/ui/cw-catalogue-comparison';

const KRAMFORS_ORDER = `
https://comfort-works.com/products/kramfors-footstool-cover?_pos=1
https://comfort-works.com/products/kramfors-chaise-lounge-sofa-cover
https://comfort-works.com/products/kramfors-chaise-lounge-sofa-cover

1. IK-KS-0 Kramfors Footstool Cover
Code: LV, SHRT_SP, COS-105
2. IK-KS-2M Kramfors 2 Seater 1 Armrest Sofa Cover
Code: R, LV, LSKT_PM, COS-105
3. IK-KS-5M Kramfors Chaise Lounge Sofa Cover
Code: L, LV, LSKT_PM, COS-105
`;

const SODERHAMN_INTERNAL_ORDER = `
IK-SN-8 Soderhamn Armrest Cover (Pair)USD 139 x 1
USD 139
Original, Mod Chenille Espresso,
code: VELC_SP, ESTE-57,
IK-SN-5X Soderhamn Chaise Longue CoverUSD 399 x 1
USD 399
Original, Mod Chenille Espresso,
code: VELC_SP, ESTE-57,
IK-SN-3 Soderhamn 3-seater Sofa CoverUSD 579 x 1
USD 579
Original, Mod Chenille Espresso,
code: VELC_SP, ESTE-57,
`;

const FABRIC_SAMPLE_ORDER = `
swatch Fabric SamplesUSD 0 x 1
USD 0
Crypton® Chenille Cream,
code: BEN-02,
swatch Fabric SamplesUSD 0 x 1
USD 0
Care+ Linen Cream,
code: COS-103,
swatch Fabric SamplesUSD 0 x 1
USD 0
Mod Chenille Mist,
code: ESTE-92,
swatch Fabric SamplesUSD 0 x 1
USD 0
Everyday Cotton Pebble,
code: CVC-06,
`;

const SLATORP_ORDER = `
https://comfort-works.com/products/slatorp-3-seat-sofa-with-l-shape-chaise-sofa-cover
IK-SP-25 Slatorp 3-Seat Sofa, With L-Shape Chaise Sofa CoverEUR 379 x 1
EUR 379
Right Outward Chaise, Original, Mod Chenille Espresso,
code: R2, SHRT_SP, ESTE-57,
`;

describe('catalogue comparison input', () => {
  it('does not mistake comfort-works.com for a product reference', () => {
    const items = parseCatalogueComparisonInput(KRAMFORS_ORDER);
    expect(items.map(item => item.productReference)).toEqual(['IK-KS-0', 'IK-KS-2M', 'IK-KS-5M']);
  });

  it('matches copied URLs by product wording instead of copied position', () => {
    const items = parseCatalogueComparisonInput(KRAMFORS_ORDER);
    expect(items[0].handle).toBe('kramfors-footstool-cover');
    expect(items[1].handle).toBe('');
    expect(items[2].handle).toBe('kramfors-chaise-lounge-sofa-cover');
  });

  it('preserves structural configuration codes and detects the shared fabric', () => {
    const items = parseCatalogueComparisonInput(KRAMFORS_ORDER);
    expect(items[1].codes).toEqual(['R', 'LV', 'LSKT_PM', 'COS-105']);
    expect(items[2].codes).toEqual(['L', 'LV', 'LSKT_PM', 'COS-105']);
    expect(items.every(item => item.fabricCode === 'COS-105')).toBe(true);
  });

  it('changes only the shared fabric code', () => {
    const items = applySharedComparisonFabric(
      parseCatalogueComparisonInput(KRAMFORS_ORDER),
      'EYL-35'
    );
    expect(items[1].codes).toEqual(['R', 'LV', 'LSKT_PM', 'EYL-35']);
    expect(items[2].codes).toEqual(['L', 'LV', 'LSKT_PM', 'EYL-35']);
  });

  it('removes compact internal price and quantity suffixes from product titles', () => {
    expect(cleanCatalogueComparisonTitle('Soderhamn Armrest Cover (Pair)USD 139 x 1')).toBe(
      'Soderhamn Armrest Cover (Pair)'
    );
    expect(cleanCatalogueComparisonTitle('Soderhamn 3-seater Sofa Cover EUR 579 × 2')).toBe(
      'Soderhamn 3-seater Sofa Cover'
    );
  });

  it('parses copied Soderhamn order lines without turning prices into product handles', () => {
    const items = parseCatalogueComparisonInput(SODERHAMN_INTERNAL_ORDER);

    expect(items).toHaveLength(3);
    expect(items.map(item => item.productReference)).toEqual(['IK-SN-8', 'IK-SN-5X', 'IK-SN-3']);
    expect(items.map(item => item.title)).toEqual([
      'Soderhamn Armrest Cover (Pair)',
      'Soderhamn Chaise Longue Cover',
      'Soderhamn 3-seater Sofa Cover',
    ]);
    expect(items.every(item => item.handle === '' && item.url === '')).toBe(true);
    expect(items.every(item => item.fabricCode === 'ESTE-57')).toBe(true);
    expect(items.every(item => item.fabricName === 'Mod Chenille Espresso')).toBe(true);
    expect(items.every(item => item.styleName === 'Original')).toBe(true);
    expect(items.every(item => item.codes.join('|') === 'VELC_SP|ESTE-57')).toBe(true);
  });

  it('uses a shared fabric name without discarding the exact internal fabric code', () => {
    const items = applySharedComparisonFabric(
      parseCatalogueComparisonInput(SODERHAMN_INTERNAL_ORDER),
      'Mod Chenille Espresso'
    );

    expect(items.every(item => item.fabricName === 'Mod Chenille Espresso')).toBe(true);
    expect(items.every(item => item.fabricCode === 'ESTE-57')).toBe(true);
    expect(items.every(item => item.codes.join('|') === 'VELC_SP|ESTE-57')).toBe(true);
  });

  it('accepts a single catalogue product', () => {
    const items = parseCatalogueComparisonInput(`
IK-SN-3 Soderhamn 3-seater Sofa Cover
Original, Mod Chenille Espresso,
code: VELC_SP, ESTE-57,
`);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'product',
        productReference: 'IK-SN-3',
        fabricCode: 'ESTE-57',
      })
    );
  });

  it('preserves the exact Slatorp outward-chaise code and human configuration name', () => {
    const [item] = parseCatalogueComparisonInput(SLATORP_ORDER);

    expect(item).toEqual(
      expect.objectContaining({
        productReference: 'IK-SP-25',
        handle: 'slatorp-3-seat-sofa-with-l-shape-chaise-sofa-cover',
        title: 'Slatorp 3-Seat Sofa, With L-Shape Chaise Sofa Cover',
        codes: ['R2', 'SHRT_SP', 'ESTE-57'],
        styleName: 'Right Outward Chaise',
        fabricName: 'Mod Chenille Espresso',
      })
    );
  });

  it('parses copied fabric sample order lines as separate sample cards', () => {
    const items = parseCatalogueComparisonInput(FABRIC_SAMPLE_ORDER);

    expect(items).toHaveLength(4);
    expect(items.map(item => item.kind)).toEqual([
      'fabric-sample',
      'fabric-sample',
      'fabric-sample',
      'fabric-sample',
    ]);
    expect(items.map(item => item.fabricCode)).toEqual(['BEN-02', 'COS-103', 'ESTE-92', 'CVC-06']);
    expect(items.map(item => item.title)).toEqual([
      'Crypton® Chenille Cream',
      'Care+ Linen Cream',
      'Mod Chenille Mist',
      'Everyday Cotton Pebble',
    ]);
  });
});
