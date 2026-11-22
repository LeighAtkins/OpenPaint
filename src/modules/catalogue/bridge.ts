import { getCwRequestHeaders } from '../../services/auth/cwAccess';
import { coverComponents, type CatalogueIdentity } from './product-selection';
import { parseOverallPlacement, type OverallPlacement } from './overall-dimensions';
export interface CatalogueProduct extends CatalogueIdentity {
  imageUrl: string;
  imageMatch?: string;
  dimensions?: Record<string, unknown> | null;
  measurementReference?: string;
  measurementStyle?: string;
  measurementStyleCode?: string;
  productId?: string;
  productStyleId?: string;
}
async function request(body: unknown, endpoint = 'search'): Promise<any> {
  const response = await fetch(`/api/integrations/cw/measurements/${endpoint}`, {
    method: 'POST',
    headers: await getCwRequestHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok || !data.success)
    throw Error(data.message || data.error || 'Catalogue request could not be completed.');
  return data;
}
export async function overallForProduct(item: CatalogueProduct) {
  if (!item.imageUrl || item.imageMatch === 'product-fallback' || item.imageMatch === 'unavailable')
    throw Error('Choose a photograph of the exact furniture configuration before drawing.');
  const result = await request({ phase: 'catalogue-overall', imageUrl: item.imageUrl });
  return { ...result, placement: parseOverallPlacement(result.placement) as OverallPlacement };
}
export async function coversForProduct(item: CatalogueProduct) {
  if (!item.measurementReference || !item.measurementStyleCode)
    throw Error('The exact PID configuration and style have not been identified.');
  if (!(item.codes || []).includes(item.measurementStyleCode))
    throw Error('The PID style differs from the selected product.');
  const result = await request({
    phase: 'load-selected',
    selectedItems: [
      {
        productId: item.productId || '',
        productReference: item.measurementReference,
        scopedReference: item.measurementReference,
        style: item.measurementStyle,
        styleCode: item.measurementStyleCode,
        productName: item.productReference,
      },
    ],
  });
  const match = result.items?.find(
    (i: any) =>
      i.success &&
      i.basketItem?.scopedReference === item.measurementReference &&
      i.basketItem?.styleCode === item.measurementStyleCode
  );
  const content = match?.data?.qcMeasurements?.data;
  if (!content)
    throw Error(
      result.items?.[0]?.message ||
        'No confirmed PID cover diagrams match this configuration and style.'
    );
  if (
    content.product_reference !== item.measurementReference ||
    content.style_code !== item.measurementStyleCode ||
    (item.productId && String(content.product_id) !== String(item.productId)) ||
    (item.productStyleId && String(content.product_style_id) !== String(item.productStyleId))
  )
    throw Error('The PID response does not match the selected product and style.');
  const components = coverComponents(content);
  // Asset reads stay authenticated. Return raster data, never credentials or signed URLs.
  for (const component of components) {
    component.images = await Promise.all(
      component.images.map(async image => {
        if (!image.url) return { ...image, error: 'Diagram unavailable' };
        try {
          const got = await request({ candidates: [image.url] }, 'image-proxy');
          if (
            typeof got.url !== 'string' ||
            !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(got.url)
          )
            throw Error('Diagram unavailable');
          return { ...image, url: got.url };
        } catch {
          return { ...image, url: '', error: 'Diagram unavailable' };
        }
      })
    );
  }
  return {
    measurementReference: item.measurementReference,
    measurementStyleCode: item.measurementStyleCode,
    productId: String(content.product_id),
    productStyleId: String(content.product_style_id),
    components,
  };
}
/** The installed extension relays requests; only this page owns its CW authentication. */
export function installCatalogueBridge() {
  if (document.documentElement.dataset.openpaintCatalogueReady === 'true') return;
  window.addEventListener('message', event => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.source !== 'omnoms-catalogue' ||
      event.data?.type !== 'CATALOGUE_REQUEST'
    )
      return;
    const { requestId, action, item } = event.data;
    if (
      typeof requestId !== 'string' ||
      requestId.length > 100 ||
      !item ||
      !['placement', 'covers', 'import'].includes(action)
    )
      return;
    void Promise.resolve()
      .then(() =>
        action === 'placement'
          ? overallForProduct(item)
          : action === 'covers'
            ? coversForProduct(item)
            : (window as any).importCatalogueProduct?.(item) ||
              Promise.reject(Error('The SofaPaint workspace is loading.'))
      )
      .then(data =>
        window.postMessage(
          { source: 'sofapaint-catalogue', type: 'CATALOGUE_RESPONSE', requestId, data },
          location.origin
        )
      )
      .catch(error =>
        window.postMessage(
          {
            source: 'sofapaint-catalogue',
            type: 'CATALOGUE_RESPONSE',
            requestId,
            error: error instanceof Error ? error.message : 'Catalogue request failed.',
          },
          location.origin
        )
      );
  });
  document.documentElement.dataset.openpaintCatalogueReady = 'true';
}
