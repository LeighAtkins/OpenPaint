/**
 * window.sofapaint.agent: a small, stable API for agents driving SofaPaint in a
 * signed-in browser. Agents open a cloud project, read every labelled line as
 * normalised photo coordinates with its inch/cm value, add or correct lines,
 * and render clean question cards (only the lines being asked about).
 *
 * Nothing here saves to the cloud. Saving stays with the user (Cloud Save).
 * Run `window.sofapaint.agent.help()` for the usage text.
 */
import { cloudSaveService } from '../../services/cloud/cloudSaveService';
import { loadCloudProjectForImport } from '../ui/cloud-ui';
import { composeCard, drawPanel, type CardLine, type CardPanel, type CardSpec } from './agent-card';
import { readProjectLines, type AgentLine, type AgentView, type NormPoint } from './agent-geometry';
import { openView, setMeasurementValue, showAllLines } from './agent-values';
import {
  compareWithNoms as compareValues,
  NOMS_SNAPSHOT_SCRIPT,
  type NomsSnapshot,
} from './agent-noms';
import {
  alignPhoto,
  differsFromPhoto,
  findMarks,
  gradient,
  snapEndpoint,
  toGray,
  toPhoto,
  type MarkColor,
  type Pixels,
} from './agent-vision';

const HELP = `SofaPaint agent API (window.sofapaint.agent). All points are normalised
to the photo: {x: 0..1, y: 0..1} from the top-left. Values are inches.

  listProjects(search?)            -> [{id, name, updated_at}] from My Projects
  openProject(idOrName)            -> loads the newest matching cloud project
  listViews()                      -> [{viewId, title, labels}]
  getMeasurements(viewId?)         -> [{viewId, label, from, to, points, inch, cm, source,
                                       visible, valueConflict?}]
  addLine(viewId, label, from, to, {inch?, color?})
                                   -> adds or replaces a labelled line in the view
  setValue(viewId, label, inch)    -> sets a line's value on every copy (null clears it);
                                      opens the view so the value survives switches
  gridImage(viewId, {step?, crop?}) -> {dataUrl}: the photo with a labelled 0..1 grid
  snapLine(viewId, from, to, {radius?})
                                   -> ends moved onto the nearest strong edge along the line
  readMarkup(imageUrl, viewId, {colors?})
                                   -> {alignment, marks:[{color, from, to, matches}], newMarks, preview}: coloured
                                      strokes drawn on a screenshot of this view's photo
  checkExport()                    -> {hiddenWithValues, valueConflicts} to fix before a PDF
  exportPdf({unit:'cm', quantities:{viewId: n}, download?, force?})
                                   -> {filename, size, url} from SofaPaint's own PDF export
  nomsSnapshotScript()             -> JS to run on a NOMS measurements page; returns the form
  compareWithNoms(snapshot, {viewId: rowId}?)
                                   -> {rows, differences, mapping, unmappedViews} in cm
  showLines(viewIds?)              -> turns hidden lines back on; returns what was hidden
  renderCard(spec, {download?})    -> {dataUrl, width, height}; download saves a PNG

Card spec:
  { title, caption: ["plain line", "!red line"], width?: 1100, units?: 'in-cm'|'cm'|'in',
    panels: [panel, ...] or [[row1 panels], [row2 panels]] }
  panel: { viewId | image: url, subtitle?, crop?: 'fit' | 'full' | {x0,y0,x1,y1},
           lines: [{label, from?, to?, inch?, text?, unknown?, color?, offset?}] }
  Lines in a project view take their endpoints and value from the project when
  omitted. color: red | green | amber | blue | ink | any CSS colour.
  unknown: true labels the line "X  ?" (a measurement we are asking for).

Nothing is saved to the cloud by this API; use Cloud Save to keep changes.`;

type AnyObj = Record<string, any>;
const app = (): AnyObj => (window as AnyObj).app || {};

async function snapshot(): Promise<AnyObj> {
  const pm = app().projectManager;
  if (!pm?.getProjectData) throw new Error('SofaPaint is not ready yet');
  return pm.getProjectData({ embedImages: false });
}

async function views(): Promise<AgentView[]> {
  return readProjectLines(await snapshot());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listProjects(search?: string) {
  const result = await cloudSaveService.listProjects(search);
  if (!result.success) throw new Error(result.error.message);
  return result.data.map(p => ({ id: p.id, name: p.name, updated_at: p.updated_at }));
}

async function openProject(idOrName: string) {
  let id = (idOrName || '').trim();
  if (!UUID.test(id)) {
    const matches = await listProjects(id);
    const exact = matches.filter(p => p.name.toLowerCase() === id.toLowerCase());
    const pick = (exact.length ? exact : matches)[0];
    if (!pick) throw new Error(`No cloud project matches "${idOrName}"`);
    id = pick.id;
  }
  const ok = await loadCloudProjectForImport(id);
  if (!ok) throw new Error(`Could not load cloud project ${id}`);
  await app().projectManager?.whenIdle?.({ timeoutMs: 15000 });
  return { id, views: await listViews() };
}

async function listViews() {
  return (await views()).map(v => ({
    viewId: v.viewId,
    title: v.title,
    labels: v.lines.map(l => l.label),
  }));
}

async function getMeasurements(viewId?: string): Promise<AgentLine[]> {
  const all = await views();
  return all.filter(v => !viewId || v.viewId === viewId).flatMap(v => v.lines);
}

async function overlayManager(): Promise<AnyObj> {
  let om = app().measurementOverlayManager;
  if (!om?.importSvg && app().initDeferredManagers) {
    await app().initDeferredManagers();
    om = app().measurementOverlayManager;
  }
  if (!om?.importSvg) throw new Error('Measurement overlay is not available');
  return om;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

async function addLine(
  viewId: string,
  label: string,
  from: NormPoint,
  to: NormPoint,
  options: { inch?: number | null; color?: string } = {}
) {
  if (!/^[A-Za-z]+\d*$/.test(label))
    throw new Error(`Label must look like A1 or K, got "${label}"`);
  await openView(app(), viewId);
  const om = await overlayManager();
  const { exportMosSvg } = await import('../measurement-mos/mos-exporter');
  const { getImageRect } = await import('../measurement-mos/mos-transform');
  const canvas = app().canvasManager?.fabricCanvas;
  const existing = [...om.getStore().byId.values()].find((o: AnyObj) => o.viewId === viewId);
  let svg: string = existing
    ? exportMosSvg(existing, getImageRect(canvas))
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">\n</svg>';
  // Replace a line with the same label rather than duplicating it.
  svg = svg.replace(new RegExp(`\\s*<line\\b[^>]*id="(?:mos\\d+_)*m${label}cm"[^>]*/>`, 'g'), '');
  const p = (n: number) => (clamp01(n) * 1000).toFixed(2);
  const color = options.color || '#DF6868';
  const shape = `  <line id="m${label}cm" class="mos-line" x1="${p(from.x)}" y1="${p(from.y)}" x2="${p(to.x)}" y2="${p(to.y)}" stroke="${color}" stroke-width="2" />\n`;
  svg = svg.replace(/<\/svg>\s*$/, `${shape}</svg>`);

  const savedOffsets = existing?.tagOffsets ? { ...existing.tagOffsets } : null;
  // Re-importing clears the overlay's labels from the measurement maps; keep them.
  const metadata = app().metadataManager || {};
  const maps = ['strokeMeasurements', 'strokeVisibilityByImage', 'strokeLabelVisibility'];
  const kept = Object.fromEntries(
    maps.map(name => [name, JSON.parse(JSON.stringify(metadata[name]?.[viewId] || {}))])
  );
  const overlayId = await om.importSvg(svg, viewId);
  for (const name of maps) {
    if (!metadata[name]) continue;
    metadata[name][viewId] = { ...kept[name], ...(metadata[name][viewId] || {}) };
  }
  for (const known of Object.keys(kept.strokeMeasurements)) {
    app().tagManager?.updateTagText?.(known, viewId);
  }
  const restored = om.getStore().byId.get(overlayId);
  if (restored && savedOffsets) {
    restored.tagOffsets = savedOffsets;
    om._clearOverlayTags?.(overlayId, { preserveMetadata: true });
    om._syncOverlayTags?.(overlayId);
  }
  if (options.inch !== undefined) await setValue(viewId, label, options.inch);
  canvas?.requestRenderAll?.();
  return (await getMeasurements(viewId)).find(l => l.label === label) || null;
}

async function setValue(viewId: string, label: string, inch: number | null) {
  return setMeasurementValue(app(), viewId, label, inch);
}

/**
 * Problems to fix before exporting a PDF: lines that have a value but are
 * hidden on their view (they would be missing from the photo), and lines whose
 * value copies disagree (the PDF prints the frame copy).
 */
async function checkExport() {
  const lines = (await views()).flatMap(v => v.lines);
  return {
    hiddenWithValues: lines
      .filter(l => !l.visible && l.inch !== null)
      .map(l => ({ viewId: l.viewId, label: l.label, inch: l.inch })),
    valueConflicts: lines
      .filter(l => l.valueConflict)
      .map(l => ({ viewId: l.viewId, label: l.label, copies: l.valueConflict })),
  };
}

/** Turn hidden lines back on, for the given views or every view. */
async function showLines(viewIds?: string[]) {
  const shown = showAllLines(app(), viewIds);
  const pm = app().projectManager;
  // Remount the open view so its lines reappear on the canvas.
  if (pm?.currentViewId) await app().measurementOverlayManager?.mountView?.(pm.currentViewId);
  app().canvasManager?.fabricCanvas?.requestRenderAll?.();
  return shown;
}

/**
 * Compare this project with a NOMS form. Read the form in a NOMS tab with
 * nomsSnapshotScript() and pass the result. mapping: { viewId: rowId } for
 * views the automatic match cannot place.
 */
async function compareWithNoms(snapshot: NomsSnapshot, mapping: Record<string, string> = {}) {
  if (!snapshot?.products) throw new Error('Pass the result of nomsSnapshotScript() run on NOMS');
  return compareValues(await views(), snapshot, mapping);
}

/**
 * Export the production PDF through SofaPaint's own exporter and return it.
 * Fails on hidden lines or disagreeing values unless force is set.
 */
async function exportPdf(
  options: {
    unit?: 'cm' | 'inch';
    quality?: 'high' | 'medium' | 'low';
    renderer?: 'modern' | 'classic';
    quantities?: Record<string, number>;
    download?: boolean;
    force?: boolean;
  } = {}
) {
  const problems = await checkExport();
  if (!options.force && (problems.hiddenWithValues.length || problems.valueConflicts.length)) {
    throw new Error(`Fix before exporting (or pass force: true): ${JSON.stringify(problems)}`);
  }
  const { exportPdfForAgent } = await import('../ui/pdf-export-inline');
  const { blob, filename } = await exportPdfForAgent(options);
  if (options.download) {
    const { downloadBlob } = await import('../ui/export-utils');
    downloadBlob(blob, filename);
  }
  return { filename, size: blob.size, url: URL.createObjectURL(blob), warnings: problems };
}

async function pixelsOf(src: string, maxSide = 1200): Promise<Pixels> {
  const bitmap = await loadBitmap(src);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * The view's photo with a labelled 0..1 grid, so positions can be read off it.
 * crop: {x0,y0,x1,y1} to zoom in; step: grid spacing (0.05 = every 5%).
 */
async function gridImage(
  viewId: string,
  options: { step?: number; crop?: { x0: number; y0: number; x1: number; y1: number } } = {}
) {
  const step = options.step ?? 0.05;
  const box = options.crop || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const bitmap = await loadBitmap(viewImageSource(viewId));
  const sw = (box.x1 - box.x0) * bitmap.width;
  const sh = (box.y1 - box.y0) * bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = Math.round((900 * sh) / sw);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    bitmap,
    box.x0 * bitmap.width,
    box.y0 * bitmap.height,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height
  );
  ctx.font = '13px Arial';
  const px = (x: number) => ((x - box.x0) / (box.x1 - box.x0)) * canvas.width;
  const py = (y: number) => ((y - box.y0) / (box.y1 - box.y0)) * canvas.height;
  for (let t = Math.ceil(box.x0 / step) * step; t <= box.x1 + 1e-9; t += step) {
    const major = Math.round(t / step) % 2 === 0;
    ctx.strokeStyle = major ? 'rgba(255,0,255,0.75)' : 'rgba(0,200,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(px(t), 0);
    ctx.lineTo(px(t), canvas.height);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = 'magenta';
      ctx.fillText(t.toFixed(2), px(t) + 2, 12);
    }
  }
  for (let t = Math.ceil(box.y0 / step) * step; t <= box.y1 + 1e-9; t += step) {
    const major = Math.round(t / step) % 2 === 0;
    ctx.strokeStyle = major ? 'rgba(255,0,255,0.75)' : 'rgba(0,200,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(0, py(t));
    ctx.lineTo(canvas.width, py(t));
    ctx.stroke();
    if (major) {
      ctx.fillStyle = 'magenta';
      ctx.fillText(t.toFixed(2), 2, py(t) - 2);
    }
  }
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    width: canvas.width,
    height: canvas.height,
  };
}

const gradients = new Map<string, { w: number; h: number; grad: Float32Array }>();

/**
 * Pull each end of a line along its own direction onto the strongest nearby
 * edge (a seam, panel edge or the floor). radius is a fraction of the photo.
 */
async function snapLine(
  viewId: string,
  from: NormPoint,
  to: NormPoint,
  options: { radius?: number } = {}
) {
  const src = viewImageSource(viewId);
  let cached = gradients.get(src);
  if (!cached) {
    const img = await pixelsOf(src);
    cached = { w: img.width, h: img.height, grad: gradient(toGray(img), img.width, img.height) };
    gradients.set(src, cached);
  }
  const { w, h, grad } = cached;
  const r = Math.max(4, Math.round((options.radius ?? 0.03) * Math.max(w, h)));
  const a = { x: from.x * w, y: from.y * h };
  const b = { x: to.x * w, y: to.y * h };
  const sa = snapEndpoint(grad, w, h, a, b, r);
  const sb = snapEndpoint(grad, w, h, b, a, r);
  return {
    from: { x: sa.point.x / w, y: sa.point.y / h },
    to: { x: sb.point.x / w, y: sb.point.y / h },
    moved: { from: sa.moved / Math.max(w, h), to: sb.moved / Math.max(w, h) },
    strength: { from: sa.strength, to: sb.strength },
  };
}

/**
 * Read someone's marks on a screenshot of a project photo (production's
 * questions, for example): finds where the photo sits in the screenshot and
 * returns each coloured stroke as a line on the view, plus a preview card.
 */
async function readMarkup(
  imageUrl: string,
  viewId: string,
  options: { colors?: MarkColor[]; minLength?: number } = {}
) {
  const screen = await pixelsOf(imageUrl, 1200);
  const photo = await pixelsOf(viewImageSource(viewId), 600);
  const alignment = alignPhoto(screen, photo);
  const marks = findMarks(screen, {
    colors: options.colors,
    minLength: options.minLength,
    keep: alignment.score > 0.5 ? differsFromPhoto(screen, photo, alignment) : undefined,
  })
    .map(m => ({
      color: m.color,
      from: toPhoto(m.from, alignment, photo),
      to: toPhoto(m.to, alignment, photo),
      lengthPx: Math.round(m.length),
    }))
    .filter(m => [m.from, m.to].every(p => p.x > -0.05 && p.x < 1.05 && p.y > -0.05 && p.y < 1.05));
  // Marks that retrace a line already in the project (our own PDF lines in the
  // screenshot) are tagged, so the new asks stand out.
  const known = await getMeasurements(viewId);
  const near = (a: NormPoint, b: NormPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 0.04;
  const tagged = marks.map(m => {
    const hit = known.find(
      l => (near(l.from, m.from) && near(l.to, m.to)) || (near(l.from, m.to) && near(l.to, m.from))
    );
    return { ...m, matches: hit ? hit.label : null };
  });
  let preview: string | null = null;
  if (tagged.length) {
    const card = await renderCard({
      title: `Marks read from the screenshot (match ${alignment.score.toFixed(2)})`,
      panels: [
        {
          viewId,
          crop: 'full',
          lines: tagged.map((m, i) => ({
            label: `M${i + 1}`,
            text: m.matches ? `${i + 1} = ${m.matches}` : `${i + 1} ${m.color} NEW`,
            from: m.from,
            to: m.to,
            color: m.color === 'yellow' ? 'amber' : m.color === 'orange' ? 'amber' : m.color,
          })),
        },
      ],
    });
    preview = card.dataUrl;
  }
  return { alignment, marks: tagged, newMarks: tagged.filter(m => !m.matches), preview };
}

async function loadBitmap(src: string): Promise<ImageBitmap> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load image (${response.status})`);
  return createImageBitmap(await response.blob());
}

function viewImageSource(viewId: string): string {
  const view = app().projectManager?.views?.[viewId];
  const src = view?.image || view?.imageUrl;
  if (!src) throw new Error(`View "${viewId}" has no photo`);
  return String(src);
}

async function renderCard(spec: CardSpec, options: { download?: string } = {}) {
  const rows: CardPanel[][] = Array.isArray(spec.panels[0])
    ? (spec.panels as CardPanel[][])
    : [spec.panels as CardPanel[]];
  const projectViews = rows.flat().some(p => p.viewId) ? await views() : [];

  const drawn: Array<Array<{ canvas: HTMLCanvasElement; subtitle?: string }>> = [];
  for (const row of rows) {
    const out: Array<{ canvas: HTMLCanvasElement; subtitle?: string }> = [];
    for (const panel of row) {
      const known = new Map(
        (projectViews.find(v => v.viewId === panel.viewId)?.lines || []).map(l => [l.label, l])
      );
      const lines = panel.lines.map((line: CardLine) => {
        const fromProject = known.get(line.label);
        const from = line.from || fromProject?.from;
        const to = line.to || fromProject?.to;
        if (!from || !to) {
          throw new Error(
            `Line ${line.label} has no position${panel.viewId ? ` in view ${panel.viewId}` : ''}; pass from/to`
          );
        }
        return {
          ...line,
          from,
          to,
          inch: line.inch !== undefined ? line.inch : (fromProject?.inch ?? null),
        };
      });
      const bitmap = await loadBitmap(panel.image || viewImageSource(String(panel.viewId)));
      out.push({
        canvas: drawPanel(
          {
            bitmap,
            width: bitmap.width,
            height: bitmap.height,
            lines,
            subtitle: panel.subtitle,
            crop: panel.crop,
            units: spec.units,
          },
          900,
          Math.max(1, row.length * 0.8)
        ),
        subtitle: panel.subtitle,
      });
    }
    drawn.push(out);
  }
  const card = composeCard(drawn, spec);
  const dataUrl = card.toDataURL('image/png');
  if (options.download) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = options.download.endsWith('.png') ? options.download : `${options.download}.png`;
    a.click();
  }
  return { dataUrl, width: card.width, height: card.height };
}

export function initSofapaintAgent(): void {
  const w = window as AnyObj;
  w.sofapaint = w.sofapaint || {};
  w.sofapaint.agent = {
    help: () => HELP,
    listProjects,
    openProject,
    listViews,
    getMeasurements,
    addLine,
    setValue,
    checkExport,
    showLines,
    exportPdf,
    gridImage,
    snapLine,
    readMarkup,
    nomsSnapshotScript: () => NOMS_SNAPSHOT_SCRIPT,
    compareWithNoms,
    renderCard,
  };
}
