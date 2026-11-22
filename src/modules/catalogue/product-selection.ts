import type { Dimensions } from './overall-dimensions';
export interface CatalogueIdentity {
  productReference: string;
  codes?: string[];
  fabricCode?: string;
}
export interface CoverComponent {
  id: string;
  name: string;
  quantity: number;
  images: Array<{ url: string; name: string }>;
}
export function selectCatalogueStyle(item: CatalogueIdentity, payload: any) {
  const codes = item.codes || [];
  const candidates = (payload?.content?.product_options || [])
    .filter((p: any) => {
      const ref = p.product_reference;
      return (
        typeof ref === 'string' &&
        (ref === item.productReference ||
          (ref.startsWith(item.productReference + '__') &&
            ref
              .slice(item.productReference.length + 2)
              .split('__')
              .every((code: string) => codes.includes(code))))
      );
    })
    .sort((a: any, b: any) => b.product_reference.length - a.product_reference.length);
  // Never choose an arbitrary handedness or one of several equally specific versions.
  const product = candidates[0];
  if (!product || candidates[1]?.product_reference.length === product.product_reference.length)
    return null;
  const styles = product.product_styles || [];
  const matchingStyles = styles.filter((s: any) => codes.includes(s.style_code));
  if (matchingStyles.length > 1) return null;
  const style =
    matchingStyles[0] ||
    (styles.length === 1 &&
    !codes.some(
      code =>
        /^(?:VELC|LSKT|SHRT|ELAS|CNRP|MLTP|BKPT|SDPT)_/.test(code) && code !== styles[0].style_code
    )
      ? styles[0]
      : null);
  if (!style) return null;
  return {
    productId: String(product.product_id || ''),
    productStyleId: String(style.product_style_id || ''),
    measurementReference: product.product_reference as string,
    measurementStyle: String(style.style_name || ''),
    measurementStyleCode: String(style.style_code || ''),
    dimensions: { width: style.width, depth: style.depth, height: style.height } as Dimensions,
    boxContents: coverComponents(style),
  };
}
export function coverComponents(content: any): CoverComponent[] {
  return (Array.isArray(content?.product_components) ? content.product_components : [])
    .map((c: any) => ({
      id: String(c.id || ''),
      name: String(c.translations?.en || c.name || ''),
      quantity: Number(c.quantity),
      images: (Array.isArray(c.slipcover_details_images) ? c.slipcover_details_images : []).map(
        (i: any) => {
          let url = String(i.url || '');
          if (!url && typeof i.file_path === 'string')
            url = 'https://storage.googleapis.com/pid-storage/' + i.file_path.replace(/^\/+/, '');
          try {
            const u = new URL(url);
            if (
              u.protocol !== 'https:' ||
              u.username ||
              u.password ||
              !(
                (u.hostname === 'cw-archive.invalid' &&
                  /^\/assets\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(u.pathname)) ||
                (u.hostname === 'storage.googleapis.com' &&
                  /^\/(?:pid-storage|cw-pid)\//.test(u.pathname))
              )
            )
              url = '';
          } catch {
            url = '';
          }
          return { url, name: String(i.name || c.translations?.en || c.name || 'Cover diagram') };
        }
      ),
    }))
    .filter((c: CoverComponent) => c.name && Number.isFinite(c.quantity) && c.quantity > 0);
}
