import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  comparisonDifference,
  comparisonRows,
  drawingPath,
  formatMeasurement,
  indexProducts,
  normalizeDetail,
  searchProducts,
  selectionFromPath,
  selectionPath,
  type CatalogueProduct,
} from '../../src/modules/measurement-search/model';
const headers = vi.hoisted(() => ({ identity: 'staff|staff@comfort-works.com|true' }));
vi.mock('../../src/services/auth/cwAccess', () => ({
  getCwMeasurementIdentity: () => headers.identity,
  getCwRequestHeaders: async () => ({ Authorization: 'Bearer test-only-session' }),
}));
vi.mock('../../src/services/auth/authService', () => ({ authService: {} }));
import { MeasurementSession } from '../../src/modules/measurement-search/session';
const product: CatalogueProduct = {
  id: 'UHJvZHVjdDo1NDc=',
  name: 'Stocksund Sofa',
  brand: 'IKEA',
  reference: 'IK-SU-2',
  status: 'ENABLED',
  aliases: ['Stocksund 2 Seater Sofa Cover'],
  selections: [
    {
      key: 'stocksund-original',
      productId: 'UHJvZHVjdDo1NDc=',
      productReference: 'IK-SU-2',
      scopedReference: 'IK-SU-2',
      versionCode: '',
      versionLabel: '',
      style: 'Original',
      styleCode: 'VELC_SP',
      status: 'confirmed',
    },
  ],
};
const content = {
  width: 154,
  depth: 95,
  height: 89,
  lining: '沙发: 125*59 x1',
  product_components: [
    {
      name: 'Frame Cover',
      quantity: 1,
      attributes: [{ name: '4cm Velcro' }],
      measurements: [
        {
          name: 'Front panel width',
          value: 148,
          tolerance_min: 146.52,
          tolerance_max: 149.48,
          unit: 'cm',
        },
        { name: 'Zero measurement', value: 0, tolerance_min: null, tolerance_max: 0, unit: 'cm' },
      ],
    },
  ],
};
describe('measurement library', () => {
  it('searches names, website aliases, brand and exact reference without a network request', () => {
    const index = indexProducts([product]);
    expect(searchProducts(index, 'ikea stocksund 2 seater')).toEqual([product]);
    expect(searchProducts(index, 'ik-su-2')).toEqual([product]);
    expect(searchProducts(index, 'Axis')).toEqual([]);
  });
  it('preserves source tolerances, zero values, Unicode notes and attributes', () => {
    const result = normalizeDetail(content, 'confirmed');
    expect(result.lining).toBe(content.lining);
    expect(result.components[0].measurements[0]).toMatchObject({
      value: '148',
      min: '146.52',
      max: '149.48',
    });
    expect(result.components[0].measurements[1]).toMatchObject({ value: '0', min: '—', max: '0' });
    expect(result.components[0].attributes).toEqual(['4cm Velcro']);
  });
  it.each(['unconfirmed', 'review', 'unavailable'] as const)(
    'withholds ALL values, notes and diagrams for %s models',
    status => {
      expect(normalizeDetail(content, status)).toEqual({
        dimensions: [],
        components: [],
        lining: '',
        flexifit: '',
      });
    }
  );
  it('converts values AND tolerance limits without changing the underlying data', () => {
    expect(formatMeasurement('148', 'cm', 'in')).toBe('58.3');
    expect(formatMeasurement('146.52', 'cm', 'in')).toBe('57.7');
    expect(formatMeasurement('149.48', 'cm', 'in')).toBe('58.9');
    expect(formatMeasurement('148', 'cm', 'cm')).toBe('148.0');
    expect(formatMeasurement('25.4', 'mm', 'in')).toBe('1.0');
    expect(formatMeasurement('0', 'cm', 'in')).toBe('0.0');
    expect(formatMeasurement('—', 'cm', 'in')).toBe('—');
    expect(formatMeasurement('2', 'pieces', 'in')).toBe('2');
    expect(content.product_components[0].measurements[0].value).toBe(148);
  });
  it('matches comparisons by component, measurement and units; keeps unknown columns blank', () => {
    const first = normalizeDetail(content, 'confirmed');
    const second = normalizeDetail(
      {
        product_components: [
          {
            name: 'Seat Cushion Cover',
            measurements: [{ name: 'Front panel width', value: 60, unit: 'cm' }],
          },
        ],
      },
      'confirmed'
    );
    const rows = comparisonRows([first, second, null]);
    expect(rows[0].values.map(v => v?.value || null)).toEqual(['148', null, null]);
    expect(
      rows.find(row => row.section === 'Seat Cushion Cover')!.values.map(v => v?.value || null)
    ).toEqual([null, '60', null]);
  });
  it('shows signed two-model differences, matching sizes, and a range for three or more models', () => {
    expect(comparisonDifference(['154', '199'], 'cm', 'cm')).toEqual({
      kind: 'different',
      amount: '+45.0',
      unit: 'cm',
      mode: 'delta',
    });
    expect(comparisonDifference(['199', '154'], 'cm', 'cm')).toMatchObject({
      kind: 'different',
      amount: '−45.0',
    });
    expect(comparisonDifference(['62', '62'], 'cm', 'cm')).toEqual({
      kind: 'same',
      amount: '0.0',
      unit: 'cm',
      mode: 'delta',
    });
    expect(comparisonDifference(['154', '199'], 'cm', 'in')).toMatchObject({
      kind: 'different',
      amount: '+17.7',
      unit: 'in',
    });
    expect(comparisonDifference(['62', '82.5', '62'], 'cm', 'cm')).toEqual({
      kind: 'different',
      amount: '20.5',
      unit: 'cm',
      mode: 'range',
    });
    expect(comparisonDifference(['62', '62', '62'], 'cm', 'cm').kind).toBe('same');
    expect(comparisonDifference(['62', null], 'cm', 'cm').kind).toBe('unavailable');
    expect(comparisonDifference(['62', '—'], 'cm', 'cm').kind).toBe('unavailable');
  });
  it('round-trips exact PID style links and passes only identifiers into drawing', () => {
    const selection = product.selections[0];
    expect(selectionFromPath([product], selectionPath(selection))).toEqual({ product, selection });
    expect(selectionFromPath([product], '/search/bad/%invalid')).toBeNull();
    const handoff = JSON.parse(
      new URL(drawingPath(selection), 'https://sofapaint.com').searchParams.get('cwSelection')!
    );
    expect(Object.keys(handoff).sort()).toEqual([
      'productId',
      'productReference',
      'scopedReference',
      'style',
      'styleCode',
      'versionCode',
    ]);
  });
});
describe('measurement session privacy', () => {
  beforeEach(() => {
    headers.identity = 'staff|staff@comfort-works.com|true';
    vi.restoreAllMocks();
  });
  it('deduplicates in-flight requests and clears cached values on identity change', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ value: 148 }), { status: 200 }));
    const session = new MeasurementSession();
    session.setIdentity(headers.identity);
    const [first, second] = await Promise.all([
      session.request('record', {}),
      session.request('record', {}),
    ]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    session.clear();
    headers.identity = '';
    await expect(session.request('record', {})).rejects.toThrow('Sign in');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a late response after sign-out instead of populating the next session', async () => {
    let resolveResponse!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise(resolve => {
          resolveResponse = resolve;
        })
    );
    const session = new MeasurementSession();
    session.setIdentity(headers.identity);
    const request = session.request('record', {});
    await Promise.resolve();
    await Promise.resolve();
    session.clear();
    headers.identity = '';
    resolveResponse(new Response(JSON.stringify({ secretMeasurement: 148 }), { status: 200 }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('complete PDF export', () => {
  it('includes each component and withheld model without exposing their values', async () => {
    const { buildMeasurementPdf } = await import('../../src/modules/measurement-search/pdf');
    const { PDFDocument } = await import('pdf-lib');
    const detail = normalizeDetail(
      {
        ...content,
        lining: '',
        product_components: content.product_components.map(component => ({
          ...component,
          comments: 'Checked',
          lining: 'Frame lining',
        })),
      },
      'confirmed'
    );
    const selection = product.selections[0];
    const bytes = await buildMeasurementPdf(
      [
        { product, selection, detail },
        { product, selection: { ...selection, status: 'unconfirmed' }, detail: null },
      ],
      'in',
      new Map()
    );
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(document.getTitle()).toBe('Sofa measurement comparison — in');
    expect(document.getPages().every(page => page.getWidth() > page.getHeight())).toBe(true);
  });
});
