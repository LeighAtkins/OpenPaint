// Pure helpers for the NOMS measurement link. The CW40 measure form stores each
// value as text in the form's unit ("in" or "cm") and checks it against rules
// written in centimetres ("A>0", "abs(A-C)<5"). Kept free of DOM and app state
// so they can be tested directly.

import { parseCustomerValue, rangeValue } from '../utils/customer-value';

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
}

export type DropFlagKind =
  | 'not-in-pdf'
  | 'duplicate'
  | 'rule'
  | 'range'
  | 'unit-assumed'
  | 'shared'
  | 'changed';

export interface DropFlag {
  kind: DropFlagKind;
  reason: string;
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
  const flag = (r: DropRow, kind: DropFlagKind, reason: string): void => {
    if (!r.flags.some(f => f.kind === kind && f.reason === reason)) r.flags.push({ kind, reason });
  };

  for (const value of values) {
    const targets = value.targets.filter(t => byKey.get(t.key)?.fields.includes(t.field));
    if (!targets.length) {
      extras.push({
        id: value.id,
        label: value.label,
        where: sourceOf(value).replace(/ \S+$/, ''),
        text: value.text || `${shortNumber(value.value)} ${unitWord(value.unit)}`,
        reason:
          value.why ||
          (value.targets.length
            ? `${value.targets.map(t => t.field).join(', ')} is not on the form`
            : `no form letter for ${value.label}`),
      });
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
    }
  }

  // Letters on a touched model that the PDF did not give.
  for (const model of models) {
    if (!touchedGroups.has(groupOf(model.key))) continue;
    for (const field of model.fields) {
      const r = row(model.key, field);
      if (r.from) continue;
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
    String(s || '')
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
  values: Array<{ label: string; value: number; range?: number[]; text?: string }>;
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
    for (const v of group.values) {
      const field = mapping[v.label] || '';
      const found = field
        ? picks
            .map(key => ({ key: byKey.get(key)!.fields[field], field }))
            .filter(t => Boolean(t.key))
        : [];
      let why = '';
      if (!picks.length) why = `${group.title || 'this diagram'} matched no form model`;
      else if (!found.length) why = `${v.label} is not a letter on ${titles.join(', ')}`;
      out.push({
        id: `${group.file}|${group.pageNumber}|${group.title}|${v.label}`,
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
      const text = String(m?.value ?? '').trim();
      if (!text || !m?.label) continue;
      raw.push({
        viewId: String(view.viewId || ''),
        title: String(view.title || view.viewId || ''),
        label: String(m.label),
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
