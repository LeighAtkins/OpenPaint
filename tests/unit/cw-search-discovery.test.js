import { describe, expect, it } from 'vitest';
import {
  buildLoadSelectedSearchBody,
  buildSelectedQcLookupCandidates,
  buildDiscoveredProductResult,
  buildPublicNameFastPathQuery,
  buildComparisonConfigurationGroups,
  buildDirectCatalogueImageUrl,
  extractStorefrontProductJsonVariants,
  cleanStorefrontComparisonTitle,
  getDiscoveryQueryMode,
  getManualReferenceHints,
  getQcLookupCandidateSource,
  extractExactMeasurementTuples,
  extractStorefrontFabricImageCatalog,
  extractFabricSampleCatalog,
  extractStorefrontVariantCatalog,
  mergeManualReferenceVersions,
  mergeDiscoveredSelectionForQc,
  looksLikeReferenceSearchTerm,
  scoreProductNode,
} from '../../server/vercel-routes/cw/measurements.js';

describe('CW discovery search heuristics', () => {
  it('sanitizes copied internal order titles before storefront discovery', () => {
    expect(cleanStorefrontComparisonTitle('Soderhamn Chaise Longue CoverUSD 399 x 1')).toBe(
      'Soderhamn Chaise Longue Cover'
    );
  });

  it('keeps Shopify featured images attached to the exact arm-side SKU', () => {
    const variants = extractStorefrontVariantCatalog(`
      {"handle":"kramfors-2-seater-1-armrest-sofa-cover","sku":"IK-KS-2M__L__LV__LSKT_PM__SUN-C13","featured_image":{"src":"https:\\/\\/cdn.shopify.com\\/left.jpg?v=1"}}
      {"handle":"kramfors-2-seater-1-armrest-sofa-cover","sku":"IK-KS-2M__R__LV__LSKT_PM__SUN-C13","featured_image":{"src":"https:\\/\\/cdn.shopify.com\\/right.jpg?v=2"}}
    `);

    expect(variants).toEqual([
      expect.objectContaining({
        sku: 'IK-KS-2M__L__LV__LSKT_PM__SUN-C13',
        imageUrl: 'https://cdn.shopify.com/left.jpg?v=1',
      }),
      expect.objectContaining({
        sku: 'IK-KS-2M__R__LV__LSKT_PM__SUN-C13',
        imageUrl: 'https://cdn.shopify.com/right.jpg?v=2',
      }),
    ]);
  });

  it('builds labelled per-product selectors from valid storefront variants', () => {
    const groups = buildComparisonConfigurationGroups(
      [
        {
          sku: 'IK-KS-2M__L__LV__LSKT_PM__COS-105',
          title: 'Left Arm / The leather version / Signature',
        },
        {
          sku: 'IK-KS-2M__R__LV__LSKT_PM__COS-105',
          title: 'Right Arm / The leather version / Signature',
        },
        {
          sku: 'IK-KS-2M__R__LV__SHRT_SP__COS-105',
          title: 'Right Arm / The leather version / Original',
        },
        {
          sku: 'IK-KS-2M__R__SV__SHRT_SP__COS-105',
          title: 'Right Arm / The standard version / Original',
        },
      ],
      'IK-KS-2M'
    );

    expect(groups).toEqual([
      expect.objectContaining({
        label: 'Side',
        codeIndex: 0,
        options: [
          { code: 'L', label: 'Left Arm' },
          { code: 'R', label: 'Right Arm' },
        ],
      }),
      expect.objectContaining({
        label: 'Model',
        codeIndex: 1,
        options: expect.arrayContaining([
          { code: 'LV', label: 'The leather version' },
          { code: 'SV', label: 'The standard version' },
        ]),
      }),
      expect.objectContaining({
        label: 'Style',
        codeIndex: 2,
        options: expect.arrayContaining([
          { code: 'LSKT_PM', label: 'Signature' },
          { code: 'SHRT_SP', label: 'Original' },
        ]),
      }),
    ]);
  });

  it('maps Slatorp chaise orientation codes and constructs its exact catalogue asset', () => {
    const groups = buildComparisonConfigurationGroups(
      [
        { sku: 'IK-SP-25__L1__SHRT_SP__ESTE-57', title: 'Left Inward Chaise / Original' },
        { sku: 'IK-SP-25__L2__SHRT_SP__ESTE-57', title: 'Left Outward Chaise / Original' },
        { sku: 'IK-SP-25__R1__SHRT_SP__ESTE-57', title: 'Right Inward Chaise / Original' },
        { sku: 'IK-SP-25__R2__SHRT_SP__ESTE-57', title: 'Right Outward Chaise / Original' },
      ],
      'IK-SP-25'
    );

    expect(groups[0]).toEqual(
      expect.objectContaining({
        label: 'Orientation',
        options: [
          { code: 'L1', label: 'Left Inward Chaise' },
          { code: 'L2', label: 'Left Outward Chaise' },
          { code: 'R1', label: 'Right Inward Chaise' },
          { code: 'R2', label: 'Right Outward Chaise' },
        ],
      })
    );
    expect(buildDirectCatalogueImageUrl('IK-SP-25', ['R2', 'SHRT_SP', 'ESTE-57'])).toBe(
      'https://img.comfort-works.com/img/products/ikea/SP/IK-SP-25/IK-SP-25_R2_SHRT_SP_ESTE-57.webp'
    );
  });

  it('reads exact option labels from Shopify product JSON', () => {
    const variants = extractStorefrontProductJsonVariants(
      {
        handle: 'kramfors-2-seater-1-armrest-sofa-cover',
        variants: [
          {
            sku: 'IK-KS-2M__L__LV__SHRT_SP__COS-105',
            title: 'Left Arm / The leather version / Original / Care+ Linen Natural',
            featured_image: { src: '//cdn.example.com/left-original.jpg' },
          },
          {
            sku: 'IK-KS-2M__R__SV__LSKT_PM__COS-105',
            title: 'Right Arm / The standard version / Signature / Care+ Linen Natural',
          },
        ],
      },
      'kramfors-2-seater-1-armrest-sofa-cover'
    );

    const groups = buildComparisonConfigurationGroups(variants, 'IK-KS-2M');
    expect(groups.slice(0, 3)).toEqual([
      {
        key: 'configuration-0',
        label: 'Side',
        codeIndex: 0,
        options: [
          { code: 'L', label: 'Left Arm' },
          { code: 'R', label: 'Right Arm' },
        ],
      },
      {
        key: 'configuration-1',
        label: 'Model',
        codeIndex: 1,
        options: [
          { code: 'LV', label: 'The leather version' },
          { code: 'SV', label: 'The standard version' },
        ],
      },
      {
        key: 'configuration-2',
        label: 'Style',
        codeIndex: 2,
        options: [
          { code: 'SHRT_SP', label: 'Original' },
          { code: 'LSKT_PM', label: 'Signature' },
        ],
      },
    ]);
    expect(variants[0].imageUrl).toBe('https://cdn.example.com/left-original.jpg');
  });

  it('extracts exact named-fabric photos from the storefront fabric gallery', () => {
    const images = extractStorefrontFabricImageCatalog(`
      {"handle":"soderhamn-armrest-cover-pair-mod-chenille-espresso","variants":[
        {"fabricImgUrl":"https:\\/\\/comfort-works.com\\/cdn\\/shop\\/files\\/IK-SN-8_LSKT_SI_ESTE-57.webp?v=1"},
        {"fabricImgUrl":"https:\\/\\/comfort-works.com\\/cdn\\/shop\\/files\\/IK-SN-8_VELC_SP_ESTE-57.webp?v=2"}
      ]}
    `);

    expect(images).toEqual([
      {
        handle: 'soderhamn-armrest-cover-pair-mod-chenille-espresso',
        imageUrl: 'https://comfort-works.com/cdn/shop/files/IK-SN-8_LSKT_SI_ESTE-57.webp?v=1',
      },
      {
        handle: 'soderhamn-armrest-cover-pair-mod-chenille-espresso',
        imageUrl: 'https://comfort-works.com/cdn/shop/files/IK-SN-8_VELC_SP_ESTE-57.webp?v=2',
      },
    ]);
  });

  it('extracts official fabric sample names, codes, and images', () => {
    const samples = extractFabricSampleCatalog(`
      var sampleData = {
        handle: 'fabric-samples-crypton-chenille-cream',
        title: 'Crypton® Chenille Cream',
        featured_image: { url: '//comfort-works.com/cdn/shop/files/BEN-02_Crypton_Chenille_Cream.jpg?v=1&width=500', alt: 'Crypton® Chenille Cream' }
      };
      fabricGroupData.fabric_samples.push(sampleData);
      var sampleData = {
        handle: 'fabric-samples-care-linen-natural',
        title: 'Care+ Linen Natural',
        featured_image: { url: '//comfort-works.com/cdn/shop/files/COS-105_Care_Linen_Natural.avif?v=2&width=500', alt: 'Care+ Linen Natural' }
      };
      fabricGroupData.fabric_samples.push(sampleData);
    `);

    expect(samples).toEqual([
      expect.objectContaining({
        code: 'BEN-02',
        title: 'Crypton® Chenille Cream',
        imageUrl:
          'https://comfort-works.com/cdn/shop/files/BEN-02_Crypton_Chenille_Cream.jpg?v=1&width=500',
      }),
      expect.objectContaining({
        code: 'COS-105',
        title: 'Care+ Linen Natural',
        imageUrl:
          'https://comfort-works.com/cdn/shop/files/COS-105_Care_Linen_Natural.avif?v=2&width=500',
      }),
    ]);
  });

  it('uses human fabric names for per-product fabric selectors', () => {
    const groups = buildComparisonConfigurationGroups(
      [
        { sku: 'IK-SN-3__VELC_SP__ESTE-57', title: 'Original / Mod Chenille Espresso' },
        { sku: 'IK-SN-3__VELC_SP__COS-105', title: 'Original / Care+ Linen Natural' },
        { sku: 'IK-SN-3__LSKT_SI__ESTE-57', title: 'Signature / Mod Chenille Espresso' },
      ],
      'IK-SN-3',
      [
        { code: 'ESTE-57', title: 'Mod Chenille Espresso' },
        { code: 'COS-105', title: 'Care+ Linen Natural' },
      ]
    );

    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Style', codeIndex: 0 }),
        expect.objectContaining({
          label: 'Fabric',
          codeIndex: 1,
          options: expect.arrayContaining([
            { code: 'ESTE-57', label: 'Mod Chenille Espresso' },
            { code: 'COS-105', label: 'Care+ Linen Natural' },
          ]),
        }),
      ])
    );
  });

  it('keeps archived numeric fabric codes in the Fabric selector', () => {
    const groups = buildComparisonConfigurationGroups(
      [
        { sku: 'IK-SN-3__VELC_SP__ESTE-57', title: 'Original / Mod Chenille Espresso' },
        { sku: 'IK-SN-3__VELC_SP__5422-0000', title: 'Original / Archive fabric' },
      ],
      'IK-SN-3',
      [{ code: 'ESTE-57', title: 'Mod Chenille Espresso' }]
    );

    expect(groups.find(group => group.codeIndex === 1)?.label).toBe('Fabric');
  });

  it('exposes the Harmony left variant as the single selectable version', () => {
    const result = mergeManualReferenceVersions(
      {
        productReference: 'WE-HY-118',
        versionOptions: [],
        derivedScopedReferences: [],
      },
      getManualReferenceHints('WE-HY-118')
    );

    expect(result.versionOptions).toEqual([
      expect.objectContaining({
        code: 'L',
        scopedReference: 'WE-HY-118__L',
        isDefault: true,
      }),
    ]);
    expect(result.derivedScopedReferences).toContain('WE-HY-118__L');
  });
  it('treats plain alphabetic keywords as name searches', () => {
    expect(looksLikeReferenceSearchTerm('Vimle')).toBe(false);
    expect(getDiscoveryQueryMode('Vimle')).toBe('name');
  });

  it('keeps code-like references on the reference path', () => {
    expect(looksLikeReferenceSearchTerm('IK-KS-3')).toBe(true);
    expect(looksLikeReferenceSearchTerm('MD2')).toBe(true);
    expect(getDiscoveryQueryMode('IK-KS-3')).toBe('reference');
  });

  it('builds a fast-path query that fetches product configuration in one request', () => {
    const query = buildPublicNameFastPathQuery('Vimle');

    expect(query).toContain('products(first: 1');
    expect(query).toContain('translations_Name_Icontains: "Vimle"');
    expect(query).toContain('translations(lang: "en")');
    expect(query).toContain('productConfiguration(manualOrder: true)');
  });

  it('builds a parsed discovery result directly from a fast-path product node', () => {
    const result = buildDiscoveredProductResult({
      node: {
        id: 'prod-1',
        reference: 'IK-KS-3',
        status: 'active',
        translations: {
          edges: [{ node: { name: 'Kramfors', slug: 'kramfors', lang: 'en' } }],
        },
        productConfiguration: {
          reference: 'IK-KS-3',
          groups: [
            {
              name: { _translateable: { UN: 'Select Your Sofa Version' } },
              printing: { field: 'version' },
              content: [{ name: { _translateable: { UN: 'Standard' } }, code: 'SV' }],
            },
            {
              name: { _translateable: { UN: 'Pick Your Style' } },
              printing: { field: 'version' },
              content: [
                { name: { _translateable: { UN: 'Signature' } }, code: 'CNRP_SP' },
                { name: { _translateable: { UN: 'Original' } }, code: 'SHRT_SP' },
              ],
            },
          ],
        },
      },
      score: 42,
    });

    expect(result).toEqual(
      expect.objectContaining({
        productReference: 'IK-KS-3',
        productName: 'Kramfors',
        configParsed: true,
        score: 42,
      })
    );
    expect(result.versionOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SV',
          scopedReference: 'IK-KS-3__SV',
        }),
      ])
    );
    expect(result.styleOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          style: 'Signature',
          styleCode: 'CNRP_SP',
        }),
        expect.objectContaining({
          style: 'Original',
          styleCode: 'SHRT_SP',
        }),
      ])
    );
  });

  it('preserves the CW40 default variant for Stockholm instead of probing the unscoped PID', () => {
    const discovered = buildDiscoveredProductResult({
      node: {
        id: 'stockholm',
        reference: 'IK-SM-4',
        translations: {
          edges: [{ node: { name: 'Stockholm 3.5 Seater Sofa Cover', lang: 'en' } }],
        },
        productConfiguration: {
          reference: 'IK-SM-4',
          groups: [
            {
              name: { _translateable: { UN: 'My original sofa' } },
              printing: { field: 'version' },
              default_value: { code: 'SV', pg_code: 'SV' },
              content: [
                { name: { _translateable: { UN: 'has existing fabric covers' } }, code: 'SV' },
                { name: { _translateable: { UN: 'is leather upholstered' } }, code: 'LV' },
              ],
            },
            {
              name: { _translateable: { UN: 'Pick Your Style' } },
              content: [{ name: { _translateable: { UN: 'Original' } }, code: 'VELC_SP' }],
            },
          ],
        },
      },
    });

    expect(discovered.versionOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SV',
          scopedReference: 'IK-SM-4__SV',
          isDefault: true,
        }),
        expect.objectContaining({
          code: 'LV',
          scopedReference: 'IK-SM-4__LV',
          isDefault: false,
        }),
      ])
    );

    const selection = mergeDiscoveredSelectionForQc(
      {
        productReference: 'IK-SM-4',
        scopedReference: 'IK-SM-4',
        style: 'Original',
        styleCode: 'VELC_SP',
      },
      discovered
    );
    expect(selection.scopedReference).toBe('IK-SM-4__SV');
    expect(buildSelectedQcLookupCandidates(selection).slice(0, 3)).toEqual([
      { productReference: 'IK-SM-4__SV', style: 'Original', styleCode: 'VELC_SP' },
      { productReference: 'IK-SM-4__SV', style: '', styleCode: '' },
      { productReference: 'IK-SM-4__LV', style: 'Original', styleCode: 'VELC_SP' },
    ]);
  });

  it('uses exact product measurement links before generated reference and style combinations', () => {
    const tuples = extractExactMeasurementTuples(
      '<a href="/product-measurements/UHJvZHVjdDozMTM=/IK-SM-4__SV,Signature,LSKT_WR">measure</a>',
      'IK-SM-4'
    );
    expect(tuples).toEqual([
      {
        productReference: 'IK-SM-4__SV',
        style: 'Signature',
        styleCode: 'LSKT_WR',
        source: 'measurement-index-link',
      },
    ]);

    const candidates = buildSelectedQcLookupCandidates({
      productReference: 'IK-SM-4',
      scopedReference: 'IK-SM-4__SV',
      style: 'Original',
      styleCode: 'VELC_SP',
      exactMeasurementTuples: tuples,
    });
    expect(candidates[0]).toEqual({
      productReference: 'IK-SM-4__SV',
      style: 'Signature',
      styleCode: 'LSKT_WR',
    });
    expect(getQcLookupCandidateSource({ exactMeasurementTuples: tuples }, candidates[0])).toBe(
      'pid-measurement-index'
    );
  });

  it('does not mix manual guesses into a family supplied by CW40 configuration', () => {
    const selection = {
      productReference: 'IK-NA-3',
      scopedReference: 'IK-NA-3__VS',
      versionOptions: [
        {
          code: 'VS',
          scopedReference: 'IK-NA-3__VS',
          source: 'cw40-product-configuration',
        },
      ],
      derivedScopedReferences: ['IK-NA-3__VS'],
      styleOptions: [
        { style: 'Urban', styleCode: 'VELC_SP', source: 'cw40-product-configuration' },
      ],
      style: 'Urban',
      styleCode: 'VELC_SP',
    };
    const candidates = buildSelectedQcLookupCandidates(selection);
    expect(candidates.map(candidate => candidate.productReference)).not.toContain('IK-NA-3__VH');
    expect(getQcLookupCandidateSource(selection, candidates[0])).toBe('cw40-product-configuration');
  });

  it('builds load-selected lookups from the chosen reference instead of the original name search', () => {
    const body = {
      phase: 'load-selected',
      search: 'Nockeby 3 Seater Sofa Cover',
    };
    const selection = {
      search: 'Nockeby 3 Seater Sofa Cover',
      productReference: 'NY3_BSC_F220-22',
      scopedReference: 'NY3_BSC_F220-22',
      style: 'Original',
      styleCode: 'SP',
    };

    expect(buildLoadSelectedSearchBody(body, selection)).toEqual(
      expect.objectContaining({
        search: 'NY3_BSC_F220-22',
        query: 'NY3_BSC_F220-22',
        productReference: 'NY3_BSC_F220-22',
        style: 'Original',
        styleCode: 'SP',
      })
    );
  });

  it('tries exact Nikkala Velcro references before shared measurement fallbacks', () => {
    expect(
      buildSelectedQcLookupCandidates({
        productReference: 'IK-NA-3',
        scopedReference: 'IK-NA-3__VH',
        style: 'Urban',
        styleCode: 'VELC_SP',
        styleOptions: [
          { style: 'Urban', styleCode: 'VELC_SP' },
          { style: 'Classic', styleCode: 'CNRP_PM' },
        ],
      })
    ).toEqual([
      { productReference: 'IK-NA-3__VH', style: 'Urban', styleCode: 'VELC_SP' },
      { productReference: 'IK-NA-3__VH', style: 'Classic', styleCode: 'CNRP_PM' },
      { productReference: 'IK-NA-3__VH', style: '', styleCode: '' },
      { productReference: 'IK-NA-3', style: 'Urban', styleCode: 'VELC_SP' },
      { productReference: 'IK-NA-3', style: 'Classic', styleCode: 'CNRP_PM' },
      { productReference: 'IK-NA-3', style: '', styleCode: '' },
    ]);
  });

  it('restores the required CW40 style for a scoped Nikkala selection', () => {
    expect(
      buildSelectedQcLookupCandidates({
        productReference: 'IK-NA-3',
        scopedReference: 'IK-NA-3__VH',
      })[0]
    ).toEqual({
      productReference: 'IK-NA-3__VH',
      style: 'Urban',
      styleCode: 'VELC_SP',
    });
  });

  it('expands the Shopify-safe Nikkala base reference for MT detail loading', () => {
    const candidates = buildSelectedQcLookupCandidates({
      productReference: 'IK-NA-3',
      scopedReference: 'IK-NA-3',
    });

    expect(candidates.slice(0, 2)).toEqual([
      { productReference: 'IK-NA-3__VH', style: 'Urban', styleCode: 'VELC_SP' },
      { productReference: 'IK-NA-3__VH', style: '', styleCode: '' },
    ]);
    expect(candidates).toContainEqual({
      productReference: 'IK-NA-3__VS',
      style: 'Urban',
      styleCode: 'VELC_SP',
    });
  });

  it('expands the Harmony base PID to its left-scoped CW40 measurement reference', () => {
    expect(getManualReferenceHints('WE-HY-118')).toEqual(['WE-HY-118__L']);

    const candidates = buildSelectedQcLookupCandidates({
      productReference: 'WE-HY-118',
      scopedReference: 'WE-HY-118',
      style: 'Urban',
      styleCode: 'VELC_SP',
    });

    expect(candidates[0]).toEqual({
      productReference: 'WE-HY-118__L',
      style: 'Urban',
      styleCode: 'VELC_SP',
    });
  });

  it('prefers exact provided references when ranking products for selected loads', () => {
    const exactNode = {
      reference: 'NY3_BSC_F220-22',
      translations: {
        edges: [{ node: { name: 'Nockeby 3 Seater Sofa Cover' } }],
      },
    };
    const inexactNode = {
      reference: 'NO3_OTHER',
      translations: {
        edges: [{ node: { name: 'Nockeby 3 Seater Sofa Cover' } }],
      },
    };

    expect(
      scoreProductNode(exactNode, 'Nockeby 3 Seater Sofa Cover', {
        productReference: 'NY3_BSC_F220-22',
      })
    ).toBeGreaterThan(
      scoreProductNode(inexactNode, 'Nockeby 3 Seater Sofa Cover', {
        productReference: 'NY3_BSC_F220-22',
      })
    );
  });

  it('returns manual stacked reference hints for known split CW references', () => {
    expect(getManualReferenceHints('BA-AE-122')).toEqual(['BA-AE-122__L__2S-3B']);
    expect(getManualReferenceHints('PB-CRA-69M__L')).toEqual([
      'PB-CRA-69M__L__BE',
      'PB-CRA-69M__L__KE',
    ]);
    expect(getManualReferenceHints('PB-PRA-73M__L')).toEqual([
      'PB-PRA-73M__L__BE',
      'PB-PRA-73M__L__KE',
    ]);
    expect(getManualReferenceHints('PB-BSC-69M__L')).toEqual([
      'PB-BSC-69M__L__PB',
      'PB-BSC-69M__L__MG',
    ]);
    expect(getManualReferenceHints('IK-NA-3')).toEqual(['IK-NA-3__VH', 'IK-NA-3__VS']);
  });

  it('boosts descendant scoped references when the search term matches their parent stack', () => {
    const stackedNode = {
      reference: 'BA-AE-122__L__2S-3B',
      translations: {
        edges: [{ node: { name: 'BA-AE-122 Cover' } }],
      },
    };
    const unrelatedNode = {
      reference: 'BA-AE-999',
      translations: {
        edges: [{ node: { name: 'BA-AE-999 Cover' } }],
      },
    };

    expect(
      scoreProductNode(stackedNode, 'BA-AE-122', { productReference: 'BA-AE-122' })
    ).toBeGreaterThan(
      scoreProductNode(unrelatedNode, 'BA-AE-122', { productReference: 'BA-AE-122' })
    );
  });

  it('boosts deeper PB scoped references when the typed reference is one scope shorter', () => {
    const stackedNode = {
      reference: 'PB-BSC-69M__L__PB',
      translations: {
        edges: [{ node: { name: 'PB-BSC-69M Cover' } }],
      },
    };
    const siblingNode = {
      reference: 'PB-BSC-69M__R__PB',
      translations: {
        edges: [{ node: { name: 'PB-BSC-69M Cover' } }],
      },
    };

    expect(
      scoreProductNode(stackedNode, 'PB-BSC-69M__L', { productReference: 'PB-BSC-69M__L' })
    ).toBeGreaterThan(
      scoreProductNode(siblingNode, 'PB-BSC-69M__L', { productReference: 'PB-BSC-69M__L' })
    );
  });
});
