/**
 * Reading the output of a CTC text recogniser (PaddleOCR PP-OCRv4 English):
 * greedy decoding, optionally restricted to some characters, and turning the
 * text of a value box into a measurement as customers write them.
 */

/**
 * PP-OCRv4 English classes: the CTC blank, the 95 lines of en_dict.txt (printable
 * ASCII, the last one a space) and the space PaddleOCR adds after the dictionary.
 */
const EN_DICT =
  '0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~!"#$%&\'()*+,-./ ';
export const PPOCR_EN_CHARS: string[] = ['', ...EN_DICT.split(''), ' '];

/** Class indexes of a set of characters (blank always allowed). */
export function classesOf(chars: string[], wanted: string): number[] {
  const out = [0];
  for (const ch of wanted) {
    const i = chars.indexOf(ch);
    if (i > 0) out.push(i);
  }
  return out;
}

export interface CtcRead {
  text: string;
  /** Lowest probability among the characters read (1 for no characters read from blanks). */
  confidence: number;
}

/**
 * Greedy CTC decoding of [steps x classes] probabilities: the best class at
 * each step, repeats merged, blanks dropped. With `allowed`, only those
 * classes compete at each step.
 */
export function ctcGreedy(
  probs: ArrayLike<number>,
  steps: number,
  classes: number,
  chars: string[],
  allowed?: number[]
): CtcRead {
  const candidates = allowed ?? Array.from({ length: classes }, (_, i) => i);
  let text = '';
  let confidence = 1;
  let any = false;
  let prev = 0;
  for (let t = 0; t < steps; t += 1) {
    const row = t * classes;
    let best = candidates[0];
    for (const c of candidates) if (probs[row + c] > probs[row + best]) best = c;
    if (best !== 0 && best !== prev) {
      text += chars[best] ?? '';
      confidence = Math.min(confidence, probs[row + best]);
      any = true;
    }
    prev = best;
  }
  return { text, confidence: any ? confidence : 0 };
}

/** "N/A" (or "NA", "n/a") written in a box. */
export function isNotApplicable(text: string): boolean {
  return /^\s*n\s*[/|\\lI1]?\s*[a4]\.?\s*$/i.test(text);
}

/**
 * Digits-and-dots text of a box as a measurement: stray marks at the ends
 * dropped, "39 00" read as 39.00, a third decimal (a mark after the value)
 * dropped, and a missing point put back before a quarter ("2450" is 24.50).
 * `fixed` says the text needed more than tidying.
 */
export function parseMeasurement(raw: string): { text: string; fixed: boolean } {
  let t = raw
    .replace(/,/g, '.')
    .trim()
    .replace(/^[^0-9]+|[^0-9]+$/g, '')
    .replace(/\.+/g, '.');
  let fixed = false;
  const spaced = /^(\d+)\s+(\d{2})$/.exec(t);
  if (spaced) t = `${spaced[1]}.${spaced[2]}`;
  t = t.replace(/\s+/g, '');
  if ((t.match(/\./g) || []).length > 1) {
    const last = t.lastIndexOf('.');
    t = t.slice(0, last).replace(/\./g, '') + t.slice(last);
    fixed = true;
  }
  const third = /^(\d+\.\d\d)\d$/.exec(t);
  if (third) {
    t = third[1];
    fixed = true;
  }
  const quarter = /^(\d{1,2})(00|25|50|75)$/.exec(t);
  if (quarter && !(quarter[1].length === 1 && quarter[2] === '00'))
    t = `${quarter[1]}.${quarter[2]}`;
  return { text: t, fixed };
}
