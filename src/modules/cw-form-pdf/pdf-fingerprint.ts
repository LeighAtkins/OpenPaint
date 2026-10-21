/**
 * Fingerprints a page of a Comfort Works measuring PDF so it can be matched
 * to the template it was printed from (src/data/pdf-templates.json).
 *
 * Pure: works on CwPageData, so the registry builder (Node) and the NOMS
 * panel (browser) share the same rules.
 */
import { findRowLabel, isLabelText, type CwPageData, type CwTextItem } from './parse-cw-form';

export type PdfTemplateKind = 'model' | 'universal' | 'super' | 'cushion' | 'ja' | 'other';
export type PdfView =
  | 'front'
  | 'side'
  | 'back'
  | 'arm'
  | 'cushion'
  | 'top'
  | 'frame'
  | 'bed'
  | 'photos';
export type PdfLanguage = 'en' | 'ja' | 'zh';

export interface PdfPageFingerprint {
  pageNumber: number;
  /** Page size in points, rounded. */
  width: number;
  height: number;
  /** Text field names, sorted and unique. */
  fieldNames: string[];
  fieldCount: number;
  /** Main heading of the page (e.g. "Sofa Body - Side", "SOFA FRAME"). */
  title: string;
  /** Short hashes of the printed text lines (letters and values left out). */
  lineHashes: string[];
  /** Printed measurement letters, sorted. */
  letters: string[];
  /** Hashes of where each letter is printed (tells mirrored L / R drawings apart). */
  layoutHashes: string[];
  /** CW model or component codes from the file name and page text. */
  modelCodes: string[];
  /** Main view of the page, and every view it shows. */
  view: PdfView | null;
  views: PdfView[];
  language: PdfLanguage;
  /** Text field name -> measurement letter. */
  fieldMap: Record<string, string>;
}

const BOILERPLATE = [
  /^custom sofa measuring diagram$/i,
  /^tip:/i,
  /^unit of measurement/i,
  /^measurements:?$/i,
  /^please select unit/i,
  /^(cm|inch|inches|qty|quantity:?)$/i,
  /^カスタムオーダーメイドソファ測定フォーム$/,
];

/** Short stable hash (FNV-1a, 32 bit) for a text line. */
export function hashLine(line: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < line.length; i += 1) {
    h ^= line.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const normalizeLine = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Numbers, fractions and lone glyphs are customer values or split label pieces, not template text. */
function isTemplateLine(str: string): boolean {
  const s = str.trim();
  if (s.length < 3) return false;
  if (isLabelText(s)) return false;
  if (/^[\d\s.,/'"\-~approx]+$/i.test(s)) return false;
  return /[A-Za-z぀-ヿ一-鿿]{2}/.test(s);
}

/** Model and component codes in a file name or page text. */
export function extractModelCodes(fileName: string, lines: string[] = []): string[] {
  const codes = new Set<string>();
  const base = fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.pdf$/i, '')
    .replace(/^m\d+__/, '')
    .replace(/\s*\(\d+\)\s*$/, '');
  const add = (raw: string) => {
    const code = raw
      .toUpperCase()
      .replace(/-CW-?\d{4,}.*$/, '')
      .replace(/_REV\d+$/, '')
      .replace(/-+$/, '');
    if (code.length >= 4 && code.includes('-')) codes.add(code);
  };
  // Model codes: CS3B-RA-HB, CS1-SRA-HB-L, CSDC-SA-SNUG, CC-BCH-W, CS0-CNRP.
  const pattern = /(?<![A-Za-z0-9])(?:CS[0-9A-Z]{0,6}|CC)(?:-[A-Z0-9]+)+(?![a-z])/g;
  for (const source of [base, ...lines]) {
    for (const match of source.match(pattern) || []) add(match);
  }
  // Universal sheets: "CC BOL", "side SA SB L", "Arm WA2 L", "back RA HB".
  const sheet = /^(side|arm|back|front panel|CC)\s+(.+)$/i.exec(
    base.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  );
  if (!codes.size && sheet) {
    const tokens = sheet[2]
      .split(/\s+/)
      .filter(t => /^[A-Z][A-Z0-9-]*$/.test(t) && !['NO', 'YES', 'V2'].includes(t));
    if (tokens.length) add(`${/^CC$/i.test(sheet[1]) ? 'CC-' : ''}${tokens.join('-')}`);
  }
  // Modular sheets named after the component: "-SLA-B-1", "Back-RA-HB", "-NA-R", "-SLA-incline".
  if (!codes.size) {
    const modular = /^(?:back|front)?-([A-Za-z]{2,}[A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)$/i.exec(
      base.trim()
    );
    if (modular) {
      const code = modular[1]
        .toUpperCase()
        .split('-')
        .filter(part => !/^\d+$/.test(part))
        .join('-');
      if (code.length >= 2) codes.add(code);
    }
  }
  return [...codes];
}

export function detectLanguage(lines: string[]): PdfLanguage {
  const joined = lines.join(' ');
  if (/[぀-ヿ]/.test(joined)) return 'ja';
  const han = (joined.match(/[一-鿿]/g) || []).length;
  const latin = (joined.match(/[A-Za-z]/g) || []).length;
  return han > latin / 4 && han > 4 ? 'zh' : 'en';
}

const VIEW_HEADINGS: Array<[RegExp, PdfView]> = [
  [/\bfront view\b|^正面$|^front$/i, 'front'],
  [/\bside view\b|^横向き$|^side$|sofa body - side|\bside\b(?! cushion)/i, 'side'],
  [/\brear view\b|\bback view\b|^後部$|^back$|sofa body - back|^rear$/i, 'back'],
  [/\btop view\b|\btop down\b|seat shape|上面/i, 'top'],
];

/** CW lettering: A-E across the front, F-H on the side, J and L on the back, K underneath. */
export function viewFromLetters(letters: readonly string[]): PdfView | null {
  const counts: Partial<Record<PdfView, number>> = {};
  for (const letter of letters) {
    const head = letter[0];
    const view: PdfView | null = /[A-E]/.test(head)
      ? 'front'
      : /[FGH]/.test(head)
        ? 'side'
        : /[JL]/.test(head)
          ? 'back'
          : null;
    if (view) counts[view] = (counts[view] || 0) + 1;
  }
  const ranked = (Object.entries(counts) as Array<[PdfView, number]>).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  // Every side of the frame on one page is a whole-frame sheet.
  if (ranked.length === 3 && ranked[2][1] >= 2) return 'frame';
  return ranked[0][0];
}

/** Views a page shows: headings first, then the file name, then its letters. */
export function detectViews(
  fileName: string,
  title: string,
  lines: string[],
  letters: readonly string[] = []
): PdfView[] {
  const views = new Set<PdfView>();
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '');
  const path = fileName;
  if (/^(sofa )?(frame|ソファのフレーム)$/i.test(title)) views.add('frame');
  if (/cushion|クッション|坐垫|靠垫|bolster/i.test(title)) views.add('cushion');
  for (const line of [title, ...lines]) {
    if (/perspective view/i.test(line)) {
      if (/front/i.test(line)) views.add('front');
      if (/side/i.test(line)) views.add('side');
      if (/back|rear/i.test(line)) views.add('back');
      continue;
    }
    if (line.length > 40) continue;
    for (const [pattern, view] of VIEW_HEADINGS) {
      if (pattern.test(line)) views.add(view);
    }
  }
  if (/view picture/i.test(lines.join(' '))) views.add('photos');
  if (views.size) return [...views];

  if (/^CC[\s-]/i.test(base) || /[\\/]Cushions?\b/i.test(path)) views.add('cushion');
  else if (/^side\b/i.test(base)) views.add('side');
  else if (/^back\b|-back$/i.test(base)) views.add('back');
  else if (
    /^arm\b/i.test(base) ||
    /\barm$/i.test(title) ||
    /[\\/](Arm Shape|Armrests)/i.test(path)
  ) {
    views.add('arm');
  } else if (/^front\b|-front$/i.test(base)) views.add('front');
  else if (/[\\/]Seat Shape[\\/]/i.test(path)) views.add('top');
  else if (/ottoman/i.test(title) || /[\\/]Ottomans?\b/i.test(path)) views.add('frame');
  else if (/sofa ?bed|sleeper/i.test(title)) views.add('bed');
  if (views.size) return [...views];

  const inferred = viewFromLetters(letters);
  return inferred ? [inferred] : [];
}

/** Pick the page heading: the largest non-boilerplate text, topmost on a tie. */
export function detectTitle(texts: CwTextItem[]): string {
  const candidates = texts
    .filter(t => isTemplateLine(t.str) && !BOILERPLATE.some(re => re.test(t.str.trim())))
    .filter(t => t.str.length <= 60)
    .map(t => ({
      str: t.str.trim(),
      size: Math.round((t.rect.y1 - t.rect.y0) * 2) / 2,
      y: t.rect.y0,
    }));
  candidates.sort((a, b) => b.size - a.size || a.y - b.y);
  return candidates[0]?.str || '';
}

/** Letter a field name carries itself: "C3", "CSDC-SNUG_A1", "CC-BOL-Measure-A". */
export function letterFromFieldName(name: string): string | null {
  if (/unit|qty|quantity|type|check|radio|text field|text_|checkbox/i.test(name)) return null;
  const match = /(?:^|[_\s]|-Measure-|-)([A-Z]\d{0,2})$/.exec(name.trim());
  return match ? match[1] : null;
}

export interface FingerprintOptions {
  /** File name or library path; used for model codes and view hints. */
  fileName?: string;
}

export function fingerprintPage(
  data: CwPageData,
  options: FingerprintOptions = {}
): PdfPageFingerprint {
  const fileName = options.fileName || '';
  const texts = data.allTexts || data.texts;
  const absorbedFree = data.texts;
  const textWidgets = (data.widgets || []).filter(w => w.type === 'text');
  const fieldNames = [...new Set(textWidgets.map(w => w.name).filter(Boolean))].sort();

  const lines = texts.map(t => t.str.trim()).filter(Boolean);
  const templateLines = [
    ...new Set(absorbedFree.map(t => normalizeLine(t.str)).filter(isTemplateLine)),
  ];
  const title = detectTitle(absorbedFree);

  const fieldMap: Record<string, string> = {};
  for (const widget of textWidgets) {
    const own = letterFromFieldName(widget.name);
    const label = own || findRowLabel(widget, absorbedFree);
    if (label && widget.name && !fieldMap[widget.name]) fieldMap[widget.name] = label;
  }
  const letters = new Set<string>(Object.values(fieldMap));
  for (const t of absorbedFree) {
    if (isLabelText(t.str)) letters.add(t.str.trim().replace(/[*∗]$/, ''));
  }

  const layout = new Set<string>();
  for (const t of absorbedFree) {
    if (!isLabelText(t.str)) continue;
    const cx = Math.round((t.rect.x0 + t.rect.x1) / 2 / 12);
    const cy = Math.round((t.rect.y0 + t.rect.y1) / 2 / 12);
    layout.add(hashLine(`${t.str.trim()}@${cx},${cy}`));
  }

  const views = detectViews(fileName, title, lines, [...letters]);
  return {
    pageNumber: data.pageNumber,
    width: Math.round(data.width),
    height: Math.round(data.height),
    fieldNames,
    fieldCount: fieldNames.length,
    title,
    lineHashes: templateLines.map(hashLine).sort(),
    letters: [...letters].sort(),
    layoutHashes: [...layout].sort(),
    modelCodes: extractModelCodes(fileName, lines),
    view: views[0] || null,
    views,
    language: detectLanguage(lines),
    fieldMap,
  };
}

/** Library folders that hold one form per model. */
export const MODEL_FOLDERS =
  /(^|[\\/])(Sofas|Armchairs|Sectionals|Dining Chairs|Ottomans|Armrests)\b/i;

/** Kind of a library template from its folder and content. */
export function classifyTemplate(path: string, fp: PdfPageFingerprint): PdfTemplateKind {
  if (/super[- ]?template/i.test(path)) return 'super';
  if (/JA PDF/i.test(path) || fp.language === 'ja') return 'ja';
  if (/(^|[\\/])Universal PDF[\\/]/i.test(path)) return 'universal';
  if (/Cushions?\b/i.test(path)) return 'cushion';
  if (fp.modelCodes.length && fp.letters.length) return 'model';
  if (MODEL_FOLDERS.test(path) && fp.letters.length) return 'model';
  return 'other';
}
