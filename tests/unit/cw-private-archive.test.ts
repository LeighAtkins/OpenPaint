import { describe, expect, it, vi } from 'vitest';
import {
  archivedAssetName,
  replaceArchivedImageUrls,
  searchArchivedProducts,
  isArchivedModelUnconfirmed,
  isArchivedStyleMismatch,
  handleCwArchiveRequest,
} from '../../server/vercel-routes/cw/archive';
import { isConfirmedArchiveAsset } from '../../server/vercel-routes/cw/asset-access';

describe('Private CW archive', () => {
  it('withholds an unconfirmed diagram even if its valid archived identifier is known', async () => {
    const confirmed = '2926a4fac569844f7d142cdd38fd955aa9f31fe2744c8ac3a203262342a00d38.png';
    const unconfirmed = 'c20b2c1f2e9accdf33afeeac538714861905fe5849d2438f58de3808aa39f969.png';
    expect(isConfirmedArchiveAsset(confirmed)).toBe(true);
    expect(isConfirmedArchiveAsset(unconfirmed)).toBe(false);
    vi.stubEnv('CW_ARCHIVE_DIR', '/nonexistent-private-archive');
    let status: number | undefined;
    let body: any;
    const response = {
      status(value: number) {
        status = value;
        return this;
      },
      json(value: any) {
        body = value;
      },
    };
    try {
      await handleCwArchiveRequest({ query: { formId: 'image-proxy' } }, response, {
        candidates: [`https://cw-archive.invalid/assets/${unconfirmed}`],
      });
      expect(status).toBe(404);
      expect(body.code).toBe('CW_ARCHIVED_IMAGE_NOT_FOUND');
      expect(body.url).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('withholds a different returned style rather than assuming an old code is equivalent', () => {
    expect(
      isArchivedStyleMismatch('Original', 'VELC_SP', {
        style_name: 'Original',
        style_code: 'VELC_SP',
      })
    ).toBe(false);
    expect(
      isArchivedStyleMismatch('Signature', 'LSKT_SI', {
        style_name: 'Signature',
        style_code: 'LSKT_SP',
      })
    ).toBe(true);
    expect(
      isArchivedStyleMismatch('Original ', 'VELC_SP', {
        style_name: 'Original',
        style_code: 'VELC_SP',
      })
    ).toBe(false);
  });
  it('requires the editor confirmation for configured models even when raw measurements exist', () => {
    const config = {
      hasVersionConfiguration: true,
      versionOptions: [
        { scopedReference: 'CB-AS-105__SV_STD__3S-3B', modelSetConfirmed: true },
        { scopedReference: 'CB-AS-105__SV_STD__1S-3B', modelSetConfirmed: false },
      ],
    };
    expect(isArchivedModelUnconfirmed(config, 'CB-AS-105__SV_STD__3S-3B')).toBe(false);
    expect(isArchivedModelUnconfirmed(config, 'CB-AS-105__SV_STD__1S-3B')).toBe(true);
    expect(isArchivedModelUnconfirmed(config, 'CB-AS-105__SV_STD')).toBe(true);
    expect(isArchivedModelUnconfirmed({ versionOptions: [] }, 'IK-KK-3')).toBe(false);
  });
  const name = 'a'.repeat(64) + '.png';
  it('accepts only exact archive asset identifiers', () => {
    expect(archivedAssetName(`https://cw-archive.invalid/assets/${name}`)).toBe(name);
    for (const candidate of [
      `https://attacker.example/assets/${name}`,
      'https://cw-archive.invalid/assets/../../.env',
      `https://cw-archive.invalid/assets/${name}?token=123`,
      'file:///etc/passwd',
    ])
      expect(archivedAssetName(candidate)).toBeNull();
  });
  it('serves saved asset references instead of expiring original URLs', () => {
    const original = {
      product_components: [
        {
          images: [
            {
              file_path: 'original/file.png',
              url: 'https://storage.example/file.png?Signature=secret',
            },
          ],
        },
      ],
    };
    const replaced = replaceArchivedImageUrls(original, [
      {
        sourceKey: 'original/file.png',
        sourceUrl: original.product_components[0].images[0].url,
        localPath: `assets/${name}`,
      },
    ]);
    expect(replaced.product_components[0].images[0]).toEqual({
      file_path: null,
      url: `https://cw-archive.invalid/assets/${name}`,
    });
    expect(original.product_components[0].images[0].file_path).toBe('original/file.png');
    expect(replaceArchivedImageUrls(original, []).product_components[0].images[0].url).toBeNull();
  });
  it('finds website names and ranks exact internal references first', () => {
    const products = [
      { id: '1', reference: 'IK-EP-2B', name: 'Ektorp 2 Seat Sofa Bed Cover' },
      { id: '2', reference: 'OTHER', name: 'IK-EP-2B replacement' },
    ];
    const configs = [
      { id: '1', styleOptions: [{ style: 'Original', styleCode: 'CNRP_PM' }], versionOptions: [] },
    ];
    expect(searchArchivedProducts(products, configs, 'Ektorp Sofa Bed')[0].productReference).toBe(
      'IK-EP-2B'
    );
    expect(searchArchivedProducts(products, configs, 'IK-EP-2B')[0].styleOptions).toEqual(
      configs[0].styleOptions
    );
    expect(searchArchivedProducts(products, configs, '')).toEqual([]);
    expect(
      searchArchivedProducts(
        [
          {
            id: '3',
            reference: 'CW-PRIVATE',
            name: 'Internal name',
            catalogueTitles: ['IKEA Ektorp Sofa Bed Cover'],
          },
        ],
        [],
        'IKEA Ektorp'
      )[0].productReference
    ).toBe('CW-PRIVATE');
  });
});
