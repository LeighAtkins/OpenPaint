// Pure helpers for NOMS "Recheck": the letters the factory asked to re-measure,
// with a reason each, kept in the order metadata
// (externalSources.nomsOrders[order].rechecks[]). No DOM or app state here so
// the text, labels, prefill and resolution can be tested directly.

import {
  measureIssues,
  parseMeasure,
  type DropFlag,
  type MeasuredLine,
  type NomsModelEntry,
} from './noms-link-core';

export type RecheckPick = '' | 'rule' | 'large' | 'small' | 'mismatch' | 'unclear' | 'factory';

export interface RecheckItem {
  /** Form file key "product:model:file". */
  key: string;
  field: string;
  pick: RecheckPick;
  /** The rule text when pick is "rule". */
  ruleText?: string;
  /** The other letter when pick is "mismatch". */
  other?: string;
  /** Free text: the factory's words for "factory", else added after the pick. */
  detail?: string;
  /** Form text (form unit) when the letter was ticked. */
  value: string;
  /** Form text when the letter (or the whole recheck) was resolved. */
  resolvedValue?: string;
  resolvedAt?: string;
}

export interface Recheck {
  id: string;
  createdAt: string;
  status: 'open' | 'resolved';
  resolvedAt?: string;
  /** The form's unit the values are written in. */
  unit: 'in' | 'cm';
  items: RecheckItem[];
}

type Values = Record<string, Record<string, string>>;

export const PICK_LABELS: Record<Exclude<RecheckPick, ''>, string> = {
  rule: 'Rule failed',
  large: 'Too large',
  small: 'Too small',
  mismatch: 'Does not match',
  unclear: 'Unclear in the photo',
  factory: 'Factory asked',
};

const round = (n: number, places: number): string => {
  const f = 10 ** places;
  return String(Math.round(n * f) / f);
};

/** "29" in -> "29 in (73.7 cm)"; "" when there is no number. */
export function bothUnits(value: string, unit: 'in' | 'cm'): string {
  const parsed = parseMeasure(value ?? '');
  if (parsed === null) return (value || '').trim();
  if (parsed === '') return '';
  const n = Number(parsed);
  const other = unit === 'in' ? `${round(n * 2.54, 1)} cm` : `${round(n / 2.54, 2)} in`;
  return `${parsed} ${unit} (${other})`;
}

/** The reason as one sentence fragment, from the pick and the free text. */
export function reasonText(item: Pick<RecheckItem, 'pick' | 'ruleText' | 'other' | 'detail'>) {
  const detail = (item.detail || '').trim();
  let base = '';
  switch (item.pick) {
    case 'rule':
      base = item.ruleText ? `Rule failed: ${item.ruleText}` : PICK_LABELS.rule;
      break;
    case 'mismatch':
      base = item.other ? `Does not match ${item.other}` : PICK_LABELS.mismatch;
      break;
    case 'factory':
      return detail ? `Factory asked: ${detail}` : PICK_LABELS.factory;
    case 'large':
    case 'small':
    case 'unclear':
      base = PICK_LABELS[item.pick];
      break;
    default:
      return detail;
  }
  return detail ? `${base}. ${detail}` : base;
}

/** The canvas label for a ticked letter: "B1 = 29 in (73.7 cm)" and the reason line. */
export function recheckLabel(
  field: string,
  value: string,
  unit: 'in' | 'cm',
  reason: string
): { text: string; reason: string } {
  const shown = bothUnits(value, unit);
  return { text: `${field} = ${shown || 'no value'}`, reason: (reason || '').trim() };
}

/** Reason prefilled from the letter's flags: a failed rule first, else the review flags. */
export function prefillFromFlags(
  flags: DropFlag[] | undefined,
  ruleMessage?: string
): Pick<RecheckItem, 'pick' | 'ruleText' | 'detail'> | null {
  const rule = (ruleMessage || '').trim() || flags?.find(f => f.kind === 'rule')?.reason;
  if (rule) return { pick: 'rule', ruleText: rule };
  const other = (flags || []).map(f => f.reason).filter(Boolean);
  return other.length ? { pick: '', detail: other.join('; ') } : null;
}

/** Every letter with a ⚠ (a failed rule or a drop review flag), with its prefilled reason. */
export function flaggedLetters(
  models: NomsModelEntry[],
  values: Values,
  unit: string,
  rows: Record<string, { flags: DropFlag[] }> = {}
): Array<{ key: string; field: string } & Pick<RecheckItem, 'pick' | 'ruleText' | 'detail'>> {
  const out: Array<
    { key: string; field: string } & Pick<RecheckItem, 'pick' | 'ruleText' | 'detail'>
  > = [];
  for (const model of models) {
    const held = values[model.key] || {};
    const issues = measureIssues(
      model.rules,
      Object.fromEntries(model.fields.map(f => [f, parseMeasure(held[f] ?? '') ?? ''])),
      unit
    );
    for (const field of model.fields) {
      const message = issues.errors[field] || issues.warnings[field] || '';
      const prefill = prefillFromFlags(rows[`${model.key}|${field}`]?.flags, message);
      if (prefill) out.push({ key: model.key, field, ...prefill });
    }
  }
  return out;
}

const same = (a: string, b: string): boolean => {
  const x = parseMeasure(a ?? '');
  const y = parseMeasure(b ?? '');
  return x !== null && y !== null ? x === y : (a ?? '').trim() === (b ?? '').trim();
};

/** Each item with the value it was ticked at and the value now. */
export function recheckStates(
  recheck: Recheck,
  values: Values
): Array<{ item: RecheckItem; was: string; now: string; changed: boolean }> {
  return recheck.items.map(item => {
    const now =
      item.resolvedValue !== undefined
        ? item.resolvedValue
        : (values[item.key]?.[item.field] ?? '');
    return { item, was: item.value, now, changed: !same(item.value, now) };
  });
}

/** "was 29, now 31.5" for a changed letter, '' otherwise. */
export function changeText(was: string, now: string): string {
  if (same(was, now)) return '';
  return `was ${parseMeasure(was) || was || 'empty'}, now ${parseMeasure(now) || now || 'empty'}`;
}

/** True when every ticked letter now holds a different value than when it was ticked. */
export function allChanged(recheck: Recheck, values: Values): boolean {
  const states = recheckStates(recheck, values);
  return states.length > 0 && states.every(s => s.changed);
}

const resolvedItem = (item: RecheckItem, values: Values, at: string): RecheckItem =>
  item.resolvedAt
    ? item
    : {
        ...item,
        resolvedValue: values[item.key]?.[item.field] ?? '',
        resolvedAt: at,
      };

/** The recheck closed, with the value each letter holds now kept beside the old one. */
export function resolveRecheck(recheck: Recheck, values: Values, at: string): Recheck {
  return {
    ...recheck,
    status: 'resolved',
    resolvedAt: at,
    items: recheck.items.map(item => resolvedItem(item, values, at)),
  };
}

/** One letter resolved; the recheck resolves when its last open letter does. */
export function resolveItem(
  recheck: Recheck,
  key: string,
  field: string,
  values: Values,
  at: string
): Recheck {
  const items = recheck.items.map(item =>
    item.key === key && item.field === field ? resolvedItem(item, values, at) : item
  );
  const done = items.length > 0 && items.every(item => item.resolvedAt);
  return { ...recheck, items, ...(done ? { status: 'resolved' as const, resolvedAt: at } : {}) };
}

/** Letters of the recheck still to be checked. */
export const openItems = (recheck: Recheck | null | undefined): RecheckItem[] =>
  (recheck?.items || []).filter(item => !item.resolvedAt);

/** Plain text for the Gorgias reply: one line per letter. */
export function recheckListText(input: {
  orderNumber: string;
  customerName?: string;
  unit: 'in' | 'cm';
  items: RecheckItem[];
  values: Values;
  /** File key -> model title, shown when the order has more than one model. */
  titles?: Record<string, string>;
}): string {
  const keys = new Set(input.items.map(item => item.key));
  const head = `Order #${input.orderNumber}${input.customerName ? ` (${input.customerName})` : ''}: please recheck`;
  const lines = input.items.map(item => {
    const value = bothUnits(input.values[item.key]?.[item.field] ?? item.value, input.unit);
    const title = keys.size > 1 && input.titles?.[item.key] ? ` (${input.titles[item.key]})` : '';
    const reason = reasonText(item);
    return `${item.field}${title}: ${value || 'no value'}${reason ? `. Reason: ${reason}` : ''}`;
  });
  return [head, ...lines].join('\n');
}

/** A new open recheck. */
export function newRecheck(unit: 'in' | 'cm', at: string): Recheck {
  return {
    id: `rc-${Date.parse(at) || Date.now()}`,
    createdAt: at,
    status: 'open',
    unit,
    items: [],
  };
}

/**
 * What "Show for recheck" draws: each open ticked letter of the open recheck
 * with the drawn lines that feed it (`linesFor` gives a letter's lines), and
 * the views those lines are on, in first-seen order.
 */
export function recheckLines(
  rechecks: Recheck[] | null | undefined,
  linesFor: (key: string, field: string) => MeasuredLine[]
): { lines: Array<{ item: RecheckItem; line: MeasuredLine }>; views: string[] } {
  const open = (rechecks || []).find(r => r.status === 'open');
  const lines: Array<{ item: RecheckItem; line: MeasuredLine }> = [];
  const views: string[] = [];
  for (const item of openItems(open))
    for (const line of linesFor(item.key, item.field)) {
      lines.push({ item, line });
      if (!views.includes(line.viewId)) views.push(line.viewId);
    }
  return { lines, views };
}
