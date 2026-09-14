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

// ── Request schema (spec v1) ─────────────────────────────────────────

export const checkRequestSchema = z.object({
  specVersion: z.literal(1).optional(),
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
  pages: z
    .array(
      z.object({
        view: z.string().min(1).max(180),
        tab: z.union([z.string().max(120), z.number().int().min(0)]).optional(),
        codes: z.array(z.string().min(1).max(40)).min(1).max(60),
        title: z.string().max(160).optional(),
        note: z.string().max(300).optional(),
      })
    )
    .min(1)
    .max(100),
});

export type CheckRequestInput = z.infer<typeof checkRequestSchema>;

export interface NormalizedCheckRequest {
  title?: string;
  unit: 'as-entered' | 'cm' | 'inch';
  output: { png: boolean; pdf: boolean; zip: boolean; scale: number };
  pages: Array<{
    view: string;
    tab?: string | number;
    codes: string[];
    title?: string;
    note?: string;
  }>;
}

export function normalizeCheckRequest(parsed: CheckRequestInput): NormalizedCheckRequest {
  return {
    title: parsed.title,
    unit: parsed.unit || 'as-entered',
    output: {
      png: parsed.output?.png ?? true,
      pdf: parsed.output?.pdf ?? true,
      zip: parsed.output?.zip ?? false,
      scale: parsed.output?.scale ?? 2,
    },
    pages: (parsed.pages || []).map(page => ({
      view: page.view,
      tab: page.tab,
      codes: page.codes.map(code => code.trim().toUpperCase()),
      title: page.title,
      note: page.note,
    })),
  };
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
  kind: 'unknown-view' | 'unknown-tab' | 'missing-code' | 'no-value' | 'ambiguous-value';
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
  codes: string[];
  rows: CheckRow[];
  missingCodes: string[];
  noValueCodes: string[];
}

export interface ResolvedCheckRequest {
  title: string;
  unit: 'as-entered' | 'cm' | 'inch';
  output: { png: boolean; pdf: boolean; zip: boolean; scale: number };
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

    const preferredTabId = resolvePageTab(view, page.tab, issues, pageIndex);
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

    // Capture target: explicit tab wins, else the scope holding the codes
    // (base scope ⇒ null so the view captures with its default tab).
    const allScope = orderedScopes.find(scope =>
      page.codes.every(code => scope.codes.includes(code))
    );
    const anyScope = orderedScopes.find(scope =>
      page.codes.some(code => scope.codes.includes(code))
    );
    const tabId = preferredTabId ?? (allScope || anyScope)?.tabId ?? null;

    pages.push({
      pageIndex,
      viewId: view.viewId,
      title: page.title || view.title,
      note: page.note,
      tabId,
      codes: [...page.codes],
      rows,
      missingCodes,
      noValueCodes,
    });
  });

  return {
    title: request.title || context.projectName || 'Measurement checks',
    unit: request.unit,
    output: request.output,
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
    specVersion: 1,
    hint: 'Pick views + codes into a request: {"pages":[{"view":"<viewId>","codes":["…"]}]}',
    views: context.views.map(view => ({
      viewId: view.viewId,
      title: view.title,
      hasImage: view.hasImage,
      codes: Array.from(new Set(view.scopes.flatMap(scope => scope.codes))).sort(naturalCompare),
    })),
  };
}

// ── SofaPaint PDF value refresh ──────────────────────────────────────

// Parse "52 cm" / "38 in" / "1.5"" into a synthetic measurement so unit
// conversion still works when the PDF value has no stroke behind it.
function measurementFromEnteredText(text: string): CheckMeasurementLike {
  const match = /^([\d.]+)\s*(cm|in|inch|inches|")?$/i.exec((text || '').trim());
  if (!match) return { inputValue: text };
  const amount = Number(match[1]);
  const suffix = (match[2] || '').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return { inputValue: text };
  if (suffix === 'cm') return { cm: amount, inputValue: text };
  if (suffix && suffix !== 'cm') return { inch: amount, inputUnit: 'inches', inputValue: text };
  return { inputValue: text };
}

// Merge values from a received SofaPaint PDF (via parseSofaPaintReviewPdf)
// into the project context so validation + exports use the PDF values.
export function mergePdfValuesIntoContext(context: CheckContext, pdfManifest: any): CheckContext {
  if (!pdfManifest?.views?.length) return context;
  const views = context.views.map(view => {
    const pdfView =
      pdfManifest.views.find((v: any) => v.viewId === view.viewId) ||
      pdfManifest.views.find((v: any) => fieldPart(v.viewId) === fieldPart(view.viewId)) ||
      pdfManifest.views.find(
        (v: any) => String(v.title || '').toLowerCase() === view.title.toLowerCase()
      );
    if (!pdfView) return view;

    const scopes: CheckContextScope[] = view.scopes.map(scope => ({
      ...scope,
      codes: [...scope.codes],
      measurements: { ...scope.measurements },
    }));
    const baseScope = scopes.find(scope => scope.scopeKey === view.viewId) || scopes[0];

    (pdfView.measurements || []).forEach((row: any) => {
      const value = String(row?.value ?? '').trim();
      if (!value || !row?.label) return;
      const label = String(row.label);
      const target = scopes.find(scope => scope.measurements[label]) || baseScope;
      if (!target) return;
      const existing = target.measurements[label];
      const parsed = measurementFromEnteredText(value);
      target.measurements[label] = existing
        ? { ...existing, ...parsed, inputValue: value }
        : { ...parsed, inputValue: value };
      if (!target.codes.includes(label)) target.codes.push(label);
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
}

export interface PdfValueSavePlan {
  entries: PdfValueSaveEntry[];
  matchedViews: Array<{ viewId: string; title: string; count: number }>;
  unmatchedPdfViews: Array<{ viewId: string; title: string; count: number }>;
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
// fieldPart-normalized id, then case-insensitive title. Values land on the
// scope that already knows the label (base scope preferred), else the view's
// base scope — no stroke geometry is invented for labels the project lacks.
export function planPdfValueSaves(context: CheckContext, pdfManifest: any): PdfValueSavePlan {
  const plan: PdfValueSavePlan = { entries: [], matchedViews: [], unmatchedPdfViews: [] };
  if (!pdfManifest?.views?.length) return plan;

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

    const scopes: CheckContextScope[] = view.scopes.length
      ? view.scopes
      : [{ scopeKey: view.viewId, tabId: null, codes: [], measurements: {} }];

    rows.forEach((row: any) => {
      const label = String(row.label);
      const valueText = String(row.value).trim();
      const withLabel = scopes.filter(scope => scope.codes.includes(label));
      const baseScope = scopes.find(scope => scope.scopeKey === view.viewId);
      const target =
        withLabel.find(scope => scope.tabId === null) || withLabel[0] || baseScope || scopes[0];
      plan.entries.push({
        viewId: view.viewId,
        viewTitle: view.title,
        scopeKey: target.scopeKey,
        label,
        valueText,
        hadValue: view.scopes.some(scope => measurementHasValue(scope.measurements[label])),
      });
    });
    plan.matchedViews.push({ viewId: view.viewId, title: view.title, count: rows.length });
  });

  return plan;
}

// Write a planned PDF manifest's values into the project's measurement
// records using the same path the CW import uses (parseMeasurementInput →
// setMeasurement), refreshing existing tag text. Values land in the live
// project state; the next project save persists every view.
export async function savePdfValuesToProject(
  pdfManifest: any,
  { confirmOverwrite = true } = {}
): Promise<{
  cancelled?: boolean;
  saved: number;
  updated: number;
  failures: string[];
  plan: PdfValueSavePlan;
}> {
  const app = (window as any).app;
  const metadata = app?.metadataManager;
  if (!metadata) throw new Error('No project is open.');

  const plan = planPdfValueSaves(buildCheckContextFromApp(), pdfManifest);
  const updated = plan.entries.filter(entry => entry.hadValue).length;
  if (!plan.entries.length) {
    return { saved: 0, updated: 0, failures: [], plan };
  }
  if (confirmOverwrite && updated > 0) {
    const proceed = window.confirm(
      `This will write ${plan.entries.length} measurement value(s) into the project — ` +
        `${updated} of them overwrite value(s) that already exist. Continue?`
    );
    if (!proceed) return { cancelled: true, saved: 0, updated, failures: [], plan };
  }

  const measurementSystem = app?.measurementSystem;
  const tagManager = app?.tagManager;
  const failures: string[] = [];
  let saved = 0;

  plan.entries.forEach(entry => {
    const text = entry.valueText.trim();
    try {
      let applied = false;
      const isCm = /cm\s*$/i.test(text);
      const hasInchMarker = /(?:in|inch|inches|")\s*$/i.test(text);
      const unit = isCm || !hasInchMarker ? 'cm' : 'inches';
      const parsed = measurementSystem?.parseMeasurementInput?.(text, unit);
      if (parsed) {
        measurementSystem.setMeasurement(
          entry.scopeKey,
          entry.label,
          parsed.inchWhole,
          parsed.inchFraction,
          {
            cmValue: parsed.cm,
            inchValue: parsed.totalInches,
            inputUnit: parsed.inputUnit === 'inches' ? 'inches' : 'cm',
          }
        );
        applied = true;
      } else if (typeof metadata.parseAndSaveMeasurement === 'function') {
        applied = Boolean(metadata.parseAndSaveMeasurement(entry.scopeKey, entry.label, text));
      }
      if (applied) {
        saved += 1;
        const tag = tagManager?.getTagObject?.(entry.label, entry.scopeKey);
        if (tag?.tagObj && typeof tagManager.updateTagText === 'function') {
          tagManager.updateTagText(entry.label, entry.scopeKey);
        }
      } else {
        failures.push(`${entry.viewTitle} · ${entry.label}: could not read value "${text}"`);
      }
    } catch (error) {
      failures.push(`${entry.viewTitle} · ${entry.label}: ${(error as Error).message}`);
    }
  });

  try {
    app?.projectManager?.saveCurrentViewState?.();
  } catch {
    // The mutated event already marked the project dirty; a later save
    // persists the remaining views' buckets.
  }

  return { saved, updated, failures, plan };
}

// ── Review manifest (round-trips through parseSofaPaintReviewPdf) ────

export function buildCheckReviewManifest(resolved: { title: string; pages: ResolvedCheckPage[] }) {
  return {
    version: 1 as const,
    projectName: resolved.title,
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

// ── Dialog ───────────────────────────────────────────────────────────

interface DialogState {
  request: NormalizedCheckRequest | null;
  pdfManifest: any;
}

export function initMeasurementCheckRequest(): void {
  const trigger = document.getElementById('measurementCheckBtn');
  if (!trigger || trigger.dataset.bound === 'true') return;
  trigger.dataset.bound = 'true';

  trigger.addEventListener('click', () => {
    document.getElementById('projectMenuPanel')?.classList.remove('open');
    const state: DialogState = { request: null, pdfManifest: null };

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
            <div class="measurement-check-actions">
              <label class="measurement-review-upload">Load .json<input type="file" data-check-file accept="application/json,.json,text/plain" hidden></label>
              <label class="measurement-review-upload measurement-check-secondary" data-check-pdf-label>Load SofaPaint PDF<input type="file" data-check-pdf accept="application/pdf" hidden></label>
            </div>
            <button type="button" class="measurement-review-upload measurement-check-save" data-check-save-pdf title="Write the loaded PDF's measurement values into this project">Save PDF values to project</button>
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
      const result = checkRequestSchema.safeParse(raw);
      if (!result.success) {
        const first = result.error.issues
          .map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`)
          .slice(0, 3)
          .join('; ');
        setStatus(`Request does not match the spec: ${first}`, true);
        return null;
      }
      return normalizeCheckRequest(result.data);
    };

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
        ${skipped}${failureItems}`;
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
          const result = await savePdfValuesToProject(state.pdfManifest);
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
            `Saved ${result.saved} value(s) into the project (${perView}).${skippedNote}${failureNote} Save the project (Ctrl+S) to keep them.`,
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
            ? mergePdfValuesIntoContext(buildCheckContextFromApp(), state.pdfManifest)
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
          buttons.forEach(button => (button.disabled = false));
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

    overlay.querySelector('[data-check-pdf]')?.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        const manifest = await parseSofaPaintReviewPdf(await file.arrayBuffer());
        state.pdfManifest = manifest;
        const viewCount = state.pdfManifest?.views?.length || 0;
        const label = overlay.querySelector('[data-check-pdf-label]');
        if (label) label.classList.add('loaded');
        setStatus(
          `Loaded values from ${file.name} (${viewCount} view(s)). Validate to apply them.`
        );
      } catch (error) {
        console.error('[Measurement Check] PDF import failed:', error);
        setStatus('This PDF could not be read. Try a SofaPaint PDF.', true);
      }
    });
  });
}
