declare const fabric: any;

import {
  buildSectionalMeasurementRules,
  countFilledMeasurements,
  evaluateSectionalMeasurementRules,
} from './sectional-measurement-rules';

type PieceKind =
  | 'left-arm'
  | 'seat'
  | 'corner'
  | 'chaise'
  | 'right-arm'
  | 'ottoman'
  | 'left-arm-chaise'
  | 'right-arm-chaise'
  | 'armchair'
  | 'two-arm-chaise';
type ConnectorSide = 'top' | 'right' | 'bottom' | 'left';
type SectionalArmSide = 'left' | 'right';
type SectionalOpenEdge = 'front' | 'rear' | 'left' | 'right';
export type SectionalViewMode = 'plan' | 'front-left' | 'front-right';
export type SectionalArmStyle = 'square' | 'round' | 'wedge';
export type SectionalArmLength = 'full' | 'half';
export type SectionalBackCushionFit = 'straight' | 'wrap';
export type SectionalBackStyle = 'high' | 'short' | 'curved';
export type SectionalCushionStyle = 'boxed' | 'knife' | 'rounded';
export type SectionalBaseStyle = 'snug' | 'long-skirt' | 'loose-fit' | 'straight-skirt';

export interface SectionalProductStyle {
  arm: SectionalArmStyle;
  armLength: SectionalArmLength;
  back: SectionalBackStyle;
  backCushionFit: SectionalBackCushionFit;
  cushion: SectionalCushionStyle;
  base: SectionalBaseStyle;
}

export const DEFAULT_SECTIONAL_PRODUCT_STYLE: SectionalProductStyle = {
  arm: 'round',
  armLength: 'full',
  back: 'high',
  backCushionFit: 'straight',
  cushion: 'boxed',
  base: 'snug',
};

export interface SectionalPiece {
  id: string;
  kind: PieceKind;
  col: number;
  row: number;
  rotation: number;
  mirrored: boolean;
  guideCode?: string;
  armStyle?: SectionalArmStyle;
  armLength?: SectionalArmLength;
  backCushionFit?: SectionalBackCushionFit;
  backStyle?: SectionalBackStyle;
  cushionStyle?: SectionalCushionStyle;
  baseStyle?: SectionalBaseStyle;
  /** Editable real width in cm — overrides the kind default when set. */
  widthCm?: number;
  /** Editable real depth in cm — overrides the kind default when set. */
  depthCm?: number;
}

export interface SectionalAssemblyRecord {
  id: string;
  name: string;
  pieces: SectionalPiece[];
  imageViewId: string;
  updatedAt: string;
  theme?: SectionalThemeId;
  pricingCountry?: SectionalPricingCountry;
  pricingFabric?: SectionalPricingFabric;
  liveTransforms?: Record<string, NormalizedLiveSectionalTransform>;
  viewMode?: SectionalViewMode;
}

export interface SectionalConnectionReport {
  /** `${pieceId}:${worldSide}` keys whose socket has a compatible mate. */
  connected: Set<string>;
  /** `${pieceId}:${worldSide}` keys whose socket faces a piece without a matching socket. */
  conflicts: Set<string>;
}

const CELL = 132;
const BOARD_WIDTH = 920;
const BOARD_HEIGHT = 620;
const GRID_ORIGIN_X = 92;
const GRID_ORIGIN_Y = 72;

const PIECES: Record<PieceKind, { name: string; short: string; width: number; depth: number }> = {
  'left-arm': { name: 'Seat section - left arm', short: 'LA', width: 105, depth: 95 },
  seat: { name: 'Seat section - no arms', short: 'Seat', width: 90, depth: 95 },
  corner: { name: 'Corner seat', short: 'Cor', width: 100, depth: 100 },
  chaise: { name: 'Chaise', short: 'Chaise', width: 90, depth: 160 },
  'right-arm': { name: 'Seat section - right arm', short: 'RA', width: 105, depth: 95 },
  ottoman: { name: 'Ottoman', short: 'Ott', width: 90, depth: 60 },
  'left-arm-chaise': { name: 'Left arm chaise', short: 'LA-Ch', width: 105, depth: 160 },
  'right-arm-chaise': { name: 'Right arm chaise', short: 'RA-Ch', width: 105, depth: 160 },
  armchair: { name: 'Armchair', short: 'Chair', width: 105, depth: 95 },
  'two-arm-chaise': { name: 'Two-arm chaise', short: 'TA-Ch', width: 105, depth: 160 },
};

interface SectionalPieceCapabilities {
  hasBackFrame: boolean;
  hasBackCushion: boolean;
  armSides: readonly SectionalArmSide[];
  openEdges: readonly SectionalOpenEdge[];
}

/**
 * Physical anatomy belongs to the module kind, never to a rendering
 * heuristic. This keeps ottomans backless and arm/return modules stable when
 * the camera, rotation, or painter order changes.
 */
const SECTIONAL_PIECE_CAPABILITIES: Record<PieceKind, SectionalPieceCapabilities> = {
  'left-arm': {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: ['left'],
    openEdges: ['front', 'right'],
  },
  seat: {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: [],
    openEdges: ['front', 'left', 'right'],
  },
  corner: {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: [],
    openEdges: ['front', 'left'],
  },
  chaise: {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: [],
    openEdges: ['front', 'left', 'right'],
  },
  'right-arm': {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: ['right'],
    openEdges: ['front', 'left'],
  },
  ottoman: {
    hasBackFrame: false,
    hasBackCushion: false,
    armSides: [],
    openEdges: ['front', 'rear', 'left', 'right'],
  },
  'left-arm-chaise': {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: ['left'],
    openEdges: ['front', 'right'],
  },
  'right-arm-chaise': {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: ['right'],
    openEdges: ['front', 'left'],
  },
  armchair: {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: ['left', 'right'],
    openEdges: ['front'],
  },
  'two-arm-chaise': {
    hasBackFrame: true,
    hasBackCushion: true,
    armSides: ['left', 'right'],
    openEdges: ['front'],
  },
};

export function getSectionalPieceCapabilities(kind: PieceKind): SectionalPieceCapabilities {
  return SECTIONAL_PIECE_CAPABILITIES[kind];
}

/**
 * Recompute a real-world centimetre dimension after the user scales a piece.
 * `baseCm` is the known spec dimension at scale 1.0; `userScale` isolates the
 * user's incremental scaling from any initial SVG-to-world mapping.
 */
export function computeScaledDimension(baseCm: number, userScale: number): number {
  return Math.max(1, Math.round(baseCm * userScale));
}

/** Convert a requested real-world dimension back into a Fabric scale. */
export function computeScaleForDimension(
  baseCm: number,
  initialScale: number,
  targetCm: number
): number {
  const base = Number(baseCm);
  const initial = Number(initialScale);
  const target = Number(targetCm);
  if (!(base > 0) || !(initial > 0) || !(target > 0)) return initial || 1;
  return initial * (target / base);
}

export interface SectionalPoint {
  x: number;
  y: number;
}

export interface SectionalRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LiveSectionalPieceGeometry {
  pieceId: string;
  kind: PieceKind;
  mirrored?: boolean;
  /** Fabric corner order: top-left, top-right, bottom-right, bottom-left. */
  corners: [SectionalPoint, SectionalPoint, SectionalPoint, SectionalPoint];
}

export interface LiveSectionalConnectorAnchor {
  pieceId: string;
  localSide: ConnectorSide;
  point: SectionalPoint;
  normal: SectionalPoint;
}

export interface LiveSectionalSnap {
  movingPieceId: string;
  targetPieceId: string;
  movingSide: ConnectorSide;
  targetSide: ConnectorSide;
  delta: SectionalPoint;
  distance: number;
}

export interface NormalizedLiveSectionalTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  angle: number;
}

const midpoint = (a: SectionalPoint, b: SectionalPoint): SectionalPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const normalizeVector = (x: number, y: number): SectionalPoint => {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
};

const geometryCenter = (geometry: LiveSectionalPieceGeometry): SectionalPoint => ({
  x: geometry.corners.reduce((sum, point) => sum + point.x, 0) / 4,
  y: geometry.corners.reduce((sum, point) => sum + point.y, 0) / 4,
});

const edgeForSide = (
  geometry: LiveSectionalPieceGeometry,
  side: ConnectorSide
): [SectionalPoint, SectionalPoint] => {
  const [topLeft, topRight, bottomRight, bottomLeft] = geometry.corners;
  if (side === 'top') return [topLeft, topRight];
  if (side === 'right') return [topRight, bottomRight];
  if (side === 'bottom') return [bottomLeft, bottomRight];
  return [topLeft, bottomLeft];
};

/**
 * Return the live width/depth line just outside a transformed Fabric group.
 * Using the group's corners keeps the line attached through move, scale and
 * arbitrary rotation instead of rebuilding it from stale grid coordinates.
 */
export function getLiveMeasurementSegment(
  geometry: LiveSectionalPieceGeometry,
  dimension: 'width' | 'depth',
  gap = 16
): { start: SectionalPoint; end: SectionalPoint } {
  const edge = edgeForSide(geometry, dimension === 'width' ? 'top' : 'left');
  const center = geometryCenter(geometry);
  const edgeCenter = midpoint(edge[0], edge[1]);
  const outward = normalizeVector(edgeCenter.x - center.x, edgeCenter.y - center.y);
  const offset = { x: outward.x * gap, y: outward.y * gap };
  return {
    start: { x: edge[0].x + offset.x, y: edge[0].y + offset.y },
    end: { x: edge[1].x + offset.x, y: edge[1].y + offset.y },
  };
}

/** Build connector anchors from the actual transformed edges of a live piece. */
export function getLivePieceConnectorAnchors(
  geometry: LiveSectionalPieceGeometry
): LiveSectionalConnectorAnchor[] {
  let sides = [...PIECE_CONNECTORS[geometry.kind]];
  if (geometry.mirrored) {
    sides = sides.map(side => (side === 'left' ? 'right' : side === 'right' ? 'left' : side));
  }
  const center = geometryCenter(geometry);
  return sides.map(localSide => {
    const edge = edgeForSide(geometry, localSide);
    const point = midpoint(edge[0], edge[1]);
    return {
      pieceId: geometry.pieceId,
      localSide,
      point,
      normal: normalizeVector(point.x - center.x, point.y - center.y),
    };
  });
}

/** Find the closest pair of facing, compatible sockets within the threshold. */
export function findLiveSectionalSnap(
  moving: LiveSectionalPieceGeometry,
  candidates: LiveSectionalPieceGeometry[],
  threshold: number
): LiveSectionalSnap | null {
  const movingAnchors = getLivePieceConnectorAnchors(moving);
  let best: LiveSectionalSnap | null = null;
  candidates.forEach(candidate => {
    getLivePieceConnectorAnchors(candidate).forEach(targetAnchor => {
      movingAnchors.forEach(movingAnchor => {
        const facing =
          movingAnchor.normal.x * targetAnchor.normal.x +
          movingAnchor.normal.y * targetAnchor.normal.y;
        if (facing > -0.75) return;
        const dx = targetAnchor.point.x - movingAnchor.point.x;
        const dy = targetAnchor.point.y - movingAnchor.point.y;
        const distance = Math.hypot(dx, dy);
        if (distance > threshold || (best && best.distance <= distance)) return;
        best = {
          movingPieceId: moving.pieceId,
          targetPieceId: candidate.pieceId,
          movingSide: movingAnchor.localSide,
          targetSide: targetAnchor.localSide,
          delta: { x: dx, y: dy },
          distance,
        };
      });
    });
  });
  return best;
}

export function getLiveAssemblyMetrics(
  bounds: SectionalRect,
  initialBounds: SectionalRect,
  initialWidthCm: number,
  initialDepthCm: number
): { bounds: SectionalRect; widthCm: number; depthCm: number } {
  const widthScale = initialBounds.width > 0 ? bounds.width / initialBounds.width : 1;
  const depthScale = initialBounds.height > 0 ? bounds.height / initialBounds.height : 1;
  return {
    bounds,
    widthCm: computeScaledDimension(initialWidthCm, widthScale),
    depthCm: computeScaledDimension(initialDepthCm, depthScale),
  };
}

export function normalizeLiveSectionalTransform(
  transform: { left: number; top: number; scaleX: number; scaleY: number; angle: number },
  worldRect: SectionalRect,
  initialScaleX: number,
  initialScaleY: number
): NormalizedLiveSectionalTransform {
  return {
    x: worldRect.width ? (transform.left - worldRect.left) / worldRect.width : 0,
    y: worldRect.height ? (transform.top - worldRect.top) / worldRect.height : 0,
    scaleX: transform.scaleX / (initialScaleX || 1),
    scaleY: transform.scaleY / (initialScaleY || 1),
    angle: transform.angle || 0,
  };
}

export function restoreLiveSectionalTransform(
  transform: NormalizedLiveSectionalTransform,
  worldRect: SectionalRect,
  initialScaleX: number,
  initialScaleY: number
): { left: number; top: number; scaleX: number; scaleY: number; angle: number } {
  return {
    left: worldRect.left + transform.x * worldRect.width,
    top: worldRect.top + transform.y * worldRect.height,
    scaleX: (initialScaleX || 1) * transform.scaleX,
    scaleY: (initialScaleY || 1) * transform.scaleY,
    angle: transform.angle || 0,
  };
}

/**
 * Local-space attachment sockets per piece kind. All sockets use one
 * compatibility family ('seat-rail') for the vertical slice: two pieces join
 * when sockets face each other across a shared grid edge.
 */
const PIECE_CONNECTORS: Record<PieceKind, ConnectorSide[]> = {
  'left-arm': ['right'],
  seat: ['left', 'right'],
  corner: ['left', 'bottom'],
  chaise: ['left'],
  'right-arm': ['left'],
  ottoman: [],
  'left-arm-chaise': ['right'],
  'right-arm-chaise': ['left'],
  armchair: [],
  'two-arm-chaise': [],
};

const SIDE_ORDER: ConnectorSide[] = ['top', 'right', 'bottom', 'left'];
const SIDE_OFFSETS: Record<ConnectorSide, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};
const OPPOSITE_SIDE: Record<ConnectorSide, ConnectorSide> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};

/**
 * Derive a Comfort Works measurement-guide code from a piece's kind and mirror
 * state. The mapping covers the five standard module families plus the ottoman.
 * Codes follow the CW taxonomy: CS{n}{B|L}-{ARM}-{BACK}-{L|R}.
 */
export function deriveGuideCode(piece: SectionalPiece): string {
  if (piece.guideCode) return piece.guideCode;
  const facing = piece.mirrored ? 'R' : 'L';
  const armCode: Record<SectionalArmStyle, string> = {
    square: 'SA',
    round: 'RA',
    wedge: 'WA',
  };
  const backCode: Record<SectionalBackStyle, string> = {
    high: 'HB',
    short: 'SB',
    curved: 'RB',
  };
  const arm = armCode[piece.armStyle || DEFAULT_SECTIONAL_PRODUCT_STYLE.arm];
  const back = backCode[piece.backStyle || DEFAULT_SECTIONAL_PRODUCT_STYLE.back];
  switch (piece.kind) {
    case 'left-arm':
      return `CS1B-${arm}-${back}-${facing}`;
    case 'right-arm':
      return `CS1B-${arm}-${back}-${piece.mirrored ? 'L' : 'R'}`;
    case 'seat':
      return 'CS1B';
    case 'corner':
      return 'CS1-CNR';
    case 'chaise':
      return 'CS5L-SA';
    case 'ottoman':
      return 'CS0-SNUG';
    case 'left-arm-chaise':
      return `CS5L-${arm}-${back}-${facing}`;
    case 'right-arm-chaise':
      return `CS5L-${arm}-${back}-${piece.mirrored ? 'L' : 'R'}`;
    case 'armchair':
      return `CS1B-${arm}-${back}`;
    case 'two-arm-chaise':
      return `CS5L-${arm}-${back}`;
    default:
      return '';
  }
}

/** Pip geometry in local (pre-transform) cell coordinates. */
const CONNECTOR_PIPS: Record<ConnectorSide, string> = {
  top: '<rect x="52" y="3" width="14" height="8" rx="2.5"',
  right: '<rect x="107" y="52" width="8" height="14" rx="2.5"',
  bottom: '<rect x="52" y="107" width="14" height="8" rx="2.5"',
  left: '<rect x="3" y="52" width="8" height="14" rx="2.5"',
};

export type SectionalThemeId = 'flax' | 'charcoal' | 'navy' | 'terracotta' | 'forest' | 'sand';

interface SectionalTheme {
  name: string;
  body: string;
  cushion: string;
  cushionStroke: string;
  accent: string;
  outline: string;
}

/** Upholstery palettes tint the plan pieces; geometry and dims are unaffected. */
const SECTIONAL_THEMES: Record<SectionalThemeId, SectionalTheme> = {
  flax: {
    name: 'Flax',
    body: '#c2c9be',
    cushion: '#d9dcd2',
    cushionStroke: '#7c8779',
    accent: '#57645c',
    outline: '#333d38',
  },
  charcoal: {
    name: 'Charcoal',
    body: '#4a5252',
    cushion: '#636e6e',
    cushionStroke: '#394343',
    accent: '#2e3637',
    outline: '#1d2425',
  },
  navy: {
    name: 'Navy',
    body: '#4d5f7b',
    cushion: '#6b7fa0',
    cushionStroke: '#3d4e6a',
    accent: '#32405a',
    outline: '#232e42',
  },
  terracotta: {
    name: 'Terracotta',
    body: '#b57a60',
    cushion: '#d09d86',
    cushionStroke: '#8a5c49',
    accent: '#7d5340',
    outline: '#59392c',
  },
  forest: {
    name: 'Forest',
    body: '#5b7a64',
    cushion: '#7d9c87',
    cushionStroke: '#4a6355',
    accent: '#3f584a',
    outline: '#2c3f35',
  },
  sand: {
    name: 'Sand',
    body: '#cfc0a1',
    cushion: '#e6dabf',
    cushionStroke: '#a08f6f',
    accent: '#8d8069',
    outline: '#5f5647',
  },
};
const DEFAULT_THEME: SectionalThemeId = 'flax';

const createId = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ── CW unbranded slipcover pricing catalog ───────────────────────────────
// Sourced from comfort-works.com Shopify API. Maps sectional piece kind +
// mirror state to the closest product on the CW website with price and URL.
// Arm style defaults to square (SSA); round arm (SRA) variants exist at the
// same price point.

interface CwProduct {
  handle: string;
  title: string;
  price: number;
  url: string;
  ref: string;
}

export type SectionalPricingCountry =
  | 'US'
  | 'AU'
  | 'AT'
  | 'BE'
  | 'CA'
  | 'CN'
  | 'FR'
  | 'DE'
  | 'GLOBAL'
  | 'HK'
  | 'JP'
  | 'MO'
  | 'MY'
  | 'NZ'
  | 'SG'
  | 'ES'
  | 'CH'
  | 'TW'
  | 'GB';
export type SectionalPricingFabric =
  | 'everyday-weave'
  | 'everyday-cotton'
  | 'everyday-velvet'
  | 'care-canvas'
  | 'care-linen'
  | 'care-tweed'
  | 'mod-boucle'
  | 'mod-chenille'
  | 'signature-microfiber'
  | 'signature-velvet'
  | 'crypton®-chenille'
  | 'sunbrella®-canvas'
  | 'sunbrella®-fretwork'
  | 'classic-velvet';

interface SectionalPricingMarket {
  country: string;
  currency: string;
  locale: string;
  storefront: string;
  pathPrefix: string;
  shopifyCountry?: string;
}

interface SectionalPriceEntry {
  price: number;
  url?: string;
}

type SectionalPricingCatalog = Record<
  string,
  Partial<Record<SectionalPricingFabric, SectionalPriceEntry>>
>;

const SECTIONAL_PRICING_MARKETS: Record<SectionalPricingCountry, SectionalPricingMarket> = {
  US: {
    country: 'United States',
    currency: 'USD',
    locale: 'en-US',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
  },
  AU: {
    country: 'Australia',
    currency: 'AUD',
    locale: 'en-AU',
    storefront: 'https://comfortworks.com.au',
    pathPrefix: '',
  },
  AT: {
    country: 'Austria',
    currency: 'EUR',
    locale: 'de-AT',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
  },
  BE: {
    country: 'Belgium',
    currency: 'EUR',
    locale: 'en-BE',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
  },
  CA: {
    country: 'Canada',
    currency: 'CAD',
    locale: 'en-CA',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
  },
  CN: {
    country: 'China',
    currency: 'CNY',
    locale: 'zh-CN',
    storefront: 'https://comfort-works.cn',
    pathPrefix: '/zh-zh',
  },
  FR: {
    country: 'France',
    currency: 'EUR',
    locale: 'fr-FR',
    storefront: 'https://comfort-works.com',
    pathPrefix: '/fr-fr',
  },
  DE: {
    country: 'Germany',
    currency: 'EUR',
    locale: 'de-DE',
    storefront: 'https://comfort-works.de',
    pathPrefix: '',
  },
  GLOBAL: {
    country: 'Global',
    currency: 'USD',
    locale: 'en-US',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
    shopifyCountry: 'US',
  },
  HK: {
    country: 'Hong Kong SAR',
    currency: 'HKD',
    locale: 'en-HK',
    storefront: 'https://comfort-works.com',
    pathPrefix: '/en-hk',
  },
  JP: {
    country: 'Japan',
    currency: 'JPY',
    locale: 'ja-JP',
    storefront: 'https://comfort-works.com',
    pathPrefix: '/ja-jp',
  },
  MO: {
    country: 'Macao SAR',
    currency: 'MOP',
    locale: 'zh-MO',
    storefront: 'https://comfort-works.cn',
    pathPrefix: '/zh-mo',
  },
  MY: {
    country: 'Malaysia',
    currency: 'MYR',
    locale: 'en-MY',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
  },
  NZ: {
    country: 'New Zealand',
    currency: 'NZD',
    locale: 'en-NZ',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
  },
  SG: {
    country: 'Singapore',
    currency: 'SGD',
    locale: 'en-SG',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
  },
  ES: {
    country: 'Spain',
    currency: 'EUR',
    locale: 'es-ES',
    storefront: 'https://comfort-works.com',
    pathPrefix: '/es-es',
  },
  CH: {
    country: 'Switzerland',
    currency: 'CHF',
    locale: 'de-CH',
    storefront: 'https://comfort-works.com',
    pathPrefix: '',
  },
  TW: {
    country: 'Taiwan',
    currency: 'TWD',
    locale: 'zh-TW',
    storefront: 'https://comfort-works.cn',
    pathPrefix: '/zh-tw',
  },
  GB: {
    country: 'United Kingdom',
    currency: 'GBP',
    locale: 'en-GB',
    storefront: 'https://comfort-works.co.uk',
    pathPrefix: '',
  },
};

const SECTIONAL_PRICING_FABRICS: Record<SectionalPricingFabric, string> = {
  'everyday-weave': 'Everyday Weave',
  'everyday-cotton': 'Everyday Cotton',
  'everyday-velvet': 'Everyday Velvet',
  'care-canvas': 'Care+ Canvas',
  'care-linen': 'Care+ Linen',
  'care-tweed': 'Care+ Tweed',
  'mod-boucle': 'Mod Bouclé',
  'mod-chenille': 'Mod Chenille',
  'signature-microfiber': 'Signature Microfibre',
  'signature-velvet': 'Signature Velvet',
  'crypton®-chenille': 'Crypton® Chenille',
  'sunbrella®-canvas': 'Sunbrella® Canvas',
  'sunbrella®-fretwork': 'Sunbrella® Fretwork',
  'classic-velvet': 'Classic Velvet',
};

const DEFAULT_PRICING_COUNTRY: SectionalPricingCountry = 'US';
const DEFAULT_PRICING_FABRIC: SectionalPricingFabric = 'everyday-weave';

const CW_US_FABRIC_PRICES: SectionalPricingCatalog = {
  'boxed-seat-left-square-arm-chair-section-cover': {
    'everyday-weave': { price: 559 },
    'everyday-cotton': { price: 589 },
    'everyday-velvet': { price: 639 },
    'care-canvas': { price: 689 },
    'care-linen': { price: 859 },
    'care-tweed': { price: 719 },
    'mod-boucle': { price: 799 },
    'mod-chenille': { price: 759 },
    'signature-microfiber': { price: 1029 },
    'signature-velvet': { price: 979 },
    'crypton®-chenille': { price: 1089 },
    'sunbrella®-canvas': { price: 1339 },
    'sunbrella®-fretwork': { price: 1639 },
    'classic-velvet': { price: 519 },
  },
  'boxed-seat-right-square-arm-chair-section-cover': {},
  'boxed-seat-armless-chair-slipcover': {
    'everyday-weave': { price: 469 },
    'everyday-cotton': { price: 499 },
    'everyday-velvet': { price: 529 },
    'care-canvas': { price: 579 },
    'care-linen': { price: 719 },
    'care-tweed': { price: 599 },
    'mod-boucle': { price: 669 },
    'mod-chenille': { price: 639 },
    'signature-microfiber': { price: 869 },
    'signature-velvet': { price: 819 },
    'crypton®-chenille': { price: 909 },
    'sunbrella®-canvas': { price: 1129 },
    'sunbrella®-fretwork': { price: 1379 },
    'classic-velvet': { price: 519 },
  },
  'corner-square-seat-section-slipcover': {},
  'l-seat-left-square-arm-chaise-section-cover': {
    'everyday-weave': { price: 659 },
    'everyday-cotton': { price: 699 },
    'everyday-velvet': { price: 749 },
    'care-canvas': { price: 819 },
    'care-linen': { price: 1009 },
    'care-tweed': { price: 849 },
    'mod-boucle': { price: 939 },
    'mod-chenille': { price: 889 },
    'signature-microfiber': { price: 1219 },
    'signature-velvet': { price: 1149 },
    'crypton®-chenille': { price: 1279 },
    'sunbrella®-canvas': { price: 1579 },
    'sunbrella®-fretwork': { price: 1939 },
    'classic-velvet': { price: 709 },
  },
  'l-seat-right-square-arm-chaise-section-cover': {},
  'one-piece-ottoman-slipcover': {
    'everyday-weave': { price: 259 },
    'everyday-cotton': { price: 279 },
    'everyday-velvet': { price: 299 },
    'care-canvas': { price: 319 },
    'care-linen': { price: 399 },
    'care-tweed': { price: 339 },
    'mod-boucle': { price: 369 },
    'mod-chenille': { price: 349 },
    'signature-microfiber': { price: 479 },
    'signature-velvet': { price: 459 },
    'crypton®-chenille': { price: 509 },
    'sunbrella®-canvas': { price: 629 },
    'sunbrella®-fretwork': { price: 769 },
    'classic-velvet': { price: 249 },
  },
};

CW_US_FABRIC_PRICES['boxed-seat-right-square-arm-chair-section-cover'] =
  CW_US_FABRIC_PRICES['boxed-seat-left-square-arm-chair-section-cover'];
CW_US_FABRIC_PRICES['corner-square-seat-section-slipcover'] =
  CW_US_FABRIC_PRICES['boxed-seat-left-square-arm-chair-section-cover'];
CW_US_FABRIC_PRICES['l-seat-right-square-arm-chaise-section-cover'] =
  CW_US_FABRIC_PRICES['l-seat-left-square-arm-chaise-section-cover'];

// CW sells multi-seat end units alongside single-seat sections: a loveseat
// section (CS2B), a sofa section (CS3B), a boxed-seat round-arm chaise (CS5B)
// and an armless sofa section (CS3X). Their fabric ladders are anchored on
// the Shopify snapshot price and follow the chair-section tier structure
// until the lazy Shopify fetch refines them.
const scaleLadder = (
  base: Partial<Record<SectionalPricingFabric, SectionalPriceEntry>>,
  factor: number
): Partial<Record<SectionalPricingFabric, SectionalPriceEntry>> =>
  Object.fromEntries(
    Object.entries(base).map(([fabric, entry]) => [
      fabric,
      {
        ...(entry as SectionalPriceEntry),
        price: Math.round(((entry as SectionalPriceEntry).price * factor) / 10) * 10,
      },
    ])
  );
{
  const chairArmLadder = CW_US_FABRIC_PRICES['boxed-seat-left-square-arm-chair-section-cover'];
  const chairArmlessLadder = CW_US_FABRIC_PRICES['boxed-seat-armless-chair-slipcover'];
  // Snapshot anchors (classic-velvet tier): CS2B $709, CS3B $859, CS3X $859;
  // CS5B shares the CS5L chaise ladder (both $659 default).
  CW_US_FABRIC_PRICES['boxed-seat-left-round-arm-loveseat-section-cover'] = scaleLadder(
    chairArmLadder,
    709 / 519
  );
  CW_US_FABRIC_PRICES['boxed-seat-left-square-arm-loveseat-section-cover'] = scaleLadder(
    chairArmLadder,
    709 / 519
  );
  CW_US_FABRIC_PRICES['boxed-seat-left-round-arm-sofa-section-cover'] = scaleLadder(
    chairArmLadder,
    859 / 519
  );
  CW_US_FABRIC_PRICES['boxed-seat-left-square-arm-sofa-section-cover'] = scaleLadder(
    chairArmLadder,
    859 / 519
  );
  CW_US_FABRIC_PRICES['boxed-seat-left-round-arm-chaise-section-cover'] =
    CW_US_FABRIC_PRICES['l-seat-left-square-arm-chaise-section-cover'];
  CW_US_FABRIC_PRICES['armless-sofa-section-slipcover'] = scaleLadder(
    chairArmlessLadder,
    859 / 469
  );
  CW_US_FABRIC_PRICES['boxed-seat-left-round-arm-chair-section-cover'] = chairArmLadder;
  CW_US_FABRIC_PRICES['boxed-seat-right-round-arm-chair-section-cover'] = chairArmLadder;
  CW_US_FABRIC_PRICES['boxed-seat-right-round-arm-loveseat-section-cover'] =
    CW_US_FABRIC_PRICES['boxed-seat-left-round-arm-loveseat-section-cover'];
  CW_US_FABRIC_PRICES['boxed-seat-right-square-arm-loveseat-section-cover'] =
    CW_US_FABRIC_PRICES['boxed-seat-left-square-arm-loveseat-section-cover'];
  CW_US_FABRIC_PRICES['boxed-seat-right-round-arm-sofa-section-cover'] =
    CW_US_FABRIC_PRICES['boxed-seat-left-round-arm-sofa-section-cover'];
  CW_US_FABRIC_PRICES['boxed-seat-right-square-arm-sofa-section-cover'] =
    CW_US_FABRIC_PRICES['boxed-seat-left-square-arm-sofa-section-cover'];
  CW_US_FABRIC_PRICES['boxed-seat-right-round-arm-chaise-section-cover'] =
    CW_US_FABRIC_PRICES['boxed-seat-left-round-arm-chaise-section-cover'];
}

const CW_SECTIONAL_COLLECTION = 'custom-sectional-slipcovers';
const CW_OTTOMAN_COLLECTION = 'custom-ottoman-slipcovers';
const CW_BASE = 'https://comfort-works.com';

function cwUrl(handle: string): string {
  return `${CW_BASE}/products/${handle}`;
}

function localizedCwUrl(handle: string, country: SectionalPricingCountry): string {
  const market = SECTIONAL_PRICING_MARKETS[country];
  const base = `${market.storefront}${market.pathPrefix}/products/${encodeURI(handle)}`;
  const countryParam = market.shopifyCountry || country;
  const needsCountryParam =
    !market.pathPrefix && market.storefront === CW_BASE && country !== 'US' && country !== 'GLOBAL';
  return needsCountryParam ? `${base}?country=${encodeURIComponent(countryParam)}` : base;
}

function localizeCwProductUrl(url: string | undefined, country: SectionalPricingCountry): string {
  const match = String(url || '').match(/\/products\/([^?#/]+)/);
  return localizedCwUrl(match?.[1] || '', country);
}

function cwProduct(handle: string, title: string, price: number, ref: string): CwProduct {
  return { handle, title, price, url: cwUrl(handle), ref };
}

/** Map a sectional piece to its CW unbranded slipcover product. */
export function getPiecePricing(piece: SectionalPiece): CwProduct | null {
  const facing = piece.mirrored ? 'R' : 'L';
  switch (piece.kind) {
    case 'left-arm':
      return piece.mirrored
        ? cwProduct(
            'boxed-seat-right-square-arm-chair-section-cover',
            'Right Square Arm Chair Section Cover',
            519,
            'CS1B-SSA-R'
          )
        : cwProduct(
            'boxed-seat-left-square-arm-chair-section-cover',
            'Left Square Arm Chair Section Cover',
            519,
            'CS1B-SSA-L'
          );
    case 'right-arm':
      return piece.mirrored
        ? cwProduct(
            'boxed-seat-left-square-arm-chair-section-cover',
            'Left Square Arm Chair Section Cover',
            519,
            'CS1B-SSA-L'
          )
        : cwProduct(
            'boxed-seat-right-square-arm-chair-section-cover',
            'Right Square Arm Chair Section Cover',
            519,
            'CS1B-SSA-R'
          );
    case 'seat':
      return cwProduct(
        'boxed-seat-armless-chair-slipcover',
        'Armless Chair Slipcover',
        469,
        'CS1X-NA'
      );
    case 'corner':
      return cwProduct(
        'corner-square-seat-section-slipcover',
        'Corner Square Seat Section Slipcover',
        519,
        'CS1-CNR'
      );
    case 'chaise':
      return piece.mirrored
        ? cwProduct(
            'l-seat-right-square-arm-chaise-section-cover',
            'Right Square Arm Chaise Section Cover',
            659,
            'CS5L-SSA-R'
          )
        : cwProduct(
            'l-seat-left-square-arm-chaise-section-cover',
            'Left Square Arm Chaise Section Cover',
            659,
            'CS5L-SSA-L'
          );
    case 'left-arm-chaise':
      return cwProduct(
        'l-seat-left-square-arm-chaise-section-cover',
        'Left Square Arm Chaise Section Cover',
        659,
        'CS5L-SSA-L'
      );
    case 'right-arm-chaise':
      return cwProduct(
        'l-seat-right-square-arm-chaise-section-cover',
        'Right Square Arm Chaise Section Cover',
        659,
        'CS5L-SSA-R'
      );
    case 'ottoman':
      return cwProduct(
        'one-piece-ottoman-slipcover',
        'One-piece Ottoman Slipcover',
        249,
        'CS0-SNUG-1'
      );
    case 'armchair':
      // Standalone armchairs: same boxed-seat chair products as the sectional
      // end units, without the facing suffix (both arms included).
      return cwProduct(
        'boxed-seat-left-round-arm-chair-section-cover',
        'Boxed Seat Round Arm Chair Cover',
        519,
        'CS1B-RA'
      );
    case 'two-arm-chaise':
      return cwProduct(
        'l-seat-left-square-arm-chaise-section-cover',
        'Two-Arm Chaise Section Cover',
        659,
        'CS5L-SSA'
      );
    default:
      return null;
  }
}

export interface AssemblyPricingItem {
  pieceIndex: number;
  pieceName: string;
  product: CwProduct;
}

export interface AssemblyPricing {
  items: AssemblyPricingItem[];
  total: number;
  currency: string;
}

function cwUnitProduct(seats: number, facing: 'L' | 'R', armCode: 'SRA' | 'SSA'): CwProduct {
  const size = Math.min(3, Math.max(1, seats));
  const shape = armCode === 'SRA' ? 'round' : 'square';
  const sizeName = size === 1 ? 'chair' : size === 2 ? 'loveseat' : 'sofa';
  const titleSize = size === 1 ? 'Chair' : size === 2 ? 'Loveseat' : 'Sofa';
  const handle = `boxed-seat-${facing === 'L' ? 'left' : 'right'}-${shape}-arm-${sizeName}-section-cover`;
  return {
    handle,
    title: `${facing === 'L' ? 'Left' : 'Right'} ${shape === 'round' ? 'Round' : 'Square'} Arm ${titleSize} Section Cover`,
    price: size === 1 ? 519 : size === 2 ? 709 : 859,
    url: cwUrl(handle),
    ref: `CS${size}B-${armCode}-${facing}`,
  };
}

function cwArmlessProduct(seats: number): CwProduct {
  return seats >= 3
    ? {
        handle: 'armless-sofa-section-slipcover',
        title: 'Armless Sofa Section Slipcover',
        price: 859,
        url: cwUrl('armless-sofa-section-slipcover'),
        ref: 'CS3X-NA',
      }
    : {
        handle: 'boxed-seat-armless-chair-slipcover',
        title: 'Armless Chair Slipcover',
        price: 469,
        url: cwUrl('boxed-seat-armless-chair-slipcover'),
        ref: 'CS1X-NA',
      };
}

const STRAIGHT_RUN_KINDS: ReadonlySet<PieceKind> = new Set(['left-arm', 'seat', 'right-arm']);

/**
 * Map the full assembly to CW products and compute the total. Straight runs
 * are quoted the way CW sells them: a CS3B sofa section covers three seats —
 * not three chair sections — with armless infill (CS3X/CS1X) for longer
 * runs and a matching end unit at an armed far end.
 */
export function getAssemblyPricing(
  pieces: SectionalPiece[],
  country: SectionalPricingCountry = DEFAULT_PRICING_COUNTRY,
  fabric: SectionalPricingFabric = DEFAULT_PRICING_FABRIC,
  catalog: SectionalPricingCatalog = CW_US_FABRIC_PRICES,
  style: SectionalProductStyle = DEFAULT_SECTIONAL_PRODUCT_STYLE
): AssemblyPricing {
  const items: AssemblyPricingItem[] = [];
  let total = 0;
  const push = (product: CwProduct, pieceIndex: number, pieceName: string) => {
    const localized = catalog[product.handle]?.[fabric];
    const pricedProduct = localized
      ? {
          ...product,
          price: localized.price,
          url: localizeCwProductUrl(localized.url || product.url, country),
        }
      : { ...product, url: localizedCwUrl(product.handle, country) };
    items.push({ pieceIndex, pieceName, product: pricedProduct });
    total += pricedProduct.price;
  };
  const armCodeFor = (piece: SectionalPiece): 'SRA' | 'SSA' =>
    (piece.armStyle || style.arm) === 'round' ? 'SRA' : 'SSA';
  const hasWorldLeftArm = (piece: SectionalPiece) =>
    (piece.kind === 'left-arm' && !piece.mirrored) ||
    (piece.kind === 'right-arm' && piece.mirrored);
  const hasWorldRightArm = (piece: SectionalPiece) =>
    (piece.kind === 'right-arm' && !piece.mirrored) ||
    (piece.kind === 'left-arm' && piece.mirrored);
  const pushArmlessChunks = (seatCount: number, startIndex: number) => {
    let remaining = seatCount;
    while (remaining > 0) {
      const take = remaining >= 3 ? 3 : 1;
      push(
        cwArmlessProduct(take),
        startIndex,
        take >= 3 ? '3-seat armless infill' : '1-seat armless infill'
      );
      remaining -= take;
    }
  };

  const handled = new Set<string>();
  // Group straight main-row modules (rotation 0, seat/arm kinds) into runs.
  const straight = pieces
    .map((piece, index) => ({ piece, index }))
    .filter(({ piece }) => piece.rotation % 360 === 0 && STRAIGHT_RUN_KINDS.has(piece.kind))
    .sort((a, b) => a.piece.col - b.piece.col);
  let run: Array<{ piece: SectionalPiece; index: number }> = [];
  const flushRun = () => {
    if (!run.length) return;
    run.forEach(entry => handled.add(entry.piece.id));
    const seats = run.length;
    const first = run[0].piece;
    const last = run[run.length - 1].piece;
    const startIndex = run[0].index;
    const leftArmed = hasWorldLeftArm(first);
    const rightArmed = hasWorldRightArm(last);
    if (leftArmed && rightArmed) {
      const leftSeats = Math.min(3, seats - 1);
      const rightSeats = Math.min(3, seats - leftSeats);
      push(
        cwUnitProduct(leftSeats, 'L', armCodeFor(first)),
        startIndex,
        `${leftSeats}-seat left-arm unit`
      );
      push(
        cwUnitProduct(rightSeats, 'R', armCodeFor(last)),
        run[run.length - 1].index,
        `${rightSeats}-seat right-arm unit`
      );
      pushArmlessChunks(seats - leftSeats - rightSeats, startIndex);
    } else if (leftArmed || rightArmed) {
      const facing = leftArmed ? 'L' : 'R';
      const armedPiece = leftArmed ? first : last;
      const unitSeats = Math.min(3, seats);
      push(
        cwUnitProduct(unitSeats, facing, armCodeFor(armedPiece)),
        leftArmed ? startIndex : run[run.length - 1].index,
        `${unitSeats}-seat ${leftArmed ? 'left' : 'right'}-arm unit`
      );
      pushArmlessChunks(seats - unitSeats, startIndex);
    } else {
      pushArmlessChunks(seats, startIndex);
    }
    run = [];
  };
  straight.forEach(entry => {
    if (
      run.length &&
      entry.piece.col ===
        run[run.length - 1].piece.col + pieceFootprint(run[run.length - 1].piece).colSpan
    ) {
      run.push(entry);
    } else {
      flushRun();
      run = [entry];
    }
  });
  flushRun();

  pieces.forEach((piece, index) => {
    if (handled.has(piece.id)) return;
    if (piece.kind === 'left-arm-chaise' || piece.kind === 'right-arm-chaise') {
      const armCode = armCodeFor(piece);
      if (armCode === 'SRA') {
        const facing = piece.kind === 'left-arm-chaise' ? 'L' : 'R';
        push(
          {
            handle: `boxed-seat-${facing === 'L' ? 'left' : 'right'}-round-arm-chaise-section-cover`,
            title: `${facing === 'L' ? 'Left' : 'Right'} Round Arm Chaise Section Cover`,
            price: 659,
            url: cwUrl(
              `boxed-seat-${facing === 'L' ? 'left' : 'right'}-round-arm-chaise-section-cover`
            ),
            ref: `CS5B-SRA-${facing}`,
          },
          index,
          'Chaise unit (round arm)'
        );
        return;
      }
    }
    const product = getPiecePricing(piece);
    if (product) push(product, index, PIECES[piece.kind].name);
  });
  return { items, total, currency: SECTIONAL_PRICING_MARKETS[country].currency };
}

export function createSectionalPreset(
  name:
    | 'sofa'
    | 'chaise'
    | 'corner'
    | 'two-seat'
    | 'l-chaise'
    | 'ottoman-set'
    | 'armchair'
    | 'two-arm-chaise'
): SectionalPiece[] {
  if (name === 'armchair') {
    return [{ id: createId(), kind: 'armchair', col: 0, row: 0, rotation: 0, mirrored: false }];
  }
  if (name === 'two-arm-chaise') {
    return [
      { id: createId(), kind: 'two-arm-chaise', col: 0, row: 0, rotation: 0, mirrored: false },
    ];
  }
  if (name === 'two-seat') {
    return [
      { id: createId(), kind: 'left-arm', col: 0, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'seat', col: 1, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'right-arm', col: 2, row: 0, rotation: 0, mirrored: false },
    ];
  }
  if (name === 'l-chaise') {
    return [
      { id: createId(), kind: 'left-arm', col: 0, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'seat', col: 1, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'corner', col: 2, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'chaise', col: 2, row: 1, rotation: 90, mirrored: false },
    ];
  }
  if (name === 'ottoman-set') {
    return [
      { id: createId(), kind: 'left-arm', col: 0, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'seat', col: 1, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'seat', col: 2, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'right-arm', col: 3, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'ottoman', col: 1, row: 1, rotation: 0, mirrored: false },
    ];
  }
  if (name === 'chaise') {
    return [
      { id: createId(), kind: 'left-arm', col: 0, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'seat', col: 1, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'right-arm-chaise', col: 2, row: 0, rotation: 0, mirrored: false },
    ];
  }
  if (name === 'corner') {
    return [
      { id: createId(), kind: 'left-arm', col: 0, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'seat', col: 1, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'corner', col: 2, row: 0, rotation: 0, mirrored: false },
      { id: createId(), kind: 'seat', col: 2, row: 1, rotation: 90, mirrored: false },
      { id: createId(), kind: 'right-arm', col: 2, row: 2, rotation: 90, mirrored: false },
    ];
  }
  return [
    { id: createId(), kind: 'left-arm', col: 0, row: 0, rotation: 0, mirrored: false },
    { id: createId(), kind: 'seat', col: 1, row: 0, rotation: 0, mirrored: false },
    { id: createId(), kind: 'seat', col: 2, row: 0, rotation: 0, mirrored: false },
    { id: createId(), kind: 'right-arm', col: 3, row: 0, rotation: 0, mirrored: false },
  ];
}

/** Effective on-board footprint of a piece; 90/270 rotation swaps width and depth. */
export function getPieceDimensions(piece: SectionalPiece): { width: number; depth: number } {
  const spec = PIECES[piece.kind];
  const swapped = ((piece.rotation % 180) + 180) % 180 !== 0;
  const baseWidth = swapped ? spec.depth : spec.width;
  const baseDepth = swapped ? spec.width : spec.depth;
  const overrideWidth = Number(piece.widthCm);
  const overrideDepth = Number(piece.depthCm);
  return {
    width: Number.isFinite(overrideWidth) && overrideWidth > 0 ? overrideWidth : baseWidth,
    depth: Number.isFinite(overrideDepth) && overrideDepth > 0 ? overrideDepth : baseDepth,
  };
}

/** Reference depth (95 cm) maps to one grid cell. */
const CM_PER_CELL = 95;

export interface AssemblyComponentSummary {
  kind: PieceKind;
  name: string;
  short: string;
  count: number;
  width: number;
  depth: number;
}

export interface AssemblySummary {
  name: string;
  totalWidth: number;
  totalDepth: number;
  moduleCount: number;
  components: AssemblyComponentSummary[];
}

/** Group pieces by kind and report counts + canonical dimensions for PDF/tables. */
export function getAssemblySummary(
  pieces: SectionalPiece[],
  name = 'Custom sectional'
): AssemblySummary {
  const bounds = calculateSectionalBounds(pieces);
  const byKind = new Map<PieceKind, AssemblyComponentSummary>();
  pieces.forEach(piece => {
    const spec = PIECES[piece.kind];
    const existing = byKind.get(piece.kind);
    if (existing) {
      existing.count += 1;
    } else {
      byKind.set(piece.kind, {
        kind: piece.kind,
        name: spec.name,
        short: spec.short,
        count: 1,
        width: spec.width,
        depth: spec.depth,
      });
    }
  });
  return {
    name,
    totalWidth: bounds.width,
    totalDepth: bounds.depth,
    moduleCount: pieces.length,
    components: [...byKind.values()].sort((a, b) => {
      const order: PieceKind[] = ['left-arm', 'seat', 'corner', 'chaise', 'right-arm'];
      return order.indexOf(a.kind) - order.indexOf(b.kind);
    }),
  };
}

/**
 * Grid-cell span and pixel body size for a piece, derived from its effective
 * cm dimensions. The chaise (160 cm deep) spans two rows so it renders visibly
 * longer than a standard seat.
 */
export function pieceFootprint(piece: SectionalPiece): {
  colSpan: number;
  rowSpan: number;
  bodyW: number;
  bodyH: number;
} {
  const dims = getPieceDimensions(piece);
  const colSpan = Math.max(1, Math.round(dims.width / CM_PER_CELL));
  const rowSpan = Math.max(1, Math.round(dims.depth / CM_PER_CELL));
  return { colSpan, rowSpan, bodyW: colSpan * CELL, bodyH: rowSpan * CELL };
}

/** Pixel bounds of the full assembly on the board, accounting for multi-cell pieces. */
export function assemblyPixelBounds(
  pieces: SectionalPiece[]
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!pieces.length) return null;
  let minCol = Infinity;
  let minRow = Infinity;
  let maxColEnd = -Infinity;
  let maxRowEnd = -Infinity;
  pieces.forEach(piece => {
    const fp = pieceFootprint(piece);
    minCol = Math.min(minCol, piece.col);
    minRow = Math.min(minRow, piece.row);
    maxColEnd = Math.max(maxColEnd, piece.col + fp.colSpan);
    maxRowEnd = Math.max(maxRowEnd, piece.row + fp.rowSpan);
  });
  return {
    x0: GRID_ORIGIN_X + minCol * CELL,
    y0: GRID_ORIGIN_Y + minRow * CELL,
    x1: GRID_ORIGIN_X + maxColEnd * CELL,
    y1: GRID_ORIGIN_Y + maxRowEnd * CELL,
  };
}

/**
 * Exact assembly footprint in centimetres, derived from component metadata:
 * each occupied column contributes the widest piece it contains, each occupied
 * row the deepest. This matches how butt-joined rectilinear modules add up.
 */
export function calculateSectionalBounds(pieces: SectionalPiece[]) {
  if (!pieces.length) return { cols: 0, rows: 0, width: 0, depth: 0 };
  const minCol = Math.min(...pieces.map(piece => piece.col));
  const minRow = Math.min(...pieces.map(piece => piece.row));
  // Effective span accounts for multi-cell pieces like the chaise.
  const maxColEnd = Math.max(...pieces.map(piece => piece.col + pieceFootprint(piece).colSpan));
  const maxRowEnd = Math.max(...pieces.map(piece => piece.row + pieceFootprint(piece).rowSpan));
  const colWidths = new Map<number, number>();
  const rowDepths = new Map<number, number>();
  pieces.forEach(piece => {
    const dims = getPieceDimensions(piece);
    colWidths.set(piece.col, Math.max(colWidths.get(piece.col) || 0, dims.width));
    rowDepths.set(piece.row, Math.max(rowDepths.get(piece.row) || 0, dims.depth));
  });
  const width = [...colWidths.values()].reduce((sum, value) => sum + value, 0);
  const depth = [...rowDepths.values()].reduce((sum, value) => sum + value, 0);
  return { cols: maxColEnd - minCol, rows: maxRowEnd - minRow, width, depth };
}

/**
 * World-space sides on which a piece exposes sockets. Rotation turns sides
 * clockwise; mirroring then swaps world left/right (semantic left/right
 * connectors trade places, matching how the SVG transform composes).
 */
export function getConnectorWorldSides(piece: SectionalPiece): ConnectorSide[] {
  const turns = Math.round((((piece.rotation % 360) + 360) % 360) / 90) % 4;
  return PIECE_CONNECTORS[piece.kind].map(side => {
    let world = SIDE_ORDER[(SIDE_ORDER.indexOf(side) + turns) % 4];
    if (piece.mirrored) {
      world = world === 'left' ? 'right' : world === 'right' ? 'left' : world;
    }
    return world;
  });
}

/** Evaluate every socket against its facing neighbour across shared grid edges. */
export function evaluateSectionalConnections(pieces: SectionalPiece[]): SectionalConnectionReport {
  const byCell = new Map(pieces.map(piece => [`${piece.col},${piece.row}`, piece]));
  const connected = new Set<string>();
  const conflicts = new Set<string>();
  pieces.forEach(piece => {
    getConnectorWorldSides(piece).forEach(side => {
      const [dx, dy] = SIDE_OFFSETS[side];
      const neighbour = byCell.get(`${piece.col + dx},${piece.row + dy}`);
      if (!neighbour) return;
      const facing = OPPOSITE_SIDE[side];
      if (getConnectorWorldSides(neighbour).includes(facing)) {
        connected.add(`${piece.id}:${side}`);
        connected.add(`${neighbour.id}:${facing}`);
      } else {
        conflicts.add(`${piece.id}:${side}`);
      }
    });
  });
  return { connected, conflicts };
}

/**
 * Snap compatibility of one piece at a candidate cell: 'valid' when at least
 * one socket pairs up and no edge mismatches, 'invalid' on the first mismatch,
 * 'neutral' when nothing touches.
 */
function previewCompatibility(
  pieces: SectionalPiece[],
  pieceId: string,
  col: number,
  row: number
): 'valid' | 'invalid' | 'neutral' {
  const piece = pieces.find(candidate => candidate.id === pieceId);
  if (!piece) return 'neutral';
  const movedSides = getConnectorWorldSides({ ...piece, col, row });
  const others = new Map(
    pieces
      .filter(candidate => candidate.id !== pieceId)
      .map(candidate => [`${candidate.col},${candidate.row}`, candidate])
  );
  let valid = false;
  for (const side of Object.keys(SIDE_OFFSETS) as ConnectorSide[]) {
    const [dx, dy] = SIDE_OFFSETS[side];
    const neighbour = others.get(`${col + dx},${row + dy}`);
    if (!neighbour) continue;
    const mine = movedSides.includes(side);
    const theirs = getConnectorWorldSides(neighbour).includes(OPPOSITE_SIDE[side]);
    if (mine && theirs) valid = true;
    else if (mine !== theirs) return 'invalid';
  }
  return valid ? 'valid' : 'neutral';
}

/**
 * CAD-style dimension annotations for the assembly: per-column width segments
 * with an overall width line above, per-row depth segments with an overall
 * depth line to the left. Shared by the live stage and the exported plan.
 */
export function sectionalDimensionsMarkup(pieces: SectionalPiece[]): string {
  if (!pieces.length) return '';
  const bounds = assemblyPixelBounds(pieces)!;
  const minCol = Math.min(...pieces.map(piece => piece.col));
  const maxColEnd = Math.max(...pieces.map(piece => piece.col + pieceFootprint(piece).colSpan));
  const minRow = Math.min(...pieces.map(piece => piece.row));
  const maxRowEnd = Math.max(...pieces.map(piece => piece.row + pieceFootprint(piece).rowSpan));
  const colWidths = new Map<number, number>();
  const rowDepths = new Map<number, number>();
  pieces.forEach(piece => {
    const dims = getPieceDimensions(piece);
    colWidths.set(piece.col, Math.max(colWidths.get(piece.col) || 0, dims.width));
    rowDepths.set(piece.row, Math.max(rowDepths.get(piece.row) || 0, dims.depth));
  });
  const totalWidth = [...colWidths.values()].reduce((sum, value) => sum + value, 0);
  const totalDepth = [...rowDepths.values()].reduce((sum, value) => sum + value, 0);

  const x0 = bounds.x0;
  const y0 = bounds.y0;
  const x1 = bounds.x1;
  const y1 = bounds.y1;
  const widthSegmentY = y0 - 28;
  const widthOverallY = y0 - 54;
  const depthSegmentX = x0 - 28;
  const depthOverallX = x0 - 54;

  const parts: string[] = ['<g class="sb-dimensions" aria-hidden="true">'];

  // Extension lines from the assembly outline out to each dimension line.
  for (let col = minCol; col <= maxColEnd; col += 1) {
    const x = GRID_ORIGIN_X + col * CELL;
    parts.push(`<path class="sb-dimline" d="M${x} ${y0 - 6}V${widthSegmentY - 3}"/>`);
  }
  parts.push(`<path class="sb-dimline" d="M${x0} ${y0 - 6}V${widthOverallY - 3}"/>`);
  parts.push(`<path class="sb-dimline" d="M${x1} ${y0 - 6}V${widthOverallY - 3}"/>`);
  for (let row = minRow; row <= maxRowEnd; row += 1) {
    const y = GRID_ORIGIN_Y + row * CELL;
    parts.push(`<path class="sb-dimline" d="M${x0 - 6} ${y}H${depthSegmentX - 3}"/>`);
  }
  parts.push(`<path class="sb-dimline" d="M${x0 - 6} ${y0}H${depthOverallX - 3}"/>`);
  parts.push(`<path class="sb-dimline" d="M${x0 - 6} ${y1}H${depthOverallX - 3}"/>`);

  // Per-column width segments (occupied columns only, inset to avoid tick collisions).
  colWidths.forEach((width, col) => {
    const sx0 = GRID_ORIGIN_X + col * CELL + 5;
    const sx1 = GRID_ORIGIN_X + (col + 1) * CELL - 5;
    parts.push(`<path class="sb-dimline" d="M${sx0} ${widthSegmentY}H${sx1}"/>`);
    parts.push(
      `<path class="sb-dimline" d="M${sx0} ${widthSegmentY - 3}V${widthSegmentY + 3}M${sx1} ${widthSegmentY - 3}V${widthSegmentY + 3}"/>`
    );
    parts.push(
      `<text class="sb-dimtext" x="${(sx0 + sx1) / 2}" y="${widthSegmentY - 6}">${width}</text>`
    );
  });
  // Overall width.
  parts.push(`<path class="sb-dimline" d="M${x0} ${widthOverallY}H${x1}"/>`);
  parts.push(
    `<path class="sb-dimline" d="M${x0} ${widthOverallY - 4}V${widthOverallY + 4}M${x1} ${widthOverallY - 4}V${widthOverallY + 4}"/>`
  );
  parts.push(
    `<text class="sb-dimtext sb-dimtext-overall" x="${(x0 + x1) / 2}" y="${widthOverallY - 7}">${totalWidth} cm</text>`
  );

  // Per-row depth segments.
  rowDepths.forEach((depth, row) => {
    const fp = pieceFootprint(pieces.find(p => p.row === row) || pieces[0]);
    const sy0 = GRID_ORIGIN_Y + row * CELL + 5;
    const sy1 = GRID_ORIGIN_Y + row * CELL + fp.bodyH - 5;
    parts.push(`<path class="sb-dimline" d="M${depthSegmentX} ${sy0}V${sy1}"/>`);
    parts.push(
      `<path class="sb-dimline" d="M${depthSegmentX - 3} ${sy0}H${depthSegmentX + 3}M${depthSegmentX - 3} ${sy1}H${depthSegmentX + 3}"/>`
    );
    parts.push(
      `<text class="sb-dimtext" transform="rotate(-90 ${depthSegmentX - 6} ${(sy0 + sy1) / 2})" x="${depthSegmentX - 6}" y="${(sy0 + sy1) / 2}">${depth}</text>`
    );
  });
  // Overall depth.
  parts.push(`<path class="sb-dimline" d="M${depthOverallX} ${y0}V${y1}"/>`);
  parts.push(
    `<path class="sb-dimline" d="M${depthOverallX - 4} ${y0}H${depthOverallX + 4}M${depthOverallX - 4} ${y1}H${depthOverallX + 4}"/>`
  );
  parts.push(
    `<text class="sb-dimtext sb-dimtext-overall" transform="rotate(-90 ${depthOverallX - 7} ${(y0 + y1) / 2})" x="${depthOverallX - 7}" y="${(y0 + y1) / 2}">${totalDepth} cm</text>`
  );

  parts.push('</g>');
  return parts.join('');
}

function pipFor(side: ConnectorSide, w: number, h: number): string {
  const cx = Math.round(w / 2 - 7);
  const cy = Math.round(h / 2 - 7);
  switch (side) {
    case 'top':
      return `<rect x="${cx}" y="3" width="14" height="8" rx="2.5"`;
    case 'right':
      return `<rect x="${w - 11}" y="${cy}" width="8" height="14" rx="2.5"`;
    case 'bottom':
      return `<rect x="${cx}" y="${h - 11}" width="14" height="8" rx="2.5"`;
    case 'left':
      return `<rect x="3" y="${cy}" width="8" height="14" rx="2.5"`;
  }
}

/** Pre-rotation body size — the shape coordinates before any SVG rotate transform. */
function unrotatedFootprint(piece: SectionalPiece): {
  colSpan: number;
  rowSpan: number;
  bodyW: number;
  bodyH: number;
} {
  const spec = PIECES[piece.kind];
  const colSpan = Math.max(1, Math.round(spec.width / CM_PER_CELL));
  const rowSpan = Math.max(1, Math.round(spec.depth / CM_PER_CELL));
  return { colSpan, rowSpan, bodyW: colSpan * CELL, bodyH: rowSpan * CELL };
}

function pieceMarkup(
  piece: SectionalPiece,
  selected: boolean,
  exportMode = false,
  report: SectionalConnectionReport | null = null,
  theme: SectionalTheme = SECTIONAL_THEMES[DEFAULT_THEME]
): string {
  const fp = pieceFootprint(piece);
  const visW = fp.bodyW;
  const visH = fp.bodyH;
  const unrot = unrotatedFootprint(piece);
  const w = unrot.bodyW;
  const h = unrot.bodyH;
  const x = GRID_ORIGIN_X + piece.col * CELL;
  const y = GRID_ORIGIN_Y + piece.row * CELL;

  const swapped = ((piece.rotation % 180) + 180) % 180 !== 0 && w !== h;
  const alignX = swapped ? (h - w) / 2 : 0;
  const alignY = swapped ? -(h - w) / 2 : 0;

  let inner = '';
  if (piece.rotation)
    inner += `translate(${alignX} ${alignY}) rotate(${piece.rotation} ${w / 2} ${h / 2})`;
  if (piece.mirrored) inner += (inner ? ' ' : '') + `translate(${w} 0) scale(-1 1)`;

  const selection =
    selected && !exportMode
      ? `<rect class="sb-selection" x="-7" y="-7" width="${visW + 14}" height="${visH + 14}" rx="7" />`
      : '';
  const common = `fill="${theme.body}" stroke="${theme.outline}" stroke-width="3"`;
  const cushion = `fill="${theme.cushion}" stroke="${theme.cushionStroke}" stroke-width="2"`;
  let body = '';

  const armEnd = Math.round(7 + ((h - 22) * 2) / 3);
  const hasLeftArm =
    piece.kind === 'left-arm' ||
    piece.kind === 'left-arm-chaise' ||
    piece.kind === 'armchair' ||
    piece.kind === 'two-arm-chaise';
  const hasRightArm =
    piece.kind === 'right-arm' ||
    piece.kind === 'right-arm-chaise' ||
    piece.kind === 'armchair' ||
    piece.kind === 'two-arm-chaise';
  const planArmWidth = 15;
  const planSeatLeft = hasLeftArm ? planArmWidth : 0;
  const planSeatRight = hasRightArm ? w - planArmWidth : w;
  const planCushionX = planSeatLeft + 17;
  const planCushionWidth = Math.max(20, planSeatRight - planSeatLeft - 34);
  const planBackStart = planSeatLeft + 16;
  const planBackEnd = planSeatRight - 16;

  if (piece.kind === 'corner') {
    body = `<rect x="6" y="7" width="${w - 12}" height="${h - 14}" rx="4" ${common}/><rect x="17" y="29" width="${w - 49}" height="${h - 57}" rx="3" ${cushion}/><path d="M16 17H${w - 16}" stroke="${theme.accent}" stroke-width="10"/><path d="M${w - 17} 25V${h - 16}" stroke="${theme.accent}" stroke-width="10"/>`;
  } else if (piece.kind === 'chaise') {
    body = `<rect x="6" y="7" width="${w - 12}" height="${h - 14}" rx="4" ${common}/><rect x="16" y="30" width="${w - 32}" height="${h - 49}" rx="3" ${cushion}/><path d="M16 21H${w - 16}" stroke="${theme.accent}" stroke-width="8"/>`;
  } else if (piece.kind === 'left-arm-chaise') {
    body = `<rect x="6" y="7" width="${w - 12}" height="${h - 14}" rx="4" ${common}/><rect x="${planCushionX}" y="30" width="${planCushionWidth}" height="${h - 49}" rx="3" ${cushion}/><path d="M${planBackStart} 21H${planBackEnd}" stroke="${theme.accent}" stroke-width="8"/><path d="M8 17V${armEnd}" stroke="${theme.accent}" stroke-width="14"/>`;
  } else if (piece.kind === 'right-arm-chaise') {
    body = `<rect x="6" y="7" width="${w - 12}" height="${h - 14}" rx="4" ${common}/><rect x="${planCushionX}" y="30" width="${planCushionWidth}" height="${h - 49}" rx="3" ${cushion}/><path d="M${planBackStart} 21H${planBackEnd}" stroke="${theme.accent}" stroke-width="8"/><path d="M${w - 8} 17V${armEnd}" stroke="${theme.accent}" stroke-width="14"/>`;
  } else if (piece.kind === 'two-arm-chaise') {
    body = `<rect x="6" y="7" width="${w - 12}" height="${h - 14}" rx="4" ${common}/><rect x="${planCushionX}" y="30" width="${planCushionWidth}" height="${h - 49}" rx="3" ${cushion}/><path d="M${planBackStart} 21H${planBackEnd}" stroke="${theme.accent}" stroke-width="8"/><path d="M8 17V${armEnd}" stroke="${theme.accent}" stroke-width="14"/><path d="M${w - 8} 17V${armEnd}" stroke="${theme.accent}" stroke-width="14"/>`;
  } else if (piece.kind === 'ottoman') {
    body = `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="8" ${common}/><rect x="20" y="20" width="${w - 40}" height="${h - 40}" rx="6" ${cushion}/>`;
  } else {
    const arm = `${hasLeftArm ? `<path d="M8 17V${armEnd}" stroke="${theme.accent}" stroke-width="14"/>` : ''}${hasRightArm ? `<path d="M${w - 8} 17V${armEnd}" stroke="${theme.accent}" stroke-width="14"/>` : ''}`;
    body = `<rect x="6" y="7" width="${w - 12}" height="${h - 14}" rx="4" ${common}/><rect x="${planCushionX}" y="29" width="${planCushionWidth}" height="${h - 57}" rx="3" ${cushion}/><path d="M${planBackStart} 17H${planBackEnd}" stroke="${theme.accent}" stroke-width="10"/>${arm}`;
  }

  // Cushion seam: subtle dashed line across the seat cushion showing the front edge.
  if (piece.kind !== 'ottoman') {
    const seamY = Math.round(29 + (h - 57) * 0.65);
    body += `<path d="M${planCushionX + 5} ${seamY}H${planCushionX + planCushionWidth - 5}" stroke="${theme.cushionStroke}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.45" fill="none"/>`;
  }

  const localSides = PIECE_CONNECTORS[piece.kind];
  const worldSides = getConnectorWorldSides(piece);
  const pips = localSides
    .map((localSide, index) => {
      const key = `${piece.id}:${worldSides[index]}`;
      const state = report?.connected.has(key)
        ? ' is-connected'
        : report?.conflicts.has(key)
          ? ' is-conflict'
          : '';
      return `${pipFor(localSide, w, h)} class="sb-connector${state}"/>`;
    })
    .join('');

  return `<g class="sb-piece${selected ? ' is-selected' : ''}" data-piece-id="${piece.id}" transform="translate(${x} ${y})">${selection}<g transform="${inner}">${body}${pips}</g><text x="${Math.round(visW / 2)}" y="${Math.round(visH / 2 + 5)}" text-anchor="middle" class="sb-piece-label">${PIECES[piece.kind].short}</text></g>`;
}

export interface SectionalPlanViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The exact viewBox used by the exported plan SVG. Strokes seeded onto the
 * imported PNG rely on this to map plan coordinates into image pixels.
 */
export function getSectionalPlanViewBox(pieces: SectionalPiece[]): SectionalPlanViewBox {
  const bounds = assemblyPixelBounds(pieces);
  if (!bounds) return { x: 0, y: 0, width: 340, height: 318 };
  // Extra room on the top/left for the dimension lines and their labels.
  const x = bounds.x0 - 96;
  const y = bounds.y0 - 96;
  const width = Math.max(340, bounds.x1 - bounds.x0 + 140);
  const height = Math.max(318, bounds.y1 - bounds.y0 + 148);
  return { x, y, width, height };
}

export interface SectionalMeasurementSeed {
  role: 'overall-width' | 'overall-depth' | 'column-width' | 'row-depth';
  label: string;
  suggestedTag: string;
  pieceId?: string;
  valueCm: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Measurement strokes to seed onto the imported plan image: the overall width
 * and depth plus one width segment per occupied column. Coordinates are in
 * plan SVG space and land exactly on the dimension lines baked into the PNG.
 */
export function getSectionalMeasurementSeeds(pieces: SectionalPiece[]): SectionalMeasurementSeed[] {
  if (!pieces.length) return [];
  const pixelBounds = assemblyPixelBounds(pieces)!;
  const colWidths = new Map<number, number>();
  pieces.forEach(piece => {
    const dims = getPieceDimensions(piece);
    colWidths.set(piece.col, Math.max(colWidths.get(piece.col) || 0, dims.width));
  });
  const bounds = calculateSectionalBounds(pieces);
  const x0 = pixelBounds.x0;
  const y0 = pixelBounds.y0;
  const x1 = pixelBounds.x1;
  const y1 = pixelBounds.y1;

  const seeds: SectionalMeasurementSeed[] = [
    {
      role: 'overall-width',
      label: 'Overall width',
      suggestedTag: 'A1',
      valueCm: bounds.width,
      x1: x0,
      y1: y0 - 54,
      x2: x1,
      y2: y0 - 54,
    },
    {
      role: 'overall-depth',
      label: 'Overall depth',
      suggestedTag: 'A2',
      valueCm: bounds.depth,
      x1: x0 - 54,
      y1: y0,
      x2: x0 - 54,
      y2: y1,
    },
  ];
  // Per-column segments only add information when more than one column exists;
  // a single-column (or single-module) plan already has its overall width.
  if (colWidths.size > 1) {
    [...colWidths.entries()]
      .sort(([a], [b]) => a - b)
      .forEach(([col, width], index) => {
        const representative = pieces
          .filter(piece => piece.col === col)
          .sort((a, b) => getPieceDimensions(b).width - getPieceDimensions(a).width)[0];
        seeds.push({
          role: 'column-width',
          label: `Module ${index + 1} width`,
          suggestedTag: `A${index + 3}`,
          pieceId: representative?.id,
          valueCm: width,
          x1: GRID_ORIGIN_X + col * CELL + 5,
          y1: y0 - 28,
          x2: GRID_ORIGIN_X + (col + 1) * CELL - 5,
          y2: y0 - 28,
        });
      });
  }
  // Per-row depth segments (the PDF side view's D codes): one per occupied
  // row beyond the first, matching how chaise/return legs add depth.
  const rowDepths = new Map<number, number>();
  pieces.forEach(piece => {
    const dims = getPieceDimensions(piece);
    rowDepths.set(piece.row, Math.max(rowDepths.get(piece.row) || 0, dims.depth));
  });
  if (rowDepths.size > 1) {
    [...rowDepths.entries()]
      .sort(([a], [b]) => a - b)
      .forEach(([row, depth], index) => {
        if (index === 0) return; // row 0 depth is the overall depth already
        const rowY0 = GRID_ORIGIN_Y + row * CELL;
        seeds.push({
          role: 'row-depth',
          label: `Row ${index + 1} depth`,
          suggestedTag: `D${index}`,
          valueCm: depth,
          x1: x1 + 28,
          y1: rowY0,
          x2: x1 + 28,
          y2: rowY0 + CELL,
        });
      });
  }
  return seeds;
}

/**
 * Apply an edited measurement code to the assembly by rescaling the affected
 * piece dimension overrides. Codes:
 *   A1          → overall width: every piece rescales proportionally
 *   A3, A4, …   → one occupied column: pieces in that column rescale
 *   A2          → overall depth: every piece rescales proportionally
 *   D1, D2, …   → one row: pieces in that row rescale
 * Mutates the passed pieces in place (builder state) and returns the count of
 * pieces whose dimensions changed.
 */
export function applySectionalMeasurementEdit(
  pieces: SectionalPiece[],
  code: string,
  valueCm: number
): number {
  const normalized = String(code || '')
    .trim()
    .toUpperCase();
  const value = Number(valueCm);
  if (!normalized || !Number.isFinite(value) || value <= 0) return 0;

  const scalePieces = (
    targets: SectionalPiece[],
    dimension: 'width' | 'depth',
    targetCm: number,
    groupKey: (piece: SectionalPiece) => string
  ): number => {
    if (!targets.length) return 0;
    // The target is a slot-spanning sum (per column for widths, per row for
    // depths): compute the current total from each slot's widest/deepest
    // piece so stacked pieces are never double-counted.
    const groups = new Map<string, SectionalPiece[]>();
    targets.forEach(piece => {
      const key = groupKey(piece);
      const group = groups.get(key) || [];
      group.push(piece);
      groups.set(key, group);
    });
    const current = Array.from(groups.values()).reduce(
      (total, group) =>
        total + Math.max(...group.map(piece => getPieceDimensions(piece)[dimension])),
      0
    );
    if (current <= 0) return 0;
    const factor = targetCm / current;
    let changed = 0;
    groups.forEach(group =>
      group.forEach(piece => {
        const dims = getPieceDimensions(piece);
        const next = Math.max(20, Math.round(dims[dimension] * factor * 10) / 10);
        if (Math.abs(next - dims[dimension]) > 0.05) changed += 1;
        if (dimension === 'width') piece.widthCm = next;
        else piece.depthCm = next;
      })
    );
    return changed;
  };

  const occupiedCols = Array.from(new Set(pieces.map(piece => piece.col))).sort((a, b) => a - b);
  const occupiedRows = Array.from(new Set(pieces.map(piece => piece.row))).sort((a, b) => a - b);

  if (normalized === 'A1') return scalePieces(pieces, 'width', value, piece => String(piece.col));
  if (normalized === 'A2') return scalePieces(pieces, 'depth', value, piece => String(piece.row));

  const moduleMatch = normalized.match(/^A(\d+)$/);
  if (moduleMatch) {
    const moduleIndex = Number(moduleMatch[1]) - 3; // A3 → column 0
    const col = occupiedCols[moduleIndex];
    if (col === undefined) return 0;
    return scalePieces(
      pieces.filter(piece => piece.col === col),
      'width',
      value,
      piece => String(piece.row)
    );
  }

  const depthMatch = normalized.match(/^D(\d+)$/);
  if (depthMatch) {
    const rowIndex = Number(depthMatch[1]);
    const row = occupiedRows[rowIndex];
    if (row === undefined) return 0;
    return scalePieces(
      pieces.filter(piece => piece.row === row),
      'depth',
      value,
      piece => String(piece.col)
    );
  }

  return 0;
}

/**
 * Current code → cm values for the assembly (overall, per-module, per-row),
 * used to label the drawn dimension annotations.
 */
export function getSectionalProductMeasurementLabels(pieces: SectionalPiece[]): Array<{
  code: string;
  valueCm: number;
  editable: boolean;
}> {
  const labels: Array<{ code: string; valueCm: number; editable: boolean }> = [];
  const occupiedCols = Array.from(new Set(pieces.map(piece => piece.col))).sort((a, b) => a - b);
  const occupiedRows = Array.from(new Set(pieces.map(piece => piece.row))).sort((a, b) => a - b);
  const overall = calculateSectionalBounds(pieces);
  labels.push({ code: 'A1', valueCm: overall.width, editable: true });
  if (occupiedCols.length > 1) {
    occupiedCols.forEach((col, index) => {
      const width = Math.max(
        ...pieces.filter(piece => piece.col === col).map(piece => getPieceDimensions(piece).width)
      );
      labels.push({ code: `A${index + 3}`, valueCm: width, editable: true });
    });
  }
  labels.push({ code: 'A2', valueCm: overall.depth, editable: true });
  if (occupiedRows.length > 1) {
    occupiedRows.forEach((row, index) => {
      const depth = Math.max(
        ...pieces.filter(piece => piece.row === row).map(piece => getPieceDimensions(piece).depth)
      );
      labels.push({ code: `D${index}`, valueCm: depth, editable: index > 0 });
    });
  }
  return labels;
}

/**
 * Map a plan-SVG point into canvas world coordinates via the placed image rect. */
export function planPointToWorld(
  planX: number,
  planY: number,
  viewBox: SectionalPlanViewBox,
  worldRect: { left: number; top: number; width: number; height: number }
): { x: number; y: number } {
  return {
    x: worldRect.left + ((planX - viewBox.x) / viewBox.width) * worldRect.width,
    y: worldRect.top + ((planY - viewBox.y) / viewBox.height) * worldRect.height,
  };
}

interface ProductPoint3D {
  x: number;
  y: number;
  z: number;
}

interface ProductProjection {
  point: (point: ProductPoint3D) => SectionalPoint;
  depth: (point: ProductPoint3D) => number;
  cameraVector: SectionalPoint;
  viewMode: Exclude<SectionalViewMode, 'plan'>;
}

interface ProductPiecePlacement {
  originX: number;
  originY: number;
  bodyW: number;
  bodyH: number;
  effectiveW: number;
  effectiveH: number;
  /**
   * Curved-back arc lift (svg px) at this piece's left edge, right edge and
   * centre, measured from one shared circular arc across the whole assembly
   * row. Undefined for straight backs and perpendicular return legs.
   */
  backLift?: { left: number; right: number; mid: number };
}

type ProductLayout = Map<string, ProductPiecePlacement>;

const PRODUCT_PX_PER_CM = CELL / 100;

/**
 * Product views use the modules' real dimensions. The plan editor deliberately
 * remains a forgiving snap grid, but carrying that grid into the 45-degree
 * renderer made 90, 100, 105 and 160 cm modules behave like equal tiles.
 */
function createProductLayout(pieces: SectionalPiece[]): ProductLayout {
  const columnWidths = new Map<number, number>();
  const rowDepths = new Map<number, number>();
  pieces.forEach(piece => {
    const dims = getPieceDimensions(piece);
    columnWidths.set(
      piece.col,
      Math.max(columnWidths.get(piece.col) || 0, dims.width * PRODUCT_PX_PER_CM)
    );
    rowDepths.set(
      piece.row,
      Math.max(rowDepths.get(piece.row) || 0, dims.depth * PRODUCT_PX_PER_CM)
    );
  });
  const offsetBefore = (values: Map<number, number>, index: number) =>
    [...values.entries()]
      .filter(([key]) => key < index)
      .reduce((total, [, value]) => total + value, 0);

  return new Map(
    pieces.map(piece => {
      const spec = PIECES[piece.kind];
      const bodyW = spec.width * PRODUCT_PX_PER_CM;
      const bodyH = spec.depth * PRODUCT_PX_PER_CM;
      const rotated = ((piece.rotation % 180) + 180) % 180 !== 0;
      const effectiveW = rotated ? bodyH : bodyW;
      const effectiveH = rotated ? bodyW : bodyH;
      const colOffset = GRID_ORIGIN_X + offsetBefore(columnWidths, piece.col);
      const colMaxW = columnWidths.get(piece.col) || effectiveW;
      // Return-leg pieces (rows > 0) right-align to the column's outer edge so
      // an L-shape reads as one connected assembly instead of an exploded stack.
      const originX = piece.row > 0 ? colOffset + Math.max(0, colMaxW - effectiveW) : colOffset;
      return [
        piece.id,
        {
          originX,
          originY: GRID_ORIGIN_Y + offsetBefore(rowDepths, piece.row),
          bodyW,
          bodyH,
          effectiveW,
          effectiveH,
        },
      ];
    })
  );
}

/**
 * A curved back is ONE continuous arc across the whole assembly, not a
 * scallop per module: individual seat sections do not curve on their own,
 * a curved sofa curves as a single piece (CW ref CS3B-RA-RB). Each main-row
 * piece receives the arc's lift at its left/right edges and centre so
 * adjacent modules share identical edge heights and their chords join.
 * Perpendicular return legs keep their module-local curve.
 */
function applyUniformBackCurve(pieces: SectionalPiece[], layout: ProductLayout): void {
  const mainRow = pieces.filter(piece => {
    if (((piece.rotation % 180) + 180) % 180 !== 0) return false;
    const placement = layout.get(piece.id);
    return !!placement;
  });
  if (!mainRow.length) return;
  const xs = mainRow.flatMap(piece => {
    const placement = layout.get(piece.id)!;
    return [placement.originX, placement.originX + placement.effectiveW];
  });
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const half = Math.max(1, (x1 - x0) / 2);
  const maxLift = 13;
  const radius = (half * half + maxLift * maxLift) / (2 * maxLift);
  const centerX = (x0 + x1) / 2;
  const liftAt = (x: number): number => {
    const dx = Math.max(-half, Math.min(half, x - centerX));
    return radius - Math.sqrt(Math.max(0, radius * radius - dx * dx));
  };
  mainRow.forEach(piece => {
    const placement = layout.get(piece.id)!;
    placement.backLift = {
      left: liftAt(placement.originX),
      right: liftAt(placement.originX + placement.effectiveW),
      mid: liftAt(placement.originX + placement.effectiveW / 2),
    };
  });
}

/** T/L back-cushion wrap is the natural default on half-arm and two-arm modules. */
function armLengthWrapDefault(piece: SectionalPiece): boolean {
  return (
    piece.kind === 'armchair' ||
    piece.kind === 'two-arm-chaise' ||
    (piece.armLength ?? '') === 'half'
  );
}

function resolveProductStyle(
  piece: SectionalPiece,
  fallback: SectionalProductStyle = DEFAULT_SECTIONAL_PRODUCT_STYLE
): SectionalProductStyle {
  return {
    arm: piece.armStyle || fallback.arm,
    // Two-arm modules (armchair, two-arm chaise) default to the CS1L-style
    // half-length arm: their arms stop set back from the seat front.
    armLength:
      piece.armLength ||
      (piece.kind === 'armchair' || piece.kind === 'two-arm-chaise' ? 'half' : fallback.armLength),
    // Wrap (T/L) back cushions auto-enable on half-arm and two-arm modules:
    // the cushion widens above the arm tops, forming a T on two-arm pieces
    // and an L on single-arm ends.
    backCushionFit:
      piece.backCushionFit || (armLengthWrapDefault(piece) ? 'wrap' : fallback.backCushionFit),
    back: piece.backStyle || fallback.back,
    cushion: piece.cushionStyle || fallback.cushion,
    base: piece.baseStyle || fallback.base,
  };
}

function shadeHex(hex: string, amount: number): string {
  const normalized = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return hex;
  const value = Number.parseInt(normalized, 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount));
  return `#${[channel(16), channel(8), channel(0)]
    .map(channelValue => channelValue.toString(16).padStart(2, '0'))
    .join('')}`;
}

function productProjection(
  pieces: SectionalPiece[],
  viewMode: Exclude<SectionalViewMode, 'plan'>,
  layout: ProductLayout
): ProductProjection {
  const placements = [...layout.values()];
  const bounds = placements.length
    ? {
        x0: Math.min(...placements.map(placement => placement.originX)),
        y0: Math.min(...placements.map(placement => placement.originY)),
        x1: Math.max(...placements.map(placement => placement.originX + placement.effectiveW)),
        y1: Math.max(...placements.map(placement => placement.originY + placement.effectiveH)),
      }
    : {
        x0: GRID_ORIGIN_X,
        y0: GRID_ORIGIN_Y,
        x1: GRID_ORIGIN_X + CELL * 3,
        y1: GRID_ORIGIN_Y + CELL,
      };
  // True perspective replaces the old fixed-shear cabinet projection: a
  // pinhole camera on the same sight line L = (-0.72, 1, 0.72) that already
  // drives the face culling and the painter depth. Parallel lines now
  // converge and near modules read larger than far ones — the cue that makes
  // the render read as an object instead of a tilted diagram. Only the
  // canonical front-right camera exists; front-left mirrors the finished
  // render in sectionalProductMarkup, so one camera serves every view.
  const sightLen = Math.hypot(-0.72, 1, 0.72);
  const sceneCx = (bounds.x0 + bounds.x1) / 2;
  const sceneCy = (bounds.y0 + bounds.y1) / 2;
  const sceneCz = 62;
  const radius = Math.hypot(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) / 2;
  // Product-shot framing: a moderate horizontal FOV keeps the perspective
  // present without wide-angle distortion. The camera distance scales with
  // the assembly so every preset is photographed with the same lens.
  const hfov = (40 * Math.PI) / 180;
  const dist = radius * 2.75 + 140;
  const focal = dist / Math.tan(hfov / 2);
  // Flattened elevation: product photography sits ~15-20° above the seat
  // plane, not 36° — a high camera turns cushion tops into runways and
  // pushes the backrest into card-land. The camera stays on the same
  // horizontal bearing (the L = (-0.72, 1, ·) sight line) but its vertical
  // offset is scaled down, and the forward vector re-aims at scene centre.
  const elevFactor = 0.42;
  const camDir = { x: -0.72, y: 1, z: 0.72 * elevFactor };
  const camDirLen = Math.hypot(camDir.x, camDir.y, camDir.z);
  const camera = {
    x: sceneCx + (camDir.x / camDirLen) * dist,
    y: sceneCy + (camDir.y / camDirLen) * dist,
    z: sceneCz + (camDir.z / camDirLen) * dist,
  };
  // Orthonormal camera basis in a z-up world: forward points at the scene
  // centre, right matches the old screen-x direction so the composition
  // keeps its orientation, and up completes the frame.
  const fwd = { x: -camDir.x / camDirLen, y: -camDir.y / camDirLen, z: -camDir.z / camDirLen };
  const rightLen = Math.hypot(fwd.y, fwd.x) || 1;
  const right = { x: -fwd.y / rightLen, y: fwd.x / rightLen, z: 0 };
  const up = {
    x: fwd.y * right.z - fwd.z * right.y,
    y: fwd.z * right.x - fwd.x * right.z,
    z: fwd.x * right.y - fwd.y * right.x,
  };
  const raw = (point: ProductPoint3D): SectionalPoint => {
    const vx = point.x - camera.x;
    const vy = point.y - camera.y;
    const vz = point.z - camera.z;
    const camZ = vx * fwd.x + vy * fwd.y + vz * fwd.z;
    const camX = vx * right.x + vy * right.y;
    const camY = vx * up.x + vy * up.y + vz * up.z;
    return {
      x: (focal * camX) / camZ,
      y: (-focal * camY) / camZ,
    };
  };
  const samples: ProductPoint3D[] = [];
  pieces.forEach(piece => {
    const placement = layout.get(piece.id);
    if (!placement) return;
    const x = placement.originX;
    const y = placement.originY;
    [0, 132].forEach(z => {
      samples.push(
        { x, y, z },
        { x: x + placement.effectiveW, y, z },
        {
          x: x + placement.effectiveW,
          y: y + placement.effectiveH,
          z,
        },
        { x, y: y + placement.effectiveH, z }
      );
    });
  });
  const projected = samples.map(raw);
  const minX = Math.min(...projected.map(point => point.x));
  const maxX = Math.max(...projected.map(point => point.x));
  const minY = Math.min(...projected.map(point => point.y));
  const maxY = Math.max(...projected.map(point => point.y));
  const scale = Math.min(800 / Math.max(1, maxX - minX), 480 / Math.max(1, maxY - minY));
  const offsetX = 460 - ((minX + maxX) / 2) * scale;
  const offsetY = 350 - ((minY + maxY) / 2) * scale;
  return {
    cameraVector: {
      x: viewMode === 'front-left' ? 1 : -1,
      y: 1,
    },
    viewMode,
    // Nearness along the projector L = (-0.72, 1, 0.72): larger is nearer the
    // camera and must paint later. Both mirrored angles share the same
    // projector lines, so one functional serves every view.
    depth: point => point.x * -0.72 + point.y + point.z * 0.72,
    point: point => {
      const projectedPoint = raw(point);
      return {
        x: projectedPoint.x * scale + offsetX,
        y: projectedPoint.y * scale + offsetY,
      };
    },
  };
}

function productPanelFacesCamera(
  piece: SectionalPiece,
  projection: ProductProjection,
  localNormalX: number,
  localNormalY: number
): boolean {
  const rotation = ((piece.rotation % 360) + 360) % 360;
  const mirroredNormalX = piece.mirrored ? -localNormalX : localNormalX;
  let worldNormalX = mirroredNormalX;
  let worldNormalY = localNormalY;
  if (rotation === 90) {
    worldNormalX = -localNormalY;
    worldNormalY = mirroredNormalX;
  } else if (rotation === 180) {
    worldNormalX = -mirroredNormalX;
    worldNormalY = -localNormalY;
  } else if (rotation === 270) {
    worldNormalX = localNormalY;
    worldNormalY = -mirroredNormalX;
  }
  return worldNormalX * projection.cameraVector.x + worldNormalY * projection.cameraVector.y > 0;
}

function productArmInnerFacesCamera(
  piece: SectionalPiece,
  projection: ProductProjection,
  armSide: 'left' | 'right'
): boolean {
  const localNormalX = armSide === 'left' ? 1 : -1;
  return productPanelFacesCamera(piece, projection, localNormalX, 0);
}

const productPolygon = (projection: ProductProjection, points: ProductPoint3D[]): string =>
  points
    .map(point => {
      const projected = projection.point(point);
      return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
    })
    .join(' ');

function productPanelPath(
  projection: ProductProjection,
  bottomA: ProductPoint3D,
  bottomB: ProductPoint3D,
  topA: ProductPoint3D,
  topB: ProductPoint3D,
  curved: boolean
): string {
  const ba = projection.point(bottomA);
  const bb = projection.point(bottomB);
  const ta = projection.point(topA);
  const tb = projection.point(topB);
  if (!curved) {
    return `M${ba.x.toFixed(1)} ${ba.y.toFixed(1)}L${bb.x.toFixed(1)} ${bb.y.toFixed(1)}L${tb.x.toFixed(1)} ${tb.y.toFixed(1)}L${ta.x.toFixed(1)} ${ta.y.toFixed(1)}Z`;
  }
  const controlX = (ta.x + tb.x) / 2;
  const controlY = Math.min(ta.y, tb.y) - 18;
  return `M${ba.x.toFixed(1)} ${ba.y.toFixed(1)}L${bb.x.toFixed(1)} ${bb.y.toFixed(1)}L${tb.x.toFixed(1)} ${tb.y.toFixed(1)}Q${controlX.toFixed(1)} ${controlY.toFixed(1)} ${ta.x.toFixed(1)} ${ta.y.toFixed(1)}Z`;
}

function sectionalPiecePoint(
  piece: SectionalPiece,
  localX: number,
  localY: number,
  z: number,
  layout: ProductLayout
): ProductPoint3D {
  const placement = layout.get(piece.id);
  const footprint = placement || {
    originX: GRID_ORIGIN_X + piece.col * CELL,
    originY: GRID_ORIGIN_Y + piece.row * CELL,
    bodyW: unrotatedFootprint(piece).bodyW,
    bodyH: unrotatedFootprint(piece).bodyH,
  };
  const rotation = ((piece.rotation % 360) + 360) % 360;
  const mirroredX = piece.mirrored ? footprint.bodyW - localX : localX;
  let x = mirroredX;
  let y = localY;
  if (rotation === 90) {
    x = footprint.bodyH - localY;
    y = mirroredX;
  } else if (rotation === 180) {
    x = footprint.bodyW - mirroredX;
    y = footprint.bodyH - localY;
  } else if (rotation === 270) {
    x = localY;
    y = footprint.bodyW - mirroredX;
  }
  return {
    x: footprint.originX + x,
    y: footprint.originY + y,
    z,
  };
}

interface SectionalProductRenderLayer {
  piece: SectionalPiece;
  layer: 'rear' | 'body' | 'near-back' | 'arm';
  sortDepth: number;
  markup: string;
}

interface SectionalProductSurface {
  layer: SectionalProductRenderLayer['layer'];
  depthPoint: ProductPoint3D;
  markup: string;
}

function sectionalProductPieceLayers(
  piece: SectionalPiece,
  projection: ProductProjection,
  layout: ProductLayout,
  theme: SectionalTheme,
  fallbackStyle: SectionalProductStyle,
  connections: SectionalConnectionReport
): SectionalProductRenderLayer[] {
  const footprint = layout.get(piece.id) || unrotatedFootprint(piece);
  const w = footprint.bodyW;
  const d = footprint.bodyH;
  const style = resolveProductStyle(piece, fallbackStyle);
  const capabilities = getSectionalPieceCapabilities(piece.kind);
  const p = (localX: number, localY: number, z: number) =>
    sectionalPiecePoint(piece, localX, localY, z, layout);
  // Per-surface vertical gradients in user space: shared bounding-box ramps
  // shade along a long quad's *length* (the old "water-slide" arms), so every
  // face gets its own top-to-bottom ramp from its projected z-extent.
  let surfaceGradients: string[] = [];
  let gradientSeq = 0;
  const vGrad = (
    from: string,
    to: string,
    topPoint: ProductPoint3D,
    bottomPoint: ProductPoint3D
  ): string => {
    const top = projection.point(topPoint);
    const bottom = projection.point(bottomPoint);
    const id = `sbg${(gradientSeq += 1)}`;
    surfaceGradients.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${top.x.toFixed(1)}" y1="${top.y.toFixed(1)}" x2="${bottom.x.toFixed(1)}" y2="${bottom.y.toFixed(1)}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`
    );
    return `url(#${id})`;
  };
  const withGradients = (markup: string): string => {
    if (!surfaceGradients.length) return markup;
    const defs = `<defs>${surfaceGradients.join('')}</defs>`;
    surfaceGradients = [];
    return defs + markup;
  };
  // Vertical anatomy in svg px (1 px ≈ 0.76 cm): deck, plump seat cushion,
  // arm crown and back heights follow real sofa proportions (~45 cm seat,
  // ~65 cm arm, ~90 cm back) so modules read as furniture, not billboards.
  const bodyTop = 37;
  const seatBottom = style.cushion === 'knife' ? 41 : 38;
  const seatTop = style.cushion === 'knife' ? 54 : 60;
  const structuralBackTop = style.back === 'short' ? 108 : style.back === 'curved' ? 130 : 136;
  const looseBackTop = style.back === 'short' ? 100 : style.back === 'curved' ? 122 : 128;
  const armTop = style.arm === 'wedge' ? 82 : 90;
  const inset = style.cushion === 'rounded' ? 11 : 9;
  const isPerpendicularReturn = ((piece.rotation % 180) + 180) % 180 !== 0;
  const armSides = capabilities.armSides;
  // A roll/square arm on a 105 cm module is a real volume (~22 cm), not a
  // 15 px appliqué. The seat rectangle shrinks accordingly; the saved module
  // footprint is unchanged. Two-arm modules (armchair, two-arm chaise) shrink
  // the seat from both sides.
  const armThickness = 29;
  const bodyLeftX = 0;
  const bodyRightX = w;
  const seatLeftX = armSides.includes('left') ? armThickness : 0;
  const seatRightX = armSides.includes('right') ? w - armThickness : w;
  const localSideConnected = (side: ConnectorSide) => {
    const turns = Math.round((((piece.rotation % 360) + 360) % 360) / 90) % 4;
    let worldSide = SIDE_ORDER[(SIDE_ORDER.indexOf(side) + turns) % 4];
    if (piece.mirrored) {
      worldSide = worldSide === 'left' ? 'right' : worldSide === 'right' ? 'left' : worldSide;
    }
    return connections.connected.has(`${piece.id}:${worldSide}`);
  };
  // A face that butts into a neighbouring module is interior joinery: drawing
  // it hangs a bogus wall between connected pieces (the "exploded L" bug).
  // Local 'bottom' is the upholstered front, local 'top' the rear shell.
  const frontConnected = localSideConnected('bottom');
  const rearConnected = localSideConnected('top');
  const frontFacesCamera = productPanelFacesCamera(piece, projection, 0, 1);
  // A perpendicular return whose local-left edge joins the corner unit forms
  // the elbow of an L: its back wall and cushions run right up to the joint.
  const backJoinsCorner = isPerpendicularReturn && localSideConnected('left');
  // Upholstery reaches almost to a joined edge so connected modules read as
  // one continuous seat; open edges keep the usual cushion reveal.
  // Upholstery reaches almost to a joined edge so connected modules read as
  // one continuous seat (2px seam reveal); open edges keep the cushion reveal.
  const leftContentInset =
    seatLeftX + (backJoinsCorner ? 3 : localSideConnected('left') ? 2 : inset);
  const rightContentX = seatRightX - (localSideConnected('right') ? 2 : inset);
  const leftBackInset = seatLeftX + (backJoinsCorner ? 4 : 11);
  const rightBackX = seatRightX - 11;
  const frontY = d;
  const rearY = 0;
  // Tuck the seat cushion under the loose back cushion. The overlap makes the
  // upholstery read as one assembly instead of two disconnected rectangles.
  // Real seat cushions occupy the front ~two-thirds of the deck, leaving the
  // rear third for the back pillows and their well. A full-depth cushion top
  // reads as a runway and pushes the pillows into floating-card territory.
  const seatRear = Math.min(38, d * 0.3);
  // An open seat cushion sits flush with the base front (a 2px tuck), as do
  // connected ones — a proud overhang reads as a detached lid.
  const seatFront = frontY - 2;
  // Arm extent is shared by every arm of the module (and drives the T-shaped
  // seat cushion): full-length arms end flush with the seat front; half-length
  // arms (CS1L family) stop set back ~20 cm from it, so the cushion fills the
  // full footprint in front of them. Two-arm modules default to half-length.
  const armRear = rearY + 18;
  const armIsOnChaise = piece.kind === 'left-arm-chaise' || piece.kind === 'right-arm-chaise';
  const armLength = resolveProductStyle(piece, fallbackStyle).armLength;
  const armSetback = armLength === 'half' ? 26 : 0;
  const armFront =
    (armIsOnChaise ? Math.min(frontY - 1, armRear + 95 * PRODUCT_PX_PER_CM) : frontY - 1) -
    armSetback;
  const tSeatActive = armSides.length > 0 && armFront < frontY - 6;
  // T-shaped seat cushion: with set-back (half-length) arms the cushion fills
  // the full module width in front of the arm ends — narrow between the arms,
  // full width at the front — so no dead space is left around the arms.
  const tArmY = tSeatActive ? Math.max(seatRear + 6, armFront - 2) : seatFront;
  const frontInsetL = localSideConnected('left') || frontConnected ? 2 : inset;
  const frontInsetR = localSideConnected('right') || frontConnected ? 2 : inset;
  const frontLeftX = tSeatActive ? frontInsetL : leftContentInset;
  const frontRightX = tSeatActive ? w - frontInsetR : rightContentX;
  // Tonal strokes replace the old near-black CAD outlines: definition comes
  // from shaded gradients, edges only need a whisper of the shadow tone.
  const bodyStroke = shadeHex(theme.body, -48);
  const cushionLine = shadeHex(theme.cushion, -46);
  const topFace = productPolygon(projection, [
    p(bodyLeftX, rearY, bodyTop),
    p(bodyRightX, rearY, bodyTop),
    p(bodyRightX, frontY, bodyTop),
    p(bodyLeftX, frontY, bodyTop),
  ]);
  const frontFace = productPolygon(projection, [
    p(bodyLeftX, frontY, 5),
    p(bodyRightX, frontY, 5),
    p(bodyRightX, frontY, bodyTop),
    p(bodyLeftX, frontY, bodyTop),
  ]);
  const rearFace = productPolygon(projection, [
    p(bodyLeftX, rearY, 5),
    p(bodyRightX, rearY, 5),
    p(bodyRightX, rearY, bodyTop),
    p(bodyLeftX, rearY, bodyTop),
  ]);
  const leftSideFace = productPolygon(projection, [
    p(bodyLeftX, rearY, 5),
    p(bodyLeftX, frontY, 5),
    p(bodyLeftX, frontY, bodyTop),
    p(bodyLeftX, rearY, bodyTop),
  ]);
  const rightSideFace = productPolygon(projection, [
    p(bodyRightX, rearY, 5),
    p(bodyRightX, frontY, 5),
    p(bodyRightX, frontY, bodyTop),
    p(bodyRightX, rearY, bodyTop),
  ]);
  // Cushion silhouettes vary by cut: boxed stays crisp, knife-edge is pinched
  // at the front corners, and rounded bellies over the front edge. With
  // set-back arms the outline is a T: narrow between the arms, full width in
  // front of them.
  const seatOutlineLocal: Array<readonly [number, number]> = tSeatActive
    ? [
        [leftContentInset, seatRear],
        [rightContentX, seatRear],
        [rightContentX, tArmY],
        [frontRightX, tArmY],
        [frontRightX, seatFront],
        [frontLeftX, seatFront],
        [frontLeftX, tArmY],
        [leftContentInset, tArmY],
      ]
    : [
        [leftContentInset, seatRear],
        [rightContentX, seatRear],
        [rightContentX, seatFront],
        [leftContentInset, seatFront],
      ];
  const cushionTopCorners: ProductPoint3D[] = seatOutlineLocal.map(([lx, ly]) =>
    p(lx, ly, seatTop)
  );
  // A soft crown over the front edge makes the cushion read as stuffed
  // instead of a foam slab. The dome control sits a few px above the edge.
  const crownRise = style.cushion === 'rounded' ? 5 : 3.5;
  const seatCushionTopElement = (strokeWidth: number): string => {
    const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    const fill = vGrad(
      shadeHex(theme.cushion, 14),
      shadeHex(theme.cushion, 3),
      p((leftContentInset + rightContentX) / 2, seatRear, seatTop),
      p((leftContentInset + rightContentX) / 2, seatFront, seatTop)
    );
    const outlinePath = (pts: SectionalPoint[]) => `M${pts.map(s).join('L')}Z`;
    if (tSeatActive) {
      // T-shaped top: straight perimeter, the welt/crown overlays carry the
      // stuffed read on each arm of the T.
      return `<path class="sb-seat-cushion" d="${outlinePath(cushionTopCorners.map(corner => projection.point(corner)))}" fill="${fill}" stroke="${cushionLine}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    const [rearLeft, rearRight, frontRight, frontLeft] = cushionTopCorners.map(corner =>
      projection.point(corner)
    );
    if (style.cushion === 'rounded') {
      const belly = projection.point(
        p((leftContentInset + rightContentX) / 2, seatFront + 4, seatTop + 3)
      );
      return `<path class="sb-seat-cushion" d="M${s(rearLeft)}L${s(rearRight)}L${s(frontRight)}Q${s(belly)} ${s(frontLeft)}Z" fill="${fill}" stroke="${cushionLine}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    if (style.cushion === 'knife') {
      const pinch = 7;
      const hex = [
        p(leftContentInset, seatRear, seatTop),
        p(rightContentX, seatRear, seatTop),
        p(rightContentX, seatFront - 4, seatTop),
        p(rightContentX - pinch, seatFront, seatTop),
        p(leftContentInset + pinch, seatFront, seatTop),
        p(leftContentInset, seatFront - 4, seatTop),
      ].map(corner => projection.point(corner));
      const dome = projection.point(
        p((leftContentInset + rightContentX) / 2, seatFront, seatTop + crownRise)
      );
      return `<path class="sb-seat-cushion" d="M${s(hex[0])}L${s(hex[1])}L${s(hex[2])}L${s(hex[3])}Q${s(dome)} ${s(hex[4])}L${s(hex[5])}Z" fill="${fill}" stroke="${cushionLine}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    const dome = projection.point(
      p((leftContentInset + rightContentX) / 2, seatFront, seatTop + crownRise)
    );
    return `<path class="sb-seat-cushion" d="M${s(rearLeft)}L${s(rearRight)}L${s(frontRight)}Q${s(dome)} ${s(frontLeft)}Z" fill="${fill}" stroke="${cushionLine}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
  };
  // Crown highlight + welt cord sell the upholstery: a light pool on top and
  // a piped seam tracing the perimeter just in from the edge. Both shrink
  // toward the outline centroid in *local* space so rotated modules and
  // T-shaped outlines stay exact.
  const seatCentroid = seatOutlineLocal.reduce(
    (acc, [lx, ly]) => ({
      x: acc.x + lx / seatOutlineLocal.length,
      y: acc.y + ly / seatOutlineLocal.length,
    }),
    { x: 0, y: 0 }
  );
  const shrunkSeatCorners = (shrink: number, z: number): string => {
    const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    const pts = seatOutlineLocal.map(([lx, ly]) =>
      projection.point(
        p(
          seatCentroid.x + (lx - seatCentroid.x) * (1 - shrink),
          seatCentroid.y + (ly - seatCentroid.y) * (1 - shrink),
          z
        )
      )
    );
    return `M${pts.map(s).join('L')}Z`;
  };
  const seatCushionCrownElement = (): string =>
    `<path class="sb-seat-cushion-crown" d="${shrunkSeatCorners(0.08, seatTop + 0.4)}" fill="${shadeHex(theme.cushion, 18)}" opacity="0.3" stroke="none"/>`;
  const seatCushionWeltElement = (): string =>
    `<path class="sb-seat-cushion-welt-top" d="${shrunkSeatCorners(0.055, seatTop + 0.2)}" fill="none" stroke="${shadeHex(theme.cushion, -38)}" stroke-width="1" opacity="0.55"/>`;
  const seatCushionFrontElement = (strokeWidth: number): string => {
    const bottomLeft = projection.point(p(frontLeftX, seatFront, seatBottom));
    const bottomRight = projection.point(p(frontRightX, seatFront, seatBottom));
    const topRight = projection.point(p(frontRightX, seatFront, seatTop));
    const topLeft = projection.point(p(frontLeftX, seatFront, seatTop));
    const crown = projection.point(
      p((frontLeftX + frontRightX) / 2, seatFront, seatTop + crownRise)
    );
    const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    const fill = vGrad(
      shadeHex(theme.cushion, 4),
      shadeHex(theme.cushion, -17),
      p((frontLeftX + frontRightX) / 2, seatFront, seatTop + 2),
      p((frontLeftX + frontRightX) / 2, seatFront, seatBottom)
    );
    if (style.cushion === 'rounded') {
      const belly = projection.point(p((frontLeftX + frontRightX) / 2, seatFront + 4, seatTop + 1));
      return `<path class="sb-seat-cushion-front" d="M${s(bottomLeft)}L${s(bottomRight)}L${s(topRight)}Q${s(belly)} ${s(topLeft)}Z" fill="${fill}" stroke="${cushionLine}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    if (style.cushion === 'knife') {
      const pinch = 7;
      const hex = productPolygon(projection, [
        p(frontLeftX, seatFront, seatBottom),
        p(frontRightX, seatFront, seatBottom),
        p(frontRightX, seatFront, seatTop - 3),
        p(frontRightX - pinch, seatFront, seatTop),
        p(frontLeftX + pinch, seatFront, seatTop),
        p(frontLeftX, seatFront, seatTop - 3),
      ]);
      return `<polygon class="sb-seat-cushion-front" points="${hex}" fill="${fill}" stroke="${cushionLine}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    return `<path class="sb-seat-cushion-front" d="M${s(bottomLeft)}L${s(bottomRight)}L${s(topRight)}Q${s(crown)} ${s(topLeft)}Z" fill="${fill}" stroke="${cushionLine}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
  };
  const cushionRear = productPolygon(projection, [
    p(leftContentInset, seatRear, seatBottom),
    p(rightContentX, seatRear, seatBottom),
    p(rightContentX, seatRear, seatTop),
    p(leftContentInset, seatRear, seatTop),
  ]);
  // Side faces: the rear segment runs between the arms (seatRear..tArmY);
  // with a T seat the front segment adds exposed end faces at the module
  // edges (tArmY..seatFront).
  const cushionLeftSide = productPolygon(projection, [
    p(leftContentInset, seatRear, seatBottom),
    p(leftContentInset, tArmY, seatBottom),
    p(leftContentInset, tArmY, seatTop),
    p(leftContentInset, seatRear, seatTop),
  ]);
  const cushionRightSide = productPolygon(projection, [
    p(rightContentX, seatRear, seatBottom),
    p(rightContentX, tArmY, seatBottom),
    p(rightContentX, tArmY, seatTop),
    p(rightContentX, seatRear, seatTop),
  ]);
  const cushionFrontLeftSide = productPolygon(projection, [
    p(frontLeftX, tArmY, seatBottom),
    p(frontLeftX, seatFront, seatBottom),
    p(frontLeftX, seatFront, seatTop),
    p(frontLeftX, tArmY, seatTop),
  ]);
  const cushionFrontRightSide = productPolygon(projection, [
    p(frontRightX, tArmY, seatBottom),
    p(frontRightX, seatFront, seatBottom),
    p(frontRightX, seatFront, seatTop),
    p(frontRightX, tArmY, seatTop),
  ]);
  // The back is a framed box with real depth (~11 cm), not a billboard: the
  // face plane stands a hand-width in front of the footprint's rear edge and
  // a deep top cap wraps the frame, so the sofa reads with a back you could
  // lean against. Every structural back shares these planes, so the corner's
  // return back and the return leg's backs form one continuous spine.
  const frameFront = 14;
  const frameLean = 2;
  const junctionBottomInset = frameFront;
  const junctionTopInset = frameFront - frameLean;
  // Where a module side joins its neighbour, the structural back runs to the
  // module edge so the row reads as one continuous wall — no light slits
  // between adjacent backs (exposed on tight RB backs where no cushions
  // cover the joints).
  const joinsLeft = backJoinsCorner || localSideConnected('left');
  const joinsRight = localSideConnected('right');
  const backMinX = joinsLeft ? 0 : 4;
  const backMinXTop = joinsLeft ? 0 : 6;
  const backMaxX = joinsRight ? w : w - 4;
  const backMaxXTop = joinsRight ? w : w - 6;
  // Curved-back pieces ride the assembly-wide arc (see applyUniformBackCurve):
  // top corners lift by the arc height at their x positions, so a row of
  // modules forms one continuous curve instead of per-module scallops. The
  // top edge bows to the arc's mid height so each chord itself curves.
  const backLift: { left: number; right: number; mid: number } = (
    layout.get(piece.id) as ProductPiecePlacement | undefined
  )?.backLift || { left: 0, right: 0, mid: 0 };
  const backTopA = projection.point(
    p(backMinXTop, rearY + junctionTopInset, structuralBackTop + backLift.left)
  );
  const backTopB = projection.point(
    p(backMaxXTop, rearY + junctionTopInset, structuralBackTop + backLift.right)
  );
  const backBottomA = projection.point(p(backMinX, rearY + junctionBottomInset, bodyTop));
  const backBottomB = projection.point(p(backMaxX, rearY + junctionBottomInset, bodyTop));
  const backBow = backLift.mid - (backLift.left + backLift.right) / 2;
  const backTopControl = projection.point(
    p(
      (backMinXTop + w - 6) / 2,
      rearY + junctionTopInset,
      structuralBackTop + (backLift.left + backLift.right) / 2 + 2 * Math.max(0, backBow)
    )
  );
  const structuralBackPath =
    `M${backBottomA.x.toFixed(1)} ${backBottomA.y.toFixed(1)}` +
    `L${backBottomB.x.toFixed(1)} ${backBottomB.y.toFixed(1)}` +
    `L${backTopB.x.toFixed(1)} ${backTopB.y.toFixed(1)}` +
    (Math.abs(backBow) > 0.3
      ? `Q${backTopControl.x.toFixed(1)} ${backTopControl.y.toFixed(1)} ${backTopA.x.toFixed(1)} ${backTopA.y.toFixed(1)}`
      : `L${backTopA.x.toFixed(1)} ${backTopA.y.toFixed(1)}`) +
    'Z';
  // The loose back cushion is a boxed pillow, deliberately independent from
  // the structural back: its front plane sits well ahead of the frame face,
  // its top leans back and tucks against the frame, and its bottom rests on
  // the seat cushion's rear (tucked under). The face crowns gently for
  // boxed/knife cuts and generously for the rounded cut.
  const cushionFront = 30;
  const cushionTopFront = 20;
  const cushionTopRear = 12;
  const backCushionCrown = style.cushion === 'rounded' ? 14 : 6;
  // T/L back-cushion wrap: above the arm crowns the cushion widens to the
  // module edges on sides that carry an arm — a T on two-arm modules, an L on
  // single-arm ends (CW T-cushion armchair / CS1L end-section look). Only
  // when the back is tall enough to clear the arms.
  const armCrownZ = style.arm === 'round' ? 101 : style.arm === 'wedge' ? 94 : 90;
  const wrapBendZ = armCrownZ + 5;
  const wrapActive =
    resolveProductStyle(piece, fallbackStyle).backCushionFit === 'wrap' &&
    armSides.length > 0 &&
    looseBackTop >= wrapBendZ + 6;
  const wrapL = armSides.includes('left') ? 5 : leftBackInset - 3;
  const wrapR = armSides.includes('right') ? w - 5 : rightBackX + 3;
  const looseBackPanel = (crown: number, pad = 0): string => {
    const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    const bl = projection.point(
      p(leftBackInset - 3 + pad, rearY + cushionFront, seatTop - 1 + pad * 0.4)
    );
    const br = projection.point(
      p(rightBackX + 3 - pad, rearY + cushionFront, seatTop - 1 + pad * 0.4)
    );
    if (!wrapActive) {
      const tl = projection.point(
        p(
          leftBackInset + pad * 0.8,
          rearY + cushionTopFront,
          looseBackTop + backLift.left - pad * 0.8
        )
      );
      const tr = projection.point(
        p(
          rightBackX - pad * 0.8,
          rearY + cushionTopFront,
          looseBackTop + backLift.right - pad * 0.8
        )
      );
      const control = projection.point(
        p(
          (leftBackInset + rightBackX) / 2,
          rearY + cushionTopFront - 1,
          looseBackTop + crown + backLift.mid - pad * 0.8
        )
      );
      return `M${s(bl)}L${s(br)}L${s(tr)}Q${s(control)} ${s(tl)}Z`;
    }
    const stemL = leftBackInset - 3 + pad;
    const stemR = rightBackX + 3 - pad;
    const bendR = wrapR - pad;
    const bendL = wrapL + pad;
    const bendY = rearY + cushionFront;
    const topR = projection.point(
      p(rightBackX - pad * 0.8, rearY + cushionTopFront, looseBackTop + backLift.right - pad * 0.8)
    );
    const topL = projection.point(
      p(
        leftBackInset + pad * 0.8,
        rearY + cushionTopFront,
        looseBackTop + backLift.left - pad * 0.8
      )
    );
    const control = projection.point(
      p(
        (leftBackInset + rightBackX) / 2,
        rearY + cushionTopFront - 1,
        looseBackTop + crown + backLift.mid - pad * 0.8
      )
    );
    const kinkR = projection.point(p(bendR, bendY, wrapBendZ));
    const kinkL = projection.point(p(bendL, bendY, wrapBendZ));
    return (
      `M${s(bl)}L${s(br)}` +
      `L${s(projection.point(p(stemR, bendY, wrapBendZ)))}` +
      `L${s(kinkR)}` +
      `L${s(topR)}` +
      `Q${s(control)} ${s(topL)}` +
      `L${s(kinkL)}` +
      `L${s(projection.point(p(bendL, bendY, wrapBendZ)))}` +
      `L${s(projection.point(p(stemL, bendY, wrapBendZ)))}Z`
    );
  };
  const looseBackPath = looseBackPanel(backCushionCrown);
  // Deep top cap wrapping the frame — the head-on clue that the backrest is
  // a thick structure rather than a fence. On a curved back the cap rides
  // the same assembly arc as the frame face.
  const structuralBackCap = productPolygon(projection, [
    p(backMinXTop, rearY + junctionTopInset, structuralBackTop + backLift.left),
    p(backMaxXTop, rearY + junctionTopInset, structuralBackTop + backLift.right),
    p(backMaxXTop, rearY, structuralBackTop - 2.5 + backLift.right),
    p(backMinXTop, rearY, structuralBackTop - 2.5 + backLift.left),
  ]);
  const structuralBackLeftEdge = productPolygon(projection, [
    p(4, rearY + frameFront, bodyTop),
    p(4, rearY, bodyTop),
    p(6, rearY, structuralBackTop - 2.5 + backLift.left),
    p(6, rearY + junctionTopInset, structuralBackTop + backLift.left),
  ]);
  const structuralBackRightEdge = productPolygon(projection, [
    p(backMaxX, rearY + frameFront, bodyTop),
    p(backMaxX, rearY, bodyTop),
    p(backMaxXTop, rearY, structuralBackTop - 2.5 + backLift.right),
    p(backMaxXTop, rearY + junctionTopInset, structuralBackTop + backLift.right),
  ]);
  // Pillow top: from the front edge of the face back to the tuck against the
  // frame — real boxing width, not a sliver. Rides the arc on curved backs.
  const looseBackTopCap = productPolygon(projection, [
    p(wrapActive ? wrapL : leftBackInset, rearY + cushionTopFront, looseBackTop + backLift.left),
    p(wrapActive ? wrapR : rightBackX, rearY + cushionTopFront, looseBackTop + backLift.right),
    p(wrapActive ? wrapR : rightBackX, rearY + cushionTopRear, looseBackTop - 2 + backLift.right),
    p(wrapActive ? wrapL : leftBackInset, rearY + cushionTopRear, looseBackTop - 2 + backLift.left),
  ]);
  // Full-depth side gussets: the pillow's end face runs from its front plane
  // back to the tuck, so exposed ends read as stuffed boxing.
  const looseBackLeftEdge = productPolygon(projection, [
    p(leftBackInset - 3, rearY + cushionFront, seatTop - 1),
    p(leftBackInset - 3, rearY + cushionFront - 13, seatTop - 1),
    p(leftBackInset, rearY + cushionTopRear, looseBackTop - 2 + backLift.left),
    p(leftBackInset, rearY + cushionTopFront, looseBackTop + backLift.left),
  ]);
  const looseBackRightEdge = productPolygon(projection, [
    p(rightBackX + 3, rearY + cushionFront, seatTop - 1),
    p(rightBackX + 3, rearY + cushionFront - 13, seatTop - 1),
    p(rightBackX, rearY + cushionTopRear, looseBackTop - 2 + backLift.right),
    p(rightBackX, rearY + cushionTopFront, looseBackTop + backLift.right),
  ]);
  const bodySurfaces: SectionalProductSurface[] = [];
  const bodySurface = (
    layer: SectionalProductSurface['layer'],
    depthPoint: ProductPoint3D,
    markup: string
  ) => bodySurfaces.push({ layer, depthPoint, markup: withGradients(markup) });
  const seatSurfaces: SectionalProductSurface[] = [];
  const seatSurface = (
    layer: SectionalProductSurface['layer'],
    depthPoint: ProductPoint3D,
    markup: string
  ) => seatSurfaces.push({ layer, depthPoint, markup: withGradients(markup) });
  const showLeftSide =
    productPanelFacesCamera(piece, projection, -1, 0) && !localSideConnected('left');
  const showRightSide =
    productPanelFacesCamera(piece, projection, 1, 0) && !localSideConnected('right');
  // Tapered wooden feet ground the module like a real furniture render. They
  // tuck slightly under the base and paint before the front/side faces so the
  // base rail overlaps their tops. Skirted bases hide their feet entirely.
  const hasSkirt =
    style.base === 'long-skirt' || style.base === 'loose-fit' || style.base === 'straight-skirt';
  if (!hasSkirt) {
    const legHeight = 10;
    const foot = (corners: ProductPoint3D[], depth: ProductPoint3D) =>
      bodySurface(
        'body',
        depth,
        `<polygon class="sb-body-leg" points="${productPolygon(projection, corners)}" fill="url(#sbLegGrad)" stroke="none"/>`
      );
    if (frontFacesCamera && !frontConnected) {
      [bodyLeftX + 7, bodyRightX - 18].forEach(legX => {
        foot(
          [
            p(legX, frontY - 2, 0),
            p(legX + 9, frontY - 2, 0),
            p(legX + 10.5, frontY - 2, legHeight),
            p(legX - 1.5, frontY - 2, legHeight),
          ],
          p(legX + 4.5, frontY - 2, legHeight / 2)
        );
      });
    }
    if (showLeftSide) {
      foot(
        [
          p(bodyLeftX + 2, rearY + 10, 0),
          p(bodyLeftX + 2, rearY + 19, 0),
          p(bodyLeftX + 2, rearY + 20.5, legHeight),
          p(bodyLeftX + 2, rearY + 8.5, legHeight),
        ],
        p(bodyLeftX + 2, rearY + 14.5, legHeight / 2)
      );
    }
    if (showRightSide) {
      foot(
        [
          p(bodyRightX - 2, rearY + 10, 0),
          p(bodyRightX - 2, rearY + 19, 0),
          p(bodyRightX - 2, rearY + 20.5, legHeight),
          p(bodyRightX - 2, rearY + 8.5, legHeight),
        ],
        p(bodyRightX - 2, rearY + 14.5, legHeight / 2)
      );
    }
  }
  if (showLeftSide) {
    const fill = vGrad(
      shadeHex(theme.body, -6),
      shadeHex(theme.body, -24),
      p(bodyLeftX, d / 2, bodyTop),
      p(bodyLeftX, d / 2, 5)
    );
    bodySurface(
      'body',
      p(bodyLeftX, d / 2, bodyTop / 2),
      `<polygon class="sb-body-side sb-body-side-left" points="${leftSideFace}" fill="${fill}" stroke="${bodyStroke}" stroke-width="1.1"/>`
    );
  }
  if (showRightSide) {
    const fill = vGrad(
      shadeHex(theme.body, -3),
      shadeHex(theme.body, -20),
      p(bodyRightX, d / 2, bodyTop),
      p(bodyRightX, d / 2, 5)
    );
    bodySurface(
      'body',
      p(bodyRightX, d / 2, bodyTop / 2),
      `<polygon class="sb-body-side sb-body-side-right" points="${rightSideFace}" fill="${fill}" stroke="${bodyStroke}" stroke-width="1.1"/>`
    );
  }
  if (frontFacesCamera && !frontConnected) {
    const fill = vGrad(
      shadeHex(theme.body, 4),
      shadeHex(theme.body, -18),
      p(w / 2, frontY, bodyTop),
      p(w / 2, frontY, 5)
    );
    bodySurface(
      'body',
      p(w / 2, frontY, bodyTop / 2),
      `<polygon class="sb-body-front" points="${frontFace}" fill="${fill}" stroke="${bodyStroke}" stroke-width="1.1"/>`
    );
  } else if (!frontFacesCamera && !rearConnected) {
    const fill = vGrad(
      shadeHex(theme.body, -10),
      shadeHex(theme.body, -27),
      p(w / 2, rearY, bodyTop),
      p(w / 2, rearY, 5)
    );
    bodySurface(
      'body',
      p(w / 2, rearY, bodyTop / 2),
      `<polygon class="sb-body-rear" points="${rearFace}" fill="${fill}" stroke="${bodyStroke}" stroke-width="1.1"/>`
    );
  }
  const bodyTopFill = vGrad(
    shadeHex(theme.body, 14),
    shadeHex(theme.body, 3),
    p(w / 2, rearY, bodyTop),
    p(w / 2, frontY, bodyTop)
  );
  bodySurface(
    'body',
    p(w / 2, d / 2, bodyTop),
    `<polygon class="sb-body" points="${topFace}" fill="${bodyTopFill}" stroke="${bodyStroke}" stroke-width="1"/>`
  );
  // Contact shadow on the deck where the seat cushion meets the base rail —
  // the ambient-occlusion accent that anchors the cushion onto the frame.
  if (!frontConnected) {
    const deckShadow = productPolygon(projection, [
      p(leftContentInset + 2, frontY - 6, bodyTop + 0.1),
      p(rightContentX - 2, frontY - 6, bodyTop + 0.1),
      p(rightContentX - 2, frontY, bodyTop + 0.1),
      p(leftContentInset + 2, frontY, bodyTop + 0.1),
    ]);
    bodySurface(
      'body',
      p(w / 2, frontY - 3, bodyTop),
      `<polygon class="sb-deck-shadow" points="${deckShadow}" fill="${shadeHex(theme.body, -34)}" opacity="0.4" stroke="none"/>`
    );
  }
  if (hasSkirt) {
    const skirtHeight = style.base === 'loose-fit' ? 33 : style.base === 'straight-skirt' ? 26 : 28;
    // A skirt is a hanging band that wraps every camera-facing open edge of
    // the base: front, plus whichever side faces the camera. Connected edges
    // are interior joints and stay bare.
    const skirtPanels: Array<{
      cls: string;
      corners: ProductPoint3D[];
      depth: ProductPoint3D;
      /** local-axis span of the panel, for placing pleats */
      span: [number, number];
      axis: 'x' | 'y';
      fixed: number;
      fill: string;
    }> = [];
    if (frontFacesCamera && !frontConnected) {
      skirtPanels.push({
        cls: 'sb-body-skirt',
        corners: [
          p(2, frontY + 1, 0),
          p(w - 2, frontY + 1, 0),
          p(w - 2, frontY + 1, skirtHeight),
          p(2, frontY + 1, skirtHeight),
        ],
        depth: p(w / 2, frontY + 1, skirtHeight / 2),
        span: [4, w - 4],
        axis: 'x',
        fixed: frontY + 1,
        fill: vGrad(
          shadeHex(theme.body, 0),
          shadeHex(theme.body, -16),
          p(w / 2, frontY + 1, skirtHeight),
          p(w / 2, frontY + 1, 0)
        ),
      });
    }
    if (showLeftSide) {
      skirtPanels.push({
        cls: 'sb-body-skirt sb-body-skirt-side',
        corners: [
          p(bodyLeftX - 1, rearY + 2, 0),
          p(bodyLeftX - 1, frontY + 1, 0),
          p(bodyLeftX - 1, frontY + 1, skirtHeight),
          p(bodyLeftX - 1, rearY + 2, skirtHeight),
        ],
        depth: p(bodyLeftX - 1, d / 2, skirtHeight / 2),
        span: [rearY + 4, frontY - 2],
        axis: 'y',
        fixed: bodyLeftX - 1,
        fill: vGrad(
          shadeHex(theme.body, -6),
          shadeHex(theme.body, -22),
          p(bodyLeftX - 1, d / 2, skirtHeight),
          p(bodyLeftX - 1, d / 2, 0)
        ),
      });
    }
    if (showRightSide) {
      skirtPanels.push({
        cls: 'sb-body-skirt sb-body-skirt-side',
        corners: [
          p(bodyRightX + 1, rearY + 2, 0),
          p(bodyRightX + 1, frontY + 1, 0),
          p(bodyRightX + 1, frontY + 1, skirtHeight),
          p(bodyRightX + 1, rearY + 2, skirtHeight),
        ],
        depth: p(bodyRightX + 1, d / 2, skirtHeight / 2),
        span: [rearY + 4, frontY - 2],
        axis: 'y',
        fixed: bodyRightX + 1,
        fill: vGrad(
          shadeHex(theme.body, -3),
          shadeHex(theme.body, -19),
          p(bodyRightX + 1, d / 2, skirtHeight),
          p(bodyRightX + 1, d / 2, 0)
        ),
      });
    }
    skirtPanels.forEach(panel => {
      const pleated = style.base === 'loose-fit';
      const cls = pleated ? `${panel.cls} sb-body-skirt-pleated` : panel.cls;
      bodySurface(
        'body',
        panel.depth,
        `<polygon class="${cls}" points="${productPolygon(projection, panel.corners)}" fill="${panel.fill}" stroke="${bodyStroke}" stroke-width="1"/>`
      );
      // Fold detailing distinguishes the cuts: cornered pleats gather at the
      // vertical corners, a long skirt gets two soft folds, and a straight
      // skirt stays crisp with only a hem shadow.
      const folds: number[] = [];
      const [spanStart, spanEnd] = panel.span;
      const spanLength = spanEnd - spanStart;
      if (pleated) {
        [4, 9, spanLength - 9, spanLength - 4].forEach(offset => {
          if (offset > 0 && offset < spanLength) folds.push(spanStart + offset);
        });
      } else if (style.base === 'long-skirt') {
        folds.push(spanStart + spanLength / 3, spanStart + (spanLength * 2) / 3);
      }
      folds.forEach(position => {
        const topPoint =
          panel.axis === 'x'
            ? p(position, panel.fixed, skirtHeight)
            : p(panel.fixed, position, skirtHeight);
        const bottomPoint =
          panel.axis === 'x' ? p(position, panel.fixed, 0) : p(panel.fixed, position, 0);
        const pt = projection.point(topPoint);
        const pb = projection.point(bottomPoint);
        bodySurface(
          'body',
          topPoint,
          `<path class="sb-skirt-pleat" d="M${pt.x.toFixed(1)} ${pt.y.toFixed(1)}L${pb.x.toFixed(1)} ${pb.y.toFixed(1)}" stroke="${shadeHex(theme.body, -30)}" stroke-width="0.8" opacity="0.4"/>`
        );
      });
      if (style.base !== 'straight-skirt') {
        const hemA = projection.point(panel.corners[0]);
        const hemB = projection.point(panel.corners[1]);
        bodySurface(
          'body',
          panel.corners[0],
          `<path class="sb-skirt-hem" d="M${hemA.x.toFixed(1)} ${hemA.y.toFixed(1)}L${hemB.x.toFixed(1)} ${hemB.y.toFixed(1)}" stroke="${shadeHex(theme.body, -26)}" stroke-width="1" opacity="0.4"/>`
        );
      }
    });
  }
  const structuralRearPieces: SectionalProductSurface[] = [];
  const rearSurface = (depthPoint: ProductPoint3D, markup: string) =>
    structuralRearPieces.push({ layer: 'rear', depthPoint, markup: withGradients(markup) });
  if (showLeftSide) {
    rearSurface(
      p(5, rearY + 4, structuralBackTop / 2),
      `<polygon class="sb-structural-back-edge sb-structural-back-edge-left" points="${structuralBackLeftEdge}" fill="${shadeHex(theme.body, -18)}" stroke="${bodyStroke}" stroke-width="1"/>`
    );
  }
  if (showRightSide) {
    rearSurface(
      p(w - 5, rearY + 4, structuralBackTop / 2),
      `<polygon class="sb-structural-back-edge sb-structural-back-edge-right" points="${structuralBackRightEdge}" fill="${shadeHex(theme.body, -12)}" stroke="${bodyStroke}" stroke-width="1"/>`
    );
  }
  const backCapFill = vGrad(
    shadeHex(theme.body, 10),
    shadeHex(theme.body, -2),
    p(w / 2, rearY, structuralBackTop),
    p(w / 2, rearY + 6, structuralBackTop)
  );
  rearSurface(
    p(w / 2, rearY + 3, structuralBackTop),
    `<polygon class="sb-structural-back-cap" points="${structuralBackCap}" fill="${backCapFill}" stroke="${bodyStroke}" stroke-width="1"/>`
  );
  const backFaceFill = vGrad(
    shadeHex(theme.body, -2),
    shadeHex(theme.body, -16),
    p(w / 2, rearY + 6, structuralBackTop),
    p(w / 2, rearY + 8, bodyTop)
  );
  rearSurface(
    p(w / 2, rearY + 7, (bodyTop + structuralBackTop) / 2),
    `<path class="sb-structural-back" d="${structuralBackPath}" fill="${backFaceFill}" stroke="${bodyStroke}" stroke-width="1.3"/>`
  );
  // Rim light along the back frame's top edge — the thin highlight studio
  // renders use to separate furniture from the backdrop.
  const rimA = projection.point(p(backMinXTop + 1, rearY + 5, structuralBackTop - 1));
  const rimB = projection.point(p(w - 7, rearY + 5, structuralBackTop - 1));
  rearSurface(
    p(w / 2, rearY + 5, structuralBackTop),
    `<path class="sb-back-rim-light" d="M${rimA.x.toFixed(1)} ${rimA.y.toFixed(1)}L${rimB.x.toFixed(1)} ${rimB.y.toFixed(1)}" stroke="${shadeHex(theme.body, 22)}" stroke-width="1.3" opacity="0.6"/>`
  );
  const looseRearPieces: SectionalProductSurface[] = [];
  const looseSurface = (depthPoint: ProductPoint3D, markup: string) =>
    looseRearPieces.push({ layer: 'rear', depthPoint, markup: withGradients(markup) });
  if (showLeftSide) {
    const fill = vGrad(
      shadeHex(theme.cushion, -6),
      shadeHex(theme.cushion, -19),
      p(leftBackInset, rearY + 18, looseBackTop),
      p(leftBackInset, rearY + 18, seatTop)
    );
    looseSurface(
      p(leftBackInset, rearY + 18, (seatTop + looseBackTop) / 2),
      `<polygon class="sb-back-cushion-edge sb-back-cushion-edge-left" points="${looseBackLeftEdge}" fill="${fill}" stroke="${cushionLine}" stroke-width="1"/>`
    );
  }
  if (showRightSide) {
    const fill = vGrad(
      shadeHex(theme.cushion, -6),
      shadeHex(theme.cushion, -19),
      p(rightBackX, rearY + 18, looseBackTop),
      p(rightBackX, rearY + 18, seatTop)
    );
    looseSurface(
      p(rightBackX, rearY + 18, (seatTop + looseBackTop) / 2),
      `<polygon class="sb-back-cushion-edge sb-back-cushion-edge-right" points="${looseBackRightEdge}" fill="${fill}" stroke="${cushionLine}" stroke-width="1"/>`
    );
  }
  const backCapTopFill = vGrad(
    shadeHex(theme.cushion, 8),
    shadeHex(theme.cushion, -3),
    p(w / 2, rearY + 7, looseBackTop),
    p(w / 2, rearY + 12, looseBackTop)
  );
  looseSurface(
    p(w / 2, rearY + 10, looseBackTop),
    `<polygon class="sb-back-cushion-cap" points="${looseBackTopCap}" fill="${backCapTopFill}" stroke="${cushionLine}" stroke-width="1"/>`
  );
  const backCushionFill = vGrad(
    shadeHex(theme.cushion, 2),
    shadeHex(theme.cushion, -15),
    p(w / 2, rearY + 12, looseBackTop),
    p(w / 2, rearY + 28, seatTop)
  );
  looseSurface(
    p(w / 2, rearY + 20, (seatTop + looseBackTop) / 2),
    `<path class="sb-back-cushion" d="${looseBackPath}" fill="${backCushionFill}" stroke="${cushionLine}" stroke-width="1.2"/>`
  );
  // Stuffed front boxing: a light vertical strip along the pillow's bottom
  // front edge. This is the front-on cue that the cushion is a thick pillow,
  // not a flat panel leaning on the frame.
  looseSurface(
    p(w / 2, rearY + cushionFront, seatTop + 3),
    `<path class="sb-back-cushion-boxing" d="${(() => {
      const a = projection.point(p(leftBackInset - 2, rearY + cushionFront, seatTop - 1));
      const b = projection.point(p(rightBackX + 2, rearY + cushionFront, seatTop - 1));
      const c = projection.point(p(rightBackX + 2, rearY + cushionFront + 6, seatTop + 6));
      const dd = projection.point(p(leftBackInset - 2, rearY + cushionFront + 6, seatTop + 6));
      const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      return `M${s(a)}L${s(b)}L${s(c)}L${s(dd)}Z`;
    })()}" fill="${shadeHex(theme.cushion, 6)}" opacity="0.75" stroke="none"/>`
  );
  // Stuffed-pillow modelling on the face: a light pool toward the crown and a
  // soft contact shadow along the bottom where the cushion meets the seat.
  looseSurface(
    p(w / 2, rearY + 18, looseBackTop - 14),
    `<path class="sb-back-cushion-crown" d="${looseBackPanel(backCushionCrown * 0.6, 8)}" fill="${shadeHex(theme.cushion, 18)}" opacity="0.32" stroke="none"/>`
  );
  const backContactShadow = productPolygon(projection, [
    p(leftBackInset + 2, rearY + cushionFront + 1, seatTop + 12),
    p(rightBackX - 2, rearY + cushionFront + 1, seatTop + 12),
    p(rightBackX - 1, rearY + cushionFront + 2, seatTop - 1),
    p(leftBackInset + 1, rearY + cushionFront + 2, seatTop - 1),
  ]);
  looseSurface(
    p(w / 2, rearY + 28, seatTop + 5),
    `<polygon class="sb-back-cushion-shadow" points="${backContactShadow}" fill="${shadeHex(theme.cushion, -30)}" opacity="0.28" stroke="none"/>`
  );
  // A piped welt just inside the cushion edge reads as a stitched seam — the
  // detail that separates a stuffed pillow from a flat board.
  looseSurface(
    p(w / 2, rearY + 20, (seatTop + looseBackTop) / 2 + 1),
    `<path class="sb-back-cushion-welt" d="${looseBackPanel(backCushionCrown * 0.7, 4.5)}" fill="none" stroke="${shadeHex(theme.cushion, -36)}" stroke-width="0.9" opacity="0.5"/>`
  );
  const mainBackFacesCamera = productPanelFacesCamera(piece, projection, 0, 1);
  const farStructuralPieces: SectionalProductSurface[] =
    capabilities.hasBackFrame && mainBackFacesCamera ? structuralRearPieces : [];
  const nearStructuralPieces: SectionalProductSurface[] =
    capabilities.hasBackFrame && !mainBackFacesCamera
      ? structuralRearPieces.map(entry => ({ ...entry, layer: 'near-back' }))
      : [];
  // Rotated return legs keep their loose back cushions whenever the back's
  // upholstered face looks toward the camera. The old blanket suppression hid
  // show-through from a since-removed independent second camera; with one
  // canonical camera the cushion is legitimately visible and its absence made
  // return legs read as bare benches. A curved (RB) back is TIGHT upholstered
  // back — no loose cushions at all (CS3B-RA-RB / CS1B-RA-RB refs).
  const visibleLooseBackPieces: SectionalProductSurface[] =
    capabilities.hasBackFrame &&
    capabilities.hasBackCushion &&
    mainBackFacesCamera &&
    style.back !== 'curved'
      ? looseRearPieces
      : [];
  if (capabilities.hasBackFrame) {
    // Shadowed well on the deck between the back frame and the cushions —
    // the strip light cannot reach. It is the strongest single cue that the
    // back assembly has real depth. Painted with the seat layer so it sits
    // above the deck face but below every cushion.
    seatSurface(
      'body',
      p(w / 2, rearY + (frameFront + cushionFront) / 2 - 7, bodyTop + 1),
      `<polygon class="sb-back-well-shadow" points="${productPolygon(projection, [
        p(leftContentInset + 2, rearY + frameFront - 1, bodyTop + 0.8),
        p(rightContentX - 2, rearY + frameFront - 1, bodyTop + 0.8),
        p(rightContentX - 2, rearY + cushionFront - 6, bodyTop + 0.8),
        p(leftContentInset + 2, rearY + cushionFront - 6, bodyTop + 0.8),
      ])}" fill="${shadeHex(theme.body, -40)}" opacity="0.5" stroke="none"/>`
    );
  }
  if (showLeftSide) {
    const fill = vGrad(
      shadeHex(theme.cushion, -7),
      shadeHex(theme.cushion, -22),
      p(leftContentInset, (seatRear + seatFront) / 2, seatTop),
      p(leftContentInset, (seatRear + seatFront) / 2, seatBottom)
    );
    seatSurface(
      'body',
      p(leftContentInset, (seatRear + tArmY) / 2, (seatBottom + seatTop) / 2),
      `<polygon class="sb-seat-cushion-side sb-seat-cushion-side-left" points="${cushionLeftSide}" fill="${fill}" stroke="${cushionLine}" stroke-width="1"/>`
    );
    if (tSeatActive) {
      const frontFill = vGrad(
        shadeHex(theme.cushion, -7),
        shadeHex(theme.cushion, -22),
        p(frontLeftX, (tArmY + seatFront) / 2, seatTop),
        p(frontLeftX, (tArmY + seatFront) / 2, seatBottom)
      );
      seatSurface(
        'body',
        p(frontLeftX, (tArmY + seatFront) / 2, (seatBottom + seatTop) / 2),
        `<polygon class="sb-seat-cushion-side sb-seat-cushion-front-left" points="${cushionFrontLeftSide}" fill="${frontFill}" stroke="${cushionLine}" stroke-width="1"/>`
      );
    }
  }
  if (showRightSide) {
    const fill = vGrad(
      shadeHex(theme.cushion, -3),
      shadeHex(theme.cushion, -17),
      p(rightContentX, (seatRear + seatFront) / 2, seatTop),
      p(rightContentX, (seatRear + seatFront) / 2, seatBottom)
    );
    seatSurface(
      'body',
      p(rightContentX, (seatRear + seatFront) / 2, (seatBottom + seatTop) / 2),
      `<polygon class="sb-seat-cushion-side sb-seat-cushion-side-right" points="${cushionRightSide}" fill="${fill}" stroke="${cushionLine}" stroke-width="1"/>`
    );
    if (tSeatActive) {
      const frontFill = vGrad(
        shadeHex(theme.cushion, -3),
        shadeHex(theme.cushion, -17),
        p(frontRightX, (tArmY + seatFront) / 2, seatTop),
        p(frontRightX, (tArmY + seatFront) / 2, seatBottom)
      );
      seatSurface(
        'body',
        p(frontRightX, (tArmY + seatFront) / 2, (seatBottom + seatTop) / 2),
        `<polygon class="sb-seat-cushion-side sb-seat-cushion-front-right" points="${cushionFrontRightSide}" fill="${frontFill}" stroke="${cushionLine}" stroke-width="1"/>`
      );
    }
  }
  if (frontFacesCamera) {
    seatSurface(
      'body',
      p(w / 2, seatFront, (seatBottom + seatTop) / 2),
      seatCushionFrontElement(1.1)
    );
    // Boundary seams close the cushion visually where it abuts a neighbour —
    // without them, flush fronts read as one open slab.
    if (frontConnected || localSideConnected('left') || localSideConnected('right')) {
      const seamTop = projection.point(p(w / 2, seatFront, seatTop - 1));
      const seamBottom = projection.point(p(w / 2, seatFront, seatBottom));
      const leftEdge = projection.point(p(frontLeftX, seatFront, (seatBottom + seatTop) / 2));
      const rightEdge = projection.point(p(frontRightX, seatFront, (seatBottom + seatTop) / 2));
      const seams: string[] = [];
      const vSeam = (edge: SectionalPoint, top: SectionalPoint) =>
        `M${edge.x.toFixed(1)} ${(top.y + 2).toFixed(1)}L${edge.x.toFixed(1)} ${seamBottom.y.toFixed(1)}`;
      if (localSideConnected('left')) seams.push(vSeam(leftEdge, seamTop));
      if (localSideConnected('right')) seams.push(vSeam(rightEdge, seamTop));
      if (seams.length) {
        seatSurface(
          'body',
          p(w / 2, seatFront, (seatBottom + seatTop) / 2),
          `<path class="sb-seat-cushion-boundary" d="${seams.join('')}" stroke="${shadeHex(theme.cushion, -44)}" stroke-width="1.1" opacity="0.6" fill="none"/>`
        );
      }
    }
    if (style.cushion === 'knife') {
      const seamA = projection.point(
        p(leftContentInset + 4, seatFront, (seatBottom + seatTop) / 2)
      );
      const seamB = projection.point(p(rightContentX - 4, seatFront, (seatBottom + seatTop) / 2));
      seatSurface(
        'body',
        p(w / 2, seatFront, (seatBottom + seatTop) / 2),
        `<path class="sb-seat-cushion-welt" d="M${seamA.x.toFixed(1)} ${seamA.y.toFixed(1)}L${seamB.x.toFixed(1)} ${seamB.y.toFixed(1)}" stroke="${shadeHex(theme.cushion, -34)}" stroke-width="0.9" opacity="0.55"/>`
      );
    }
    // Contact line where the cushion front meets the deck.
    const contactA = projection.point(p(frontLeftX + 1, seatFront, seatBottom));
    const contactB = projection.point(p(frontRightX - 1, seatFront, seatBottom));
    seatSurface(
      'body',
      p(w / 2, seatFront, seatBottom),
      `<path class="sb-seat-cushion-contact" d="M${contactA.x.toFixed(1)} ${contactA.y.toFixed(1)}L${contactB.x.toFixed(1)} ${contactB.y.toFixed(1)}" stroke="${shadeHex(theme.cushion, -52)}" stroke-width="1.6" opacity="0.45"/>`
    );
  } else if (!frontFacesCamera && !rearConnected) {
    const fill = vGrad(
      shadeHex(theme.cushion, -9),
      shadeHex(theme.cushion, -24),
      p(w / 2, seatRear, seatTop),
      p(w / 2, seatRear, seatBottom)
    );
    seatSurface(
      'body',
      p(w / 2, seatRear, (seatBottom + seatTop) / 2),
      `<polygon class="sb-seat-cushion-rear" points="${cushionRear}" fill="${fill}" stroke="${cushionLine}" stroke-width="1.1"/>`
    );
  }
  seatSurface(
    'body',
    p(w / 2, (seatRear + seatFront) / 2, seatTop),
    seatCushionTopElement(style.cushion === 'boxed' ? 1.3 : 1.1)
  );
  seatSurface('body', p(w / 2, (seatRear + seatFront) / 2, seatTop + 1), seatCushionCrownElement());
  seatSurface('body', p(w / 2, (seatRear + seatFront) / 2, seatTop + 2), seatCushionWeltElement());
  if (piece.kind === 'corner') {
    const returnStructuralBack = productPanelPath(
      projection,
      p(w - 8, rearY + frameFront, bodyTop),
      p(w - 8, frontY, bodyTop),
      p(w - 6, rearY + junctionTopInset, structuralBackTop),
      p(w - 6, frontY, structuralBackTop),
      style.back === 'curved'
    );
    const returnBackFill = vGrad(
      shadeHex(theme.body, -2),
      shadeHex(theme.body, -16),
      p(w - 7, d / 2, structuralBackTop),
      p(w - 7, d / 2, bodyTop)
    );
    const returnStructuralMarkup = withGradients(
      `<path class="sb-structural-back sb-corner-return-back" d="${returnStructuralBack}" fill="${returnBackFill}" stroke="${bodyStroke}" stroke-width="1.3"/>`
    );
    const returnInteriorFacesCamera = productPanelFacesCamera(piece, projection, -1, 0);
    // The return is viewed from its reverse side in one oblique angle.
    // Its structural shell must then close over the upholstery as a near face.
    const returnSurface: SectionalProductSurface = {
      layer: returnInteriorFacesCamera ? 'rear' : 'near-back',
      depthPoint: p(w - 7, d / 2, (bodyTop + structuralBackTop) / 2),
      markup: returnStructuralMarkup,
    };
    if (returnInteriorFacesCamera) {
      farStructuralPieces.push(returnSurface);
      // A real corner unit is furnished on both backs: the return leg leans a
      // loose cushion against the return frame, starting just past the main
      // back cushion so the two do not interpenetrate. A tight curved back
      // (RB) skips the loose cushion, matching the sofa row.
      if (style.back !== 'curved') {
        const returnCushionPath = productPanelPath(
          projection,
          p(w - 30, rearY + cushionFront, seatTop - 1),
          p(w - 30, frontY - 2, seatTop - 1),
          p(w - 14, rearY + cushionTopFront + 2, looseBackTop),
          p(w - 14, frontY - 4, looseBackTop),
          style.cushion === 'rounded'
        );
        const returnCushionCap = productPolygon(projection, [
          p(w - 14, rearY + cushionTopFront + 2, looseBackTop),
          p(w - 14, frontY - 4, looseBackTop),
          p(w - 9, frontY - 6, looseBackTop - 2),
          p(w - 9, rearY + cushionTopRear, looseBackTop - 2),
        ]);
        const returnCushionFill = vGrad(
          shadeHex(theme.cushion, 0),
          shadeHex(theme.cushion, -16),
          p(w - 14, d / 2, looseBackTop),
          p(w - 30, d / 2, seatTop)
        );
        visibleLooseBackPieces.push(
          {
            layer: 'rear',
            depthPoint: p(w - 17, d / 2, (seatTop + looseBackTop) / 2),
            markup: withGradients(
              `<path class="sb-back-cushion sb-corner-return-cushion" d="${returnCushionPath}" fill="${returnCushionFill}" stroke="${cushionLine}" stroke-width="1.2"/>`
            ),
          },
          {
            layer: 'rear',
            depthPoint: p(w - 12, d / 2, looseBackTop),
            markup: `<polygon class="sb-back-cushion-cap sb-corner-return-cushion-cap" points="${returnCushionCap}" fill="${shadeHex(theme.cushion, 4)}" stroke="${cushionLine}" stroke-width="1"/>`,
          }
        );
      }
    } else {
      nearStructuralPieces.push(returnSurface);
    }
  }
  const nearArmPieces: SectionalProductSurface[] = [];
  const farArmPieces: SectionalProductSurface[] = [];
  const buildArm = (armSide: SectionalArmSide): void => {
    // Two-arm modules (armchair, two-arm chaise) build one arm per side; the
    // shadowed `armPieces` target routes surfaces into the near/far paint
    // groups based on which side faces the camera.
    const armPieces = productPanelFacesCamera(piece, projection, armSide === 'left' ? -1 : 1, 0)
      ? nearArmPieces
      : farArmPieces;
    // The arm is modelled as a real extruded volume. Square is a tailored box
    // with a padded end panel, wedge a sloped box, and round a sock roll: a
    // half-cylinder bolster swept along the module depth whose end cap is a
    // true circle (the x-z plane projects undistorted), overhanging the arm
    // base the way a real roll arm does.
    const uX = (u: number) => (armSide === 'left' ? u : w - u);
    // The roll's round face stands a few pixels proud of the arm front, as in
    // the CW references. The rear tucks behind the back cushions.
    const rollFront = Math.min(frontY + 2.5, armFront + 3.5);
    const armLayer: SectionalProductSurface['layer'] = 'arm';
    const armFacesInterior = productArmInnerFacesCamera(piece, projection, armSide);
    const armFrontFacesCamera = productPanelFacesCamera(piece, projection, 0, 1);
    // Sock-roll geometry per CSAP-RA / CS3L-RA-HB: the roll is the dominant
    // volume — a fat cylinder whose mass leans outboard (centre pushed toward
    // the outer edge), riding a tall box so the arm crown reaches up toward
    // the back the way an Ektorp scroll does. The box top rises exactly to
    // the sweep's tuck line so slab and roll read as one continuous form.
    const rollCenterU = armThickness / 2 + 1.5;
    const rollRadius = 17;
    const rollCenterZ = 84;
    const rollBoxTop = rollCenterZ + rollRadius * Math.cos((150 * Math.PI) / 180);
    const squareProfile: Array<readonly [number, number]> = [
      [0, bodyTop],
      [armThickness, bodyTop],
      [armThickness, armTop],
      [0, armTop],
    ];
    const profileAt = (localY: number): Array<readonly [number, number]> => squareProfile;
    // End-cap path for the square arm: the two top corners are softly
    // rounded like a padded arm panel. Corner walking is direction-aware so
    // left- and right-arm (mirrored u) panels round identically.
    const endCapPath = (localY: number): string => {
      const pts = profileAt(localY).map(([u, z]) => projection.point(p(uX(u), localY, z)));
      const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      if (pts.length !== 4) return `M${pts.map(s).join('L')}Z`;
      const radius = 5;
      const toward = (from: SectionalPoint, to: SectionalPoint, dist: number): SectionalPoint => {
        const vx = to.x - from.x;
        const vy = to.y - from.y;
        const length = Math.hypot(vx, vy) || 1;
        return { x: from.x + (vx / length) * dist, y: from.y + (vy / length) * dist };
      };
      // pts order: 0 bottom-outer, 1 bottom-inner, 2 top-inner, 3 top-outer.
      const topIn = pts[2];
      const topOut = pts[3];
      const aIn = toward(topIn, pts[1], radius);
      const bIn = toward(topIn, topOut, radius);
      const aOut = toward(topOut, topIn, radius);
      const bOut = toward(topOut, pts[0], radius);
      return (
        `M${s(pts[0])}L${s(pts[1])}L${s(aIn)}Q${s(topIn)} ${s(bIn)}` +
        `L${s(aOut)}Q${s(topOut)} ${s(bOut)}Z`
      );
    };
    // Inner / outer vertical panels are mutually exclusive faces of the arm.
    const visiblePanelTop = (localY: number): number => {
      if (style.arm === 'round') return rollBoxTop;
      return armTop;
    };
    const panelU = armFacesInterior ? armThickness : 0;
    // The visible panel is always the camera-facing (west) face of the arm,
    // whether it is the near arm's outer skin or the far arm's inner skin.
    // Both have the same world normal, so both get the same gradient —
    // differing tones here made the far arm glow and pop in front.
    // The wedge builds its own slab below; its cross-section prism has no
    // full-depth vertical panel of this shape.
    if (style.arm !== 'wedge') {
      const visiblePanelPath = productPolygon(projection, [
        p(uX(panelU), armRear, bodyTop),
        p(uX(panelU), armFront, bodyTop),
        p(uX(panelU), armFront, visiblePanelTop(armFront)),
        p(uX(panelU), armRear, visiblePanelTop(armRear)),
      ]);
      const panelMidTop = (visiblePanelTop(armFront) + visiblePanelTop(armRear)) / 2;
      const panelFill = vGrad(
        shadeHex(theme.body, -2),
        shadeHex(theme.body, -20),
        p(uX(panelU), d / 2, panelMidTop),
        p(uX(panelU), d / 2, bodyTop)
      );
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(panelU), d / 2, (bodyTop + armTop) / 2),
        markup: withGradients(
          armFacesInterior
            ? `<polygon class="sb-arm-inner sb-arm-inner-${style.arm}" points="${visiblePanelPath}" fill="${panelFill}" stroke="${bodyStroke}" stroke-width="1.1" stroke-linejoin="round"/>`
            : `<polygon class="sb-arm-panel sb-arm-${style.arm}" points="${visiblePanelPath}" fill="${panelFill}" stroke="${bodyStroke}" stroke-width="1.2" stroke-linejoin="round"/>`
        ),
      });
    }
    if (style.arm === 'round') {
      // Contact shadow where the roll meets the arm's side panel: a soft band
      // on the panel face just under the roll line.
      const shadowStrip = productPolygon(projection, [
        p(uX(panelU), armRear, rollBoxTop - 7),
        p(uX(panelU), armFront, rollBoxTop - 7),
        p(uX(panelU), armFront, rollBoxTop),
        p(uX(panelU), armRear, rollBoxTop),
      ]);
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(panelU), d / 2, rollBoxTop - 3),
        markup: `<polygon class="sb-arm-roll-shadow" points="${shadowStrip}" fill="${shadeHex(theme.body, -36)}" opacity="0.4" stroke="none"/>`,
      });
      // Swept half-pipe: sample the circular arc from tuck-under to tuck-under
      // so the roll's lower edge disappears into the arm box, exactly like a
      // sock roll upholstered over its base. The wide wrap (±150°) leaves just
      // a waist where the roll meets the box, as in the CW round-arm refs. A
      // vertical user-space gradient shades crown-to-tuck across the cylinder,
      // never along its length.
      const arcAngles = [-150, -128, -106, -84, -62, -40, -18, 18, 40, 62, 84, 106, 128, 150];
      const arcPoint = (deg: number, localY: number): ProductPoint3D => {
        const theta = (deg * Math.PI) / 180;
        return p(
          uX(rollCenterU + rollRadius * Math.sin(theta)),
          localY,
          rollCenterZ + rollRadius * Math.cos(theta)
        );
      };
      const rollBodyPoints = [
        ...arcAngles.map(deg => arcPoint(deg, armRear)),
        ...arcAngles
          .slice()
          .reverse()
          .map(deg => arcPoint(deg, rollFront)),
      ];
      const rollMidY = (armRear + rollFront) / 2;
      const rollBodyFill = vGrad(
        shadeHex(theme.body, 18),
        shadeHex(theme.body, -40),
        p(uX(rollCenterU), rollMidY, rollCenterZ + rollRadius),
        p(uX(rollCenterU), rollMidY, rollBoxTop - 2)
      );
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(rollCenterU), d / 2, rollCenterZ + rollRadius / 2),
        markup: withGradients(
          `<polygon class="sb-arm-roll-body" points="${productPolygon(projection, rollBodyPoints)}" fill="${rollBodyFill}" stroke="${bodyStroke}" stroke-width="1.1" stroke-linejoin="round"/>`
        ),
      });
      // Core shadow on the cylinder's shadow side: without it the swept strip
      // reads as a flat ribbon, especially on the far arm seen end-on.
      const coreAngles = [-78, -58, -40];
      const corePoints = [
        ...coreAngles.map(deg => arcPoint(deg, armRear)),
        ...coreAngles
          .slice()
          .reverse()
          .map(deg => arcPoint(deg, rollFront)),
      ];
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(rollCenterU), d / 2, rollCenterZ - rollRadius / 3),
        markup: `<polygon class="sb-arm-roll-core" points="${productPolygon(projection, corePoints)}" fill="${shadeHex(theme.body, -34)}" opacity="0.4" stroke="none"/>`,
      });
      // Specular highlight along the crown (this strip carries the arm-cap
      // review token — a roll arm has no flat cap, its crown is the top).
      // Narrow and subtle: a wide pale band reads as a painted stripe.
      const highlightAngles = [-16, -5, 7, 18];
      const highlightPoints = [
        ...highlightAngles.map(deg => arcPoint(deg, armRear + 2)),
        ...highlightAngles
          .slice()
          .reverse()
          .map(deg => arcPoint(deg, rollFront - 2)),
      ];
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(rollCenterU), d / 2, rollCenterZ + rollRadius),
        markup: `<polygon class="sb-arm-cap sb-arm-roll-highlight" points="${productPolygon(projection, highlightPoints)}" fill="${shadeHex(theme.body, 22)}" opacity="0.45" stroke="none"/>`,
      });
      // Camera-facing end: the arm box end panel plus the roll's round face.
      // The circle sits proud of the box and reads as the classic letter-P
      // silhouette from either oblique angle.
      const endY = armFrontFacesCamera ? armFront : armRear;
      const rollEndY = armFrontFacesCamera ? rollFront : armRear;
      const baseEnd = productPolygon(projection, [
        p(uX(0), endY, bodyTop),
        p(uX(armThickness), endY, bodyTop),
        p(uX(armThickness), endY, rollBoxTop),
        p(uX(0), endY, rollBoxTop),
      ]);
      const baseEndFill = vGrad(
        shadeHex(theme.body, -6),
        shadeHex(theme.body, -22),
        p(uX(armThickness / 2), endY, rollBoxTop),
        p(uX(armThickness / 2), endY, bodyTop)
      );
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(armThickness / 2), endY, (bodyTop + rollBoxTop) / 2),
        markup: withGradients(
          `<polygon class="${armFrontFacesCamera ? 'sb-arm-base-front' : 'sb-arm-base-rear'}" points="${baseEnd}" fill="${baseEndFill}" stroke="${bodyStroke}" stroke-width="1.1" stroke-linejoin="round"/>`
        ),
      });
      // The end cap is a 3D circle sampled and projected, so perspective
      // foreshortens it into the correctly angled ellipse — never a flat
      // screen-space circle ignoring the camera.
      const discPath = (radius: number): string => {
        const pts: SectionalPoint[] = [];
        for (let deg = 0; deg < 360; deg += 10) {
          const theta = (deg * Math.PI) / 180;
          pts.push(
            projection.point(
              p(
                uX(rollCenterU + radius * Math.sin(theta)),
                rollEndY,
                rollCenterZ + radius * Math.cos(theta)
              )
            )
          );
        }
        return `M${pts.map(pt => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join('L')}Z`;
      };
      const circlePath = discPath(rollRadius);
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(rollCenterU), rollEndY, rollCenterZ),
        markup: armFrontFacesCamera
          ? `<path class="sb-arm-front sb-arm-front-round sb-arm-roll" d="${circlePath}" fill="url(#sbRollEnd)" stroke="${bodyStroke}" stroke-width="1.2"/>`
          : `<path class="sb-arm-rear sb-arm-rear-round sb-arm-roll" d="${circlePath}" fill="url(#sbRollEnd)" stroke="${bodyStroke}" stroke-width="1.2"/>`,
      });
      // Piped welt ring just inside the roll face — same projected ellipse.
      const weltPath = discPath(rollRadius - 4);
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(rollCenterU), rollEndY, rollCenterZ + 1),
        markup: `<path class="sb-arm-roll-welt" d="${weltPath}" fill="none" stroke="${shadeHex(theme.body, -40)}" stroke-width="1" opacity="0.5"/>`,
      });
    } else if (style.arm === 'wedge') {
      // CW wedge anatomy (Modular MT -WA template, CS1B-WA/CS3B-WA refs): the
      // wedge is a cross-section in the width-height plane — a tall rounded
      // outer edge, a short flat ledge at full height, then a concave slope
      // descending to the seat at the inner edge — and that cross-section is
      // the arm's front face. The depth is a straight extrusion of it, so the
      // side view shows level top edges, not a ramp. On chaise modules the
      // extrusion stops at the seat-depth end (the CS3L set-back arm).
      const wedgeArmTop = Math.min(structuralBackTop - 14, 118);
      const ledgeU = armThickness * 0.45;
      const wedgeNoseZ = seatTop + 6;
      // The slope descends toward the inner side: visible from the west
      // camera on a left arm, hidden on a right arm (and vice versa).
      const slopeFacesCamera = productPanelFacesCamera(
        piece,
        projection,
        armSide === 'left' ? -0.6 : 0.6,
        0
      );
      // Side slab: the near arm shows its tall outer skin; a far arm shows
      // the short inner wall below the slope's foot.
      if (!armFacesInterior) {
        const slabPath = productPolygon(projection, [
          p(uX(0), armRear, bodyTop),
          p(uX(0), armFront, bodyTop),
          p(uX(0), armFront, wedgeArmTop),
          p(uX(0), armRear, wedgeArmTop),
        ]);
        const slabFill = vGrad(
          shadeHex(theme.body, -2),
          shadeHex(theme.body, -20),
          p(uX(0), d / 2, wedgeArmTop),
          p(uX(0), d / 2, bodyTop)
        );
        armPieces.push({
          layer: armLayer,
          depthPoint: p(uX(0), d / 2, (bodyTop + wedgeArmTop) / 2),
          markup: withGradients(
            `<polygon class="sb-arm-panel sb-arm-wedge" points="${slabPath}" fill="${slabFill}" stroke="${bodyStroke}" stroke-width="1.2" stroke-linejoin="round"/>`
          ),
        });
      } else {
        const slabPath = productPolygon(projection, [
          p(uX(armThickness), armRear, bodyTop),
          p(uX(armThickness), armFront, bodyTop),
          p(uX(armThickness), armFront, wedgeNoseZ),
          p(uX(armThickness), armRear, wedgeNoseZ),
        ]);
        const slabFill = vGrad(
          shadeHex(theme.body, -2),
          shadeHex(theme.body, -20),
          p(uX(armThickness), d / 2, wedgeNoseZ),
          p(uX(armThickness), d / 2, bodyTop)
        );
        armPieces.push({
          layer: armLayer,
          depthPoint: p(uX(armThickness), d / 2, (bodyTop + wedgeNoseZ) / 2),
          markup: withGradients(
            `<polygon class="sb-arm-inner sb-arm-inner-wedge" points="${slabPath}" fill="${slabFill}" stroke="${bodyStroke}" stroke-width="1.1" stroke-linejoin="round"/>`
          ),
        });
      }
      if (slopeFacesCamera) {
        const slopePath = productPolygon(projection, [
          p(uX(ledgeU), armRear, wedgeArmTop),
          p(uX(armThickness), armRear, wedgeNoseZ),
          p(uX(armThickness), armFront, wedgeNoseZ),
          p(uX(ledgeU), armFront, wedgeArmTop),
        ]);
        const slopeFill = vGrad(
          shadeHex(theme.body, 4),
          shadeHex(theme.body, -22),
          p(uX((ledgeU + armThickness) / 2), d / 2, wedgeArmTop),
          p(uX((ledgeU + armThickness) / 2), d / 2, wedgeNoseZ)
        );
        armPieces.push({
          layer: armLayer,
          depthPoint: p(uX((ledgeU + armThickness) / 2), d / 2, (wedgeArmTop + wedgeNoseZ) / 2),
          markup: withGradients(
            `<polygon class="sb-arm-slope sb-wedge-slope" points="${slopePath}" fill="${slopeFill}" stroke="${bodyStroke}" stroke-width="1" stroke-linejoin="round"/>`
          ),
        });
      }
      // Flat ledge along the outer top — the arm-cap review token.
      const ledgePath = productPolygon(projection, [
        p(uX(0), armRear, wedgeArmTop),
        p(uX(ledgeU), armRear, wedgeArmTop),
        p(uX(ledgeU), armFront, wedgeArmTop),
        p(uX(0), armFront, wedgeArmTop),
      ]);
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(ledgeU / 2), d / 2, wedgeArmTop),
        markup: withGradients(
          `<polygon class="sb-arm-cap" points="${ledgePath}" fill="${shadeHex(theme.body, 8)}" stroke="${bodyStroke}" stroke-width="1.1" stroke-linejoin="round"/>`
        ),
      });
      // Camera-facing end: the wedge cross-section itself — rounded outer-top
      // corner, flat ledge, concave slope down to the nose at the seat.
      const endY = armFrontFacesCamera ? armFront : armRear;
      const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      const eA = projection.point(p(uX(0), endY, bodyTop));
      const eB = projection.point(p(uX(0), endY, wedgeArmTop - 8));
      const eC = projection.point(p(uX(0), endY, wedgeArmTop));
      const eD = projection.point(p(uX(ledgeU), endY, wedgeArmTop));
      const eE = projection.point(p(uX(armThickness), endY, wedgeNoseZ));
      const eF = projection.point(p(uX(armThickness), endY, bodyTop));
      const slopeCtrl = projection.point(
        p(uX(armThickness - 1), endY, wedgeNoseZ + (wedgeArmTop - wedgeNoseZ) * 0.32)
      );
      const endPath =
        `M${s(eA)}L${s(eB)}` + `Q${s(eC)} ${s(eD)}` + `Q${s(slopeCtrl)} ${s(eE)}` + `L${s(eF)}Z`;
      const endFill = vGrad(
        shadeHex(theme.body, -4),
        shadeHex(theme.body, -22),
        p(uX(armThickness / 2), endY, wedgeArmTop),
        p(uX(armThickness / 2), endY, bodyTop)
      );
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(armThickness / 2), endY, (bodyTop + wedgeArmTop) / 2),
        markup: withGradients(
          armFrontFacesCamera
            ? `<path class="sb-arm-front sb-arm-front-wedge" d="${endPath}" fill="${endFill}" stroke="${bodyStroke}" stroke-width="1.2" stroke-linejoin="round"/>`
            : `<path class="sb-arm-rear sb-arm-rear-wedge" d="${endPath}" fill="${endFill}" stroke="${bodyStroke}" stroke-width="1.2" stroke-linejoin="round"/>`
        ),
      });
    } else {
      const capFill = vGrad(
        shadeHex(theme.body, 12),
        shadeHex(theme.body, -2),
        p(uX(armThickness / 2), armRear, armTop),
        p(uX(armThickness / 2), armFront, armTop)
      );
      const capProfile = profileAt(armRear);
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(armThickness / 2), d / 2, armTop),
        markup: withGradients(
          `<polygon class="sb-arm-cap" points="${productPolygon(projection, [
            p(uX(capProfile[3][0]), armRear - 1, capProfile[3][1]),
            p(uX(capProfile[2][0]), armRear - 1, capProfile[2][1]),
            p(uX(capProfile[2][0]), armFront + 1.5, capProfile[2][1]),
            p(uX(capProfile[3][0]), armFront + 1.5, capProfile[3][1]),
          ])}" fill="${capFill}" stroke="${bodyStroke}" stroke-width="1.1" stroke-linejoin="round"/>`
        ),
      });
      // Camera-facing padded end panel with softly rounded top corners.
      const endY = armFrontFacesCamera ? armFront : armRear;
      const endFill = vGrad(
        shadeHex(theme.body, -6),
        shadeHex(theme.body, -22),
        p(uX(armThickness / 2), endY, armTop),
        p(uX(armThickness / 2), endY, bodyTop)
      );
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(armThickness / 2), endY, (bodyTop + armTop) / 2),
        markup: withGradients(
          armFrontFacesCamera
            ? `<path class="sb-arm-front sb-arm-front-square" d="${endCapPath(armFront)}" fill="${endFill}" stroke="${bodyStroke}" stroke-width="1.2" stroke-linejoin="round"/>`
            : `<path class="sb-arm-rear sb-arm-rear-square" d="${endCapPath(armRear)}" fill="${endFill}" stroke="${bodyStroke}" stroke-width="1.2" stroke-linejoin="round"/>`
        ),
      });
      // Welt trim inset on the visible side panel — the tailored seam that
      // furniture renders use to separate a panel from its padding. It lies
      // in the panel plane, inset from the panel edges.
      const weltInset = 4.5;
      const weltQuad = productPolygon(projection, [
        p(uX(panelU), armRear + weltInset, bodyTop + 4.5),
        p(uX(panelU), armFront - weltInset, bodyTop + 4.5),
        p(uX(panelU), armFront - weltInset, visiblePanelTop(armFront) - 4.5),
        p(uX(panelU), armRear + weltInset, visiblePanelTop(armRear) - 4.5),
      ]);
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(panelU), d / 2, (bodyTop + armTop) / 2),
        markup: `<polygon class="sb-arm-welt" points="${weltQuad}" fill="none" stroke="${shadeHex(theme.body, -34)}" stroke-width="0.9" opacity="0.45" stroke-linejoin="round"/>`,
      });
    }
  };
  armSides.forEach(buildArm);
  const attributes = `data-piece-id="${piece.id}" data-kind="${piece.kind}" data-rotation="${((piece.rotation % 360) + 360) % 360}" data-arm="${style.arm}" data-arm-extension="${armSides.length ? armThickness : 0}" data-seat-start="${seatLeftX}" data-seat-end="${seatRightX}" data-back="${style.back}" data-cushion="${style.cushion}" data-base="${style.base}"`;
  // Paint a module as physical anatomy rather than as unrelated polygons:
  // frame and loose back sit behind the upholstered base, the seat cushion
  // rests on top, and reverse-facing return shells close over that upholstery.
  // Under perspective the arm's place in that anatomy depends on which side of
  // the module it occupies: near-side arms are the final local occluders, but
  // far-side arms sit BEHIND their own module's cushions and back frame along
  // the sight line, so they must paint first or they cover upholstery they
  // should disappear behind. Two-arm modules get one arm in each group.
  // With a T-shaped seat the cushion's front segment sits IN FRONT of the
  // arms, so near arms must paint before the seat group and the cushion
  // legitimately occludes their lower front. Without a T the near arm stays
  // the final local occluder.
  const orderedModuleSurfaces = tSeatActive
    ? [
        ...farArmPieces,
        ...farStructuralPieces,
        ...visibleLooseBackPieces,
        ...bodySurfaces,
        ...nearArmPieces,
        ...seatSurfaces,
        ...nearStructuralPieces,
      ]
    : [
        ...farArmPieces,
        ...farStructuralPieces,
        ...visibleLooseBackPieces,
        ...bodySurfaces,
        ...seatSurfaces,
        ...nearStructuralPieces,
        ...nearArmPieces,
      ];
  const pieceSortDepth = projection.depth(p(w / 2, d / 2, bodyTop / 2));
  return orderedModuleSurfaces.map(entry => ({
    piece,
    layer: entry.layer,
    sortDepth: pieceSortDepth,
    markup: `<g class="sb-product-piece sb-product-layer-${entry.layer}" ${attributes}>${annotateSectionalProductPart(entry.markup, piece, entry.layer)}</g>`,
  }));
}

const SECTIONAL_REVIEW_PART_NAMES: Array<[string, string]> = [
  ['sb-arm-roll-highlight', 'arm roll crown'],
  ['sb-arm-roll-welt', 'arm roll welt'],
  ['sb-arm-base-rear', 'arm base rear'],
  ['sb-arm-welt', 'arm panel welt'],
  ['sb-back-cushion-welt', 'back cushion welt'],
  ['sb-back-cushion-crown', 'back cushion crown light'],
  ['sb-back-cushion-shadow', 'back cushion contact shadow'],
  ['sb-back-rim-light', 'back frame rim light'],
  ['sb-seat-cushion-crown', 'seat cushion crown'],
  ['sb-seat-cushion-welt-top', 'seat cushion top welt'],
  ['sb-seat-cushion-contact', 'seat cushion contact shadow'],
  ['sb-deck-shadow', 'deck shadow'],
  ['sb-arm-front', 'arm front'],
  ['sb-arm-rear', 'arm rear'],
  ['sb-arm-roll-body', 'arm roll body'],
  ['sb-arm-roll-band', 'arm roll band'],
  ['sb-arm-roll-shadow', 'arm roll shadow'],
  ['sb-arm-base-front', 'arm base front'],
  ['sb-arm-cap', 'arm top'],
  ['sb-arm-inner', 'inside arm panel'],
  ['sb-arm-panel', 'outside arm panel'],
  ['sb-corner-return-cushion-cap', 'corner return cushion top'],
  ['sb-corner-return-cushion', 'corner return cushion'],
  ['sb-back-cushion-cap', 'back cushion top'],
  ['sb-back-cushion-edge-left', 'back cushion left edge'],
  ['sb-back-cushion-edge-right', 'back cushion right edge'],
  ['sb-back-cushion', 'back cushion face'],
  ['sb-structural-back-cap', 'back frame top'],
  ['sb-structural-back-edge-left', 'back frame left edge'],
  ['sb-structural-back-edge-right', 'back frame right edge'],
  ['sb-corner-return-back', 'corner return back'],
  ['sb-structural-back', 'back frame face'],
  ['sb-back-well-shadow', 'back well shadow'],
  ['sb-seat-cushion-welt', 'seat cushion welt seam'],
  ['sb-seat-cushion-front', 'seat cushion front'],
  ['sb-seat-cushion-rear', 'seat cushion rear'],
  ['sb-seat-cushion-side-left', 'seat cushion left side'],
  ['sb-seat-cushion-side-right', 'seat cushion right side'],
  ['sb-seat-cushion', 'seat cushion top'],
  ['sb-body-front', 'base front'],
  ['sb-body-rear', 'base rear'],
  ['sb-body-side-left', 'base left side'],
  ['sb-body-side-right', 'base right side'],
  ['sb-body-skirt', 'base skirt'],
  ['sb-skirt-pleat', 'skirt pleat line'],
  ['sb-skirt-hem', 'skirt hem'],
  ['sb-body-leg', 'base leg'],
  ['sb-body', 'base top'],
];

function sectionalReviewPartName(classNames: string): string {
  const match = SECTIONAL_REVIEW_PART_NAMES.find(([className]) =>
    classNames.split(/\s+/).includes(className)
  );
  return match?.[1] || 'rendered face';
}

function annotateSectionalProductPart(
  markup: string,
  piece: SectionalPiece,
  layer: SectionalProductRenderLayer['layer']
): string {
  return markup.replace(
    /<(path|polygon) class="([^"]+)"/,
    (match, elementName: string, classNames: string) => {
      const partName = sectionalReviewPartName(classNames);
      const pieceName = PIECES[piece.kind].name;
      const reviewId = `${piece.id}:${layer}:${partName.replace(/\s+/g, '-')}`;
      return `<${elementName} class="${classNames}" role="img" aria-label="${pieceName}: ${partName}" data-sb-review-part="${reviewId}" data-sb-review-piece="${piece.id}" data-sb-review-kind="${piece.kind}" data-sb-review-layer="${layer}"`;
    }
  );
}

/**
 * Shared stage definitions for the product renderer: the studio backdrop, the
 * wooden leg ramp and the roll-end radial. Face shading uses per-surface
 * user-space gradients emitted by sectionalProductPieceLayers (bounding-box
 * ramps shade along a long quad's length — the old "water-slide" arms).
 */
function productStageDefs(theme: SectionalTheme): string {
  const b = theme.body;
  return `<defs><linearGradient id="sbStageBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e8edeb"/></linearGradient><linearGradient id="sbLegGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9c8264"/><stop offset="1" stop-color="#67513a"/></linearGradient><radialGradient id="sbRollEnd" cx="0.38" cy="0.34" r="0.85"><stop offset="0" stop-color="${shadeHex(b, 16)}"/><stop offset="0.55" stop-color="${shadeHex(b, -4)}"/><stop offset="1" stop-color="${shadeHex(b, -30)}"/></radialGradient><radialGradient id="sbGround" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#22302e" stop-opacity="0.3"/><stop offset="0.62" stop-color="#22302e" stop-opacity="0.12"/><stop offset="1" stop-color="#22302e" stop-opacity="0"/></radialGradient></defs>`;
}

/**
 * Drawn measurement annotations for the 2.5D product view — the PDF-style
 * dimension lines (A-widths across the front, D depth along the side, G/H
 * heights at the corners), projected through the same camera as the sofa.
 * Width/depth codes are editable: editing one rescales the assembly.
 */
const PRODUCT_VERTICAL_CM_PER_PX = 0.7576;

function buildProductDimensionMarkup(
  pieces: SectionalPiece[],
  projection: ProductProjection,
  layout: ProductLayout
): string {
  if (!pieces.length) return '';
  const placements = pieces
    .map(piece => ({ piece, placement: layout.get(piece.id) }))
    .filter(entry => entry.placement);
  if (!placements.length) return '';

  const minX = Math.min(...placements.map(entry => entry.placement!.originX));
  const maxX = Math.max(
    ...placements.map(entry => entry.placement!.originX + entry.placement!.effectiveW)
  );
  const minY = Math.min(...placements.map(entry => entry.placement!.originY));
  const maxY = Math.max(
    ...placements.map(entry => entry.placement!.originY + entry.placement!.effectiveH)
  );
  const cmPerPxH = 1 / PRODUCT_PX_PER_CM;

  const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  const dimLine = (
    a: ProductPoint3D,
    b: ProductPoint3D,
    offsetDx: number,
    offsetDy: number,
    code: string,
    valueCm: number,
    editable: boolean
  ): string => {
    const pa = projection.point(a);
    const pb = projection.point(b);
    const x1 = pa.x + offsetDx;
    const y1 = pa.y + offsetDy;
    const x2 = pb.x + offsetDx;
    const y2 = pb.y + offsetDy;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    const tick = 5;
    const ticks = horizontal
      ? `<line class="sb-dim-tick" x1="${x1.toFixed(1)}" y1="${(y1 - tick).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${(y1 + tick).toFixed(1)}"/><line class="sb-dim-tick" x1="${x2.toFixed(1)}" y1="${(y2 - tick).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y2 + tick).toFixed(1)}"/>`
      : `<line class="sb-dim-tick" x1="${(x1 - tick).toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x1 + tick).toFixed(1)}" y2="${y1.toFixed(1)}"/><line class="sb-dim-tick" x1="${(x2 - tick).toFixed(1)}" y1="${y2.toFixed(1)}" x2="${(x2 + tick).toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    const labelX = horizontal ? midX : x1 + 6;
    const labelY = horizontal ? y1 - 6 : midY;
    const anchor = horizontal ? 'middle' : 'start';
    return `<g class="sb-dim${editable ? ' sb-dim-editable' : ''}" data-code="${escapeAttr(code)}" data-value-cm="${valueCm.toFixed(1)}" data-editable="${editable}">
      ${ticks}<line class="sb-dim-line" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>
      <text class="sb-dim-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${anchor}">${escapeAttr(code)} · ${Math.round(valueCm)} cm</text>
    </g>`;
  };

  const dims: string[] = [];

  // Per-module widths along the front (A3, A4, …).
  const cols = new Map<number, { x0: number; x1: number; widthCm: number }>();
  placements.forEach(({ piece, placement }) => {
    const entry = cols.get(piece.col) || {
      x0: placement!.originX,
      x1: placement!.originX + placement!.effectiveW,
      widthCm: getPieceDimensions(piece).width,
    };
    entry.x0 = Math.min(entry.x0, placement!.originX);
    entry.x1 = Math.max(entry.x1, placement!.originX + placement!.effectiveW);
    cols.set(piece.col, entry);
  });
  Array.from(cols.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([col, entry], index) => {
      dims.push(
        dimLine(
          { x: entry.x0, y: maxY, z: 0 },
          { x: entry.x1, y: maxY, z: 0 },
          0,
          16,
          `A${index + 3}`,
          entry.widthCm,
          true
        )
      );
    });

  // Overall width (A1), furthest out.
  dims.push(
    dimLine(
      { x: minX, y: maxY, z: 0 },
      { x: maxX, y: maxY, z: 0 },
      0,
      48,
      'A1',
      (maxX - minX) * cmPerPxH,
      true
    )
  );

  // Inner seat span (B1): between the arm inner edges on the front row.
  const frontRow = minY; // front row starts at the rear line
  const frontPieces = placements.filter(
    ({ piece, placement }) => piece.row === 0 || placement!.originY === minY
  );
  const hasLeftArm = frontPieces.some(
    ({ piece }) =>
      piece.kind === 'left-arm' ||
      piece.kind === 'left-arm-chaise' ||
      piece.kind === 'armchair' ||
      piece.kind === 'two-arm-chaise'
  );
  const hasRightArm = frontPieces.some(
    ({ piece }) =>
      piece.kind === 'right-arm' ||
      piece.kind === 'right-arm-chaise' ||
      piece.kind === 'armchair' ||
      piece.kind === 'two-arm-chaise'
  );
  if (hasLeftArm && hasRightArm) {
    const armThickness = 29;
    const leftArmX = Math.min(
      ...frontPieces
        .filter(
          ({ piece }) =>
            piece.kind === 'left-arm' ||
            piece.kind === 'left-arm-chaise' ||
            piece.kind === 'armchair' ||
            piece.kind === 'two-arm-chaise'
        )
        .map(({ placement }) => placement!.originX)
    );
    const rightArmX = Math.max(
      ...frontPieces
        .filter(
          ({ piece }) =>
            piece.kind === 'right-arm' ||
            piece.kind === 'right-arm-chaise' ||
            piece.kind === 'armchair' ||
            piece.kind === 'two-arm-chaise'
        )
        .map(({ placement }) => placement!.originX + placement!.effectiveW)
    );
    dims.push(
      dimLine(
        { x: leftArmX + armThickness, y: maxY, z: 0 },
        { x: rightArmX - armThickness, y: maxY, z: 0 },
        0,
        32,
        'B1',
        (rightArmX - armThickness - (leftArmX + armThickness)) * cmPerPxH,
        false
      )
    );
  }

  // Depth (D) along the right side.
  dims.push(
    dimLine(
      { x: maxX, y: minY, z: 0 },
      { x: maxX, y: maxY, z: 0 },
      30,
      0,
      'D',
      (maxY - minY) * cmPerPxH,
      true
    )
  );

  // Heights at the left corner: G1 back height (rear) and H1 seat height (front).
  const backTopPx = 126;
  const seatTopPx = 60;
  dims.push(
    dimLine(
      { x: minX, y: minY, z: 0 },
      { x: minX, y: minY, z: backTopPx },
      -26,
      0,
      'G1',
      backTopPx * PRODUCT_VERTICAL_CM_PER_PX,
      false
    )
  );
  dims.push(
    dimLine(
      { x: minX, y: maxY, z: 0 },
      { x: minX, y: maxY, z: seatTopPx },
      -26,
      0,
      'H1',
      seatTopPx * PRODUCT_VERTICAL_CM_PER_PX,
      false
    )
  );

  return `<g class="sb-product-dims">${dims.join('')}</g>`;
}

export function sectionalProductMarkup(
  pieces: SectionalPiece[],
  viewMode: Exclude<SectionalViewMode, 'plan'> = 'front-left',
  themeId: SectionalThemeId = DEFAULT_THEME,
  fallbackStyle: SectionalProductStyle = DEFAULT_SECTIONAL_PRODUCT_STYLE
): string {
  if (!pieces.length) {
    return '<text x="460" y="310" text-anchor="middle" class="sb-product-empty">Add pieces to preview the sofa</text>';
  }
  const layout = createProductLayout(pieces);
  // Build one physically authoritative product angle. The opposite angle is a
  // literal mirror of the finished render, so painter order and face culling
  // cannot diverge and make the same sofa appear to have different anatomy.
  const projection = productProjection(pieces, 'front-right', layout);
  // A curved back is one arc across the whole assembly, never per-module
  // scallops — compute the shared lift before any module renders. The arc
  // only makes sense on a single straight row (2/3-seat sofas): sectionals
  // with returns or multi-row layouts keep straight module backs.
  const effectiveBack = fallbackStyle.back;
  const isSingleStraightRow =
    pieces.every(piece => piece.rotation % 360 === 0) &&
    new Set(pieces.map(piece => piece.row)).size <= 1;
  if (effectiveBack === 'curved' && isSingleStraightRow) {
    applyUniformBackCurve(pieces, layout);
  }
  const theme = SECTIONAL_THEMES[themeId] || SECTIONAL_THEMES[DEFAULT_THEME];
  const connections = evaluateSectionalConnections(pieces);
  const layerRank: Record<SectionalProductRenderLayer['layer'], number> = {
    rear: 0,
    body: 1,
    'near-back': 2,
    arm: 3,
  };
  const ordered = pieces
    .flatMap((piece, pieceIndex) =>
      sectionalProductPieceLayers(piece, projection, layout, theme, fallbackStyle, connections).map(
        (entry, surfaceIndex) => ({ ...entry, pieceIndex, surfaceIndex })
      )
    )
    .sort((a, b) => {
      // Keep every module anatomically intact. Sorting independent polygons by
      // sampled depth allowed another module to be inserted between a base,
      // cushion and back. Modules now paint far-to-near, while surfaceIndex
      // preserves the deliberate local anatomy order above.
      const depthDiff = a.sortDepth - b.sortDepth;
      if (Math.abs(depthDiff) > 0.001) return depthDiff;
      const pieceDiff = a.pieceIndex - b.pieceIndex;
      if (pieceDiff) return pieceDiff;
      const layerDiff = layerRank[a.layer] - layerRank[b.layer];
      return a.surfaceIndex - b.surfaceIndex || layerDiff;
    });
  // Ground the assembly with a soft contact shadow computed from the actual
  // projected footprint, not a fixed ellipse that drifts off the furniture.
  const groundPoints: SectionalPoint[] = pieces.flatMap(piece => {
    const footprint = layout.get(piece.id) || unrotatedFootprint(piece);
    const w = footprint.bodyW;
    const d = footprint.bodyH;
    return [
      projection.point(sectionalPiecePoint(piece, 0, 0, 0, layout)),
      projection.point(sectionalPiecePoint(piece, w, 0, 0, layout)),
      projection.point(sectionalPiecePoint(piece, w, d, 0, layout)),
      projection.point(sectionalPiecePoint(piece, 0, d, 0, layout)),
    ];
  });
  const groundMinX = Math.min(...groundPoints.map(point => point.x));
  const groundMaxX = Math.max(...groundPoints.map(point => point.x));
  const groundY = Math.max(...groundPoints.map(point => point.y));
  const shadowCx = (groundMinX + groundMaxX) / 2;
  const shadowRx = Math.max(60, (groundMaxX - groundMinX) * 0.54);
  const groundShadow =
    `<ellipse cx="${shadowCx.toFixed(1)}" cy="${(groundY + 10).toFixed(1)}" rx="${shadowRx.toFixed(1)}" ry="16" fill="url(#sbGround)"/>` +
    `<ellipse cx="${shadowCx.toFixed(1)}" cy="${(groundY + 5).toFixed(1)}" rx="${(shadowRx * 0.82).toFixed(1)}" ry="8" fill="url(#sbGround)" opacity="0.7"/>`;
  const mirrorTransform =
    viewMode === 'front-left' ? ' transform="translate(920 0) scale(-1 1)"' : '';
  return `<g class="sb-product-view" data-section-view="${viewMode}" data-canonical-view="front-right"${mirrorTransform}>${productStageDefs(theme)}<rect x="0" y="0" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" fill="url(#sbStageBg)"/>${groundShadow}<g>${ordered
    .map(entry => entry.markup)
    .join('')}</g>${buildProductDimensionMarkup(pieces, projection, layout)}</g>`;
}

export function serializeSectionalProductSvg(
  pieces: SectionalPiece[],
  title = 'Custom sectional',
  viewMode: Exclude<SectionalViewMode, 'plan'> = 'front-left',
  themeId: SectionalThemeId = DEFAULT_THEME,
  fallbackStyle: SectionalProductStyle = DEFAULT_SECTIONAL_PRODUCT_STYLE
): string {
  const viewLabel = viewMode === 'front-left' ? 'Left 45°' : 'Right 45°';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}"><rect width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" fill="#f7f8f7"/><style>.sb-product-empty{font:600 16px Arial,sans-serif;fill:#71807f}.sb-product-title{font:700 17px Arial,sans-serif;fill:#253132}.sb-product-subtitle{font:500 11px Arial,sans-serif;fill:#71807f}</style>${sectionalProductMarkup(pieces, viewMode, themeId, fallbackStyle)}<text x="36" y="44" class="sb-product-title">${title}</text><text x="36" y="64" class="sb-product-subtitle">${viewLabel} product view</text></svg>`;
}

export function serializeSectionalSvg(
  pieces: SectionalPiece[],
  title = 'Custom sectional',
  themeId: SectionalThemeId = DEFAULT_THEME
): string {
  const theme = SECTIONAL_THEMES[themeId] || SECTIONAL_THEMES[DEFAULT_THEME];
  const bounds = calculateSectionalBounds(pieces);
  const report = evaluateSectionalConnections(pieces);
  const dimensions = sectionalDimensionsMarkup(pieces);
  const content = pieces.map(piece => pieceMarkup(piece, false, true, report, theme)).join('');
  const minCol = pieces.length ? Math.min(...pieces.map(piece => piece.col)) : 0;
  const maxCol = pieces.length ? Math.max(...pieces.map(piece => piece.col)) : 0;
  const minRow = pieces.length ? Math.min(...pieces.map(piece => piece.row)) : 0;
  const maxRow = pieces.length ? Math.max(...pieces.map(piece => piece.row)) : 0;
  const viewBox = getSectionalPlanViewBox(pieces);
  const viewX = viewBox.x;
  const viewY = viewBox.y;
  const viewWidth = viewBox.width;
  const assemblyHeight = Math.max(170, (maxRow - minRow + 1) * CELL + 62);
  const viewHeight = viewBox.height;
  const labelX = viewX + viewWidth / 2;
  const labelY = viewY + assemblyHeight + 84;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}"><rect x="${viewX}" y="${viewY}" width="${viewWidth}" height="${viewHeight}" fill="#ffffff"/><style>.sb-piece-label{font:600 15px Arial,sans-serif;fill:#253132;letter-spacing:0}.sb-dimension{font:600 17px Arial,sans-serif;fill:#24323a;letter-spacing:0}.sb-connector{fill:#ffffff;stroke:#7a8886;stroke-width:1.5}.sb-connector.is-connected{fill:#198b71;stroke:#126654}.sb-connector.is-conflict{fill:#c2402f;stroke:#9c2f21}.sb-dimline{stroke:#8a9795;stroke-width:1.25;fill:none}.sb-dimtext{fill:#5f6d6c;font:600 11px Arial,sans-serif;text-anchor:middle}.sb-dimtext-overall{fill:#24323a;font-size:12.5px}</style>${dimensions}${content}<text x="${labelX}" y="${labelY}" text-anchor="middle" class="sb-dimension">${title}</text><text x="${labelX}" y="${labelY + 27}" text-anchor="middle" class="sb-dimension">${bounds.width} × ${bounds.depth} cm</text></svg>`;
}

function svgToPngFile(svg: string, filename = 'sectional-layout.png'): Promise<File> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1000;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas export is unavailable'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        output => {
          if (!output) reject(new Error('Could not render sectional'));
          else resolve(new File([output], filename, { type: 'image/png' }));
        },
        'image/png',
        0.96
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not render sectional'));
    };
    image.src = url;
  });
}

/**
 * Canonical single-module plan: rotation normalized to 0 so each module is
 * measured in its own frame. Mirroring is preserved because left- and
 * right-arm units are different SKUs.
 */
export function normalizeModulePiece(piece: SectionalPiece): SectionalPiece {
  return { ...piece, col: 0, row: 0, rotation: 0 };
}

/**
 * Plan-view pictograms for the piece library — the same top-down language as
 * professional space planners: body outline, back rail band, seat inset and
 * arm/chaise silhouettes, instead of cryptic text abbreviations.
 */
function libraryIconSvg(kind: PieceKind): string {
  const body = '#d3dcd6';
  const cushion = '#ffffff';
  const rail = '#93a29a';
  const line = '#5f6e66';
  const r = (x: number, y: number, w: number, h: number, rx: number, fill: string, sw = 1.4) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${line}" stroke-width="${sw}"/>`;
  const pad = (x: number, y: number, wdt: number, hgt: number) =>
    `<rect x="${x}" y="${y}" width="${wdt}" height="${hgt}" rx="2.5" fill="${cushion}" stroke="${rail}" stroke-width="1"/>`;
  const backRail = (x: number, y: number, wdt: number) =>
    `<rect x="${x}" y="${y}" width="${wdt}" height="5.5" rx="2.2" fill="${rail}" stroke="none"/>`;
  const sideRail = (x: number, y: number, hgt: number) =>
    `<rect x="${x}" y="${y}" width="5.5" height="${hgt}" rx="2.2" fill="${rail}" stroke="none"/>`;
  const armPill = (x: number, y: number, hgt: number) => r(x, y, 8, hgt, 3.5, '#bcc8c0');
  let inner = '';
  switch (kind) {
    case 'left-arm':
      inner =
        r(10, 4, 33, 32, 4, body) +
        backRail(12, 6.5, 29) +
        armPill(3.5, 7, 27) +
        pad(14, 15, 24, 17);
      break;
    case 'right-arm':
      inner =
        r(5, 4, 33, 32, 4, body) +
        backRail(7, 6.5, 29) +
        armPill(36.5, 7, 27) +
        pad(10, 15, 24, 17);
      break;
    case 'seat':
      inner = r(7, 4, 34, 32, 4, body) + backRail(9, 6.5, 30) + pad(11, 15, 26, 17);
      break;
    case 'corner':
      inner =
        r(6, 4, 36, 34, 4, body) +
        backRail(8, 6.5, 32) +
        sideRail(33.5, 9, 25) +
        pad(11, 15, 17, 19);
      break;
    case 'chaise':
      inner = r(13, 3, 22, 37, 4, body) + backRail(15, 5, 18) + pad(17, 13, 14, 24);
      break;
    case 'ottoman':
      inner = r(8, 10, 32, 22, 4, body) + pad(12, 13.5, 24, 15);
      break;
    case 'left-arm-chaise':
      inner =
        r(11, 3, 26, 37, 4, body) + backRail(13, 5, 22) + armPill(6, 5.5, 22) + pad(15, 13, 18, 24);
      break;
    case 'right-arm-chaise':
      inner =
        r(11, 3, 26, 37, 4, body) +
        backRail(13, 5, 22) +
        armPill(34, 5.5, 22) +
        pad(15, 13, 18, 24);
      break;
    case 'armchair':
      inner =
        r(8, 4, 36, 32, 4, body) +
        backRail(10, 6.5, 32) +
        armPill(3.5, 7, 27) +
        armPill(40.5, 7, 27) +
        pad(14, 15, 24, 17);
      break;
    case 'two-arm-chaise':
      inner =
        r(10, 3, 30, 37, 4, body) +
        backRail(12, 5, 26) +
        armPill(5, 5.5, 22) +
        armPill(41, 5.5, 22) +
        pad(15, 13, 20, 24);
      break;
  }
  return `<svg viewBox="0 0 48 42" width="46" height="40" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function dialogMarkup(): string {
  const library = (Object.keys(PIECES) as PieceKind[])
    .map(
      kind =>
        `<button type="button" class="sb-library-item" draggable="true" data-piece-kind="${kind}"><span class="sb-library-icon">${libraryIconSvg(kind)}</span><span><strong>${PIECES[kind].name}</strong><small>${PIECES[kind].width} × ${PIECES[kind].depth} cm</small></span><span class="sb-add-symbol" aria-hidden="true">+</span></button>`
    )
    .join('');
  return `<dialog id="sectionalBuilderDialog" class="sectional-builder-dialog">
    <div class="sb-shell">
      <header class="sb-header"><div><span class="sb-eyebrow">Assembly workspace</span><h2>Sectional Builder</h2></div><div class="sb-presets" aria-label="Assembly presets"><span>Start with</span><button type="button" data-sb-preset="sofa">3-seat</button><button type="button" data-sb-preset="two-seat">2-seat</button><button type="button" data-sb-preset="chaise">Chaise</button><button type="button" data-sb-preset="corner">L-shape</button><button type="button" data-sb-preset="l-chaise">L+Chaise</button><button type="button" data-sb-preset="ottoman-set">+Ottoman</button><button type="button" data-sb-preset="armchair">Armchair</button><button type="button" data-sb-preset="two-arm-chaise">2-Arm Chaise</button></div><button type="button" class="sb-close" data-sb-close aria-label="Close sectional builder">×</button></header>
      <div class="sb-body">
        <aside class="sb-library"><div class="sb-panel-heading"><h3>Pieces</h3><span>Click or drag to add</span></div>${library}</aside>
        <main class="sb-stage"><div class="sb-stage-toolbar"><div><strong id="sbAssemblyName">Custom sectional</strong><span id="sbPieceCount">0 pieces</span></div><div class="sb-view-switch" role="tablist" aria-label="Sectional view"><button type="button" role="tab" data-sb-view="plan" aria-selected="true">Plan</button><button type="button" role="tab" data-sb-view="front-left" aria-selected="false">Left 45°</button><button type="button" role="tab" data-sb-view="front-right" aria-selected="false">Right 45°</button></div><div class="sb-toolbar-side"><div class="sb-swatches" role="radiogroup" aria-label="Fabric colour">${(
          Object.keys(SECTIONAL_THEMES) as SectionalThemeId[]
        )
          .map(
            id =>
              `<button type="button" class="sb-swatch" role="radio" aria-checked="false" data-sb-theme="${id}" title="${SECTIONAL_THEMES[id].name}" style="--swatch-body:${SECTIONAL_THEMES[id].body};--swatch-cushion:${SECTIONAL_THEMES[id].cushion};--swatch-accent:${SECTIONAL_THEMES[id].accent}"></button>`
          )
          .join(
            ''
          )}</div><button type="button" class="sb-quiet-button" data-sb-undo title="Undo (Ctrl+Z)" disabled>Undo</button><button type="button" class="sb-quiet-button" data-sb-redo title="Redo (Ctrl+Shift+Z)" disabled>Redo</button><button type="button" class="sb-quiet-button" data-sb-clear>Clear</button></div></div><svg id="sbBoard" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" aria-label="Sectional assembly board"><defs><pattern id="sbGrid" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse"><path d="M ${CELL} 0 L 0 0 0 ${CELL}" fill="none" stroke="#dce2e1" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="#f8faf9"/><g id="sbPlanView"><rect x="${GRID_ORIGIN_X}" y="${GRID_ORIGIN_Y}" width="660" height="462" fill="url(#sbGrid)"/><g id="sbDimensions"></g><g id="sbGuides"></g><g id="sbPieces"></g><g id="sbSnapPreview"></g></g><g id="sbProductPreview" class="sb-product-preview" hidden></g></svg></main>
        <aside class="sb-inspector"><div class="sb-panel-heading"><h3>Assembly</h3><span id="sbViewLabel">Plan view</span></div><div class="sb-metrics"><div><span>Pieces</span><strong id="sbMetricPieces">0</strong></div><div><span>Width</span><strong id="sbMetricWidth">0 cm</strong></div><div><span>Depth</span><strong id="sbMetricDepth">0 cm</strong></div></div><div id="sbMeasurementChecks" class="sb-measurement-checks" aria-label="Measurement checks"></div><div class="sb-model-controls" aria-label="Product model"><label><span>Arm profile</span><select id="sbArmStyle"><option value="round">Round roll arm</option><option value="square">Square arm</option><option value="wedge">Wedge arm</option></select></label><label><span>Arm length</span><select id="sbArmLength"><option value="full">Full seat length</option><option value="half">Half (set back)</option></select></label><label><span>Back frame</span><select id="sbBackStyle"><option value="high">High box back</option><option value="short">Short box back</option><option value="curved">Rounded back</option></select></label><label><span>Loose cushions</span><select id="sbCushionStyle"><option value="boxed">Boxed edge</option><option value="knife">Knife edge</option><option value="rounded">Rounded front</option></select></label><label><span>Cushion fit</span><select id="sbBackCushionFit"><option value="straight">Straight (between arms)</option><option value="wrap">Wrap arms (T · L)</option></select></label><label><span>Base / skirt</span><select id="sbBaseStyle"><option value="snug">Snug fit</option><option value="long-skirt">Long skirt</option><option value="loose-fit">Cornered pleats</option><option value="straight-skirt">Straight skirt</option></select></label></div><div id="sbSelectionInspector" class="sb-selection-inspector is-empty"><span class="sb-eyebrow">Selected piece</span><h3 id="sbSelectedName">Select a piece</h3><p id="sbSelectedSize">Drag pieces on the board to arrange them.</p><div class="sb-inspector-actions"><button type="button" data-sb-action="rotate">Rotate</button><button type="button" data-sb-action="mirror">Mirror</button><button type="button" data-sb-action="duplicate">Duplicate</button><button type="button" class="is-danger" data-sb-action="delete">Delete</button></div></div><div class="sb-handoff"><button type="button" data-sb-3d>Edit in 3D</button><p>Keep the plan editable, or add the selected product angle as a normal SofaPaint image.</p><label class="sb-modules-toggle"><input type="checkbox" id="sbIncludeModules" checked /><span>Also create a measured view per module</span></label><button type="button" class="sb-primary" data-sb-use>Use plan in project</button><button type="button" class="sb-secondary" data-sb-use-product hidden>Add selected product view</button><button type="button" class="sb-secondary" data-sb-update hidden>Update project image</button><button type="button" class="sb-secondary" data-sb-sync-canvas hidden title="Read piece positions from the canvas back into the builder">Sync from canvas</button></div><div class="sb-pricing"><div class="sb-panel-heading"><h3>Pricing</h3><span>CW unbranded</span></div><div class="sb-pricing-filters"><label><span>Country</span><select id="sbPricingCountry">${(Object.entries(SECTIONAL_PRICING_MARKETS) as [SectionalPricingCountry, SectionalPricingMarket][]).map(([id, market]) => `<option value="${id}"${id === DEFAULT_PRICING_COUNTRY ? ' selected' : ''}>${market.country} · ${market.currency}</option>`).join('')}</select></label><label><span>Fabric</span><select id="sbPricingFabric">${(Object.entries(SECTIONAL_PRICING_FABRICS) as [SectionalPricingFabric, string][]).map(([id, label]) => `<option value="${id}"${id === DEFAULT_PRICING_FABRIC ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div><p id="sbPricingStatus" class="sb-pricing-status">Current US storefront prices</p><div id="sbPricingList"></div><div class="sb-pricing-total"><span>Estimated total</span><strong id="sbPricingTotal">—</strong></div><button type="button" class="sb-pricing-copy" data-sb-copy-pricing>Copy all links</button></div></aside>
      </div>
    </div>
  </dialog>`;
}

function createBlankPng(filename = 'sectional-layout.png'): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas unavailable'));
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1600, 1000);
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('Could not create background'));
      else resolve(new File([blob], filename, { type: 'image/png' }));
    }, 'image/png');
  });
}

/**
 * Build a fabric.Group for a single sectional piece. Children are created at
 * SVG-pixel coordinates; the caller positions and scales the group into world
 * space. Each group carries baseWidthCm/baseDepthCm and initialScale for the
 * parametric measurement system.
 */
export function createPieceFabricGroup(
  piece: SectionalPiece,
  theme: SectionalTheme,
  assemblyId: string
): any {
  const unrot = unrotatedFootprint(piece);
  const w = unrot.bodyW;
  const h = unrot.bodyH;
  const spec = PIECES[piece.kind];
  const armEnd = Math.round(17 + ((h - 39) * 2) / 3);
  const children: any[] = [];

  children.push(
    new fabric.Rect({
      left: 6,
      top: 7,
      width: w - 12,
      height: h - 14,
      rx: 4,
      fill: theme.body,
      stroke: theme.outline,
      strokeWidth: 3,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
    })
  );

  if (piece.kind === 'corner') {
    children.push(
      new fabric.Rect({
        left: 17,
        top: 29,
        width: w - 49,
        height: h - 57,
        rx: 3,
        fill: theme.cushion,
        stroke: theme.cushionStroke,
        strokeWidth: 2,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    children.push(
      new fabric.Rect({
        left: 16,
        top: 12,
        width: w - 32,
        height: 10,
        rx: 2,
        fill: theme.accent,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    children.push(
      new fabric.Rect({
        left: w - 22,
        top: 25,
        width: 10,
        height: h - 41,
        rx: 2,
        fill: theme.accent,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
  } else if (piece.kind === 'chaise') {
    children.push(
      new fabric.Rect({
        left: 16,
        top: 30,
        width: w - 32,
        height: h - 49,
        rx: 3,
        fill: theme.cushion,
        stroke: theme.cushionStroke,
        strokeWidth: 2,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    children.push(
      new fabric.Rect({
        left: 16,
        top: 16,
        width: w - 32,
        height: 8,
        rx: 2,
        fill: theme.accent,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
  } else if (piece.kind === 'left-arm-chaise') {
    children.push(
      new fabric.Rect({
        left: 22,
        top: 30,
        width: w - 38,
        height: h - 49,
        rx: 3,
        fill: theme.cushion,
        stroke: theme.cushionStroke,
        strokeWidth: 2,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    children.push(
      new fabric.Rect({
        left: 16,
        top: 16,
        width: w - 32,
        height: 8,
        rx: 2,
        fill: theme.accent,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    children.push(
      new fabric.Rect({
        left: 1,
        top: 17,
        width: 14,
        height: armEnd - 17,
        rx: 2,
        fill: theme.accent,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
  } else if (piece.kind === 'right-arm-chaise') {
    children.push(
      new fabric.Rect({
        left: 16,
        top: 30,
        width: w - 38,
        height: h - 49,
        rx: 3,
        fill: theme.cushion,
        stroke: theme.cushionStroke,
        strokeWidth: 2,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    children.push(
      new fabric.Rect({
        left: 16,
        top: 16,
        width: w - 32,
        height: 8,
        rx: 2,
        fill: theme.accent,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    children.push(
      new fabric.Rect({
        left: w - 15,
        top: 17,
        width: 14,
        height: armEnd - 17,
        rx: 2,
        fill: theme.accent,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
  } else if (piece.kind === 'ottoman') {
    children.push(
      new fabric.Rect({
        left: 10,
        top: 10,
        width: w - 20,
        height: h - 20,
        rx: 8,
        fill: theme.cushion,
        stroke: theme.cushionStroke,
        strokeWidth: 2,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
  } else {
    children.push(
      new fabric.Rect({
        left: 17,
        top: 29,
        width: w - 34,
        height: h - 57,
        rx: 3,
        fill: theme.cushion,
        stroke: theme.cushionStroke,
        strokeWidth: 2,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    children.push(
      new fabric.Rect({
        left: 16,
        top: 12,
        width: w - 32,
        height: 10,
        rx: 2,
        fill: theme.accent,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
    if (piece.kind === 'left-arm') {
      children.push(
        new fabric.Rect({
          left: 1,
          top: 17,
          width: 14,
          height: armEnd - 17,
          rx: 2,
          fill: theme.accent,
          originX: 'left',
          originY: 'top',
          selectable: false,
          evented: false,
        })
      );
    } else if (piece.kind === 'right-arm') {
      children.push(
        new fabric.Rect({
          left: w - 15,
          top: 17,
          width: 14,
          height: armEnd - 17,
          rx: 2,
          fill: theme.accent,
          originX: 'left',
          originY: 'top',
          selectable: false,
          evented: false,
        })
      );
    }
  }

  if (piece.kind !== 'ottoman') {
    const seamY = Math.round(29 + (h - 57) * 0.65);
    children.push(
      new fabric.Rect({
        left: 22,
        top: seamY - 1,
        width: w - 44,
        height: 2,
        fill: theme.cushionStroke,
        opacity: 0.4,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      })
    );
  }

  children.push(
    new fabric.Text(spec.short, {
      left: w / 2,
      top: h / 2,
      fontSize: 13,
      fontWeight: 700,
      fill: '#253132',
      fontFamily: 'Arial',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    })
  );

  const group = new fabric.Group(children, {
    originX: 'left',
    originY: 'top',
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    perPixelTargetFind: true,
    padding: 8,
    objectCaching: false,
    customData: {
      sectionalPiece: true,
      kind: piece.kind,
      guideCode: deriveGuideCode(piece),
      baseWidthCm: spec.width,
      baseDepthCm: spec.depth,
      sectionalAssemblyId: assemblyId,
      // Keep the old key readable for any in-progress projects from the
      // vertical slice, but use one canonical key everywhere going forward.
      assemblyId,
      pieceId: piece.id,
      mirrored: piece.mirrored === true,
      initialScaleX: 1,
      initialScaleY: 1,
    },
  });
  if (piece.rotation) group.set({ angle: piece.rotation });
  return group;
}

export function initSectionalBuilder(): void {
  const openButton = document.getElementById('sectionalBuilderBtn');
  if (!openButton || openButton.dataset.sectionalBound === 'true') return;
  openButton.dataset.sectionalBound = 'true';
  document.body.insertAdjacentHTML('beforeend', dialogMarkup());

  const dialog = document.getElementById('sectionalBuilderDialog') as HTMLDialogElement;
  const board = document.querySelector<SVGSVGElement>('#sbBoard')!;
  const pieceLayer = document.querySelector<SVGGElement>('#sbPieces')!;
  const dimensionLayer = document.querySelector<SVGGElement>('#sbDimensions')!;
  const snapLayer = document.querySelector<SVGGElement>('#sbSnapPreview')!;
  const guideLayer = document.querySelector<SVGGElement>('#sbGuides')!;
  const planView = document.querySelector<SVGGElement>('#sbPlanView')!;
  const productPreview = document.querySelector<SVGGElement>('#sbProductPreview')!;
  let dimInput: HTMLInputElement | null = null;
  const closeDimInput = () => {
    dimInput?.remove();
    dimInput = null;
  };
  // Click a drawn dimension label in the 2.5D view → inline edit → the sofa
  // rescales to the new measurement.
  productPreview.addEventListener('click', event => {
    const target = event.target as Element | null;
    const dimGroup = target?.closest?.('g.sb-dim');
    closeDimInput();
    if (!dimGroup) return;
    if (dimGroup.getAttribute('data-editable') !== 'true') return;
    const code = dimGroup.getAttribute('data-code') || '';
    const current = Number(dimGroup.getAttribute('data-value-cm') || '0');
    const textEl = dimGroup.querySelector('.sb-dim-label');
    if (!code || !textEl) return;
    const rect = textEl.getBoundingClientRect();
    dimInput = document.createElement('input');
    dimInput.type = 'number';
    dimInput.className = 'sb-dim-input';
    dimInput.min = '20';
    dimInput.max = '600';
    dimInput.value = String(Math.round(current));
    dimInput.style.left = `${Math.max(8, rect.left + rect.width / 2 - 45)}px`;
    dimInput.style.top = `${Math.max(8, rect.top - 8)}px`;
    document.body.appendChild(dimInput);
    dimInput.focus();
    dimInput.select();
    let committed = false;
    const commit = () => {
      if (committed || !dimInput) return;
      committed = true;
      const value = Number(dimInput.value);
      closeDimInput();
      if (!Number.isFinite(value) || value <= 0 || value === current) return;
      const changed = applySectionalMeasurementEdit(pieces, code, value);
      if (changed > 0) {
        pushHistory();
        render();
        (window as any).setStatusMessage?.(
          `${code} set to ${Math.round(value * 10) / 10} cm — ${changed} module(s) resized.`,
          'success'
        );
      }
    };
    dimInput.addEventListener('keydown', keyEvent => {
      if (keyEvent.key === 'Enter') {
        keyEvent.preventDefault();
        commit();
      } else if (keyEvent.key === 'Escape') {
        committed = true;
        closeDimInput();
      }
    });
    dimInput.addEventListener('blur', commit);
  });
  let pieces = createSectionalPreset('sofa');
  let selectedId: string | null = pieces[1]?.id || null;
  let selectedIds: Set<string> = new Set(selectedId ? [selectedId] : []);
  let assemblyId: string | null = null;
  let assemblyName = '3-seat sofa';
  let theme: SectionalThemeId = DEFAULT_THEME;
  let viewMode: SectionalViewMode = 'plan';
  let productStyle: SectionalProductStyle = { ...DEFAULT_SECTIONAL_PRODUCT_STYLE };
  let pricingCountry: SectionalPricingCountry = DEFAULT_PRICING_COUNTRY;
  let pricingFabric: SectionalPricingFabric = DEFAULT_PRICING_FABRIC;
  let pricingCatalog: SectionalPricingCatalog = CW_US_FABRIC_PRICES;
  let pricingRequestId = 0;
  let pricingLoading = false;
  let pricingUnavailable = false;
  let restoredFromMetadata = false;
  let dragState: {
    id: string;
    pointerId: number;
    origins: Map<string, { col: number; row: number }>;
  } | null = null;

  let history: SectionalPiece[][] = [];
  let redoStack: SectionalPiece[][] = [];
  const HISTORY_LIMIT = 50;

  const snapshot = (): SectionalPiece[] =>
    pieces.map(piece => ({
      ...piece,
      armStyle: piece.armStyle || productStyle.arm,
      backStyle: piece.backStyle || productStyle.back,
      cushionStyle: piece.cushionStyle || productStyle.cushion,
      baseStyle: piece.baseStyle || productStyle.base,
    }));
  const restoreProductStyleFromPieces = () => {
    productStyle = pieces.length
      ? resolveProductStyle(pieces[0], DEFAULT_SECTIONAL_PRODUCT_STYLE)
      : { ...DEFAULT_SECTIONAL_PRODUCT_STYLE };
  };
  const pushHistory = () => {
    history.push(snapshot());
    if (history.length > HISTORY_LIMIT) history.shift();
    redoStack = [];
  };
  const undo = () => {
    if (!history.length) return;
    redoStack.push(snapshot());
    pieces = history.pop()!;
    restoreProductStyleFromPieces();
    selectedId = pieces.find(p => p.id === selectedId)?.id || pieces[0]?.id || null;
    selectedIds = new Set(selectedId ? [selectedId] : []);
    render();
  };
  const redo = () => {
    if (!redoStack.length) return;
    history.push(snapshot());
    pieces = redoStack.pop()!;
    restoreProductStyleFromPieces();
    selectedId = pieces.find(p => p.id === selectedId)?.id || pieces[0]?.id || null;
    selectedIds = new Set(selectedId ? [selectedId] : []);
    render();
  };

  const MAX_COL = 5;
  const MAX_ROW = 3;

  /** Rectangle-overlap collision that accounts for multi-cell pieces (e.g. chaise). */
  const occupied = (col: number, row: number, exceptId?: string, colSpan = 1, rowSpan = 1) =>
    pieces.some(piece => {
      if (piece.id === exceptId) return false;
      const fp = pieceFootprint(piece);
      const colOverlap = col < piece.col + fp.colSpan && col + colSpan > piece.col;
      const rowOverlap = row < piece.row + fp.rowSpan && row + rowSpan > piece.row;
      return colOverlap && rowOverlap;
    });

  const nearestFree = (col: number, row: number, exceptId?: string, colSpan = 1, rowSpan = 1) => {
    const baseCol = Math.max(0, Math.min(MAX_COL - colSpan + 1, col));
    const baseRow = Math.max(0, Math.min(MAX_ROW - rowSpan + 1, row));
    if (!occupied(baseCol, baseRow, exceptId, colSpan, rowSpan))
      return { col: baseCol, row: baseRow };
    for (let radius = 1; radius < 6; radius += 1) {
      const options = [
        [baseCol + radius, baseRow],
        [baseCol - radius, baseRow],
        [baseCol, baseRow + radius],
        [baseCol, baseRow - radius],
      ];
      const next = options.find(
        ([nextCol, nextRow]) =>
          nextCol >= 0 &&
          nextCol <= MAX_COL - colSpan + 1 &&
          nextRow >= 0 &&
          nextRow <= MAX_ROW - rowSpan + 1 &&
          !occupied(nextCol, nextRow, exceptId, colSpan, rowSpan)
      );
      if (next) return { col: next[0], row: next[1] };
    }
    return { col: baseCol, row: baseRow };
  };

  const latestSavedAssembly = (): SectionalAssemblyRecord | null => {
    const saved =
      (window as any).app?.projectManager?.getProjectMetadata?.()?.sectionalAssemblies || {};
    const list = Object.values(saved) as SectionalAssemblyRecord[];
    if (!list.length) return null;
    return list.sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    )[0];
  };

  const restoreAssembly = (record: SectionalAssemblyRecord) => {
    assemblyId = record.id;
    assemblyName = record.name || 'Custom sectional';
    theme = record.theme && SECTIONAL_THEMES[record.theme] ? record.theme : DEFAULT_THEME;
    viewMode =
      record.viewMode === 'front-left' || record.viewMode === 'front-right'
        ? record.viewMode
        : 'plan';
    pricingCountry =
      record.pricingCountry && SECTIONAL_PRICING_MARKETS[record.pricingCountry]
        ? record.pricingCountry
        : DEFAULT_PRICING_COUNTRY;
    pricingFabric =
      record.pricingFabric && SECTIONAL_PRICING_FABRICS[record.pricingFabric]
        ? record.pricingFabric
        : DEFAULT_PRICING_FABRIC;
    pricingCatalog = pricingCountry === DEFAULT_PRICING_COUNTRY ? CW_US_FABRIC_PRICES : {};
    pricingUnavailable = false;
    pieces = (Array.isArray(record.pieces) ? record.pieces : []).map(piece => ({ ...piece }));
    productStyle = pieces.length
      ? resolveProductStyle(pieces[0], DEFAULT_SECTIONAL_PRODUCT_STYLE)
      : { ...DEFAULT_SECTIONAL_PRODUCT_STYLE };
    selectedId = pieces[0]?.id || null;
  };

  /**
   * Read live piece Groups from the canvas and reconstruct the builder's grid
   * state. This lets the user manipulate pieces on the canvas, then sync the
   * builder back to match.
   */
  const syncBuilderFromCanvas = (): boolean => {
    const app = (window as any).app;
    const canvas = app?.canvasManager?.fabricCanvas;
    const worldRect = app?.canvasManager?.getBackgroundWorldRect?.();
    if (!canvas || !worldRect || !assemblyId) return false;

    const groups = (canvas.getObjects?.() || []).filter(
      (object: any) =>
        object?.customData?.sectionalPiece === true && getObjectAssemblyId(object) === assemblyId
    );
    if (!groups.length) return false;

    const viewBox = getSectionalPlanViewBox(pieces.length ? pieces : createSectionalPreset('sofa'));
    const scaleX = worldRect.width / viewBox.width;
    const scaleY = worldRect.height / viewBox.height;
    const viewId = app.projectManager?.currentViewId || '';
    const piecesFromCanvas: SectionalPiece[] = [];

    groups.forEach((group: any) => {
      const cd = group.customData;
      if (!cd.kind || !cd.pieceId) return;
      const unrot = unrotatedFootprint({
        id: '',
        kind: cd.kind,
        col: 0,
        row: 0,
        rotation: 0,
        mirrored: cd.mirrored === true,
      } as SectionalPiece);
      const centerX = Number(group.left) || 0;
      const centerY = Number(group.top) || 0;
      const pieceSvgW = Number(unrot.bodyW) || 1;
      const pieceSvgH = Number(unrot.bodyH) || 1;

      // Map world center back to SVG coordinates, then to grid cells.
      const svgCenterX = viewBox.x + ((centerX - worldRect.left) / worldRect.width) * viewBox.width;
      const svgCenterY =
        viewBox.y + ((centerY - worldRect.top) / worldRect.height) * viewBox.height;
      const col = Math.max(
        0,
        Math.min(5, Math.round((svgCenterX - GRID_ORIGIN_X - pieceSvgW / 2) / CELL))
      );
      const row = Math.max(
        0,
        Math.min(3, Math.round((svgCenterY - GRID_ORIGIN_Y - pieceSvgH / 2) / CELL))
      );

      const existing = pieces.find(p => String(p.id) === String(cd.pieceId));
      if (existing) {
        existing.col = col;
        existing.row = row;
        existing.rotation = Math.round(((Number(group.angle) || 0) % 360) / 90) * 90;
        existing.mirrored = cd.mirrored === true;
        piecesFromCanvas.push(existing);
      }
    });

    if (!piecesFromCanvas.length) return false;
    pieces = piecesFromCanvas;
    selectedId = pieces[0]?.id || null;
    selectedIds = new Set(selectedId ? [selectedId] : []);
    return true;
  };

  const persistAssembly = (
    viewId?: string,
    liveTransforms?: Record<string, NormalizedLiveSectionalTransform>
  ) => {
    const manager = (window as any).app?.projectManager;
    if (!manager?.setProjectMetadata) return;
    if (!assemblyId) assemblyId = createId();
    const metadata = manager.getProjectMetadata?.() || {};
    const previous = metadata.sectionalAssemblies?.[assemblyId] || {};
    const record: SectionalAssemblyRecord = {
      id: assemblyId,
      name: assemblyName,
      pieces: pieces.map(piece => ({ ...piece })),
      imageViewId:
        typeof viewId === 'string' && viewId ? viewId : String(previous.imageViewId || ''),
      updatedAt: new Date().toISOString(),
      theme,
      viewMode,
      pricingCountry,
      pricingFabric,
      liveTransforms: liveTransforms || previous.liveTransforms,
    };
    const patch: Record<string, unknown> = {
      sectionalAssemblies: { ...(metadata.sectionalAssemblies || {}), [assemblyId]: record },
    };
    // Naming handoff: fill gaps only, never stomp values the user set themselves.
    if (!metadata.sofaType) patch.sofaType = 'sectional_l_shape';
    const naming = metadata.naming || {};
    if (!String(naming.sofaTypeLabel || '').trim()) {
      patch.naming = { ...naming, sofaTypeLabel: assemblyName };
    }
    manager.setProjectMetadata(patch);
    // Nudge the visible project name when it is still untouched.
    const projectNameInput = document.getElementById('projectName') as HTMLInputElement | null;
    if (projectNameInput && !projectNameInput.value.trim()) {
      projectNameInput.value = assemblyName;
    }
  };

  /** Bind a measurement-guide code to a module's image so the guide indicator appears automatically. */
  const bindModuleGuideCode = (viewId: string, piece: SectionalPiece) => {
    const manager = (window as any).app?.projectManager;
    if (!manager?.setProjectMetadata) return;
    const code = deriveGuideCode(piece);
    if (!code) return;
    const metadata = manager.getProjectMetadata?.() || {};
    manager.setProjectMetadata({
      measurementGuideCodesByView: {
        ...(metadata.measurementGuideCodesByView || {}),
        [viewId]: [code],
      },
      measurementGuideBindingsByScope: {
        ...(metadata.measurementGuideBindingsByScope || {}),
        [viewId]: { codes: [code], activeCode: code, activeVariant: 'front', locked: false },
      },
      measurementGuideLibraryCodes: Array.from(
        new Set([...(metadata.measurementGuideLibraryCodes || []), code])
      ),
    });
  };

  /**
   * Create real measurement strokes (overall width/depth + per-column widths)
   * on the freshly imported plan image. Strokes land on the dimension lines
   * baked into the PNG, so the document starts pre-measured and stays editable.
   */
  const seedMeasurementStrokes = async (
    viewId: string | undefined,
    seedPieces: SectionalPiece[]
  ): Promise<number> => {
    const app = (window as any).app;
    const projectManager = app?.projectManager;
    const metadataManager = app?.metadataManager;
    const fabricCanvas = app?.canvasManager?.fabricCanvas;
    if (!viewId || !projectManager || !metadataManager || !fabricCanvas || !seedPieces.length)
      return 0;

    try {
      if (projectManager.currentViewId !== viewId) {
        await projectManager.switchView?.(viewId);
      }
      const worldRect = app.canvasManager?.getBackgroundWorldRect?.();
      if (!worldRect) return 0;

      const viewBox = getSectionalPlanViewBox(seedPieces);
      const seeds = getSectionalMeasurementSeeds(seedPieces);
      const fabric = (window as any).fabric;
      if (!fabric?.Line) return 0;
      const imageLabel = String(
        metadataManager.resolveActiveImageLabel?.(viewId) ||
          metadataManager.normalizeImageLabel?.(viewId) ||
          viewId
      ).trim();

      let seeded = 0;
      for (const seed of seeds) {
        const strokeLabel =
          metadataManager.resolveAvailableStrokeLabel?.(
            imageLabel,
            seed.suggestedTag,
            'letters+numbers'
          ) || metadataManager.getNextLabel?.(imageLabel);
        if (!strokeLabel) continue;
        const p1 = planPointToWorld(seed.x1, seed.y1, viewBox, worldRect);
        const p2 = planPointToWorld(seed.x2, seed.y2, viewBox, worldRect);
        const line = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
          stroke: '#3b82f6',
          strokeWidth: 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          perPixelTargetFind: true,
          padding: 8,
          objectCaching: false,
        });
        // Mark seeded strokes so a later "Update project image" can replace
        // exactly these without touching anything the user drew themselves.
        line.customData = {
          ...(line.customData || {}),
          sectionalSeed: true,
          sectionalAssemblyId: assemblyId,
          sectionalSeedRole: seed.role,
        };
        fabricCanvas.add(line);
        line.setCoords?.();
        metadataManager.attachMetadata?.(line, imageLabel, strokeLabel);
        metadataManager.parseAndSaveMeasurement?.(imageLabel, strokeLabel, `${seed.valueCm} cm`);
        app.tagManager?.createTagForStroke?.(strokeLabel, imageLabel, line);
        seeded += 1;
      }
      if (seeded > 0) {
        fabricCanvas.requestRenderAll?.();
        app.historyManager?.saveState?.({ force: true, reason: 'sectional:seed-measurements' });
      }
      return seeded;
    } catch (error) {
      console.warn('[SectionalBuilder] Measurement seeding failed', error);
      return 0;
    }
  };

  const updateInspector = () => {
    const bounds = calculateSectionalBounds(pieces);
    const selected = pieces.find(piece => piece.id === selectedId);
    (document.getElementById('sbAssemblyName') as HTMLElement).textContent = assemblyName;
    (document.getElementById('sbPieceCount') as HTMLElement).textContent =
      `${pieces.length} piece${pieces.length === 1 ? '' : 's'}`;
    (document.getElementById('sbMetricPieces') as HTMLElement).textContent = String(pieces.length);
    (document.getElementById('sbMetricWidth') as HTMLElement).textContent = `${bounds.width} cm`;
    (document.getElementById('sbMetricDepth') as HTMLElement).textContent = `${bounds.depth} cm`;
    const inspector = document.getElementById('sbSelectionInspector') as HTMLElement;
    inspector.classList.toggle('is-empty', !selected);
    (document.getElementById('sbSelectedName') as HTMLElement).textContent = selected
      ? PIECES[selected.kind].name
      : 'Select a piece';
    if (selected) {
      const dims = getPieceDimensions(selected);
      const sockets = getConnectorWorldSides(selected);
      (document.getElementById('sbSelectedSize') as HTMLElement).textContent =
        `${dims.width} × ${dims.depth} cm · Cell ${selected.col + 1}, ${selected.row + 1} · Sockets: ${sockets.join(', ') || 'none'} · Guide: ${deriveGuideCode(selected)}`;
    } else {
      (document.getElementById('sbSelectedSize') as HTMLElement).textContent =
        'Drag pieces on the board to arrange them.';
    }
    updateMeasurementChecks();
  };

  // Measurement checks: evaluate the CW code values (from the seeded strokes'
  // measurement entries) against the PDF-convention rule catalog and render
  // pass/fail rows in the inspector.
  const updateMeasurementChecks = () => {
    const list = document.getElementById('sbMeasurementChecks');
    if (!list) return;
    if (!pieces.length) {
      list.innerHTML = '<p class="sb-checks-empty">Add pieces to check measurements.</p>';
      return;
    }
    const app = (window as any).app;
    const metadataManager = app?.metadataManager;
    const viewId = app?.projectManager?.currentViewId;
    const values: Record<string, number | undefined> = {};
    if (metadataManager?.strokeMeasurements) {
      const scopes = Object.keys(metadataManager.strokeMeasurements || {}).filter(
        (key: string) => key === viewId || key.startsWith(`${viewId}::tab:`)
      );
      const wantedCodes = new Set<string>();
      getSectionalMeasurementSeeds(pieces).forEach(seed => wantedCodes.add(seed.suggestedTag));
      scopes.forEach((scopeKey: string) => {
        const bucket = metadataManager.strokeMeasurements[scopeKey] || {};
        Object.entries(bucket).forEach(([strokeLabel, entry]: [string, any]) => {
          const code = String(strokeLabel).trim().toUpperCase();
          if (!wantedCodes.has(code)) return;
          const raw =
            typeof entry === 'object' && entry !== null
              ? (entry.value ?? entry.measurement ?? entry.text)
              : entry;
          const numeric = parseFloat(String(raw ?? '').replace(/[^\d.-]/g, ''));
          if (Number.isFinite(numeric) && numeric > 0) values[code] = numeric;
        });
      });
    }

    const ruleSet = buildSectionalMeasurementRules({ pieces, values });
    const issues = evaluateSectionalMeasurementRules(ruleSet, values);
    const { filled, expected } = countFilledMeasurements(ruleSet, values);

    const severityColor: Record<string, string> = {
      error: '#c2402f',
      warn: '#b45309',
      info: '#2563eb',
    };
    const rows = issues.length
      ? issues
          .map(
            issue => `<li class="sb-check-row sb-check-${issue.severity}">
              <strong style="color:${severityColor[issue.severity]}">${issue.severity === 'error' ? '✕' : issue.severity === 'warn' ? '!' : 'i'}</strong>
              <span><strong>${issue.title}.</strong> ${issue.message}</span>
            </li>`
          )
          .join('')
      : '<li class="sb-check-row sb-check-ok"><strong style="color:#198b71">✓</strong><span>All entered measurements pass the checks so far.</span></li>';
    list.innerHTML = `
      <p class="sb-checks-summary">${filled} of ${expected} codes filled · ${issues.filter(issue => issue.severity === 'error').length} error(s), ${issues.filter(issue => issue.severity === 'warn').length} warning(s)</p>
      <ul>${rows}</ul>`;
  };

  const formatPrice = (value: number): string => {
    const market = SECTIONAL_PRICING_MARKETS[pricingCountry];
    return new Intl.NumberFormat(market.locale, {
      style: 'currency',
      currency: market.currency,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const updatePricing = () => {
    const list = document.getElementById('sbPricingList');
    const totalEl = document.getElementById('sbPricingTotal');
    if (!list || !totalEl) return;
    if (!pieces.length) {
      list.innerHTML = '<p class="sb-pricing-empty">Add pieces to see CW pricing</p>';
      totalEl.textContent = '—';
      return;
    }
    if (pricingLoading) {
      list.innerHTML = '<p class="sb-pricing-empty">Updating storefront prices…</p>';
      totalEl.textContent = '…';
      return;
    }
    if (pricingUnavailable) {
      list.innerHTML =
        '<p class="sb-pricing-empty">Prices are temporarily unavailable for this country.</p>';
      totalEl.textContent = '—';
      return;
    }
    const pricing = getAssemblyPricing(pieces, pricingCountry, pricingFabric, pricingCatalog);
    list.innerHTML = pricing.items
      .map(
        item =>
          `<a class="sb-pricing-row" href="${item.product.url}" target="_blank" rel="noopener" title="${item.product.title}">` +
          `<span class="sb-pricing-num">${item.pieceIndex + 1}</span>` +
          `<span class="sb-pricing-name">${item.pieceName}</span>` +
          `<span class="sb-pricing-price">${formatPrice(item.product.price)}</span>` +
          `</a>`
      )
      .join('');
    totalEl.textContent = `${formatPrice(pricing.total)} ${pricing.currency}`;
  };

  const syncPricingControls = () => {
    const countrySelect = document.getElementById('sbPricingCountry') as HTMLSelectElement | null;
    const fabricSelect = document.getElementById('sbPricingFabric') as HTMLSelectElement | null;
    if (countrySelect) countrySelect.value = pricingCountry;
    if (fabricSelect) fabricSelect.value = pricingFabric;
  };

  const loadPricingCatalog = async () => {
    const status = document.getElementById('sbPricingStatus');
    const requestId = ++pricingRequestId;
    const market = SECTIONAL_PRICING_MARKETS[pricingCountry];
    const handles = Array.from(
      new Set(
        (Object.keys(PIECES) as PieceKind[])
          .map(
            kind =>
              getPiecePricing({
                id: kind,
                kind,
                col: 0,
                row: 0,
                rotation: 0,
                mirrored: false,
              })?.handle
          )
          .filter(Boolean) as string[]
      )
    );
    pricingLoading = true;
    pricingUnavailable = false;
    if (status) status.textContent = `Updating ${market.country} storefront prices…`;
    updatePricing();
    try {
      const response = await fetch('/api/integrations/cw/measurements/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase: 'sectional-pricing',
          country: pricingCountry,
          handles,
        }),
      });
      if (!response.ok) throw new Error(`Pricing request failed (${response.status})`);
      const result = await response.json();
      if (requestId !== pricingRequestId) return;
      pricingCatalog =
        result?.products && typeof result.products === 'object'
          ? result.products
          : pricingCountry === DEFAULT_PRICING_COUNTRY
            ? CW_US_FABRIC_PRICES
            : {};
      pricingLoading = false;
      pricingUnavailable = false;
      if (status) {
        status.textContent = `${SECTIONAL_PRICING_FABRICS[pricingFabric]} · current ${market.country} storefront prices`;
      }
      updatePricing();
    } catch (error) {
      if (requestId !== pricingRequestId) return;
      pricingLoading = false;
      pricingCatalog = pricingCountry === DEFAULT_PRICING_COUNTRY ? CW_US_FABRIC_PRICES : {};
      pricingUnavailable = pricingCountry !== DEFAULT_PRICING_COUNTRY;
      if (status) {
        status.textContent =
          pricingCountry === DEFAULT_PRICING_COUNTRY
            ? `${SECTIONAL_PRICING_FABRICS[pricingFabric]} · saved US prices`
            : `Could not refresh ${market.country} prices`;
      }
      console.warn('[SectionalBuilder] Pricing refresh failed', error);
      updatePricing();
    }
  };

  const render = () => {
    const report = evaluateSectionalConnections(pieces);
    const activeTheme = SECTIONAL_THEMES[theme] || SECTIONAL_THEMES[DEFAULT_THEME];
    dimensionLayer.innerHTML = sectionalDimensionsMarkup(pieces);
    pieceLayer.innerHTML = pieces
      .map(piece => pieceMarkup(piece, selectedIds.has(piece.id), false, report, activeTheme))
      .join('');
    const isPlan = viewMode === 'plan';
    const productView = viewMode === 'plan' ? null : viewMode;
    planView.style.display = isPlan ? '' : 'none';
    productPreview.style.display = isPlan ? 'none' : '';
    productPreview.toggleAttribute('hidden', isPlan);
    productPreview.innerHTML = !productView
      ? ''
      : sectionalProductMarkup(pieces, productView, theme, productStyle);
    dialog.querySelectorAll<HTMLElement>('[data-sb-view]').forEach(button => {
      const selected = button.dataset.sbView === viewMode;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('is-active', selected);
    });
    const viewLabel = document.getElementById('sbViewLabel');
    if (viewLabel) {
      viewLabel.textContent =
        viewMode === 'plan'
          ? 'Plan view'
          : viewMode === 'front-left'
            ? 'Left 45° product view'
            : 'Right 45° product view';
    }
    const styleControls: Array<[string, keyof SectionalProductStyle]> = [
      ['sbArmStyle', 'arm'],
      ['sbArmLength', 'armLength'],
      ['sbBackStyle', 'back'],
      ['sbBackCushionFit', 'backCushionFit'],
      ['sbCushionStyle', 'cushion'],
      ['sbBaseStyle', 'base'],
    ];
    styleControls.forEach(([id, key]) => {
      const control = document.getElementById(id) as HTMLSelectElement | null;
      if (control) control.value = productStyle[key];
    });
    const productButton = dialog.querySelector('[data-sb-use-product]') as HTMLButtonElement | null;
    if (productButton) {
      productButton.hidden = isPlan;
      productButton.textContent =
        viewMode === 'front-right' ? 'Add right 45° view' : 'Add left 45° view';
    }
    dialog.querySelectorAll<HTMLElement>('[data-sb-theme]').forEach(swatch => {
      swatch.setAttribute('aria-checked', String(swatch.dataset.sbTheme === theme));
    });
    const undoBtn = dialog.querySelector('[data-sb-undo]') as HTMLButtonElement | null;
    const redoBtn = dialog.querySelector('[data-sb-redo]') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = history.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    updateInspector();
    updatePricing();
    updateHandoffButtons();
  };

  const addPiece = (kind: PieceKind, col = 0, row = 0) => {
    pushHistory();
    const tempPiece: SectionalPiece = { id: 'temp', kind, col, row, rotation: 0, mirrored: false };
    const fp = pieceFootprint(tempPiece);
    const position = nearestFree(col, row, undefined, fp.colSpan, fp.rowSpan);
    const piece: SectionalPiece = {
      id: createId(),
      kind,
      ...position,
      rotation: 0,
      mirrored: false,
      armStyle: productStyle.arm,
      backStyle: productStyle.back,
      cushionStyle: productStyle.cushion,
      baseStyle: productStyle.base,
    };
    pieces.push(piece);
    selectedId = piece.id;
    selectedIds = new Set([piece.id]);
    render();
  };

  openButton.addEventListener('click', () => {
    document.getElementById('projectMenuWrapper')?.classList.remove('open');
    document.getElementById('projectMenuToggle')?.setAttribute('aria-expanded', 'false');
    // Reopen a previously generated assembly for editing. Runs on first open,
    // and again whenever the board is empty (e.g. after loading a project).
    if (!restoredFromMetadata || pieces.length === 0) {
      const latest = latestSavedAssembly();
      if (latest) restoreAssembly(latest);
      restoredFromMetadata = true;
    }
    if (!dialog.open) dialog.showModal();
    syncPricingControls();
    render();
    void loadPricingCatalog();
  });
  dialog.querySelector('[data-sb-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  dialog.querySelectorAll<HTMLElement>('[data-piece-kind]').forEach(item => {
    const kind = item.dataset.pieceKind as PieceKind;
    item.addEventListener('click', () => addPiece(kind));
    item.addEventListener('dragstart', event =>
      event.dataTransfer?.setData('text/sectional-piece', kind)
    );
  });
  dialog.querySelectorAll<HTMLElement>('[data-sb-preset]').forEach(button =>
    button.addEventListener('click', () => {
      const preset = button.dataset.sbPreset as
        | 'sofa'
        | 'chaise'
        | 'corner'
        | 'two-seat'
        | 'l-chaise'
        | 'ottoman-set'
        | 'armchair'
        | 'two-arm-chaise';
      pushHistory();
      pieces = createSectionalPreset(preset).map(piece => ({
        ...piece,
        armStyle: productStyle.arm,
        backStyle: productStyle.back,
        cushionStyle: productStyle.cushion,
        baseStyle: productStyle.base,
      }));
      assemblyId = null;
      assemblyName =
        preset === 'chaise'
          ? 'Sofa with chaise'
          : preset === 'corner'
            ? 'L-shape sectional'
            : preset === 'two-seat'
              ? '2-seat sofa'
              : preset === 'l-chaise'
                ? 'L-shape with chaise'
                : preset === 'ottoman-set'
                  ? 'Sofa with ottoman'
                  : preset === 'armchair'
                    ? 'Armchair'
                    : preset === 'two-arm-chaise'
                      ? 'Two-arm chaise'
                      : '3-seat sofa';
      selectedId = pieces[0]?.id || null;
      selectedIds = new Set(selectedId ? [selectedId] : []);
      render();
    })
  );
  dialog.querySelector('[data-sb-clear]')?.addEventListener('click', () => {
    pushHistory();
    pieces = [];
    assemblyId = null;
    assemblyName = 'Custom sectional';
    selectedId = null;
    selectedIds = new Set();
    render();
  });

  dialog.querySelector('[data-sb-undo]')?.addEventListener('click', undo);
  dialog.querySelector('[data-sb-redo]')?.addEventListener('click', redo);

  dialog.querySelectorAll<HTMLElement>('[data-sb-theme]').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const id = swatch.dataset.sbTheme as SectionalThemeId;
      if (SECTIONAL_THEMES[id]) {
        theme = id;
        render();
      }
    });
  });

  dialog.querySelectorAll<HTMLElement>('[data-sb-view]').forEach(button => {
    button.addEventListener('click', () => {
      const requested = button.dataset.sbView as SectionalViewMode;
      if (requested !== 'plan' && requested !== 'front-left' && requested !== 'front-right') return;
      viewMode = requested;
      render();
    });
  });

  const bindProductStyle = <K extends keyof SectionalProductStyle>(id: string, key: K) => {
    (document.getElementById(id) as HTMLSelectElement | null)?.addEventListener('change', event => {
      const value = (event.currentTarget as HTMLSelectElement).value as SectionalProductStyle[K];
      if (productStyle[key] === value) return;
      pushHistory();
      productStyle = { ...productStyle, [key]: value };
      pieces = pieces.map(piece => ({ ...piece, [`${key}Style`]: value }));
      render();
    });
  };
  bindProductStyle('sbArmStyle', 'arm');
  bindProductStyle('sbArmLength', 'armLength');
  bindProductStyle('sbBackStyle', 'back');
  bindProductStyle('sbBackCushionFit', 'backCushionFit');
  bindProductStyle('sbCushionStyle', 'cushion');
  bindProductStyle('sbBaseStyle', 'base');

  (document.getElementById('sbPricingCountry') as HTMLSelectElement | null)?.addEventListener(
    'change',
    event => {
      const value = (event.currentTarget as HTMLSelectElement).value as SectionalPricingCountry;
      if (!SECTIONAL_PRICING_MARKETS[value]) return;
      pricingCountry = value;
      pricingCatalog = pricingCountry === DEFAULT_PRICING_COUNTRY ? CW_US_FABRIC_PRICES : {};
      pricingUnavailable = false;
      void loadPricingCatalog();
    }
  );

  (document.getElementById('sbPricingFabric') as HTMLSelectElement | null)?.addEventListener(
    'change',
    event => {
      const value = (event.currentTarget as HTMLSelectElement).value as SectionalPricingFabric;
      if (!SECTIONAL_PRICING_FABRICS[value]) return;
      pricingFabric = value;
      const status = document.getElementById('sbPricingStatus');
      if (status && !pricingLoading) {
        const market = SECTIONAL_PRICING_MARKETS[pricingCountry];
        status.textContent = `${SECTIONAL_PRICING_FABRICS[pricingFabric]} · current ${market.country} storefront prices`;
      }
      updatePricing();
    }
  );

  dialog.querySelector('[data-sb-copy-pricing]')?.addEventListener('click', () => {
    if (!pieces.length) return;
    const market = SECTIONAL_PRICING_MARKETS[pricingCountry];
    const pricing = getAssemblyPricing(pieces, pricingCountry, pricingFabric, pricingCatalog);
    const lines = pricing.items.map(
      item => `${item.pieceName} — ${formatPrice(item.product.price)} — ${item.product.url}`
    );
    lines.unshift(`${market.country} · ${SECTIONAL_PRICING_FABRICS[pricingFabric]}`);
    lines.push(`Total: ${formatPrice(pricing.total)} ${pricing.currency}`);
    const text = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          (window as any).showStatusMessage?.('Pricing links copied to clipboard', 'success');
        })
        .catch(() => {});
    }
  });

  board.addEventListener('dragover', event => event.preventDefault());
  board.addEventListener('drop', event => {
    event.preventDefault();
    if (viewMode !== 'plan') return;
    const kind = event.dataTransfer?.getData('text/sectional-piece') as PieceKind;
    if (!PIECES[kind]) return;
    const point = board.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(board.getScreenCTM()?.inverse());
    addPiece(
      kind,
      Math.round((local.x - GRID_ORIGIN_X) / CELL),
      Math.round((local.y - GRID_ORIGIN_Y) / CELL)
    );
  });

  board.addEventListener('pointerdown', event => {
    if (viewMode !== 'plan') return;
    const target = (event.target as Element).closest<SVGGElement>('[data-piece-id]');
    if (!target) return;
    const clickedId = target.dataset.pieceId || null;
    if (!clickedId) return;
    if (event.shiftKey) {
      // Toggle multi-select
      if (selectedIds.has(clickedId)) {
        selectedIds.delete(clickedId);
      } else {
        selectedIds.add(clickedId);
      }
      selectedId = clickedId;
    } else if (!selectedIds.has(clickedId)) {
      // Select only this piece
      selectedIds = new Set([clickedId]);
      selectedId = clickedId;
    }
    // Store origins for group drag
    const origins = new Map<string, { col: number; row: number }>();
    pieces
      .filter(p => selectedIds.has(p.id))
      .forEach(p => origins.set(p.id, { col: p.col, row: p.row }));
    dragState = { id: clickedId, pointerId: event.pointerId, origins };
    board.setPointerCapture(event.pointerId);
    render();
  });
  board.addEventListener('pointermove', event => {
    if (!dragState) return;
    const draggedPiece = pieces.find(candidate => candidate.id === dragState?.id);
    if (!draggedPiece) return;
    const fp = pieceFootprint(draggedPiece);
    const point = board.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(board.getScreenCTM()?.inverse());
    const col = Math.max(
      0,
      Math.min(
        MAX_COL - fp.colSpan + 1,
        Math.round((local.x - GRID_ORIGIN_X - fp.bodyW / 2) / CELL)
      )
    );
    const row = Math.max(
      0,
      Math.min(
        MAX_ROW - fp.rowSpan + 1,
        Math.round((local.y - GRID_ORIGIN_Y - fp.bodyH / 2) / CELL)
      )
    );
    const position = nearestFree(col, row, dragState.id, fp.colSpan, fp.rowSpan);
    const compatibility = previewCompatibility(pieces, dragState.id, position.col, position.row);
    const stateClass =
      compatibility === 'valid' ? ' is-valid' : compatibility === 'invalid' ? ' is-invalid' : '';
    snapLayer.innerHTML = `<rect class="sb-snap-preview${stateClass}" x="${GRID_ORIGIN_X + position.col * CELL + 7}" y="${GRID_ORIGIN_Y + position.row * CELL + 7}" width="${fp.bodyW - 14}" height="${fp.bodyH - 14}" rx="7"/>`;
    // Center-line alignment guides: show when the dragged piece aligns with the assembly centroid.
    const others = pieces.filter(p => p.id !== dragState!.id);
    const guides: string[] = [];
    if (others.length) {
      const bounds = assemblyPixelBounds(others);
      if (bounds) {
        const hCenter = (bounds.x0 + bounds.x1) / 2;
        const vCenter = (bounds.y0 + bounds.y1) / 2;
        const pieceHCenter = GRID_ORIGIN_X + position.col * CELL + fp.bodyW / 2;
        const pieceVCenter = GRID_ORIGIN_Y + position.row * CELL + fp.bodyH / 2;
        if (Math.abs(pieceHCenter - hCenter) < CELL * 0.35) {
          guides.push(
            `<path class="sb-guide-line" d="M${hCenter} ${bounds.y0 - 80}V${bounds.y1 + 30}"/>`
          );
        }
        if (Math.abs(pieceVCenter - vCenter) < CELL * 0.35) {
          guides.push(
            `<path class="sb-guide-line" d="M${bounds.x0 - 80} ${vCenter}H${bounds.x1 + 30}"/>`
          );
        }
      }
    }
    guideLayer.innerHTML = guides.join('');
  });
  board.addEventListener('pointerup', event => {
    if (!dragState) return;
    const draggedPiece = pieces.find(candidate => candidate.id === dragState?.id);
    if (draggedPiece) {
      const fp = pieceFootprint(draggedPiece);
      const point = board.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(board.getScreenCTM()?.inverse());
      const col = Math.max(
        0,
        Math.min(
          MAX_COL - fp.colSpan + 1,
          Math.round((local.x - GRID_ORIGIN_X - fp.bodyW / 2) / CELL)
        )
      );
      const row = Math.max(
        0,
        Math.min(
          MAX_ROW - fp.rowSpan + 1,
          Math.round((local.y - GRID_ORIGIN_Y - fp.bodyH / 2) / CELL)
        )
      );
      const newPos = nearestFree(col, row, draggedPiece.id, fp.colSpan, fp.rowSpan);
      const origin = dragState.origins.get(draggedPiece.id);
      if (origin && (newPos.col !== origin.col || newPos.row !== origin.row)) {
        // Compute delta and apply to all selected pieces
        const dCol = newPos.col - origin.col;
        const dRow = newPos.row - origin.row;
        const selectedPieces = pieces.filter(p => dragState!.origins.has(p.id));
        const canMove = selectedPieces.every(p => {
          const orig = dragState!.origins.get(p.id)!;
          const targetCol = orig.col + dCol;
          const targetRow = orig.row + dRow;
          const pfp = pieceFootprint(p);
          if (targetCol < 0 || targetCol > MAX_COL - pfp.colSpan + 1) return false;
          if (targetRow < 0 || targetRow > MAX_ROW - pfp.rowSpan + 1) return false;
          return !occupied(targetCol, targetRow, p.id, pfp.colSpan, pfp.rowSpan);
        });
        if (canMove) {
          pushHistory();
          selectedPieces.forEach(p => {
            const orig = dragState!.origins.get(p.id)!;
            p.col = orig.col + dCol;
            p.row = orig.row + dRow;
          });
        }
      }
    }
    dragState = null;
    snapLayer.innerHTML = '';
    guideLayer.innerHTML = '';
    render();
  });

  dialog.querySelectorAll<HTMLElement>('[data-sb-action]').forEach(button =>
    button.addEventListener('click', () => {
      const targets = pieces.filter(piece => selectedIds.has(piece.id));
      if (!targets.length) return;
      const action = button.dataset.sbAction;
      pushHistory();
      if (action === 'rotate')
        targets.forEach(p => {
          p.rotation = (p.rotation + 90) % 360;
        });
      if (action === 'mirror')
        targets.forEach(p => {
          p.mirrored = !p.mirrored;
        });
      if (action === 'duplicate') targets.forEach(p => addPiece(p.kind, p.col + 1, p.row));
      if (action === 'delete') {
        pieces = pieces.filter(piece => !selectedIds.has(piece.id));
        selectedId = pieces[0]?.id || null;
        selectedIds = new Set(selectedId ? [selectedId] : []);
      }
      render();
    })
  );

  // Keyboard: undo/redo + arrow-key nudge.
  dialog.addEventListener('keydown', event => {
    if (!dialog.open) return;

    // Undo / Redo
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }

    const selected = pieces.find(piece => piece.id === selectedId);
    if (!selected) return;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = map[event.key];
    if (!delta) return;
    event.preventDefault();
    const fp = pieceFootprint(selected);
    const targetCol = selected.col + delta[0];
    const targetRow = selected.row + delta[1];
    if (targetCol < 0 || targetCol > MAX_COL - fp.colSpan + 1) return;
    if (targetRow < 0 || targetRow > MAX_ROW - fp.rowSpan + 1) return;
    if (occupied(targetCol, targetRow, selected.id, fp.colSpan, fp.rowSpan)) return;
    pushHistory();
    selected.col = targetCol;
    selected.row = targetRow;
    render();
  });

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Could not read image'));
      reader.readAsDataURL(file);
    });

  /** Seeded strokes for this assembly still live on the canvas of the given view. */
  const removeSeededStrokes = (viewId: string): void => {
    const app = (window as any).app;
    const fabricCanvas = app?.canvasManager?.fabricCanvas;
    const metadata = app?.metadataManager;
    if (!fabricCanvas || !metadata || !assemblyId) return;
    const removable =
      fabricCanvas
        .getObjects?.()
        .filter(
          (obj: any) =>
            obj?.customData?.sectionalSeed === true &&
            obj?.customData?.sectionalAssemblyId === assemblyId
        ) || [];
    removable.forEach((obj: any) => {
      const strokeLabel = obj.strokeMetadata?.strokeLabel;
      const imageLabel = obj.strokeMetadata?.imageLabel || viewId;
      if (strokeLabel) {
        if (metadata.vectorStrokesByImage?.[imageLabel])
          delete metadata.vectorStrokesByImage[imageLabel][strokeLabel];
        if (metadata.strokeVisibilityByImage?.[imageLabel])
          delete metadata.strokeVisibilityByImage[imageLabel][strokeLabel];
        if (metadata.strokeLabelVisibility?.[imageLabel])
          delete metadata.strokeLabelVisibility[imageLabel][strokeLabel];
        if (metadata.strokeMeasurements?.[imageLabel])
          delete metadata.strokeMeasurements[imageLabel][strokeLabel];
        if (Array.isArray((window as any).lineStrokesByImage?.[imageLabel])) {
          const list = (window as any).lineStrokesByImage[imageLabel];
          const index = list.indexOf(strokeLabel);
          if (index > -1) list.splice(index, 1);
        }
        app?.tagManager?.removeTag?.(strokeLabel, imageLabel);
      }
      fabricCanvas.remove(obj);
    });
    if (removable.length) fabricCanvas.requestRenderAll?.();
  };

  const updateHandoffButtons = () => {
    const updateButton = dialog.querySelector('[data-sb-update]') as HTMLButtonElement | null;
    const syncButton = dialog.querySelector('[data-sb-sync-canvas]') as HTMLButtonElement | null;
    const manager = (window as any).app?.projectManager;
    const targetView = assemblyId
      ? manager?.getProjectMetadata?.()?.sectionalAssemblies?.[assemblyId]?.imageViewId || ''
      : '';
    if (updateButton) updateButton.hidden = !(targetView && manager?.views?.[targetView]);
    if (syncButton) syncButton.hidden = !(targetView && manager?.views?.[targetView]);
  };

  dialog.querySelector('[data-sb-sync-canvas]')?.addEventListener('click', () => {
    if (syncBuilderFromCanvas()) {
      render();
      (window as any).showStatusMessage?.('Builder synced from canvas', 'success');
    } else {
      (window as any).showStatusMessage?.('No live sectional pieces found on canvas', 'warning');
    }
  });

  // ── Parametric measurement system ──────────────────────────────────────
  let parametricListenerRegistered = false;
  let measurementListenerRegistered = false;
  let applyingMeasurementToGeometry = false;
  const getObjectAssemblyId = (object: any): string =>
    String(object?.customData?.sectionalAssemblyId || object?.customData?.assemblyId || '');

  const fabricObjectGeometry = (object: any): LiveSectionalPieceGeometry | null => {
    const points = object?.getCoords?.();
    const cd = object?.customData;
    if (!Array.isArray(points) || points.length < 4 || !cd?.pieceId || !cd?.kind) return null;
    return {
      pieceId: String(cd.pieceId),
      kind: cd.kind,
      mirrored: cd.mirrored === true,
      corners: points.slice(0, 4).map((point: any) => ({
        x: Number(point.x) || 0,
        y: Number(point.y) || 0,
      })) as [SectionalPoint, SectionalPoint, SectionalPoint, SectionalPoint],
    };
  };

  const setFabricLineSegment = (
    line: any,
    segment: { start: SectionalPoint; end: SectionalPoint }
  ): void => {
    line.set?.({
      x1: segment.start.x,
      y1: segment.start.y,
      x2: segment.end.x,
      y2: segment.end.y,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
    });
    line._setWidthHeight?.();
    line.setCoords?.();
    line.dirty = true;
  };

  const getFabricObjectsBounds = (objects: any[]): SectionalRect | null => {
    const rects = objects
      .map(object => object?.getBoundingRect?.(true, true))
      .filter(
        (rect: any) =>
          rect &&
          Number.isFinite(rect.left) &&
          Number.isFinite(rect.top) &&
          Number.isFinite(rect.width) &&
          Number.isFinite(rect.height)
      );
    if (!rects.length) return null;
    const left = Math.min(...rects.map((rect: any) => rect.left));
    const top = Math.min(...rects.map((rect: any) => rect.top));
    const right = Math.max(...rects.map((rect: any) => rect.left + rect.width));
    const bottom = Math.max(...rects.map((rect: any) => rect.top + rect.height));
    return { left, top, width: right - left, height: bottom - top };
  };

  const refreshLiveAssembly = (assemblyIdToRefresh: string, commitValues: boolean): void => {
    const app = (window as any).app;
    const canvas = app?.canvasManager?.fabricCanvas;
    const metadata = app?.metadataManager;
    if (!canvas || !assemblyIdToRefresh) return;
    const objects = canvas.getObjects?.() || [];
    const groups = objects.filter(
      (object: any) =>
        object?.customData?.sectionalPiece === true &&
        getObjectAssemblyId(object) === assemblyIdToRefresh
    );
    if (!groups.length) return;

    groups.forEach((group: any) => {
      group.setCoords?.();
      const geometry = fabricObjectGeometry(group);
      if (!geometry) return;
      const cd = group.customData;
      const widthCm = computeScaledDimension(
        Number(cd.baseWidthCm) || 1,
        (Number(group.scaleX) || 1) / (Number(cd.initialScaleX) || 1)
      );
      const depthCm = computeScaledDimension(
        Number(cd.baseDepthCm) || 1,
        (Number(group.scaleY) || 1) / (Number(cd.initialScaleY) || 1)
      );
      objects
        .filter(
          (object: any) =>
            object?.customData?.sectionalSeed === true &&
            object?.customData?.sectionalPieceId === cd.pieceId &&
            getObjectAssemblyId(object) === assemblyIdToRefresh
        )
        .forEach((stroke: any) => {
          const dimension = stroke.customData?.measuredDimension;
          if (dimension !== 'width' && dimension !== 'depth') return;
          // Keep module dimensions on a distinct annotation rail beneath the
          // overall-width rail so their tags remain readable at every zoom.
          setFabricLineSegment(stroke, getLiveMeasurementSegment(geometry, dimension, 30));
          const strokeLabel = stroke.strokeMetadata?.strokeLabel;
          const imageLabel = stroke.strokeMetadata?.imageLabel;
          if (commitValues && strokeLabel && imageLabel) {
            const valueCm = dimension === 'width' ? widthCm : depthCm;
            metadata?.parseAndSaveMeasurement?.(imageLabel, strokeLabel, `${valueCm} cm`);
          }
          if (strokeLabel && imageLabel) {
            app?.tagManager?.updateConnector?.(strokeLabel, imageLabel, { repositionTag: true });
          }
        });
    });

    const currentBounds = getFabricObjectsBounds(groups);
    const baseline = groups[0]?.customData?.initialAssemblyBounds as SectionalRect | undefined;
    if (currentBounds && baseline) {
      const metrics = getLiveAssemblyMetrics(
        currentBounds,
        baseline,
        Number(groups[0].customData?.assemblyBaseWidthCm) || 1,
        Number(groups[0].customData?.assemblyBaseDepthCm) || 1
      );
      objects
        .filter(
          (object: any) =>
            object?.customData?.sectionalOverall === true &&
            getObjectAssemblyId(object) === assemblyIdToRefresh
        )
        .forEach((stroke: any) => {
          const dimension = stroke.customData?.measuredDimension;
          const gap = dimension === 'overall-width' ? 104 : 42;
          const segment =
            dimension === 'overall-width'
              ? {
                  start: { x: currentBounds.left, y: currentBounds.top - gap },
                  end: { x: currentBounds.left + currentBounds.width, y: currentBounds.top - gap },
                }
              : {
                  start: { x: currentBounds.left - gap, y: currentBounds.top },
                  end: { x: currentBounds.left - gap, y: currentBounds.top + currentBounds.height },
                };
          setFabricLineSegment(stroke, segment);
          const strokeLabel = stroke.strokeMetadata?.strokeLabel;
          const imageLabel = stroke.strokeMetadata?.imageLabel;
          if (commitValues && strokeLabel && imageLabel) {
            const valueCm = dimension === 'overall-width' ? metrics.widthCm : metrics.depthCm;
            metadata?.parseAndSaveMeasurement?.(imageLabel, strokeLabel, `${valueCm} cm`);
          }
          if (strokeLabel && imageLabel) {
            app?.tagManager?.updateConnector?.(strokeLabel, imageLabel, { repositionTag: true });
          }
        });
    }
    canvas.requestRenderAll?.();
  };

  const persistLiveAssemblyTransforms = (assemblyIdToPersist: string): void => {
    const app = (window as any).app;
    const manager = app?.projectManager;
    const canvas = app?.canvasManager?.fabricCanvas;
    const worldRect = app?.canvasManager?.getBackgroundWorldRect?.();
    if (!manager?.setProjectMetadata || !canvas || !worldRect || !assemblyIdToPersist) return;
    const transforms: Record<string, NormalizedLiveSectionalTransform> = {};
    canvas
      .getObjects?.()
      .filter(
        (object: any) =>
          object?.customData?.sectionalPiece === true &&
          getObjectAssemblyId(object) === assemblyIdToPersist
      )
      .forEach((object: any) => {
        const cd = object.customData;
        transforms[String(cd.pieceId)] = normalizeLiveSectionalTransform(
          {
            left: Number(object.left) || 0,
            top: Number(object.top) || 0,
            scaleX: Number(object.scaleX) || 1,
            scaleY: Number(object.scaleY) || 1,
            angle: Number(object.angle) || 0,
          },
          worldRect,
          Number(cd.initialScaleX) || 1,
          Number(cd.initialScaleY) || 1
        );
      });
    const metadata = manager.getProjectMetadata?.() || {};
    const previous = metadata.sectionalAssemblies?.[assemblyIdToPersist];
    if (!previous) return;
    manager.setProjectMetadata({
      sectionalAssemblies: {
        ...(metadata.sectionalAssemblies || {}),
        [assemblyIdToPersist]: {
          ...previous,
          liveTransforms: transforms,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  };

  const applyMeasurementToLiveAssembly = (detail: Record<string, any>): void => {
    if (detail.source !== 'measurement' || applyingMeasurementToGeometry) return;
    const app = (window as any).app;
    const canvas = app?.canvasManager?.fabricCanvas;
    const metadata = app?.metadataManager;
    const strokeLabel = String(detail.strokeLabel || '').trim();
    const imageLabel = String(detail.imageLabel || '').trim();
    if (!canvas || !metadata || !strokeLabel || !imageLabel) return;

    const objects = canvas.getObjects?.() || [];
    const stroke =
      metadata.vectorStrokesByImage?.[imageLabel]?.[strokeLabel] ||
      objects.find(
        (object: any) =>
          object?.customData?.sectionalSeed === true &&
          object?.strokeMetadata?.strokeLabel === strokeLabel &&
          object?.strokeMetadata?.imageLabel === imageLabel
      );
    if (!stroke?.customData?.sectionalSeed) return;

    const targetCm = Number(metadata.getMeasurement?.(imageLabel, strokeLabel)?.cm);
    if (!(targetCm > 0)) return;
    const assemblyIdForEdit = getObjectAssemblyId(stroke);
    const groups = objects.filter(
      (object: any) =>
        object?.customData?.sectionalPiece === true &&
        getObjectAssemblyId(object) === assemblyIdForEdit
    );
    if (!groups.length) return;

    const dimension = String(stroke.customData?.measuredDimension || '');
    applyingMeasurementToGeometry = true;
    try {
      if (stroke.customData?.sectionalOverall === true) {
        const bounds = getFabricObjectsBounds(groups);
        const baseline = groups[0]?.customData?.initialAssemblyBounds as SectionalRect | undefined;
        if (!bounds || !baseline) return;
        const metrics = getLiveAssemblyMetrics(
          bounds,
          baseline,
          Number(groups[0].customData?.assemblyBaseWidthCm) || 1,
          Number(groups[0].customData?.assemblyBaseDepthCm) || 1
        );
        const horizontal = dimension === 'overall-width';
        const currentCm = horizontal ? metrics.widthCm : metrics.depthCm;
        const ratio = targetCm / Math.max(currentCm, 0.001);
        groups.forEach((group: any) => {
          const angle = (((Number(group.angle) || 0) % 180) + 180) % 180;
          const quarterTurn = Math.abs(angle - 90) < 0.01;
          const scaleKey = horizontal
            ? quarterTurn
              ? 'scaleY'
              : 'scaleX'
            : quarterTurn
              ? 'scaleX'
              : 'scaleY';
          const positionKey = horizontal ? 'left' : 'top';
          const origin = horizontal ? bounds.left : bounds.top;
          group.set({
            [positionKey]: origin + ((Number(group[positionKey]) || 0) - origin) * ratio,
            [scaleKey]: (Number(group[scaleKey]) || 1) * ratio,
          });
          group.setCoords?.();
        });
      } else {
        const pieceId = String(stroke.customData?.sectionalPieceId || '');
        const group = groups.find(
          (candidate: any) => String(candidate?.customData?.pieceId || '') === pieceId
        );
        if (!group) return;
        const before = group.getBoundingRect?.(true, true);
        const angle = (((Number(group.angle) || 0) % 180) + 180) % 180;
        const quarterTurn = Math.abs(angle - 90) < 0.01;
        const horizontal = dimension === 'width';
        const scaleKey = horizontal
          ? quarterTurn
            ? 'scaleY'
            : 'scaleX'
          : quarterTurn
            ? 'scaleX'
            : 'scaleY';
        const baseCm = horizontal
          ? quarterTurn
            ? group.customData?.baseDepthCm
            : group.customData?.baseWidthCm
          : quarterTurn
            ? group.customData?.baseWidthCm
            : group.customData?.baseDepthCm;
        const initialScale =
          scaleKey === 'scaleX'
            ? Number(group.customData?.initialScaleX) || 1
            : Number(group.customData?.initialScaleY) || 1;
        group.set({
          [scaleKey]: computeScaleForDimension(baseCm, initialScale, targetCm),
        });
        group.setCoords?.();

        // Preserve butt joins when one module becomes wider or narrower.
        const after = group.getBoundingRect?.(true, true);
        if (horizontal && before && after) {
          const delta = Number(after.width) - Number(before.width);
          const oldRight = Number(before.left) + Number(before.width);
          groups.forEach((candidate: any) => {
            if (candidate === group) return;
            const rect = candidate.getBoundingRect?.(true, true);
            const overlapsRow =
              rect && rect.top < before.top + before.height && rect.top + rect.height > before.top;
            if (overlapsRow && rect.left >= oldRight - 2) {
              candidate.set({ left: (Number(candidate.left) || 0) + delta });
              candidate.setCoords?.();
            }
          });
        }
      }
      refreshLiveAssembly(assemblyIdForEdit, true);
      persistLiveAssemblyTransforms(assemblyIdForEdit);
      canvas.requestRenderAll?.();
    } finally {
      applyingMeasurementToGeometry = false;
    }
  };

  const ensureParametricListener = () => {
    const canvas = (window as any).app?.canvasManager?.fabricCanvas;
    if (!canvas) return;
    if (measurementListenerRegistered === false) {
      measurementListenerRegistered = true;
      window.addEventListener('openpaint:project-mutated', (event: Event) => {
        applyMeasurementToLiveAssembly((event as CustomEvent).detail || {});
      });
    }
    if (parametricListenerRegistered) return;
    parametricListenerRegistered = true;
    const refreshFromEvent = (event: any, commitValues: boolean) => {
      const target = event?.target;
      if (!target?.customData?.sectionalPiece || applyingMeasurementToGeometry) return;
      const id = getObjectAssemblyId(target);
      refreshLiveAssembly(id, commitValues);
      if (commitValues) persistLiveAssemblyTransforms(id);
    };
    canvas.on('object:moving', (event: any) => {
      const target = event?.target;
      if (!target?.customData?.sectionalPiece) return;
      target.setCoords?.();
      const movingGeometry = fabricObjectGeometry(target);
      if (movingGeometry) {
        const zoom = Number(canvas.getZoom?.()) || 1;
        const candidates = (canvas.getObjects?.() || [])
          .filter(
            (object: any) =>
              object !== target &&
              object?.customData?.sectionalPiece === true &&
              getObjectAssemblyId(object) === getObjectAssemblyId(target)
          )
          .map(fabricObjectGeometry)
          .filter(Boolean) as LiveSectionalPieceGeometry[];
        const snap = findLiveSectionalSnap(movingGeometry, candidates, 24 / zoom);
        if (snap) {
          target.set({
            left: (Number(target.left) || 0) + snap.delta.x,
            top: (Number(target.top) || 0) + snap.delta.y,
            borderColor: '#198b71',
          });
          target.setCoords?.();
        } else {
          target.set({ borderColor: '#2563eb' });
        }
      }
      refreshFromEvent(event, false);
    });
    canvas.on('object:scaling', (event: any) => refreshFromEvent(event, false));
    canvas.on('object:rotating', (event: any) => refreshFromEvent(event, false));
    canvas.on('object:modified', (event: any) => refreshFromEvent(event, true));
  };

  /**
   * Import the assembly as live, manipulatable Fabric objects — each piece is
   * a scalable Group and each measurement stroke is linked to its piece so
   * values update parametrically when the user resizes.
   */
  const importLiveAssembly = async (
    viewId: string,
    piecesArr: SectionalPiece[],
    themeId: SectionalThemeId,
    assyId: string
  ) => {
    const app = (window as any).app;
    const projectManager = app?.projectManager;
    const canvas = app?.canvasManager?.fabricCanvas;
    const metadata = app?.metadataManager;
    if (!viewId || !projectManager || !canvas || !metadata) return;

    if (projectManager.currentViewId !== viewId) {
      await projectManager.switchView?.(viewId);
    }
    const worldRect = app.canvasManager?.getBackgroundWorldRect?.();
    if (!worldRect) return;

    const viewBox = getSectionalPlanViewBox(piecesArr);
    const activeTheme = SECTIONAL_THEMES[themeId] || SECTIONAL_THEMES[DEFAULT_THEME];
    const scaleX = worldRect.width / viewBox.width;
    const scaleY = worldRect.height / viewBox.height;
    const imageLabel = String(
      metadata.resolveActiveImageLabel?.(viewId) || metadata.normalizeImageLabel?.(viewId) || viewId
    ).trim();
    // Sectional plans contain several adjacent dimensions. A compact,
    // image-scoped tag size keeps long converted values inside their own
    // module without changing tag sizing elsewhere in the project.
    app?.tagManager?.persistTagSizeToMetadata?.(16, imageLabel);
    app?.tagManager?.syncTagSizeFromMetadata?.(imageLabel);

    const savedRecord = projectManager.getProjectMetadata?.()?.sectionalAssemblies?.[assyId] as
      | SectionalAssemblyRecord
      | undefined;
    const savedTransforms = savedRecord?.liveTransforms || {};
    const pieceGroups: any[] = [];

    // Create piece groups at their canonical mapping first. The canonical
    // bounds become the stable scale reference for overall dimensions.
    piecesArr.forEach(piece => {
      const group = createPieceFabricGroup(piece, activeTheme, assyId);
      const svgX = GRID_ORIGIN_X + piece.col * CELL;
      const svgY = GRID_ORIGIN_Y + piece.row * CELL;
      const worldPos = planPointToWorld(svgX, svgY, viewBox, worldRect);
      group.set({ left: worldPos.x, top: worldPos.y, scaleX, scaleY });
      group.customData.initialScaleX = scaleX;
      group.customData.initialScaleY = scaleY;
      canvas.add(group);
      group.setCoords();
      pieceGroups.push(group);
    });

    const initialAssemblyBounds = getFabricObjectsBounds(pieceGroups);
    const baseAssembly = calculateSectionalBounds(piecesArr);
    pieceGroups.forEach(group => {
      group.customData.initialAssemblyBounds = initialAssemblyBounds
        ? { ...initialAssemblyBounds }
        : undefined;
      group.customData.assemblyBaseWidthCm = baseAssembly.width;
      group.customData.assemblyBaseDepthCm = baseAssembly.depth;
      const saved = savedTransforms[String(group.customData.pieceId)];
      if (saved) {
        group.set(
          restoreLiveSectionalTransform(
            saved,
            worldRect,
            Number(group.customData.initialScaleX) || 1,
            Number(group.customData.initialScaleY) || 1
          )
        );
        group.setCoords?.();
      }
    });

    const addLinkedMeasurement = (
      customData: Record<string, unknown>,
      segment: { start: SectionalPoint; end: SectionalPoint },
      valueCm: number,
      suggestedTag: string
    ): any | null => {
      const strokeLabel =
        metadata.resolveAvailableStrokeLabel?.(imageLabel, suggestedTag, 'letters+numbers') ||
        metadata.getNextLabel?.(imageLabel);
      if (!strokeLabel) return null;
      const line = new fabric.Line(
        [segment.start.x, segment.start.y, segment.end.x, segment.end.y],
        {
          stroke: '#7a8886',
          strokeWidth: 1.5,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          perPixelTargetFind: true,
          padding: 8,
          objectCaching: false,
        }
      );
      line.arrowSettings = {
        startArrow: false,
        endArrow: false,
        arrowSize: 8,
        arrowStyle: 'triangular',
        arrowSpread: 1,
        ghostBaseline: false,
        dimensionOffset: 0,
        lineStyle: 'solid',
        tapeTickSpacing: 1,
      };
      line.customData = {
        sectionalSeed: true,
        sectionalAssemblyId: assyId,
        ...customData,
      };
      canvas.add(line);
      line.setCoords?.();
      metadata.attachMetadata?.(line, imageLabel, strokeLabel);
      metadata.parseAndSaveMeasurement?.(imageLabel, strokeLabel, `${valueCm} cm`);
      app.tagManager?.createTagForStroke?.(strokeLabel, imageLabel, line);
      return line;
    };

    // Import the same concise measurement set shown in the builder: overall
    // width/depth plus one width per occupied module column. This avoids a
    // second, noisier dimension model appearing after handoff.
    getSectionalMeasurementSeeds(piecesArr).forEach(seed => {
      const start = planPointToWorld(seed.x1, seed.y1, viewBox, worldRect);
      const end = planPointToWorld(seed.x2, seed.y2, viewBox, worldRect);
      addLinkedMeasurement(
        seed.role === 'column-width'
          ? {
              sectionalPieceId: seed.pieceId,
              measuredDimension: 'width',
              sectionalSeedRole: seed.role,
            }
          : {
              sectionalOverall: true,
              measuredDimension: seed.role,
              sectionalSeedRole: seed.role,
            },
        { start, end },
        seed.valueCm,
        seed.suggestedTag
      );
    });

    refreshLiveAssembly(assyId, true);
    persistLiveAssemblyTransforms(assyId);

    canvas.requestRenderAll();
    app.historyManager?.saveState?.({ force: true, reason: 'sectional:import-live' });
  };

  /** Remove live piece Groups and their linked measurement strokes for this assembly. */
  const removeLiveAssembly = (viewId: string): void => {
    const app = (window as any).app;
    const fabricCanvas = app?.canvasManager?.fabricCanvas;
    const metadata = app?.metadataManager;
    if (!fabricCanvas || !metadata || !assemblyId) return;
    const removable =
      fabricCanvas
        .getObjects?.()
        .filter(
          (obj: any) =>
            (obj?.customData?.sectionalPiece === true || obj?.customData?.sectionalSeed === true) &&
            (obj?.customData?.sectionalAssemblyId === assemblyId ||
              obj?.customData?.assemblyId === assemblyId)
        ) || [];
    removable.forEach((obj: any) => {
      const strokeLabel = obj.strokeMetadata?.strokeLabel;
      const imageLabel = obj.strokeMetadata?.imageLabel || viewId;
      if (strokeLabel) {
        if (metadata.vectorStrokesByImage?.[imageLabel])
          delete metadata.vectorStrokesByImage[imageLabel][strokeLabel];
        if (metadata.strokeVisibilityByImage?.[imageLabel])
          delete metadata.strokeVisibilityByImage[imageLabel][strokeLabel];
        if (metadata.strokeLabelVisibility?.[imageLabel])
          delete metadata.strokeLabelVisibility[imageLabel][strokeLabel];
        if (metadata.strokeMeasurements?.[imageLabel])
          delete metadata.strokeMeasurements[imageLabel][strokeLabel];
        if (Array.isArray((window as any).lineStrokesByImage?.[imageLabel])) {
          const list = (window as any).lineStrokesByImage[imageLabel];
          const index = list.indexOf(strokeLabel);
          if (index > -1) list.splice(index, 1);
        }
        app?.tagManager?.removeTag?.(strokeLabel, imageLabel);
      }
      fabricCanvas.remove(obj);
    });
    if (removable.length) fabricCanvas.requestRenderAll?.();
  };

  dialog.querySelector('[data-sb-update]')?.addEventListener('click', async event => {
    const manager = (window as any).app?.projectManager;
    const targetView = assemblyId
      ? manager?.getProjectMetadata?.()?.sectionalAssemblies?.[assemblyId]?.imageViewId || ''
      : '';
    if (!pieces.length || !manager || !targetView || !manager.views?.[targetView]) return;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Updating…';
    try {
      if (manager.currentViewId !== targetView) {
        await manager.switchView?.(targetView);
      }
      removeLiveAssembly(targetView);
      await importLiveAssembly(targetView, pieces, theme, assemblyId || '');
      ensureParametricListener();
      persistAssembly(targetView);
      dialog.close();
      (window as any).showStatusMessage?.('Sectional updated on canvas', 'success');
    } catch (error) {
      console.error('[SectionalBuilder] Could not update project image', error);
      (window as any).showStatusMessage?.('Could not update sectional image', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Update project image';
    }
  });

  dialog.querySelector('[data-sb-3d]')?.addEventListener('click', () => {
    if (!pieces.length) return;
    dialog.close();
    window.dispatchEvent(
      new CustomEvent('openpaint:sofa3d-open', {
        detail: { sectional: { name: 'My sectional', pieces, style: productStyle } },
      })
    );
  });

  dialog.querySelector('[data-sb-use]')?.addEventListener('click', async event => {
    if (!pieces.length) return;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Creating live objects…';
    try {
      const blankFile = await createBlankPng();
      const results = await (window as any).app?.uploadManager?.handleFiles([blankFile]);
      const success = Array.isArray(results) ? results.find((r: any) => r?.success) : null;
      if (!success) throw new Error('Image import did not complete');
      persistAssembly(success.viewId);
      await importLiveAssembly(success.viewId, pieces, theme, assemblyId || '');
      ensureParametricListener();
      dialog.close();
      (window as any).showStatusMessage?.(
        'Live sectional added — drag, resize, and measure directly on the canvas',
        'success'
      );
    } catch (error) {
      console.error('[SectionalBuilder] Could not create project image', error);
      (window as any).showStatusMessage?.('Could not add sectional to project', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Use plan in project';
    }
  });

  dialog.querySelector('[data-sb-use-product]')?.addEventListener('click', async event => {
    if (!pieces.length || viewMode === 'plan') return;
    const selectedView = viewMode;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Adding product view…';
    try {
      const svg = serializeSectionalProductSvg(
        pieces,
        assemblyName,
        selectedView,
        theme,
        productStyle
      );
      const filename =
        selectedView === 'front-left' ? 'sectional-left-45.png' : 'sectional-right-45.png';
      const file = await svgToPngFile(svg, filename);
      const results = await (window as any).app?.uploadManager?.handleFiles([file]);
      const success = Array.isArray(results)
        ? results.find((result: any) => result?.success)
        : null;
      if (!success) throw new Error('Product view import did not complete');
      persistAssembly();
      dialog.close();
      (window as any).showStatusMessage?.(
        `${selectedView === 'front-left' ? 'Left' : 'Right'} 45° product view added`,
        'success'
      );
    } catch (error) {
      console.error('[SectionalBuilder] Could not add product view', error);
      (window as any).showStatusMessage?.('Could not add product view', 'error');
    } finally {
      button.disabled = false;
      button.textContent =
        selectedView === 'front-right' ? 'Add right 45° view' : 'Add left 45° view';
    }
  });

  // Register once during app startup as well as after imports so sectional
  // objects restored from a saved project remain parametric immediately.
  ensureParametricListener();
  render();
}
