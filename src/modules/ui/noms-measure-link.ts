// NOMS measurement link (Comfort Works staff only).
//
// A project opened from a NOMS order (OMNOMS "Open in SofaPaint") remembers its
// order and CW40 measure form in project metadata (externalSources.nomsOrders).
// This panel shows that form's measurements, lets each image be linked to one
// form model, adds the CW40 diagram for a model as an image with editable lines,
// puts the same lines on a photo, and keeps the values in step: a value typed
// here goes onto every linked line with that letter, and a value changed on a
// line comes back here. "Save to NOMS" writes the form through OMNOMS, using
// the person's own CW40 sign-in in this browser; SofaPaint's server is never
// involved in the save.

import { authService } from '../../services/auth/authService';
import { imageRegistry } from '../ImageRegistry.js';
import { setNextTagValue } from './next-tag-control';
import {
  importSvgMeasurements,
  stripSvgLabels,
  waitForGuideImportReady,
} from './measurement-guide-flash.js';
import {
  importCwFormPdf,
  isPdfFile,
  readCwFormPdfValues,
  type CwFormValueGroup,
} from './cw-form-pdf-import';
import {
  changedFields,
  convertMeasure,
  defaultFieldFor,
  formModels,
  modelGroups,
  pdfValueToForm,
  refineTargets,
  fromCanvasMeasurement,
  isComfortWorksStaff,
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
  productSku?: string;
  unit: 'in' | 'cm';
  confirmed: boolean;
  values: Values;
  viewBindings: Record<string, string>;
  diagramViews: Record<string, string>;
  lastSyncedAt?: string;
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
  state.canvasSnapshot.set(`${scope}|${field}`, value);
}
/** Put the panel's value for key/field on every linked line with that letter. */
function pushToLines(key: string, field: string): void {
  const value = state.values[key]?.[field] ?? '';
  for (const viewId of viewsForModel(key)) {
    for (const scope of strokeScopesFor(viewId, field)) {
      const existing = fromCanvasMeasurement(
        metadataManager()?.getMeasurement?.(scope, field),
        state.unit
      );
      if (value && existing !== value) writeLine(scope, field, value);
      else state.canvasSnapshot.set(`${scope}|${field}`, existing);
    }
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
  for (const model of state.models) {
    for (const field of model.fields) {
      for (const viewId of viewsForModel(model.key)) {
        for (const scope of strokeScopesFor(viewId, field)) {
          const id = `${scope}|${field}`;
          const onLine = fromCanvasMeasurement(
            metadataManager()?.getMeasurement?.(scope, field),
            state.unit
          );
          const seen = state.canvasSnapshot.get(id);
          if (seen === undefined) {
            // A line that has just appeared takes the form's value, if there is one.
            if (!onLine && state.values[model.key]?.[field])
              writeLine(scope, field, state.values[model.key][field]);
            else state.canvasSnapshot.set(id, onLine);
            if (onLine && !state.values[model.key]?.[field]) {
              setValue(model.key, field, onLine, scope);
              changed = true;
            }
            continue;
          }
          if (onLine && onLine !== seen) {
            state.canvasSnapshot.set(id, onLine);
            if (onLine !== state.values[model.key]?.[field]) {
              setValue(model.key, field, onLine, scope);
              changed = true;
            }
          }
        }
      }
    }
  }
  return changed;
}
function setValue(key: string, field: string, value: string, fromScope = ''): void {
  state.values = { ...state.values, [key]: { ...(state.values[key] || {}), [field]: value } };
  patchEntry({ values: state.values, unit: state.unit });
  // Copy to the other linked lines, but not back onto the line it came from.
  for (const viewId of viewsForModel(key)) {
    for (const scope of strokeScopesFor(viewId, field)) {
      if (scope !== fromScope && value) writeLine(scope, field, value);
    }
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
  state.unit = formUnit;
  state.saved = fromForm;
  if (options.preferNoms || !differs.length || !current.lastSyncedAt) {
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
  patchEntry({ values: state.values, unit: state.unit, confirmed: state.confirmed });
  state.canvasSnapshot.clear();
  pushAll();
  const unsaved = changedFields(state.saved, state.values);
  setStatus(
    unsaved.length
      ? `SofaPaint has ${unsaved.length} value${unsaved.length === 1 ? '' : 's'} not saved to NOMS yet.`
      : `In step with NOMS${state.confirmed ? ' (confirmed)' : ''}.`,
    unsaved.length ? 'info' : 'ok'
  );
}

async function saveForm(confirm: boolean): Promise<void> {
  const current = entry();
  if (!current || !state.content) return;
  const bad: string[] = [];
  for (const model of state.models) {
    for (const field of model.fields) {
      if (parseMeasure(state.values[model.key]?.[field] ?? '') === null) bad.push(field);
    }
  }
  if (bad.length) {
    setStatus(`Fix ${bad.join(', ')} first: not a number.`, 'error');
    return;
  }
  if (confirm) {
    const missing = state.models.flatMap(model =>
      Object.keys(measureIssues(model.rules, state.values[model.key] || {}, state.unit).errors)
    );
    if (missing.length) {
      setStatus(`Fill in ${missing.join(', ')} before confirming.`, 'error');
      return;
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
    return;
  }
  patchEntry({ lastSyncedAt: new Date().toISOString() });
  await loadForm({ preferNoms: true });
  setStatus(`Saved to NOMS${confirm || state.confirmed ? ' and confirmed' : ''}.`, 'ok');
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
// Drop the customer's filled measuring PDFs: each diagram is matched to the
// form models it measures (suggested from shared letters, changeable), letters
// map straight across where they match, the rest are picked by hand, and the
// values fill the panel in the form's unit. Nothing is saved until Save.
function pdfDropZone(): HTMLElement {
  const zone = el('div', 'nml-drop', 'Drop filled measurement PDFs here, or click to choose');
  const input = el('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.multiple = true;
  input.hidden = true;
  zone.appendChild(input);
  const take = (files: FileList | null) => {
    const pdfs = Array.from(files || []).filter(isPdfFile);
    if (pdfs.length) void readPdfs(pdfs);
  };
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => take(input.files));
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    event.stopPropagation();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    zone.classList.remove('over');
    take(event.dataTransfer?.files || null);
  });
  return zone;
}

async function readPdfs(files: File[]): Promise<void> {
  setStatus(`Reading ${files.map(f => f.name).join(', ')}…`);
  const groups: CwFormValueGroup[] = [];
  for (const file of files) {
    try {
      const found = await readCwFormPdfValues(file);
      if (!found.length) setStatus(`${file.name}: no filled measurements found.`, 'error');
      groups.push(...found);
    } catch (error) {
      setStatus(`${file.name} could not be read: ${(error as Error).message}`, 'error');
    }
  }
  if (!groups.length) return;
  const choice = await chooseMapping(groups);
  if (!choice) {
    setStatus('PDF values not used.', 'info');
    return;
  }
  let filled = 0;
  const skipped: string[] = [];
  for (const { group, targets, mapping } of choice.groups) {
    for (const { label, value } of group.values) {
      const field = mapping[label];
      if (!field) {
        skipped.push(`${label} (${group.file} p${group.pageNumber})`);
        continue;
      }
      for (const target of targets) {
        const fileKey = modelGroups(state.models).find(g => g.key === target)?.fields[field];
        if (!fileKey) continue;
        setValue(fileKey, field, pdfValueToForm(value, group.unit, state.unit));
        filled += 1;
      }
    }
  }
  if (choice.addImages) {
    for (const file of files) {
      try {
        await importCwFormPdf(file);
      } catch (error) {
        console.warn('[NOMS link] PDF pages could not be added as images', error);
      }
    }
  }
  render();
  const unsaved = changedFields(state.saved, state.values).length;
  setStatus(
    `Filled ${filled} value${filled === 1 ? '' : 's'} from the PDF${files.length > 1 ? 's' : ''}` +
      (skipped.length ? `. Not used: ${skipped.join(', ')}` : '') +
      `. ${unsaved} change${unsaved === 1 ? '' : 's'} to review, then Save to NOMS.`,
    skipped.length ? 'info' : 'ok'
  );
}

interface MappingChoice {
  addImages: boolean;
  groups: Array<{ group: CwFormValueGroup; targets: string[]; mapping: Record<string, string> }>;
}

function chooseMapping(groups: CwFormValueGroup[]): Promise<MappingChoice | null> {
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
        `Check what each diagram fills. Letters that match the form are filled as they are; only the ones that need a choice are listed. Values are converted to ${state.unit === 'in' ? 'inches' : 'cm'}.`
      )
    );
    const suggested = refineTargets(
      groups.map(group => ({
        file: group.file,
        title: group.title,
        labels: group.values.map(v => v.label),
      })),
      models,
      Object.fromEntries(models.map(m => [m.key, m.title]))
    );
    const state2 = groups.map((group, i) => ({
      group,
      targets: new Set(suggested[i]),
      mapping: {} as Record<string, string>,
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
        for (const { label, value } of entry.group.values) {
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
          row.append(el('b', '', label), el('span', '', String(+value.toFixed(3))), select);
          // Same letter on the form: nothing to decide, so keep it out of the way.
          row.hidden = !entry.showAll && entry.mapping[label] === label.replace(/\*$/, '');
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
    #${PANEL_ID} .nml-grid { display: grid; grid-template-columns: 22px 74px 1fr 46px; gap: 4px 6px; align-items: center; }
    #${PANEL_ID} .nml-grid input { width: 100%; box-sizing: border-box; }
    #${PANEL_ID} .nml-key { font-weight: 700; }
    #${PANEL_ID} .nml-hint { color: #64748b; }
    #${PANEL_ID} .nml-hint.error { color: #b91c1c; font-weight: 600; }
    #${PANEL_ID} .nml-hint.warn { color: #8a5a00; }
    #${PANEL_ID} .nml-line { color: #16a34a; font-weight: 700; }
    #${PANEL_ID}.collapsed .nml-body { display: none; }
    #${PANEL_ID} .nml-drop { margin: 8px 0; padding: 10px; border: 2px dashed #f4a77a; border-radius: 8px;
      background: #fffaf4; color: #9a3412; text-align: center; cursor: pointer; }
    #${PANEL_ID} .nml-drop.over { background: #ffedd5; border-color: #f47636; }
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
  if (!state.content) {
    if (!state.loading && !state.signIn)
      body.appendChild(actionButton('Load from NOMS', () => loadForm(), true));
    panel.appendChild(body);
    return;
  }

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

  const other = state.unit === 'in' ? 'cm' : 'in';
  for (const model of state.models) {
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
      const value = values[field] ?? '';
      const parsed = parseMeasure(value);
      const input = el('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = value;
      input.dataset.nmlId = `${model.key}|${field}`;
      input.setAttribute('aria-label', `${field} in ${state.unit}`);
      input.addEventListener('change', () => {
        const next = parseMeasure(input.value);
        setValue(model.key, field, next === null ? input.value : next);
        render();
      });
      const message =
        parsed === null ? 'Not a number' : issues.errors[field] || issues.warnings[field] || '';
      const hint = el(
        'span',
        `nml-hint${parsed === null || issues.errors[field] ? ' error' : message ? ' warn' : ''}`,
        message || (parsed ? `= ${convertMeasure(parsed, state.unit, other)} ${other}` : '')
      );
      const onThisImage =
        viewId &&
        (boundKey === model.key || diagramView === viewId) &&
        strokeScopesFor(viewId, field).length;
      const draw = onThisImage
        ? el('span', 'nml-line', '✓ line')
        : actionButton('Draw', () => armLetter(model.key, field));
      grid.append(el('span', 'nml-key', field), input, hint, draw);
    }
    box.appendChild(grid);
    body.appendChild(box);
  }

  const unsaved = changedFields(state.saved, state.values);
  const footer = el('div', 'nml-row');
  footer.style.marginTop = '12px';
  if (state.confirmed) {
    footer.appendChild(
      actionButton(
        unsaved.length ? `Save ${unsaved.length} to NOMS` : 'Save to NOMS',
        () => saveForm(true),
        true
      )
    );
  } else {
    footer.append(
      actionButton('Save and confirm', () => saveForm(true), true),
      actionButton('Save without confirming', () => saveForm(false))
    );
  }
  footer.appendChild(
    actionButton('Reload from NOMS', async () => {
      if (unsaved.length && !window.confirm('Replace the values here with what NOMS has?')) return;
      await loadForm({ preferNoms: true });
    })
  );
  body.appendChild(footer);
  panel.appendChild(body);

  if (focusId) {
    const again = panel.querySelector<HTMLInputElement>(
      `input[data-nml-id="${CSS.escape(focusId)}"]`
    );
    again?.focus();
    if (again && caret !== null) again.setSelectionRange(caret, caret);
  }
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
