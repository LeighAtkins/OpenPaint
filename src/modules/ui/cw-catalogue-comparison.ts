export interface CatalogueComparisonRequestItem {
  kind?: 'product' | 'fabric-sample';
  productReference: string;
  title: string;
  url: string;
  handle: string;
  codes: string[];
  fabricCode: string;
  styleName: string;
  fabricName: string;
}

const PRODUCT_REFERENCE = /\b([A-Z]{2,}(?:-[A-Z0-9]+){1,4})\b/i;
const PRODUCT_URL = /https?:\/\/[^\s)]+\/products\/([a-z0-9-]+)/i;

function cleanToken(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^[\s*`_\-:]+|[\s*`_,.;:]+$/g, '');
}

const ORDER_LINE_PRICE =
  /\s*(?:USD|AUD|CAD|GBP|EUR|MYR|JPY|SGD|HKD|NZD)\s*[$€£¥]?\s*[\d,.]+\s*(?:x|×)\s*\d+\s*$/i;

/** Removes the price/quantity suffix added by copied CW internal order lines. */
export function cleanCatalogueComparisonTitle(value: string): string {
  return cleanToken(String(value || '').replace(ORDER_LINE_PRICE, ''));
}

function isFabricCode(value: string): boolean {
  const code = value.toUpperCase();
  return /^[A-Z]{2,8}-[A-Z0-9]+$/.test(code);
}

function isFabricName(value: string): boolean {
  return /\b(?:canvas|chenille|cotton|linen|microfibre|microfiber|boucl[eé]|tweed|velvet|weave|sunbrella|crypton)\b/i.test(
    value
  );
}

function applyConfigurationNames(item: CatalogueComparisonRequestItem, value: string): void {
  const parts = String(value || '')
    .split(',')
    .map(cleanToken)
    .filter(Boolean);
  const fabricName = parts.find(isFabricName) || '';
  if (!fabricName) return;
  item.fabricName = fabricName;
  item.styleName = parts.find(part => part !== fabricName) || item.styleName;
}

function inferredReferenceFromHandle(handle: string): string {
  const match = decodeURIComponent(handle || '').match(PRODUCT_REFERENCE);
  return match?.[1]?.toUpperCase() || '';
}

function normalizeWords(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !['cover', 'sofa', 'slipcover'].includes(word));
}

function scoreHandleForItem(handle: string, item: CatalogueComparisonRequestItem): number {
  const handleWords = new Set(normalizeWords(handle));
  const titleWords = normalizeWords(item.title);
  if (!titleWords.length) return 0;
  return titleWords.reduce((score, word) => score + (handleWords.has(word) ? 1 : 0), 0);
}

export function applySharedComparisonFabric(
  items: CatalogueComparisonRequestItem[],
  fabric: string
): CatalogueComparisonRequestItem[] {
  const nextFabric = cleanToken(fabric);
  if (!nextFabric) return items.map(item => ({ ...item, codes: [...item.codes] }));
  if (!isFabricCode(nextFabric)) {
    return items.map(item =>
      item.kind === 'fabric-sample'
        ? { ...item, codes: [...item.codes] }
        : { ...item, codes: [...item.codes], fabricName: nextFabric }
    );
  }
  const nextFabricCode = nextFabric.toUpperCase();
  return items.map(item => {
    if (item.kind === 'fabric-sample') return { ...item, codes: [...item.codes] };
    const codes = [...item.codes];
    const existingIndex = item.fabricCode
      ? codes.findIndex(code => code.toUpperCase() === item.fabricCode.toUpperCase())
      : -1;
    if (existingIndex >= 0) codes[existingIndex] = nextFabricCode;
    else if (codes.length) codes[codes.length - 1] = nextFabricCode;
    else codes.push(nextFabricCode);
    return { ...item, codes, fabricCode: nextFabricCode };
  });
}

/**
 * Accepts copied order text, product URLs, or one product code per line. Codes
 * on a following "Code:" line are attached to the product immediately above.
 */
export function parseCatalogueComparisonInput(
  value: string,
  limit = 8
): CatalogueComparisonRequestItem[] {
  const items: CatalogueComparisonRequestItem[] = [];
  const looseUrls: Array<{ url: string; handle: string }> = [];
  let current: CatalogueComparisonRequestItem | null = null;

  const pushItem = (item: CatalogueComparisonRequestItem) => {
    const key = `${item.kind || 'product'}|${item.productReference}|${item.codes.join('|')}`;
    if (
      items.some(
        existing =>
          `${existing.kind || 'product'}|${existing.productReference}|${existing.codes.join('|')}` ===
          key
      )
    ) {
      return;
    }
    items.push(item);
  };

  String(value || '')
    .split(/\r?\n/)
    .forEach(rawLine => {
      const line = rawLine.trim();
      if (!line) return;

      if (/^swatch\s+fabric samples?/i.test(line)) {
        if (current) pushItem(current);
        current = {
          kind: 'fabric-sample',
          productReference: 'FABRIC-SAMPLE',
          title: 'Fabric Sample',
          url: 'https://comfort-works.com/pages/fabric-samples',
          handle: 'fabric-samples',
          codes: [],
          fabricCode: '',
          styleName: '',
          fabricName: '',
        };
        return;
      }

      const urlMatch = line.match(PRODUCT_URL);
      if (urlMatch) {
        const url = urlMatch[0].replace(/[),.;]+$/, '');
        const handle = urlMatch[1];
        looseUrls.push({ url, handle });
        if (current && !current.url) {
          current.url = url;
          current.handle = handle;
        }
      }

      const nonUrlText = line.replace(/https?:\/\/[^\s)]+/gi, ' ').trim();
      if (!nonUrlText) return;

      const codeLine = nonUrlText.match(/^codes?\s*:\s*(.+)$/i);
      if (codeLine && current) {
        current.codes = codeLine[1]
          .split(/[,|]/)
          .map(cleanToken)
          .filter(Boolean)
          .map(code => code.toUpperCase());
        current.fabricCode =
          [...current.codes].reverse().find(isFabricCode) || current.codes.at(-1) || '';
        if (current.kind === 'fabric-sample' && current.fabricName) {
          current.title = current.fabricName;
        }
        return;
      }

      const referenceMatch = nonUrlText.match(PRODUCT_REFERENCE);
      if (!referenceMatch) {
        if (current) {
          applyConfigurationNames(current, nonUrlText);
          if (current.kind === 'fabric-sample' && current.fabricName) {
            current.title = current.fabricName;
          }
        }
        return;
      }
      const productReference = referenceMatch[1].toUpperCase();
      if (current) pushItem(current);
      const afterReference = nonUrlText.slice(
        (referenceMatch.index || 0) + referenceMatch[0].length
      );
      current = {
        kind: 'product',
        productReference,
        title: cleanCatalogueComparisonTitle(afterReference.replace(/^\s*[-–—:]?\s*/, '')),
        url: urlMatch?.[0]?.replace(/[),.;]+$/, '') || '',
        handle: urlMatch?.[1] || '',
        codes: [],
        fabricCode: '',
        styleName: '',
        fabricName: '',
      };
    });

  if (current) pushItem(current);

  // A copied list commonly contains URLs first and order lines afterwards.
  // Match by product wording. Never attach remaining URLs by position because
  // duplicate links can silently pair a chaise page with a different item.
  const unusedUrls = [...looseUrls];
  items.forEach(item => {
    if (item.url) return;
    const scored = unusedUrls
      .map((url, index) => ({ index, score: scoreHandleForItem(url.handle, item) }))
      .sort((a, b) => b.score - a.score);
    const index = scored[0]?.score >= 2 ? scored[0].index : -1;
    const candidate = unusedUrls[index];
    if (!candidate) return;
    item.url = candidate.url;
    item.handle = candidate.handle;
    unusedUrls.splice(index, 1);
  });

  // Plain product URLs are still useful even when no order text was pasted.
  if (!items.length) {
    looseUrls.forEach(({ url, handle }) => {
      const productReference = inferredReferenceFromHandle(handle);
      if (!productReference) return;
      pushItem({
        kind: 'product',
        productReference,
        title: handle.replace(/-/g, ' '),
        url,
        handle,
        codes: [],
        fabricCode: '',
        styleName: '',
        fabricName: '',
      });
    });
  }

  return items.slice(0, Math.max(1, limit));
}
