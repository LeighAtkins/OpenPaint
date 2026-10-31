import {
  getPieceDimensions,
  getSectionalPieceCapabilities,
  type SectionalPiece,
  type SectionalProductStyle,
} from '../ui/sectional-builder';
import { createSofaDocument, type SofaDocument, type SofaModule } from './model';
export interface StudioOpenRequest {
  benchmark?: string;
  model?: string;
  sectional?: { name: string; pieces: SectionalPiece[]; style: SectionalProductStyle };
  cw?: { name: string; reference: string; data: unknown; image?: string };
}
export function fromSectional(request: NonNullable<StudioOpenRequest['sectional']>): SofaDocument {
  const doc = createSofaDocument('sofa');
  doc.title = request.name;
  doc.pillows = 0;
  doc.style = {
    arm: request.style.arm,
    back: request.style.back,
    cushion: request.style.cushion,
    base: request.style.base,
  };
  const cols = new Map<number, number>(),
    rows = new Map<number, number>();
  for (const piece of request.pieces) {
    const d = getPieceDimensions(piece);
    cols.set(piece.col, Math.max(cols.get(piece.col) || 0, d.width));
    rows.set(piece.row, Math.max(rows.get(piece.row) || 0, d.depth));
  }
  const offset = (values: Map<number, number>, i: number) =>
    [...values].filter(([k]) => k < i).reduce((s, [, v]) => s + v, 0);
  const width = [...cols.values()].reduce((a, b) => a + b, 0),
    depth = [...rows.values()].reduce((a, b) => a + b, 0);
  doc.dimensions.width = width;
  doc.dimensions.depth = depth;
  doc.modules = request.pieces.map(piece => {
    const footprint = getPieceDimensions(piece);
    const rotated = Math.abs(piece.rotation % 180) > 0;
    const caps = getSectionalPieceCapabilities(piece.kind);
    let arms = [...caps.armSides];
    if (piece.mirrored) arms = arms.map(s => (s === 'left' ? 'right' : 'left'));
    return {
      id: piece.id,
      corner: piece.kind === 'corner',
      cornerSide: piece.mirrored ? 'left' : 'right',
      width: rotated ? footprint.depth : footprint.width,
      depth: rotated ? footprint.width : footprint.depth,
      x: offset(cols, piece.col) + footprint.width / 2 - width / 2,
      z: offset(rows, piece.row) + footprint.depth / 2 - depth / 2,
      rotation: -piece.rotation,
      leftArm: arms.includes('left'),
      rightArm: arms.includes('right'),
      back: caps.hasBackFrame,
      seats: 1,
    } satisfies SofaModule;
  });
  doc.source = {
    kind: 'sectional',
    reference: request.name,
    notes: ['Module dimensions and rotations imported from Sectional Builder.'],
  };
  return doc;
}
export function fromCw(request: NonNullable<StudioOpenRequest['cw']>): SofaDocument {
  const raw = request.data as Record<string, any>;
  const source =
    raw?.qcMeasurements?.data ||
    raw?.data?.qcMeasurements?.data ||
    raw?.items?.[0]?.data?.qcMeasurements?.data ||
    raw;
  const doc = createSofaDocument('two-seat');
  doc.title = request.name || request.reference;
  const cm = (value: unknown): number | undefined => {
    const n = Number(typeof value === 'object' && value ? (value as { cm?: number }).cm : value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  for (const key of ['width', 'depth', 'height'] as const)
    doc.dimensions[key] = cm(source?.[key]) ?? doc.dimensions[key];
  const components = Array.isArray(source?.product_components) ? source.product_components : [];
  const seat = components.find((c: any) => /seat cushion/i.test(c.name));
  doc.dimensions.seatCount = Math.min(8, Math.max(1, Number(seat?.quantity) || 2));
  const back = components.find((c: any) => /back cushion/i.test(c.name));
  if (back) {
    const backs = Math.min(8, Math.max(1, Number(back?.quantity) || doc.dimensions.seatCount));
    if (backs !== doc.dimensions.seatCount) doc.cushionLayout = { backs };
  }
  const pattern = (c: any, name: string) =>
    cm(c?.measurements?.find((m: any) => m.name === name)?.value);
  for (const [name, kind] of [
    ['Seat Cushion Cover', 'seat'],
    ['Back Cushion Cover', 'back'],
  ] as const) {
    const c = components.find((c: any) => c.name === name);
    if (!c) continue;
    for (let i = 0; i < doc.dimensions.seatCount; i++) {
      const w = pattern(c, 'Width'),
        h = pattern(c, 'Height'),
        t = pattern(c, 'Thickness');
      doc.overrides[`main:${kind}-${i}`] = {
        ...(w ? { width: w } : {}),
        ...(kind === 'seat'
          ? { ...(h ? { depth: h } : {}), ...(t ? { height: t } : {}) }
          : { ...(h ? { height: h } : {}), ...(t ? { depth: t } : {}) }),
      };
    }
  }
  const accent = components.find((c: any) => /accent cushion/i.test(c.name));
  doc.pillows = accent ? Math.min(8, Number(accent.quantity) || 1) : 0;
  if (accent)
    for (let i = 0; i < doc.pillows; i++)
      doc.overrides[`main:pillow-${i}`] = {
        width: pattern(accent, 'Width (Bottom)') || 42,
        height: pattern(accent, 'Height') || 42,
        depth: pattern(accent, 'Thickness (Bottom)') || 13,
        shape: 'half-knife',
      };
  const singleArm = /__L|__R/.test(request.reference);
  if (singleArm) {
    doc.dimensions.armWidth = Math.min(21, doc.dimensions.width * 0.12);
    doc.modules = [
      {
        id: 'main',
        width: doc.dimensions.width,
        depth: doc.dimensions.depth,
        x: 0,
        z: 0,
        rotation: 0,
        leftArm: request.reference.includes('__L'),
        rightArm: request.reference.includes('__R'),
        back: true,
        seats: doc.dimensions.seatCount,
      },
    ];
  }
  doc.source = {
    kind: 'cw',
    reference: request.reference,
    notes: [
      'Available catalogue dimensions applied. Frame construction and unprovided dimensions remain editable defaults.',
      'Component cover sizes are used as initial geometry estimates. Confirm their fit against the assembled sofa; pattern dimensions may include construction allowances.',
    ],
  };
  return doc;
}
