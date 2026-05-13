import { describe, expect, it } from 'vitest';
import { parseProductConfiguration } from '../../server/vercel-routes/cw/shared.js';

describe('parseProductConfiguration', () => {
  it('extracts version and style options from a config string', () => {
    const input = JSON.stringify({
      reference: 'IK-KS-3',
      groups: [
        {
          name: { _translateable: { UN: 'Select Your Sofa Version' } },
          printing: { field: 'version' },
          content: [
            { name: { _translateable: { UN: 'Please select one' } }, code: 'DF' },
            { name: { _translateable: { UN: 'The standard version' } }, code: 'SV' },
            { name: { _translateable: { UN: 'The leather version' } }, code: 'LV' },
          ],
        },
        {
          name: { _translateable: { UN: 'Pick Your Style' } },
          printing: { field: 'version' },
          content: [
            { name: { _translateable: { UN: 'Signature' } }, code: 'CNRP_SP', pg_code: 'CNRP_SP' },
            { name: { _translateable: { UN: 'Original' } }, code: 'SHRT_SP', pg_code: 'SHRT_SP' },
          ],
        },
      ],
    });

    const parsed = parseProductConfiguration({
      productConfiguration: input,
      productReference: 'IK-KS-3',
      productName: 'Kramfors 3 Seater Sofa Cover',
    });

    expect(parsed.parsed).toBe(true);
    expect(parsed.versionOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SV',
          scopedReference: 'IK-KS-3__SV',
        }),
        expect.objectContaining({
          code: 'LV',
          scopedReference: 'IK-KS-3__LV',
        }),
      ])
    );
    expect(parsed.styleOptions).toEqual(
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

  it('handles style groups even when the printing field is mislabeled as version', () => {
    const parsed = parseProductConfiguration({
      productConfiguration: JSON.stringify({
        reference: 'PB-2',
        groups: [
          {
            name: { _translateable: { UN: 'Pick Your Style' } },
            printing: { field: 'version' },
            content: [{ name: { _translateable: { UN: 'Signature' } }, code: 'CNRP_SP' }],
          },
        ],
      }),
      productReference: 'PB-2',
    });

    expect(parsed.styleOptions).toHaveLength(1);
    expect(parsed.styleOptions[0]).toEqual(
      expect.objectContaining({
        style: 'Signature',
        styleCode: 'CNRP_SP',
      })
    );
  });

  it('cross-multiplies multiple version groups into stacked scoped references', () => {
    const parsed = parseProductConfiguration({
      productConfiguration: JSON.stringify({
        reference: 'WE-HS-113B',
        groups: [
          {
            name: { _translateable: { UN: 'Select Your Sofa Version' } },
            printing: { field: 'version' },
            content: [
              {
                name: {
                  _translateable: {
                    UN: 'Left 2-Piece Bumper Chaise Sectional, Fabric Version',
                  },
                },
                code: 'L_SV',
              },
            ],
          },
          {
            name: { _translateable: { UN: 'Choose Cushion Count' } },
            printing: { field: 'option' },
            content: [
              {
                name: { _translateable: { UN: '2 Seat Cushions + 5 Back Cushions' } },
                code: '2S-5B',
              },
              {
                name: { _translateable: { UN: '3 Seat Cushions + 5 Back Cushions' } },
                code: '3S-5B',
              },
            ],
          },
          {
            name: { _translateable: { UN: 'Pick Your Style' } },
            printing: { field: 'style' },
            content: [{ name: { _translateable: { UN: 'Original' } }, code: 'VELC_SP' }],
          },
        ],
      }),
      productReference: 'WE-HS-113B',
      productName: 'Harris Left/Right 2-Piece Sleeper Sectional',
    });

    expect(parsed.parsed).toBe(true);
    expect(parsed.versionOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'L_SV__2S-5B',
          scopedReference: 'WE-HS-113B__L_SV__2S-5B',
        }),
        expect.objectContaining({
          code: 'L_SV__3S-5B',
          scopedReference: 'WE-HS-113B__L_SV__3S-5B',
        }),
      ])
    );
  });

  it('treats Muji-style generic option groups as versions and keeps DF when it is a real variant', () => {
    const parsed = parseProductConfiguration({
      productConfiguration: JSON.stringify({
        reference: 'MJ-OWA-2-2007',
        groups: [
          {
            name: { _translateable: { UN: 'Choose Configuration' } },
            printing: { field: 'option' },
            content: [
              { name: { _translateable: { UN: 'DF Original' } }, code: 'DF' },
              { name: { _translateable: { UN: 'MJ-CC Original' } }, code: 'MJ-CC' },
              { name: { _translateable: { UN: 'CW-CC Original' } }, code: 'CW-CC' },
            ],
          },
          {
            name: { _translateable: { UN: 'Pick Your Style' } },
            printing: { field: 'style' },
            content: [{ name: { _translateable: { UN: 'Original' } }, code: 'VELC_WR' }],
          },
        ],
      }),
      productReference: 'MJ-OWA-2-2007',
      productName: 'Muji Ottoman Cover',
    });

    expect(parsed.parsed).toBe(true);
    expect(parsed.versionOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DF',
          scopedReference: 'MJ-OWA-2-2007__DF',
        }),
        expect.objectContaining({
          code: 'MJ-CC',
          scopedReference: 'MJ-OWA-2-2007__MJ-CC',
        }),
        expect.objectContaining({
          code: 'CW-CC',
          scopedReference: 'MJ-OWA-2-2007__CW-CC',
        }),
      ])
    );
    expect(parsed.styleOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          style: 'Original',
          styleCode: 'VELC_WR',
        }),
      ])
    );
  });

  it('fails closed on invalid JSON', () => {
    const parsed = parseProductConfiguration({
      productConfiguration: '{not-json}',
      productReference: 'PB-3',
    });

    expect(parsed.parsed).toBe(false);
    expect(parsed.versionOptions).toEqual([]);
    expect(parsed.styleOptions).toEqual([]);
    expect(parsed.productReference).toBe('PB-3');
  });
});
