// Pure helpers for the NOMS measurement link. The CW40 measure form stores each
// value as text in the form's unit ("in" or "cm") and checks it against rules
// written in centimetres ("A>0", "abs(A-C)<5"). Kept free of DOM and app state
// so they can be tested directly.

import { parseCustomerValue, rangeValue, type CustomerValue } from '../utils/customer-value';

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

// ---------------------------------------------------------------- letter links
// By default a form letter takes its value from lines labelled with that same
// letter on the views linked to its model. When the person drew with their own
// letters (her H1 at the arm front, the form's H1 on the back frame) a letter
// can instead be linked to one drawn line, whatever its label.

export interface LineLink {
  viewId: string;
  label: string;
  /** "match": made by the Match images screen, replaced when it is applied again. */
  by?: 'match';
}
export type LineLinks = Record<string, LineLink>;

/** A drawn line with a measurement, as the panel sees it. */
export interface MeasuredLine {
  viewId: string;
  /** Stroke scope: the view id, or "view::tab:x" for a capture tab. */
  scope: string;
  label: string;
  /** Form text in the form's unit, "" when the line has no number. */
  value: string;
}

export const lineLinkKey = (key: string, letter: string): string => `${key}:${letter}`;

export interface LetterLines {
  /** True when an explicit link decides, false under the same-label rule. */
  linked: boolean;
  link?: LineLink;
  /** The lines feeding this letter; empty when the linked line is gone. */
  lines: MeasuredLine[];
}

/**
 * The lines that feed form letter `letter` of model `key`. An explicit link in
 * `lineLinks` wins and names one view and label (every capture tab of that
 * view with that label counts). Otherwise lines labelled `letter` on
 * `sameLabelViews` (the views linked to the model, and its diagram) do.
 */
export function resolveLineForLetter(
  key: string,
  letter: string,
  lineLinks: LineLinks | null | undefined,
  lines: MeasuredLine[],
  sameLabelViews: Iterable<string> = []
): LetterLines {
  const link = lineLinks?.[lineLinkKey(key, letter)];
  if (link?.viewId && link?.label) {
    return {
      linked: true,
      link,
      lines: lines.filter(line => line.viewId === link.viewId && line.label === link.label),
    };
  }
  const views = new Set(sameLabelViews);
  return {
    linked: false,
    lines: lines.filter(line => views.has(line.viewId) && line.label === letter),
  };
}

export interface LineLinkSuggestion {
  key: string;
  letter: string;
  viewId: string;
  label: string;
  /** The line's value in the form's unit, "" when it has none. */
  value: string;
  /** The form's current value for the letter, for comparison. */
  formValue: string;
}

/**
 * Lines that could feed each still-unlinked letter: a line with the same
 * label on a view linked to the letter's model (never the model's own CW
 * diagram, whose lines are the form's). Suggestions only; the person accepts
 * each one with its value in view, because the same letter can mean a
 * different measurement on the form.
 */
export function suggestLineLinks(
  models: Array<{ key: string; fields: string[] }>,
  lines: MeasuredLine[],
  viewBindings: Record<string, string>,
  values: Record<string, Record<string, string>>,
  existing: LineLinks | null | undefined,
  diagramViews: Record<string, string> = {}
): LineLinkSuggestion[] {
  const out: LineLinkSuggestion[] = [];
  for (const model of models) {
    const views = new Set(
      Object.entries(viewBindings || {})
        .filter(([viewId, key]) => key === model.key && diagramViews[model.key] !== viewId)
        .map(([viewId]) => viewId)
    );
    for (const letter of model.fields) {
      if (existing?.[lineLinkKey(model.key, letter)]) continue;
      for (const line of lines) {
        if (!views.has(line.viewId) || line.label !== letter) continue;
        if (out.some(s => s.key === model.key && s.letter === letter && s.viewId === line.viewId))
          continue;
        out.push({
          key: model.key,
          letter,
          viewId: line.viewId,
          label: line.label,
          value: line.value,
          formValue: values?.[model.key]?.[letter] ?? '',
        });
      }
    }
  }
  return out;
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
  /** CW model codes the model goes by on the form (product reference, model name), upper case. */
  codes?: string[];
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
      codes: Array.from(
        new Set([model.reference, model.modelName].map(normaliseCode).filter(Boolean))
      ),
    };
    for (const field of model.fields) if (!group.fields[field]) group.fields[field] = model.key;
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

/** "cs5l-sa-hb-l " -> "CS5L-SA-HB-L". */
export function normaliseCode(code: unknown): string {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Models whose form code is one of a PDF template's model codes. */
export function modelsForCodes(codes: readonly string[] | undefined, models: NomsModelGroup[]) {
  const wanted = new Set((codes || []).map(normaliseCode).filter(Boolean));
  if (!wanted.size) return [];
  return models.filter(m => (m.codes || []).some(code => wanted.has(code)));
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
  /** CW model codes of the library template the page matched (confident matches only). */
  modelCodes?: string[];
  /** The template's view ("frame", "cushion", ...). */
  view?: string | null;
  /** Page of the PDF the diagram is on. */
  pageNumber?: number;
  /**
   * Form run: consecutive pages printed from one library template ("one
   * customer form"). Groups sharing it are matched to the same NOMS model.
   */
  run?: string;
  /** The run's template name ("CS3-SSA-HB-R"), for messages and the window. */
  runTitle?: string;
}

// ---------------------------------------------------------------- model codes
// A customer often fills the nearest form there is (a CS3 sofa form for a CS2B
// loveseat), so a form run is matched to a NOMS product by how alike the codes
// are: family digits (seat count), side (-L / -R), arm and back tokens.

interface CodeParts {
  prefix: string;
  digits: string;
  side: string;
  tokens: string[];
}

function codeParts(code: string): CodeParts {
  const parts = normaliseCode(code).split('-').filter(Boolean);
  const head = parts.shift() || '';
  const m = /^([A-Z]+)(\d*)[A-Z]*$/.exec(head);
  let side = '';
  const last = parts[parts.length - 1];
  if (last && /^(L|R|LEFT|RIGHT|LH|RH)$/.test(last)) side = parts.pop()!.charAt(0);
  return { prefix: m ? m[1] : head, digits: m ? m[2] : '', side, tokens: parts };
}

const CODE_WEIGHTS = { prefix: 1, digits: 3, side: 3, token: 2, tokenBase: 1, letters: 1 };
/** An exact code match beats every similarity score. */
const CODE_EXACT = 100;
/** The best product must beat the next by this much to be used without asking. */
export const CODE_MARGIN = 2;
/** ...and score at least this much when the form has more than one product. */
export const CODE_MIN = 3;

/**
 * How alike two CW model codes are: same family digits (CS5 vs CS2), same
 * side, shared arm/back tokens (SSA, SA2, HB, ...), plus letter overlap.
 * Higher is closer; a different side counts against.
 */
export function codeSimilarity(a: string, b: string): number {
  const x = codeParts(a);
  const y = codeParts(b);
  if (!x.prefix || !y.prefix) return 0;
  if (normaliseCode(a) === normaliseCode(b)) return CODE_EXACT;
  let score = 0;
  if (x.prefix === y.prefix) score += CODE_WEIGHTS.prefix;
  if (x.digits && y.digits && x.digits === y.digits) score += CODE_WEIGHTS.digits;
  if (x.side && y.side) score += x.side === y.side ? CODE_WEIGHTS.side : -CODE_WEIGHTS.side;
  const base = (t: string): string => t.replace(/\d+$/, '');
  const theirs = new Set(y.tokens);
  const theirBases = new Set(y.tokens.map(base));
  for (const token of new Set(x.tokens)) {
    if (theirs.has(token)) score += CODE_WEIGHTS.token;
    else if (theirBases.has(base(token))) score += CODE_WEIGHTS.tokenBase;
  }
  const letters = (s: string): Set<string> => new Set(normaliseCode(s).replace(/[^A-Z]/g, ''));
  const la = letters(a);
  const lb = letters(b);
  const shared = Array.from(la).filter(c => lb.has(c)).length;
  const union = new Set([...la, ...lb]).size;
  if (union) score += (CODE_WEIGHTS.letters * shared) / union;
  return Math.round(score * 1000) / 1000;
}

const productOf = (key: string): string => key.split(':')[0];

/** One form run and the NOMS product it was matched to. */
export interface RunMatch {
  run: string;
  title: string;
  file: string;
  pages: number[];
  /** Indexes into the groups list. */
  groups: number[];
  /** Product index ("0", "1", ...) chosen, '' when none. */
  product: string;
  score: number;
  /** Every product that the letters allow, best first. */
  scores: Array<{ product: string; score: number }>;
  /** Why a person should choose (score too close, too low, or two runs want one product). */
  doubt: string[];
}

export interface PdfRunMatching {
  /** Models each group fills (as refineTargets). */
  targets: string[][];
  runs: RunMatch[];
  /** Run-level reasons to open the mapping window, empty when the match is clear. */
  review: string[];
}

/** "pages 1 to 3", "page 4". */
export function pagesText(pages: number[]): string {
  const list = Array.from(new Set(pages.filter(n => n > 0))).sort((a, b) => a - b);
  if (!list.length) return '';
  if (list.length === 1) return `page ${list[0]}`;
  const consecutive = list.every((n, i) => !i || n === list[i - 1] + 1);
  return consecutive
    ? `pages ${list[0]} to ${list[list.length - 1]}`
    : `pages ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** "CS3-SSA-HB-R, pages 1 to 3" for a run. */
export const runLabel = (run: Pick<RunMatch, 'title' | 'pages'>): string =>
  [run.title, pagesText(run.pages)].filter(Boolean).join(', ');

/**
 * Match each form run (consecutive pages of one template) to at most one NOMS
 * product, by model code similarity, each product taking at most one run.
 * Runs whose best two products score too close, whose best is too low, or that
 * want a product another run scores higher on are listed in `review`, with the
 * suggestion still made so the window can preselect it.
 */
export function matchPdfRuns(
  groups: PdfGroupLike[],
  models: NomsModelGroup[],
  modelLabels: Record<string, string> = {}
): PdfRunMatching {
  const products = Array.from(new Set(models.map(m => productOf(m.key))));
  const modelsOf = (product: string): NomsModelGroup[] =>
    models.filter(m => productOf(m.key) === product);
  const productName = (product: string): string => {
    const first = modelsOf(product)[0];
    return (first?.codes || [])[0] || first?.title?.split(' · ')[0] || `product ${product}`;
  };

  const runs: RunMatch[] = [];
  groups.forEach((group, i) => {
    if (!(group.modelCodes || []).length) return;
    // Without a run id, the pages of one file naming the same codes are one run.
    const id =
      group.run || `${group.file}#${(group.modelCodes || []).map(normaliseCode).join(',')}`;
    let run = runs.find(r => r.run === id);
    if (!run) {
      run = {
        run: id,
        title: group.runTitle || group.modelCodes![0],
        file: group.file,
        pages: [],
        groups: [],
        product: '',
        score: 0,
        scores: [],
        doubt: [],
      };
      runs.push(run);
    }
    run.groups.push(i);
    if (group.pageNumber) run.pages.push(group.pageNumber);
  });
  for (const run of runs) {
    run.pages = Array.from(new Set(run.pages)).sort((a, b) => a - b);
    const codes = Array.from(
      new Set(run.groups.flatMap(i => groups[i].modelCodes || []).map(normaliseCode))
    );
    for (const product of products) {
      const pool = modelsOf(product);
      // The letters must still mostly agree on at least one page of the run.
      const fits = run.groups.some(i => suggestTargets(groups[i].labels, pool, 0.5).length > 0);
      if (!fits) continue;
      const productCodes = Array.from(new Set(pool.flatMap(m => m.codes || [])));
      let score = 0;
      for (const a of codes)
        for (const b of productCodes) score = Math.max(score, codeSimilarity(a, b));
      run.scores.push({ product, score });
    }
    run.scores.sort((a, b) => b.score - a.score || Number(a.product) - Number(b.product));
  }

  // Strongest runs choose first; a product takes one run.
  const taken = new Map<string, RunMatch>();
  const order = runs
    .slice()
    .sort((a, b) => (b.scores[0]?.score ?? -1) - (a.scores[0]?.score ?? -1));
  for (const run of order) {
    const [best, second] = run.scores;
    if (!best) {
      run.doubt.push(`${runLabel(run)}: no form model has its letters`);
      continue;
    }
    const holder = taken.get(best.product);
    if (holder) {
      const doubt = `${runLabel(holder)} and ${runLabel(run)} both fit ${productName(best.product)} best`;
      holder.doubt.push(doubt);
      run.doubt.push(doubt);
    } else {
      if (products.length > 1 && second && best.score - second.score < CODE_MARGIN)
        run.doubt.push(
          `${runLabel(run)}: fits ${productName(best.product)} and ${productName(second.product)} about equally`
        );
      if (products.length > 1 && best.score < CODE_MIN && best.score < CODE_EXACT)
        run.doubt.push(`${runLabel(run)}: no form model code is close to ${run.title}`);
    }
    const free = run.scores.find(s => !taken.has(s.product));
    if (free) {
      run.product = free.product;
      run.score = free.score;
      taken.set(free.product, run);
    }
  }

  const runOf = new Map<number, RunMatch>();
  for (const run of runs) for (const i of run.groups) runOf.set(i, run);
  const targets = refineByLetters(groups, models, modelLabels, runOf);
  return {
    targets,
    runs,
    review: Array.from(new Set(runs.flatMap(r => r.doubt))),
  };
}

/**
 * Pick the form models each PDF diagram fills. Diagrams of an identified form
 * run go to the product matchPdfRuns chose for the run (see there). Other
 * diagrams: a file's largest diagram (its frame) picks the products; the
 * file's other diagrams are kept to those products. Among equally good models
 * a "seat"/"back" word in the diagram title (or the template's cushion / frame
 * view) decides; a tie that is still open is left for the person to choose.
 */
export function refineTargets(
  groups: PdfGroupLike[],
  models: NomsModelGroup[],
  modelLabels: Record<string, string>
): string[][] {
  return matchPdfRuns(groups, models, modelLabels).targets;
}

function refineByLetters(
  groups: PdfGroupLike[],
  models: NomsModelGroup[],
  modelLabels: Record<string, string>,
  runOf: Map<number, RunMatch>
): string[][] {
  const anchors = new Map<string, Set<string>>();
  const loose = groups.map((g, i) => ({ g, i })).filter(({ i }) => !runOf.has(i));
  for (const file of new Set(loose.map(({ g }) => g.file))) {
    // Pages of a file that holds an identified form stay with that form's products.
    const fromRuns = new Set(
      Array.from(runOf.values())
        .filter(r => r.file === file && r.product)
        .map(r => r.product)
    );
    if (fromRuns.size) {
      anchors.set(file, fromRuns);
      continue;
    }
    const inFile = loose.filter(({ g }) => g.file === file).map(({ g }) => g);
    const biggest = inFile.reduce((a, b) => (b.labels.length > a.labels.length ? b : a));
    const products = new Set(suggestTargets(biggest.labels, models).map(productOf));
    if (products.size) anchors.set(file, products);
  }
  return groups.map((group, i) => {
    const run = runOf.get(i);
    let picks: string[];
    if (run) {
      if (!run.product) return [];
      const pool = models.filter(m => productOf(m.key) === run.product);
      const coded = suggestTargets(group.labels, modelsForCodes(group.modelCodes, pool), 0.5);
      picks = coded.length ? coded : suggestTargets(group.labels, pool, 0.5);
    } else {
      const allowed = anchors.get(group.file);
      const pool = allowed ? models.filter(m => allowed.has(productOf(m.key))) : models;
      picks = suggestTargets(group.labels, pool.length ? pool : models);
    }
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
          : group.view === 'cushion'
            ? 'cushion'
            : group.view && /^(frame|front|side|back|arm)$/.test(group.view)
              ? 'frame'
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
  // Form runs first: an unclear code match, or two runs on one product.
  const reasons: string[] = [...matchPdfRuns(groups, models).review];
  const byKey = new Map(models.map(m => [m.key, m]));
  const runsOnProduct = new Map<string, Set<string>>();
  groups.forEach((group, i) => {
    if (!group.run) return;
    for (const key of targets[i] || []) {
      const set = runsOnProduct.get(productOf(key)) || new Set<string>();
      set.add(group.runTitle ? `${group.runTitle} (${group.file})` : group.run);
      runsOnProduct.set(productOf(key), set);
    }
  });
  for (const [product, runs] of runsOnProduct)
    if (runs.size > 1) {
      const name = models.find(m => productOf(m.key) === product)?.title.split(' · ')[0] || product;
      reasons.push(`${name}: filled by ${runs.size} forms (${Array.from(runs).join(', ')})`);
    }
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

// ---------------------------------------------------------------- drop review
// Everything a dropped PDF carries lands in the panel. Each value is first
// resolved to the form letters it fills (CW form: by diagram and letter;
// SofaPaint review PDF: by view and line link), then classified here: every
// touched letter is either matched or flagged with a one-line reason, and a
// value with no letter is listed as an extra. Flags never block a save.

export type DropUnit = 'cm' | 'inch';

/** One value read from a dropped PDF, with the form letters it fills. */
export interface DropValue {
  /** Unique within a drop: "file|page|view|label". */
  id: string;
  file: string;
  pageNumber: number;
  /** Diagram or view title, for messages. */
  title: string;
  label: string;
  /** The number used (a range's default end), in `unit`. */
  value: number;
  unit: DropUnit;
  unitAssumed?: boolean;
  /** Both numbers when the customer wrote a range. */
  range?: number[];
  /** What the customer typed, tidied. */
  text?: string;
  /** SofaPaint review PDFs: the project view the value was measured on. */
  viewId?: string;
  /** Form letters this value fills: file key ("product:model:file") and field. */
  targets: Array<{ key: string; field: string }>;
  /** Why the value fills nothing, when `targets` is empty. */
  why?: string;
  /** Titles of the other models the same diagram filled, when it filled more than one. */
  alsoFills?: string[];
  /** The customer wrote words only ("n/a", "see photo"): shown as a note, never placed. */
  textOnly?: boolean;
  /** Reasons the PDF reader gives to check the value ("Read by OCR, check it", ...). */
  review?: string[];
  /** Picture of the box the value was read from, shown beside the flag. */
  thumb?: string;
  /** Read by OCR from a scanned page. */
  ocr?: boolean;
}

/** Flag on every value read by OCR from a scan. */
export const OCR_FLAG = 'Read by OCR, check it';
/** OCR values read at least this surely are not flagged (as OCR_CONFIDENT in read-customer-pdf). */
const OCR_CONFIDENT = 0.8;

export type DropFlagKind =
  | 'not-in-pdf'
  | 'duplicate'
  | 'rule'
  | 'range'
  | 'unit-assumed'
  | 'shared'
  | 'changed'
  | 'text-only'
  | 'ocr'
  | 'check';

export interface DropFlag {
  kind: DropFlagKind;
  reason: string;
  /** Picture of the box the value came from (OCR), so a person can confirm at a glance. */
  thumb?: string;
}

export interface DropRow {
  key: string;
  field: string;
  /** Id of the drop value that filled the row, '' when none did. */
  from: string;
  flags: DropFlag[];
}

export interface DropReview {
  /** Values to write: file key, field, form text in the form's unit. */
  placements: Array<{ key: string; field: string; value: string; from: string }>;
  /** "key|field" -> row status, for every letter on a model the drop touched. */
  rows: Record<string, DropRow>;
  /** PDF values that fill no form letter (PDF letter not on the form). */
  extras: Array<{ id: string; label: string; where: string; text: string; reason: string }>;
  /** Number of letters filled from the PDF. */
  filled: number;
  /** Flagged rows plus extras. */
  toCheck: number;
  /**
   * Every value read, counted once: filled with nothing to check, flagged (on a
   * flagged letter, or lost to another value on it), or set aside (fills no
   * letter). filled + flagged + setAside === read.
   */
  counts: DropCounts;
}

export interface DropCounts {
  read: number;
  filled: number;
  flagged: number;
  setAside: number;
}

/** Count each drop value once against the review's rows (see DropReview.counts). */
export function dropCounts(
  values: DropValue[],
  review: Pick<DropReview, 'rows' | 'extras'>
): DropCounts {
  const aside = new Set(review.extras.map(e => e.id));
  const counts: DropCounts = { read: values.length, filled: 0, flagged: 0, setAside: 0 };
  for (const value of values) {
    if (aside.has(value.id)) {
      counts.setAside += 1;
      continue;
    }
    const rows = value.targets
      .map(t => review.rows[`${t.key}|${t.field}`])
      .filter((r): r is DropRow => Boolean(r));
    if (!rows.length) counts.setAside += 1;
    else if (value.textOnly || rows.some(r => r.from !== value.id || r.flags.length))
      counts.flagged += 1;
    else counts.filled += 1;
  }
  return counts;
}

/** "63 values read: 40 filled, 18 to check, 5 set aside". */
export function dropCountsText(counts: DropCounts): string {
  const parts = [`${counts.filled} filled`];
  if (counts.flagged) parts.push(`${counts.flagged} to check`);
  if (counts.setAside) parts.push(`${counts.setAside} set aside`);
  return `${counts.read} value${counts.read === 1 ? '' : 's'} read: ${parts.join(', ')}`;
}

const unitWord = (unit: DropUnit): string => (unit === 'inch' ? 'in' : 'cm');
const shortNumber = (n: number): string => String(Math.round(n * 1000) / 1000);
const sourceOf = (v: DropValue): string =>
  `${v.file}${v.pageNumber ? ` p${v.pageNumber}` : ''}${v.viewId ? ` ${v.title}` : ''} ${v.label}`;

/** The number a drop value gives (a picked range end when there is one), in its own unit. */
export function dropNumber(value: DropValue, picks?: Record<string, number> | null): number {
  const picked = picks?.[value.id];
  return value.range && typeof picked === 'number' && Number.isFinite(picked)
    ? picked
    : value.value;
}

/**
 * Classify a drop. `current` holds the form's values before the drop (form
 * text in `formUnit`); rule checks run on those values with the placements
 * applied. `picks` holds a chosen number per ranged value id.
 */
export function classifyDropResult(
  values: DropValue[],
  models: NomsModelEntry[],
  formUnit: string,
  current: Record<string, Record<string, string>> = {},
  options: { picks?: Record<string, number> | null } = {}
): DropReview {
  const placements: DropReview['placements'] = [];
  const rows: Record<string, DropRow> = {};
  const extras: DropReview['extras'] = [];
  const byKey = new Map(models.map(model => [model.key, model]));
  const groupOf = (key: string): string => key.split(':').slice(0, 2).join(':');
  const touchedGroups = new Set<string>();
  const row = (key: string, field: string): DropRow => {
    const id = `${key}|${field}`;
    rows[id] = rows[id] || { key, field, from: '', flags: [] };
    return rows[id];
  };
  const flag = (r: DropRow, kind: DropFlagKind, reason: string, thumb?: string): void => {
    if (!r.flags.some(f => f.kind === kind && f.reason === reason))
      r.flags.push({ kind, reason, ...(thumb ? { thumb } : {}) });
  };

  for (const value of values) {
    const targets = value.targets.filter(t => byKey.get(t.key)?.fields.includes(t.field));
    if (!targets.length) {
      extras.push({
        id: value.id,
        label: value.label,
        where: sourceOf(value).replace(/ \S+$/, ''),
        text: value.text || `${shortNumber(value.value)} ${unitWord(value.unit)}`,
        reason: value.textOnly
          ? 'no number written; kept as a note'
          : value.why ||
            (value.targets.length
              ? `${value.targets.map(t => t.field).join(', ')} is not on the form`
              : `no form letter for ${value.label}`),
      });
      continue;
    }
    if (value.textOnly) {
      // Words only: the letter keeps its value and carries the customer's words.
      for (const target of targets) {
        touchedGroups.add(groupOf(target.key));
        flag(
          row(target.key, target.field),
          'text-only',
          `Customer wrote "${value.text || ''}" (no number) at ${sourceOf(value)}`
        );
      }
      continue;
    }
    const number = dropNumber(value, options.picks);
    const text = pdfValueToForm(number, value.unit, formUnit);
    for (const target of targets) {
      touchedGroups.add(groupOf(target.key));
      const r = row(target.key, target.field);
      if (r.from) {
        const first = values.find(v => v.id === r.from);
        const firstText = placements.find(p => p.key === target.key && p.field === target.field);
        const same =
          firstText &&
          Math.abs(Number(firstText.value) - Number(text)) < (formUnit === 'cm' ? 0.05 : 0.02);
        if (!same)
          flag(
            r,
            'duplicate',
            `PDF also gives ${value.text || shortNumber(number)} at ${sourceOf(value)}; kept ${
              first
                ? `${first.text || shortNumber(dropNumber(first, options.picks))} from ${sourceOf(first)}`
                : 'the first'
            }`
          );
        continue;
      }
      r.from = value.id;
      placements.push({ key: target.key, field: target.field, value: text, from: value.id });
      if (value.range)
        flag(
          r,
          'range',
          `Customer wrote ${value.text || value.range.map(shortNumber).join(' - ')}; used ${shortNumber(number)} ${unitWord(value.unit)}`
        );
      if (value.unitAssumed)
        flag(
          r,
          'unit-assumed',
          `Unit not stated in the PDF; read as ${value.unit === 'inch' ? 'inches' : 'cm'}`
        );
      if (value.alsoFills?.length)
        flag(r, 'shared', `The same diagram also filled ${value.alsoFills.join(', ')}`);
      if (value.ocr || value.review?.includes(OCR_FLAG))
        flag(r, 'ocr', `${OCR_FLAG}: read "${value.text || shortNumber(number)}"`, value.thumb);
      else if (!value.range && value.text && !isCleanNumber(value.text))
        flag(r, 'check', `Written as "${value.text}", not a plain number; check it`);
      for (const reason of value.review || []) if (reason !== OCR_FLAG) flag(r, 'check', reason);
    }
  }

  // Letters on a touched model that the PDF did not give.
  for (const model of models) {
    if (!touchedGroups.has(groupOf(model.key))) continue;
    for (const field of model.fields) {
      const r = row(model.key, field);
      if (r.from || r.flags.some(f => f.kind === 'text-only')) continue;
      const had = current?.[model.key]?.[field] ?? '';
      flag(
        r,
        'not-in-pdf',
        hasMeasure(had)
          ? `Not in the PDF; keeps ${had} ${formUnit}`
          : 'Not in the PDF and empty on the form'
      );
    }
  }

  // Rules run on the form as it will be saved.
  const after: Record<string, Record<string, string>> = {};
  for (const model of models) after[model.key] = { ...(current?.[model.key] || {}) };
  for (const p of placements) after[p.key] = { ...(after[p.key] || {}), [p.field]: p.value };
  for (const model of models) {
    if (!touchedGroups.has(groupOf(model.key))) continue;
    const issues = measureIssues(model.rules, after[model.key] || {}, formUnit);
    for (const [field, message] of Object.entries({ ...issues.warnings, ...issues.errors })) {
      if (!model.fields.includes(field)) continue;
      flag(row(model.key, field), 'rule', message);
    }
  }

  const flagged = Object.values(rows).filter(r => r.flags.length).length;
  return {
    placements,
    rows,
    extras,
    filled: placements.length,
    toCheck: flagged + extras.length,
    counts: dropCounts(values, { rows, extras }),
  };
}

/**
 * The live review: the drop's classification against the values now in the
 * panel. A placed value a person has since changed is flagged as changed
 * (its rule flags follow the new value).
 */
export function liveDropReview(
  values: DropValue[],
  models: NomsModelEntry[],
  formUnit: string,
  before: Record<string, Record<string, string>>,
  now: Record<string, Record<string, string>>,
  picks?: Record<string, number> | null
): DropReview {
  const review = classifyDropResult(values, models, formUnit, before, { picks });
  // Rules on what the panel holds now, not on the drop's own numbers.
  for (const r of Object.values(review.rows)) r.flags = r.flags.filter(f => f.kind !== 'rule');
  const touched = new Set(Object.values(review.rows).map(r => r.key));
  for (const model of models) {
    if (!touched.has(model.key)) continue;
    const issues = measureIssues(model.rules, now?.[model.key] || {}, formUnit);
    for (const [field, message] of Object.entries({ ...issues.warnings, ...issues.errors })) {
      const r = review.rows[`${model.key}|${field}`];
      if (r) r.flags.push({ kind: 'rule', reason: message });
    }
  }
  for (const p of review.placements) {
    const r = review.rows[`${p.key}|${p.field}`];
    const held = String(now?.[p.key]?.[p.field] ?? '');
    if (r && held !== p.value) {
      r.flags = r.flags.filter(f => f.kind !== 'range' && f.kind !== 'duplicate');
      r.flags.push({
        kind: 'changed',
        reason: `Changed by hand from ${p.value} ${formUnit} in the PDF`,
      });
    }
  }
  for (const r of Object.values(review.rows)) {
    if (r.flags.some(f => f.kind === 'not-in-pdf') && hasMeasure(now?.[r.key]?.[r.field])) {
      const held = now[r.key][r.field];
      r.flags = r.flags.map(f =>
        f.kind === 'not-in-pdf'
          ? { kind: f.kind, reason: `Not in the PDF; keeps ${held} ${formUnit}` }
          : f
      );
    }
  }
  review.toCheck =
    Object.values(review.rows).filter(r => r.flags.length).length + review.extras.length;
  review.counts = dropCounts(values, review);
  return review;
}

/** One line per flagged letter and extra, for the save confirm and the SZ summary. */
export function dropFlagLines(review: DropReview, models: NomsModelEntry[]): string[] {
  const titles = new Map(models.map(m => [m.key, m.title]));
  const out: string[] = [];
  for (const r of Object.values(review.rows)) {
    if (!r.flags.length) continue;
    out.push(`${titles.get(r.key) || r.key} ${r.field}: ${r.flags.map(f => f.reason).join('; ')}`);
  }
  for (const extra of review.extras)
    out.push(`${extra.where} ${extra.label} (${extra.text}): ${extra.reason}`);
  return out;
}

/** Plain text for the SZ production email: product, values in cm by model and letter, flags. */
export function szSummaryText(input: {
  orderNumber: string;
  customerName?: string;
  product?: string;
  models: NomsModelEntry[];
  values: Record<string, Record<string, string>>;
  unit: string;
  flags?: string[];
  pdfName?: string;
}): string {
  const lines: string[] = [];
  lines.push(`NOMS #${input.orderNumber}${input.customerName ? ` - ${input.customerName}` : ''}`);
  const products = Array.from(new Set(input.models.map(m => m.reference).filter(Boolean)));
  const product = input.product || products.join(', ');
  if (product) lines.push(`Product: ${product}`);
  lines.push('Measurements in cm');
  for (const model of input.models) {
    const rows = model.fields.map(field => {
      const raw = input.values?.[model.key]?.[field] ?? '';
      const parsed = parseMeasure(raw);
      if (!parsed || !hasMeasure(parsed)) return `${field}: -`;
      const cm = input.unit === 'in' ? Number(parsed) * 2.54 : Number(parsed);
      return `${field}: ${(Math.round(cm * 10) / 10).toFixed(1)}`;
    });
    if (!rows.length) continue;
    lines.push('', model.title, ...rows);
  }
  const flags = input.flags || [];
  lines.push('');
  if (flags.length) {
    lines.push(`To check (${flags.length}):`, ...flags.map(f => `- ${f}`));
  } else lines.push('No flagged values.');
  if (input.pdfName) lines.push('', `Attached: ${input.pdfName}`);
  return lines.join('\n');
}

/** "<order> - <customer> - measurements cm.pdf", safe for a file name. */
export function cmPdfFileName(orderNumber: string, customerName?: string): string {
  const clean = (s: string) =>
    (s || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return [clean(orderNumber), clean(customerName || ''), 'measurements cm']
    .filter(Boolean)
    .join(' - ')
    .concat('.pdf');
}

/** A CW form diagram's values, as the PDF reader returns them. */
export interface DropGroupLike {
  file: string;
  pageNumber: number;
  title: string;
  unit: DropUnit;
  unitAssumed?: boolean;
  values: Array<{
    label: string;
    value: number;
    range?: number[];
    text?: string;
    /** Reasons to check the value (from the PDF reader). */
    review?: string[];
    /** Picture of the box it was read from (scans). */
    thumb?: string;
    /** Read by OCR from a scan. */
    ocr?: boolean;
  }>;
  /** Letters the customer answered with words only. */
  notes?: Array<{ label: string; text: string }>;
}

/**
 * CW form diagrams to drop values: each letter fills its mapped field on every
 * target model. `targets[i]` and `mappings[i]` belong to `groups[i]`.
 */
export function cwGroupsToDropValues(
  groups: DropGroupLike[],
  targets: string[][],
  mappings: Array<Record<string, string>>,
  models: NomsModelGroup[]
): DropValue[] {
  const byKey = new Map(models.map(m => [m.key, m]));
  const out: DropValue[] = [];
  groups.forEach((group, i) => {
    const picks = (targets[i] || []).filter(key => byKey.has(key));
    const mapping = mappings[i] || {};
    const titles = picks.map(key => byKey.get(key)!.title);
    const fieldsHere = picks.flatMap(key => Object.keys(byKey.get(key)!.fields));
    const entries = [
      ...group.values.map(v => ({ ...v, textOnly: false })),
      ...(group.notes || []).map(n => ({ label: n.label, value: 0, text: n.text, textOnly: true })),
    ];
    for (const v of entries as Array<
      (typeof entries)[number] & {
        range?: number[];
        review?: string[];
        thumb?: string;
        ocr?: boolean;
      }
    >) {
      const field =
        (v.label in mapping ? mapping[v.label] : defaultFieldFor(v.label, fieldsHere)) || '';
      const found = field
        ? picks
            .map(key => ({ key: byKey.get(key)!.fields[field], field }))
            .filter(t => Boolean(t.key))
        : [];
      let why = '';
      if (!picks.length) why = `${group.title || 'this diagram'} matched no form model`;
      else if (!found.length) why = `${v.label} is not a letter on ${titles.join(', ')}`;
      out.push({
        id: `${group.file}|${group.pageNumber}|${group.title}|${v.label}${v.textOnly ? '|note' : ''}`,
        file: group.file,
        pageNumber: group.pageNumber,
        title: group.title,
        label: v.label,
        value: v.value,
        unit: group.unit,
        unitAssumed: group.unitAssumed,
        range: v.range,
        text: v.text,
        targets: found,
        why: why || undefined,
        alsoFills: picks.length > 1 ? titles : undefined,
        ...(v.textOnly ? { textOnly: true } : {}),
        ...(v.review?.length ? { review: v.review } : {}),
        ...(v.thumb ? { thumb: v.thumb } : {}),
        ...(v.ocr ? { ocr: true } : {}),
      });
    }
  });
  // "Also filled" names only the other models.
  for (const v of out)
    if (v.alsoFills) {
      const mine = new Set(
        v.targets.map(t => byKey.get(t.key.split(':').slice(0, 2).join(':'))?.title)
      );
      v.alsoFills = v.alsoFills.filter(title => !mine.has(title));
      if (!v.alsoFills.length) delete v.alsoFills;
    }
  return out;
}

/** What readCustomerPdf returns, as far as the panel needs it. */
export interface CustomerPdfLike {
  fileName: string;
  modelCodes: string[];
  confidence: number;
  pages: Array<{
    pageNumber: number;
    template: {
      title?: string;
      /** Library PDF the page was printed from: consecutive pages of one are a form run. */
      source?: string;
      id?: string;
      modelCodes?: string[];
      view?: string | null;
      views?: string[];
    } | null;
    confidence: number;
    values: Array<{
      label: string;
      value: CustomerValue | null;
      text: string;
      from?: string;
      section?: string;
      review?: string[];
      thumb?: string;
      /** 0..1, OCR only. */
      confidence?: number;
    }>;
    unit: DropUnit;
    unitAssumed: boolean;
  }>;
}

/** One page of a customer PDF, ready for matching and the drop review. */
export interface CustomerDropGroup extends DropGroupLike {
  notes: Array<{ label: string; text: string }>;
  /** Cushion tables: how many cushions of this type ("Qty"). */
  quantity?: number;
  /** Template model codes when the page matched the library confidently, else []. */
  modelCodes: string[];
  view: string | null;
  views: string[];
  /** Form run (consecutive pages of one library template), when matched confidently. */
  run?: string;
  runTitle?: string;
}

/** True when the customer wrote a plain number ("29", "29.5", "22 1/4", '29"', "73 cm"). */
export function isCleanNumber(text: unknown): boolean {
  if (typeof text !== 'string' && typeof text !== 'number') return false;
  return /^\s*(?:\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(?:in|inch|inches|cm|"|\u201d|'')?\s*$/i.test(
    String(text)
  );
}

/** Below this a template (and its codes) is only a suggestion. */
export const TEMPLATE_CONFIDENCE = 0.8;

/**
 * Pages of a read customer PDF as drop groups: numbers (a range keeps both,
 * the default end is used) and words-only answers kept as notes. The page's
 * own unit and unitAssumed travel with it; codes only from a confident match.
 */
export function customerPdfToGroups(result: CustomerPdfLike): CustomerDropGroup[] {
  const out: CustomerDropGroup[] = [];
  let runIndex = 0;
  let lastSource = '';
  // The form run the last page started: a shared cushion page joins it.
  let lastRun: { codes: string[]; title: string } | null = null;
  for (const page of result.pages || []) {
    const template = page.template;
    const confident = Boolean(template) && page.confidence >= TEMPLATE_CONFIDENCE;
    // A form run: consecutive pages printed from the same library PDF.
    let source = confident
      ? template!.source ||
        (template!.id || '').replace(/-p\d+$/, '') ||
        (template!.modelCodes || []).join(',')
      : '';
    let codes = confident
      ? template!.modelCodes?.length
        ? template!.modelCodes
        : result.modelCodes || []
      : [];
    let runTitle = source
      ? normaliseCode((template!.modelCodes || [])[0]) ||
        source.replace(/^.*\//, '').replace(/\.pdf$/i, '')
      : '';
    // The cushion sheet is the same on every form, so whichever form it
    // matched, it belongs to the frame run before it (see attachCushionPages).
    if (source && template!.view === 'cushion' && lastSource && lastRun) {
      source = lastSource;
      codes = lastRun.codes;
      runTitle = lastRun.title;
    }
    if (source !== lastSource) {
      runIndex += 1;
      lastSource = source;
      lastRun = source ? { codes, title: runTitle } : null;
    }
    // Cushion tables each make their own group: "Box seat cushions, type 1".
    const sections = Array.from(new Set((page.values || []).map(v => v.section || '')));
    for (const section of sections) {
      const values: CustomerDropGroup['values'] = [];
      const notes: CustomerDropGroup['notes'] = [];
      let quantity: number | undefined;
      for (const v of page.values || []) {
        if ((v.section || '') !== section) continue;
        const parsed = v.value;
        if (v.label === 'Qty') {
          if (parsed && parsed.kind !== 'none' && parsed.values.length) quantity = parsed.values[0];
          continue;
        }
        if (!parsed || parsed.kind === 'none' || !parsed.values.length) {
          const text = String(v.text || parsed?.text || '').trim();
          if (text) notes.push({ label: v.label, text });
          continue;
        }
        values.push({
          label: v.label,
          value: parsed.kind === 'range' ? rangeValue(parsed) : parsed.values[0],
          ...(parsed.kind === 'range' ? { range: [...parsed.values] } : {}),
          text: v.text || parsed.text,
          ...(v.review?.length ? { review: v.review } : {}),
          ...(v.thumb ? { thumb: v.thumb } : {}),
          // OCR doubts: a low score, or text that is not a plain number ("209*", "2\\").
          ...(v.from === 'ocr' &&
          (!((v.confidence ?? 0) >= OCR_CONFIDENT) ||
            (parsed.kind !== 'range' && !isCleanNumber(v.text || parsed.text)))
            ? { ocr: true }
            : {}),
        });
      }
      if (!values.length && !notes.length) continue;
      const base = template?.title || `Page ${page.pageNumber}`;
      const title = section
        ? `${section}${quantity !== undefined ? ` (qty ${quantity})` : ''}`
        : base;
      out.push({
        file: result.fileName,
        pageNumber: page.pageNumber,
        title,
        unit: page.unit,
        unitAssumed: Boolean(page.unitAssumed),
        values,
        notes,
        ...(quantity !== undefined ? { quantity } : {}),
        modelCodes: codes.map(normaliseCode).filter(Boolean),
        view: confident ? template!.view || null : null,
        views: confident ? template!.views || [] : [],
        ...(source ? { run: `${result.fileName}#${runIndex}`, runTitle } : {}),
      });
    }
  }
  return out;
}

/** A library SVG the PDF's model code has, offered when NOMS has no form. */
export interface DiagramOffer {
  code: string;
  view: string;
  url: string;
  labelIds?: boolean;
  file: string;
  unit: DropUnit;
  unitAssumed: boolean;
  values: DropGroupLike['values'];
  notes: Array<{ label: string; text: string }>;
}

/**
 * "Add the <code> diagram" offers for PDF pages whose model code has an SVG in
 * the library (`find` is findCwSvg). One offer per SVG; pages that share it
 * pool their letters (first value per letter wins).
 */
export function diagramOffers(
  groups: CustomerDropGroup[],
  find: (
    code: string,
    view?: string | null
  ) => { url: string; code: string; view: string; labelIds?: boolean } | null
): DiagramOffer[] {
  const offers = new Map<string, DiagramOffer>();
  for (const group of groups) {
    for (const code of group.modelCodes) {
      const views = Array.from(new Set([group.view, ...group.views].filter(Boolean))) as string[];
      let hit: ReturnType<typeof find> = null;
      for (const view of views) if (!hit) hit = find(code, view);
      hit = hit || find(code);
      if (!hit) continue;
      const offer: DiagramOffer = offers.get(hit.url) || {
        code,
        view: hit.view,
        url: hit.url,
        labelIds: hit.labelIds,
        file: group.file,
        unit: group.unit,
        unitAssumed: Boolean(group.unitAssumed),
        values: [],
        notes: [],
      };
      const have = new Set([...offer.values, ...offer.notes].map(v => v.label));
      for (const v of group.values) if (!have.has(v.label)) offer.values.push(v);
      for (const n of group.notes) if (!have.has(n.label)) offer.notes.push(n);
      offers.set(hit.url, offer);
      break;
    }
  }
  return Array.from(offers.values());
}

/** A SofaPaint review PDF's manifest, as parseSofaPaintReviewPdf returns it. */
export interface ReviewManifestLike {
  unit?: string | null;
  views?: Array<{
    viewId: string;
    title?: string;
    measurements?: Array<{ label: string; value?: string }>;
  }>;
}

/**
 * Values from a SofaPaint review PDF (one per view and drawn label) to drop
 * values. A value fills the form letter whose line it was measured on: an
 * explicit line link, else the same label on a view linked to the letter's
 * model. Lines that are not in this project still bind by view and label.
 */
export function reviewToDropValues(
  file: string,
  manifest: ReviewManifestLike,
  models: NomsModelEntry[],
  options: {
    lineLinks?: LineLinks | null;
    lines?: MeasuredLine[];
    viewsByKey?: Record<string, string[]>;
    viewBindings?: Record<string, string>;
    fallbackUnit?: DropUnit;
  } = {}
): DropValue[] {
  const docUnit: DropUnit | null =
    manifest?.unit === 'inch' || manifest?.unit === 'in'
      ? 'inch'
      : manifest?.unit === 'cm'
        ? 'cm'
        : null;
  const raw: Array<{ viewId: string; title: string; label: string; text: string; page: number }> =
    [];
  (manifest?.views || []).forEach((view, index) => {
    for (const m of view.measurements || []) {
      const text = (m?.value ?? '').trim();
      if (!text || !m?.label) continue;
      raw.push({
        viewId: view.viewId || '',
        title: view.title || view.viewId || '',
        label: m.label,
        text,
        page: index + 1,
      });
    }
  });
  const lines: MeasuredLine[] = [...(options.lines || [])];
  for (const r of raw)
    if (!lines.some(l => l.viewId === r.viewId && l.label === r.label))
      lines.push({ viewId: r.viewId, scope: r.viewId, label: r.label, value: '' });
  const owners = new Map<string, Array<{ key: string; field: string }>>();
  for (const model of models) {
    for (const field of model.fields) {
      const resolved = resolveLineForLetter(
        model.key,
        field,
        options.lineLinks,
        lines,
        options.viewsByKey?.[model.key] || []
      );
      for (const line of resolved.lines) {
        const id = `${line.viewId}|${line.label}`;
        owners.set(id, [...(owners.get(id) || []), { key: model.key, field }]);
      }
    }
  }
  const titleOf = new Map(models.map(m => [m.key, m.title]));
  return raw.map(r => {
    const parsed = parseCustomerValue(r.text);
    const unit: DropUnit =
      parsed.unit === 'in'
        ? 'inch'
        : parsed.unit === 'cm'
          ? 'cm'
          : docUnit || options.fallbackUnit || 'inch';
    const targets = parsed.kind === 'none' ? [] : owners.get(`${r.viewId}|${r.label}`) || [];
    const bound = options.viewBindings?.[r.viewId];
    let why: string | undefined;
    if (parsed.kind === 'none') why = `not a number: ${r.text}`;
    else if (!targets.length)
      why = bound
        ? `${r.label} on ${r.title} is not linked to a letter on ${titleOf.get(bound) || bound}`
        : `${r.title} is not linked to a form model`;
    return {
      id: `${file}|${r.page}|${r.viewId}|${r.label}`,
      file,
      pageNumber: r.page,
      title: r.title,
      label: r.label,
      value:
        parsed.kind === 'none'
          ? 0
          : parsed.kind === 'range'
            ? rangeValue(parsed)
            : parsed.values[0],
      unit,
      unitAssumed: !parsed.unit && !docUnit,
      range: parsed.kind === 'range' ? parsed.values : undefined,
      text: parsed.text,
      viewId: r.viewId,
      targets,
      why,
    };
  });
}

// ---------------------------------------------------------------- NOMS drift
// The panel remembers the form as it last read it from NOMS (the snapshot).
// Someone can change the form on NOMS meanwhile; these say which letters
// moved, so neither a reopen nor a send overwrites them without asking.

export interface FormDrift {
  key: string;
  field: string;
  /** Form text in the snapshot, on NOMS now, and in the panel. */
  was: string;
  now: string;
  mine: string;
  /** True when the panel's value differs from the snapshot (the person changed it). */
  touched: boolean;
}

const sameMeasure = (a: string | undefined, b: string | undefined): boolean => {
  const pa = parseMeasure(a);
  const pb = parseMeasure(b);
  if (pa === null || pb === null) return (a ?? '').trim() === (b ?? '').trim();
  return pa === pb || (pa !== '' && pb !== '' && Math.abs(Number(pa) - Number(pb)) < 0.005);
};

/**
 * Letters whose NOMS value changed since `snapshot` was read. All three value
 * sets are form text in the same unit. Letters missing from the snapshot are
 * skipped: there is nothing to compare with.
 */
export function formDrift(
  snapshot: Record<string, Record<string, string>> | null | undefined,
  fresh: Record<string, Record<string, string>>,
  mine: Record<string, Record<string, string>>
): FormDrift[] {
  const out: FormDrift[] = [];
  if (!snapshot) return out;
  for (const [key, fields] of Object.entries(fresh || {})) {
    for (const [field, now] of Object.entries(fields || {})) {
      if (!(field in (snapshot[key] || {}))) continue;
      const was = snapshot[key][field] ?? '';
      if (sameMeasure(was, now)) continue;
      const held = mine?.[key]?.[field] ?? was;
      out.push({
        key,
        field,
        was,
        now: now ?? '',
        mine: held,
        touched: !sameMeasure(held, was),
      });
    }
  }
  return out;
}

/** Drift that would be lost: NOMS changed it and the panel would write something else. */
export function conflictingDrift(drift: FormDrift[]): FormDrift[] {
  return drift.filter(d => !sameMeasure(d.mine, d.now));
}

/** "2 h ago", "5 min ago", "just now", "3 days ago" for an ISO time. */
export function agoText(iso: string | undefined, now = Date.now()): string {
  const then = Date.parse(iso || '');
  if (!Number.isFinite(then)) return 'earlier';
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Values with every model's letters converted from one unit to another. */
export function convertValues(
  values: Record<string, Record<string, string>> | null | undefined,
  from: string,
  to: string
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(values || {}).map(([key, fields]) => [
      key,
      Object.fromEntries(
        Object.entries(fields || {}).map(([f, v]) => [f, convertMeasure(v ?? '', from, to)])
      ),
    ])
  );
}

// ---------------------------------------------------------------- link by model code
// A project drawn on the customer's own photos names each piece in its image
// label: "P1 · Left arm piece (CS3B-SSA-HB-L) · front". Linking such a project
// to a NOMS order matches each image to the form's piece by that code, then
// links every form letter to the drawn line with the same letter on those
// images. Anything that does not match one piece is left out, never guessed.

const PIECE_CODE = /\b[A-Z]{2}[A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;
const isCushionCode = (code: string): boolean => normaliseCode(code).startsWith('CC-');

/** CW codes named in an image label, in order. */
export function codesInTitle(title: string): string[] {
  return Array.from(new Set(String(title || '').match(PIECE_CODE) || []));
}

export interface CodeViewResult {
  viewId: string;
  title: string;
  /** "product:model" the image was matched to, when it was. */
  target?: string;
  how?: 'exact' | 'close';
  why?: string;
}
export interface CodeLink {
  key: string;
  letter: string;
  viewId: string;
  label: string;
  value: string;
}
export interface CodeLinkPlan {
  views: CodeViewResult[];
  links: CodeLink[];
  /** Letters drawn on more than one matched image with different numbers. */
  conflicts: Array<{
    key: string;
    letter: string;
    values: Array<{ viewId: string; value: string }>;
  }>;
  /** Form letters on a matched piece that no image has a line for. */
  missing: Array<{ key: string; letter: string }>;
}

const pieceOf = (key: string): string => key.split(':').slice(0, 2).join(':');
const FILE_WORDS: Array<[RegExp, RegExp]> = [
  [/\bfront\b/i, /\bfront\b/i],
  [/\bside\b/i, /\b(side|outside end|end)\b/i],
  [/\bback\b/i, /\bback\b/i],
];

/** Which form piece ("product:model") an image's code points to, if exactly one. */
function pieceForCode(
  code: string,
  models: NomsModelEntry[]
): { target?: string; how?: 'exact' | 'close'; why?: string } {
  const wanted = normaliseCode(code);
  const pieces = new Map<string, { reference: string; modelName: string }>();
  for (const m of models) {
    if (m.enabled === false) continue;
    pieces.set(pieceOf(m.key), { reference: m.reference, modelName: m.modelName });
  }
  const byModel = Array.from(pieces).filter(([, p]) => normaliseCode(p.modelName) === wanted);
  if (byModel.length === 1) return { target: byModel[0][0], how: 'exact' };
  if (byModel.length > 1)
    return { why: `${code} is on ${byModel.length} pieces of the form; link it by hand` };
  // The product code (CS1X-NA) names the product; its frame is the one piece
  // that is not a cushion.
  const byProduct = Array.from(pieces).filter(([, p]) => normaliseCode(p.reference) === wanted);
  const frames = byProduct.filter(([, p]) => !isCushionCode(p.modelName));
  if (frames.length === 1) return { target: frames[0][0], how: 'exact' };
  if (frames.length > 1) return { why: `${code} has ${frames.length} frames on the form` };
  // Cushions are only ever matched exactly: CC-BK-W is not a CC-BK-BE.
  if (isCushionCode(code)) return { why: `${code} is not on the form` };
  const scored = Array.from(pieces)
    .filter(([, p]) => !isCushionCode(p.modelName))
    .map(([target, p]) => ({
      target,
      score: Math.max(codeSimilarity(code, p.modelName), codeSimilarity(code, p.reference)),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (best && best.score >= CODE_MIN && (!next || best.score - next.score >= CODE_MARGIN))
    return { target: best.target, how: 'close' };
  return { why: `${code} does not clearly match one piece of the form` };
}

/**
 * Links from form letters to drawn lines, matched by the piece code in each
 * image's label. Letters already linked keep their link. Where a letter is
 * drawn on several images of the same piece, the image named like the form
 * file (front, side or back) wins, else the first; different numbers are
 * reported as conflicts so a person can look.
 */
export function codeLinksForProject(
  models: NomsModelEntry[],
  views: Array<{ viewId: string; title: string }>,
  lines: MeasuredLine[],
  existing: LineLinks | null | undefined = {}
): CodeLinkPlan {
  const plan: CodeLinkPlan = { views: [], links: [], conflicts: [], missing: [] };
  const viewsByPiece = new Map<string, Array<{ viewId: string; title: string }>>();
  for (const view of views) {
    const codes = codesInTitle(view.title);
    if (!codes.length) {
      plan.views.push({ ...view, why: 'no model code in its label' });
      continue;
    }
    let result: ReturnType<typeof pieceForCode> = { why: '' };
    for (const code of codes) {
      result = pieceForCode(code, models);
      if (result.target) break;
    }
    plan.views.push({ ...view, ...result });
    if (result.target)
      viewsByPiece.set(result.target, [...(viewsByPiece.get(result.target) || []), view]);
  }
  for (const [piece, pieceViews] of viewsByPiece) {
    const order = new Map(pieceViews.map((v, i) => [v.viewId, i]));
    for (const model of models.filter(m => pieceOf(m.key) === piece)) {
      const fileWord = FILE_WORDS.find(([fileRe]) => fileRe.test(model.title));
      for (const letter of model.fields) {
        if (existing?.[lineLinkKey(model.key, letter)]) continue;
        const drawn = lines.filter(
          line => order.has(line.viewId) && line.label === letter && hasMeasure(line.value)
        );
        if (!drawn.length) {
          plan.missing.push({ key: model.key, letter });
          continue;
        }
        const titleOf = (viewId: string): string =>
          pieceViews.find(v => v.viewId === viewId)?.title || '';
        drawn.sort((a, b) => {
          const named = (line: MeasuredLine): number =>
            fileWord && fileWord[1].test(titleOf(line.viewId)) ? 0 : 1;
          return named(a) - named(b) || order.get(a.viewId)! - order.get(b.viewId)!;
        });
        const chosen = drawn[0];
        plan.links.push({
          key: model.key,
          letter,
          viewId: chosen.viewId,
          label: chosen.label,
          value: chosen.value,
        });
        const distinct = new Set(drawn.map(line => line.value));
        if (distinct.size > 1)
          plan.conflicts.push({
            key: model.key,
            letter,
            values: drawn.map(line => ({ viewId: line.viewId, value: line.value })),
          });
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------- match images to form diagrams
// The Match images screen: each project image is matched to the form diagram
// (model file "product:model:file") it shows. Suggestions come from the image
// label: the saved match, else the CW code in the label (one piece only) and
// the words front, side or back for the file. A cushion code on several pieces
// is offered as a choice, never picked for the person, unless the label names
// the piece ("P3") of a frame image already matched.

export interface ImageMatch {
  viewId: string;
  title: string;
  /** Chosen file key, "" for not on the form. */
  key: string;
  how: 'saved' | 'code' | 'piece' | '';
  /** Why there is no suggestion, or what it came from. */
  note?: string;
  /** Files to choose between when the label points to more than one. */
  choices?: string[];
}

const pieceRefs = (title: string): string[] =>
  Array.from(String(title || '').matchAll(/\bP(\d{1,2})\b/g), m => m[1]);

/** Suggested form file for each image, keeping matches already saved. */
export function suggestImageMatches(
  models: NomsModelEntry[],
  views: Array<{ viewId: string; title: string }>,
  saved: Record<string, string> = {}
): ImageMatch[] {
  const enabled = models.filter(m => m.enabled !== false);
  const keys = new Set(enabled.map(m => m.key));
  const filesOf = (piece: string) => enabled.filter(m => pieceOf(m.key) === piece);
  // "P3" in a frame image label -> the product that image was matched to.
  const productByRef = new Map<string, string>();
  const out: ImageMatch[] = views.map(view => {
    const title = view.title || view.viewId;
    if (saved[view.viewId] && keys.has(saved[view.viewId]))
      return { viewId: view.viewId, title, key: saved[view.viewId], how: 'saved' as const };
    const codes = codesInTitle(title);
    if (!codes.length)
      return {
        viewId: view.viewId,
        title,
        key: '',
        how: '' as const,
        note: 'No model code in its label',
      };
    let note = '';
    for (const code of codes) {
      const found = pieceForCode(code, enabled);
      if (!found.target) {
        note = note || found.why || '';
        continue;
      }
      for (const ref of pieceRefs(title)) productByRef.set(ref, found.target.split(':')[0]);
      const files = filesOf(found.target);
      if (files.length === 1)
        return {
          viewId: view.viewId,
          title,
          key: files[0].key,
          how: 'code' as const,
          note: `From ${code}`,
        };
      const worded = files.filter(f => {
        const word = FILE_WORDS.find(([fileRe]) => fileRe.test(f.title));
        return word ? word[1].test(title) : false;
      });
      if (worded.length === 1)
        return {
          viewId: view.viewId,
          title,
          key: worded[0].key,
          how: 'code' as const,
          note: `From ${code}`,
        };
      return {
        viewId: view.viewId,
        title,
        key: '',
        how: '' as const,
        note: `${code}: pick front, side or back`,
        choices: files.map(f => f.key),
      };
    }
    // A code the form has on several pieces: offer those files.
    const shared = codes
      .map(code => enabled.filter(m => normaliseCode(m.modelName) === normaliseCode(code)))
      .find(list => list.length > 1);
    return {
      viewId: view.viewId,
      title,
      key: '',
      how: '' as const,
      note: shared
        ? `${codes.find(c => shared.some(m => normaliseCode(m.modelName) === normaliseCode(c)))} is on ${shared.length} pieces of the form: pick which`
        : note || 'Not on the form',
      ...(shared ? { choices: shared.map(m => m.key) } : {}),
    };
  });
  // Second pass: a cushion label naming a piece ("P3") picks that piece's file.
  for (const match of out) {
    if (match.key || !match.choices?.length) continue;
    const products = new Set(
      pieceRefs(match.title)
        .map(ref => productByRef.get(ref))
        .filter(Boolean)
    );
    if (products.size !== 1) continue;
    const [product] = Array.from(products);
    const onPiece = match.choices.filter(key => key.split(':')[0] === product);
    if (onPiece.length === 1) {
      match.key = onPiece[0];
      match.how = 'piece';
      match.note = `On ${pieceRefs(match.title)
        .map(r => `P${r}`)
        .join(', ')}`;
    }
  }
  return out;
}

export interface ImageMatchPlan {
  links: Array<CodeLink & { key: string }>;
  /** Letters each image fills, by file key. */
  byView: Record<string, Record<string, string[]>>;
  /** Letters of a matched file that no image fills. */
  missing: Record<string, string[]>;
  conflicts: CodeLinkPlan['conflicts'];
}

/**
 * What applying the matches does. An image fills the letters drawn (or
 * measured) on it that its piece has, on any file of that piece; images
 * matched to the file itself come first, then the order of the list.
 * Letters linked by hand (not by this screen) are left alone.
 */
export function planImageMatches(
  models: NomsModelEntry[],
  matches: Array<{ viewId: string; key: string }>,
  lines: MeasuredLine[],
  existing: LineLinks | null | undefined = {}
): ImageMatchPlan {
  const plan: ImageMatchPlan = { links: [], byView: {}, missing: {}, conflicts: [] };
  const matched = matches.filter(m => m.key);
  const order = new Map(matched.map((m, i) => [m.viewId, i]));
  const pieces = new Set(matched.map(m => pieceOf(m.key)));
  for (const piece of pieces) {
    const views = matched.filter(m => pieceOf(m.key) === piece);
    const viewIds = new Set(views.map(v => v.viewId));
    for (const model of models.filter(m => pieceOf(m.key) === piece && m.enabled !== false)) {
      const boundHere = new Set(views.filter(v => v.key === model.key).map(v => v.viewId));
      for (const letter of model.fields) {
        const manual = existing?.[lineLinkKey(model.key, letter)];
        if (manual && manual.by !== 'match') continue;
        const drawn = lines
          .filter(l => viewIds.has(l.viewId) && l.label === letter && hasMeasure(l.value))
          .sort(
            (a, b) =>
              (boundHere.has(a.viewId) ? 0 : 1) - (boundHere.has(b.viewId) ? 0 : 1) ||
              order.get(a.viewId)! - order.get(b.viewId)!
          );
        if (!drawn.length) {
          if (boundHere.size) (plan.missing[model.key] ||= []).push(letter);
          continue;
        }
        const chosen = drawn[0];
        plan.links.push({
          key: model.key,
          letter,
          viewId: chosen.viewId,
          label: chosen.label,
          value: chosen.value,
        });
        ((plan.byView[chosen.viewId] ||= {})[model.key] ||= []).push(letter);
        if (new Set(drawn.map(l => l.value)).size > 1)
          plan.conflicts.push({
            key: model.key,
            letter,
            values: drawn.map(l => ({ viewId: l.viewId, value: l.value })),
          });
      }
    }
  }
  return plan;
}
