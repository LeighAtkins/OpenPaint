/**
 * Matches a page fingerprint to the CW template library.
 *
 * Exact text-field-name sets decide first (the Adobe forms share generic
 * names, so letters and printed text break ties); otherwise the nearest
 * template by letters, printed lines, title, page size and field count.
 */
import type { PdfLanguage, PdfPageFingerprint, PdfTemplateKind, PdfView } from './pdf-fingerprint';

export interface PdfTemplate {
  id: string;
  /** Library path of the PDF, relative to the library root. */
  source: string;
  page: number;
  kind: PdfTemplateKind;
  modelCodes: string[];
  view: PdfView | null;
  views: PdfView[];
  letters: string[];
  layoutHashes: string[];
  title: string;
  width: number;
  height: number;
  fieldCount: number;
  fieldNames: string[];
  lineHashes: string[];
  /** Text field name -> measurement letter. */
  fieldMap: Record<string, string>;
  /** Matching SVG diagram in the library, and where the app serves a copy. */
  svg: string | null;
  svgUrl: string | null;
  language: PdfLanguage;
  /** Set when no CW code was printed or in the file name, so the code is the file name. */
  codeFromFileName?: boolean;
}

/** A library SVG diagram and where the app serves it. */
export interface CwSvgEntry {
  url: string;
  source: string;
  code: string;
  view: string;
  letters: string[];
  /** True when lines carry SofaPaint label ids (mA1cm); otherwise letters are printed text only. */
  labelIds?: boolean;
}

export interface PdfTemplateCandidate {
  template: PdfTemplate;
  score: number;
}

export interface PdfTemplateMatch {
  template: PdfTemplate | null;
  /** 0..1; below 0.8 treat the template (and its letters) as a suggestion. */
  confidence: number;
  /** True when the field names are exactly the template's. */
  exactFields: boolean;
  candidates: PdfTemplateCandidate[];
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 1;
  const setB = new Set(b);
  let both = 0;
  for (const item of new Set(a)) if (setB.has(item)) both += 1;
  return both / (new Set([...a, ...b]).size || 1);
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && jaccard(a, b) === 1;

/** Two templates that read the same letters from the same fields are the same form. */
function sameForm(a: PdfTemplate, b: PdfTemplate): boolean {
  if (!sameSet(a.letters, b.letters) || !sameSet(a.layoutHashes, b.layoutHashes)) return false;
  const keys = Object.keys(a.fieldMap);
  return (
    keys.length === Object.keys(b.fieldMap).length &&
    keys.every(key => a.fieldMap[key] === b.fieldMap[key])
  );
}

/** Share of the page's labelled fields that the template reads as the same letter. */
function fieldMapAgreement(fp: PdfPageFingerprint, t: PdfTemplate): number {
  const keys = Object.keys(fp.fieldMap);
  if (!keys.length) return 0;
  return keys.filter(key => t.fieldMap[key] === fp.fieldMap[key]).length / keys.length;
}

export function scoreTemplate(fp: PdfPageFingerprint, t: PdfTemplate): number {
  const parts: Array<[number, number]> = [];
  // A page with no widgets (fully flattened) cannot be judged on field names.
  if (fp.fieldNames.length) {
    parts.push([0.3, jaccard(fp.fieldNames, t.fieldNames)]);
    if (Object.keys(fp.fieldMap).length) parts.push([0.1, fieldMapAgreement(fp, t)]);
  }
  parts.push([0.2, jaccard(fp.letters, t.letters)]);
  if (fp.layoutHashes.length || t.layoutHashes.length) {
    parts.push([0.1, jaccard(fp.layoutHashes, t.layoutHashes)]);
  }
  if (fp.lineHashes.length || t.lineHashes.length) {
    parts.push([0.15, jaccard(fp.lineHashes, t.lineHashes)]);
  }
  parts.push([0.06, fp.title && fp.title === t.title ? 1 : 0]);
  parts.push([
    0.03,
    Math.abs(fp.width - t.width) <= 2 && Math.abs(fp.height - t.height) <= 2 ? 1 : 0,
  ]);
  if (fp.fieldCount || t.fieldCount) {
    parts.push([
      0.03,
      1 - Math.abs(fp.fieldCount - t.fieldCount) / Math.max(fp.fieldCount, t.fieldCount),
    ]);
  }
  if (fp.modelCodes.length) {
    parts.push([0.03, fp.modelCodes.some(code => t.modelCodes.includes(code)) ? 1 : 0]);
  }
  const weight = parts.reduce((total, [w]) => total + w, 0);
  return parts.reduce((total, [w, s]) => total + w * s, 0) / weight;
}

/** Best template for a page, with a confidence that drops when a different form scores as well. */
export function matchPdfTemplate(
  fp: PdfPageFingerprint,
  templates: readonly PdfTemplate[],
  limit = 5
): PdfTemplateMatch {
  const exact =
    fp.fieldNames.length >= 2 ? templates.filter(t => sameSet(t.fieldNames, fp.fieldNames)) : [];
  const pool = exact.length ? exact : templates;
  const ranked = pool
    .map(template => ({ template, score: scoreTemplate(fp, template) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Prefer the current sheet over archived copies, then the shorter path.
        Number(/archive/i.test(a.template.source)) - Number(/archive/i.test(b.template.source)) ||
        a.template.source.length - b.template.source.length
    );
  const best = ranked[0];
  if (!best) return { template: null, confidence: 0, exactFields: false, candidates: [] };

  const rival = ranked.find(entry => !sameForm(entry.template, best.template));
  let confidence = best.score;
  if (exact.length)
    confidence = Math.max(confidence, 0.85 + 0.15 * jaccard(fp.letters, best.template.letters));
  if (rival) {
    // A different form within reach: confidence falls to 0.75 on a tie.
    confidence = Math.min(confidence, 0.75 + (best.score - rival.score) * 2.5);
  }
  return {
    template: best.template,
    confidence: Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000)),
    exactFields: exact.length > 0,
    candidates: ranked.slice(0, limit),
  };
}

/**
 * Model codes for a whole document: the most specific page decides (a frame
 * page over the shared cushion page). Identical forms published under several
 * codes return every code, best first.
 */
export function documentModelCodes(matches: readonly PdfTemplateMatch[]): string[] {
  const usable = matches.filter(m => m.template);
  if (!usable.length) return [];
  const specificity = (m: PdfTemplateMatch) =>
    (m.template!.view === 'cushion' ? 0 : 1000) + m.template!.letters.length + m.confidence;
  const best = usable.slice().sort((a, b) => specificity(b) - specificity(a))[0];
  const top = best.candidates[0]?.score ?? 0;
  const codes = [
    best.template!,
    ...best.candidates.filter(c => top - c.score < 0.001).map(c => c.template),
  ]
    .filter(t => sameForm(t, best.template!))
    .flatMap(t => t.modelCodes);
  return [...new Set(codes)];
}

export interface PdfDocumentMatch {
  /** Library file the document was printed from, when one fits. */
  source: string | null;
  confidence: number;
  /** Model codes of the document (identical forms published under several codes list each). */
  modelCodes: string[];
  /** One match per page; each page's template comes from `source` when it has that page. */
  pages: PdfTemplateMatch[];
  /** Other library files ranked by fit. */
  candidates: Array<{ source: string; score: number }>;
  /** Closest library file that is a different form, when one exists. */
  rival: { source: string; score: number } | null;
}

/**
 * Identify a whole document: every page votes for the library file it came
 * from, so a page shared by many forms (the cushion page) follows the frame page.
 */
export function matchPdfDocument(
  fps: readonly PdfPageFingerprint[],
  templates: readonly PdfTemplate[]
): PdfDocumentMatch {
  const pageMatches = fps.map(fp => matchPdfTemplate(fp, templates, 40));
  const bySource = new Map<string, PdfTemplate[]>();
  for (const t of templates) bySource.set(t.source, [...(bySource.get(t.source) || []), t]);
  const sources = new Set(pageMatches.flatMap(m => m.candidates.map(c => c.template.source)));
  if (!fps.length || !sources.size) {
    return {
      source: null,
      confidence: 0,
      modelCodes: [],
      pages: pageMatches,
      candidates: [],
      rival: null,
    };
  }

  const fit = (source: string) => {
    const pages = bySource.get(source) || [];
    const picks = fps.map(
      fp =>
        pages
          .map(template => ({ template, score: scoreTemplate(fp, template) }))
          .sort((a, b) => b.score - a.score)[0]
    );
    const mean = picks.reduce((total, p) => total + (p?.score || 0), 0) / fps.length;
    const pageAgreement = Math.min(pages.length, fps.length) / Math.max(pages.length, fps.length);
    return { source, score: mean * 0.95 + pageAgreement * 0.05, picks };
  };
  const ranked = [...sources]
    .map(fit)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(/archive/i.test(a.source)) - Number(/archive/i.test(b.source)) ||
        a.source.length - b.source.length
    );
  const best = ranked[0];
  const sameDocument = (other: (typeof ranked)[number]) =>
    other.picks.every(
      (p, i) => p && best.picks[i] && sameForm(p.template, best.picks[i]!.template)
    );
  const twins = ranked.filter(r => r === best || (best.score - r.score < 0.001 && sameDocument(r)));
  const rival = ranked.find(r => r !== best && !sameDocument(r));
  let confidence = best.score;
  if (rival) confidence = Math.min(confidence, 0.75 + (best.score - rival.score) * 2.5);
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000));

  const pages = pageMatches.map((m, i) => {
    const pick = best.picks[i];
    if (!pick) return m;
    const pageConfidence = Math.min(
      confidence,
      0.75 +
        (pick.score - (m.candidates.find(c => !sameForm(c.template, pick.template))?.score ?? 0)) *
          2.5
    );
    return {
      ...m,
      template: pick.template,
      confidence: Math.max(confidence, Math.min(1, Math.round(pageConfidence * 1000) / 1000)),
    };
  });
  const modelCodes = [
    ...new Set(
      twins.flatMap(r => {
        const specific = r.picks
          .filter(Boolean)
          .sort(
            (a, b) =>
              Number(b!.template.view !== 'cushion') - Number(a!.template.view !== 'cushion')
          )[0];
        return specific?.template.modelCodes || [];
      })
    ),
  ];
  return {
    source: best.source,
    confidence,
    modelCodes,
    pages,
    candidates: ranked
      .slice(0, 5)
      .map(r => ({ source: r.source, score: Math.round(r.score * 1000) / 1000 })),
    rival: rival ? { source: rival.source, score: Math.round(rival.score * 1000) / 1000 } : null,
  };
}
