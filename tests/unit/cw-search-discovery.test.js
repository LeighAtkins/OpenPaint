import { describe, expect, it } from 'vitest';
import {
  buildLoadSelectedSearchBody,
  buildDiscoveredProductResult,
  buildPublicNameFastPathQuery,
  getDiscoveryQueryMode,
  getManualReferenceHints,
  looksLikeReferenceSearchTerm,
  scoreProductNode,
} from '../../server/vercel-routes/cw/measurements.js';

describe('CW discovery search heuristics', () => {
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
