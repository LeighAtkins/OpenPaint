export type MeasurementStatus = 'confirmed' | 'unconfirmed' | 'unavailable' | 'review';
export interface Selection {
  key: string;
  productId: string;
  productReference: string;
  scopedReference: string;
  versionCode: string;
  versionLabel: string;
  style: string;
  styleCode: string;
  status: MeasurementStatus;
}
export interface CatalogueProduct {
  id: string;
  reference: string;
  name: string;
  brand: string;
  status: string;
  aliases: string[];
  selections: Selection[];
}
export interface Measurement {
  key: string;
  name: string;
  value: string;
  min: string;
  max: string;
  unit: string;
}
export interface Component {
  key: string;
  name: string;
  quantity: string;
  skirt: string;
  comments: string;
  lining: string;
  images: Array<{ url: string; name: string }>;
  attributes: string[];
  measurements: Measurement[];
}
export interface Detail {
  dimensions: Array<{ name: string; value: string }>;
  lining: string;
  flexifit: string;
  components: Component[];
}
const text = (value: unknown): string =>
  ['string', 'number', 'boolean'].includes(typeof value)
    ? String(value as string | number | boolean)
    : '';
export const canonical = (value: string) => value.toLowerCase().trim().replace(/\s+/g, ' ');
export function displayValue(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : text(value);
}
const nameOf = (value: any) => text(value?.translations?.en || value?.name);
export function normalizeDetail(content: any, status: MeasurementStatus): Detail {
  // Fail closed even if an unexpected response contains withheld values.
  if (status !== 'confirmed') return { dimensions: [], lining: '', flexifit: '', components: [] };
  return {
    dimensions: ['width', 'depth', 'height'].map(name => ({
      name,
      value: displayValue(content?.[name]),
    })),
    lining: text(content?.lining),
    flexifit: text(content?.flexifit),
    components: (Array.isArray(content?.product_components) ? content.product_components : []).map(
      (component: any, index: number) => ({
        key: `${canonical(nameOf(component))}|${index}`,
        name: nameOf(component),
        quantity: displayValue(component.quantity),
        skirt: nameOf(component.skirt_length),
        comments: text(component.comments),
        lining: text(component.lining),
        images: (component.slipcover_details_images || [])
          .filter((image: any) =>
            /^https:\/\/cw-archive\.invalid\/assets\/[a-f0-9]{64}\.[a-zA-Z0-9]+$/.test(
              image.url || ''
            )
          )
          .map((image: any) => ({ url: image.url, name: text(image.name) })),
        attributes: (component.attributes || []).map(nameOf).filter(Boolean),
        measurements: (component.measurements || []).map((measurement: any, row: number) => ({
          key: `${text(measurement.qc_measurement_id) || canonical(nameOf(measurement))}|${row}`,
          name: nameOf(measurement),
          value: displayValue(measurement.value),
          min: displayValue(measurement.tolerance_min),
          max: displayValue(measurement.tolerance_max),
          unit: text(measurement.unit),
        })),
      })
    ),
  };
}
export function indexProducts(products: CatalogueProduct[]) {
  return products.map(product => ({
    product,
    words: canonical(
      [
        product.name,
        product.reference,
        product.brand,
        ...product.aliases,
        ...product.selections.map(s => s.scopedReference),
      ].join(' ')
    ),
  }));
}
export function searchProducts(
  index: ReturnType<typeof indexProducts>,
  query: string
): CatalogueProduct[] {
  const term = canonical(query);
  const words = term.split(' ').filter(Boolean);
  if (!words.length) return [];
  return index
    .filter(row => words.every(word => row.words.includes(word)))
    .sort(
      (a, b) =>
        Number(canonical(b.product.reference) === term) -
          Number(canonical(a.product.reference) === term) ||
        Number(canonical(b.product.name).startsWith(term)) -
          Number(canonical(a.product.name).startsWith(term))
    )
    .map(row => row.product);
}
export function selectionPath(selection: Selection): string {
  return `/search/${encodeURIComponent(selection.productId)}/${encodeURIComponent([selection.scopedReference, selection.style, selection.styleCode].join(','))}`;
}
export function selectionFromPath(
  products: CatalogueProduct[],
  pathname: string
): { product: CatalogueProduct; selection: Selection } | null {
  try {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0] !== 'search') return null;
    const product = products.find(product => product.id === decodeURIComponent(parts[1]));
    const [reference, style, styleCode] = decodeURIComponent(parts[2]).split(',');
    const selection = product?.selections.find(
      selection =>
        selection.scopedReference === reference &&
        selection.style === style &&
        selection.styleCode === styleCode
    );
    return product && selection ? { product, selection } : null;
  } catch {
    return null;
  }
}
export function drawingPath(selection: Selection): string {
  return `/?cwSelection=${encodeURIComponent(JSON.stringify({ productId: selection.productId, productReference: selection.productReference, scopedReference: selection.scopedReference, versionCode: selection.versionCode, style: selection.style, styleCode: selection.styleCode }))}`;
}
// Each duplicate component/name stays separate; comparisons never mix units or
// quietly match a similarly named measurement in a different component.
export function comparisonRows(details: Array<Detail | null>) {
  const rows = new Map<
    string,
    { section: string; name: string; unit: string; values: Array<Measurement | null> }
  >();
  details.forEach((detail, column) => {
    const occurrences = new Map<string, number>();
    for (const component of detail?.components || []) {
      for (const measurement of component.measurements) {
        const base = `${canonical(component.name)}|${canonical(measurement.name)}|${canonical(measurement.unit)}`;
        const occurrence = occurrences.get(base) || 0;
        occurrences.set(base, occurrence + 1);
        const key = `${base}|${occurrence}`;
        let row = rows.get(key);
        if (!row) {
          row = {
            section: component.name,
            name: measurement.name,
            unit: measurement.unit,
            values: details.map(() => null),
          };
          rows.set(key, row);
        }
        row.values[column] = measurement;
      }
    }
  });
  return [...rows.values()];
}

export type DisplayUnits = 'cm' | 'in';
export function unitLabel(unit: string, units: DisplayUnits): string {
  return /^(cm|mm|in|inch|inches)$/i.test(unit || 'cm') ? units : unit;
}
export function formatMeasurement(value: string, unit: string, units: DisplayUnits): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value.trim())) return value;
  const normalized = (unit || 'cm').toLowerCase();
  const factors: Record<string, number> = { cm: 1, mm: 0.1, in: 2.54, inch: 2.54, inches: 2.54 };
  if (!(normalized in factors)) return value;
  const result = (Number(value) * factors[normalized]) / (units === 'in' ? 2.54 : 1);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(result);
}
export function comparisonDifference(
  values: Array<string | null>,
  sourceUnit: string,
  units: DisplayUnits
): {
  kind: 'same' | 'different' | 'unavailable';
  amount: string;
  unit: string;
  mode: 'delta' | 'range';
} {
  const mode = values.length === 2 ? 'delta' : 'range';
  const unit = unitLabel(sourceUnit, units);
  const unavailable = {
    kind: 'unavailable' as const,
    amount: '',
    unit,
    mode: mode as 'delta' | 'range',
  };
  if (values.length < 2 || !/^(cm|mm|in|inch|inches)$/i.test(sourceUnit || 'cm'))
    return unavailable;
  const displayed = values.map(value =>
    value === null ? '' : formatMeasurement(value, sourceUnit, units)
  );
  if (displayed.some(value => !/^-?\d+\.\d$/.test(value))) return unavailable;
  const numbers = displayed.map(Number);
  const difference =
    mode === 'delta' ? numbers[1] - numbers[0] : Math.max(...numbers) - Math.min(...numbers);
  const rounded = Math.round(Math.abs(difference) * 10) / 10;
  if (rounded === 0) return { kind: 'same', amount: '0.0', unit, mode };
  const amount = rounded.toFixed(1);
  return {
    kind: 'different',
    amount: mode === 'range' ? amount : `${difference > 0 ? '+' : '−'}${amount}`,
    unit,
    mode,
  };
}
