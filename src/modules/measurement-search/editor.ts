import { fabric } from 'fabric';
import { formatMeasurement, type DisplayUnits, type Measurement } from './model';
import { arrowHeadPoints, straightArrowGeometry, type Point } from './geometry';

export interface DrawingMeasurement extends Measurement {
  section: string;
}
interface DrawingRecord {
  json: any;
  source: string;
  width: number;
  height: number;
  preview: string;
  count: number;
  units: DisplayUnits;
  selected: string[];
  tool: Tool;
}
type Tool = 'select' | 'line' | 'curve' | 'tag' | 'text';
interface EditorOptions {
  scope: string;
  source: string;
  title: string;
  filename: string;
  units: DisplayUnits;
  measurements: DrawingMeasurement[];
  section: string;
  onPreview: (scope: string, preview: string, count: number, units: DisplayUnits) => void;
  onUnits: (units: DisplayUnits) => void;
}
const drawings = new Map<string, DrawingRecord>();
let generation = 0;
let openSequence = 0;
let disposeActive: (() => void) | null = null;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!
  );
// Six primary/additive colours, with a fine black edge for blue/orange diagrams.
const palette = ['#ff304f', '#ffdf00', '#25ec69', '#20deff', '#659bff', '#ef4bff'];
const color = (index: number) => palette[index % palette.length];
const loadImage = (source: string) =>
  new Promise<fabric.Image>((resolve, reject) =>
    fabric.Image.fromURL(source, image =>
      image?.width ? resolve(image) : reject(new Error('Diagram could not load.'))
    )
  );
const loadJson = (canvas: fabric.StaticCanvas, json: any) =>
  new Promise<void>(resolve => canvas.loadFromJSON(json, () => resolve()));
function serialized(canvas: fabric.StaticCanvas) {
  const json = canvas.toJSON(['customData']) as ReturnType<fabric.StaticCanvas['toJSON']> & {
    backgroundImage?: unknown;
  };
  delete json.backgroundImage;
  return json;
}
function drawingLabel(value: string, unit: string, units: DisplayUnits) {
  const displayed = formatMeasurement(value, unit, units);
  if (!/^-?\d+(?:\.\d+)?$/.test(displayed)) return displayed;
  if (!/^(cm|mm|in|inch|inches)$/i.test(unit || 'cm')) return displayed;
  return units === 'in' ? `${displayed}"` : `${displayed} cm`;
}
function labelStyles(text: string, units: DisplayUnits, size: number) {
  if (units !== 'cm' || !text.endsWith(' cm')) return {};
  const small = Math.round(size * 0.62);
  return { 0: { [text.length - 2]: { fontSize: small }, [text.length - 1]: { fontSize: small } } };
}
function updateLabel(object: any, units: DisplayUnits) {
  const text = drawingLabel(object.customData.value, object.customData.unit, units);
  object.set('text', text);
  object.set('styles', labelStyles(text, units, object.fontSize || 28));
  object.initDimensions?.();
}
function updateLabels(objects: any[], units: DisplayUnits) {
  for (const object of objects) {
    if (object.customData?.measurementLabel) {
      const text = drawingLabel(object.customData.value, object.customData.unit, units);
      object.text = text;
      object.styles = labelStyles(text, units, object.fontSize || 28);
    }
    if (Array.isArray(object.objects)) updateLabels(object.objects, units);
  }
}
async function renderDrawing(record: DrawingRecord): Promise<{ preview: string; blob: Blob }> {
  const element = document.createElement('canvas');
  const canvas = new fabric.StaticCanvas(element, {
    width: record.width,
    height: record.height,
    enableRetinaScaling: false,
  });
  try {
    await loadJson(canvas, record.json);
    canvas.setBackgroundImage(await loadImage(record.source), () => canvas.requestRenderAll(), {
      originX: 'left',
      originY: 'top',
      left: 0,
      top: 0,
    });
    canvas.renderAll();
    const preview = canvas.toDataURL({ format: 'png', multiplier: 1 });
    const blob = await new Promise<Blob>((resolve, reject) =>
      element.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Image could not save.'))),
        'image/png'
      )
    );
    return { preview, blob };
  } finally {
    canvas.dispose();
  }
}
export function getMeasurementDrawing(scope: string) {
  return drawings.get(scope);
}
export async function getMeasurementDrawingPreview(scope: string, units: DisplayUnits) {
  const current = generation;
  const record = drawings.get(scope);
  if (!record?.count) return undefined;
  if (record.units === units && record.preview) return record.preview;
  const json = structuredClone(record.json);
  updateLabels(json.objects || [], units);
  const result = await renderDrawing({ ...record, json, units });
  return current === generation ? result.preview : undefined;
}
export function clearMeasurementDrawings() {
  generation++;
  openSequence++;
  disposeActive?.();
  disposeActive = null;
  drawings.clear();
}
export async function refreshMeasurementDrawingUnits(units: DisplayUnits) {
  const current = generation;
  for (const [scope, record] of drawings) {
    if (record.units === units) continue;
    const updated = { ...record, json: structuredClone(record.json), units };
    updateLabels(updated.json.objects || [], units);
    const result = await renderDrawing(updated);
    if (current !== generation) return;
    if (drawings.get(scope) !== record) continue;
    drawings.set(scope, { ...updated, preview: result.preview });
  }
}

export async function openMeasurementEditor(options: EditorOptions) {
  const sequence = ++openSequence;
  disposeActive?.();
  const current = generation;
  const background = await loadImage(options.source);
  if (current !== generation || sequence !== openSequence) return;
  const imageWidth = background.width!,
    imageHeight = background.height!;
  const previous = drawings.get(options.scope);
  let units = options.units;
  let tool: Tool = previous?.tool || 'line';
  const selected = new Set(previous?.selected || []);
  let armed = '';
  let part = options.section;
  let history: string[] = [];
  let historyIndex = -1;
  let loading = true;
  let closed = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveVersion = 0;
  let busy = false;
  let pointerDown: { x: number; y: number } | null = null;
  let previewObject: fabric.Object | null = null;
  let pan = false,
    space = false;
  let panPointer: { x: number; y: number } | null = null;
  let curvePoints: Array<{ x: number; y: number }> = [];
  const dialog = document.createElement('dialog');
  dialog.className = 'ms-drawing-editor';
  dialog.setAttribute('aria-label', 'Draw measurements on diagram');
  dialog.innerHTML = `<header class="ms-editor-header"><div><strong>${escape(options.title)}</strong><span>Changes stay on this page</span></div><div class="ms-editor-actions"><div class="ms-unit-toggle"><button data-editor-unit="cm" aria-pressed="${units === 'cm'}">cm</button><button data-editor-unit="in" aria-pressed="${units === 'in'}">inches</button></div><button data-editor-action="undo" aria-label="Undo" title="Undo (Ctrl/⌘ Z)">↶</button><button data-editor-action="redo" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)">↷</button><button data-editor-action="copy" class="ms-editor-copy">Copy image</button><button data-editor-action="save" class="ms-editor-save">Save PNG</button><button data-editor-action="close" aria-label="Close drawing editor">Done ×</button></div></header><div class="ms-editor-toolbar" role="toolbar" aria-label="Drawing tools">${[
    ['select', 'Select'],
    ['line', 'Straight'],
    ['curve', 'Curved'],
    ['tag', 'Point tag'],
    ['text', 'Text'],
  ]
    .map(
      ([key, label]) =>
        `<button data-tool="${key}" aria-pressed="${tool === key}">${label}</button>`
    )
    .join(
      ''
    )}<span class="ms-editor-toolbar-separator"></span><label>Size <input type="number" aria-label="Label size" min="8" max="80" value="${Math.max(24, Math.round(imageWidth / 36))}"/></label><button data-editor-action="delete" title="Delete selected annotation">Delete</button><div class="ms-editor-view"><button data-editor-action="fit">Fit</button></div></div><div class="ms-editor-main"><aside class="ms-editor-library"><div class="ms-editor-library-heading"><strong>Measurements</strong><button data-editor-action="clear-selection">Clear selection</button></div><select aria-label="Measurement part">${[...new Set(options.measurements.map(row => row.section))].map(section => `<option value="${escape(section)}" ${section === part ? 'selected' : ''}>${escape(section)}</option>`).join('')}<option value="*">All parts</option></select><div class="ms-editor-measurements"></div></aside><div class="ms-editor-stage"><canvas></canvas></div></div><footer class="ms-editor-footer"><span class="ms-editor-status" role="status"></span><span>Scroll to zoom · Space to pan · Delete to remove</span></footer>`;
  document.body.appendChild(dialog);
  dialog.showModal();
  const stage = dialog.querySelector<HTMLElement>('.ms-editor-stage')!;
  const labelSizeInput = dialog.querySelector<HTMLInputElement>('[aria-label="Label size"]')!;
  const canvas = new fabric.Canvas(dialog.querySelector('canvas')!, {
    width: stage.clientWidth,
    height: stage.clientHeight,
    preserveObjectStacking: true,
    selection: false,
    enableRetinaScaling: true,
  });
  canvas.setBackgroundImage(background, () => canvas.requestRenderAll(), {
    originX: 'left',
    originY: 'top',
    left: 0,
    top: 0,
  });
  const status = (message: string) => {
    if (!closed) dialog.querySelector('.ms-editor-status')!.textContent = message;
  };
  const rowFor = () => options.measurements.find(row => row.key === armed);
  const rowColor = () =>
    color(
      Math.max(
        0,
        options.measurements.findIndex(row => row.key === armed)
      )
    );
  const size = () => Math.max(8, Number(labelSizeInput.value) || 16);
  const width = () => Math.max(2, imageWidth / 400);
  const haloWidth = () => width() + Math.max(1.6, imageWidth / 550);
  const labelOutline = () => Math.max(3, imageWidth / 250);
  function contrastStroke(object: fabric.Object) {
    const props = {
      ...object.toObject(),
      stroke: '#111',
      strokeWidth: haloWidth(),
      fill: '',
      selectable: false,
      evented: false,
    };
    let outline: fabric.Object;
    if (object instanceof fabric.Path) outline = new fabric.Path(object.path, props);
    else return object;
    return new fabric.Group([outline, object], { selectable: false, evented: false });
  }
  const used = () =>
    new Set(
      canvas
        .getObjects()
        .map(object =>
          (object as any).customData?.measurementLabel
            ? null
            : (object as any).customData?.measurementKey
        )
        .filter(Boolean)
    );
  const activeLabel = () => {
    const row = rowFor();
    return row
      ? `${row.name} = ${formatMeasurement(row.value, row.unit, units)} ${units === 'in' ? 'inches' : 'cm'}`
      : 'Select a measurement';
  };
  function fit() {
    const scale = Math.min(
      (stage.clientWidth - 24) / imageWidth,
      (stage.clientHeight - 24) / imageHeight
    );
    canvas.setDimensions({ width: stage.clientWidth, height: stage.clientHeight });
    canvas.setViewportTransform([
      scale,
      0,
      0,
      scale,
      (stage.clientWidth - imageWidth * scale) / 2,
      (stage.clientHeight - imageHeight * scale) / 2,
    ]);
    canvas.requestRenderAll();
  }
  function nextMeasurement() {
    const done = used();
    armed =
      options.measurements.find(row => selected.has(row.key) && !done.has(row.key))?.key || '';
    renderLibrary();
    status(
      armed
        ? `${tool === 'tag' ? 'Point tag' : 'Draw'} · ${activeLabel()}`
        : selected.size
          ? 'Selected measurements drawn. Select one to draw again.'
          : 'Select the measurements you want to draw.'
    );
  }
  function renderLibrary() {
    const done = used();
    dialog.querySelector('.ms-editor-measurements')!.innerHTML = options.measurements
      .filter(row => part === '*' || row.section === part)
      .map(row => {
        const index = options.measurements.findIndex(candidate => candidate.key === row.key);
        return `<div class="ms-editor-measurement ${armed === row.key ? 'is-armed' : ''} ${done.has(row.key) ? 'is-drawn' : ''}" style="--measurement-color:${color(index)}"><input type="checkbox" data-measurement-check="${escape(row.key)}" aria-label="Select ${escape(row.section)}, ${escape(row.name)}" ${selected.has(row.key) ? 'checked' : ''}/><button data-arm-measurement="${escape(row.key)}" aria-pressed="${armed === row.key}"><span>${escape(row.name)}${part === '*' ? `<small>${escape(row.section)}</small>` : ''}</span><strong>${escape(formatMeasurement(row.value, row.unit, units))}<small>${units === 'in' ? 'in' : 'cm'}</small>${done.has(row.key) ? ' ✓' : ''}</strong></button></div>`;
      })
      .join('');
  }
  function setTool(next: Tool) {
    if (previewObject) {
      canvas.remove(previewObject);
      previewObject = null;
    }
    pointerDown = null;
    curvePoints = [];
    tool = next;
    canvas.discardActiveObject();
    canvas.isDrawingMode = false;
    canvas.selection = tool === 'select';
    canvas.getObjects().forEach(object => {
      object.selectable = tool === 'select';
      object.evented = tool === 'select';
    });
    canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
    dialog
      .querySelectorAll<HTMLElement>('[data-tool]')
      .forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)));
    canvas.requestRenderAll();
    status(
      tool === 'curve'
        ? `Curved: click start, bend, then end · ${activeLabel()}`
        : tool === 'select'
          ? 'Select: drag labels to move them.'
          : `${tool === 'tag' ? 'Point tag' : tool === 'line' ? 'Straight: drag start to end' : 'Text: click to type'} · ${activeLabel()}`
    );
  }
  function record(): DrawingRecord {
    return {
      json: serialized(canvas),
      source: options.source,
      width: imageWidth,
      height: imageHeight,
      preview: drawings.get(options.scope)?.preview || '',
      count: canvas
        .getObjects()
        .filter(object => object !== previewObject && !(object as any).customData?.measurementLabel)
        .length,
      units,
      selected: [...selected],
      tool,
    };
  }
  async function savePreview(version: number) {
    const saved = record();
    drawings.set(options.scope, saved);
    try {
      const result = await renderDrawing(saved);
      if (current !== generation || saveVersion !== version) return;
      drawings.set(options.scope, { ...saved, preview: result.preview });
      options.onPreview(options.scope, result.preview, saved.count, units);
    } catch {
      status('The drawing is kept here. Image preview could not update.');
    }
  }
  function commit(pushHistory = true) {
    if (loading || closed) return;
    const saved = record();
    drawings.set(options.scope, saved);
    if (pushHistory) {
      const json = JSON.stringify(saved.json);
      if (history[historyIndex] !== json) {
        history = history.slice(0, historyIndex + 1);
        history.push(json);
        historyIndex = history.length - 1;
      }
      if (history.length > 80) {
        history.shift();
        historyIndex--;
      }
    }
    clearTimeout(saveTimer);
    const version = ++saveVersion;
    saveTimer = setTimeout(() => {
      void savePreview(version);
    }, 100);
    renderLibrary();
    dialog.querySelector<HTMLButtonElement>('[data-editor-action="undo"]')!.disabled =
      historyIndex <= 0;
    dialog.querySelector<HTMLButtonElement>('[data-editor-action="redo"]')!.disabled =
      historyIndex >= history.length - 1;
  }
  async function undo(direction: number) {
    const next = historyIndex + direction;
    if (next < 0 || next >= history.length) return;
    loading = true;
    historyIndex = next;
    const json = JSON.parse(history[next]);
    updateLabels(json.objects || [], units);
    await loadJson(canvas, json);
    if (closed || current !== generation) return;
    canvas.setBackgroundImage(background, () => canvas.requestRenderAll(), {
      originX: 'left',
      originY: 'top',
      left: 0,
      top: 0,
    });
    loading = false;
    setTool(tool);
    commit(false);
    nextMeasurement();
  }
  function metadata(row: DrawingMeasurement | undefined) {
    return {
      id: crypto.randomUUID(),
      measurementKey: row?.key || '',
      name: row?.name || '',
      value: row?.value ?? '',
      unit: row?.unit || 'cm',
    };
  }
  function measurementText(row: DrawingMeasurement, x: number, y: number) {
    const label = drawingLabel(row.value, row.unit, units);
    const text = new fabric.Text(label, {
      left: x,
      top: y,
      originX: 'center',
      originY: 'bottom',
      fontSize: size(),
      styles: labelStyles(label, units, size()),
      fontFamily: 'Instrument Sans',
      fill: '#fff',
      fontWeight: 'bold',
      stroke: '#111',
      strokeWidth: labelOutline(),
      strokeLineJoin: 'round',
      paintFirst: 'stroke',
      backgroundColor: '',
      selectable: false,
      evented: false,
    });
    (text as any).customData = {
      measurementLabel: true,
      value: row.value,
      unit: row.unit,
      measurementKey: row.key,
    };
    return text;
  }
  function complete(
    object: fabric.Object,
    row: DrawingMeasurement | undefined,
    labelPoint?: { x: number; y: number },
    pointAnchor?: { x: number; y: number }
  ) {
    const data = metadata(row);
    (object as any).customData = data;
    canvas.add(object);
    if (row && labelPoint) {
      const label = measurementText(row, labelPoint.x, labelPoint.y);
      (label as any).customData.parentId = data.id;
      if (pointAnchor) {
        (label as any).customData.pointAnchor = pointAnchor;
        (label as any).customData.pointColor = rowColor();
      }
      label.selectable = tool === 'select';
      label.evented = tool === 'select';
      canvas.add(label);
    }
    canvas.requestRenderAll();
    commit();
    nextMeasurement();
  }
  function drawLine(
    start: { x: number; y: number },
    end: { x: number; y: number },
    arrow: boolean,
    colorOverride?: string
  ) {
    const stroke = colorOverride || rowColor();
    const geometry = arrow
      ? straightArrowGeometry(
          start,
          end,
          Math.max(11, imageWidth / 80),
          Math.max(8, imageWidth / 110)
        )
      : null;
    const a = geometry?.shaftStart || start;
    const b = geometry?.shaftEnd || end;
    const line = new fabric.Line([a.x, a.y, b.x, b.y], {
      stroke,
      strokeWidth: width(),
      strokeLineCap: arrow ? 'butt' : 'round',
      selectable: false,
      evented: false,
    });
    const outline = new fabric.Line([a.x, a.y, b.x, b.y], {
      stroke: '#111',
      strokeWidth: haloWidth(),
      strokeLineCap: arrow ? 'butt' : 'round',
      selectable: false,
      evented: false,
    });
    if (!arrow) return new fabric.Group([outline, line], { selectable: false, evented: false });
    return new fabric.Group(
      [outline, line, arrowHead(geometry!.startHead, stroke), arrowHead(geometry!.endHead, stroke)],
      { selectable: false, evented: false }
    );
  }
  function arrowHead([tip, left, right]: Point[], stroke = rowColor()) {
    return new fabric.Path(`M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`, {
      fill: stroke,
      stroke: '#111',
      strokeWidth: Math.max(1, imageWidth / 900),
      strokeLineJoin: 'round',
      paintFirst: 'stroke',
      selectable: false,
      evented: false,
    });
  }
  function drawCurve(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number }
  ) {
    const path = new fabric.Path(`M ${a.x} ${a.y} Q ${b.x} ${b.y} ${c.x} ${c.y}`, {
      fill: '',
      stroke: rowColor(),
      strokeWidth: width(),
      strokeLineCap: 'round',
      selectable: false,
      evented: false,
    });
    const startDx = a.x - b.x || (a.y === b.y ? a.x - c.x : 0);
    const startDy = a.y - b.y || (a.x === b.x ? a.y - c.y : 0);
    const endDx = c.x - b.x || (c.y === b.y ? c.x - a.x : 0);
    const endDy = c.y - b.y || (c.x === b.x ? c.y - a.y : 0);
    return new fabric.Group(
      [
        contrastStroke(path),
        arrowHead(
          arrowHeadPoints(
            a,
            { x: startDx, y: startDy },
            Math.max(11, imageWidth / 80),
            Math.max(8, imageWidth / 110)
          )
        ),
        arrowHead(
          arrowHeadPoints(
            c,
            { x: endDx, y: endDy },
            Math.max(11, imageWidth / 80),
            Math.max(8, imageWidth / 110)
          )
        ),
      ],
      { selectable: false, evented: false }
    );
  }
  function pointGroup(
    anchor: { x: number; y: number },
    labelPoint: { x: number; y: number },
    stroke: string
  ) {
    const parts: fabric.Object[] = [
      new fabric.Circle({
        left: anchor.x,
        top: anchor.y,
        originX: 'center',
        originY: 'center',
        radius: width(),
        fill: stroke,
        stroke: '#111',
        strokeWidth: width() * 0.6,
      }),
    ];
    if (Math.hypot(labelPoint.x - anchor.x, labelPoint.y - anchor.y) > 5)
      parts.unshift(drawLine(anchor, labelPoint, false, stroke));
    return new fabric.Group(parts, { selectable: false, evented: false });
  }
  function followPointTag(label: fabric.Object) {
    const data = (label as any).customData;
    if (!data?.pointAnchor || !data.parentId) return;
    const group = canvas
      .getObjects()
      .find(object => (object as any).customData?.id === data.parentId);
    if (!group) return;
    const position = canvas.getObjects().indexOf(group);
    const replacement = pointGroup(
      data.pointAnchor,
      { x: label.left || 0, y: label.top || 0 },
      data.pointColor || rowColor()
    );
    (replacement as any).customData = (group as any).customData;
    replacement.selectable = true;
    replacement.evented = true;
    canvas.remove(group);
    canvas.insertAt(replacement, position, false);
    canvas.requestRenderAll();
  }
  function refreshLiveLabels() {
    const visit = (object: any) => {
      if (object.customData?.measurementLabel) updateLabel(object, units);
      if (object._objects) object._objects.forEach(visit);
      object.dirty = true;
    };
    canvas.getObjects().forEach(visit);
    canvas.requestRenderAll();
    renderLibrary();
    dialog
      .querySelectorAll<HTMLElement>('[data-editor-unit]')
      .forEach(button =>
        button.setAttribute('aria-pressed', String(button.dataset.editorUnit === units))
      );
  }
  canvas.on('mouse:down', event => {
    if (closed || loading) return;
    if (space || (event.e as MouseEvent).button === 1) {
      pan = true;
      panPointer = { x: (event.e as MouseEvent).clientX, y: (event.e as MouseEvent).clientY };
      canvas.isDrawingMode = false;
      return;
    }
    if (tool === 'select') return;
    const point = canvas.getPointer(event.e);
    if (['line', 'curve', 'tag'].includes(tool) && !rowFor()) {
      status('Select a measurement in the list first.');
      return;
    }
    if (tool === 'text') {
      const text = new fabric.IText('Text', {
        left: point.x,
        top: point.y,
        fontSize: size(),
        fontFamily: 'Instrument Sans',
        fill: '#fff',
        fontWeight: 'bold',
        stroke: '#111',
        strokeWidth: labelOutline(),
        strokeLineJoin: 'round',
        paintFirst: 'stroke',
      });
      // Keep Fabric's editing input inside the modal's focus boundary.
      (text as fabric.IText & { hiddenTextareaContainer: HTMLElement }).hiddenTextareaContainer =
        dialog;
      (text as any).customData = metadata(undefined);
      canvas.add(text);
      setTool('select');
      canvas.setActiveObject(text);
      text.enterEditing();
      text.selectAll();
      commit();
      return;
    }
    if (tool === 'curve') {
      curvePoints.push(point);
      if (curvePoints.length === 3) {
        if (previewObject) canvas.remove(previewObject);
        previewObject = null;
        const [a, b, c] = curvePoints;
        if (Math.hypot(c.x - a.x, c.y - a.y) > 3) {
          complete(drawCurve(a, b, c), rowFor(), {
            x: (a.x + 2 * b.x + c.x) / 4,
            y: (a.y + 2 * b.y + c.y) / 4 - size() * 0.3,
          });
        }
        curvePoints = [];
      } else
        status(
          curvePoints.length === 1 ? 'Curve: click the bend point.' : 'Curve: click the end point.'
        );
      return;
    }
    pointerDown = point;
  });
  canvas.on('mouse:move', event => {
    if (pan && panPointer) {
      const e = event.e as MouseEvent;
      canvas.relativePan(new fabric.Point(e.clientX - panPointer.x, e.clientY - panPointer.y));
      panPointer = { x: e.clientX, y: e.clientY };
      return;
    }
    if (tool === 'curve' && curvePoints.length) {
      const point = canvas.getPointer(event.e);
      if (previewObject) canvas.remove(previewObject);
      previewObject =
        curvePoints.length === 1
          ? drawLine(curvePoints[0], point, true)
          : drawCurve(curvePoints[0], curvePoints[1], point);
      previewObject.excludeFromExport = true;
      canvas.add(previewObject);
      canvas.requestRenderAll();
      return;
    }
    if (!pointerDown || tool === 'select') return;
    const point = canvas.getPointer(event.e);
    if (previewObject) canvas.remove(previewObject);
    const start = pointerDown;
    if (tool === 'line') previewObject = drawLine(start, point, true);
    else if (tool === 'tag') {
      const row = rowFor()!;
      const tag = measurementText(row, point.x, point.y);
      const connector = drawLine(start, point, false);
      const dot = new fabric.Circle({
        left: start.x,
        top: start.y,
        originX: 'center',
        originY: 'center',
        radius: width(),
        fill: rowColor(),
        stroke: '#111',
        strokeWidth: width() * 0.6,
      });
      previewObject = new fabric.Group([connector, dot, tag], {
        selectable: false,
        evented: false,
      });
    }
    if (previewObject) {
      previewObject.excludeFromExport = true;
      canvas.add(previewObject);
    }
    canvas.requestRenderAll();
  });
  canvas.on('mouse:up', event => {
    if (pan) {
      pan = false;
      panPointer = null;
      canvas.isDrawingMode = false;
      return;
    }
    if (!pointerDown) return;
    const end = canvas.getPointer(event.e),
      start = pointerDown;
    pointerDown = null;
    const row = rowFor();
    if (previewObject) canvas.remove(previewObject);
    previewObject = null;
    if (tool === 'tag' && row) {
      const distant = Math.hypot(end.x - start.x, end.y - start.y) > 5;
      const point = distant ? end : { x: start.x + size(), y: start.y - size() * 0.3 };
      complete(pointGroup(start, point, rowColor()), row, point, start);
      return;
    }
    if (Math.hypot(end.x - start.x, end.y - start.y) < 3) return;
    if (tool !== 'line') return;
    complete(drawLine(start, end, true), row, {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2 - size() * 0.3,
    });
  });
  canvas.on('object:moving', event => {
    if (event.target) followPointTag(event.target);
  });
  canvas.on('object:modified', () => commit());
  canvas.on('text:changed', () => commit());
  canvas.on('mouse:wheel', event => {
    const e = event.e as WheelEvent;
    const zoom = Math.min(20, Math.max(0.05, canvas.getZoom() * Math.pow(0.999, e.deltaY)));
    canvas.zoomToPoint(new fabric.Point(e.offsetX, e.offsetY), zoom);
    e.preventDefault();
    e.stopPropagation();
  });
  function removeSelected() {
    const objects = canvas.getActiveObjects();
    if (!objects.length) return;
    const parentIds = new Set(
      objects
        .map(object => {
          const data = (object as any).customData;
          return data?.parentId || (data?.measurementKey ? data.id : '');
        })
        .filter(Boolean)
    );
    canvas.discardActiveObject();
    canvas.getObjects().forEach(object => {
      const data = (object as any).customData;
      if (objects.includes(object) || parentIds.has(data?.id) || parentIds.has(data?.parentId))
        canvas.remove(object);
    });
    commit();
    nextMeasurement();
  }
  async function exportImage(copy: boolean) {
    if (busy) return;
    busy = true;
    status(copy ? 'Copying image…' : 'Saving image…');
    const saved = record();
    drawings.set(options.scope, saved);
    try {
      // Start ClipboardItem's promise during the click gesture.
      const rendering = renderDrawing(saved);
      if (copy)
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': rendering.then(result => result.blob) }),
        ]);
      const result = await rendering;
      if (current !== generation || closed) return;
      drawings.set(options.scope, { ...saved, preview: result.preview });
      options.onPreview(options.scope, result.preview, saved.count, units);
      if (!copy) {
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download =
          options.filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_.() -]/g, '_') +
          '-annotated.png';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      status(copy ? 'Image copied.' : 'Image saved.');
    } catch {
      status(
        copy
          ? 'Image copying was blocked. Use Save PNG.'
          : 'Image could not save. Please try again.'
      );
    } finally {
      busy = false;
    }
  }
  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(saveTimer);
    resize.disconnect();
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    canvas.dispose();
    dialog.remove();
    if (disposeActive === cleanup) disposeActive = null;
  }
  async function close() {
    if (closed) return;
    const version = ++saveVersion;
    clearTimeout(saveTimer);
    await savePreview(version);
    cleanup();
  }
  const resize = new ResizeObserver(() => {
    if (!closed) fit();
  });
  resize.observe(stage);
  function keydown(event: KeyboardEvent) {
    if (
      closed ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      (canvas.getActiveObject() as any)?.isEditing
    )
      return;
    if (event.code === 'Space') {
      space = true;
      event.preventDefault();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void undo(event.shiftKey ? 1 : -1);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeSelected();
    } else if (!event.ctrlKey && !event.metaKey) {
      const tools: Record<string, Tool> = {
        v: 'select',
        l: 'line',
        g: 'tag',
        t: 'text',
        c: 'curve',
      };
      if (tools[event.key.toLowerCase()]) setTool(tools[event.key.toLowerCase()]);
    }
  }
  function keyup(event: KeyboardEvent) {
    if (event.code === 'Space') space = false;
  }
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    void close();
  });
  dialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!button) return;
    if (button.dataset.tool) setTool(button.dataset.tool as Tool);
    else if (button.dataset.armMeasurement) {
      selected.add(button.dataset.armMeasurement);
      armed = button.dataset.armMeasurement;
      renderLibrary();
      status(`${tool === 'tag' ? 'Point tag' : 'Draw'} · ${activeLabel()}`);
      commit(false);
    } else if (button.dataset.editorUnit) {
      units = button.dataset.editorUnit === 'in' ? 'in' : 'cm';
      refreshLiveLabels();
      commit();
      options.onUnits(units);
    } else {
      const action = button.dataset.editorAction;
      if (action === 'close') void close();
      else if (action === 'save') void exportImage(false);
      else if (action === 'copy') void exportImage(true);
      else if (action === 'undo') void undo(-1);
      else if (action === 'redo') void undo(1);
      else if (action === 'fit') fit();
      else if (action === 'delete') removeSelected();
      else if (action === 'clear-selection') {
        selected.clear();
        armed = '';
        renderLibrary();
        commit(false);
        status('Select the measurements you want to draw.');
      }
    }
  });
  dialog.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.measurementCheck) {
      if (input.checked) {
        selected.add(input.dataset.measurementCheck);
        if (!armed) armed = input.dataset.measurementCheck;
      } else {
        selected.delete(input.dataset.measurementCheck);
        if (armed === input.dataset.measurementCheck) armed = '';
      }
      if (!armed) nextMeasurement();
      else renderLibrary();
      commit(false);
      status(`Draw · ${activeLabel()}`);
    } else if (input.getAttribute('aria-label') === 'Measurement part') {
      part = input.value;
      renderLibrary();
    } else if (input === labelSizeInput) {
      const selectedObject = canvas.getActiveObject() as any;
      if (selectedObject) {
        const visit = (object: any) => {
          if (object.type === 'text' || object.type === 'i-text') object.set('fontSize', size());
          object._objects?.forEach(visit);
          object.dirty = true;
        };
        visit(selectedObject);
        canvas.requestRenderAll();
        commit();
      }
    }
  });
  disposeActive = cleanup;
  if (previous) {
    const json = structuredClone(previous.json);
    updateLabels(json.objects || [], units);
    await loadJson(canvas, json);
    if (closed || current !== generation) return;
    canvas.setBackgroundImage(background, () => canvas.requestRenderAll(), {
      originX: 'left',
      originY: 'top',
      left: 0,
      top: 0,
    });
  }
  if (current !== generation || closed) {
    cleanup();
    return;
  }
  loading = false;
  history = [JSON.stringify(serialized(canvas))];
  historyIndex = 0;
  fit();
  setTool(tool);
  nextMeasurement();
}
