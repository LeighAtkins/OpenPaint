import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/vercel-routes/cw/measurements.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function responseCapture() {
  const result = { status: 0, body: null as any };
  const response = {
    setHeader: vi.fn(),
    status(status: number) {
      result.status = status;
      return this;
    },
    json(body: any) {
      result.body = body;
      return this;
    },
  };
  return { result, response };
}

describe('CW public photo access', () => {
  it('allows anonymous catalogue photos without fetching or exposing measurements', async () => {
    vi.stubEnv('CW_ARCHIVE_DIR', '/unused-in-public-photo-lookup');
    const fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/search/suggest.json'))
        return new Response(
          JSON.stringify({
            resources: {
              results: {
                products: [
                  {
                    title: 'Kivik Sofa Cover',
                    url: '/products/kivik',
                    image: 'https://cdn.shopify.com/kivik.jpg',
                  },
                ],
              },
            },
          })
        );
      if (String(url).endsWith('/products/kivik.js'))
        return new Response(
          JSON.stringify({ featured_image: 'https://cdn.shopify.com/kivik.jpg' })
        );
      throw new Error('Unexpected source request: ' + url);
    });
    vi.stubGlobal('fetch', fetch);
    const { result, response } = responseCapture();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { formId: 'search' },
        body: {
          phase: 'storefront-product',
          search: 'Kivik Sofa Cover',
          productReference: 'IK-KK-3',
        },
      },
      response
    );
    expect(result.status).toBe(200);
    expect(result.body.product.imageUrl).toContain('kivik.jpg');
    expect(result.body.product.dimensions).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects an anonymous measurement request before reading archive data', async () => {
    vi.stubEnv('CW_ARCHIVE_DIR', '/unused-in-anonymous-request');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { result, response } = responseCapture();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { formId: 'search' },
        body: { phase: 'public-measurements', productReference: 'IK-KK-3' },
      },
      response
    );
    expect(result.status).toBe(401);
    expect(result.body.code).toBe('CW_SIGN_IN_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });
});
