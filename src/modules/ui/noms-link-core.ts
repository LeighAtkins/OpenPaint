// Pure helpers for the NOMS measurement link. The CW40 measure form stores each
// value as text in the form's unit ("in" or "cm") and checks it against rules
// written in centimetres ("A>0", "abs(A-C)<5"). Kept free of DOM and app state
// so they can be tested directly.

export interface NomsFormFile {
  name?: string;
  label?: string;
  quantity?: number;
  field_data?: Record<string, string>;
  measurements_diagram_cm?: string;
}
export interface NomsFormModel {
  name?: string;
  label?: string;
  files?: NomsFormFile[];
  rules?: Record<string, Array<{ eval?: string; message?: string; behaviour?: string }>>;
}
export interface NomsFormProduct {
  reference?: string;
  label?: string;
  enabled?: boolean;
  model_list?: NomsFormModel[];
}
export interface NomsFormContent {
  form_ID?: number | string;
  unit?: string;
  confirmed?: boolean;
  products?: NomsFormProduct[];
}
export interface NomsModelEntry {
  key: string;
  reference: string;
  modelName: string;
  title: string;
  fields: string[];
  values: Record<string, string>;
  rules: NonNullable<NomsFormModel['rules']>;
}

const STAFF_EMAIL = /^[^@\s]+@comfort-works\.com$/i;

/** Same rule as the server: a confirmed @comfort-works.com address. */
export function isComfortWorksStaff(
  user: { email?: string; emailConfirmed?: boolean } | null | undefined
): boolean {
  return Boolean(user?.emailConfirmed && STAFF_EMAIL.test(String(user.email || '')));
}

/** One entry per measured file on the form, keyed "product:model:file". */
export function formModels(content: NomsFormContent | null | undefined): NomsModelEntry[] {
  const out: NomsModelEntry[] = [];
  (content?.products || []).forEach((product, p) => {
    if (product?.enabled === false) return;
    (product?.model_list || []).forEach((model, m) => {
      const files = model?.files || [];
      files.forEach((file, f) => {
        const reference = String(product?.reference || model?.name || '').trim();
        const label = String(model?.label || model?.name || '').trim();
        const parts = [reference, label].filter(Boolean);
        if (files.length > 1 && file?.label) parts.push(String(file.label));
        const quantity = Number(file?.quantity) > 1 ? ` × ${file.quantity}` : '';
        out.push({
          key: `${p}:${m}:${f}`,
          reference,
          modelName: String(model?.name || reference),
          title: parts.join(' · ') + quantity,
          fields: Object.keys(file?.field_data || {}),
          values: { ...(file?.field_data || {}) },
          rules: model?.rules || {},
        });
      });
    });
  });
  return out;
}

/** The only model for a product reference, when there is exactly one. */
export function soleModelForReference(models: NomsModelEntry[], reference: string): string {
  const wanted = String(reference || '')
    .trim()
    .toUpperCase();
  const matches = models.filter(model => model.reference.toUpperCase() === wanted);
  return matches.length === 1 ? matches[0].key : '';
}

const VULGAR: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};
const tidy = (n: number): string => String(Math.round(n * 100) / 100);

/** "32", "32.5", "32,5", "32 1/2", "32½" -> "32.5". "" for empty, null if unreadable. */
export function parseMeasure(value: unknown): string | null {
  let raw = (typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '')
    .trim()
    .replace(/\s*(?:cm|in|inches|inch|")$/i, '');
  if (!raw) return '';
  let extra = 0;
  raw = raw
    .replace(/[¼½¾⅛⅜⅝⅞]/g, c => {
      extra += VULGAR[c] || 0;
      return ' ';
    })
    .trim();
  let n: number;
  let match: RegExpExecArray | null;
  if (!raw) n = 0;
  else if ((match = /^(\d+)\s+(\d+)\/(\d+)$/.exec(raw)))
    n = Number(match[1]) + Number(match[2]) / Number(match[3]);
  else if ((match = /^(\d+)\/(\d+)$/.exec(raw))) n = Number(match[1]) / Number(match[2]);
  else if (/^\d+(?:[.,]\d+)?$/.test(raw)) n = Number(raw.replace(',', '.'));
  else return null;
  n += extra;
  return Number.isFinite(n) && n >= 0 ? tidy(n) : null;
}

export function convertMeasure(value: string, from: string, to: string): string {
  if (value === '' || from === to) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return tidy(to === 'cm' ? n * 2.54 : n / 2.54);
}

export function toCentimetres(value: string, unit: string): number | null {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) return null;
  return unit === 'in' ? n * 2.54 : n;
}

/** A SofaPaint measurement ({cm, inch}) as form text in `unit`. */
export function fromCanvasMeasurement(
  measurement: { cm?: number; inch?: number } | null | undefined,
  unit: string
): string {
  if (!measurement) return '';
  const value = unit === 'cm' ? Number(measurement.cm) : Number(measurement.inch);
  if (!Number.isFinite(value) || value <= 0) return '';
  return tidy(value);
}

/**
 * Evaluates the rule language (numbers, field names, + - * /, abs(),
 * comparisons, && || !) without running rule text as code. Unknown syntax gives
 * null. A missing value counts as -1, as on the customer form.
 */
export function evalRule(expression: string, values: Record<string, string>): boolean | null {
  const tokens =
    String(expression || '')
      .replace(/Math\.abs/g, 'abs')
      .match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|&&|\|\||[<>=!]=|[<>!()+\-*/]|\S/g) || [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const take = (t: string): boolean => {
    if (tokens[i] !== t) return false;
    i += 1;
    return true;
  };
  const primary = (): number | boolean => {
    const t = tokens[i++];
    if (t === undefined) throw new Error('end');
    if (t === '(') {
      const v = or();
      if (!take(')')) throw new Error(')');
      return v;
    }
    if (t === '-') return -Number(primary());
    if (t === '!') return !primary();
    if (/^\d/.test(t)) return Number(t);
    if (t === 'abs' && take('(')) {
      const v = or();
      if (!take(')')) throw new Error(')');
      return Math.abs(Number(v));
    }
    if (/^[A-Za-z_]/.test(t)) {
      const raw = values?.[t];
      const v = Number(raw);
      return raw === '' || raw === undefined || raw === null || !Number.isFinite(v) ? -1 : v;
    }
    throw new Error(t);
  };
  const product = (): number | boolean => {
    let v = primary();
    while (peek() === '*' || peek() === '/')
      v = tokens[i++] === '*' ? Number(v) * Number(primary()) : Number(v) / Number(primary());
    return v;
  };
  const sum = (): number | boolean => {
    let v = product();
    while (peek() === '+' || peek() === '-')
      v = tokens[i++] === '+' ? Number(v) + Number(product()) : Number(v) - Number(product());
    return v;
  };
  const compare = (): number | boolean => {
    let v = sum();
    while (/^(?:[<>]=?|[=!]=)$/.test(peek() || '')) {
      const op = tokens[i++];
      const l = Number(v);
      const r = Number(sum());
      v =
        op === '<'
          ? l < r
          : op === '>'
            ? l > r
            : op === '<='
              ? l <= r
              : op === '>='
                ? l >= r
                : op === '=='
                  ? l === r
                  : l !== r;
    }
    return v;
  };
  const and = (): number | boolean => {
    let v = compare();
    while (take('&&')) {
      const r = compare();
      v = Boolean(v) && Boolean(r);
    }
    return v;
  };
  function or(): number | boolean {
    let v = and();
    while (take('||')) {
      const r = and();
      v = Boolean(v) || Boolean(r);
    }
    return v;
  }
  try {
    const v = or();
    return i === tokens.length ? Boolean(v) : null;
  } catch {
    return null;
  }
}

/** Errors block confirming; warnings are shown only. `values` are in `unit`. */
export function measureIssues(
  rules: NomsModelEntry['rules'],
  values: Record<string, string>,
  unit: string
): { errors: Record<string, string>; warnings: Record<string, string> } {
  const cm = Object.fromEntries(
    Object.entries(values || {}).map(([k, v]) => [
      k,
      unit === 'in' ? convertMeasure(v, 'in', 'cm') : v,
    ])
  );
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};
  for (const [field, list] of Object.entries(rules || {})) {
    for (const rule of list || []) {
      if (evalRule(String(rule?.eval || ''), cm) !== false) continue;
      const message =
        String(rule?.message || '').trim() ||
        (rule?.behaviour === 'error' ? 'Please enter a value' : 'Check this value');
      if (rule?.behaviour === 'error') errors[field] = errors[field] || message;
      else if (rule?.behaviour === 'warning' && !errors[field])
        warnings[field] = warnings[field] || message;
    }
  }
  return { errors, warnings };
}

/** Fields whose saved form value differs from what SofaPaint holds now. */
export function changedFields(
  saved: Record<string, Record<string, string>>,
  current: Record<string, Record<string, string>>
): string[] {
  const out: string[] = [];
  for (const [key, fields] of Object.entries(current || {})) {
    for (const [field, value] of Object.entries(fields || {})) {
      if (String(saved?.[key]?.[field] ?? '') !== String(value ?? '')) out.push(`${key}|${field}`);
    }
  }
  return out;
}
