// NOMS "Recheck" (Comfort Works staff, inside the NOMS panel).
//
// After the factory asks for some letters to be re-measured, Leigh ticks those
// letters, gives each a reason, and "Show for recheck" draws only their lines
// on every view with "B1 = 29 in (73.7 cm)" and the reason in red, so one
// screenshot tells the customer what to measure again and why. The set is kept
// in the order metadata (externalSources.nomsOrders[order].rechecks[]).
// Nothing here writes to NOMS or CW40, and line visibility is only borrowed:
// the saved project keeps every line as it was.

import type { NomsFormState } from './noms-measure-link';
import { getCheckObjectStrokeLabel } from './measurement-check-request';
import type { NormalizedCheckRequest } from './measurement-check-request';
import {
  PICK_LABELS,
  bothUnits,
  changeText,
  flaggedLetters,
  newRecheck,
  openItems,
  reasonText,
  recheckLabel,
  recheckListText,
  recheckStates,
  resolveItem,
  resolveRecheck,
  type Recheck,
  type RecheckItem,
  type RecheckPick,
} from './noms-recheck-core';
import type { MeasuredLine } from './noms-link-core';

type StateGetter = () => NomsFormState;

const PANEL_ID = 'nomsRecheckPanel';
const rc: {
  open: boolean;
  showing: boolean;
  /** Paused while a PDF export captures the views its own way. */
  paused: boolean;
  getState: StateGetter | null;
  status: string;
  signature: string;
  canvas: any;
} = {
  open: false,
  showing: false,
  paused: false,
  getState: null,
  status: '',
  signature: '',
  canvas: null,
};
let timer = 0;

// ---------------------------------------------------------------- app access
const app = (): any => (window as any).app || {};
const projectManager = (): any => app().projectManager;
const fabricCanvas = (): any => app().canvasManager?.fabricCanvas;
const currentViewId = (): string => String(projectManager()?.currentViewId || '').trim();
const host = (): NomsFormState | null => {
  try {
    return rc.getState?.() || null;
  } catch {
    return null;
  }
};

function rechecks(s: NomsFormState): Recheck[] {
  const list = s.entry?.rechecks;
  return Array.isArray(list) ? (list as Recheck[]) : [];
}
function openRecheck(s: NomsFormState): Recheck | null {
  return rechecks(s).find(r => r.status === 'open') || null;
}
function saveRechecks(s: NomsFormState, list: Recheck[]): void {
  s.patchRechecks(list);
}
/** Change the open recheck (made on first use); an empty one is dropped. */
function updateOpen(s: NomsFormState, change: (r: Recheck) => Recheck): void {
  const list = rechecks(s);
  const index = list.findIndex(r => r.status === 'open');
  const base = index >= 0 ? list[index] : newRecheck(s.unit, new Date().toISOString());
  const next = change(base);
  const out = list.slice();
  if (index >= 0) out.splice(index, 1);
  if (next.items.length || next.status === 'resolved') out.push(next);
  saveRechecks(s, out);
}
const itemId = (item: { key: string; field: string }): string => `${item.key}|${item.field}`;

function modelTitle(s: NomsFormState, key: string): string {
  return s.models.find(m => m.key === key)?.title || key;
}
function linesFor(s: NomsFormState, item: { key: string; field: string }): MeasuredLine[] {
  return s.letterLines(item.key, item.field);
}

// ---------------------------------------------------------------- canvas overlay
interface Shown {
  item: RecheckItem;
  label: string;
  text: string;
  reason: string;
}
/** Ticked letters with a line on the current view, by canvas label. */
function shownHere(s: NomsFormState): Map<string, Shown> {
  const view = currentViewId();
  const out = new Map<string, Shown>();
  for (const item of openItems(openRecheck(s))) {
    const value = s.values[item.key]?.[item.field] ?? item.value;
    const label = recheckLabel(item.field, value, s.unit, reasonText(item));
    for (const line of linesFor(s, item))
      if (line.viewId === view) out.set(line.label, { item, label: line.label, ...label });
  }
  return out;
}
function notDrawn(s: NomsFormState): Shown[] {
  return openItems(openRecheck(s))
    .filter(item => !linesFor(s, item).length)
    .map(item => ({
      item,
      label: item.field,
      ...recheckLabel(
        item.field,
        s.values[item.key]?.[item.field] ?? item.value,
        s.unit,
        reasonText(item)
      ),
    }));
}
/** Views (in project order) holding a line of a ticked letter. */
function viewsWithTicks(s: NomsFormState): string[] {
  const views = new Set<string>();
  for (const item of openItems(openRecheck(s)))
    for (const line of linesFor(s, item)) views.add(line.viewId);
  const order = Object.keys(projectManager()?.views || {});
  return order.filter(v => views.has(v)).concat(Array.from(views).filter(v => !order.includes(v)));
}

const isTagPart = (obj: any): boolean =>
  obj?.isTag === true ||
  obj?.isTagText === true ||
  obj?.isTagBackground === true ||
  obj?.isTagGroup === true;
const isMeasureObject = (obj: any): boolean =>
  Boolean(getCheckObjectStrokeLabel(obj)) ||
  isTagPart(obj) ||
  obj?.isConnectorLine === true ||
  Boolean(obj?.connectorLine) ||
  Boolean(obj?.connectedStroke);

/** Objects whose visibility is borrowed: the visibility they had, and what we set. */
const borrowed = new Map<any, { orig: boolean; applied: boolean }>();

function serializeAsBefore(obj: any): void {
  if (Object.prototype.hasOwnProperty.call(obj, '__nrcToObject')) return;
  for (const name of ['toObject', 'toDatalessObject']) {
    const original = obj[name];
    if (typeof original !== 'function') continue;
    // A save while the recheck is shown writes each line as it was before.
    obj[name] = function (this: any, ...args: unknown[]) {
      const out = original.apply(this, args);
      const kept = borrowed.get(this);
      if (kept && out && typeof out === 'object') out.visible = kept.orig;
      return out;
    };
  }
  obj.__nrcToObject = true;
}
function lend(obj: any, show: boolean): void {
  const kept = borrowed.get(obj);
  const visible = obj.visible !== false;
  if (!kept) {
    borrowed.set(obj, { orig: visible, applied: show });
    serializeAsBefore(obj);
  } else {
    // Changed by something else since we set it: that is the line's own state now.
    if (visible !== kept.applied) kept.orig = visible;
    kept.applied = show;
  }
  obj.visible = show;
}
function restoreAll(): void {
  borrowed.forEach((kept, obj) => {
    obj.visible = kept.orig;
    if (obj.__nrcToObject) {
      delete obj.toObject;
      delete obj.toDatalessObject;
      delete obj.__nrcToObject;
    }
  });
  borrowed.clear();
}

function enforce(): void {
  const s = host();
  const canvas = rc.canvas;
  if (!s || !canvas?.getObjects || !rc.showing || rc.paused) return;
  const wanted = shownHere(s);
  for (const obj of canvas.getObjects()) {
    if (!isMeasureObject(obj)) continue;
    const label = getCheckObjectStrokeLabel(obj);
    // The line and its connector stay; the tag is replaced by the recheck label.
    lend(obj, wanted.has(label) && !isTagPart(obj));
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
const BOLD = '700 14px system-ui, -apple-system, sans-serif';
const SMALL = '600 12px system-ui, -apple-system, sans-serif';
function labelBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rows: Array<{ text: string; reason: string }>,
  heading = ''
): void {
  const pad = 6;
  const maxReason = 240;
  const lines: Array<{ text: string; font: string; color: string }> = [];
  if (heading) lines.push({ text: heading, font: SMALL, color: '#475569' });
  for (const row of rows) {
    lines.push({ text: row.text, font: BOLD, color: '#0f172a' });
    ctx.font = SMALL;
    for (const part of row.reason ? wrapText(ctx, row.reason, maxReason) : [])
      lines.push({ text: part, font: SMALL, color: '#b91c1c' });
  }
  let width = 0;
  for (const line of lines) {
    ctx.font = line.font;
    width = Math.max(width, ctx.measureText(line.text).width);
  }
  const lineHeight = 17;
  const w = width + pad * 2;
  const h = lines.length * lineHeight + pad * 2 - 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.strokeStyle = '#f47636';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, 6);
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, x + pad, y + pad + i * lineHeight + (line.font === SMALL ? 1 : 0));
  });
  ctx.restore();
}
/** The capture frame's top-left in canvas CSS pixels, so the box lands in Copy Image. */
function frameCorner(canvas: any): { x: number; y: number } {
  const frame = document.getElementById('captureFrame');
  const el: HTMLCanvasElement | undefined = canvas?.lowerCanvasEl;
  if (!frame || !el) return { x: 10, y: 10 };
  const f = frame.getBoundingClientRect();
  const c = el.getBoundingClientRect();
  if (f.width <= 0 || f.right < c.left || f.left > c.right) return { x: 10, y: 10 };
  return { x: Math.max(0, f.left - c.left) + 10, y: Math.max(0, f.top - c.top) + 10 };
}
function paint(event: any): void {
  const ctx: CanvasRenderingContext2D | undefined = event?.ctx;
  const canvas = rc.canvas;
  const s = host();
  if (!ctx || !canvas || !s || !rc.showing || rc.paused) return;
  const wanted = shownHere(s);
  const placed = new Set<string>();
  for (const obj of canvas.getObjects()) {
    const label = String(obj?.strokeLabel || getCheckObjectStrokeLabel(obj) || '');
    const shown = wanted.get(label);
    if (!shown || placed.has(label)) continue;
    // Prefer the tag's place; a line without a tag gets the label at its middle.
    const isTag = obj?.isTag === true;
    const isStroke = !isTagPart(obj) && !obj?.isConnectorLine && !obj?.connectedStroke;
    if (!isTag && !isStroke) continue;
    if (!isTag && canvas.getObjects().some((o: any) => o?.isTag && o.strokeLabel === label))
      continue;
    let rect: { left: number; top: number; width: number; height: number };
    try {
      rect = obj.getBoundingRect(false, true);
    } catch {
      continue;
    }
    const x = isTag ? rect.left : rect.left + rect.width / 2;
    const y = isTag ? rect.top : rect.top + rect.height / 2;
    labelBox(ctx, x, y, [shown]);
    placed.add(label);
  }
  const missing = notDrawn(s);
  if (missing.length) {
    const corner = frameCorner(canvas);
    labelBox(ctx, corner.x, corner.y, missing, 'Not drawn');
  }
}

function attachCanvas(): void {
  const canvas = fabricCanvas();
  if (!canvas || canvas === rc.canvas) return;
  detachCanvas();
  rc.canvas = canvas;
  canvas.on('before:render', enforce);
  canvas.on('after:render', paint);
}
function detachCanvas(): void {
  const canvas = rc.canvas;
  if (!canvas) return;
  canvas.off?.('before:render', enforce);
  canvas.off?.('after:render', paint);
  rc.canvas = null;
}
function redraw(): void {
  fabricCanvas()?.requestRenderAll?.();
}
function setShowing(on: boolean): void {
  rc.showing = on;
  if (on) attachCanvas();
  else restoreAll();
  redraw();
  renderPanel();
}

// ---------------------------------------------------------------- export
async function copyImage(): Promise<void> {
  if (!rc.showing) setShowing(true);
  const canvas = fabricCanvas();
  canvas?.renderAll?.();
  const button = document.getElementById('copyCanvasBtn');
  if (!button) {
    setStatus('Copy Image is not available here.');
    return;
  }
  button.click();
  setStatus(`Copied ${projectViewTitle(currentViewId())} with the recheck labels.`);
}
function projectViewTitle(viewId: string): string {
  const s = host();
  return s ? s.viewTitle(viewId) : viewId;
}
async function copyList(): Promise<void> {
  const s = host();
  const recheck = s && openRecheck(s);
  if (!s || !recheck) return;
  const items = openItems(recheck);
  const text = recheckListText({
    orderNumber: s.entry?.orderNumber || s.order,
    customerName: s.entry?.customerName,
    unit: s.unit,
    items,
    values: s.values,
    titles: Object.fromEntries(s.models.map(m => [m.key, m.title])),
  });
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied the recheck list (${items.length} letter${items.length === 1 ? '' : 's'}).`);
  } catch {
    window.prompt('Copy the recheck list', text);
  }
}
async function exportPdf(): Promise<void> {
  const s = host();
  const recheck = s && openRecheck(s);
  if (!s || !recheck) return;
  // One page per view (and capture tab) holding a ticked letter's line.
  const pages = new Map<string, { view: string; tab?: string; codes: Set<string> }>();
  const rowNotes: Record<string, string> = {};
  const skipped: string[] = [];
  for (const item of openItems(recheck)) {
    const lines = linesFor(s, item);
    if (!lines.length) skipped.push(item.field);
    for (const line of lines) {
      const tab = line.scope.includes('::tab:') ? line.scope.split('::tab:')[1] : undefined;
      const id = `${line.viewId}|${tab || ''}`;
      const page = pages.get(id) || { view: line.viewId, tab, codes: new Set<string>() };
      page.codes.add(line.label);
      pages.set(id, page);
      const reason = reasonText(item);
      if (reason) rowNotes[line.label] = reason;
    }
  }
  if (!pages.size) {
    setStatus('None of the ticked letters has a line on a view, so there is nothing to export.');
    return;
  }
  const orderNumber = s.entry?.orderNumber || s.order;
  const request: NormalizedCheckRequest = {
    specVersion: 1,
    title: `${orderNumber} recheck`,
    unit: 'as-entered',
    output: { png: false, pdf: true, zip: false, scale: 2 },
    pages: Array.from(pages.values()).map(page => ({
      view: page.view,
      ...(page.tab ? { tab: page.tab } : {}),
      codes: Array.from(page.codes),
      title: s.viewTitle(page.view),
    })),
  };
  setStatus('Making the recheck PDF…');
  const wasShowing = rc.showing;
  rc.paused = true;
  restoreAll();
  try {
    const { exportMeasurementCheckRequest } = await import('./pdf-export-inline');
    await exportMeasurementCheckRequest(request, {
      output: { png: false, pdf: true, zip: false },
      rowNotes,
      onProgress: (text: string) => setStatus(text),
    });
    setStatus(
      `Recheck PDF ready.${skipped.length ? ` Not drawn, so not in the PDF: ${skipped.join(', ')}.` : ''}`
    );
  } catch (error) {
    setStatus(`The recheck PDF failed: ${String((error as Error)?.message || error)}`);
  } finally {
    rc.paused = false;
    if (wasShowing) redraw();
  }
}

// ---------------------------------------------------------------- panel
function setStatus(text: string): void {
  rc.status = text;
  renderPanel();
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
function button(label: string, run: () => unknown, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'primary' : '', label);
  b.type = 'button';
  b.addEventListener('click', () => {
    void Promise.resolve()
      .then(run)
      .catch(error => setStatus(String((error as Error)?.message || error)));
  });
  return b;
}
function ensureStyles(): void {
  if (document.getElementById(`${PANEL_ID}Styles`)) return;
  const style = document.createElement('style');
  style.id = `${PANEL_ID}Styles`;
  style.textContent = `
    #${PANEL_ID} { position: fixed; left: 16px; bottom: 16px; z-index: 11901; width: min(430px, calc(100vw - 32px));
      max-height: min(78vh, 760px); overflow: auto; background: #fff; border: 1px solid #dbe1ea; border-radius: 10px;
      box-shadow: 0 14px 40px rgba(15, 23, 42, .18); font: 12px/1.4 system-ui, sans-serif; color: #0f172a; }
    #${PANEL_ID} header { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; align-items: center; padding: 10px 12px;
      background: #fef2f2; border-bottom: 1px solid #fecaca; }
    #${PANEL_ID} header strong { flex: 1; font-size: 13px; }
    #${PANEL_ID} button { height: 26px; padding: 0 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff;
      color: #0f172a; font: inherit; font-weight: 600; cursor: pointer; }
    #${PANEL_ID} button.primary { background: #f47636; border-color: #f47636; color: #fff; }
    #${PANEL_ID} button.on { background: #0f172a; border-color: #0f172a; color: #fff; }
    #${PANEL_ID} .nrc-body { padding: 10px 12px 12px; }
    #${PANEL_ID} .nrc-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
    #${PANEL_ID} .nrc-status { margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; background: #f1f5f9; }
    #${PANEL_ID} .nrc-model { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e2e8f0; }
    #${PANEL_ID} .nrc-model h3 { margin: 0 0 4px; font-size: 12px; }
    #${PANEL_ID} .nrc-letter { display: grid; grid-template-columns: 18px 26px 1fr auto; gap: 2px 6px; align-items: center; padding: 3px 0; }
    #${PANEL_ID} .nrc-letter.ticked { background: #fff7ed; border-radius: 6px; }
    #${PANEL_ID} .nrc-letter b { font-weight: 700; }
    #${PANEL_ID} .nrc-warn { color: #b45309; font-weight: 700; }
    #${PANEL_ID} .nrc-ok { color: #16a34a; font-weight: 700; }
    #${PANEL_ID} .nrc-muted { color: #64748b; }
    #${PANEL_ID} .nrc-gone { color: #b45309; }
    #${PANEL_ID} .nrc-reason { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-bottom: 4px; }
    #${PANEL_ID} .nrc-reason select, #${PANEL_ID} .nrc-reason input { height: 24px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 5px; font: inherit; }
    #${PANEL_ID} .nrc-reason input[type=text] { flex: 1; min-width: 120px; }
    #${PANEL_ID} .nrc-change { grid-column: 2 / -1; color: #1d4ed8; font-weight: 600; }
    #${PANEL_ID} .nrc-views button { height: 22px; padding: 0 7px; font-weight: 500; }
    #${PANEL_ID} details { margin-top: 10px; }
    #${PANEL_ID} details li { margin: 2px 0; }
    .nrc-strip { margin: 8px 0; padding: 6px 8px; border-radius: 8px; background: #fef2f2; border: 1px solid #fecaca; }
    .nrc-strip .nrc-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .nrc-strip strong { margin-right: auto; }
    .nrc-strip .nrc-change { color: #1d4ed8; }
  `;
  document.head.appendChild(style);
}

function letterRow(
  s: NomsFormState,
  model: NomsFormState['models'][number],
  field: string,
  ticked: RecheckItem | undefined,
  flag: string,
  recheck: Recheck | null
): HTMLElement[] {
  const row = el('div', `nrc-letter${ticked ? ' ticked' : ''}`);
  const box = el('input');
  box.type = 'checkbox';
  box.checked = Boolean(ticked);
  box.setAttribute('aria-label', `Recheck ${field}`);
  box.addEventListener('change', () => toggleLetter(s, model.key, field, box.checked));
  const value = s.values[model.key]?.[field] ?? '';
  const lines = linesFor(s, { key: model.key, field });
  const views = new Set(lines.map(l => l.viewId));
  const mark = el('span', flag ? 'nrc-warn' : 'nrc-muted', flag ? '⚠' : '');
  if (flag) mark.title = flag;
  const info = el('span');
  info.append(
    document.createTextNode(bothUnits(value, s.unit) || 'no value'),
    document.createTextNode(' '),
    mark
  );
  const where = el(
    'span',
    lines.length ? 'nrc-ok' : 'nrc-gone',
    lines.length ? `line on ${views.size} view${views.size === 1 ? '' : 's'}` : 'not drawn'
  );
  where.title = lines.length
    ? Array.from(views)
        .map(v => s.viewTitle(v))
        .join(', ')
    : 'No line for this letter on any diagram or photo';
  row.append(box, el('b', '', field), info, where);
  const out: HTMLElement[] = [row];
  if (!ticked) return out;

  const reason = el('div', 'nrc-reason');
  const pick = el('select');
  pick.setAttribute('aria-label', `Reason for ${field}`);
  const options: Array<[RecheckPick, string]> = [['', 'Reason…']];
  if (ticked.ruleText) options.push(['rule', `Rule failed: ${ticked.ruleText}`]);
  for (const k of ['large', 'small', 'mismatch', 'unclear', 'factory'] as RecheckPick[])
    options.push([k, PICK_LABELS[k as Exclude<RecheckPick, ''>]]);
  for (const [k, label] of options) {
    const option = el('option', '', label);
    option.value = k;
    option.selected = ticked.pick === k;
    pick.appendChild(option);
  }
  pick.addEventListener('change', () =>
    patchItem(s, model.key, field, { pick: pick.value as RecheckPick })
  );
  reason.appendChild(pick);
  if (ticked.pick === 'mismatch') {
    const other = el('select');
    other.setAttribute('aria-label', `Letter ${field} does not match`);
    const none = el('option', '', 'letter…');
    none.value = '';
    other.appendChild(none);
    for (const f of model.fields.filter(f => f !== field)) {
      const option = el('option', '', f);
      option.value = f;
      option.selected = ticked.other === f;
      other.appendChild(option);
    }
    other.addEventListener('change', () => patchItem(s, model.key, field, { other: other.value }));
    reason.appendChild(other);
  }
  const detail = el('input');
  detail.type = 'text';
  detail.value = ticked.detail || '';
  detail.placeholder = ticked.pick === 'factory' ? 'What the factory said' : 'Note (optional)';
  detail.dataset.nrcId = `${model.key}|${field}`;
  detail.setAttribute('aria-label', `Reason note for ${field}`);
  detail.addEventListener('change', () => patchItem(s, model.key, field, { detail: detail.value }));
  reason.appendChild(detail);
  out.push(reason);

  const state = recheck ? recheckStates(recheck, s.values).find(x => x.item === ticked) : null;
  if (state?.changed) {
    const change = el('div', 'nrc-change');
    change.append(
      document.createTextNode(`${changeText(state.was, state.now)} ${s.unit} `),
      button('Resolve', () => {
        updateOpen(s, r => resolveItem(r, model.key, field, s.values, new Date().toISOString()));
        refresh();
      })
    );
    out.push(change);
  }
  return out;
}

function toggleLetter(s: NomsFormState, key: string, field: string, on: boolean): void {
  updateOpen(s, r => {
    const items = r.items.filter(i => !(i.key === key && i.field === field && !i.resolvedAt));
    if (on) {
      const flagged = flaggedLetters(
        s.models.filter(m => m.key === key),
        s.values,
        s.unit,
        s.review?.rows
      ).find(f => f.field === field);
      items.push({
        key,
        field,
        pick: flagged?.pick || '',
        ...(flagged?.ruleText ? { ruleText: flagged.ruleText } : {}),
        ...(flagged?.detail ? { detail: flagged.detail } : {}),
        value: s.values[key]?.[field] ?? '',
      });
    }
    return { ...r, items };
  });
  refresh();
}
function patchItem(s: NomsFormState, key: string, field: string, patch: Partial<RecheckItem>) {
  updateOpen(s, r => ({
    ...r,
    items: r.items.map(i =>
      i.key === key && i.field === field && !i.resolvedAt ? { ...i, ...patch } : i
    ),
  }));
  refresh();
}
function selectAllFlagged(s: NomsFormState): void {
  const flagged = flaggedLetters(s.models, s.values, s.unit, s.review?.rows);
  if (!flagged.length) {
    setStatus('No letter is flagged ⚠ right now.');
    return;
  }
  let added = 0;
  updateOpen(s, r => {
    const have = new Set(openItems(r).map(itemId));
    const items = r.items.slice();
    for (const f of flagged) {
      if (have.has(itemId(f))) continue;
      items.push({ ...f, value: s.values[f.key]?.[f.field] ?? '' });
      added += 1;
    }
    return { ...r, items };
  });
  rc.status = `Ticked ${added} flagged letter${added === 1 ? '' : 's'}.`;
  refresh();
}
function resolveAll(s: NomsFormState): void {
  updateOpen(s, r => resolveRecheck(r, s.values, new Date().toISOString()));
  rc.status = 'Recheck resolved. It stays in the history below.';
  if (rc.showing) setShowing(false);
  refresh();
}

function historyBlock(s: NomsFormState): HTMLElement | null {
  const done = rechecks(s).filter(r => r.status === 'resolved');
  if (!done.length) return null;
  const details = el('details');
  details.appendChild(el('summary', '', `History (${done.length} resolved)`));
  for (const r of done.slice().reverse()) {
    const when = new Date(r.resolvedAt || r.createdAt).toLocaleDateString();
    details.appendChild(
      el('div', 'nrc-muted', `${new Date(r.createdAt).toLocaleDateString()} to ${when}`)
    );
    const list = el('ul');
    for (const st of recheckStates(r, s.values)) {
      const why = reasonText(st.item);
      const change = changeText(st.was, st.now);
      list.appendChild(
        el(
          'li',
          '',
          `${st.item.field}: ${change ? `${change} ${r.unit}` : `${bothUnits(st.was, r.unit) || 'no value'}, unchanged`}${why ? ` · ${why}` : ''}`
        )
      );
    }
    details.appendChild(list);
  }
  return details;
}

function renderPanel(): void {
  const s = host();
  let panel = document.getElementById(PANEL_ID);
  if (!rc.open || !s || !s.entry) {
    panel?.remove();
    return;
  }
  ensureStyles();
  const focused = document.activeElement as HTMLInputElement | null;
  const focusId = focused?.closest?.(`#${PANEL_ID}`) ? focused.dataset.nrcId || '' : '';
  if (!panel) {
    panel = el('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'NOMS recheck');
    document.body.appendChild(panel);
  }
  const scroll = panel.scrollTop;
  panel.replaceChildren();
  const recheck = openRecheck(s);
  const items = openItems(recheck);

  const header = el('header');
  header.append(
    el('strong', '', `Recheck #${s.entry.orderNumber || s.order}`),
    button('Close', () => closeRecheck())
  );
  panel.appendChild(header);
  const body = el('div', 'nrc-body');
  if (rc.status) body.appendChild(el('div', 'nrc-status', rc.status));

  const tools = el('div', 'nrc-row');
  tools.appendChild(button('Select all flagged', () => selectAllFlagged(s)));
  const show = button(
    rc.showing ? 'Showing for recheck' : 'Show for recheck',
    () => setShowing(!rc.showing),
    !rc.showing
  );
  if (rc.showing) show.classList.add('on');
  show.disabled = !items.length;
  show.setAttribute('aria-pressed', rc.showing ? 'true' : 'false');
  tools.appendChild(show);
  body.appendChild(tools);

  const exportRow = el('div', 'nrc-row');
  const copyImg = button('Copy recheck image', () => copyImage());
  const copyTxt = button('Copy recheck list', () => copyList());
  const pdf = button('Export recheck PDF', () => exportPdf());
  for (const b of [copyImg, copyTxt, pdf]) b.disabled = !items.length;
  exportRow.append(copyImg, copyTxt, pdf);
  if (recheck) exportRow.appendChild(button('Resolve', () => resolveAll(s)));
  body.appendChild(exportRow);

  const views = viewsWithTicks(s);
  if (items.length) {
    const strip = el('div', 'nrc-row nrc-views');
    strip.appendChild(
      el('span', 'nrc-muted', views.length ? 'Views:' : 'No ticked letter is drawn.')
    );
    const here = currentViewId();
    views.forEach(viewId => {
      const b = button(s.viewTitle(viewId), () => projectManager()?.switchView?.(viewId, true));
      if (viewId === here) b.classList.add('on');
      strip.appendChild(b);
    });
    if (views.length > 1) {
      const step = (by: number) => {
        const at = views.indexOf(here);
        const next = views[(at + by + views.length) % views.length];
        if (next) void projectManager()?.switchView?.(next, true);
      };
      strip.append(
        button('‹', () => step(-1)),
        button('›', () => step(1))
      );
    }
    body.appendChild(strip);
    if (recheck)
      body.appendChild(
        el(
          'div',
          'nrc-muted',
          `Open since ${new Date(recheck.createdAt).toLocaleDateString()} · ${items.length} letter${items.length === 1 ? '' : 's'}`
        )
      );
  }

  if (!s.models.length) {
    body.appendChild(el('div', 'nrc-muted', 'Load the form from NOMS to list its letters.'));
  }
  const flags = new Map(
    flaggedLetters(s.models, s.values, s.unit, s.review?.rows).map(f => [
      itemId(f),
      f.pick === 'rule' ? f.ruleText || '' : f.detail || '',
    ])
  );
  const ticked = new Map(items.map(i => [itemId(i), i]));
  for (const model of s.models) {
    const box = el('div', 'nrc-model');
    box.appendChild(el('h3', '', model.title));
    for (const field of model.fields) {
      const id = `${model.key}|${field}`;
      box.append(...letterRow(s, model, field, ticked.get(id), flags.get(id) || '', recheck));
    }
    body.appendChild(box);
  }
  const history = historyBlock(s);
  if (history) body.appendChild(history);
  panel.appendChild(body);
  panel.scrollTop = scroll;
  if (focusId)
    panel.querySelector<HTMLInputElement>(`input[data-nrc-id="${CSS.escape(focusId)}"]`)?.focus();
  rc.signature = signature(s);
}

function signature(s: NomsFormState): string {
  return JSON.stringify([
    s.order,
    s.values,
    s.entry?.rechecks || [],
    currentViewId(),
    s.models.length,
    s.review?.toCheck ?? -1,
  ]);
}
function refresh(): void {
  renderPanel();
  host()?.render();
  redraw();
}

function closeRecheck(): void {
  rc.open = false;
  rc.status = '';
  setShowing(false);
  detachCanvas();
  window.clearInterval(timer);
  timer = 0;
  document.getElementById(PANEL_ID)?.remove();
}

let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('openpaint:view-switched', () => {
    if (!rc.open) return;
    // The canvas holds the new view's objects; borrowed ones from the last view are gone.
    borrowed.forEach((_kept, obj) => {
      if (!rc.canvas?.getObjects?.().includes(obj)) borrowed.delete(obj);
    });
    attachCanvas();
    renderPanel();
    redraw();
  });
  window.addEventListener('openpaint:project-loaded', () => {
    if (rc.open) closeRecheck();
  });
}

/** Open or close the Recheck mode (the NOMS panel's Recheck button). */
export function toggleNomsRecheck(getState: StateGetter): void {
  rc.getState = getState;
  if (rc.open) {
    closeRecheck();
    return;
  }
  listen();
  rc.open = true;
  rc.status = '';
  attachCanvas();
  renderPanel();
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    const s = host();
    if (!rc.open || !s?.entry) {
      closeRecheck();
      return;
    }
    const editing = (document.activeElement as HTMLElement | null)?.closest?.(`#${PANEL_ID}`);
    if (!editing && signature(s) !== rc.signature) {
      renderPanel();
      redraw();
    }
  }, 1200);
}

/** The open recheck in the NOMS panel: letters, changed values, Open and Resolve. */
export function nomsRecheckStrip(getState: StateGetter): HTMLElement | null {
  rc.getState = getState;
  const s = host();
  if (!s) return null;
  const recheck = openRecheck(s);
  const items = openItems(recheck);
  if (!recheck || !items.length) return null;
  ensureStyles();
  const states = recheckStates(recheck, s.values).filter(x => !x.item.resolvedAt);
  const changed = states.filter(x => x.changed);
  const strip = el('div', 'nrc-strip');
  const row = el('div', 'nrc-row');
  row.appendChild(
    el(
      'strong',
      '',
      `Recheck open: ${items.map(i => i.field).join(', ')}${changed.length ? ` (${changed.length} changed)` : ''}`
    )
  );
  if (!rc.open) row.appendChild(button('Open', () => toggleNomsRecheck(getState)));
  row.appendChild(button('Resolve', () => resolveAll(s)));
  strip.appendChild(row);
  for (const st of changed)
    strip.appendChild(
      el(
        'div',
        'nrc-change',
        `${st.item.field} (${modelTitle(s, st.item.key)}): ${changeText(st.was, st.now)} ${s.unit}`
      )
    );
  return strip;
}
