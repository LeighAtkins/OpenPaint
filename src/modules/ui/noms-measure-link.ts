// NOMS measurement link (Comfort Works staff only).
//
// A project opened from a NOMS order (OMNOMS "Open in SofaPaint") remembers its
// order and CW40 measure form in project metadata (externalSources.nomsOrders).
// This panel shows that form's measurements, lets each image be linked to one
// form model, adds the CW40 diagram for a model as an image with editable lines,
// puts the same lines on a photo, and keeps the values in step: a value typed
// here goes onto every linked line with that letter, and a value changed on a
// line comes back here. A dropped PDF (CW form or SofaPaint check request)
// fills every letter it can and flags the rest. "Send to NOMS" writes the form
// through OMNOMS, using the person's own CW40 sign-in in this browser
// (SofaPaint's server is never involved), then makes the customer's PDF in cm
// for the SZ email and shows a summary to copy.

import { authService } from '../../services/auth/authService';
import { imageRegistry } from '../ImageRegistry.js';
import { notifyOpenPaint } from './notification-center';
import { setNextTagValue } from './next-tag-control';
import {
  importSvgMeasurements,
  stripSvgLabels,
  waitForGuideImportReady,
} from './measurement-guide-flash.js';
import {
  importCwFormPdf,
  isPdfFile,
  loadPdfjs,
  rangeKey,
  readCwFormPdfValues,
  rememberMeasurementNote,
  type CwFormValueGroup,
} from './cw-form-pdf-import';
import { formatCustomerNumber, RANGE_DEFAULT } from '../utils/customer-value';
import { parseSofaPaintReviewPdf } from './measurement-review';
import {
  convertPdfToCm,
  loadOrderPdfs,
  mergeCmPdfs,
  saveOrderPdfs,
  scanPdfText,
  type PdfUnit,
  type StoredOrderPdfs,
} from './pdf-cm-convert';
import {
  agoText,
  classifyDropResult,
  cmPdfFileName,
  conflictingDrift,
  convertValues,
  cwGroupsToDropValues,
  dropFlagLines,
  dropNumber,
  formDrift,
  liveDropReview,
  reviewToDropValues,
  szSummaryText,
  type DropReview,
  type DropValue,
  type FormDrift,
  autoMapping,
  changedFields,
  convertMeasure,
  defaultFieldFor,
  formModels,
  modelGroups,
  refineTargets,
  fromCanvasMeasurement,
  formToTyped,
  hasMeasure,
  isComfortWorksStaff,
  lineLinkKey,
  resolveLineForLetter,
  suggestLineLinks,
  type LetterLines,
  type LineLink,
  type LineLinks,
  type MeasuredLine,
  pickInputUnit,
  refreshLineTag,
  typedToForm,
  type InputUnit,
  measureIssues,
  parseMeasure,
  soleModelForReference,
  toCentimetres,
  type NomsFormContent,
  type NomsModelEntry,
} from './noms-link-core';

type Values = Record<string, Record<string, string>>;
interface NomsOrderEntry {
  orderNumber: string;
  formId: string;
  lang: string;
  customerName?: string;
  productName?: string;
  productSku?: string;
  unit: 'in' | 'cm';
  confirmed: boolean;
  values: Values;
  viewBindings: Record<string, string>;
  diagramViews: Record<string, string>;
  /** "product:model:file:LETTER" -> the drawn line that feeds that letter, whatever its label. */
  lineLinks?: LineLinks;
  lastSyncedAt?: string;
  /** The form as last read from NOMS (form unit), and when. */
  formSnapshot?: Values;
  snapshotAt?: string;
  /** Send without the flagged-values question for this order. */
  skipFlagConfirm?: boolean;
  /** The PDF drop being reviewed: values read, the form before, range picks. */
  dropReview?: StoredDropReview;
  cmPdfName?: string;
  lastSentAt?: string;
}
interface StoredDropReview {
  at: string;
  values: DropValue[];
  before: Values;
  picks: Record<string, number>;
}
interface BridgeReply {
  ok: boolean;
  data?: any;
  error?: string;
  signIn?: string;
}

const PANEL_ID = 'nomsMeasureLinkPanel';
const NOMS = 'https://noms.comfort-works.com';
const REQUEST_SOURCE = 'sofapaint-noms';
const REPLY_SOURCE = 'omnoms-noms';
/** localStorage key: the unit a person types in, remembered per browser. */
const INPUT_UNIT_KEY = 'nomsLinkInputUnit';

const state: {
  order: string;
  content: NomsFormContent | null;
  models: NomsModelEntry[];
  values: Values;
  saved: Values;
  unit: 'in' | 'cm';
  confirmed: boolean;
  loading: boolean;
  status: string;
  statusKind: 'info' | 'error' | 'ok';
  signIn: string;
  canvasSnapshot: Map<string, string>;
  collapsed: boolean;
  /** File names of PDFs being read right now, '' when idle. */
  reading: string;
  /** Inputs filled from a PDF, lit until highlightUntil. */
  highlight: Set<string>;
  highlightUntil: number;
  /** Show only flagged rows of the drop review. */
  onlyFlagged: boolean;
  /** Tick beside Send: confirm the form on NOMS as well. */
  confirmTick: boolean | null;
  /** Send to NOMS progress, one line per step. */
  progress: Array<{ text: string; kind: 'run' | 'ok' | 'error' | 'skip' }>;
  sending: boolean;
  /** NOMS changed letters since the panel read them; the person picks a side. */
  drift: { items: FormDrift[]; fresh: Values; at: string } | null;
  /** PDFs dropped this session (bytes kept for the cm copy). */
  originals: StoredOrderPdfs['originals'];
  /** CW form diagrams of the last drop, for "Change matching". */
  lastGroups: CwFormValueGroup[];
} = {
  order: '',
  content: null,
  models: [],
  values: {},
  saved: {},
  unit: 'in',
  confirmed: false,
  loading: false,
  status: '',
  statusKind: 'info',
  signIn: '',
  canvasSnapshot: new Map(),
  collapsed: false,
  reading: '',
  highlight: new Set(),
  highlightUntil: 0,
  onlyFlagged: false,
  confirmTick: null,
  progress: [],
  sending: false,
  drift: null,
  originals: [],
  lastGroups: [],
};
let initialized = false;
let requestCounter = 0;
const pending = new Map<string, (reply: BridgeReply) => void>();

// ---------------------------------------------------------------- app access
const app = (): any => (window as any).app || {};
const projectManager = (): any => app().projectManager;
const metadataManager = (): any => app().metadataManager;
const currentViewId = (): string => String(projectManager()?.currentViewId || '').trim();
const baseView = (scope: string): string => String(scope || '').split('::')[0];

function orders(): Record<string, NomsOrderEntry> {
  return projectManager()?.getProjectMetadata?.()?.externalSources?.nomsOrders || {};
}
function entry(): NomsOrderEntry | null {
  return state.order ? orders()[state.order] || null : null;
}
function patchEntry(patch: Partial<NomsOrderEntry>): void {
  const manager = projectManager();
  if (!manager?.setProjectMetadata || !state.order) return;
  const metadata = manager.getProjectMetadata() || {};
  const all = metadata.externalSources?.nomsOrders || {};
  if (!all[state.order]) return;
  manager.setProjectMetadata({
    externalSources: {
      ...(metadata.externalSources || {}),
      nomsOrders: { ...all, [state.order]: { ...all[state.order], ...patch } },
    },
  });
  window.dispatchEvent(new CustomEvent('openpaint:project-dirty', { detail: { source: 'noms' } }));
}
/**
 * The unit the boxes are typed in: the choice remembered in this browser, else
 * the form's unit. Values are always kept and saved in the form's unit.
 */
function inputUnit(): InputUnit {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(INPUT_UNIT_KEY);
  } catch {
    stored = null;
  }
  return pickInputUnit(stored, state.unit);
}
function setInputUnit(unit: InputUnit): void {
  try {
    localStorage.setItem(INPUT_UNIT_KEY, unit);
  } catch {
    // Private mode or storage full: the choice lasts for this page only.
  }
  render();
}
/** True when there are lines for this letter and none has a number. */
function linesLackValue(lines: MeasuredLine[]): boolean {
  return lines.length > 0 && lines.every(line => !line.value);
}
function staff(): boolean {
  // Local development only: localStorage.nomsLinkDevStaff = '1' on localhost.
  if (location.hostname === 'localhost' && localStorage.getItem('nomsLinkDevStaff') === '1')
    return true;
  return isComfortWorksStaff(authService.getCurrentUser());
}

// ---------------------------------------------------------------- OMNOMS bridge
function bridgeAvailable(): boolean {
  return document.documentElement.dataset.omnomsNomsBridge === '1';
}
function ask(
  action: string,
  payload: Record<string, unknown>,
  timeoutMs = 30000
): Promise<BridgeReply> {
  return new Promise(resolve => {
    if (!bridgeAvailable()) {
      resolve({
        ok: false,
        error:
          'OMNOMS is not running in this browser. Install OMNOMS 1.3 or later, then open this project from the NOMS measurements page.',
      });
      return;
    }
    requestCounter += 1;
    const requestId = `noms-${Date.now()}-${requestCounter}`;
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, error: 'OMNOMS did not answer. Reload this page and try again.' });
    }, timeoutMs);
    pending.set(requestId, reply => {
      window.clearTimeout(timer);
      resolve(reply);
    });
    window.postMessage(
      { source: REQUEST_SOURCE, type: 'NOMS_REQUEST', requestId, action, ...payload },
      window.location.origin
    );
  });
}
function onBridgeMessage(event: MessageEvent): void {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (data?.source !== REPLY_SOURCE || data.type !== 'NOMS_RESPONSE') return;
  const resolve = pending.get(String(data.requestId || ''));
  if (!resolve) return;
  pending.delete(String(data.requestId));
  resolve({ ok: Boolean(data.ok), data: data.data, error: data.error, signIn: data.signIn });
}

// ---------------------------------------------------------------- canvas sync
function strokeScopesFor(viewId: string, field: string): string[] {
  const strokes = metadataManager()?.vectorStrokesByImage || {};
  return Object.keys(strokes).filter(
    scope => baseView(scope) === viewId && strokes[scope]?.[field]
  );
}
function viewsForModel(key: string): string[] {
  const current = entry();
  if (!current) return [];
  const views = new Set<string>();
  for (const [viewId, bound] of Object.entries(current.viewBindings || {})) {
    if (bound === key && projectManager()?.views?.[viewId]) views.add(viewId);
  }
  const diagram = current.diagramViews?.[key];
  if (diagram && projectManager()?.views?.[diagram]) views.add(diagram);
  return Array.from(views);
}
/** Every drawn line in the project, with its measurement as form text in the form's unit. */
function allLines(): MeasuredLine[] {
  const strokes = metadataManager()?.vectorStrokesByImage || {};
  const out: MeasuredLine[] = [];
  for (const [scope, labels] of Object.entries(
    strokes as Record<string, Record<string, unknown>>
  )) {
    for (const label of Object.keys(labels || {})) {
      if (!labels[label]) continue;
      out.push({
        viewId: baseView(scope),
        scope,
        label,
        value: fromCanvasMeasurement(metadataManager()?.getMeasurement?.(scope, label), state.unit),
      });
    }
  }
  return out;
}
/** The lines feeding a form letter: its explicit link, else same-label lines on the model's views. */
function letterLines(key: string, field: string, lines: MeasuredLine[] = allLines()): LetterLines {
  return resolveLineForLetter(key, field, entry()?.lineLinks, lines, viewsForModel(key));
}
const lineId = (line: { scope: string; label: string }): string => `${line.scope}|${line.label}`;
function viewTitle(viewId: string): string {
  const labels = projectManager()?.getProjectMetadata?.()?.imagePartLabels || {};
  return String(labels[viewId] || projectManager()?.views?.[viewId]?.name || viewId);
}
/** Bind a form letter to one drawn line (null restores the same-label rule). */
function setLineLink(key: string, field: string, link: LineLink | null): void {
  const current = entry();
  if (!current) return;
  const lineLinks: LineLinks = { ...(current.lineLinks || {}) };
  const id = lineLinkKey(key, field);
  if (link) lineLinks[id] = link;
  else delete lineLinks[id];
  patchEntry({ lineLinks });
  for (const seen of Array.from(state.canvasSnapshot.keys()))
    if (seen.endsWith(`|${field}`) || (link && seen.endsWith(`|${link.label}`)))
      state.canvasSnapshot.delete(seen);
  if (!link) {
    pushToLines(key, field);
    setStatus(`${field} follows lines labelled ${field} again.`, 'info');
    return;
  }
  const lines = letterLines(key, field).lines;
  const onLine = lines.map(line => line.value).find(Boolean) || '';
  const inBox = state.values[key]?.[field] ?? '';
  if (onLine) {
    // The point of linking is to use the drawn measurement.
    setValue(key, field, onLine, lineId(lines[0]));
    for (const line of lines) state.canvasSnapshot.set(lineId(line), line.value);
    setStatus(
      `${field} now follows ${viewTitle(link.viewId)} ${link.label} (${onLine} ${state.unit})` +
        (inBox && inBox !== onLine ? `. The form had ${inBox} ${state.unit}.` : '.'),
      'ok'
    );
  } else {
    pushToLines(key, field);
    setStatus(`${field} now follows ${viewTitle(link.viewId)} ${link.label}.`, 'ok');
  }
}
function writeLine(scope: string, field: string, value: string): void {
  const measurementSystem = app().measurementSystem;
  const cm = toCentimetres(value, state.unit);
  if (!measurementSystem?.setMeasurement || cm === null || cm <= 0) return;
  const inches = cm / 2.54;
  const whole = Math.floor(inches);
  measurementSystem.setMeasurement(scope, field, whole, inches - whole, {
    cmValue: cm,
    inchValue: inches,
    inputUnit: state.unit === 'cm' ? 'cm' : 'inches',
  });
  // The list re-reads the measurement by itself; the canvas label does not.
  refreshLineTag(app().tagManager, scope, field);
  state.canvasSnapshot.set(`${scope}|${field}`, value);
}
/** Put the panel's value for key/field on every linked line with that letter. */
function pushToLines(key: string, field: string): void {
  const value = state.values[key]?.[field] ?? '';
  for (const line of letterLines(key, field).lines) {
    if (value && line.value !== value) writeLine(line.scope, line.label, value);
    else state.canvasSnapshot.set(lineId(line), line.value);
  }
  metadataManager()?.updateStrokeVisibilityControls?.();
  app().canvasManager?.fabricCanvas?.requestRenderAll?.();
}
function pushAll(): void {
  for (const model of state.models) for (const field of model.fields) pushToLines(model.key, field);
}
/** Values changed on a line (or a newly drawn line) since the last look. */
function pullFromLines(): boolean {
  let changed = false;
  const lines = allLines();
  for (const model of state.models) {
    for (const field of model.fields) {
      for (const line of letterLines(model.key, field, lines).lines) {
        const id = lineId(line);
        const onLine = line.value;
        const seen = state.canvasSnapshot.get(id);
        // A form value of "0" or text is no measurement: the line's number wins.
        const formHas = hasMeasure(state.values[model.key]?.[field]);
        if (seen === undefined) {
          // A line that has just appeared takes the form's value, if there is one.
          if (!onLine && formHas) writeLine(line.scope, line.label, state.values[model.key][field]);
          else state.canvasSnapshot.set(id, onLine);
          if (onLine && !formHas) {
            setValue(model.key, field, onLine, id);
            changed = true;
          }
          continue;
        }
        if (onLine && onLine !== seen) {
          state.canvasSnapshot.set(id, onLine);
          if (onLine !== state.values[model.key]?.[field]) {
            setValue(model.key, field, onLine, id);
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}
/** `fromLine` is the "scope|label" id of the line the value came from, if any. */
function setValue(key: string, field: string, value: string, fromLine = ''): void {
  state.values = { ...state.values, [key]: { ...(state.values[key] || {}), [field]: value } };
  patchEntry({ values: state.values, unit: state.unit });
  // Copy to the other linked lines, but not back onto the line it came from.
  for (const line of letterLines(key, field).lines) {
    if (lineId(line) !== fromLine && value) writeLine(line.scope, line.label, value);
  }
  metadataManager()?.updateStrokeVisibilityControls?.();
  app().canvasManager?.fabricCanvas?.requestRenderAll?.();
}

// ---------------------------------------------------------------- CW40 form
async function loadForm(options: { preferNoms?: boolean } = {}): Promise<void> {
  const current = entry();
  if (!current) return;
  state.loading = true;
  setStatus('Loading the measure form through OMNOMS…');
  const reply = await ask('load', { formId: current.formId, lang: current.lang });
  state.loading = false;
  if (!reply.ok) {
    state.signIn = reply.signIn || '';
    setStatus(reply.error || 'The measure form could not be loaded.', 'error');
    return;
  }
  state.signIn = '';
  const content = reply.data?.content as NomsFormContent;
  if (String(content?.form_ID) !== current.formId) {
    setStatus('OMNOMS returned a different form. Nothing was changed.', 'error');
    return;
  }
  state.content = content;
  state.models = formModels(content, { includeDisabled: true });
  state.confirmed = Boolean(content.confirmed);
  const formUnit: 'in' | 'cm' = content.unit === 'cm' ? 'cm' : 'in';
  const fromForm: Values = Object.fromEntries(
    state.models.map(model => [model.key, { ...model.values }])
  );
  const local: Values = current.values || {};
  const localInFormUnit: Values = Object.fromEntries(
    Object.entries(local).map(([key, fields]) => [
      key,
      Object.fromEntries(
        Object.entries(fields).map(([f, v]) => [f, convertMeasure(v, current.unit, formUnit)])
      ),
    ])
  );
  const differs = changedFields(fromForm, localInFormUnit).filter(id => {
    const [key, field] = id.split('|');
    return Boolean(localInFormUnit[key]?.[field]);
  });
  const snapshot = current.formSnapshot
    ? convertValues(current.formSnapshot, current.unit, formUnit)
    : null;
  state.unit = formUnit;
  state.saved = fromForm;
  state.drift = null;
  let tookFromNoms: FormDrift[] = [];
  if (options.preferNoms) {
    state.values = fromForm;
  } else if (snapshot) {
    // Letters the person changed since the last read are theirs; letters NOMS
    // changed meanwhile are NOMS's; both changed is asked.
    const drift = formDrift(snapshot, fromForm, localInFormUnit);
    const conflicts = conflictingDrift(drift).filter(d => d.touched);
    tookFromNoms = drift.filter(d => !d.touched);
    state.values = Object.fromEntries(
      state.models.map(model => {
        const mine = localInFormUnit[model.key] || {};
        const was = snapshot[model.key] || {};
        const fields = { ...fromForm[model.key] };
        for (const [field, value] of Object.entries(mine)) {
          const changedHere = (value ?? '') !== (was[field] ?? '');
          const nomsMoved = tookFromNoms.some(d => d.key === model.key && d.field === field);
          if (changedHere && !nomsMoved) fields[field] = value;
        }
        return [model.key, fields];
      })
    );
    if (conflicts.length)
      state.drift = { items: conflicts, fresh: fromForm, at: current.snapshotAt || '' };
  } else if (!differs.length || !current.lastSyncedAt) {
    state.values = fromForm;
  } else {
    // Unsaved SofaPaint values win until the person chooses otherwise.
    state.values = Object.fromEntries(
      state.models.map(model => [
        model.key,
        { ...fromForm[model.key], ...(localInFormUnit[model.key] || {}) },
      ])
    );
  }
  patchEntry({
    values: state.values,
    unit: state.unit,
    confirmed: state.confirmed,
    // Keep the old snapshot while a conflict is open, so it is asked again after a reload.
    ...(state.drift ? {} : { formSnapshot: fromForm, snapshotAt: new Date().toISOString() }),
  });
  state.canvasSnapshot.clear();
  pushAll();
  const unsaved = changedFields(state.saved, state.values);
  const took = tookFromNoms.length
    ? ` Took ${tookFromNoms.length} newer NOMS value${tookFromNoms.length === 1 ? '' : 's'} (${fieldList(tookFromNoms)}).`
    : '';
  setStatus(
    (unsaved.length
      ? `SofaPaint has ${unsaved.length} value${unsaved.length === 1 ? '' : 's'} not saved to NOMS yet.`
      : `In step with NOMS${state.confirmed ? ' (confirmed)' : ''}.`) + took,
    unsaved.length ? 'info' : 'ok'
  );
}

/** "A1, B2" for drift items; the model is named when letters repeat across models. */
function fieldList(items: Array<{ key: string; field: string }>): string {
  const repeated = new Set(items.map(i => i.field).filter((f, i, all) => all.indexOf(f) !== i));
  return items
    .map(i =>
      repeated.has(i.field)
        ? `${state.models.find(m => m.key === i.key)?.title || i.key} ${i.field}`
        : i.field
    )
    .join(', ');
}

/** Settle letters both NOMS and the panel changed: keep the panel's, or take NOMS's. */
function resolveDrift(useNoms: boolean): void {
  const drift = state.drift;
  if (!drift) return;
  if (useNoms) {
    for (const item of drift.items) setValue(item.key, item.field, item.now);
    state.canvasSnapshot.clear();
    pushAll();
  }
  state.drift = null;
  patchEntry({ formSnapshot: drift.fresh, snapshotAt: new Date().toISOString() });
  setStatus(
    useNoms
      ? `Took NOMS's values for ${fieldList(drift.items)}.`
      : `Kept your values for ${fieldList(drift.items)}. Send to NOMS to save them.`,
    'ok'
  );
}

/** Write the panel's values to the CW40 form. Resolves false (with the reason in the status) on failure. */
async function saveForm(confirm: boolean): Promise<boolean> {
  const current = entry();
  if (!current || !state.content) {
    setStatus('Load the form from NOMS first.', 'error');
    return false;
  }
  const bad: string[] = [];
  for (const model of state.models) {
    for (const field of model.fields) {
      if (parseMeasure(state.values[model.key]?.[field] ?? '') === null) bad.push(field);
    }
  }
  if (bad.length) {
    setStatus(`Fix ${bad.join(', ')} first: not a number.`, 'error');
    return false;
  }
  if (confirm) {
    const missing = state.models.flatMap(model =>
      Object.keys(measureIssues(model.rules, state.values[model.key] || {}, state.unit).errors)
    );
    if (missing.length) {
      setStatus(
        `Fill in ${missing.join(', ')} before confirming, or untick Confirm the form.`,
        'error'
      );
      return false;
    }
  }
  setStatus('Saving to NOMS through OMNOMS…');
  const reply = await ask(
    'save',
    {
      formId: current.formId,
      lang: current.lang,
      order: current.orderNumber,
      unit: state.unit,
      values: state.values,
      confirm,
    },
    60000
  );
  if (!reply.ok) {
    state.signIn = reply.signIn || '';
    setStatus(`${reply.error || 'The save failed.'} Your values are still here.`, 'error');
    return false;
  }
  patchEntry({ lastSyncedAt: new Date().toISOString() });
  await loadForm({ preferNoms: true });
  setStatus(`Saved to NOMS${confirm || state.confirmed ? ' and confirmed' : ''}.`, 'ok');
  return true;
}

/** Read the form from NOMS without touching the panel: its values in the panel's unit. */
async function fetchFormValues(): Promise<
  { ok: true; values: Values } | { ok: false; error: string }
> {
  const current = entry();
  if (!current) return { ok: false, error: 'No NOMS order on this project.' };
  const reply = await ask('load', { formId: current.formId, lang: current.lang });
  if (!reply.ok) {
    state.signIn = reply.signIn || '';
    return { ok: false, error: reply.error || 'The measure form could not be read.' };
  }
  const content = reply.data?.content as NomsFormContent;
  if (String(content?.form_ID) !== current.formId)
    return { ok: false, error: 'OMNOMS returned a different form.' };
  const unit = content.unit === 'cm' ? 'cm' : 'in';
  const values: Values = Object.fromEntries(
    formModels(content, { includeDisabled: true }).map(model => [model.key, { ...model.values }])
  );
  return { ok: true, values: convertValues(values, unit, state.unit) };
}

// ---------------------------------------------------------------- images
async function rasterizeSvg(svgText: string): Promise<string> {
  const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The diagram could not be drawn.'));
      image.src = blobUrl;
    });
    const width = 1800;
    const ratio =
      image.naturalHeight && image.naturalWidth ? image.naturalHeight / image.naturalWidth : 0.6;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The diagram could not be drawn.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
/** Drop measurement groups for letters the image already has, so lines are not doubled. */
function withoutLabels(svgText: string, skip: Set<string>): string {
  if (!skip.size) return svgText;
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  doc.querySelectorAll('[id]').forEach(node => {
    const match = /^[mbc]([A-Za-z0-9]+?)(?:cm|mm|in)\d*$/.exec(node.getAttribute('id') || '');
    if (match && skip.has(match[1])) node.remove();
  });
  return new XMLSerializer().serializeToString(doc);
}
async function diagramSvg(key: string): Promise<string> {
  const current = entry();
  if (!current) throw new Error('No NOMS order on this project.');
  const reply = await ask('diagram', { formId: current.formId, lang: current.lang, key });
  if (!reply.ok || typeof reply.data?.svgText !== 'string') {
    state.signIn = reply.signIn || '';
    throw new Error(reply.error || 'The diagram could not be loaded.');
  }
  return reply.data.svgText;
}
function uniqueViewId(seed: string): string {
  const views = projectManager()?.views || {};
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'cw-diagram';
  let id = base;
  for (let n = 2; views[id]; n += 1) id = `${base}-${n}`;
  return id;
}
async function addDiagram(key: string): Promise<void> {
  const model = state.models.find(item => item.key === key);
  const manager = projectManager();
  if (!model || !manager) return;
  setStatus(`Adding the CW diagram for ${model.title}…`);
  const svgText = await diagramSvg(key);
  const imageUrl = await rasterizeSvg(stripSvgLabels(svgText));
  const viewId = uniqueViewId(`cw-${model.reference}-diagram`);
  if (imageRegistry.isEnabled() && imageRegistry.registerImage) {
    await imageRegistry.registerImage(viewId, imageUrl, `${model.reference} CW diagram.png`, {
      source: 'noms-diagram',
    });
  } else {
    await manager.addImage(viewId, imageUrl, { refreshBackground: false });
    (window as any).addImageToSidebar?.(imageUrl, viewId, `${model.reference} CW diagram.png`);
  }
  const current = entry();
  patchEntry({
    diagramViews: { ...(current?.diagramViews || {}), [key]: viewId },
    viewBindings: { ...(current?.viewBindings || {}), [viewId]: key },
  });
  await manager.switchView?.(viewId, true);
  await waitForGuideImportReady(viewId);
  await importSvgMeasurements(model.modelName, 'front', viewId, { svgText });
  for (const field of model.fields) pushToLines(key, field);
  setStatus(`Added the CW diagram for ${model.title}. Its lines carry the form's values.`, 'ok');
}
async function placeLinesOnCurrent(key: string): Promise<void> {
  const model = state.models.find(item => item.key === key);
  const viewId = currentViewId();
  const manager = projectManager();
  if (!model || !viewId || !manager) return;
  linkView(viewId, key);
  const existing = new Set(model.fields.filter(field => strokeScopesFor(viewId, field).length));
  const missing = model.fields.filter(field => !existing.has(field));
  if (!missing.length) {
    setStatus('This image already has a line for every letter.', 'info');
    return;
  }
  setStatus(`Putting ${missing.join(', ')} on this image…`);
  const svgText = withoutLabels(await diagramSvg(key), existing);
  await waitForGuideImportReady(viewId);
  await importSvgMeasurements(model.modelName, 'front', viewId, { svgText });
  for (const field of model.fields) pushToLines(key, field);
  setStatus(
    `Added ${missing.join(', ')} where they sit on the diagram. Drag each line onto the photo.`,
    'ok'
  );
}
function linkView(viewId: string, key: string): void {
  const current = entry();
  if (!current || !viewId) return;
  const viewBindings = { ...(current.viewBindings || {}) };
  if (key) viewBindings[viewId] = key;
  else delete viewBindings[viewId];
  patchEntry({ viewBindings });
  state.canvasSnapshot.clear();
  if (key)
    for (const field of state.models.find(m => m.key === key)?.fields || [])
      pushToLines(key, field);
}
function armLetter(key: string, field: string): void {
  const viewId = currentViewId();
  if (!viewId) return;
  if (entry()?.viewBindings?.[viewId] !== key && entry()?.diagramViews?.[key] !== viewId)
    linkView(viewId, key);
  const w = window as any;
  const scope = w.currentImageLabel || viewId;
  w.labelsByImage = w.labelsByImage || {};
  w.manualTagByImage = w.manualTagByImage || {};
  w.labelsByImage[scope] = field;
  w.manualTagByImage[scope] = field;
  setNextTagValue(field);
  window.dispatchEvent(
    new CustomEvent('openpaint:guide-next-tag-changed', {
      detail: { viewId, tag: field, imageLabel: scope, nextTag: field, source: 'noms-link' },
    })
  );
  void app().toolManager?.selectTool?.('line');
  setStatus(`Draw ${field} on this image. Its value comes from the form.`, 'info');
}

// ---------------------------------------------------------------- photo links
function onPhotoImported(event: Event): void {
  const detail = (event as CustomEvent).detail || {};
  const order = String(detail.nomsOrder || '');
  const viewId = String(detail.viewId || '');
  if (!order || !viewId) return;
  state.order = state.order || order;
  if (state.order !== order) return;
  const ref = String(detail.nomsRef || '');
  pendingPhotoRefs.set(viewId, ref);
  void bindPendingPhotos();
}
const pendingPhotoRefs = new Map<string, string>();
async function bindPendingPhotos(): Promise<void> {
  if (!state.models.length) return;
  const current = entry();
  if (!current) return;
  const viewBindings = { ...(current.viewBindings || {}) };
  for (const [viewId, ref] of pendingPhotoRefs) {
    const key = soleModelForReference(state.models, ref);
    if (key && !viewBindings[viewId]) viewBindings[viewId] = key;
    pendingPhotoRefs.delete(viewId);
  }
  patchEntry({ viewBindings });
  render();
}
async function onImportComplete(event: Event): Promise<void> {
  const order = String((event as CustomEvent).detail?.nomsOrder || '');
  if (!order) return;
  state.order = order;
  render();
  if (!state.content) await loadForm();
  await bindPendingPhotos();
  // First open: add each model's CW diagram once so its lines are ready to use.
  const current = entry();
  for (const model of state.models) {
    if (current?.diagramViews?.[model.key]) continue;
    try {
      await addDiagram(model.key);
    } catch (error) {
      setStatus(String((error as Error)?.message || error), 'error');
      break;
    }
  }
  render();
}

// ---------------------------------------------------------------- PDF drop
// Drop the customer's filled measuring PDF anywhere on the panel: each diagram
// is matched to the form model it measures and its letters to the form fields.
// When that is unambiguous the values go straight in (with Undo); the mapping
// window only opens when a choice is needed. Nothing is saved until Save.
function takePdfFiles(files: FileList | File[] | null): void {
  const pdfs = Array.from(files || []).filter(isPdfFile);
  if (!pdfs.length) return;
  if (state.reading) {
    setStatus(`Still reading ${state.reading}. Drop the next PDF when that finishes.`, 'info');
    return;
  }
  void readPdfs(pdfs);
}
function pdfDropZone(): HTMLElement {
  const zone = el('div', `nml-drop${state.reading ? ' busy' : ''}`);
  zone.setAttribute('role', 'button');
  zone.tabIndex = 0;
  if (state.reading) {
    zone.append(el('span', 'nml-drop-spinner'), el('span', '', `Reading ${state.reading}…`));
    zone.setAttribute('aria-busy', 'true');
    return zone;
  }
  zone.append(
    el('strong', '', "Drop the customer's measuring PDF here"),
    el('span', '', 'CW form or SofaPaint check request (or click to choose)')
  );
  const input = el('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.multiple = true;
  input.hidden = true;
  zone.appendChild(input);
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => takePdfFiles(input.files));
  return zone;
}
/** The whole panel accepts a PDF drop, not only the zone. */
function attachPanelDrop(panel: HTMLElement): void {
  if (panel.dataset.nmlDrop === '1') return;
  panel.dataset.nmlDrop = '1';
  const hasFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types || []).includes('Files');
  panel.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    panel.classList.add('nml-over');
  });
  panel.addEventListener('dragleave', event => {
    if (event.relatedTarget && panel.contains(event.relatedTarget as Node)) return;
    panel.classList.remove('nml-over');
  });
  panel.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    panel.classList.remove('nml-over');
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length && !files.some(isPdfFile)) {
      setStatus('Only measuring PDFs fill the form. Drop photos on the canvas instead.', 'info');
      return;
    }
    takePdfFiles(files);
  });
}

function pdfGroupsForMatching(groups: CwFormValueGroup[]) {
  return groups.map(group => ({
    file: group.file,
    title: group.title,
    labels: group.values.map(v => v.label),
    unitAssumed: group.unitAssumed,
  }));
}

function viewsByKey(): Record<string, string[]> {
  return Object.fromEntries(state.models.map(model => [model.key, viewsForModel(model.key)]));
}

/** The stored drop, classified against what the panel holds now. */
function currentReview(): DropReview | null {
  const stored = entry()?.dropReview;
  if (!stored?.values?.length || !state.models.length) return null;
  return liveDropReview(
    stored.values,
    state.models,
    state.unit,
    stored.before || {},
    state.values,
    stored.picks
  );
}

/** True when a dropped file is a SofaPaint check-request PDF with values filled in. */
async function readReviewPdf(file: File, bytes: Uint8Array): Promise<DropValue[] | null> {
  let manifest: any = null;
  try {
    manifest = await parseSofaPaintReviewPdf(bytes.slice());
  } catch {
    return null;
  }
  const filled = (manifest?.views || []).some((view: any) =>
    (view?.measurements || []).some((m: any) => String(m?.value ?? '').trim())
  );
  if (!filled) return null;
  const current = entry();
  return reviewToDropValues(file.name, manifest, state.models, {
    lineLinks: current?.lineLinks,
    lines: allLines(),
    viewsByKey: viewsByKey(),
    viewBindings: current?.viewBindings || {},
    fallbackUnit: 'inch',
  });
}

/**
 * Read dropped PDFs of any kind (a filled CW measuring form, or a SofaPaint
 * check-request PDF) and put every value in the panel. Nothing waits on a
 * dialog: values that need a look are flagged on their rows instead.
 */
async function readPdfs(files: File[]): Promise<void> {
  const names = files.map(f => f.name).join(', ');
  state.reading = names;
  setStatus(`Reading ${names}…`);
  const cwGroups: CwFormValueGroup[] = [];
  const cwFiles: File[] = [];
  const reviewValues: DropValue[] = [];
  const originals: StoredOrderPdfs['originals'] = [];
  const unread: string[] = [];
  try {
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fromReview = await readReviewPdf(file, bytes);
        if (fromReview) {
          reviewValues.push(...fromReview);
          originals.push({ name: file.name, bytes, unit: fromReview[0]?.unit });
          continue;
        }
        const found = await readCwFormPdfValues(file);
        if (!found.length) {
          unread.push(`${file.name}: no filled measurements found`);
          continue;
        }
        cwGroups.push(...found);
        cwFiles.push(file);
        const stated = found.find(g => !g.unitAssumed);
        originals.push({ name: file.name, bytes, unit: stated?.unit as PdfUnit | undefined });
      } catch (error) {
        unread.push(`${file.name} could not be read: ${(error as Error).message}`);
      }
    }
  } finally {
    state.reading = '';
  }
  if (!cwGroups.length && !reviewValues.length) {
    setStatus(unread.join('. ') || 'No values found in the PDF.', 'error');
    return;
  }
  // Keep the originals for the cm copy, in memory and in this browser's storage.
  state.originals = [
    ...state.originals.filter(o => !originals.some(n => n.name === o.name)),
    ...originals,
  ];
  void storeOriginals();

  const models = modelGroups(state.models);
  const matchable = pdfGroupsForMatching(cwGroups);
  const suggested = refineTargets(
    matchable,
    models,
    Object.fromEntries(models.map(m => [m.key, m.title]))
  );
  const mappings = cwGroups.map((group, i) =>
    autoMapping(
      group.values.map(v => v.label),
      models.filter(m => suggested[i].includes(m.key))
    )
  );
  state.lastGroups = cwGroups;
  const cwValues = cwGroupsToDropValues(cwGroups, suggested, mappings, models);
  const filledIds = applyDrop(
    [...cwValues, ...reviewValues],
    originals.map(o => o.name),
    {},
    names
  );
  // The CW diagrams also go into the project as images with their lines.
  const picks = entry()?.dropReview?.picks || {};
  for (const file of cwFiles) {
    const chosen: Record<string, number> = {};
    for (const v of cwValues)
      if (v.file === file.name && v.range)
        chosen[rangeKey(v.pageNumber, v.label)] = dropNumber(v, picks);
    try {
      await importCwFormPdf(file, { chosen });
    } catch (error) {
      console.warn('[NOMS link] PDF pages could not be added as images', error);
    }
  }
  if (unread.length) setStatus(`${state.status} Not read: ${unread.join('; ')}.`, 'info');
  scrollToFirstFilled(filledIds);
}

/**
 * Put a drop's values in the panel. Values from `files` replace an earlier
 * drop of the same files; other files' values stay in the review. Returns the
 * "key|field" ids filled.
 */
function applyDrop(
  values: DropValue[],
  files: string[],
  picks: Record<string, number>,
  names: string
): string[] {
  const prev = entry()?.dropReview;
  const keep = (prev?.values || []).filter(v => !files.includes(v.file));
  const before = prev && keep.length ? prev.before : state.values;
  const keptPicks = Object.fromEntries(
    Object.entries(prev?.picks || {}).filter(([id]) => keep.some(v => v.id === id))
  );
  const stored: StoredDropReview = {
    at: new Date().toISOString(),
    values: [...keep, ...values],
    before,
    picks: { ...keptPicks, ...picks },
  };
  const review = classifyDropResult(stored.values, state.models, state.unit, before, {
    picks: stored.picks,
  });
  const fresh = new Set(values.map(v => v.id));
  const undoValues = state.values;
  const filledIds: string[] = [];
  for (const placement of review.placements) {
    if (!fresh.has(placement.from)) continue;
    setValue(placement.key, placement.field, placement.value);
    filledIds.push(`${placement.key}|${placement.field}`);
    const from = values.find(v => v.id === placement.from);
    if (from?.range) {
      // The customer's two numbers stay as a note on every line that took the pick.
      for (const line of letterLines(placement.key, placement.field).lines)
        rememberMeasurementNote(
          line.scope,
          line.label,
          `customer wrote ${from.text || from.range.join(' - ')}`
        );
    }
  }
  patchEntry({ dropReview: stored });
  state.collapsed = false;
  state.highlight = new Set(filledIds);
  state.highlightUntil = Date.now() + 4000;
  const live = currentReview();
  const toCheck = live?.toCheck ?? 0;
  const filled = filledIds.length;
  setStatus(
    `Filled ${filled} value${filled === 1 ? '' : 's'} from ${names}` +
      (toCheck ? `, ${toCheck} to check (marked ⚠).` : '. Everything matched.') +
      ' Send to NOMS when ready.',
    toCheck ? 'info' : 'ok'
  );
  notifyOpenPaint({
    message: `Filled ${filled} value${filled === 1 ? '' : 's'} from ${names}${toCheck ? `, ${toCheck} to check` : ''}.`,
    kind: 'success',
    durationMs: 9000,
    action: { label: 'Undo', onClick: () => undoFill(undoValues, prev) },
  });
  return filledIds;
}

function undoFill(before: Values, review: StoredDropReview | undefined): void {
  state.values = before;
  state.highlight = new Set();
  patchEntry({ values: state.values, unit: state.unit, dropReview: review });
  state.canvasSnapshot.clear();
  pushAll();
  setStatus('PDF values undone. Lines that took a value keep it until you edit them.', 'info');
}

/** Take a different end of a range the customer wrote. */
function pickRange(value: DropValue, picked: number): void {
  const stored = entry()?.dropReview;
  if (!stored) return;
  const picks = { ...stored.picks, [value.id]: picked };
  patchEntry({ dropReview: { ...stored, picks } });
  const review = classifyDropResult(stored.values, state.models, state.unit, stored.before, {
    picks,
  });
  for (const placement of review.placements)
    if (placement.from === value.id) setValue(placement.key, placement.field, placement.value);
  render();
}

/** Send a PDF value that matched no letter to a form letter chosen by hand. */
function assignExtra(id: string, target: string): void {
  const stored = entry()?.dropReview;
  const value = stored?.values.find(v => v.id === id);
  if (!stored || !value || !target) return;
  const [key, field] = [
    target.slice(0, target.lastIndexOf('|')),
    target.slice(target.lastIndexOf('|') + 1),
  ];
  const values = stored.values.map(v =>
    v.id === id ? { ...v, targets: [{ key, field }], why: undefined } : v
  );
  patchEntry({ dropReview: { ...stored, values } });
  const review = classifyDropResult(values, state.models, state.unit, stored.before, {
    picks: stored.picks,
  });
  const placed = review.placements.find(p => p.from === id);
  if (placed) {
    setValue(placed.key, placed.field, placed.value);
    setStatus(`${value.label} from the PDF now fills ${field}.`, 'ok');
  } else
    setStatus(
      `${field} already took a value from the PDF; ${value.label} is listed on it.`,
      'info'
    );
  render();
}

/** Re-open the matching window for the last CW form drop. */
async function changeMatching(): Promise<void> {
  const groups = state.lastGroups;
  if (!groups.length) return;
  const models = modelGroups(state.models);
  const suggested = refineTargets(
    pdfGroupsForMatching(groups),
    models,
    Object.fromEntries(models.map(m => [m.key, m.title]))
  );
  const choice = await chooseMapping(groups, suggested);
  if (!choice) return;
  const chosenGroups = choice.groups.map(c => c.group);
  const values = cwGroupsToDropValues(
    chosenGroups,
    choice.groups.map(c => c.targets),
    choice.groups.map(c => c.mapping),
    models
  );
  // Diagrams left out of the choice still list their values as extras.
  const left = groups.filter(g => !chosenGroups.includes(g));
  values.push(
    ...cwGroupsToDropValues(
      left,
      left.map(() => []),
      left.map(() => ({})),
      models
    )
  );
  const picks: Record<string, number> = {};
  for (const c of choice.groups)
    for (const v of values)
      if (
        v.file === c.group.file &&
        v.pageNumber === c.group.pageNumber &&
        v.title === c.group.title &&
        v.range
      )
        picks[v.id] = c.values[v.label] ?? v.value;
  // Start again from the form before the drop so old placements do not linger.
  const before = entry()?.dropReview?.before;
  if (before) {
    state.values = before;
    patchEntry({ values: before });
  }
  applyDrop(values, Array.from(new Set(groups.map(g => g.file))), picks, 'the PDF');
  render();
}

function scrollToFirstFilled(ids: string[]): void {
  const panel = document.getElementById(PANEL_ID);
  if (!panel || !ids.length) return;
  const first = panel.querySelector<HTMLElement>(`input[data-nml-id="${CSS.escape(ids[0])}"]`);
  const box = first?.closest<HTMLElement>('.nml-model');
  if (!box) return;
  const header = panel.querySelector<HTMLElement>('header');
  panel.scrollTo({
    top: Math.max(0, box.offsetTop - (header?.offsetHeight || 0) - 6),
    behavior: 'smooth',
  });
}

interface MappingChoice {
  addImages: boolean;
  groups: Array<{
    group: CwFormValueGroup;
    targets: string[];
    mapping: Record<string, string>;
    /** The number used for each letter (a range's chosen end), in the PDF's unit. */
    values: Record<string, number>;
  }>;
}

/** Pills for a value the customer wrote as two numbers; clicking one picks it. */
function rangePills(
  values: number[],
  unit: string,
  current: number,
  onPick: (value: number) => void
): HTMLElement {
  const wrap = el('span', 'nml-pills');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', `Customer wrote ${values.join(' to ')} ${unit}; choose one`);
  const [lower, upper] = values;
  const options = [
    { value: lower, text: formatCustomerNumber(lower) },
    { value: upper, text: formatCustomerNumber(upper) },
    {
      value: Math.round(((lower + upper) / 2) * 10000) / 10000,
      text: `mid ${formatCustomerNumber((lower + upper) / 2)}`,
    },
  ];
  const buttons = options.map(option => {
    const pill = el('button', `nml-pill${option.value === current ? ' on' : ''}`, option.text);
    pill.type = 'button';
    pill.setAttribute('aria-pressed', option.value === current ? 'true' : 'false');
    pill.addEventListener('click', () => {
      buttons.forEach(b => {
        b.classList.toggle('on', b === pill);
        b.setAttribute('aria-pressed', b === pill ? 'true' : 'false');
      });
      onPick(option.value);
    });
    return pill;
  });
  wrap.append(...buttons);
  return wrap;
}

function chooseMapping(
  groups: CwFormValueGroup[],
  suggested: string[][]
): Promise<MappingChoice | null> {
  ensureStyles();
  const models = modelGroups(state.models);
  return new Promise(resolve => {
    const overlay = el('div', 'nml-map');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Match PDF measurements to the form');
    const card = el('section', 'nml-map-card');
    card.append(
      el('h2', '', 'Match the PDF to the form'),
      el(
        'p',
        '',
        `Check what each diagram fills. Letters that match the form are filled as they are; only the ones that need a choice are listed. Where the customer wrote two numbers, pick the one to use (the ${RANGE_DEFAULT} one is picked to start). Values are converted to ${state.unit === 'in' ? 'inches' : 'cm'}.`
      )
    );
    const state2 = groups.map((group, i) => ({
      group,
      targets: new Set(suggested[i]),
      mapping: {} as Record<string, string>,
      // Ranges start on the RANGE_DEFAULT end (the parser's `value`).
      values: Object.fromEntries(group.values.map(v => [v.label, v.value])) as Record<
        string,
        number
      >,
      showAll: false,
      editTargets: suggested[i].length === 0,
    }));
    const summaries: Array<() => void> = [];
    const sharedWith = (entry: (typeof state2)[number]): string[] => {
      // Two diagrams writing the same letter onto the same model.
      const mine = new Set(Object.values(entry.mapping).filter(Boolean));
      return models
        .filter(
          m =>
            entry.targets.has(m.key) &&
            state2.some(
              other =>
                other !== entry &&
                other.targets.has(m.key) &&
                Object.values(other.mapping).some(
                  field => field && mine.has(field) && field in m.fields
                )
            )
        )
        .map(m => m.title);
    };
    state2.forEach(entry => {
      const box = el('div', 'nml-map-group');
      const unitNote = entry.group.unitAssumed
        ? `${entry.group.unit} (assumed)`
        : entry.group.unit === 'inch'
          ? 'inches'
          : 'cm';
      box.appendChild(
        el(
          'h3',
          '',
          `${entry.group.file} · page ${entry.group.pageNumber} · ${entry.group.title} · ${unitNote}`
        )
      );
      const summary = el('div', 'nml-map-summary');
      const targets = el('div', 'nml-map-targets');
      const table = el('div', 'nml-map-table');
      const more = el('button', 'nml-map-link', '');
      more.type = 'button';
      const renderSummary = () => {
        summary.replaceChildren();
        const names = models.filter(m => entry.targets.has(m.key)).map(m => m.title);
        summary.append(
          el(
            'span',
            names.length ? '' : 'nml-map-none',
            names.length
              ? `Fills: ${names.join(', ')}`
              : 'Fills: nothing yet (choose below, or leave it out)'
          )
        );
        const shared = sharedWith(entry);
        if (shared.length) {
          summary.appendChild(
            el(
              'span',
              'nml-map-none',
              `Another diagram also fills ${shared.join(', ')}. Check which one is right.`
            )
          );
        }
        const change = el('button', 'nml-map-link', entry.editTargets ? 'Done' : 'Change');
        change.type = 'button';
        change.addEventListener('click', () => {
          entry.editTargets = !entry.editTargets;
          targets.hidden = !entry.editTargets;
          renderSummary();
        });
        summary.appendChild(change);
      };
      const renderTable = () => {
        table.replaceChildren();
        const fields = Array.from(
          new Set(models.filter(m => entry.targets.has(m.key)).flatMap(m => Object.keys(m.fields)))
        ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        for (const { label, value, range } of entry.group.values) {
          if (
            !(label in entry.mapping) ||
            (entry.mapping[label] && !fields.includes(entry.mapping[label]))
          )
            entry.mapping[label] = defaultFieldFor(label, fields);
          const row = el('label', `nml-map-row${entry.mapping[label] ? '' : ' unmapped'}`);
          const select = el('select');
          const none = el('option', '', 'Not used');
          none.value = '';
          select.appendChild(none);
          for (const field of fields) {
            const option = el('option', '', `→ ${field}`);
            option.value = field;
            option.selected = field === entry.mapping[label];
            select.appendChild(option);
          }
          select.addEventListener('change', () => {
            entry.mapping[label] = select.value;
            row.classList.toggle('unmapped', !select.value);
          });
          const shown = range
            ? rangePills(range, entry.group.unit, entry.values[label] ?? value, picked => {
                entry.values[label] = picked;
              })
            : el('span', '', String(+value.toFixed(3)));
          if (range) row.classList.add('range');
          row.append(el('b', '', label), shown, select);
          // Same letter on the form and one number: nothing to decide, so keep it out of the way.
          row.hidden =
            !entry.showAll && !range && entry.mapping[label] === label.replace(/\*$/, '');
          table.appendChild(row);
        }
        const hidden = Array.from(table.children).filter(row => (row as HTMLElement).hidden).length;
        more.hidden = !hidden && !entry.showAll;
        summaries.forEach(refresh => refresh());
        more.textContent = entry.showAll
          ? 'Show only letters that need a choice'
          : `Show all ${entry.group.values.length} letters (${hidden} match the form)`;
      };
      summaries.push(renderSummary);
      more.addEventListener('click', () => {
        entry.showAll = !entry.showAll;
        renderTable();
      });
      for (const model of models) {
        const label = el('label');
        const box2 = el('input');
        box2.type = 'checkbox';
        box2.checked = entry.targets.has(model.key);
        box2.addEventListener('change', () => {
          if (box2.checked) entry.targets.add(model.key);
          else entry.targets.delete(model.key);
          renderTable();
        });
        label.append(box2, document.createTextNode(` ${model.title}`));
        targets.appendChild(label);
      }
      targets.hidden = !entry.editTargets;
      renderTable();
      box.append(summary, targets, table, more);
      card.appendChild(box);
    });
    const foot = el('div', 'nml-map-foot');
    const addImagesLabel = el('label');
    const addImages = el('input');
    addImages.type = 'checkbox';
    addImages.checked = true;
    addImagesLabel.append(
      addImages,
      document.createTextNode(' Also add the PDF diagrams to the project')
    );
    const cancel = el('button', '', 'Cancel');
    cancel.type = 'button';
    const apply = el('button', 'primary', 'Fill in the form');
    apply.type = 'button';
    const finish = (value: MappingChoice | null) => {
      overlay.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(null));
    apply.addEventListener('click', () =>
      finish({
        addImages: addImages.checked,
        groups: state2
          .filter(entry => entry.targets.size)
          .map(entry => ({
            group: entry.group,
            targets: Array.from(entry.targets),
            mapping: entry.mapping,
            values: entry.values,
          })),
      })
    );
    foot.append(addImagesLabel, cancel, apply);
    card.appendChild(foot);
    overlay.appendChild(card);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') finish(null);
    });
    document.body.appendChild(overlay);
    apply.focus();
  });
}

// ---------------------------------------------------------------- letter links
/** Pick the drawn line a form letter follows, from every line in the project grouped by view. */
function chooseLine(key: string, field: string): void {
  ensureStyles();
  const model = state.models.find(m => m.key === key);
  const current = entry()?.lineLinks?.[lineLinkKey(key, field)];
  const lines = allLines();
  const overlay = el('div', 'nml-map');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Line for ${field}`);
  const card = el('section', 'nml-map-card');
  card.append(
    el('h2', '', `${model?.title || key} · ${field}: which line?`),
    el(
      'p',
      '',
      current
        ? `${field} follows ${viewTitle(current.viewId)} ${current.label}. Pick another line, or unlink to follow lines labelled ${field} again.`
        : `${field} follows lines labelled ${field} on this model's images. Pick any drawn line instead; its value and the box then move together.`
    )
  );
  const close = () => overlay.remove();
  const byView = new Map<string, MeasuredLine[]>();
  for (const line of lines) byView.set(line.viewId, [...(byView.get(line.viewId) || []), line]);
  if (!byView.size)
    card.appendChild(el('p', 'nml-map-none', 'No lines are drawn in this project yet.'));
  for (const [viewId, viewLines] of byView) {
    const box = el('div', 'nml-pick-view');
    box.appendChild(el('h3', '', viewTitle(viewId)));
    const list = el('div', 'nml-pick-lines');
    const seen = new Set<string>();
    for (const line of viewLines.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true })
    )) {
      if (seen.has(line.label)) continue;
      seen.add(line.label);
      const on = current?.viewId === viewId && current?.label === line.label;
      const button = el('button', `nml-pick-line${on ? ' on' : ''}`);
      button.type = 'button';
      button.append(
        el('b', '', line.label),
        document.createTextNode(line.value ? `${line.value} ${state.unit}` : 'no value')
      );
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.addEventListener('click', () => {
        close();
        setLineLink(key, field, { viewId, label: line.label });
        render();
      });
      list.appendChild(button);
    }
    box.appendChild(list);
    card.appendChild(box);
  }
  const foot = el('div', 'nml-map-foot');
  if (current) {
    const unlink = el('button', '', 'Unlink');
    unlink.type = 'button';
    unlink.addEventListener('click', () => {
      close();
      setLineLink(key, field, null);
      render();
    });
    foot.appendChild(unlink);
  }
  const cancel = el('button', '', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  foot.appendChild(cancel);
  card.appendChild(foot);
  overlay.appendChild(card);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  document.body.appendChild(overlay);
  cancel.focus();
}

/**
 * Offer same-label lines on each model's linked images as links, with values
 * beside them. Nothing is bound until the person ticks and accepts: the same
 * letter on a photo and on the form can be different measurements.
 */
function suggestLinks(): void {
  ensureStyles();
  const current = entry();
  if (!current) return;
  const suggestions = suggestLineLinks(
    state.models,
    allLines(),
    current.viewBindings || {},
    state.values,
    current.lineLinks,
    current.diagramViews || {}
  );
  if (!suggestions.length) {
    setStatus(
      'No lines to suggest: link images to a model (This image), then letters drawn there with the same label are offered.',
      'info'
    );
    return;
  }
  const overlay = el('div', 'nml-map');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Suggested line links');
  const card = el('section', 'nml-map-card');
  card.append(
    el('h2', '', 'Suggested line links'),
    el(
      'p',
      '',
      `Lines with the same letter on images linked to a model. Check each value against the form: the same letter can mean a different measurement. Values in ${state.unit}.`
    )
  );
  const list = el('div', 'nml-sugg');
  const boxes: Array<{ box: HTMLInputElement; suggestion: (typeof suggestions)[number] }> = [];
  for (const suggestion of suggestions) {
    const model = state.models.find(m => m.key === suggestion.key);
    const differs =
      hasMeasure(suggestion.formValue) &&
      hasMeasure(suggestion.value) &&
      suggestion.formValue !== suggestion.value;
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    // Ticked unless the form already holds a different number; that needs a look.
    box.checked = !differs;
    const text = el('span');
    text.append(
      el('b', '', `${model?.title || suggestion.key} · ${suggestion.letter}`),
      document.createTextNode(
        ` follows ${viewTitle(suggestion.viewId)} · ${suggestion.label} · ${suggestion.value ? `${suggestion.value} ${state.unit}` : 'no value'}`
      )
    );
    if (differs)
      text.append(
        document.createTextNode(' '),
        el('span', 'differs', `(form has ${suggestion.formValue} ${state.unit})`)
      );
    label.append(box, text);
    list.appendChild(label);
    boxes.push({ box, suggestion });
  }
  card.appendChild(list);
  const foot = el('div', 'nml-map-foot');
  const cancel = el('button', '', 'Cancel');
  cancel.type = 'button';
  const apply = el('button', 'primary', 'Link the ticked letters');
  apply.type = 'button';
  const close = () => overlay.remove();
  cancel.addEventListener('click', close);
  apply.addEventListener('click', () => {
    close();
    let count = 0;
    for (const { box, suggestion } of boxes) {
      if (!box.checked) continue;
      setLineLink(suggestion.key, suggestion.letter, {
        viewId: suggestion.viewId,
        label: suggestion.label,
      });
      count += 1;
    }
    setStatus(
      `Linked ${count} letter${count === 1 ? '' : 's'} to drawn lines.`,
      count ? 'ok' : 'info'
    );
    render();
  });
  foot.append(cancel, apply);
  card.appendChild(foot);
  overlay.appendChild(card);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  document.body.appendChild(overlay);
  apply.focus();
}

// ---------------------------------------------------------------- send to NOMS
// One action: save the values to the CW40 form, make the customer's PDF in cm,
// hand it over as a download (kept in this browser too), and show a summary
// for the SZ email. A failed step stops the rest and says what was done.

async function storeOriginals(): Promise<void> {
  if (!state.order || !state.originals.length) return;
  try {
    const stored = await loadOrderPdfs(state.order);
    await saveOrderPdfs({ ...(stored || {}), order: state.order, originals: state.originals });
  } catch (error) {
    console.warn('[NOMS link] Could not keep the PDF in this browser', error);
  }
}

async function originalsForOrder(): Promise<StoredOrderPdfs['originals']> {
  if (state.originals.length) return state.originals;
  const stored = await loadOrderPdfs(state.order).catch(() => null);
  state.originals = stored?.originals || [];
  return state.originals;
}

function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** A small modal with a message, an optional list and buttons; resolves the button's value. */
function askDialog<T>(options: {
  title: string;
  text: string;
  list?: string[];
  tick?: string;
  buttons: Array<{ label: string; value: T; primary?: boolean }>;
  cancel: T;
}): Promise<{ value: T; ticked: boolean }> {
  ensureStyles();
  return new Promise(resolve => {
    const overlay = el('div', 'nml-map');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', options.title);
    const card = el('section', 'nml-map-card nml-ask');
    card.append(el('h2', '', options.title), el('p', '', options.text));
    if (options.list?.length) {
      const list = el('ul', 'nml-ask-list');
      for (const line of options.list) list.appendChild(el('li', '', line));
      card.appendChild(list);
    }
    const foot = el('div', 'nml-map-foot');
    let box: HTMLInputElement | null = null;
    if (options.tick) {
      const label = el('label');
      box = el('input');
      box.type = 'checkbox';
      label.append(box, document.createTextNode(` ${options.tick}`));
      foot.appendChild(label);
    }
    const finish = (value: T) => {
      overlay.remove();
      resolve({ value, ticked: Boolean(box?.checked) });
    };
    let focus: HTMLButtonElement | null = null;
    for (const b of options.buttons) {
      const button = el('button', b.primary ? 'primary' : '', b.label);
      button.type = 'button';
      button.addEventListener('click', () => finish(b.value));
      foot.appendChild(button);
      if (b.primary) focus = button;
    }
    card.appendChild(foot);
    overlay.appendChild(card);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') finish(options.cancel);
    });
    document.body.appendChild(overlay);
    focus?.focus();
  });
}

function progress(text: string, kind: 'run' | 'ok' | 'error' | 'skip'): void {
  const last = state.progress[state.progress.length - 1];
  if (last?.kind === 'run') state.progress[state.progress.length - 1] = { text, kind };
  else state.progress.push({ text, kind });
  render();
}

async function sendToNoms(): Promise<void> {
  const current = entry();
  if (!current || !state.content || state.sending) return;
  const review = currentReview();
  const flags = review ? dropFlagLines(review, state.models) : [];
  if (flags.length && !current.skipFlagConfirm) {
    const answer = await askDialog({
      title: `Save with ${flags.length} flagged value${flags.length === 1 ? '' : 's'}?`,
      text: 'These are marked ⚠ in the panel. They are saved as they are; nothing is left out.',
      list: flags,
      tick: "Don't ask again for this order",
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'Send to NOMS', value: true, primary: true },
      ],
      cancel: false,
    });
    if (!answer.value) return;
    if (answer.ticked) patchEntry({ skipFlagConfirm: true });
  }
  state.sending = true;
  state.progress = [];
  const done: string[] = [];
  const stop = (step: string, error: string) => {
    progress(`${step}: ${error}`, 'error');
    setStatus(
      `Stopped at ${step.toLowerCase()}. ${done.length ? `Done: ${done.join(', ')}.` : 'Nothing was changed on NOMS.'}`,
      'error'
    );
  };
  try {
    // 1. NOMS: check nobody changed the form meanwhile, then save.
    progress('1/3 Checking NOMS for changes…', 'run');
    const fresh = await fetchFormValues();
    if (!fresh.ok) return stop('Saving to NOMS', fresh.error);
    const snapshot = entry()?.formSnapshot
      ? convertValues(entry()!.formSnapshot, entry()!.unit, state.unit)
      : state.saved;
    const conflicts = conflictingDrift(formDrift(snapshot, fresh.values, state.values));
    if (conflicts.length) {
      const answer = await askDialog<'noms' | 'mine' | 'cancel'>({
        title: 'NOMS changed since you loaded it',
        text: `NOMS has newer values for ${fieldList(conflicts)} (changed since ${agoText(entry()?.snapshotAt)}). Sending would replace them.`,
        list: conflicts.map(
          d =>
            `${fieldList([d])}: NOMS now ${d.now || 'empty'}, was ${d.was || 'empty'}, sending ${d.mine || 'empty'} ${state.unit}`
        ),
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Use NOMS for these', value: 'noms' },
          { label: 'Send mine', value: 'mine', primary: true },
        ],
        cancel: 'cancel',
      });
      if (answer.value === 'cancel') {
        progress('Not sent: NOMS changed meanwhile.', 'skip');
        return;
      }
      if (answer.value === 'noms') for (const d of conflicts) setValue(d.key, d.field, d.now);
    }
    progress('1/3 Saving the values to NOMS…', 'run');
    const confirm = state.confirmTick ?? state.confirmed;
    if (!(await saveForm(confirm)))
      return stop('Saving to NOMS', state.status || 'the save failed');
    done.push(`values saved to NOMS${confirm ? ' and confirmed' : ''}`);
    progress(`1/3 Saved to NOMS${confirm ? ' and confirmed' : ''}.`, 'ok');

    // 2. The customer's PDF in cm.
    const name = cmPdfFileName(current.orderNumber, current.customerName);
    let cmBytes: Uint8Array | null = null;
    const originals = await originalsForOrder();
    if (!originals.length) {
      progress('2/3 No customer PDF dropped for this order, so no cm copy.', 'skip');
    } else {
      progress(`2/3 Making ${name}…`, 'run');
      try {
        const pdfjs = await loadPdfjs();
        const converted: Uint8Array[] = [];
        let count = 0;
        for (const original of originals) {
          const scan = await scanPdfText(original.bytes.slice(), pdfjs).catch(() => null);
          const result = await convertPdfToCm(original.bytes.slice(), {
            orderNumber: current.orderNumber,
            unit: original.unit,
            scan,
          });
          count += result.converted.length;
          converted.push(result.bytes);
        }
        cmBytes = await mergeCmPdfs(converted);
        done.push('cm PDF made');
        progress(
          `2/3 Made the cm PDF (${count} value${count === 1 ? '' : 's'} converted from inches).`,
          'ok'
        );
      } catch (error) {
        return stop('Making the cm PDF', String((error as Error)?.message || error));
      }
    }

    // 3. Hand it over and keep it with the order.
    if (cmBytes) {
      progress('3/3 Downloading and keeping the cm PDF…', 'run');
      try {
        downloadBytes(cmBytes, name);
        await saveOrderPdfs({
          order: current.orderNumber,
          originals,
          cm: { name, bytes: cmBytes, createdAt: new Date().toISOString() },
        });
        patchEntry({ cmPdfName: name });
        done.push('cm PDF downloaded');
        progress(`3/3 Downloaded ${name}.`, 'ok');
      } catch (error) {
        return stop('Keeping the cm PDF', String((error as Error)?.message || error));
      }
    }
    patchEntry({ lastSentAt: new Date().toISOString() });
    setStatus(`Sent: ${done.join(', ')}.`, 'ok');
    showSummary(cmBytes ? name : '');
  } finally {
    state.sending = false;
    render();
  }
}

function summaryText(pdfName: string): string {
  const current = entry();
  const review = currentReview();
  return szSummaryText({
    orderNumber: current?.orderNumber || state.order,
    customerName: current?.customerName,
    product: current?.productName || current?.productSku,
    models: state.models.filter(m => m.enabled !== false),
    values: state.values,
    unit: state.unit,
    flags: review ? dropFlagLines(review, state.models) : [],
    pdfName,
  });
}

function showSummary(pdfName: string): void {
  ensureStyles();
  const current = entry();
  if (!current) return;
  const text = summaryText(pdfName);
  const overlay = el('div', 'nml-map');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Sent to NOMS');
  const card = el('section', 'nml-map-card');
  card.append(el('h2', '', `Sent to NOMS #${current.orderNumber}`));
  const steps = el('ul', 'nml-ask-list');
  for (const step of state.progress) steps.appendChild(el('li', '', step.text));
  card.appendChild(steps);
  const area = el('textarea', 'nml-summary');
  area.value = text;
  area.readOnly = true;
  area.rows = Math.min(18, text.split('\n').length + 1);
  card.appendChild(area);
  const foot = el('div', 'nml-map-foot');
  const open = el('a', 'nml-map-button', 'Open NOMS order');
  open.href = `${NOMS}/order/${current.orderNumber}/measurements?form=${current.formId}&lang=${current.lang}`;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  const copy = el('button', 'primary', 'Copy summary for SZ');
  copy.type = 'button';
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(
      () => {
        copy.textContent = 'Copied';
      },
      () => {
        area.select();
        copy.textContent = 'Press Cmd+C to copy';
      }
    );
  });
  const again = el('button', '', 'Download the cm PDF again');
  again.type = 'button';
  again.hidden = !pdfName;
  again.addEventListener('click', () => {
    void loadOrderPdfs(current.orderNumber).then(stored => {
      if (stored?.cm) downloadBytes(stored.cm.bytes, stored.cm.name);
    });
  });
  const close = el('button', '', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => overlay.remove());
  foot.append(open, again, close, copy);
  card.appendChild(foot);
  overlay.appendChild(card);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') overlay.remove();
  });
  document.body.appendChild(overlay);
  copy.focus();
}

// ---------------------------------------------------------------- panel
function setStatus(message: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  state.status = message;
  state.statusKind = kind;
  render();
}
function ensureStyles(): void {
  if (document.getElementById(`${PANEL_ID}Styles`)) return;
  const style = document.createElement('style');
  style.id = `${PANEL_ID}Styles`;
  style.textContent = `
    #${PANEL_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 11900; width: min(380px, calc(100vw - 32px));
      max-height: min(72vh, 680px); overflow: auto; background: #fff; border: 1px solid #dbe1ea; border-radius: 10px;
      box-shadow: 0 14px 40px rgba(15, 23, 42, .18); font: 12px/1.4 system-ui, sans-serif; color: #0f172a; }
    #${PANEL_ID} header { position: sticky; top: 0; display: flex; gap: 8px; align-items: center; padding: 10px 12px;
      background: #fff7ed; border-bottom: 1px solid #fde4cc; }
    #${PANEL_ID} header strong { flex: 1; font-size: 13px; }
    #${PANEL_ID} header a { color: #9a3412; font-weight: 600; }
    #${PANEL_ID} button { height: 26px; padding: 0 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff;
      color: #0f172a; font: inherit; font-weight: 600; cursor: pointer; }
    #${PANEL_ID} button.primary { background: #f47636; border-color: #f47636; color: #fff; }
    #${PANEL_ID} button:disabled { opacity: .5; cursor: default; }
    #${PANEL_ID} .nml-body { padding: 10px 12px 12px; }
    #${PANEL_ID} .nml-status { margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; background: #f1f5f9; }
    #${PANEL_ID} .nml-status.error { background: #fde2e2; color: #8a1c1c; }
    #${PANEL_ID} .nml-status.ok { background: #e9f8ee; color: #1d5c34; }
    #${PANEL_ID} .nml-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
    #${PANEL_ID} select, #${PANEL_ID} input { height: 26px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 6px; font: inherit; }
    #${PANEL_ID} .nml-model { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e2e8f0; }
    #${PANEL_ID} .nml-model h3 { margin: 0 0 4px; font-size: 12px; }
    #${PANEL_ID} .nml-grid { display: grid; grid-template-columns: 14px 22px 74px 1fr auto 24px; gap: 4px 6px; align-items: center; }
    #${PANEL_ID} .nml-mark { font-weight: 700; text-align: center; }
    #${PANEL_ID} .nml-mark.ok { color: #16a34a; }
    #${PANEL_ID} .nml-mark.warn { color: #b45309; }
    #${PANEL_ID} .nml-why { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin: -2px 0 4px; color: #8a5a00; font-size: 11px; }
    #${PANEL_ID} .nml-review { margin: 8px 0; padding: 6px 8px; border-radius: 8px; background: #e9f8ee; border: 1px solid #bfe6cc; }
    #${PANEL_ID} .nml-review.warn { background: #fff7e6; border-color: #f5d49a; }
    #${PANEL_ID} .nml-review .nml-row { margin: 0; }
    #${PANEL_ID} .nml-review strong { margin-right: auto; }
    #${PANEL_ID} .nml-review button.nml-unit.on { background: #0f172a; border-color: #0f172a; color: #fff; }
    #${PANEL_ID} .nml-extra { display: grid; grid-template-columns: 14px 26px 1fr auto; gap: 4px 6px; align-items: center; margin-top: 4px; }
    #${PANEL_ID} .nml-extra select { max-width: 110px; }
    #${PANEL_ID} .nml-drift { margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; background: #fff7e6; border: 1px solid #f5d49a; color: #7a4b00; }
    #${PANEL_ID} .nml-send .nml-tick { display: inline-flex; gap: 4px; align-items: center; }
    #${PANEL_ID} .nml-send .nml-tick input { height: auto; }
    #${PANEL_ID} .nml-progress { margin-top: 6px; display: grid; gap: 2px; font-size: 11px; }
    #${PANEL_ID} .nml-progress .ok { color: #1d5c34; }
    #${PANEL_ID} .nml-progress .error { color: #8a1c1c; font-weight: 600; }
    #${PANEL_ID} .nml-progress .skip { color: #64748b; }
    .nml-ask-list { margin: 8px 0; padding-left: 18px; max-height: 260px; overflow: auto; }
    .nml-summary { width: 100%; box-sizing: border-box; margin-top: 8px; font: 12px/1.4 ui-monospace, monospace; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; }
    .nml-map a.nml-map-button { margin-right: auto; color: #9a3412; font-weight: 650; }
    .nml-map button[hidden] { display: none; }
    #${PANEL_ID} .nml-line.gone { color: #b45309; }
    #${PANEL_ID} button.nml-link-btn { width: 24px; height: 24px; padding: 0; border-radius: 6px; font-size: 12px; line-height: 1; color: #64748b; }
    #${PANEL_ID} button.nml-link-btn.on { background: #0f172a; border-color: #0f172a; color: #fff; }
    .nml-pick-view { margin-top: 10px; }
    .nml-pick-view h3 { margin: 0 0 4px; font-size: 12px; color: #334155; }
    .nml-pick-lines { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px; }
    .nml-map button.nml-pick-line { height: 26px; padding: 0 8px; text-align: left; font-weight: 500; }
    .nml-map button.nml-pick-line b { font-weight: 700; margin-right: 6px; }
    .nml-map button.nml-pick-line.on { background: #0f172a; border-color: #0f172a; color: #fff; }
    .nml-sugg { display: grid; gap: 4px; margin-top: 10px; }
    .nml-sugg label { display: grid; grid-template-columns: 18px 1fr; gap: 6px; align-items: start; padding: 4px 6px; border: 1px solid #e2e8f0; border-radius: 6px; }
    .nml-sugg .differs { color: #b45309; font-weight: 600; }
    #${PANEL_ID} .nml-grid input { width: 100%; box-sizing: border-box; }
    #${PANEL_ID} .nml-key { font-weight: 700; }
    #${PANEL_ID} .nml-hint { color: #64748b; }
    #${PANEL_ID} .nml-hint.error { color: #b91c1c; font-weight: 600; }
    #${PANEL_ID} .nml-hint.warn { color: #8a5a00; }
    #${PANEL_ID} .nml-line { color: #16a34a; font-weight: 700; }
    #${PANEL_ID} .nml-type-in button.nml-unit { min-width: 38px; padding: 0 8px; }
    #${PANEL_ID} .nml-type-in button.nml-unit.on { background: #0f172a; border-color: #0f172a; color: #fff; }
    #${PANEL_ID}.collapsed .nml-body { display: none; }
    #${PANEL_ID} .nml-drop { display: flex; flex-direction: column; gap: 2px; align-items: center; margin: 10px 0;
      padding: 14px 12px; border: 2px dashed #f47636; border-radius: 10px; background: #fff4ea; color: #9a3412;
      text-align: center; cursor: pointer; font-size: 12px; }
    #${PANEL_ID} .nml-drop strong { font-size: 13px; }
    #${PANEL_ID} .nml-drop:hover, #${PANEL_ID}.nml-over .nml-drop { background: #ffe4cc; border-color: #ea580c; }
    #${PANEL_ID}.nml-over { outline: 3px solid #f47636; outline-offset: -3px; }
    #${PANEL_ID} .nml-drop.busy { cursor: progress; flex-direction: row; gap: 8px; opacity: .85; }
    #${PANEL_ID} .nml-drop-spinner { width: 14px; height: 14px; border-radius: 999px; border: 2px solid #fcd3b8;
      border-top-color: #f47636; animation: nml-spin .8s linear infinite; }
    #${PANEL_ID} input.nml-filled { animation: nml-flash 4s ease-out forwards; }
    @keyframes nml-spin { to { transform: rotate(360deg); } }
    @keyframes nml-flash { 0%, 50% { background: #fde68a; border-color: #f59e0b; } 100% { background: #fff; border-color: #cbd5e1; } }
    .nml-map { position: fixed; inset: 0; z-index: 12100; display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(15, 23, 42, .44); font: 12px/1.4 system-ui, sans-serif; color: #0f172a; }
    .nml-map-card { width: min(760px, 100%); max-height: calc(100vh - 40px); overflow: auto; padding: 16px 18px;
      background: #fff; border-radius: 10px; box-shadow: 0 24px 64px rgba(15, 23, 42, .24); }
    .nml-map h2 { margin: 0 0 4px; font-size: 16px; }
    .nml-map-group { margin-top: 12px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; }
    .nml-map-group h3 { margin: 0 0 6px; font-size: 13px; }
    .nml-map-targets { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 8px; }
    .nml-map-summary { display: flex; gap: 10px; align-items: baseline; margin-bottom: 6px; }
    .nml-map-none { color: #b45309; font-weight: 600; }
    .nml-map button.nml-map-link { height: auto; padding: 0; border: 0; background: none; color: #2563eb; font-weight: 600; text-decoration: underline; }
    .nml-map-targets[hidden], .nml-map-row[hidden], .nml-map button[hidden] { display: none; }
    .nml-map-table { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 10px; }
    .nml-map-row { display: grid; grid-template-columns: 34px 52px 1fr; gap: 4px; align-items: center; }
    .nml-map-row select { height: 24px; font: inherit; }
    .nml-map-row.unmapped b { color: #b45309; }
    .nml-map-row.range { grid-template-columns: 34px 1fr auto; }
    .nml-pills { display: inline-flex; flex-wrap: wrap; gap: 4px; }
    .nml-map button.nml-pill, #${PANEL_ID} button.nml-pill { height: 22px; padding: 0 8px; border-radius: 999px; font-weight: 600; }
    .nml-map button.nml-pill.on, #${PANEL_ID} button.nml-pill.on { background: #0f172a; border-color: #0f172a; color: #fff; }
    .nml-map-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 14px; }
    .nml-map-foot label { margin-right: auto; }
    .nml-map button { height: 30px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; font: inherit; font-weight: 650; cursor: pointer; }
    .nml-map button.primary { background: #f47636; border-color: #f47636; color: #fff; }
  `;
  document.head.appendChild(style);
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function actionButton(
  label: string,
  run: () => Promise<void> | void,
  primary = false
): HTMLButtonElement {
  const button = el('button', primary ? 'primary' : '', label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      setStatus(String((error as Error)?.message || error), 'error');
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
function render(): void {
  const current = entry();
  let panel = document.getElementById(PANEL_ID);
  if (!current) {
    panel?.remove();
    return;
  }
  ensureStyles();
  if (!staff()) {
    // The order link is kept, but its measurements are for staff only.
    if (!panel) {
      panel = el('section');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }
    const user = authService.getCurrentUser();
    const body = el('div', 'nml-body');
    body.appendChild(
      el(
        'div',
        'nml-status',
        user
          ? `NOMS measurements need a confirmed @comfort-works.com account. You are signed in as ${user.email}.`
          : 'Sign in with your @comfort-works.com account to see and save the NOMS measurements for this order. The NOMS photos are added again after you sign in.'
      )
    );
    if (!user)
      body.appendChild(
        actionButton('Sign in', () => document.getElementById('authSignInBtn')?.click(), true)
      );
    const header = el('header');
    header.appendChild(el('strong', '', `NOMS #${current.orderNumber}`));
    panel.replaceChildren(header, body);
    return;
  }
  const focused = document.activeElement as HTMLInputElement | null;
  const focusId = focused?.closest?.(`#${PANEL_ID}`) ? focused.dataset.nmlId || '' : '';
  const caret = focusId ? (focused?.selectionStart ?? null) : null;
  if (!panel) {
    panel = el('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'NOMS measurements');
    document.body.appendChild(panel);
  }
  attachPanelDrop(panel);
  panel.classList.toggle('collapsed', state.collapsed);
  panel.replaceChildren();

  const header = el('header');
  const title = el(
    'strong',
    '',
    `NOMS #${current.orderNumber}${current.customerName ? ` · ${current.customerName}` : ''}`
  );
  const link = el('a', '', 'NOMS ↗');
  link.href = `${NOMS}/order/${current.orderNumber}/measurements?form=${current.formId}&lang=${current.lang}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const toggle = actionButton(state.collapsed ? 'Show' : 'Hide', () => {
    state.collapsed = !state.collapsed;
    render();
  });
  header.append(title, link, toggle);
  panel.appendChild(header);

  const body = el('div', 'nml-body');
  if (state.status) body.appendChild(el('div', `nml-status ${state.statusKind}`, state.status));
  if (state.signIn) {
    const signIn = el('a', '', 'Sign in to CW40 ↗');
    (signIn as HTMLAnchorElement).href = state.signIn;
    (signIn as HTMLAnchorElement).target = '_blank';
    const row = el('div', 'nml-row');
    row.append(
      signIn,
      actionButton('Try again', () => loadForm())
    );
    body.appendChild(row);
  }
  if (state.drift) {
    const banner = el('div', 'nml-drift');
    banner.appendChild(
      el(
        'span',
        '',
        `NOMS has newer values for ${fieldList(state.drift.items)} (changed since ${agoText(state.drift.at)}). You changed them here too.`
      )
    );
    const row = el('div', 'nml-row');
    row.append(
      actionButton('Keep mine', () => resolveDrift(false)),
      actionButton('Use NOMS', () => resolveDrift(true), true)
    );
    banner.title = state.drift.items
      .map(d => `${d.field}: NOMS ${d.now || 'empty'}, yours ${d.mine || 'empty'} ${state.unit}`)
      .join('\n');
    banner.appendChild(row);
    body.appendChild(banner);
  }
  if (!state.content) {
    if (!state.loading && !state.signIn)
      body.appendChild(actionButton('Load from NOMS', () => loadForm(), true));
    panel.appendChild(body);
    return;
  }

  const typeRow = el('div', 'nml-row nml-type-in');
  typeRow.setAttribute('role', 'group');
  typeRow.setAttribute('aria-label', 'Unit to type in');
  typeRow.appendChild(el('span', '', 'Type in:'));
  for (const unit of ['in', 'cm'] as InputUnit[]) {
    const button = el('button', unit === inputUnit() ? 'nml-unit on' : 'nml-unit', unit);
    button.type = 'button';
    button.setAttribute('aria-pressed', unit === inputUnit() ? 'true' : 'false');
    button.addEventListener('click', () => setInputUnit(unit));
    typeRow.appendChild(button);
  }
  if (inputUnit() !== state.unit)
    typeRow.appendChild(
      el('span', 'nml-hint', `saved to NOMS in ${state.unit === 'in' ? 'inches' : 'cm'}`)
    );
  body.appendChild(typeRow);

  const viewId = currentViewId();
  const boundKey = current.viewBindings?.[viewId] || '';
  const isDiagram = Object.values(current.diagramViews || {}).includes(viewId);
  const linkRow = el('div', 'nml-row');
  linkRow.appendChild(el('span', '', 'This image:'));
  const select = el('select');
  select.setAttribute('aria-label', 'Form model for this image');
  const none = el('option', '', 'Not linked');
  none.value = '';
  select.appendChild(none);
  for (const model of state.models) {
    const option = el('option', '', model.title);
    option.value = model.key;
    option.selected = model.key === boundKey;
    select.appendChild(option);
  }
  select.disabled = isDiagram || !viewId;
  select.addEventListener('change', () => {
    linkView(viewId, select.value);
    render();
  });
  linkRow.appendChild(select);
  body.appendChild(linkRow);

  const unitRow = el('div', 'nml-row');
  unitRow.appendChild(el('span', '', `Form unit: ${state.unit === 'in' ? 'inches' : 'cm'}`));
  body.appendChild(unitRow);
  body.appendChild(pdfDropZone());
  const review = currentReview();
  if (review) body.appendChild(reviewStrip(review));

  const linkRow2 = el('div', 'nml-row');
  linkRow2.append(
    actionButton('Suggest links', () => suggestLinks()),
    el(
      'span',
      'nml-hint',
      "Link a letter to any drawn line when your own letters differ from the form's."
    )
  );
  body.appendChild(linkRow2);

  // Boxes are typed and shown in `typed`; values are kept and saved in the form's unit.
  const typed = inputUnit();
  const other = typed === 'in' ? 'cm' : 'in';
  const lines = allLines();
  const dropValues = new Map((current.dropReview?.values || []).map(v => [v.id, v]));
  for (const model of state.models) {
    const flaggedHere = model.fields.some(f => review?.rows[`${model.key}|${f}`]?.flags.length);
    if (state.onlyFlagged && review && !flaggedHere) continue;
    const box = el('div', 'nml-model');
    box.appendChild(el('h3', '', model.title));
    const tools = el('div', 'nml-row');
    const diagramView = current.diagramViews?.[model.key];
    if (diagramView && projectManager()?.views?.[diagramView]) {
      tools.appendChild(
        actionButton('Go to diagram', () => projectManager()?.switchView?.(diagramView, true))
      );
    } else {
      tools.appendChild(actionButton('Add CW diagram', () => addDiagram(model.key)));
    }
    if (viewId && !isDiagram) {
      tools.appendChild(
        actionButton('Put lines on this image', () => placeLinesOnCurrent(model.key))
      );
    }
    box.appendChild(tools);
    const values = state.values[model.key] || {};
    const issues = measureIssues(
      model.rules,
      Object.fromEntries(model.fields.map(f => [f, parseMeasure(values[f] ?? '') ?? ''])),
      state.unit
    );
    const grid = el('div', 'nml-grid');
    for (const field of model.fields) {
      const row = review?.rows[`${model.key}|${field}`];
      if (state.onlyFlagged && review && !row?.flags.length) continue;
      const value = values[field] ?? '';
      const parsed = parseMeasure(value);
      const input = el('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = formToTyped(value, state.unit, typed);
      input.dataset.nmlId = `${model.key}|${field}`;
      if (state.highlight.has(input.dataset.nmlId) && Date.now() < state.highlightUntil)
        input.classList.add('nml-filled');
      input.setAttribute('aria-label', `${field} in ${typed}`);
      input.addEventListener('change', () => {
        // Convert at the panel boundary only: the value kept is in the form's unit.
        const next = typedToForm(input.value, typed, state.unit);
        setValue(model.key, field, next === null ? input.value : next);
        render();
      });
      const letter = letterLines(model.key, field, lines);
      const onThisImage = letter.lines.filter(line => line.viewId === viewId);
      const feeding = letter.linked ? letter.lines : onThisImage;
      const message =
        parsed === null ? 'Not a number' : issues.errors[field] || issues.warnings[field] || '';
      const hint = el(
        'span',
        `nml-hint${parsed === null || issues.errors[field] ? ' error' : message ? ' warn' : ''}`,
        message ||
          (parsed
            ? `= ${convertMeasure(parsed, state.unit, other)} ${other}`
            : linesLackValue(feeding)
              ? 'no value on the line'
              : '')
      );
      let draw: HTMLElement;
      if (letter.linked && letter.link) {
        const where = `${viewTitle(letter.link.viewId)} ${letter.link.label}`;
        draw = el(
          'span',
          `nml-line${letter.lines.length ? '' : ' gone'}`,
          letter.lines.length ? `✓ ${where}` : `${where} is gone`
        );
        draw.title = letter.lines.length
          ? `${field} follows the line ${where}`
          : `The line ${where} is no longer in the project. Unlink or pick another.`;
      } else if (onThisImage.length) {
        draw = el('span', 'nml-line', '✓ line');
      } else {
        draw = actionButton('Draw', () => armLetter(model.key, field));
      }
      const link = el('button', `nml-link-btn${letter.linked ? ' on' : ''}`, '⛓');
      link.type = 'button';
      link.title = letter.linked
        ? `Change or unlink the line for ${field}`
        : `Link ${field} to a drawn line`;
      link.setAttribute('aria-label', link.title);
      link.addEventListener('click', () => chooseLine(model.key, field));
      const mark = el(
        'span',
        `nml-mark${row ? (row.flags.length ? ' warn' : ' ok') : ''}`,
        row ? (row.flags.length ? '⚠' : '✓') : ''
      );
      if (row)
        mark.title = row.flags.length ? row.flags.map(f => f.reason).join('\n') : 'Matched the PDF';
      grid.append(mark, el('span', 'nml-key', field), input, hint, draw, link);
      if (row?.flags.length) {
        const why = el('div', 'nml-why');
        why.appendChild(el('span', '', row.flags.map(f => f.reason).join('; ')));
        const from = dropValues.get(row.from);
        if (from?.range && row.flags.some(f => f.kind === 'range')) {
          why.appendChild(
            rangePills(
              from.range,
              from.unit === 'inch' ? 'in' : 'cm',
              dropNumber(from, current.dropReview?.picks),
              picked => pickRange(from, picked)
            )
          );
        }
        grid.appendChild(why);
      }
    }
    box.appendChild(grid);
    body.appendChild(box);
  }

  const unsaved = changedFields(state.saved, state.values);
  const footer = el('div', 'nml-row nml-send');
  const send = actionButton(
    state.sending ? 'Sending…' : unsaved.length ? `Send ${unsaved.length} to NOMS` : 'Send to NOMS',
    () => sendToNoms(),
    true
  );
  send.disabled = state.sending;
  send.title =
    'Save the values to the CW40 form, make the customer PDF in cm, and show a summary for SZ';
  const tickLabel = el('label', 'nml-tick');
  const tick = el('input');
  tick.type = 'checkbox';
  tick.checked = state.confirmTick ?? state.confirmed;
  tick.addEventListener('change', () => {
    state.confirmTick = tick.checked;
  });
  tickLabel.append(tick, document.createTextNode(' Confirm the form'));
  footer.append(
    send,
    tickLabel,
    actionButton('Reload from NOMS', async () => {
      if (unsaved.length && !window.confirm('Replace the values here with what NOMS has?')) return;
      await loadForm({ preferNoms: true });
    })
  );
  if (current.lastSentAt && !state.sending)
    footer.appendChild(actionButton('Summary', () => showSummary(current.cmPdfName || '')));
  footer.style.marginTop = '12px';
  if (state.progress.length) {
    const steps = el('div', 'nml-progress');
    for (const step of state.progress)
      steps.appendChild(
        el(
          'div',
          step.kind,
          `${step.kind === 'ok' ? '✓' : step.kind === 'error' ? '✗' : step.kind === 'skip' ? '·' : '…'} ${step.text}`
        )
      );
    body.appendChild(footer);
    body.appendChild(steps);
    panel.appendChild(body);
    restoreFocus(panel, focusId, caret);
    return;
  }
  body.appendChild(footer);
  panel.appendChild(body);
  restoreFocus(panel, focusId, caret);
}

function restoreFocus(panel: HTMLElement, focusId: string, caret: number | null): void {
  if (!focusId) return;
  const again = panel.querySelector<HTMLInputElement>(
    `input[data-nml-id="${CSS.escape(focusId)}"]`
  );
  again?.focus();
  if (again && caret !== null) again.setSelectionRange(caret, caret);
}

/** "28 values filled, 3 to check", the flagged-only filter, and PDF values that fill no letter. */
function reviewStrip(review: DropReview): HTMLElement {
  const strip = el('div', `nml-review${review.toCheck ? ' warn' : ''}`);
  const head = el('div', 'nml-row');
  head.appendChild(
    el(
      'strong',
      '',
      `${review.filled} value${review.filled === 1 ? '' : 's'} filled, ${review.toCheck ? `${review.toCheck} to check` : 'all matched'}`
    )
  );
  if (review.toCheck) {
    const filter = el('button', `nml-unit${state.onlyFlagged ? ' on' : ''}`, 'Only ⚠');
    filter.type = 'button';
    filter.setAttribute('aria-pressed', state.onlyFlagged ? 'true' : 'false');
    filter.title = 'Show only the letters to check';
    filter.addEventListener('click', () => {
      state.onlyFlagged = !state.onlyFlagged;
      render();
    });
    head.appendChild(filter);
  }
  if (state.lastGroups.length)
    head.appendChild(actionButton('Change matching', () => changeMatching()));
  head.appendChild(
    actionButton('Clear', () => {
      patchEntry({ dropReview: undefined });
      state.onlyFlagged = false;
      setStatus('Review cleared. The values stay as they are.', 'info');
    })
  );
  strip.appendChild(head);
  if (review.extras.length) {
    strip.appendChild(el('div', 'nml-hint', 'From the PDF, not on the form:'));
    for (const extra of review.extras) {
      const row = el('div', 'nml-extra');
      row.append(
        el('span', 'nml-mark warn', '⚠'),
        el('b', '', extra.label),
        el('span', '', `${extra.text} · ${extra.where} · ${extra.reason}`)
      );
      const select = el('select');
      select.setAttribute('aria-label', `Use ${extra.label} for a form letter`);
      const none = el('option', '', 'Use for…');
      none.value = '';
      select.appendChild(none);
      for (const model of state.models) {
        const group = el('optgroup');
        group.label = model.title;
        for (const field of model.fields) {
          const option = el('option', '', field);
          option.value = `${model.key}|${field}`;
          group.appendChild(option);
        }
        select.appendChild(group);
      }
      select.addEventListener('change', () => assignExtra(extra.id, select.value));
      row.appendChild(select);
      strip.appendChild(row);
    }
  }
  return strip;
}

function syncActiveOrder(): void {
  const all = orders();
  if (!state.order || !all[state.order]) {
    const fromUrl = new URLSearchParams(location.search).get('noms') || '';
    state.order = all[fromUrl] ? fromUrl : Object.keys(all)[0] || '';
    state.content = null;
    state.models = [];
    state.values = {};
    state.saved = {};
    state.status = '';
    state.canvasSnapshot.clear();
    state.drift = null;
    state.progress = [];
    state.originals = [];
    state.lastGroups = [];
    state.onlyFlagged = false;
    state.confirmTick = null;
  }
}

export function initNomsMeasureLink(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('message', onBridgeMessage);
  window.addEventListener('openpaint:noms-photo-imported', onPhotoImported);
  window.addEventListener('openpaint:noms-import-complete', event => {
    void onImportComplete(event);
  });
  window.addEventListener('openpaint:project-loaded', () => {
    state.order = '';
    syncActiveOrder();
    render();
    if (entry() && staff() && bridgeAvailable()) void loadForm();
  });
  window.addEventListener('openpaint:view-switched', () => render());
  authService.onAuthStateChange(() => render());
  let lastView = '';
  window.setInterval(() => {
    syncActiveOrder();
    if (!entry()) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }
    if (!document.getElementById(PANEL_ID)) render();
    if (!staff()) return;
    if (!state.content && !state.loading && !state.status && bridgeAvailable()) void loadForm();
    const editing = (document.activeElement as HTMLElement | null)?.closest?.(`#${PANEL_ID}`);
    if (state.content && pullFromLines() && !editing) render();
    const view = currentViewId();
    if (view !== lastView && !editing) {
      lastView = view;
      render();
    }
  }, 1200);
}
