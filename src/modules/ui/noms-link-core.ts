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
}

/**
 * Pick the form models each PDF diagram fills. A diagram whose template names a
 * CW model code that is on the form goes to that model when the letters agree.
 * Otherwise a file's largest diagram (its frame) picks the products; the file's
 * other diagrams are kept to those products. Among equally good models a
 * "seat"/"back" word in the diagram title (or the template's cushion / frame
 * view) decides; a tie that is still open is left for the person to choose.
 */
export function refineTargets(
  groups: PdfGroupLike[],
  models: NomsModelGroup[],
  modelLabels: Record<string, string>
): string[][] {
  const productOf = (key: string): string => key.split(':')[0];
  const anchors = new Map<string, Set<string>>();
  // Letters must still mostly agree before a code decides.
  const byCode = (group: PdfGroupLike): string[] =>
    suggestTargets(group.labels, modelsForCodes(group.modelCodes, models), 0.5);
  for (const file of new Set(groups.map(g => g.file))) {
    const inFile = groups.filter(g => g.file === file);
    const coded = new Set(inFile.flatMap(byCode).map(productOf));
    if (coded.size) {
      anchors.set(file, coded);
      continue;
    }
    const biggest = inFile.reduce((a, b) => (b.labels.length > a.labels.length ? b : a));
    const products = new Set(suggestTargets(biggest.labels, models).map(productOf));
    if (products.size) anchors.set(file, products);
  }
  return groups.map(group => {
    const allowed = anchors.get(group.file);
    const pool = allowed ? models.filter(m => allowed.has(productOf(m.key))) : models;
    const coded = byCode(group);
    let picks = coded.length ? coded : suggestTargets(group.labels, pool.length ? pool : models);
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
      if (value.ocr)
        flag(r, 'ocr', `${OCR_FLAG}: read "${value.text || shortNumber(number)}"`, value.thumb);
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
  for (const page of result.pages || []) {
    const template = page.template;
    const confident = Boolean(template) && page.confidence >= TEMPLATE_CONFIDENCE;
    const codes = confident
      ? template!.modelCodes?.length
        ? template!.modelCodes
        : result.modelCodes || []
      : [];
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
          ...(v.from === 'ocr' ? { ocr: true } : {}),
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
