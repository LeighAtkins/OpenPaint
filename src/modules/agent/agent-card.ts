/**
 * Question cards: one clean PNG per customer question, drawn from a project's
 * own photos and line geometry. Only the lines asked about are drawn, labelled
 * inches first with cm, with an optional title and caption.
 */
import { fitBox, formatInchCm, type NormPoint } from './agent-geometry';

export type CardColor = 'red' | 'green' | 'amber' | 'blue' | 'ink' | string;

export interface CardLine {
  /** Label shown on the line, e.g. "E6". */
  label: string;
  /** Endpoints normalised to the photo. Taken from the project when omitted. */
  from?: NormPoint;
  to?: NormPoint;
  /** Value in inches. Taken from the project when omitted. */
  inch?: number | null;
  /** Full label text; overrides "E6  25½" (64.8 cm)". Use "X  ?" for a request. */
  text?: string;
  /** Mark the value as unknown: the label reads "X  ?". */
  unknown?: boolean;
  color?: CardColor;
  /** Label nudge as a fraction of the panel width/height. */
  offset?: { x?: number; y?: number };
}

export interface CardPanel {
  /** A project view id, or an image URL / data URL for photos outside the project. */
  viewId?: string;
  image?: string;
  lines: CardLine[];
  subtitle?: string;
  /** Normalised crop. 'fit' (default) frames the drawn lines; 'full' keeps the whole photo. */
  crop?: 'fit' | 'full' | { x0: number; y0: number; x1: number; y1: number };
}

export interface CardSpec {
  title?: string;
  /** Rows of panels; a flat list is one row. */
  panels: CardPanel[] | CardPanel[][];
  /** Caption lines; a line starting with "!" is drawn in red. */
  caption?: string[];
  width?: number;
}

export interface ResolvedPanel {
  bitmap: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  lines: Array<Required<Pick<CardLine, 'label'>> & CardLine & { from: NormPoint; to: NormPoint }>;
  subtitle?: string;
  crop: CardPanel['crop'];
}

const COLORS: Record<string, string> = {
  red: '#df4646',
  green: '#22a05a',
  amber: '#e68c14',
  blue: '#2878dc',
  ink: '#1c2434',
};
const INK = '#1c2434';
const GREY = '#6e7682';
const FONT = 'Arial, Helvetica, sans-serif';

const colorOf = (c?: CardColor) => COLORS[c || 'red'] || c || COLORS.red;

export function lineText(line: CardLine): string {
  if (line.text) return line.text;
  if (line.unknown || line.inch === null || line.inch === undefined) return `${line.label}  ?`;
  return `${line.label}  ${formatInchCm(line.inch)}`;
}

function arrow(
  ctx: CanvasRenderingContext2D,
  a: NormPoint,
  b: NormPoint,
  color: string,
  w: number
) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  for (const [p, q] of [
    [a, b],
    [b, a],
  ]) {
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const h = w * 4;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.lineTo(q.x - h * Math.cos(ang - 0.45), q.y - h * Math.sin(ang - 0.45));
    ctx.lineTo(q.x - h * Math.cos(ang + 0.45), q.y - h * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }
}

interface Rect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;

/** Place a label pill near (x, y), stepping along (dx, dy) away from earlier pills. */
function pill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  size: number,
  placed: Rect[],
  step: { x: number; y: number }
) {
  ctx.font = `bold ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 0.9;
  const h = size * 1.6;
  const at = (cx: number, cy: number): Rect => ({
    x0: Math.max(2, Math.min(ctx.canvas.width - w - 2, cx - w / 2)),
    y0: Math.max(2, Math.min(ctx.canvas.height - h - 2, cy - h / 2)),
    w,
    h,
  });
  let rect = at(x, y);
  for (let i = 1; i <= 8 && placed.some(r => overlaps(r, rect)); i += 1) {
    rect = at(x + step.x * h * 1.1 * i, y + step.y * h * 1.1 * i);
  }
  placed.push(rect);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size / 9);
  ctx.beginPath();
  ctx.roundRect(rect.x0, rect.y0, w, h, size * 0.4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rect.x0 + size * 0.45, rect.y0 + h / 2 + 1);
}

/**
 * Draw one panel's crop with its lines into a new canvas. `labelScale` grows the
 * labels for panels that will be shown small (several panels in a row).
 */
export function drawPanel(
  panel: ResolvedPanel,
  targetWidth = 900,
  labelScale = 1
): HTMLCanvasElement {
  const allPts = panel.lines.flatMap(l => [l.from, l.to]);
  const box =
    panel.crop === 'full'
      ? { x0: 0, y0: 0, x1: 1, y1: 1 }
      : typeof panel.crop === 'object' && panel.crop
        ? panel.crop
        : fitBox(allPts, 0.12, 0.28);
  const sw = (box.x1 - box.x0) * panel.width;
  const sh = (box.y1 - box.y0) * panel.height;
  const scale = targetWidth / sw;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(targetWidth);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    panel.bitmap as CanvasImageSource,
    box.x0 * panel.width,
    box.y0 * panel.height,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height
  );
  const px = (p: NormPoint) => ({
    x: (p.x - box.x0) * panel.width * scale,
    y: (p.y - box.y0) * panel.height * scale,
  });
  const lw = Math.max(3, canvas.width / 180);
  for (const line of panel.lines) arrow(ctx, px(line.from), px(line.to), colorOf(line.color), lw);
  const size = Math.round(Math.max(20, canvas.width / 32) * labelScale);
  const placed: Rect[] = [];
  for (const line of panel.lines) {
    const a = px(line.from);
    const b = px(line.to);
    // Default label spot: beside the midpoint, pushed off the line.
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const push = size * 1.3 * (ny < 0 ? -1 : 1);
    const x = (a.x + b.x) / 2 + nx * push + (line.offset?.x ?? 0) * canvas.width;
    const y = (a.y + b.y) / 2 + ny * push + (line.offset?.y ?? 0) * canvas.height;
    const away = Math.sign(push) || 1;
    pill(ctx, x, y, lineText(line), colorOf(line.color), size, placed, {
      x: nx * away,
      y: ny * away,
    });
  }
  return canvas;
}

/** Lay panels out in rows under a title, with a caption, and return the card canvas. */
export function composeCard(
  rows: Array<Array<{ canvas: HTMLCanvasElement; subtitle?: string }>>,
  spec: Pick<CardSpec, 'title' | 'caption' | 'width'>
): HTMLCanvasElement {
  const width = spec.width || 1100;
  const pad = 20;
  const gap = 16;
  const sized = rows.map(row => {
    const h = 380;
    let items = row.map(p => ({ ...p, w: (p.canvas.width * h) / p.canvas.height, h }));
    const total = items.reduce((s, i) => s + i.w, 0) + gap * (items.length - 1);
    const avail = width - pad * 2;
    const k = Math.min(avail / total, row.length === 1 ? 760 / h : 1.6);
    items = items.map(i => ({ ...i, w: i.w * k, h: i.h * k }));
    return items;
  });
  const captionLines = spec.caption || [];
  const titleH = spec.title ? 70 : 20;
  const height =
    titleH +
    sized.reduce((s, row) => s + Math.max(...row.map(i => i.h)) + 44, 0) +
    captionLines.length * 36 +
    (captionLines.length ? 24 : 0);
  const card = document.createElement('canvas');
  card.width = width;
  card.height = Math.round(height);
  const ctx = card.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, card.width, card.height);
  ctx.textBaseline = 'top';
  if (spec.title) {
    ctx.fillStyle = INK;
    ctx.font = `bold 32px ${FONT}`;
    ctx.fillText(spec.title, pad, 24);
  }
  let y = titleH;
  for (const row of sized) {
    const rowW = row.reduce((s, i) => s + i.w, 0) + gap * (row.length - 1);
    let x = (width - rowW) / 2;
    for (const item of row) {
      ctx.drawImage(item.canvas, x, y, item.w, item.h);
      ctx.strokeStyle = '#dce0e6';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, item.w, item.h);
      if (item.subtitle) {
        ctx.fillStyle = GREY;
        ctx.font = `bold 22px ${FONT}`;
        ctx.fillText(item.subtitle, x, y + item.h + 8, item.w);
      }
      x += item.w + gap;
    }
    y += Math.max(...row.map(i => i.h)) + 44;
  }
  y += 10;
  ctx.font = `25px ${FONT}`;
  for (const raw of captionLines) {
    const red = raw.startsWith('!');
    ctx.fillStyle = red ? COLORS.red : INK;
    ctx.fillText(red ? raw.slice(1) : raw, pad, y, width - pad * 2);
    y += 36;
  }
  return card;
}
