// Measurement check requests: a small JSON spec naming views + measurement
// codes drives focused "customer check" exports — each exported image shows
// only the requested measurements over the clean photo.
//
// The resolver, formatters, and visibility helper in this file are pure
// (no canvas needed) so they stay unit-testable. The dialog at the bottom
// wires them to the live app and lazily imports the capture engine from
// pdf-export-inline.ts to avoid a circular module import.

/* eslint-disable @typescript-eslint/no-misused-promises */

import { z } from 'zod';
import { parseSofaPaintReviewPdf } from './measurement-review';
import { sanitizeFilenamePart } from '../utils/naming-utils.js';

// ── Request schema (spec v1 + v2) ────────────────────────────────────

export const MAX_SPEC_VERSION = 2;

const pageV2Shape = {
  // v2: explicit frame selection. A number is a frame index across the view's
  // scopes (0 = base frame, 1 = first capture tab, …); a string matches a tab
  // id or scope suffix.
  frame: z.union([z.string().max(160), z.number().int().min(0)]).optional(),
  // v2: which questions this page answers — drives bundle image naming and
  // the reply manifest.
  questionIds: z.array(z.string().min(1).max(40)).max(40).optional(),
};

export const checkRequestSchema = z.object({
  specVersion: z.number().int().optional(),
  title: z.string().max(160).optional(),
  unit: z.enum(['as-entered', 'cm', 'inch']).optional(),
  output: z
    .object({
      png: z.boolean(),
      pdf: z.boolean(),
      zip: z.boolean(),
      scale: z.number().int().min(1).max(4),
    })
    .partial()
    .optional(),
  // v2: case identity for drafting bundles.
  case: z
    .object({
      ticketId: z.string().max(80),
      orderId: z.string().max(80),
    })
    .partial()
    .optional(),
  // v2: the numbered questions this request answers.
  questions: z
    .array(z.object({ id: z.string().min(1).max(40), text: z.string().min(1).max(600) }))
    .max(40)
    .optional(),
  pages: z
    .array(
      z.object({
        view: z.string().min(1).max(180),
        tab: z.union([z.string().max(120), z.number().int().min(0)]).optional(),
        codes: z.array(z.string().min(1).max(40)).min(1).max(60),
        title: z.string().max(160).optional(),
        note: z.string().max(300).optional(),
        ...pageV2Shape,
      })
    )
    .min(1)
    .max(100),
});

export type CheckRequestInput = z.infer<typeof checkRequestSchema>;

export interface NormalizedCheckRequest {
  specVersion: 1 | 2;
  title?: string;
  unit: 'as-entered' | 'cm' | 'inch';
  output: { png: boolean; pdf: boolean; zip: boolean; scale: number };
  case?: { ticketId?: string; orderId?: string };
  questions?: Array<{ id: string; text: string }>;
  pages: Array<{
    view: string;
    tab?: string | number;
    frame?: string | number;
    codes: string[];
    title?: string;
    note?: string;
    questionIds?: string[];
  }>;
}

export type CheckRequestParseResult =
  | { ok: true; request: NormalizedCheckRequest }
  | { ok: false; error: string };

// Parse + version-guard a raw request. v1 payloads behave exactly as before;
// v2-only fields on a v1 payload are rejected explicitly instead of being
// silently stripped, and unknown future versions fail hard.
export function parseCheckRequest(raw: unknown): CheckRequestParseResult {
  const rawVersion = Number((raw as any)?.specVersion ?? 1);
  if (!Number.isInteger(rawVersion) || rawVersion < 1) {
    return {
      ok: false,
      error: `Invalid specVersion: ${JSON.stringify((raw as any)?.specVersion)}. Use 1 or ${MAX_SPEC_VERSION}.`,
    };
  }
  if (rawVersion > MAX_SPEC_VERSION) {
    return {
      ok: false,
      error: `Request specVersion ${rawVersion} is newer than this SofaPaint supports (max ${MAX_SPEC_VERSION}). Update SofaPaint or export a v${MAX_SPEC_VERSION} request.`,
    };
  }

  const usesV2Fields =
    (Array.isArray((raw as any)?.pages) &&
      (raw as any).pages.some(
        (page: any) => page?.frame !== undefined || page?.questionIds !== undefined
      )) ||
    Boolean((raw as any)?.questions) ||
    Boolean((raw as any)?.case);
  if (rawVersion < 2 && usesV2Fields) {
    return {
      ok: false,
      error:
        'This request uses spec v2 features (frame, questionIds, questions, case) — set "specVersion": 2.',
    };
  }

  const result = checkRequestSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues
      .map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`)
      .slice(0, 3)
      .join('; ');
    return { ok: false, error: `Request does not match the spec: ${first}` };
  }
  const parsed = result.data;
  const request: NormalizedCheckRequest = {
    specVersion: rawVersion >= 2 ? 2 : 1,
    title: parsed.title,
    unit: parsed.unit || 'as-entered',
    output: {
      png: parsed.output?.png ?? true,
      pdf: parsed.output?.pdf ?? true,
      zip: parsed.output?.zip ?? false,
      scale: parsed.output?.scale ?? 2,
    },
    ...(parsed.case ? { case: parsed.case } : {}),
    ...(parsed.questions ? { questions: parsed.questions } : {}),
    pages: (parsed.pages || []).map(page => ({
      view: page.view,
      tab: page.tab,
      ...(page.frame !== undefined ? { frame: page.frame } : {}),
      codes: page.codes.map(code => code.trim().toUpperCase()),
      title: page.title,
      note: page.note,
      ...(page.questionIds ? { questionIds: page.questionIds.map(id => id.trim()) } : {}),
    })),
  };
  return { ok: true, request };
}

// ── Resolution context ───────────────────────────────────────────────

export interface CheckMeasurementLike {
  cm?: number | string;
  inch?: number | string;
  inchWhole?: number | string;
  inchFraction?: number | string;
  inputUnit?: string;
  inputValue?: string;
  displayValue?: string;
}

export interface CheckContextScope {
  scopeKey: string;
  tabId: string | null;
  codes: string[];
  measurements: Record<string, CheckMeasurementLike | undefined>;
}

export interface CheckContextView {
  viewId: string;
  title: string;
  hasImage: boolean;
  scopes: CheckContextScope[];
}

export interface CheckContext {
  projectName: string;
  views: CheckContextView[];
}

export interface CheckIssue {
  kind:
    | 'unknown-view'
    | 'unknown-tab'
    | 'unknown-frame'
    | 'ambiguous-frame'
    | 'missing-code'
    | 'no-value'
    | 'ambiguous-value';
  pageIndex: number;
  view?: string;
  code?: string;
  message: string;
}

export interface CheckRow {
  label: string;
  value: string;
  fieldName: string;
}

export interface ResolvedCheckPage {
  pageIndex: number;
  viewId: string;
  title: string;
  note?: string;
  tabId: string | null;
  scopeKey: string;
  frameLabel: string;
  questionIds?: string[];
  codes: string[];
  rows: CheckRow[];
  missingCodes: string[];
  noValueCodes: string[];
}

export interface ResolvedCheckRequest {
  specVersion: 1 | 2;
  title: string;
  unit: 'as-entered' | 'cm' | 'inch';
  output: { png: boolean; pdf: boolean; zip: boolean; scale: number };
  case?: { ticketId?: string; orderId?: string };
  questions?: Array<{ id: string; text: string }>;
  pages: ResolvedCheckPage[];
  issues: CheckIssue[];
}

// ── Small helpers (shared semantics with measurement-review.ts) ──────

function baseViewId(scope = ''): string {
  return scope.split('::tab:')[0] || scope;
}

function tabIdFromScope(scope = ''): string | null {
  const marker = '::tab:';
  const index = scope.indexOf(marker);
  if (index < 0) return null;
  return scope.slice(index + marker.length).trim() || null;
}

function fieldPart(value = ''): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

// ── Value formatting ─────────────────────────────────────────────────

function trimTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

// Exact 2.54-based conversion; source precision is preserved by the stored
// dual cm/inch values and rounding only happens for display.
export function formatCheckValue(
  measurement: CheckMeasurementLike | undefined | null,
  unit: 'as-entered' | 'cm' | 'inch'
): string {
  if (!measurement) return '';
  const cm = Number(measurement.cm);
  const inch = Number(measurement.inch);
  const hasCm = Number.isFinite(cm) && cm > 0;
  const hasInch = Number.isFinite(inch) && inch > 0;

  const entered = (measurement.inputValue || measurement.displayValue || '').trim();
  const inputUnit = measurement.inputUnit === 'inches' ? 'inch' : 'cm';
  const target = unit === 'as-entered' ? inputUnit : unit;

  if (unit === 'as-entered' && entered) return entered;
  if (target === 'inch') {
    if (!hasInch) return '';
    return `${trimTrailingZeros(inch.toFixed(2))}"`;
  }
  if (!hasCm) return '';
  return `${trimTrailingZeros(cm.toFixed(1))} cm`;
}

// ── Request resolution ───────────────────────────────────────────────

function findContextView(context: CheckContext, viewToken: string): CheckContextView | null {
  const token = viewToken.trim();
  const lowered = token.toLowerCase();
  return (
    context.views.find(view => view.viewId === token) ||
    context.views.find(view => fieldPart(view.viewId) === fieldPart(token)) ||
    context.views.find(view => view.title.toLowerCase() === lowered) ||
    null
  );
}

function orderScopesForPage(view: CheckContextView, preferredTabId: string | null) {
  return [...view.scopes].sort((a, b) => {
    const score = (scope: CheckContextScope) => {
      if (preferredTabId && scope.tabId === preferredTabId) return 0;
      if (scope.tabId === null) return 1;
      return 2;
    };
    const byScore = score(a) - score(b);
    return byScore !== 0 ? byScore : naturalCompare(a.scopeKey, b.scopeKey);
  });
}

function resolvePageTab(
  view: CheckContextView,
  tab: string | number | undefined,
  issues: CheckIssue[],
  pageIndex: number
): string | null {
  if (tab === undefined) return null;
  const tabScopes = view.scopes.filter(scope => scope.tabId !== null);
  if (typeof tab === 'number') {
    const ordered = tabScopes.sort((a, b) => naturalCompare(a.tabId || '', b.tabId || ''));
    const found = ordered[tab] || null;
    if (!found) {
      issues.push({
        kind: 'unknown-tab',
        pageIndex,
        view: view.viewId,
        message: `Page ${pageIndex + 1}: tab index ${tab} does not exist on "${view.title}" (${tabScopes.length} tab(s) found).`,
      });
      return null;
    }
    return found.tabId;
  }
  const token = tab;
  const found = tabScopes.find(
    scope => scope.tabId === token || scope.scopeKey.endsWith(`::tab:${token}`)
  );
  if (!found) {
    issues.push({
      kind: 'unknown-tab',
      pageIndex,
      view: view.viewId,
      message: `Page ${pageIndex + 1}: tab "${token}" was not found on "${view.title}".`,
    });
    return null;
  }
  return found.tabId;
}

// v2 frame selection: a number is an index across the view's scopes (base
// first), a string matches a tab id or `::tab:` scope suffix.
function resolvePageFrame(
  view: CheckContextView,
  frame: string | number,
  issues: CheckIssue[],
  pageIndex: number
): { tabId: string | null; frameIndex: number } | null {
  const orderedScopes = orderScopesForPage(view, null);
  if (typeof frame === 'number') {
    const scope = orderedScopes[frame];
    if (!scope) {
      issues.push({
        kind: 'unknown-frame',
        pageIndex,
        view: view.viewId,
        message: `Page ${pageIndex + 1}: frame ${frame} does not exist on "${view.title}" (${orderedScopes.length} frame(s) found).`,
      });
      return null;
    }
    return { tabId: scope.tabId, frameIndex: frame };
  }
  const token = frame;
  const index = orderedScopes.findIndex(
    scope => scope.tabId === token || scope.scopeKey.endsWith(`::tab:${token}`)
  );
  if (index < 0) {
    issues.push({
      kind: 'unknown-frame',
      pageIndex,
      view: view.viewId,
      message: `Page ${pageIndex + 1}: frame "${token}" was not found on "${view.title}".`,
    });
    return null;
  }
  return { tabId: orderedScopes[index].tabId, frameIndex: index };
}

export function resolveCheckRequest(
  request: NormalizedCheckRequest,
  context: CheckContext
): ResolvedCheckRequest {
  const issues: CheckIssue[] = [];
  const pages: ResolvedCheckPage[] = [];

  request.pages.forEach((page, pageIndex) => {
    const view = findContextView(context, page.view);
    if (!view) {
      issues.push({
        kind: 'unknown-view',
        pageIndex,
        view: page.view,
        message: `Page ${pageIndex + 1}: view "${page.view}" was not found. Available: ${context.views.map(v => v.title).join(', ') || 'none'}.`,
      });
      return;
    }

    const frameSelection =
      page.frame !== undefined ? resolvePageFrame(view, page.frame, issues, pageIndex) : null;
    const preferredTabId = frameSelection
      ? frameSelection.tabId
      : resolvePageTab(view, page.tab, issues, pageIndex);
    const orderedScopes = orderScopesForPage(view, preferredTabId);

    const rows: CheckRow[] = [];
    const missingCodes: string[] = [];
    const noValueCodes: string[] = [];

    page.codes.forEach(code => {
      const candidates = orderedScopes
        .map(scope => ({ scope, measurement: scope.measurements[code] }))
        .filter(entry => entry.scope.codes.includes(code));

      if (!candidates.length) {
        missingCodes.push(code);
        rows.push({
          label: code,
          value: '',
          fieldName: `m_${fieldPart(view.viewId)}_${fieldPart(code)}`,
        });
        return;
      }

      const values = candidates
        .map(entry => formatCheckValue(entry.measurement, request.unit))
        .filter(Boolean);
      const distinct = Array.from(new Set(values));

      let value = values[0] || '';
      if (distinct.length > 1) {
        issues.push({
          kind: 'ambiguous-value',
          pageIndex,
          view: view.viewId,
          code,
          message: `Page ${pageIndex + 1}: code ${code} has ${distinct.length} different values on "${view.title}" (${distinct.join(', ')}); using the first.`,
        });
      }
      if (!value) {
        noValueCodes.push(code);
        issues.push({
          kind: 'no-value',
          pageIndex,
          view: view.viewId,
          code,
          message: `Page ${pageIndex + 1}: code ${code} exists on "${view.title}" but has no measurement value.`,
        });
      }
      rows.push({
        label: code,
        value,
        fieldName: `m_${fieldPart(view.viewId)}_${fieldPart(code)}`,
      });
    });

    missingCodes.forEach(code => {
      issues.push({
        kind: 'missing-code',
        pageIndex,
        view: view.viewId,
        code,
        message: `Page ${pageIndex + 1}: code ${code} was not found on "${view.title}". Codes there: ${
          orderedScopes
            .flatMap(s => s.codes)
            .sort(naturalCompare)
            .join(', ') || 'none'
        }.`,
      });
    });

    // Capture target: explicit frame/tab wins, else the scope holding the
    // codes (base scope ⇒ null so the view captures with its default tab).
    const allScope = orderedScopes.find(scope =>
      page.codes.every(code => scope.codes.includes(code))
    );
    const anyScope = orderedScopes.find(scope =>
      page.codes.some(code => scope.codes.includes(code))
    );
    const captureScope = frameSelection
      ? orderedScopes[frameSelection.frameIndex]
      : ((allScope || anyScope) ?? null);
    const tabId = preferredTabId ?? captureScope?.tabId ?? null;
    const captureIndex = captureScope ? orderedScopes.indexOf(captureScope) : 0;
    const frameLabel = `f${captureIndex + 1}`;

    // Codes that live in several frames of the same view are ambiguous for a
    // single capture: warn for v1 (exports use the first frame, as before)
    // and treat as fatal for v2, which opted into explicit frames.
    const framesWithCodes = orderedScopes.filter(scope =>
      page.codes.some(code => scope.codes.includes(code))
    );
    if (!frameSelection && preferredTabId === null && framesWithCodes.length > 1) {
      const frameNames = framesWithCodes
        .map(scope => `f${orderedScopes.indexOf(scope) + 1}`)
        .join(', ');
      issues.push({
        kind: 'ambiguous-frame',
        pageIndex,
        view: view.viewId,
        message: `Page ${pageIndex + 1}: codes ${page.codes.join(', ')} exist in ${framesWithCodes.length} frames of "${view.title}" (${frameNames}). ${
          request.specVersion >= 2
            ? 'Set "frame" on this page to choose one.'
            : `Using ${frameNames.split(', ')[0]}. Set "frame" (spec v2) to choose explicitly.`
        }`,
      });
    }

    pages.push({
      pageIndex,
      viewId: view.viewId,
      title: page.title || view.title,
      note: page.note,
      tabId,
      scopeKey: tabId ? `${view.viewId}::tab:${tabId}` : view.viewId,
      frameLabel,
      codes: [...page.codes],
      rows,
      missingCodes,
      noValueCodes,
      ...(page.questionIds ? { questionIds: [...page.questionIds] } : {}),
    });
  });

  return {
    specVersion: request.specVersion,
    title: request.title || context.projectName || 'Measurement checks',
    unit: request.unit,
    output: request.output,
    ...(request.case ? { case: request.case } : {}),
    ...(request.questions ? { questions: request.questions } : {}),
    pages,
    issues,
  };
}

// ── Project catalogue + context from the live app ────────────────────

export function buildCheckContextFromApp(): CheckContext {
  const app = (window as any).app;
  const manager = app?.metadataManager;
  const projectManager = app?.projectManager;
  const partLabels = projectManager?.getProjectMetadata?.()?.imagePartLabels || {};

  const views = new Map<string, CheckContextView>();
  const ensureView = (viewId: string): CheckContextView => {
    let view = views.get(viewId);
    if (!view) {
      view = { viewId, title: partLabels[viewId] || viewId, hasImage: false, scopes: [] };
      views.set(viewId, view);
    }
    return view;
  };

  Object.entries(projectManager?.views || {}).forEach(([viewId, view]: any) => {
    if (view?.image) ensureView(viewId).hasImage = true;
  });

  const addScopeEntry = (scope: string, bucket: any, isMeasurements: boolean) => {
    const view = ensureView(baseViewId(scope));
    let scopeEntry = view.scopes.find(entry => entry.scopeKey === scope);
    if (!scopeEntry) {
      scopeEntry = { scopeKey: scope, tabId: tabIdFromScope(scope), codes: [], measurements: {} };
      view.scopes.push(scopeEntry);
    }
    Object.keys(bucket || {}).forEach(label => {
      if (!scopeEntry!.codes.includes(label)) scopeEntry!.codes.push(label);
      if (isMeasurements && bucket[label]) scopeEntry!.measurements[label] = bucket[label];
    });
  };

  Object.entries(manager?.vectorStrokesByImage || {}).forEach(([scope, bucket]) =>
    addScopeEntry(scope, bucket, false)
  );
  Object.entries(manager?.strokeMeasurements || {}).forEach(([scope, bucket]) =>
    addScopeEntry(scope, bucket, true)
  );

  views.forEach(view => {
    view.scopes.sort((a, b) => {
      if (a.tabId === null && b.tabId !== null) return -1;
      if (b.tabId === null && a.tabId !== null) return 1;
      return naturalCompare(a.scopeKey, b.scopeKey);
    });
  });

  const projectNameInput = document.getElementById('projectName') as HTMLInputElement | null;
  const projectName = (projectNameInput?.value || '').trim() || 'OpenPaint';
  return { projectName, views: Array.from(views.values()) };
}

export function getProjectCheckCatalog() {
  const context = buildCheckContextFromApp();
  return {
    specVersion: MAX_SPEC_VERSION,
    hint: 'Pick views + codes into a request: {"pages":[{"view":"<viewId>","codes":["…"]}]}',
    views: context.views.map(view => ({
      viewId: view.viewId,
      title: view.title,
      hasImage: view.hasImage,
      codes: Array.from(new Set(view.scopes.flatMap(scope => scope.codes))).sort(naturalCompare),
      // v2: per-frame code lists so repeated codes (seat vs back cushion A/B)
      // can be selected individually via "frame" (tab id or frame index).
      frames: view.scopes.map((scope, index) => ({
        index,
        scopeKey: scope.scopeKey,
        tabId: scope.tabId,
        title: scope.tabId ? `Frame ${index + 1} (tab ${scope.tabId})` : `Frame ${index + 1}`,
        codes: Array.from(new Set(scope.codes)).sort(naturalCompare),
      })),
    })),
  };
}

// ── SofaPaint PDF value refresh ──────────────────────────────────────

// Split a raw PDF value like `21 1/2”`, `14”  (13” to floor)` or `52 cm` into
// a canonical numeric string ("21 1/2\""), its unit, and any trailing note the
// customer wrote after the measurement. Curly/prime quote marks are normalized
// so fractions survive parsing, and the note is kept separate from the value.
export function parseValueText(raw: string): {
  numericText: string;
  unit: 'cm' | 'inches' | null;
  note: string;
} {
  const text = (raw || '').replace(/[”″❞]/g, '"').replace(/\s+/g, ' ').trim();
  const match =
    /^(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?|\d+\s*\/\s*\d+)\s*(cm|in|inch|inches|")?\s*(.*)$/i.exec(
      text
    );
  if (!match) return { numericText: text, unit: null, note: '' };
  const [, amount, rawSuffix, rest] = match;
  const suffix = (rawSuffix || '').toLowerCase();
  let unit: 'cm' | 'inches' | null = null;
  let canonicalSuffix = '';
  if (suffix === 'cm') {
    unit = 'cm';
    canonicalSuffix = 'cm';
  } else if (suffix) {
    unit = 'inches';
    canonicalSuffix = '"';
  }
  const note = rest.replace(/^[-–—:;,.\s]+/, '').trim();
  return {
    numericText: canonicalSuffix
      ? canonicalSuffix === 'cm'
        ? `${amount} cm`
        : `${amount}"`
      : amount,
    unit,
    note,
  };
}

// Parse "52 cm" / "38 in" / "1.5"" into a synthetic measurement so unit
// conversion still works when the PDF value has no stroke behind it. Bare
// numbers fall back to the PDF's detected unit.
function measurementFromEnteredText(
  text: string,
  defaultUnit?: 'inch' | 'cm' | null
): CheckMeasurementLike {
  const parsed = parseValueText(text);
  const unit =
    parsed.unit || (defaultUnit === 'inch' ? 'inches' : defaultUnit === 'cm' ? 'cm' : null);
  const numeric = parsed.numericText.replace(/\s*(cm|")$/i, '').trim();
  const fractionMatch = /^(\d+)?\s*(\d+)\s*\/\s*(\d+)$/.exec(numeric);
  let amount: number | null = null;
  if (fractionMatch) {
    const whole = Number(fractionMatch[1] || 0);
    const value = whole + Number(fractionMatch[2]) / Number(fractionMatch[3]);
    amount = Number.isFinite(value) ? value : null;
  } else {
    const num = Number(numeric);
    amount = Number.isFinite(num) ? num : null;
  }
  if (amount === null || amount <= 0) return { inputValue: text };
  if (unit === 'inches') return { inch: amount, inputUnit: 'inches', inputValue: text };
  if (unit === 'cm') return { cm: amount, inputUnit: 'cm', inputValue: text };
  return { inputValue: text };
}

// Which unit a PDF value string is in: an explicit suffix always wins; bare
// numbers fall back to the PDF's detected unit, then the app's cm default.
export function resolveValueUnit(text: string, pdfUnit?: 'inch' | 'cm' | null): 'cm' | 'inches' {
  const parsed = parseValueText(text);
  if (parsed.unit) return parsed.unit;
  return pdfUnit === 'inch' ? 'inches' : 'cm';
}

function effectivePdfUnit(
  pdfManifest: any,
  unitOverride?: 'auto' | 'inch' | 'cm' | null
): 'inch' | 'cm' | null {
  if (unitOverride === 'inch' || unitOverride === 'cm') return unitOverride;
  const detected = pdfManifest?.unit;
  return detected === 'inch' || detected === 'cm' ? detected : null;
}

// Merge values from a received SofaPaint PDF (via parseSofaPaintReviewPdf)
// into the project context so validation + exports use the PDF values.
export function mergePdfValuesIntoContext(
  context: CheckContext,
  pdfManifest: any,
  unitOverride?: 'auto' | 'inch' | 'cm' | null
): CheckContext {
  if (!pdfManifest?.views?.length) return context;
  const pdfUnit = effectivePdfUnit(pdfManifest, unitOverride);

  // Group manifest entries per context view, preserving manifest order: the
  // k-th entry is frame k+1 and maps to the k-th scope (mirrors the planner).
  const pdfViewsByContextView = new Map();
  pdfManifest.views.forEach((pdfView: any) => {
    const view =
      context.views.find(candidate => candidate.viewId === String(pdfView.viewId || '')) ||
      context.views.find(
        candidate => fieldPart(candidate.viewId) === fieldPart(String(pdfView.viewId || ''))
      ) ||
      context.views.find(
        candidate => candidate.title.toLowerCase() === String(pdfView.title || '').toLowerCase()
      );
    if (!view) return;
    const list = pdfViewsByContextView.get(view.viewId) || [];
    list.push(pdfView);
    pdfViewsByContextView.set(view.viewId, list);
  });

  const views = context.views.map(view => {
    const matching = pdfViewsByContextView.get(view.viewId);
    if (!matching) return view;

    const scopes: CheckContextScope[] = view.scopes.map(scope => ({
      ...scope,
      codes: [...scope.codes],
      measurements: { ...scope.measurements },
    }));
    const orderedScopes = [...scopes].sort((a, b) => {
      if (a.tabId === null && b.tabId !== null) return -1;
      if (b.tabId === null && a.tabId !== null) return 1;
      return naturalCompare(a.scopeKey, b.scopeKey);
    });

    matching.forEach((pdfView: any, frameIndex: number) => {
      const multiFrame = matching.length > 1;
      const frameScope = multiFrame ? orderedScopes[frameIndex] : null;
      if (multiFrame && !frameScope) return;
      (pdfView.measurements || []).forEach((row: any) => {
        const value = String(row?.value ?? '').trim();
        if (!value || !row?.label) return;
        const label = String(row.label);
        const target =
          frameScope || scopes.find(scope => scope.measurements[label]) || orderedScopes[0];
        if (!target) return;
        const existing = target.measurements[label];
        const parsed = measurementFromEnteredText(value, pdfUnit);
        target.measurements[label] = existing
          ? { ...existing, ...parsed, inputValue: value }
          : { ...parsed, inputValue: value };
        if (!target.codes.includes(label)) target.codes.push(label);
      });
    });
    return { ...view, scopes };
  });
  return { ...context, views };
}

// ── Saving PDF values into the project ───────────────────────────────

export interface PdfValueSaveEntry {
  viewId: string;
  viewTitle: string;
  scopeKey: string;
  label: string;
  valueText: string;
  hadValue: boolean;
  note?: string;
}

export interface PdfValueSavePlan {
  entries: PdfValueSaveEntry[];
  matchedViews: Array<{ viewId: string; title: string; count: number }>;
  unmatchedPdfViews: Array<{ viewId: string; title: string; count: number }>;
  warnings: string[];
}

function measurementHasValue(measurement?: CheckMeasurementLike): boolean {
  if (!measurement) return false;
  const cm = Number(measurement.cm);
  const inch = Number(measurement.inch);
  if ((Number.isFinite(cm) && cm > 0) || (Number.isFinite(inch) && inch > 0)) return true;
  return Boolean((measurement.inputValue || measurement.displayValue || '').trim());
}

// Pure plan of which project scopes a SofaPaint PDF's values would be written
// to. Matching mirrors mergePdfValuesIntoContext: exact viewId, then
// fieldPart-normalized id, then case-insensitive title.
//
// Frames: a manifest may list the same viewId once per capture frame ("Frame
// 1", "Frame 2"…). The k-th occurrence maps to the k-th project scope of that
// view (base scope first, then capture-tab scopes), so frame 2's `_2` field
// values land on the frame-2 strokes instead of overwriting frame 1. If the
// project has no k-th scope, a warning is recorded and those rows are skipped.
export function planPdfValueSaves(context: CheckContext, pdfManifest: any): PdfValueSavePlan {
  const plan: PdfValueSavePlan = {
    entries: [],
    matchedViews: [],
    unmatchedPdfViews: [],
    warnings: [],
  };
  if (!pdfManifest?.views?.length) return plan;

  // First resolve every manifest entry to its project view so we know which
  // views appear multiple times (once per capture frame).
  const resolvedPairs: Array<{ pdfView: any; view: CheckContextView; rows: any[] }> = [];
  pdfManifest.views.forEach((pdfView: any) => {
    const rows = (pdfView.measurements || []).filter(
      (row: any) => row?.label && String(row?.value ?? '').trim()
    );
    const view =
      findContextView(context, String(pdfView.viewId || '')) ||
      context.views.find(
        candidate => candidate.title.toLowerCase() === String(pdfView.title || '').toLowerCase()
      );
    if (!view) {
      plan.unmatchedPdfViews.push({
        viewId: String(pdfView.viewId || ''),
        title: String(pdfView.title || pdfView.viewId || ''),
        count: rows.length,
      });
      return;
    }
    resolvedPairs.push({ pdfView, view, rows });
  });

  const occurrencesByView = new Map();
  resolvedPairs.forEach(({ view }) => {
    occurrencesByView.set(view.viewId, (occurrencesByView.get(view.viewId) ?? 0) + 1);
  });
  const plannedFramesByView = new Map();

  resolvedPairs.forEach(({ view, rows }) => {
    const orderedScopes = [...view.scopes].sort((a, b) => {
      if (a.tabId === null && b.tabId !== null) return -1;
      if (b.tabId === null && a.tabId !== null) return 1;
      return naturalCompare(a.scopeKey, b.scopeKey);
    });
    const totalFrames = occurrencesByView.get(view.viewId) ?? 1;
    const frameIndex = plannedFramesByView.get(view.viewId) ?? 0;
    plannedFramesByView.set(view.viewId, frameIndex + 1);

    let target;
    if (totalFrames > 1) {
      // Multi-frame: the k-th manifest entry maps to the k-th scope so frame
      // 2's `_2` values land on the frame-2 strokes.
      target = orderedScopes[frameIndex];
      if (!target) {
        plan.warnings.push(
          `Frame ${frameIndex + 1} of "${view.title}" (${rows.length} value(s)) has no matching frame in the project — its values were not saved.`
        );
        plan.unmatchedPdfViews.push({
          viewId: view.viewId,
          title: `${view.title} — Frame ${frameIndex + 1}`,
          count: rows.length,
        });
        return;
      }
    } else if (!orderedScopes.length) {
      // Views with no strokes yet still have a natural base scope.
      orderedScopes.push({ scopeKey: view.viewId, tabId: null, codes: [], measurements: {} });
    }

    rows.forEach((row: any) => {
      const label = String(row.label);
      const valueText = String(row.value).trim();
      let rowTarget = target;
      if (!rowTarget) {
        // Single frame: prefer the scope that already knows each label
        // (base scope first), else the view's base scope.
        const withLabel = orderedScopes.filter(scope => scope.codes.includes(label));
        const baseScope =
          orderedScopes.find(scope => scope.scopeKey === view.viewId) || orderedScopes[0];
        rowTarget =
          withLabel.find(scope => scope.tabId === null) ||
          withLabel[0] ||
          baseScope ||
          orderedScopes[0];
      }
      plan.entries.push({
        viewId: view.viewId,
        viewTitle: view.title,
        scopeKey: rowTarget.scopeKey,
        label,
        valueText,
        hadValue: view.scopes.some(scope => measurementHasValue(scope.measurements[label])),
      });
    });
    plan.matchedViews.push({
      viewId: view.viewId,
      title:
        rows.length && totalFrames > 1 && frameIndex > 0
          ? `${view.title} (Frame ${frameIndex + 1})`
          : view.title,
      count: rows.length,
    });
  });

  return plan;
}

// Write a planned PDF manifest's values into the project's measurement
// records using the same path the CW import uses (parseMeasurementInput →
// setMeasurement), refreshing existing tag text. Values land in the live
// project state; the next project save persists every view.
export async function savePdfValuesToProject(
  pdfManifest: any,
  {
    confirmOverwrite = true,
    unit,
  }: { confirmOverwrite?: boolean; unit?: 'auto' | 'inch' | 'cm' | null } = {}
): Promise<{
  cancelled?: boolean;
  saved: number;
  updated: number;
  failures: string[];
  noteCount: number;
  plan: PdfValueSavePlan;
}> {
  const app = (window as any).app;
  const metadata = app?.metadataManager;
  if (!metadata) throw new Error('No project is open.');

  const pdfUnit = effectivePdfUnit(pdfManifest, unit);
  const plan = planPdfValueSaves(buildCheckContextFromApp(), pdfManifest);
  const updated = plan.entries.filter(entry => entry.hadValue).length;
  if (!plan.entries.length) {
    return { saved: 0, updated: 0, failures: [], noteCount: 0, plan };
  }
  if (confirmOverwrite && updated > 0) {
    const proceed = window.confirm(
      `This will write ${plan.entries.length} measurement value(s) into the project — ` +
        `${updated} of them overwrite value(s) that already exist. Continue?`
    );
    if (!proceed) {
      return { cancelled: true, saved: 0, updated, failures: [], noteCount: 0, plan };
    }
  }

  const measurementSystem = app?.measurementSystem;
  const tagManager = app?.tagManager;
  const projectManager = app?.projectManager;
  const failures: string[] = [];
  const noteChanges: Record<string, string> = {};
  const noteRemovals: string[] = [];
  let saved = 0;
  let noteCount = 0;

  plan.entries.forEach(entry => {
    const parsedValue = parseValueText(entry.valueText);
    entry.note = parsedValue.note;
    const noteKey = `${entry.scopeKey}|${entry.label}`;
    try {
      let applied = false;
      const unitForValue = parsedValue.unit || resolveValueUnit(parsedValue.numericText, pdfUnit);
      const parsed = measurementSystem?.parseMeasurementInput?.(
        parsedValue.numericText,
        unitForValue
      );
      if (parsed) {
        measurementSystem.setMeasurement(
          entry.scopeKey,
          entry.label,
          parsed.inchWhole,
          parsed.inchFraction,
          {
            cmValue: parsed.cm,
            inchValue: parsed.totalInches,
            inputUnit: unitForValue === 'inches' ? 'inches' : 'cm',
          }
        );
        applied = true;
      } else if (typeof metadata.parseAndSaveMeasurement === 'function') {
        applied = Boolean(
          metadata.parseAndSaveMeasurement(entry.scopeKey, entry.label, parsedValue.numericText)
        );
      }
      if (applied) {
        saved += 1;
        if (parsedValue.note) {
          noteChanges[noteKey] = parsedValue.note;
          noteCount += 1;
        } else {
          noteRemovals.push(noteKey);
        }
        const tag = tagManager?.getTagObject?.(entry.label, entry.scopeKey);
        if (tag?.tagObj && typeof tagManager.updateTagText === 'function') {
          tagManager.updateTagText(entry.label, entry.scopeKey);
        }
      } else {
        failures.push(
          `${entry.viewTitle} · ${entry.label}: could not read value "${entry.valueText}"`
        );
      }
    } catch (error) {
      failures.push(`${entry.viewTitle} · ${entry.label}: ${(error as Error).message}`);
    }
  });

  // Customer notes (e.g. "(13\" to floor)") are stored alongside the value in
  // project metadata, never inside the numeric measurement record.
  if (
    projectManager?.setProjectMetadata &&
    (Object.keys(noteChanges).length || noteRemovals.length)
  ) {
    try {
      const current = projectManager.getProjectMetadata?.()?.measurementNotes || {};
      const next = { ...current };
      Object.entries(noteChanges).forEach(([key, value]) => {
        next[key] = value;
      });
      noteRemovals.forEach(key => {
        delete next[key];
      });
      projectManager.setProjectMetadata({ measurementNotes: next });
    } catch (error) {
      console.warn('[Measurement Check] Could not store measurement notes:', error);
    }
  }

  try {
    app?.projectManager?.saveCurrentViewState?.();
  } catch {
    // The mutated event already marked the project dirty; a later save
    // persists the remaining views' buckets.
  }

  return { saved, updated, failures, noteCount, plan };
}

// ── Review manifest (round-trips through parseSofaPaintReviewPdf) ────

export function buildCheckReviewManifest(
  resolved: { title: string; pages: ResolvedCheckPage[] },
  unit?: 'inch' | 'cm' | null
) {
  return {
    version: 1 as const,
    projectName: resolved.title,
    ...(unit === 'inch' || unit === 'cm' ? { unit } : {}),
    views: resolved.pages.map(page => ({
      viewId: page.viewId,
      title: page.title || page.viewId,
      measurements: page.rows.map(row => ({ label: row.label, value: row.value })),
    })),
  };
}

// ── Show-only visibility (reversible, object-level only) ─────────────

// One stable key per measurement: the stroke label ties together the line
// object (arrowheads painted by ArrowManager on the same object), its tag,
// connector lines, and the stored value.
export function getCheckObjectStrokeLabel(obj: any): string {
  const sources = [
    obj?.strokeMetadata?.strokeLabel,
    obj?.strokeMetadata?.label,
    obj?.customData?.strokeLabel,
    obj?.customData?.label,
    obj?.strokeLabel,
    obj?.label,
    obj?.connectedStroke?.strokeMetadata?.strokeLabel,
    obj?.connectedStroke?.strokeMetadata?.label,
    obj?.connectedStroke?.customData?.strokeLabel,
    obj?.connectedStroke?.customData?.label,
    obj?.connectorLine?.strokeLabel,
    obj?.connectorLine?.strokeMetadata?.strokeLabel,
  ];
  const value = sources.find(source => String(source || '').trim());
  return value ? String(value).trim() : '';
}

function isCheckLabeledMeasurementObject(obj: any): boolean {
  if (!obj) return false;
  if (getCheckObjectStrokeLabel(obj)) return true;
  return (
    obj.isTag === true ||
    obj.isTagText === true ||
    obj.isTagBackground === true ||
    obj.isTagGroup === true ||
    obj.isConnectorLine === true ||
    Boolean(obj.connectorLine) ||
    Boolean(obj.connectedStroke)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

async function waitForCheckRenderPasses(canvas: any, passes = 2, timeoutMs = 120): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    canvas.requestRenderAll?.();
    await new Promise<void>(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      setTimeout(finish, timeoutMs);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      }
    });
  }
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    await sleep(160);
  }
}

// Snapshot every object's `visible` flag, show only the wanted measurement
// groups, run the callback, and restore in `finally` — project state and the
// persisted visibility maps are never touched.
export async function withOnlyLabelsVisible(
  canvas: any,
  labels: string | Iterable<string> | Set<string>,
  callback: () => any
): Promise<any> {
  const source =
    typeof labels === 'string'
      ? [labels]
      : labels instanceof Set
        ? Array.from(labels)
        : Array.from(labels || []);
  const wanted = new Set(source.filter(Boolean).map(String));
  if (!canvas?.getObjects || wanted.size === 0) {
    return callback();
  }

  const objects = canvas.getObjects();
  const states = new Map(objects.map((obj: any) => [obj, obj.visible !== false]));
  try {
    objects.forEach((obj: any) => {
      if (!isCheckLabeledMeasurementObject(obj)) return;
      const label = getCheckObjectStrokeLabel(obj);
      const shouldShow = wanted.has(label);
      if (typeof obj.set === 'function') obj.set('visible', shouldShow);
      else obj.visible = shouldShow;
    });
    canvas.requestRenderAll?.();
    await waitForCheckRenderPasses(canvas);
    return await callback();
  } finally {
    objects.forEach((obj: any) => {
      const visible = states.get(obj);
      if (typeof visible !== 'boolean') return;
      if (typeof obj.set === 'function') obj.set('visible', visible);
      else obj.visible = visible;
    });
    canvas.requestRenderAll?.();
    await waitForCheckRenderPasses(canvas);
  }
}

// ── Drafting + reply bundles (the one-ZIP loop) ──────────────────────

export interface CheckCapture {
  pageIndex: number;
  viewId: string;
  viewTitle: string;
  scopeKey: string;
  tabId: string | null;
  frameLabel: string;
  codes: string[];
  questionIds: string[];
  pngName: string;
  pngBlob: Blob;
}

export interface BundleFile {
  path: string;
  text?: string;
  blob?: Blob;
}

export interface DraftingBundleInput {
  resolved: ResolvedCheckRequest;
  request: NormalizedCheckRequest;
  captures: CheckCapture[];
  productionNotes?: string;
  catalogue?: unknown;
  notes?: Record<string, string>;
  createdIso?: string;
}

function noteForEntry(
  notes: Record<string, string> | undefined,
  page: ResolvedCheckPage,
  label: string
): string | null {
  if (!notes) return null;
  return (
    notes[`${page.scopeKey}|${label}`] ??
    notes[`${page.viewId}|${label}`] ??
    (page.tabId ? notes[`${page.viewId}::tab:${page.tabId}|${label}`] : undefined) ??
    null
  );
}

function measurementsContext(resolved: ResolvedCheckRequest, notes?: Record<string, string>) {
  return {
    unit: resolved.unit,
    source: 'project',
    projectName: resolved.title,
    pages: resolved.pages.map(page => ({
      viewId: page.viewId,
      frame: page.frameLabel,
      tabId: page.tabId,
      title: page.title,
      questionIds: page.questionIds ?? [],
      rows: page.rows.map(row => ({
        label: row.label,
        value: row.value,
        note: noteForEntry(notes, page, row.label),
      })),
    })),
  };
}

function questionImageMap(resolved: ResolvedCheckRequest, captures: CheckCapture[]) {
  return resolved.pages.map((page, index) => ({
    page: index + 1,
    title: page.title,
    questionIds: page.questionIds ?? [],
    images: captures
      .filter(capture => capture.pageIndex === index)
      .map(capture => `images/${capture.pngName}`),
  }));
}

function replySkeletonText(
  resolved: ResolvedCheckRequest,
  groups: ReturnType<typeof questionImageMap>
): string {
  const lines: string[] = [
    `CUSTOMER REPLY DRAFT — ${resolved.title}`,
    `Unit: ${resolved.unit}. British English. Warm, simple wording (ELI5, not childish).`,
    'One numbered point per question below, ONE sentence per point. Keep each measurement code exactly as written.',
    'Return the numbered points as plain text — do not add extra numbering or lists.',
    '',
  ];
  const questions = resolved.questions ?? [];
  if (questions.length) {
    questions.forEach((question, index) => {
      lines.push(`${index + 1}. ${question.text}`);
      const group = groups.find(entry => entry.questionIds.includes(question.id));
      (group?.images || []).forEach(image => lines.push(`   images: ${image}`));
    });
  } else {
    groups.forEach(group => {
      lines.push(`${group.page}. ${group.title}`);
      group.images.forEach(image => lines.push(`   images: ${image}`));
    });
  }
  return lines.join('\n');
}

export function buildDraftingBundleFiles(input: DraftingBundleInput): BundleFile[] {
  const { resolved, request, captures, productionNotes, catalogue, notes, createdIso } = input;
  const groups = questionImageMap(resolved, captures);
  const files: BundleFile[] = [
    {
      path: 'manifest.json',
      text: JSON.stringify(
        {
          schemaVersion: 1,
          bundleType: 'sofapaint-drafting',
          created: createdIso ?? new Date().toISOString(),
          case: resolved.case ?? null,
          projectName: resolved.title,
          specVersion: resolved.specVersion,
          unit: resolved.unit,
          completeness: 'complete',
          assets: captures.map(capture => ({
            path: `images/${capture.pngName}`,
            questionIds: capture.questionIds,
            codes: capture.codes,
            view: capture.viewId,
            frame: capture.frameLabel,
          })),
        },
        null,
        2
      ),
    },
    { path: 'context/catalogue.json', text: JSON.stringify(catalogue ?? null, null, 2) },
    {
      path: 'context/production.json',
      text: JSON.stringify({ text: productionNotes || '' }, null, 2),
    },
    {
      path: 'context/measurements.json',
      text: JSON.stringify(measurementsContext(resolved, notes), null, 2),
    },
    { path: 'selection/request.json', text: JSON.stringify(request, null, 2) },
    {
      path: 'selection/questions.json',
      text: JSON.stringify({ questions: resolved.questions ?? [], groups }, null, 2),
    },
    { path: 'reply/skeleton.txt', text: replySkeletonText(resolved, groups) },
  ];
  captures.forEach(capture =>
    files.push({ path: `images/${capture.pngName}`, blob: capture.pngBlob })
  );
  return files;
}

// ── Reply draft parsing + validation ─────────────────────────────────

export interface ReplyPoint {
  number: number;
  text: string;
}

// A reply draft is numbered plain text ("1. …", "1) …"); blank lines and
// image references are ignored.
export function parseReplyDraft(text: string): ReplyPoint[] {
  const points: ReplyPoint[] = [];
  (text || '').split(/\r?\n/).forEach(line => {
    const match = /^\s*(\d+)[.)]\s+(.*\S)?\s*$/.exec(line);
    if (!match) return;
    points.push({ number: Number(match[1]), text: (match[2] || '').trim() });
  });
  return points;
}

export function validateReplyDraft(
  points: ReplyPoint[],
  resolved: ResolvedCheckRequest,
  captures: CheckCapture[]
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const questions = resolved.questions ?? [];
  if (!points.length) {
    issues.push('The reply draft has no numbered points (expected lines like "1. …").');
    return { ok: false, issues };
  }
  points.forEach(point => {
    if (!point.text) issues.push(`Point ${point.number} is empty.`);
  });
  if (questions.length && points.length !== questions.length) {
    issues.push(
      `The request defines ${questions.length} question(s) but the draft has ${points.length} point(s) — keep one point per question, in the same order.`
    );
  }
  const duplicateNumbers = points.length !== new Set(points.map(point => point.number)).size;
  if (duplicateNumbers) issues.push('The draft has duplicate point numbers.');
  if (captures.length === 0) issues.push('No measurement images have been captured yet.');
  return { ok: issues.length === 0, issues };
}

function replyHtml(points: ReplyPoint[], imagesByPoint: Record<number, string[]>): string {
  const body = points
    .map(point => {
      const images = (imagesByPoint[point.number] || [])
        .map(image => `<img src="${escapeHtml(image)}" alt="">`)
        .join('');
      return `<p>${escapeHtml(`${point.number}. ${point.text}`)}</p>${images}`;
    })
    .join('\n');
  return `<!doctype html><html><body style="font-family:sans-serif;font-size:14px">${body}</body></html>`;
}

export interface ReplyBundleInput {
  resolved: ResolvedCheckRequest;
  request: NormalizedCheckRequest;
  captures: CheckCapture[];
  points: ReplyPoint[];
  internalNotes?: string;
  createdIso?: string;
}

export function buildReplyBundleFiles(input: ReplyBundleInput): BundleFile[] {
  const { resolved, request, captures, points, internalNotes, createdIso } = input;
  // Point k answers the k-th declared question (or page, for v1 requests).
  const groups = questionImageMap(resolved, captures);
  const imagesByPoint: Record<number, string[]> = {};
  points.forEach((point, index) => {
    const question = (resolved.questions ?? [])[index];
    const group = question
      ? groups.find(entry => entry.questionIds.includes(question.id))
      : groups[index];
    imagesByPoint[point.number] = group ? group.images : [];
  });

  const emailText = points.map(point => `${point.number}. ${point.text}`).join('\n\n');
  const files: BundleFile[] = [
    {
      path: 'reply/manifest.json',
      text: JSON.stringify(
        {
          schemaVersion: 1,
          bundleType: 'sofapaint-reply',
          created: createdIso ?? new Date().toISOString(),
          case: resolved.case ?? null,
          projectName: resolved.title,
          specVersion: resolved.specVersion,
          completeness: captures.every(capture => Boolean(capture.pngBlob))
            ? 'complete'
            : 'missing-images',
          points: points.map(point => {
            const question = (resolved.questions ?? [])[point.number - 1];
            return {
              number: point.number,
              text: point.text,
              questionIds: question ? [question.id] : [],
              images: imagesByPoint[point.number] || [],
            };
          }),
          assets: captures.map(capture => ({ path: `images/${capture.pngName}` })),
        },
        null,
        2
      ),
    },
    { path: 'reply/email.txt', text: `${emailText}\n` },
    { path: 'reply/email.html', text: replyHtml(points, imagesByPoint) },
    { path: 'reply/internal-notes.txt', text: internalNotes || '' },
    { path: 'selection/request.json', text: JSON.stringify(request, null, 2) },
  ];
  captures.forEach(capture =>
    files.push({ path: `images/${capture.pngName}`, blob: capture.pngBlob })
  );
  return files;
}

export async function downloadBundle(files: BundleFile[], filename: string): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  files.forEach(file => {
    if (file.blob) zip.file(file.path, file.blob);
    else zip.file(file.path, file.text ?? '');
  });
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.position = 'fixed';
  anchor.style.left = '-9999px';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 30000);
}

// ── Check sessions (loop memory) ─────────────────────────────────────

export function getCheckSessions(): any[] {
  const app = (window as any).app;
  return app?.projectManager?.getProjectMetadata?.()?.checkSessions ?? [];
}

export function recordCheckSession(session: {
  title: string;
  request: NormalizedCheckRequest;
  imageNames?: string[];
  replyText?: string;
  createdIso?: string;
}): void {
  const app = (window as any).app;
  const projectManager = app?.projectManager;
  if (!projectManager?.setProjectMetadata) return;
  try {
    const sessions = getCheckSessions();
    const entry = {
      title: session.title,
      created: session.createdIso ?? new Date().toISOString(),
      specVersion: session.request.specVersion,
      questions: session.request.questions ?? [],
      pages: session.request.pages.map(page => ({ view: page.view, codes: page.codes })),
      imageNames: session.imageNames ?? [],
      replyText: session.replyText ?? '',
    };
    projectManager.setProjectMetadata({ checkSessions: [entry, ...sessions].slice(0, 10) });
  } catch (error) {
    console.warn('[Measurement Check] Could not record check session:', error);
  }
}

// ── Dialog ───────────────────────────────────────────────────────────

interface DialogState {
  request: NormalizedCheckRequest | null;
  pdfManifest: any;
  replyDraft: { emailText: string; internalNotes: string } | null;
  lastExport: any | null;
}

export function initMeasurementCheckRequest(): void {
  const trigger = document.getElementById('measurementCheckBtn');
  if (!trigger || trigger.dataset.bound === 'true') return;
  trigger.dataset.bound = 'true';

  trigger.addEventListener('click', () => {
    document.getElementById('projectMenuPanel')?.classList.remove('open');
    const state: DialogState = {
      request: null,
      pdfManifest: null,
      replyDraft: null,
      lastExport: null,
    };

    const overlay = document.createElement('div');
    overlay.className = 'measurement-review-overlay';
    overlay.innerHTML = `
      <section class="measurement-review-shell measurement-check-shell" role="dialog" aria-modal="true" aria-label="Measurement check request">
        <header class="measurement-review-header">
          <div><span class="measurement-review-kicker">CUSTOMER CHECKS</span><h2>Measurement check request</h2></div>
          <div class="measurement-review-header-actions">
            <button type="button" data-check-close aria-label="Close">×</button>
          </div>
        </header>
        <div class="measurement-check-body">
          <aside class="measurement-check-inputs">
            <label class="measurement-check-label" for="checkRequestJson">Request JSON</label>
            <textarea id="checkRequestJson" data-check-json spellcheck="false"
              placeholder='{"pages":[{"view":"side","codes":["H1","H2","H3"]}]}'> </textarea>
            <label class="measurement-check-label" for="checkProductionNotes">Production email / notes <span style="text-transform:none;font-weight:400">(optional, goes into the GPT bundle)</span></label>
            <textarea id="checkProductionNotes" data-check-production spellcheck="false" style="min-height:64px"
              placeholder="Paste the Shenzhen email or ticket notes here…"> </textarea>
            <div class="measurement-check-actions">
              <label class="measurement-review-upload">Load .json<input type="file" data-check-file accept="application/json,.json,text/plain" hidden></label>
              <label class="measurement-review-upload measurement-check-secondary" data-check-pdf-label>Load SofaPaint PDF<input type="file" data-check-pdf accept="application/pdf" hidden></label>
            </div>
            <div class="measurement-check-actions">
              <label class="measurement-check-unit" title="Used when PDF values have no unit suffix. Auto reads the unit from the PDF itself.">
                PDF unit
                <select data-check-unit>
                  <option value="auto">Auto</option>
                  <option value="inch">Inches</option>
                  <option value="cm">Centimetres</option>
                </select>
              </label>
              <button type="button" class="measurement-review-upload measurement-check-save" data-check-save-pdf title="Write the loaded PDF's measurement values into this project">Save PDF values to project</button>
            </div>
            <button type="button" class="measurement-review-upload measurement-check-secondary" data-check-catalog>Copy views &amp; codes JSON</button>
            <p class="measurement-check-hint">
              A request names views and measurement codes. Use the catalogue button to copy
              the valid view ids and codes for this project, then edit — e.g.
              <code>{"pages":[{"view":"side","codes":["H1","H2"]}]}</code>
            </p>
          </aside>
          <main class="measurement-check-main" data-check-report>
            <div class="measurement-review-empty">Paste a request, then press Validate.</div>
          </main>
        </div>
        <footer class="measurement-check-footer">
          <span class="measurement-check-status" data-check-status></span>
          <div class="measurement-check-footer-actions">
            <button type="button" data-check-validate>Validate</button>
            <button type="button" data-check-bundle title="Capture the requested views and package request + catalogue + values + images for GPT">Build GPT bundle</button>
            <label class="measurement-check-reply-label" data-check-reply-label title="Load GPT's numbered reply draft (email.txt)">Load reply draft<input type="file" data-check-reply accept=".txt,text/plain" multiple hidden></label>
            <button type="button" class="primary" data-check-reply-export disabled title="Validate the loaded draft and package it with the images">Export reply bundle</button>
            <button type="button" class="primary" data-check-export="png">Export PNG</button>
            <button type="button" class="primary" data-check-export="pdf">Export PDF</button>
            <button type="button" class="primary" data-check-export="zip">Export ZIP</button>
          </div>
        </footer>
      </section>`;
    document.body.appendChild(overlay);

    const report = overlay.querySelector<HTMLElement>('[data-check-report]')!;
    const status = overlay.querySelector<HTMLElement>('[data-check-status]')!;
    const textarea = overlay.querySelector<HTMLTextAreaElement>('[data-check-json]')!;
    const unitSelect = overlay.querySelector('[data-check-unit]') as HTMLSelectElement | null;
    const selectedUnit = (): 'auto' | 'inch' | 'cm' =>
      (unitSelect?.value as 'auto' | 'inch' | 'cm') || 'auto';
    const setStatus = (text: string, isError = false) => {
      status.textContent = text;
      status.classList.toggle('error', isError);
    };

    const parseRequestText = (): NormalizedCheckRequest | null => {
      const text = textarea.value.trim();
      if (!text) {
        setStatus('Paste a request JSON first.', true);
        return null;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        setStatus(`Invalid JSON: ${(error as Error).message}`, true);
        return null;
      }
      const result = parseCheckRequest(raw);
      if (!result.ok) {
        setStatus(result.error || 'The request could not be parsed.', true);
        return null;
      }
      return result.request;
    };

    const runCapture = async (
      request: NormalizedCheckRequest,
      output: Record<string, boolean>,
      onProgress?: (text: string) => void
    ) => {
      const { exportMeasurementCheckRequest } = await import('./pdf-export-inline');
      const result = await exportMeasurementCheckRequest(request, {
        pdfManifest: state.pdfManifest,
        pdfUnit: selectedUnit(),
        output,
        onProgress,
      });
      state.lastExport = result;
      return result;
    };

    const captureOnly = async (request: NormalizedCheckRequest) =>
      runCapture(request, { png: false, pdf: false, zip: false });

    const renderReport = (resolved: ResolvedCheckRequest) => {
      const pages = resolved.pages
        .map(page => {
          const rows = page.rows
            .map(
              row =>
                `<tr><td>${escapeHtml(row.label)}</td><td>${
                  row.value
                    ? escapeHtml(row.value)
                    : '<span class="measurement-check-no-value">No value entered</span>'
                }</td></tr>`
            )
            .join('');
          const tabNote = page.tabId ? ` · tab ${escapeHtml(page.tabId)}` : '';
          const warnings = [
            page.missingCodes.length
              ? `<div class="measurement-check-issue">Missing on this view: ${escapeHtml(page.missingCodes.join(', '))}</div>`
              : '',
            page.noValueCodes.length
              ? `<div class="measurement-check-issue">No value entered: ${escapeHtml(page.noValueCodes.join(', '))}</div>`
              : '',
          ].join('');
          return `
            <section class="measurement-check-page">
              <header><strong>${escapeHtml(String(page.pageIndex + 1))}. ${escapeHtml(page.title)}</strong>
                <span>${escapeHtml(page.viewId)}${tabNote}</span></header>
              ${page.note ? `<p class="measurement-check-note">${escapeHtml(page.note)}</p>` : ''}
              <table class="measurement-check-table"><thead><tr><th>Code</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
              ${warnings}
            </section>`;
        })
        .join('');
      const issueItems = resolved.issues
        .map(issue => `<div class="measurement-check-issue">${escapeHtml(issue.message)}</div>`)
        .join('');
      report.innerHTML = `
        <div class="measurement-check-summary">${resolved.pages.length} page(s) · ${resolved.pages.reduce((total, page) => total + page.codes.length, 0)} code(s) · unit: ${escapeHtml(resolved.unit)}</div>
        ${pages || '<div class="measurement-review-empty">No pages resolved.</div>'}
        ${issueItems ? `<div class="measurement-check-issues">${issueItems}</div>` : ''}`;
    };

    const renderSaveReport = (plan: PdfValueSavePlan, failures: string[]) => {
      const sections = plan.matchedViews
        .map(view => {
          const rows = plan.entries
            .filter(entry => entry.viewId === view.viewId)
            .map(
              entry =>
                `<tr><td>${escapeHtml(entry.label)}</td><td>${escapeHtml(entry.valueText)}${
                  entry.note
                    ? ` <span class="measurement-check-note-chip">note: ${escapeHtml(entry.note)}</span>`
                    : ''
                }${
                  entry.hadValue ? ' <span class="measurement-check-no-value">· updated</span>' : ''
                }</td></tr>`
            )
            .join('');
          return `
            <section class="measurement-check-page">
              <header><strong>${escapeHtml(view.title)}</strong><span>${escapeHtml(view.viewId)} · ${view.count} value(s) saved</span></header>
              <table class="measurement-check-table"><thead><tr><th>Code</th><th>Value written</th></tr></thead><tbody>${rows}</tbody></table>
            </section>`;
        })
        .join('');
      const warnings = plan.warnings
        .map(warning => `<div class="measurement-check-issue">${escapeHtml(warning)}</div>`)
        .join('');
      const skipped = plan.unmatchedPdfViews
        .map(
          view =>
            `<div class="measurement-check-issue">PDF view "${escapeHtml(view.title)}" (${view.count} value(s)) has no matching project view — nothing was written for it.</div>`
        )
        .join('');
      const failureItems = failures
        .map(failure => `<div class="measurement-check-issue">${escapeHtml(failure)}</div>`)
        .join('');
      report.innerHTML = `
        <div class="measurement-check-summary">Saved to project · ${plan.entries.length} value(s) across ${plan.matchedViews.length} view(s)</div>
        ${sections}
        ${warnings}${skipped}${failureItems}`;
    };

    const renderReportIssues = (issues: string[]) => {
      report.innerHTML = `
        <div class="measurement-check-summary">Reply draft check</div>
        ${issues.map(issue => `<div class="measurement-check-issue">${escapeHtml(issue)}</div>`).join('')}`;
    };

    overlay.addEventListener('click', async event => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target) return;

      if (target.matches('[data-check-close]')) {
        overlay.remove();
        return;
      }

      if (target.matches('[data-check-save-pdf]')) {
        if (!state.pdfManifest) {
          setStatus('Load a SofaPaint PDF first — its values are what gets saved.', true);
          return;
        }
        setStatus('Saving PDF values to the project…');
        try {
          const result = await savePdfValuesToProject(state.pdfManifest, {
            unit: selectedUnit(),
          });
          if (result.cancelled) {
            setStatus('Save cancelled — nothing was written.');
            return;
          }
          if (!result.plan.entries.length) {
            const skipped = result.plan.unmatchedPdfViews.map(view => view.title).join(', ');
            setStatus(
              `No project views matched the PDF${skipped ? ` (PDF views: ${skipped})` : ''}. Load the project the PDF belongs to first.`,
              true
            );
            return;
          }
          renderSaveReport(result.plan, result.failures);
          const perView = result.plan.matchedViews
            .map(view => `${view.title}: ${view.count}`)
            .join(', ');
          const skippedNote = result.plan.unmatchedPdfViews.length
            ? ` Skipped ${result.plan.unmatchedPdfViews.length} PDF view(s) with no matching project view.`
            : '';
          const failureNote = result.failures.length
            ? ` ${result.failures.length} could not be read.`
            : '';
          setStatus(
            `Saved ${result.saved} value(s) into the project (${perView})${result.noteCount ? ` · ${result.noteCount} note(s) kept` : ''}.${skippedNote}${failureNote} Save the project (Ctrl+S) to keep them.`,
            result.failures.length > 0
          );
          window.showStatusMessage?.(
            `Saved ${result.saved} PDF measurement value(s) to the project.`
          );
        } catch (error) {
          console.error('[Measurement Check] Save PDF values failed:', error);
          setStatus(`Could not save PDF values: ${(error as Error).message}`, true);
        }
        return;
      }

      if (target.matches('[data-check-bundle]')) {
        const request = parseRequestText();
        if (!request) return;
        state.request = request;
        const buttons = Array.from(
          overlay.querySelectorAll('.measurement-check-footer-actions button')
        ) as HTMLButtonElement[];
        buttons.forEach(button => (button.disabled = true));
        try {
          setStatus('Capturing views for the GPT bundle…');
          const result = await captureOnly(request);
          const notes =
            (window as any).app?.projectManager?.getProjectMetadata?.()?.measurementNotes || {};
          const files = buildDraftingBundleFiles({
            resolved: result.resolved,
            request: result.request,
            captures: result.captures,
            productionNotes: overlay
              .querySelector<HTMLTextAreaElement>('[data-check-production]')!
              .value?.trim(),
            catalogue: getProjectCheckCatalog(),
            notes,
          });
          const stamp = new Date().toISOString().slice(0, 10);
          await downloadBundle(
            files,
            `drafting-${sanitizeFilenamePart(result.projectName, 'checks')}-${stamp}.zip`
          );
          recordCheckSession({
            title: result.projectName,
            request: result.request,
            imageNames: result.captures.map(capture => capture.pngName),
          });
          const questionCount = result.resolved.questions?.length ?? 0;
          setStatus(
            `GPT bundle ready: ${result.captures.length} image(s), ${questionCount || result.captures.length} point(s), production notes included. Send the ZIP to GPT.`
          );
          window.showStatusMessage?.('GPT drafting bundle downloaded.');
        } catch (error) {
          console.error('[Measurement Check] Bundle failed:', error);
          setStatus(`Bundle failed: ${(error as Error).message}`, true);
        } finally {
          buttons.forEach(
            button =>
              (button.disabled = Boolean(button.dataset.checkReplyExport) && !state.replyDraft)
          );
        }
        return;
      }

      if (target.matches('[data-check-reply-export]')) {
        const draft = state.replyDraft;
        if (!draft) {
          setStatus('Load a reply draft (email.txt) first.', true);
          return;
        }
        const request = parseRequestText();
        if (!request) return;
        state.request = request;
        const buttons = Array.from(
          overlay.querySelectorAll('.measurement-check-footer-actions button')
        ) as HTMLButtonElement[];
        buttons.forEach(button => (button.disabled = true));
        try {
          let result = state.lastExport;
          if (!result) {
            setStatus('Capturing views for the reply bundle…');
            result = await captureOnly(request);
          }
          const points = parseReplyDraft(draft.emailText);
          const validation = validateReplyDraft(points, result.resolved, result.captures);
          if (!validation.ok) {
            renderReportIssues(validation.issues);
            setStatus(`Reply draft needs attention: ${validation.issues[0]}`, true);
            return;
          }
          const files = buildReplyBundleFiles({
            resolved: result.resolved,
            request: result.request,
            captures: result.captures,
            points,
            internalNotes: draft.internalNotes,
          });
          const stamp = new Date().toISOString().slice(0, 10);
          await downloadBundle(
            files,
            `reply-${sanitizeFilenamePart(result.projectName, 'checks')}-${stamp}.zip`
          );
          recordCheckSession({
            title: result.projectName,
            request: result.request,
            imageNames: result.captures.map(capture => capture.pngName),
            replyText: draft.emailText,
          });
          setStatus(
            `Reply bundle ready: ${points.length} point(s), ${result.captures.length} image(s) with real bytes. Attach the ZIP contents in Gorgias.`
          );
          window.showStatusMessage?.('Reply bundle downloaded.');
        } catch (error) {
          console.error('[Measurement Check] Reply bundle failed:', error);
          setStatus(`Reply bundle failed: ${(error as Error).message}`, true);
        } finally {
          buttons.forEach(
            button =>
              (button.disabled = Boolean(button.dataset.checkReplyExport) && !state.replyDraft)
          );
        }
        return;
      }

      if (target.matches('[data-check-catalog]')) {
        const catalog = JSON.stringify(getProjectCheckCatalog(), null, 2);
        try {
          await navigator.clipboard.writeText(catalog);
          setStatus('Views and codes copied — paste into an editor to build a request.');
        } catch {
          textarea.value = catalog;
          setStatus('Clipboard unavailable; catalogue placed in the JSON box instead.');
        }
        return;
      }

      if (target.matches('[data-check-validate]')) {
        const request = parseRequestText();
        if (!request) {
          report.innerHTML =
            '<div class="measurement-review-empty">Fix the request JSON and validate again.</div>';
          return;
        }
        state.request = request;
        const resolved = resolveCheckRequest(
          request,
          state.pdfManifest
            ? mergePdfValuesIntoContext(
                buildCheckContextFromApp(),
                state.pdfManifest,
                selectedUnit()
              )
            : buildCheckContextFromApp()
        );
        renderReport(resolved);
        const fatal = resolved.issues.filter(issue =>
          ['unknown-view', 'unknown-tab', 'missing-code'].includes(issue.kind)
        );
        setStatus(
          fatal.length
            ? `${fatal.length} unresolved item(s) — fix them before exporting.`
            : `Resolved ${resolved.pages.length} page(s). Ready to export.`
        );
        return;
      }

      const exportMode = target.dataset.checkExport;
      if (exportMode) {
        const request = parseRequestText();
        if (!request) return;
        state.request = request;
        const outputByMode: Record<string, Record<string, boolean>> = {
          png: { png: true, pdf: false, zip: false },
          pdf: { png: false, pdf: true, zip: false },
          zip: { png: true, pdf: true, zip: true },
        };
        const buttons = Array.from(
          overlay.querySelectorAll('.measurement-check-footer-actions button')
        ) as HTMLButtonElement[];
        buttons.forEach(button => (button.disabled = true));
        setStatus('Exporting…');
        try {
          const { exportMeasurementCheckRequest } = await import('./pdf-export-inline');
          const result = await exportMeasurementCheckRequest(request, {
            pdfManifest: state.pdfManifest,
            pdfUnit: selectedUnit(),
            output: outputByMode[exportMode],
            onProgress: text => setStatus(text),
          });
          const warning = result.issues.length
            ? ` (${result.issues.length} warning(s) — see Validate)`
            : '';
          setStatus(`Exported ${result.pages} page(s)${warning}.`);
          window.showStatusMessage?.(`Measurement check export finished: ${result.pages} page(s).`);
        } catch (error) {
          console.error('[Measurement Check] Export failed:', error);
          setStatus(`Export failed: ${(error as Error).message}`, true);
          window.showStatusMessage?.(
            'Measurement check export failed. See the dialog for details.'
          );
        } finally {
          buttons.forEach(
            button =>
              (button.disabled = Boolean(button.dataset.checkReplyExport) && !state.replyDraft)
          );
        }
      }
    });

    overlay.querySelector('[data-check-file]')?.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        textarea.value = await file.text();
        setStatus(`Loaded ${file.name}. Press Validate.`);
      } catch (error) {
        setStatus(`Could not read ${file.name}: ${(error as Error).message}`, true);
      }
    });

    overlay.querySelector('[data-check-reply]')?.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement;
      const files = Array.from(input.files || []);
      if (!files.length) return;
      try {
        let emailText = '';
        let internalNotes = '';
        await Promise.all(
          files.map(async file => {
            const text = await file.text();
            if (/internal/i.test(file.name)) internalNotes = text;
            else emailText = text;
          })
        );
        state.replyDraft = { emailText, internalNotes };
        const label = overlay.querySelector('[data-check-reply-label]');
        if (label) label.classList.add('loaded');
        const replyButton = overlay.querySelector(
          '[data-check-reply-export]'
        ) as HTMLButtonElement | null;
        if (replyButton) replyButton.disabled = false;
        setStatus(
          `Loaded reply draft (${emailText ? 'email' : 'no email text'}${internalNotes ? ' + internal notes' : ''}). Press "Export reply bundle".`
        );
      } catch (error) {
        setStatus(`Could not read the reply draft: ${(error as Error).message}`, true);
      }
    });

    overlay.querySelector('[data-check-pdf]')?.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        const manifest = await parseSofaPaintReviewPdf(await file.arrayBuffer());
        state.pdfManifest = manifest;
        const viewCount = state.pdfManifest?.views?.length || 0;
        const detected = state.pdfManifest?.unit;
        const unitNote = detected
          ? `, unit: ${detected === 'inch' ? 'inches' : 'centimetres'}`
          : ' — set PDF unit if values are bare numbers';
        const label = overlay.querySelector('[data-check-pdf-label]');
        if (label) label.classList.add('loaded');
        setStatus(
          `Loaded values from ${file.name} (${viewCount} view(s)${unitNote}). Validate to apply them.`
        );
      } catch (error) {
        console.error('[Measurement Check] PDF import failed:', error);
        setStatus('This PDF could not be read. Try a SofaPaint PDF.', true);
      }
    });

    // Show recent check sessions so a follow-up cycle can pick up where the
    // last one left off.
    const sessions = getCheckSessions();
    if (sessions.length) {
      report.innerHTML = `
        <div class="measurement-check-summary">Recent check sessions</div>
        ${sessions
          .map(
            session => `
              <div class="measurement-check-session">
                <strong>${escapeHtml(String(session.title || 'Untitled'))}</strong>
                <span>${escapeHtml(String(session.created || ''))} · ${(session.questions || []).length} question(s) · ${(session.imageNames || []).length} image(s)</span>
              </div>`
          )
          .join('')}
        <div class="measurement-review-empty">Paste a request to start a new session.</div>`;
    }
  });
}
