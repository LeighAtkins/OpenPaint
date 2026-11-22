import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coversForProduct, installCatalogueBridge } from '../../src/modules/catalogue/bridge';

vi.mock('../../src/services/auth/cwAccess', () => ({
  getCwRequestHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-session-only',
  })),
}));

const item = {
  productReference: 'RE-SE-88',
  codes: ['SV', '1S-2B', 'LSKT_SP', 'COS-101'],
  imageUrl: '',
  measurementReference: 'RE-SE-88__SV__1S-2B',
  measurementStyle: 'Original',
  measurementStyleCode: 'LSKT_SP',
  productId: '4506',
  productStyleId: '5941',
};
const raster = 'data:image/png;base64,aGVsbG8=';
const content = () => ({
  product_id: 4506,
  product_style_id: 5941,
  product_reference: item.measurementReference,
  style_code: 'LSKT_SP',
  product_components: [
    {
      id: 1,
      name: 'Frame Cover',
      quantity: 1,
      slipcover_details_images: [{ file_path: 'frame-front.png' }, { file_path: 'frame-back.png' }],
    },
    { id: 2, name: 'Seat Cushion Cover', quantity: 1, slipcover_details_images: [] },
    { id: 3, name: 'Back Cushion Cover', quantity: 2, slipcover_details_images: [] },
    { id: 4, name: 'Accent Cushion Cover', quantity: 2, slipcover_details_images: [] },
  ],
});
const loaded = (data = content()) => ({
  success: true,
  items: [
    {
      success: true,
      basketItem: {
        scopedReference: item.measurementReference,
        styleCode: item.measurementStyleCode,
      },
      data: { qcMeasurements: { data } },
    },
  ],
});

describe('OMNOMS catalogue page bridge', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(loaded()))
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as any).importCatalogueProduct;
  });

  it('uses page authentication and returns exact PID/style raster diagrams only', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(loaded()));
    vi.mocked(fetch).mockImplementation(async () => Response.json({ success: true, url: raster }));
    const result = await coversForProduct(item);
    expect(result.productId).toBe('4506');
    expect(result.productStyleId).toBe('5941');
    expect(result.components.map(component => component.quantity)).toEqual([1, 1, 2, 2]);
    expect(result.components[0].images.map(image => image.url)).toEqual([raster, raster]);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/integrations/cw/measurements/search');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-session-only' });
    expect(JSON.parse(String(options?.body)).selectedItems[0]).toMatchObject({
      productId: '4506',
      scopedReference: item.measurementReference,
      styleCode: 'LSKT_SP',
    });
    expect(JSON.stringify(result)).not.toMatch(/Bearer|storage.googleapis.com/);
  });

  it.each([
    { product_id: 4507 },
    { product_style_id: 5942 },
    { product_reference: 'RE-SE-88__OTHER' },
    { style_code: 'VELC_SP' },
  ])('rejects a mismatched authenticated response: %j', async mismatch => {
    vi.mocked(fetch).mockResolvedValue(Response.json(loaded({ ...content(), ...mismatch })));
    await expect(coversForProduct(item)).rejects.toThrow('does not match');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not proxy diagrams for a conflicting selected style', async () => {
    await expect(coversForProduct({ ...item, codes: ['VELC_SP'] })).rejects.toThrow('differs');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not pass remote or signed proxy URLs to OMNOMS', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(loaded()));
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({
        success: true,
        url: 'https://storage.googleapis.com/pid-storage/a.png?Signature=private',
      })
    );
    const result = await coversForProduct(item);
    expect(result.components[0].images.every(image => image.url === '')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Signature');
  });

  it('installs once and answers synchronous workspace errors with the request ID', async () => {
    const listener = vi.spyOn(window, 'addEventListener');
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    installCatalogueBridge();
    installCatalogueBridge();
    expect(listener.mock.calls.filter(call => call[0] === 'message')).toHaveLength(1);
    expect(document.documentElement.dataset.openpaintCatalogueReady).toBe('true');
    (window as any).importCatalogueProduct = () => {
      throw Error('Workspace not ready');
    };
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: {
          source: 'omnoms-catalogue',
          type: 'CATALOGUE_REQUEST',
          requestId: 'sylvie-test',
          action: 'import',
          item,
        },
      })
    );
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        {
          source: 'sofapaint-catalogue',
          type: 'CATALOGUE_RESPONSE',
          requestId: 'sylvie-test',
          error: 'Workspace not ready',
        },
        location.origin
      )
    );
    post.mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: 'https://untrusted.example',
        data: {
          source: 'omnoms-catalogue',
          type: 'CATALOGUE_REQUEST',
          requestId: 'untrusted',
          action: 'covers',
          item,
        },
      })
    );
    await Promise.resolve();
    expect(post).not.toHaveBeenCalled();
  });
});
