/**
 * Shared helpers for the long-form project stability workflow.
 *
 * The workflow builds a realistic 12-image project with the real tools, takes
 * an image-relative snapshot of everything a customer would notice (frame
 * size and crop, text styling, stroke geometry, tags, measurements) and then
 * compares snapshots across view switching and cloud save/load.
 */
import type { Page } from '@playwright/test';
import { selectTool, waitForCanvasLayoutSettle } from '../fixtures';

export type ViewSpec = {
  id: string;
  width: number;
  height: number;
  color: string;
};

export type FrameSnapshot = {
  width: number;
  height: number;
  aspect: number;
  /** Frame rectangle expressed in background-image fractions (0..1). */
  crop: { left: number; top: number; width: number; height: number };
};

export type ObjectSnapshot = {
  key: string;
  type: string;
  visible: boolean;
  stroke: string | null;
  strokeWidth: number | null;
  dash: string | null;
  fill: string | null;
  angle: number;
  /** Object bounds in background-image fractions. */
  box: { left: number; top: number; width: number; height: number };
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  backgroundColor?: string;
  textAlign?: string;
  lineHeight?: number;
  padding?: number;
  scaleX?: number;
  scaleY?: number;
  /** Text height on screen as a fraction of the frame height. */
  screenHeightInFrame?: number;
};

export type ViewSnapshot = {
  viewId: string;
  rotation: number;
  zoom: number;
  tabCount: number;
  activeTabName: string;
  frame: FrameSnapshot;
  objects: ObjectSnapshot[];
  tags: Array<{ label: string; text: string; box: ObjectSnapshot['box'] }>;
  measurements: Record<string, string>;
};

export type Difference = { viewId: string; field: string; before: unknown; after: unknown };

export const VIEW_SPECS: ViewSpec[] = [
  { id: 'v01-landscape', width: 1600, height: 1200, color: '#315b96' },
  { id: 'v02-portrait', width: 900, height: 1600, color: '#5b3196' },
  { id: 'v03-square', width: 1200, height: 1200, color: '#2f7d4f' },
  { id: 'v04-wide', width: 2000, height: 900, color: '#96573b' },
  { id: 'v05-tall', width: 700, height: 1800, color: '#3b8a96' },
  { id: 'v06-small', width: 640, height: 480, color: '#7a7d2f' },
  { id: 'v07-large', width: 3000, height: 2000, color: '#96313f' },
  { id: 'v08-phone', width: 1080, height: 1920, color: '#44515f' },
  { id: 'v09-pano', width: 2400, height: 800, color: '#6b4a2b' },
  { id: 'v10-rotated-wide', width: 1600, height: 1000, color: '#2b5b6b' },
  { id: 'v11-rotated-tall', width: 1000, height: 1500, color: '#5f4467' },
  { id: 'v12-two-frames', width: 1400, height: 1000, color: '#3d6a3d' },
];

export async function waitForIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !(window as any).__isLoadingProject &&
      !window.app?.projectManager?.isSwitchingView &&
      !window.app?.projectManager?.pendingSwitchViewId,
    { timeout: 60_000 }
  );
  await page.evaluate(() => window.app!.projectManager.whenIdle?.({ timeoutMs: 15_000 }));
  // switchView schedules late passes (double RAF, 260ms exact restore, 450ms
  // late refresh). Snapshots are only meaningful once those have run.
  await page.waitForTimeout(650);
  await waitForCanvasLayoutSettle(page);
}

export async function seedView(page: Page, spec: ViewSpec): Promise<void> {
  await page.evaluate(async ({ id, width, height, color }) => {
    const manager = window.app!.projectManager;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const context = source.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,0.35)';
    context.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 300));
    const step = Math.round(Math.min(width, height) / 8);
    for (let x = 0; x <= width; x += step) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += step) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(6, Math.round(Math.min(width, height) / 100));
    context.strokeRect(10, 10, width - 20, height - 20);
    context.fillStyle = '#ffffff';
    context.font = `${Math.round(Math.min(width, height) / 9)}px sans-serif`;
    context.fillText(id, Math.round(width * 0.06), Math.round(height * 0.16));
    const url = source.toDataURL('image/jpeg', 0.82);
    await manager.addImage(id, url, { refreshBackground: false });
    window.addImageToSidebar?.(url, id, `${id}.jpg`);
    await manager.whenIdle?.();
  }, spec);
}

/**
 * Switch images the way a user does: with the stepper pill under the frame.
 * Large projects collapse the stepper, so fall back to the same unforced
 * `switchView` call that the gallery makes.
 */
export async function openView(page: Page, viewId: string): Promise<void> {
  const current = await page.evaluate(() => window.app!.projectManager.currentViewId);
  if (current !== viewId) {
    const pill = page.locator(`#mini-stepper button[data-target="${viewId}"]`).first();
    const clicked = (await pill.isVisible().catch(() => false))
      ? await pill
          .click({ timeout: 1_500 })
          .then(() => true)
          .catch(() => false)
      : false;
    const switched = clicked
      ? await page
          .waitForFunction(id => window.app!.projectManager.currentViewId === id, viewId, {
            timeout: 3_000,
          })
          .then(() => true)
          .catch(() => false)
      : false;
    if (!switched) {
      await page.evaluate(id => window.app!.projectManager.switchView(id), viewId);
    }
  }
  await waitForIdle(page);
}

export async function framePoint(
  page: Page,
  fx: number,
  fy: number
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ x, y }) => {
      const rect = document.getElementById('captureFrame')!.getBoundingClientRect();
      return { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
    },
    { x: fx, y: fy }
  );
}

export async function dragInFrame(
  page: Page,
  from: [number, number],
  to: [number, number],
  via: Array<[number, number]> = []
): Promise<void> {
  const start = await framePoint(page, from[0], from[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  let previous = start;
  for (const target of [...via, to]) {
    const next = await framePoint(page, target[0], target[1]);
    for (let step = 1; step <= 6; step += 1) {
      const t = step / 6;
      await page.mouse.move(
        previous.x + (next.x - previous.x) * t,
        previous.y + (next.y - previous.y) * t
      );
    }
    previous = next;
  }
  await page.mouse.up();
  await page.waitForTimeout(220);
}

export async function setStrokeStyle(
  page: Page,
  style: { color?: string; width?: number; dash?: string }
): Promise<void> {
  await page.evaluate(({ color, width, dash }) => {
    const toolManager = window.app!.toolManager;
    if (color) toolManager.updateSettings({ color });
    if (width) toolManager.updateSettings({ width });
    const dashSelect = document.getElementById('dashStyleSelect') as HTMLSelectElement | null;
    if (dashSelect && dash && dashSelect.value !== dash) {
      dashSelect.value = dash;
      dashSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, style);
}

export async function drawStroke(
  page: Page,
  tool: 'line' | 'arrow' | 'pencil' | 'shape' | 'highlighter',
  from: [number, number],
  to: [number, number],
  style: { color?: string; width?: number; dash?: string } = {},
  via: Array<[number, number]> = []
): Promise<void> {
  await selectTool(page, tool);
  await setStrokeStyle(page, { dash: 'solid', ...style });
  await dragInFrame(page, from, to, via);
}

export async function drawCurve(page: Page, points: Array<[number, number]>): Promise<void> {
  await selectTool(page, 'curve');
  for (let index = 0; index < points.length; index += 1) {
    const point = await framePoint(page, points[index][0], points[index][1]);
    if (index === points.length - 1) {
      await page.mouse.dblclick(point.x, point.y, { delay: 35 });
    } else {
      await page.mouse.click(point.x, point.y);
    }
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(220);
}

export async function addText(
  page: Page,
  at: [number, number],
  lines: string[],
  style: { fontFamily: string; fontSize: number; color: string; background: boolean }
): Promise<void> {
  await page.evaluate(async ({ fontFamily, fontSize, color, background }) => {
    const toolManager = window.app!.toolManager;
    // Font and colour pickers restyle a selected note; start from no selection
    // so each note keeps the style it was typed with.
    window.app!.canvasManager.fabricCanvas.discardActiveObject();
    (window as any).textBgEnabled = background;
    const tool = await toolManager.ensureTool('text');
    tool?.setFontFamily?.(fontFamily);
    toolManager.updateSettings({ fontFamily, fontSize, color });
    await toolManager.selectTool('text');
    toolManager.updateSettings({ fontFamily, fontSize, color });
  }, style);
  const point = await framePoint(page, at[0], at[1]);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    () => {
      const active = window.app!.canvasManager.fabricCanvas.getActiveObject() as any;
      return Boolean(active?.isEditing);
    },
    { timeout: 5_000 }
  );
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) await page.keyboard.press('Shift+Enter');
    await page.keyboard.type(lines[index], { delay: 8 });
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}

export async function setFrameLock(page: Page, locked: boolean): Promise<void> {
  const isLocked = await page.evaluate(() => !document.body.classList.contains('capture-unlocked'));
  if (isLocked !== locked) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('l');
    await page.waitForTimeout(150);
  }
}

/** Resize the frame with a real drag on one of its handles. */
/**
 * `fx`/`fy` are fractions of the current frame size. Handles resize from the
 * centre, so a drag of 0.1 changes that dimension by 20%.
 */
export async function dragFrameHandle(
  page: Page,
  direction: 'e' | 's' | 'se' | 'n' | 'w',
  fx: number,
  fy: number
): Promise<void> {
  await setFrameLock(page, false);
  const frameBox = await page.locator('#captureFrame').boundingBox();
  if (!frameBox) throw new Error('Capture frame is not visible');
  const dx = frameBox.width * fx;
  const dy = frameBox.height * fy;
  const handle = page.locator(`#captureFrame .resize-handle[data-direction="${direction}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Frame handle ${direction} is not visible`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(startX + (dx * step) / 8, startY + (dy * step) / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  await setFrameLock(page, true);
  await page.waitForTimeout(200);
}

export async function pressFrameSizeKey(page: Page, key: '+' | '-', times: number): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let index = 0; index < times; index += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
}

export async function setMeasurement(
  page: Page,
  viewId: string,
  strokeLabel: string,
  inches: number
): Promise<void> {
  await page.evaluate(
    ({ id, label, value }) => {
      const scope = window.getCaptureTabScopedLabel?.(id) || id;
      window.app!.metadataManager.setMeasurement(scope, label, {
        inch: value,
        cm: Number((value * 2.54).toFixed(2)),
        inputUnit: 'inches',
      });
    },
    { id: viewId, label: strokeLabel, value: inches }
  );
}

export async function captureView(page: Page, viewId: string): Promise<ViewSnapshot> {
  await openView(page, viewId);
  return page.evaluate(id => {
    const fabricApi = (window as any).fabric;
    const manager = window.app!.projectManager;
    const canvasManager = window.app!.canvasManager;
    const canvas = canvasManager.fabricCanvas;
    const background = canvas.backgroundImage as any;
    if (!background) throw new Error(`No background image for ${id}`);
    const round = (value: number, places = 4) => {
      const factor = 10 ** places;
      return Math.round(Number(value) * factor) / factor;
    };

    const bg = background.getBoundingRect(true, true);
    const toBox = (rect: { left: number; top: number; width: number; height: number }) => ({
      left: round((rect.left - bg.left) / bg.width),
      top: round((rect.top - bg.top) / bg.height),
      width: round(rect.width / bg.width),
      height: round(rect.height / bg.height),
    });

    const frameEl = document.getElementById('captureFrame')!;
    const frameRect = frameEl.getBoundingClientRect();
    const canvasRect = canvas.lowerCanvasEl.getBoundingClientRect();
    const cssScaleX = canvasRect.width / canvas.width || 1;
    const cssScaleY = canvasRect.height / canvas.height || 1;
    const inverse = fabricApi.util.invertTransform(canvas.viewportTransform);
    const corners = [
      [frameRect.left, frameRect.top],
      [frameRect.right, frameRect.top],
      [frameRect.right, frameRect.bottom],
      [frameRect.left, frameRect.bottom],
    ].map(([x, y]) =>
      fabricApi.util.transformPoint(
        new fabricApi.Point((x - canvasRect.left) / cssScaleX, (y - canvasRect.top) / cssScaleY),
        inverse
      )
    );
    const xs = corners.map((point: any) => point.x);
    const ys = corners.map((point: any) => point.y);
    const frameWorld = {
      left: Math.min(...xs),
      top: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };

    const tabState = (window as any).captureTabsByLabel?.[id];
    const activeTab = tabState?.tabs?.find((tab: any) => tab.id === tabState.activeTabId);
    // Stroke labels restart in every frame tab, so keys carry the tab name.
    const scopeName = (scope: unknown) => {
      const text = String(scope || '');
      const marker = text.indexOf('::tab:');
      if (marker < 0) return 'base';
      const tabId = text.slice(marker + 6);
      const tab = tabState?.tabs?.find((candidate: any) => candidate.id === tabId);
      return String(tab?.name || 'unknown-tab');
    };

    const zoom = Number(canvas.getZoom()) || 1;
    const objects: any[] = [];
    const tags: any[] = [];
    const counters: Record<string, number> = {};
    canvas.getObjects().forEach((object: any) => {
      if (object.isConnectorLine) return;
      const rect = object.getBoundingRect(true, true);
      if (object.isTag) {
        const textChild =
          typeof object.getObjects === 'function'
            ? object.getObjects().find((child: any) => typeof child.text === 'string')
            : null;
        tags.push({
          label: `${String(object.strokeLabel || '')}@${scopeName(object.scopedLabel)}`,
          text: String(textChild?.text ?? object.text ?? ''),
          box: toBox(rect),
          visible: object.visible !== false,
        });
        return;
      }
      const label = object.strokeMetadata?.strokeLabel;
      const scope = scopeName(object.strokeMetadata?.imageLabel || object.imageLabel);
      const baseKey = label ? `${object.type}:${label}@${scope}` : `${object.type}@${scope}`;
      counters[baseKey] = (counters[baseKey] || 0) + 1;
      const isText = object.type === 'i-text' || object.type === 'text';
      const entry: any = {
        key: label ? baseKey : `${baseKey}#${counters[baseKey]}`,
        type: object.type,
        visible: object.visible !== false,
        stroke: typeof object.stroke === 'string' ? object.stroke : null,
        strokeWidth: Number.isFinite(object.strokeWidth) ? round(object.strokeWidth, 2) : null,
        dash: Array.isArray(object.strokeDashArray)
          ? object.strokeDashArray.map((value: number) => round(value, 1)).join(',')
          : object.lineStyle || object.dashSettings?.style || null,
        fill: typeof object.fill === 'string' ? object.fill : null,
        angle: round(object.angle || 0, 2),
        box: toBox(rect),
      };
      if (isText) {
        entry.key = `text:${String(object.text).split('\n')[0]}`;
        entry.text = object.text;
        entry.fontFamily = object.fontFamily;
        entry.fontSize = object.fontSize;
        entry.fontWeight = String(object.fontWeight);
        entry.fontStyle = String(object.fontStyle);
        entry.backgroundColor = object.backgroundColor || '';
        entry.textAlign = object.textAlign;
        entry.lineHeight = object.lineHeight;
        entry.padding = object.padding;
        entry.scaleX = round(object.scaleX, 4);
        entry.scaleY = round(object.scaleY, 4);
        entry.screenHeightInFrame = round((rect.height * zoom * cssScaleY) / frameRect.height);
      }
      objects.push(entry);
    });
    objects.sort((a, b) => a.key.localeCompare(b.key));
    tags.sort((a, b) => a.label.localeCompare(b.label));

    const measurements: Record<string, string> = {};
    const allMeasurements = window.app!.metadataManager.strokeMeasurements || {};
    Object.keys(allMeasurements)
      .filter(scope => scope === id || scope.startsWith(`${id}::`))
      .sort()
      .forEach(scope => {
        Object.entries(allMeasurements[scope] || {}).forEach(([label, value]: [string, any]) => {
          measurements[`${label}@${scopeName(scope)}`] =
            `${round(Number(value?.inch) || 0, 3)}in/${round(Number(value?.cm) || 0, 2)}cm`;
        });
      });

    return {
      viewId: id,
      rotation: round(Number(manager.views[id]?.rotation) || 0, 2),
      zoom: round(zoom, 4),
      tabCount: Array.isArray(tabState?.tabs) ? tabState.tabs.length : 0,
      activeTabName: String(activeTab?.name || ''),
      frame: {
        width: round(frameRect.width, 1),
        height: round(frameRect.height, 1),
        aspect: round(frameRect.width / frameRect.height, 3),
        crop: toBox(frameWorld),
      },
      objects,
      tags: tags.map(({ label, text, box }) => ({ label, text, box })),
      measurements,
    };
  }, viewId);
}

export async function captureAllViews(
  page: Page,
  viewIds: string[],
  screenshotDir?: string
): Promise<Map<string, ViewSnapshot>> {
  const snapshots = new Map<string, ViewSnapshot>();
  for (const viewId of viewIds) {
    snapshots.set(viewId, await captureView(page, viewId));
    if (screenshotDir) {
      const frame = await page.locator('#captureFrame').boundingBox();
      if (frame) {
        await page.screenshot({
          path: `${screenshotDir}/${viewId}.png`,
          clip: {
            x: Math.max(0, frame.x - 6),
            y: Math.max(0, frame.y - 6),
            width: frame.width + 12,
            height: frame.height + 12,
          },
        });
      }
    }
  }
  return snapshots;
}

export type CompareOptions = {
  /** Compare frame pixel size (only meaningful at an unchanged window size). */
  framePixels?: boolean;
  framePixelTolerance?: number;
  cropTolerance?: number;
  boxTolerance?: number;
};

export function compareSnapshots(
  before: ViewSnapshot,
  after: ViewSnapshot,
  options: CompareOptions = {}
): Difference[] {
  const differences: Difference[] = [];
  const viewId = before.viewId;
  const framePixelTolerance = options.framePixelTolerance ?? 2;
  const cropTolerance = options.cropTolerance ?? 0.012;
  const boxTolerance = options.boxTolerance ?? 0.008;
  const note = (field: string, a: unknown, b: unknown) =>
    differences.push({ viewId, field, before: a, after: b });
  const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
  const boxNear = (a: ObjectSnapshot['box'], b: ObjectSnapshot['box'], tolerance: number) =>
    near(a.left, b.left, tolerance) &&
    near(a.top, b.top, tolerance) &&
    near(a.width, b.width, tolerance) &&
    near(a.height, b.height, tolerance);

  if (!near(before.rotation, after.rotation, 0.01))
    note('rotation', before.rotation, after.rotation);
  if (before.tabCount !== after.tabCount) note('tabCount', before.tabCount, after.tabCount);
  if (before.activeTabName !== after.activeTabName) {
    note('activeTabName', before.activeTabName, after.activeTabName);
  }
  if (options.framePixels !== false) {
    if (
      !near(before.frame.width, after.frame.width, framePixelTolerance) ||
      !near(before.frame.height, after.frame.height, framePixelTolerance)
    ) {
      note(
        'frame.size',
        `${before.frame.width}x${before.frame.height}`,
        `${after.frame.width}x${after.frame.height}`
      );
    }
  }
  if (!near(before.frame.aspect, after.frame.aspect, 0.02)) {
    note('frame.aspect', before.frame.aspect, after.frame.aspect);
  }
  if (!boxNear(before.frame.crop, after.frame.crop, cropTolerance)) {
    note('frame.crop', before.frame.crop, after.frame.crop);
  }

  const afterObjects = new Map(after.objects.map(object => [object.key, object]));
  const beforeKeys = new Set(before.objects.map(object => object.key));
  for (const object of before.objects) {
    const match = afterObjects.get(object.key);
    if (!match) {
      note(`object[${object.key}]`, 'present', 'missing');
      continue;
    }
    const exactFields: Array<keyof ObjectSnapshot> = [
      'type',
      'visible',
      'stroke',
      'strokeWidth',
      'dash',
      'fill',
      'text',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'backgroundColor',
      'textAlign',
      'lineHeight',
      'padding',
    ];
    for (const field of exactFields) {
      if (JSON.stringify(object[field]) !== JSON.stringify(match[field])) {
        note(`object[${object.key}].${field}`, object[field], match[field]);
      }
    }
    if (!near(object.angle, match.angle, 0.05)) {
      note(`object[${object.key}].angle`, object.angle, match.angle);
    }
    for (const field of ['scaleX', 'scaleY'] as const) {
      if (object[field] !== undefined && !near(object[field]!, match[field] ?? NaN, 0.002)) {
        note(`object[${object.key}].${field}`, object[field], match[field]);
      }
    }
    if (!boxNear(object.box, match.box, boxTolerance)) {
      note(`object[${object.key}].box`, object.box, match.box);
    }
    if (
      options.framePixels !== false &&
      object.screenHeightInFrame !== undefined &&
      !near(object.screenHeightInFrame, match.screenHeightInFrame ?? NaN, 0.006)
    ) {
      note(
        `object[${object.key}].screenHeightInFrame`,
        object.screenHeightInFrame,
        match.screenHeightInFrame
      );
    }
  }
  for (const object of after.objects) {
    if (!beforeKeys.has(object.key)) note(`object[${object.key}]`, 'missing', 'present');
  }

  const afterTags = new Map(after.tags.map(tag => [tag.label, tag]));
  for (const tag of before.tags) {
    const match = afterTags.get(tag.label);
    if (!match) {
      note(`tag[${tag.label}]`, 'present', 'missing');
      continue;
    }
    if (tag.text !== match.text) note(`tag[${tag.label}].text`, tag.text, match.text);
    // Tags keep a constant on-screen size, so their image-relative box moves
    // with zoom. Only their anchor position is compared, with a looser bound.
    const centre = (box: ObjectSnapshot['box']) => ({
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    });
    const a = centre(tag.box);
    const b = centre(match.box);
    if (!near(a.x, b.x, 0.02) || !near(a.y, b.y, 0.02)) {
      note(`tag[${tag.label}].centre`, a, b);
    }
  }
  if (before.tags.length !== after.tags.length) {
    note('tags.count', before.tags.length, after.tags.length);
  }
  if (JSON.stringify(before.measurements) !== JSON.stringify(after.measurements)) {
    note('measurements', before.measurements, after.measurements);
  }
  return differences;
}

export function compareAll(
  before: Map<string, ViewSnapshot>,
  after: Map<string, ViewSnapshot>,
  options: CompareOptions = {}
): Difference[] {
  const differences: Difference[] = [];
  before.forEach((snapshot, viewId) => {
    const match = after.get(viewId);
    if (!match) {
      differences.push({ viewId, field: 'view', before: 'present', after: 'missing' });
      return;
    }
    differences.push(...compareSnapshots(snapshot, match, options));
  });
  return differences;
}

/**
 * Reproduce what Postgres `jsonb` does to a saved project: object keys are
 * de-duplicated and re-ordered (shorter keys first, then bytewise), and the
 * value comes back through a JSON round trip. Array order is preserved.
 */
export function normalizeLikePostgresJsonb(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeLikePostgresJsonb);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    Object.keys(source)
      .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
      .forEach(key => {
        result[key] = normalizeLikePostgresJsonb(source[key]);
      });
    return result;
  }
  return value;
}

/** Serialise exactly as the Cloud Save button does, then normalise like the database. */
export async function cloudSavePayload(page: Page): Promise<any> {
  const raw = await page.evaluate(async () => {
    const manager = window.app!.projectManager;
    await manager.whenIdle?.({ timeoutMs: 5_000 });
    const data = await manager.getProjectData({ embedImages: true, uploadImagesToR2: false });
    return JSON.stringify(data);
  });
  return normalizeLikePostgresJsonb(JSON.parse(raw));
}

export async function cloudLoadPayload(page: Page, payload: unknown): Promise<void> {
  await page.evaluate(data => window.app!.projectManager.loadProjectFromData(data), payload);
  await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 90_000 });
  await page.waitForTimeout(900);
  await waitForIdle(page);
}

export function formatDifferences(differences: Difference[], limit = 60): string {
  if (!differences.length) return 'no differences';
  const lines = differences
    .slice(0, limit)
    .map(
      diff =>
        `  ${diff.viewId} · ${diff.field}: ${JSON.stringify(diff.before)} -> ${JSON.stringify(diff.after)}`
    );
  if (differences.length > limit) lines.push(`  … ${differences.length - limit} more`);
  return `${differences.length} difference(s):\n${lines.join('\n')}`;
}
