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

const HELP = `SofaPaint agent API (window.sofapaint.agent). All points are normalised
to the photo: {x: 0..1, y: 0..1} from the top-left. Values are inches.

  listProjects(search?)            -> [{id, name, updated_at}] from My Projects
  openProject(idOrName)            -> loads the newest matching cloud project
  listViews()                      -> [{viewId, title, labels}]
  getMeasurements(viewId?)         -> [{viewId, label, from, to, points, inch, cm, source}]
  addLine(viewId, label, from, to, {inch?, color?})
                                   -> adds or replaces a labelled line in the view
  setValue(viewId, label, inch)    -> sets a line's value (null clears it)
  renderCard(spec, {download?})    -> {dataUrl, width, height}; download saves a PNG

Card spec:
  { title, caption: ["plain line", "!red line"], width?: 1100,
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
  const pm = app().projectManager;
  if (!pm?.views?.[viewId]) throw new Error(`No view "${viewId}"`);
  if (pm.currentViewId !== viewId) await pm.switchView(viewId);
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
  const metadata = app().metadataManager;
  if (!metadata?.parseAndSaveMeasurement) throw new Error('Measurements are not available');
  const ok = metadata.parseAndSaveMeasurement(viewId, label, inch === null ? '' : `${inch} in`);
  app().tagManager?.updateTagText?.(label, viewId);
  app().canvasManager?.fabricCanvas?.requestRenderAll?.();
  return ok !== false;
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
    renderCard,
  };
}
