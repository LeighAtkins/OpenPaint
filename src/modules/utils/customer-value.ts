/**
 * Reads a measurement the way a customer wrote it in a PDF field.
 *
 * Customers write "approx 24.5 - 25"", "2 7/8"", "22-1/4"", "7" see photos",
 * "16.25-16.5" or "n/a". This parser keeps every number they wrote: a range is
 * returned as two values and is never reduced to one here. The caller shows
 * both and records which one was used.
 *
 * Pure: no DOM, no app state, so both PDF readers share it and tests run in Node.
 */

export type CustomerValueKind = 'single' | 'range' | 'none';
export type CustomerUnit = 'in' | 'cm' | null;
export type RangeChoice = 'lower' | 'upper' | 'mid';

export interface CustomerValue {
  kind: CustomerValueKind;
  /** The numbers written, in the written unit; ascending for a range. */
  values: number[];
  unit: CustomerUnit;
  /** Words after the number(s), e.g. "see photos" or "(13" to floor)". */
  note: string;
  /** The field text, tidied (quotes and spaces normalised). */
  text: string;
}

/**
 * Which end of a range is taken when nobody chooses: the team usually takes
 * the larger number so the cover is not tight.
 */
export const RANGE_DEFAULT: RangeChoice = 'upper';

const VULGAR: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/** Denominators a customer uses for a fraction of an inch; anything else is a range ("24/25"). */
const FRACTION_DENOMINATORS = new Set([2, 3, 4, 5, 6, 8, 10, 12, 16, 32]);

const LEADING_WORDS =
  /^(?:approx(?:imately)?\.?|appr\.?|about|roughly|around|circa|ca\.?|est\.?|~|≈|=)\s*/i;
const UNIT = /^\s*(cm\b|in(?:ch(?:es)?)?\b|["'])/i;
const SEPARATOR = /^\s*(?:-|to\b|or\b|\/|~)\s*/i;

const isFractionOf = (numerator: number, denominator: number): boolean =>
  numerator > 0 && numerator < denominator && FRACTION_DENOMINATORS.has(denominator);

interface NumberToken {
  value: number;
  length: number;
}

/** One number at the start of `s`: mixed fraction, vulgar fraction, plain fraction or decimal. */
function readNumber(s: string, allowLoneFraction: boolean): NumberToken | null {
  let m: RegExpExecArray | null;
  // 2 7/8, 22-1/4, 22 - 1/4
  if ((m = /^(\d+)\s*-?\s*(\d+)\s*\/\s*(\d+)/.exec(s))) {
    const n = Number(m[2]);
    const d = Number(m[3]);
    if (isFractionOf(n, d)) return { value: Number(m[1]) + n / d, length: m[0].length };
  }
  // 2⅞, 2 ⅞, ⅞
  if ((m = /^(\d+(?:[.,]\d+)?)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])/.exec(s))) {
    const whole = m[1] ? Number(m[1].replace(',', '.')) : 0;
    if (!m[1] && !allowLoneFraction) return null;
    return { value: whole + VULGAR[m[2]], length: m[0].length };
  }
  // 1/2 on its own
  if ((m = /^(\d+)\s*\/\s*(\d+)/.exec(s))) {
    const n = Number(m[1]);
    const d = Number(m[2]);
    if (isFractionOf(n, d)) return allowLoneFraction ? { value: n / d, length: m[0].length } : null;
  }
  // 24.5, 24,5, 24
  if ((m = /^\d+(?:[.,]\d+)?/.exec(s))) {
    return { value: Number(m[0].replace(',', '.')), length: m[0].length };
  }
  return null;
}

function readUnit(s: string): { unit: CustomerUnit; length: number } {
  const m = UNIT.exec(s);
  if (!m) return { unit: null, length: 0 };
  return { unit: /^cm/i.test(m[1]) ? 'cm' : 'in', length: m[0].length };
}

const tidy = (n: number): number => Math.round(n * 10000) / 10000;

export function parseCustomerValue(raw: unknown): CustomerValue {
  const text = (typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '')
    .replace(/[”″❞“]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const none = (note: string): CustomerValue => ({
    kind: 'none',
    values: [],
    unit: null,
    note,
    text,
  });
  if (!text) return none('');

  let rest = text;
  while (LEADING_WORDS.test(rest)) rest = rest.replace(LEADING_WORDS, '');

  const first = readNumber(rest, false);
  if (!first) return none(text);
  rest = rest.slice(first.length);
  let unit = readUnit(rest);
  rest = rest.slice(unit.length);

  const values = [first.value];
  const sep = SEPARATOR.exec(rest);
  if (sep) {
    const second = readNumber(rest.slice(sep[0].length), false);
    if (second) {
      let after = rest.slice(sep[0].length + second.length);
      const secondUnit = readUnit(after);
      after = after.slice(secondUnit.length);
      if (secondUnit.unit) unit = secondUnit;
      values.push(second.value);
      rest = after;
    }
  }

  const note = rest.replace(/^[-:;,.\s]+/, '').trim();
  const clean = values.map(tidy).filter(v => Number.isFinite(v) && v > 0);
  if (clean.length !== values.length) return none(text);
  if (clean.length === 2 && clean[0] === clean[1]) clean.pop();
  clean.sort((a, b) => a - b);
  return {
    kind: clean.length === 2 ? 'range' : 'single',
    values: clean,
    unit: unit.unit,
    note,
    text,
  };
}

/** Lower, upper and midpoint of a range, in the written unit. */
export function rangeOptions(value: CustomerValue): Array<{ choice: RangeChoice; value: number }> {
  if (value.kind !== 'range') return [];
  const [lower, upper] = value.values;
  return [
    { choice: 'lower', value: lower },
    { choice: 'upper', value: upper },
    { choice: 'mid', value: tidy((lower + upper) / 2) },
  ];
}

/** The number a range gives for `choice` (RANGE_DEFAULT when not given). */
export function rangeValue(value: CustomerValue, choice: RangeChoice = RANGE_DEFAULT): number {
  const option = rangeOptions(value).find(o => o.choice === choice);
  return option ? option.value : value.values[0];
}

/** Short form of a range for messages: "24.5 to 25". */
export function rangeText(value: CustomerValue): string {
  return value.values.map(v => String(v)).join(' to ');
}

/** The note kept beside a value taken from a range: "customer wrote approx 24.5 - 25"". */
export function rangeNote(value: CustomerValue): string {
  return `customer wrote ${value.text}`;
}

/** Trim a number for display: 24.75 stays, 25.0 becomes 25. */
export function formatCustomerNumber(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
