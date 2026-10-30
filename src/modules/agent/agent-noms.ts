/**
 * Compare a SofaPaint project's values with a NOMS measure-tool form.
 *
 * The NOMS form lives on another origin, so an agent reads it in its signed-in
 * NOMS tab with NOMS_SNAPSHOT_SCRIPT and passes the result in. The comparison
 * itself is pure so it can be tested.
 */
import type { AgentView } from './agent-geometry';

export interface NomsRow {
  rowId: string;
  /** Row label as typed on the form, e.g. "Back Cushion size 1 - wide". */
  label: string;
  /** Model code, e.g. CS3B-SRA-HB-R or CC-BK-BE. */
  model: string;
  qty: number | null;
  /** Letter -> value in the form's unit (cm unless `unit` says otherwise). */
  values: Record<string, string>;
}

export interface NomsProduct {
  productId: string;
  /** Order line reference, e.g. CS2B-SRA-R. */
  reference: string;
  title: string;
  rows: NomsRow[];
}

export interface NomsSnapshot {
  order: string;
  form: string;
  unit: 'cm' | 'inch';
  products: NomsProduct[];
}

/**
 * Run on a NOMS measurements page (…/order/<n>/measurements?form=…). Returns a
 * NomsSnapshot. Each product card has a header row with one column per model
 * row ("<label> <MODEL> × <qty>") and one table row per letter.
 */
export const NOMS_SNAPSHOT_SCRIPT = `(() => {
  const cards = [...new Set([...document.querySelectorAll('input[name^="v__"]')]
    .map(i => i.closest('div.bg-white') || i.closest('table')))];
  const products = cards.map(card => {
    const title = (card.querySelector('h2,h3,h4') || {}).innerText || '';
    const heads = [...card.querySelectorAll('tr:first-child th')].slice(1).map(th => th.innerText.replace(/\\s+/g, ' ').trim());
    const rows = heads.map(head => {
      const m = /^(.*?)\\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\\s*×\\s*(\\d+)\\s*$/.exec(head) || [];
      return { rowId: '', label: (m[1] || head).trim(), model: m[2] || '', qty: m[3] ? Number(m[3]) : null, values: {} };
    });
    let productId = '';
    for (const tr of card.querySelectorAll('tbody tr')) {
      [...tr.children].slice(1).forEach((td, col) => {
        const input = td.querySelector('input[name^="v__"]');
        if (!input || !rows[col]) return;
        const [, pid, rowId, letter] = input.name.split('__');
        productId = pid;
        rows[col].rowId = rowId;
        if (input.value.trim()) rows[col].values[letter] = input.value.trim();
      });
    }
    return { productId, reference: title.split(':')[0].trim(), title: title.trim(), rows };
  });
  const unitText = (/Unit:\\s*(cm|in)/i.exec(document.body.innerText) || [])[1] || 'cm';
  const params = new URLSearchParams(location.search);
  return {
    order: (/order\\/(\\d+)/.exec(location.pathname) || [])[1] || '',
    form: params.get('form') || '',
    unit: /^in/i.test(unitText) ? 'inch' : 'cm',
    products,
  };
})()`;

export type CompareStatus =
  | 'match'
  | 'differs'
  | 'missing_in_noms'
  | 'missing_in_sofapaint'
  | 'sofapaint_disagrees';

export interface CompareRow {
  rowId: string;
  reference: string;
  model: string;
  label: string;
  /** Views that hold this letter for the row. */
  viewIds: string[];
  sofapaintCm: number | null;
  nomsCm: number | null;
  diffCm: number | null;
  status: CompareStatus;
  /** When views disagree with each other: each view's value. */
  sofapaintValues?: Record<string, number>;
}

export interface CompareResult {
  rows: CompareRow[];
  /** Everything that is not a match. */
  differences: CompareRow[];
  /** viewId -> NOMS row used, and how it was chosen. */
  mapping: Record<
    string,
    { rowId: string; reference: string; model: string; how: 'given' | 'auto' }
  >;
  unmappedViews: string[];
  summary: Record<CompareStatus, number>;
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(w => w.length > 0)
  );

/**
 * Pick the NOMS row a view describes. A frame view names its order line
 * reference (CS2B-SRA-R) in its title; a cushion view names its model
 * (CC-BK-BE) and usually a size or name that matches the row label.
 */
export function autoMapView(
  title: string,
  products: NomsProduct[]
): { product: NomsProduct; row: NomsRow } | null {
  const upper = title.toUpperCase();
  let best: { product: NomsProduct; row: NomsRow; score: number } | null = null;
  let tie = false;
  const titleWords = words(title);
  for (const product of products) {
    for (const row of product.rows) {
      if (!row.model || !upper.includes(row.model.toUpperCase())) continue;
      const score = [...words(row.label)].filter(w => titleWords.has(w)).length;
      if (!best || score > best.score) {
        best = { product, row, score };
        tie = false;
      } else if (score === best.score) {
        tie = true;
      }
    }
  }
  if (best && !tie) return { product: best.product, row: best.row };
  const byReference = products.filter(
    p => p.reference && upper.includes(p.reference.toUpperCase())
  );
  if (byReference.length === 1 && byReference[0].rows[0]) {
    return { product: byReference[0], row: byReference[0].rows[0] };
  }
  return null;
}

/**
 * Compare the project with the NOMS form, one NOMS row at a time: every view
 * mapped to a row contributes its letters (cm, ±toleranceCm).
 */
export function compareWithNoms(
  views: AgentView[],
  snapshot: NomsSnapshot,
  given: Record<string, string> = {},
  toleranceCm = 0.15
): CompareResult {
  const toCm = (value: string) => {
    const n = parseFloat(value.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return snapshot.unit === 'inch' ? n * 2.54 : n;
  };
  const allRows = snapshot.products.flatMap(product => product.rows.map(row => ({ product, row })));
  const result: CompareResult = {
    rows: [],
    differences: [],
    mapping: {},
    unmappedViews: [],
    summary: {
      match: 0,
      differs: 0,
      missing_in_noms: 0,
      missing_in_sofapaint: 0,
      sofapaint_disagrees: 0,
    },
  };

  // rowId -> letter -> viewId -> cm
  const ours = new Map<string, Map<string, Map<string, number>>>();
  for (const view of views) {
    let hit: { product: NomsProduct; row: NomsRow } | null;
    let how: 'given' | 'auto' = 'auto';
    if (given[view.viewId]) {
      hit = allRows.find(r => r.row.rowId === given[view.viewId]) || null;
      how = 'given';
    } else {
      hit = autoMapView(view.title, snapshot.products);
    }
    if (!hit) {
      if (view.lines.some(l => l.inch !== null)) result.unmappedViews.push(view.viewId);
      continue;
    }
    result.mapping[view.viewId] = {
      rowId: hit.row.rowId,
      reference: hit.product.reference,
      model: hit.row.model,
      how,
    };
    const letters = ours.get(hit.row.rowId) || new Map<string, Map<string, number>>();
    ours.set(hit.row.rowId, letters);
    for (const line of view.lines) {
      if (line.inch === null) continue;
      const byView = letters.get(line.label) || new Map<string, number>();
      byView.set(view.viewId, Math.round(line.inch * 2.54 * 10) / 10);
      letters.set(line.label, byView);
    }
  }

  for (const { product, row } of allRows) {
    const letters = ours.get(row.rowId);
    if (!letters) continue;
    const labels = new Set([...letters.keys(), ...Object.keys(row.values)]);
    for (const label of [...labels].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    )) {
      const byView = letters.get(label) || new Map<string, number>();
      const values = [...byView.values()];
      const distinct = new Set(values);
      const sofapaintCm = values.length ? values[0] : null;
      const nomsCm = row.values[label] !== undefined ? toCm(row.values[label]) : null;
      let status: CompareStatus;
      let diffCm: number | null = null;
      if (distinct.size > 1) status = 'sofapaint_disagrees';
      else if (sofapaintCm === null) status = 'missing_in_sofapaint';
      else if (nomsCm === null) status = 'missing_in_noms';
      else {
        diffCm = Math.round((sofapaintCm - nomsCm) * 10) / 10;
        status = Math.abs(diffCm) <= toleranceCm ? 'match' : 'differs';
      }
      const entry: CompareRow = {
        rowId: row.rowId,
        reference: product.reference,
        model: row.model,
        label,
        viewIds: [...byView.keys()],
        sofapaintCm,
        nomsCm,
        diffCm,
        status,
      };
      if (distinct.size > 1) entry.sofapaintValues = Object.fromEntries(byView);
      result.rows.push(entry);
      result.summary[status] += 1;
      if (status !== 'match') result.differences.push(entry);
    }
  }
  return result;
}
