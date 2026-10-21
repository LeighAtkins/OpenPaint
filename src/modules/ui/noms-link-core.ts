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
  enabled?: boolean;
  /** "CS5L-SSA-L · Sofa Frame": the model without the file view. */
  modelTitle?: string;
}

const STAFF_EMAIL = /^[^@\s]+@comfort-works\.com$/i;

/** Same rule as the server: a confirmed @comfort-works.com address. */
export function isComfortWorksStaff(
  user: { email?: string; emailConfirmed?: boolean } | null | undefined
): boolean {
  return Boolean(user?.emailConfirmed && STAFF_EMAIL.test(String(user.email || '')));
}

/** One entry per measured file on the form, keyed "product:model:file". */
export function formModels(
  content: NomsFormContent | null | undefined,
  options: { includeDisabled?: boolean } = {}
): NomsModelEntry[] {
  const out: NomsModelEntry[] = [];
  (content?.products || []).forEach((product, p) => {
    if (product?.enabled === false && !options.includeDisabled) return;
    (product?.model_list || []).forEach((model, m) => {
      const files = model?.files || [];
      files.forEach((file, f) => {
        const reference = String(product?.reference || model?.name || '').trim();
        const label = String(model?.label || model?.name || '').trim();
        const parts = [reference, label].filter(Boolean);
        if (files.length > 1) {
          // Frame files are named Front_<model>, Side_<model>, Back_<model>.
          const view = /^(Front|Side|Back)_/i.exec(String(file?.name || ''))?.[1];
          if (view) parts.push(view);
          else if (file?.label && file.label !== label) parts.push(String(file.label));
        }
        const quantity = Number(file?.quantity) > 1 ? ` × ${file.quantity}` : '';
        out.push({
          key: `${p}:${m}:${f}`,
          reference,
          modelName: String(model?.name || reference),
          title:
            parts.join(' · ') +
            quantity +
            (product?.enabled === false ? ' (not enabled on the form)' : ''),
          enabled: product?.enabled !== false,
          modelTitle:
            [reference, label].filter(Boolean).join(' · ') +
            (product?.enabled === false ? ' (not enabled on the form)' : ''),
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

export type InputUnit = 'in' | 'cm';

/** 'in' or 'cm' when `value` is one, else `fallback` (the form's unit). */
export function pickInputUnit(value: unknown, fallback: InputUnit): InputUnit {
  return value === 'in' || value === 'cm' ? value : fallback;
}

/**
 * What a person typed in `inputUnit`, as form text in `formUnit`. Fractions and
 * vulgar fractions are read by parseMeasure. "" for empty, null if unreadable.
 */
export function typedToForm(raw: unknown, inputUnit: string, formUnit: string): string | null {
  const parsed = parseMeasure(raw);
  if (parsed === null || parsed === '') return parsed;
  return convertMeasure(parsed, inputUnit, formUnit);
}

/** Form text in `formUnit` shown in `inputUnit`; unreadable text is shown as is. */
export function formToTyped(value: string, formUnit: string, inputUnit: string): string {
  const parsed = parseMeasure(value);
  if (parsed === null || parsed === '') return value;
  return convertMeasure(parsed, formUnit, inputUnit);
}

export interface CanvasMeasurementLike {
  cm?: unknown;
  inch?: unknown;
  inchWhole?: unknown;
  inchFraction?: unknown;
  inputUnit?: unknown;
}

const positive = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(parseMeasure(value) || NaN) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The number a SofaPaint line carries, in centimetres, or null when the line
 * has none. Lines saved by older code (or loaded from a project where only one
 * unit survived) can have cm 0 with a good inch value, inch missing with a
 * good cm value, or only inchWhole/inchFraction. A note stored instead of a
 * measurement ("see photos") has no number.
 */
export function canvasMeasurementCm(
  measurement: CanvasMeasurementLike | string | number | null | undefined,
  assumeUnit = 'in'
): number | null {
  if (measurement === null || measurement === undefined) return null;
  if (typeof measurement === 'string' || typeof measurement === 'number') {
    // A bare value typed on a line: trust a stated unit, else `assumeUnit`.
    const text = String(measurement).trim();
    const n = positive(text);
    if (n === null) return null;
    const saysCm = /cm$/i.test(text);
    const saysIn = /(?:in|inches|inch|")$/i.test(text);
    return saysCm || (!saysIn && assumeUnit === 'cm') ? n : n * 2.54;
  }
  if (typeof measurement !== 'object') return null;
  const cm = positive(measurement.cm);
  if (cm !== null) return cm;
  const inch = positive(measurement.inch);
  if (inch !== null) return inch * 2.54;
  const whole = Number(measurement.inchWhole);
  const fraction = Number(measurement.inchFraction);
  const parts = (Number.isFinite(whole) ? whole : 0) + (Number.isFinite(fraction) ? fraction : 0);
  return parts > 0 ? parts * 2.54 : null;
}

/** A SofaPaint measurement ({cm, inch}) as form text in `unit`; "" when it has no number. */
export function fromCanvasMeasurement(
  measurement: CanvasMeasurementLike | string | number | null | undefined,
  unit: string
): string {
  if (measurement && typeof measurement === 'object') {
    // Prefer the value stored in the asked-for unit, as the line shows it.
    const direct = positive(unit === 'cm' ? measurement.cm : measurement.inch);
    if (direct !== null) return tidy(direct);
  }
  const cm = canvasMeasurementCm(measurement, unit);
  if (cm === null) return '';
  return tidy(unit === 'cm' ? cm : cm / 2.54);
}

/** True when form text holds a measurement (a number above zero); "0", "" and words do not. */
export function hasMeasure(value: unknown): boolean {
  const parsed = parseMeasure(value);
  return parsed !== null && parsed !== '' && Number(parsed) > 0;
}

/**
 * Redraw the canvas label of a line after its measurement changed, so the tag
 * reads what the line list reads. setMeasurement refreshes the list only.
 */
export function refreshLineTag(
  tagManager:
    | {
        getTagObject?: (label: string, scope: string) => unknown;
        updateTagText?: (label: string, scope: string) => void;
      }
    | null
    | undefined,
  scope: string,
  label: string
): boolean {
  if (!tagManager?.updateTagText) return false;
  if (tagManager.getTagObject && !tagManager.getTagObject(label, scope)) return false;
  tagManager.updateTagText(label, scope);
  return true;
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

// ---------------------------------------------------------------- PDF mapping
// A filled measuring PDF (one diagram per group) is applied to one or more form
// models (a model = all the files of one product model, e.g. a frame's front,
// side and back). Letters that exist on the model map straight across; the rest
// are chosen by hand.

export interface NomsModelGroup {
  key: string; // "product:model"
  title: string;
  /** field -> file key ("product:model:file") holding it */
  fields: Record<string, string>;
}

export function modelGroups(models: NomsModelEntry[]): NomsModelGroup[] {
  const groups = new Map<string, NomsModelGroup>();
  for (const model of models) {
    const [p, m] = model.key.split(':');
    const key = `${p}:${m}`;
    const group = groups.get(key) || {
      key,
      title: model.modelTitle || model.title,
      fields: {},
    };
    for (const field of model.fields) if (!group.fields[field]) group.fields[field] = model.key;
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

/** The form field a PDF label most likely is on a model (exact, D1<->D), or ''. */
export function defaultFieldFor(label: string, fields: Iterable<string>): string {
  const set = new Set(fields);
  const clean = String(label || '')
    .replace(/\*$/, '')
    .trim()
    .toUpperCase();
  if (set.has(clean)) return clean;
  const bare = /^([A-Z])1$/.exec(clean);
  if (bare && set.has(bare[1]) && !set.has(`${bare[1]}2`)) return bare[1];
  if (/^[A-Z]$/.test(clean) && set.has(`${clean}1`) && !set.has(`${clean}2`)) return `${clean}1`;
  return '';
}

/** Models that share most of a PDF diagram's letters. */
export function suggestTargets(
  labels: string[],
  groups: NomsModelGroup[],
  minShare = 0.6
): string[] {
  if (!labels.length) return [];
  const scored = groups.map(group => {
    const hits = labels.filter(label => defaultFieldFor(label, Object.keys(group.fields))).length;
    return { key: group.key, share: hits / labels.length, size: Object.keys(group.fields).length };
  });
  const best = Math.max(0, ...scored.map(s => s.share));
  if (best < minShare) return [];
  return scored.filter(s => s.share >= best - 0.05).map(s => s.key);
}

/** PDF value (number in `fromUnit`) as form text in `toUnit` ("cm" / "in"). */
export function pdfValueToForm(value: number, fromUnit: 'cm' | 'inch', toUnit: string): string {
  const inches = fromUnit === 'inch' ? value : value / 2.54;
  const out = toUnit === 'cm' ? inches * 2.54 : inches;
  return String(Math.round(out * 100) / 100);
}

export interface PdfGroupLike {
  file: string;
  title: string;
  labels: string[];
}

/**
 * Pick the form models each PDF diagram fills. A file's largest diagram (its
 * frame) picks the products; the file's other diagrams are kept to those
 * products. Among equally good models a "seat"/"back" word in the diagram title
 * decides; a tie that is still open is left for the person to choose.
 */
export function refineTargets(
  groups: PdfGroupLike[],
  models: NomsModelGroup[],
  modelLabels: Record<string, string>
): string[][] {
  const productOf = (key: string): string => key.split(':')[0];
  const anchors = new Map<string, Set<string>>();
  for (const file of new Set(groups.map(g => g.file))) {
    const inFile = groups.filter(g => g.file === file);
    const biggest = inFile.reduce((a, b) => (b.labels.length > a.labels.length ? b : a));
    const products = new Set(suggestTargets(biggest.labels, models).map(productOf));
    if (products.size) anchors.set(file, products);
  }
  return groups.map(group => {
    const allowed = anchors.get(group.file);
    const pool = allowed ? models.filter(m => allowed.has(productOf(m.key))) : models;
    let picks = suggestTargets(group.labels, pool.length ? pool : models);
    // One model per product: break ties with the title, else leave it open.
    const byProduct = new Map<string, string[]>();
    for (const key of picks)
      byProduct.set(productOf(key), [...(byProduct.get(productOf(key)) || []), key]);
    const title = group.title.toLowerCase();
    const word =
      /\bseat/.test(title) && !/\bback/.test(title)
        ? 'seat'
        : /\bback/.test(title) && !/\bseat/.test(title)
          ? 'back'
          : '';
    picks = [];
    for (const keys of byProduct.values()) {
      if (keys.length === 1) picks.push(keys[0]);
      else if (word) {
        const named = keys.filter(key =>
          new RegExp(`\\b${word}`, 'i').test(modelLabels[key] || '')
        );
        if (named.length === 1) picks.push(named[0]);
      }
    }
    return picks;
  });
}

/** Letter -> form field for one diagram on the given models, '' where no match. */
export function autoMapping(labels: string[], models: NomsModelGroup[]): Record<string, string> {
  const fields = Array.from(new Set(models.flatMap(m => Object.keys(m.fields))));
  return Object.fromEntries(labels.map(label => [label, defaultFieldFor(label, fields)]));
}

export interface PdfGroupForReview extends PdfGroupLike {
  unitAssumed?: boolean;
}

/**
 * Why a dropped PDF needs the mapping window before its values are used. An
 * empty list means every diagram fills exactly one model, every letter has a
 * field there, the unit was stated, and no two diagrams write the same field
 * on the same model: the values can go straight in.
 */
export function mappingNeedsReview(
  groups: PdfGroupForReview[],
  targets: string[][],
  models: NomsModelGroup[]
): string[] {
  const reasons: string[] = [];
  const byKey = new Map(models.map(m => [m.key, m]));
  const writes = new Map<string, string>(); // "model|field" -> diagram title
  groups.forEach((group, i) => {
    const where = group.title ? `${group.file} (${group.title})` : group.file;
    const picks = targets[i] || [];
    if (!picks.length) {
      reasons.push(`${where}: no form model matched`);
      return;
    }
    if (picks.length > 1) {
      reasons.push(`${where}: could fill ${picks.length} models`);
      return;
    }
    if (group.unitAssumed) reasons.push(`${where}: unit not stated in the PDF`);
    const model = byKey.get(picks[0]);
    if (!model) {
      reasons.push(`${where}: model ${picks[0]} is not on the form`);
      return;
    }
    const fields = Object.keys(model.fields);
    const unmatched = group.labels.filter(label => !defaultFieldFor(label, fields));
    if (unmatched.length) reasons.push(`${where}: no field for ${unmatched.join(', ')}`);
    for (const label of group.labels) {
      const field = defaultFieldFor(label, fields);
      if (!field) continue;
      const id = `${model.key}|${field}`;
      const other = writes.get(id);
      if (other && other !== where)
        reasons.push(`${model.title} ${field}: filled by both ${other} and ${where}`);
      else writes.set(id, where);
    }
  });
  return Array.from(new Set(reasons));
}
