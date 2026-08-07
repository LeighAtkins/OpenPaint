declare const fabric: any;

type PieceKind =
  | 'left-arm'
  | 'seat'
  | 'corner'
  | 'chaise'
  | 'right-arm'
  | 'ottoman'
  | 'left-arm-chaise'
  | 'right-arm-chaise';
type ConnectorSide = 'top' | 'right' | 'bottom' | 'left';
type SectionalArmSide = 'left' | 'right';
type SectionalOpenEdge = 'front' | 'rear' | 'left' | 'right';
export type SectionalViewMode = 'plan' | 'front-left' | 'front-right';
export type SectionalArmStyle = 'square' | 'round' | 'wedge';
export type SectionalBackStyle = 'high' | 'short' | 'curved';
export type SectionalCushionStyle = 'boxed' | 'knife' | 'rounded';
export type SectionalBaseStyle = 'snug' | 'long-skirt' | 'loose-fit' | 'straight-skirt';

export interface SectionalProductStyle {
  arm: SectionalArmStyle;
  back: SectionalBackStyle;
  cushion: SectionalCushionStyle;
  base: SectionalBaseStyle;
}

export const DEFAULT_SECTIONAL_PRODUCT_STYLE: SectionalProductStyle = {
  arm: 'round',
  back: 'high',
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
  backStyle?: SectionalBackStyle;
  cushionStyle?: SectionalCushionStyle;
  baseStyle?: SectionalBaseStyle;
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
    body: '#d8ddd7',
    cushion: '#f2f4f1',
    cushionStroke: '#667273',
    accent: '#596465',
    outline: '#2f3a3b',
  },
  charcoal: {
    name: 'Charcoal',
    body: '#515a5b',
    cushion: '#737e7f',
    cushionStroke: '#3a4445',
    accent: '#2e3637',
    outline: '#1d2425',
  },
  navy: {
    name: 'Navy',
    body: '#53647f',
    cushion: '#7488a8',
    cushionStroke: '#3b4b66',
    accent: '#32405a',
    outline: '#232e42',
  },
  terracotta: {
    name: 'Terracotta',
    body: '#b57e66',
    cushion: '#d1a48f',
    cushionStroke: '#8a5c49',
    accent: '#7d5340',
    outline: '#59392c',
  },
  forest: {
    name: 'Forest',
    body: '#5f7d69',
    cushion: '#819f8c',
    cushionStroke: '#476353',
    accent: '#3f584a',
    outline: '#2c3f35',
  },
  sand: {
    name: 'Sand',
    body: '#d7cab1',
    cushion: '#ede4d3',
    cushionStroke: '#a3937a',
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

/** Map the full assembly to CW products and compute the total. */
export function getAssemblyPricing(
  pieces: SectionalPiece[],
  country: SectionalPricingCountry = DEFAULT_PRICING_COUNTRY,
  fabric: SectionalPricingFabric = DEFAULT_PRICING_FABRIC,
  catalog: SectionalPricingCatalog = CW_US_FABRIC_PRICES
): AssemblyPricing {
  const items: AssemblyPricingItem[] = [];
  let total = 0;
  pieces.forEach((piece, index) => {
    const product = getPiecePricing(piece);
    if (product) {
      const localized = catalog[product.handle]?.[fabric];
      const pricedProduct = localized
        ? {
            ...product,
            price: localized.price,
            url: localizeCwProductUrl(localized.url || product.url, country),
          }
        : { ...product, url: localizedCwUrl(product.handle, country) };
      items.push({ pieceIndex: index, pieceName: PIECES[piece.kind].name, product: pricedProduct });
      total += pricedProduct.price;
    }
  });
  return { items, total, currency: SECTIONAL_PRICING_MARKETS[country].currency };
}

export function createSectionalPreset(
  name: 'sofa' | 'chaise' | 'corner' | 'two-seat' | 'l-chaise' | 'ottoman-set'
): SectionalPiece[] {
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
  return { width: swapped ? spec.depth : spec.width, depth: swapped ? spec.width : spec.depth };
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
  const hasLeftArm = piece.kind === 'left-arm' || piece.kind === 'left-arm-chaise';
  const hasRightArm = piece.kind === 'right-arm' || piece.kind === 'right-arm-chaise';
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
  } else if (piece.kind === 'ottoman') {
    body = `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="8" ${common}/><rect x="20" y="20" width="${w - 40}" height="${h - 40}" rx="6" ${cushion}/>`;
  } else {
    const arm = hasLeftArm
      ? `<path d="M8 17V${armEnd}" stroke="${theme.accent}" stroke-width="14"/>`
      : hasRightArm
        ? `<path d="M${w - 8} 17V${armEnd}" stroke="${theme.accent}" stroke-width="14"/>`
        : '';
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
  role: 'overall-width' | 'overall-depth' | 'column-width';
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
  return seeds;
}

/** Map a plan-SVG point into canvas world coordinates via the placed image rect. */
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

function resolveProductStyle(
  piece: SectionalPiece,
  fallback: SectionalProductStyle = DEFAULT_SECTIONAL_PRODUCT_STYLE
): SectionalProductStyle {
  return {
    arm: piece.armStyle || fallback.arm,
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
  // Cabinet projection for a true 45-degree product angle: front faces stay
  // true-shape (level, like a camera orbiting the sofa — never a tilted
  // object), the depth axis recedes at 45 degrees, and verticals stay
  // vertical. The projector direction L = (-0.72, 1, 0.72) also agrees with
  // the face culling (south + west + top faces): the previous form
  // (sx = -x + 0.72y) collapsed along (+0.72, 1, 0.4408), an east-facing
  // camera — the exact opposite of the culled faces. That "impossible camera"
  // made abutting modules falsely overlap on screen (the exploded L-shape)
  // and made no linear depth functional able to sort it.
  const direction = viewMode === 'front-left' ? -1 : 1;
  const raw = (point: ProductPoint3D): SectionalPoint => {
    const consistentViewX = point.x - bounds.x0 + (point.y - bounds.y0) * 0.72;
    return {
      x: direction * consistentViewX,
      y: (point.y - bounds.y0) * 0.72 - point.z,
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
  const bodyTop = 38;
  // The seat cushion's front face runs right down to the base-front junction
  // (no bare body-top strip showing), as in the CW reference renders.
  const seatBottom = style.cushion === 'knife' ? 44 : 40;
  const seatTop = style.cushion === 'knife' ? 52 : 59;
  const structuralBackTop = style.back === 'short' ? 96 : style.back === 'curved' ? 119 : 128;
  // Loose back cushions crown a few pixels above the frame rails, the way
  // they sit proud in the CW reference renders.
  const looseBackTop = style.back === 'short' ? 100 : style.back === 'curved' ? 124 : 133;
  const armTop = style.arm === 'wedge' ? 84 : 96;
  const inset = style.cushion === 'rounded' ? 11 : 9;
  const isPerpendicularReturn = ((piece.rotation % 180) + 180) % 180 !== 0;
  const armSide = capabilities.armSides[0] || '';
  // A roll/square arm on a 105 cm module is a real volume (~22 cm), not a
  // 15 px appliqué. The seat rectangle shrinks accordingly; the saved module
  // footprint is unchanged.
  const armThickness = 29;
  const armInnerX = armSide === 'left' ? armThickness : armSide === 'right' ? w - armThickness : 0;
  const bodyLeftX = 0;
  const bodyRightX = w;
  const seatLeftX = armSide === 'left' ? armInnerX : 0;
  const seatRightX = armSide === 'right' ? armInnerX : w;
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
  const leftContentInset = seatLeftX + (backJoinsCorner ? 3 : inset);
  const rightContentX = seatRightX - inset;
  const leftBackInset = seatLeftX + (backJoinsCorner ? 4 : 11);
  const rightBackX = seatRightX - 11;
  const frontY = d;
  const rearY = 0;
  // Tuck the seat cushion under the loose back cushion. The overlap makes the
  // upholstery read as one assembly instead of two disconnected rectangles.
  const seatRear = Math.min(23, d * 0.2);
  // An open seat cushion sits proud of the base front edge, as in the CW
  // reference renders; a connected one tucks to the joint.
  const seatFront = frontY - (frontConnected ? 3 : -2);
  const topFace = productPolygon(projection, [
    p(bodyLeftX, rearY, bodyTop),
    p(bodyRightX, rearY, bodyTop),
    p(bodyRightX, frontY, bodyTop),
    p(bodyLeftX, frontY, bodyTop),
  ]);
  const frontFace = productPolygon(projection, [
    p(bodyLeftX, frontY, 4),
    p(bodyRightX, frontY, 4),
    p(bodyRightX, frontY, bodyTop),
    p(bodyLeftX, frontY, bodyTop),
  ]);
  const rearFace = productPolygon(projection, [
    p(bodyLeftX, rearY, 4),
    p(bodyRightX, rearY, 4),
    p(bodyRightX, rearY, bodyTop),
    p(bodyLeftX, rearY, bodyTop),
  ]);
  const leftSideFace = productPolygon(projection, [
    p(bodyLeftX, rearY, 4),
    p(bodyLeftX, frontY, 4),
    p(bodyLeftX, frontY, bodyTop),
    p(bodyLeftX, rearY, bodyTop),
  ]);
  const rightSideFace = productPolygon(projection, [
    p(bodyRightX, rearY, 4),
    p(bodyRightX, frontY, 4),
    p(bodyRightX, frontY, bodyTop),
    p(bodyRightX, rearY, bodyTop),
  ]);
  // Cushion silhouettes vary by cut: boxed stays crisp, knife-edge is pinched
  // at the front corners, and rounded bellies over the front edge.
  const cushionTopCorners: ProductPoint3D[] = [
    p(leftContentInset, seatRear, seatTop),
    p(rightContentX, seatRear, seatTop),
    p(rightContentX, seatFront, seatTop),
    p(leftContentInset, seatFront, seatTop),
  ];
  const cushionTop = productPolygon(projection, cushionTopCorners);
  const seatCushionTopElement = (fill: string, strokeWidth: number): string => {
    if (style.cushion === 'rounded') {
      const [rearLeft, rearRight, frontRight, frontLeft] = cushionTopCorners.map(corner =>
        projection.point(corner)
      );
      const belly = projection.point(
        p((leftContentInset + rightContentX) / 2, seatFront + 5, seatTop)
      );
      const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      return `<path class="sb-seat-cushion" d="M${s(rearLeft)}L${s(rearRight)}L${s(frontRight)}Q${s(belly)} ${s(frontLeft)}Z" fill="${fill}" stroke="${theme.cushionStroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    if (style.cushion === 'knife') {
      const pinch = 7;
      const hex = productPolygon(projection, [
        p(leftContentInset, seatRear, seatTop),
        p(rightContentX, seatRear, seatTop),
        p(rightContentX, seatFront - 4, seatTop),
        p(rightContentX - pinch, seatFront, seatTop),
        p(leftContentInset + pinch, seatFront, seatTop),
        p(leftContentInset, seatFront - 4, seatTop),
      ]);
      return `<polygon class="sb-seat-cushion" points="${hex}" fill="${fill}" stroke="${theme.cushionStroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    return `<polygon class="sb-seat-cushion" points="${cushionTop}" fill="${fill}" stroke="${theme.cushionStroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
  };
  const cushionFront = productPolygon(projection, [
    p(leftContentInset, seatFront, seatBottom),
    p(rightContentX, seatFront, seatBottom),
    p(rightContentX, seatFront, seatTop),
    p(leftContentInset, seatFront, seatTop),
  ]);
  const seatCushionFrontElement = (fill: string, strokeWidth: number): string => {
    if (style.cushion === 'rounded') {
      const bottomLeft = projection.point(p(leftContentInset, seatFront, seatBottom));
      const bottomRight = projection.point(p(rightContentX, seatFront, seatBottom));
      const topRight = projection.point(p(rightContentX, seatFront, seatTop));
      const topLeft = projection.point(p(leftContentInset, seatFront, seatTop));
      const crown = projection.point(
        p((leftContentInset + rightContentX) / 2, seatFront + 5, seatTop - 2)
      );
      const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      return `<path class="sb-seat-cushion-front" d="M${s(bottomLeft)}L${s(bottomRight)}L${s(topRight)}Q${s(crown)} ${s(topLeft)}Z" fill="${fill}" stroke="${theme.cushionStroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    if (style.cushion === 'knife') {
      const pinch = 7;
      const hex = productPolygon(projection, [
        p(leftContentInset, seatFront, seatBottom),
        p(rightContentX, seatFront, seatBottom),
        p(rightContentX, seatFront, seatTop - 3),
        p(rightContentX - pinch, seatFront, seatTop),
        p(leftContentInset + pinch, seatFront, seatTop),
        p(leftContentInset, seatFront, seatTop - 3),
      ]);
      return `<polygon class="sb-seat-cushion-front" points="${hex}" fill="${fill}" stroke="${theme.cushionStroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    }
    return `<polygon class="sb-seat-cushion-front" points="${cushionFront}" fill="${fill}" stroke="${theme.cushionStroke}" stroke-width="${strokeWidth}"/>`;
  };
  const cushionRear = productPolygon(projection, [
    p(leftContentInset, seatRear, seatBottom),
    p(rightContentX, seatRear, seatBottom),
    p(rightContentX, seatRear, seatTop),
    p(leftContentInset, seatRear, seatTop),
  ]);
  const cushionLeftSide = productPolygon(projection, [
    p(leftContentInset, seatRear, seatBottom),
    p(leftContentInset, seatFront, seatBottom),
    p(leftContentInset, seatFront, seatTop),
    p(leftContentInset, seatRear, seatTop),
  ]);
  const cushionRightSide = productPolygon(projection, [
    p(rightContentX, seatRear, seatBottom),
    p(rightContentX, seatFront, seatBottom),
    p(rightContentX, seatFront, seatTop),
    p(rightContentX, seatRear, seatTop),
  ]);
  // Every structural back sits the same 8/6 px inside its footprint edge, so
  // the corner's return back and the return leg's backs share one plane and
  // the spine of the L reads as a single continuous wall. Where a return
  // leg's local-left edge joins the corner, the back runs right up to the
  // joint instead of leaving a seam-wide gap.
  const junctionBottomInset = 8;
  const junctionTopInset = 6;
  const backMinX = backJoinsCorner ? 0 : 4;
  const backMinXTop = backJoinsCorner ? 2 : 6;
  const structuralBackPath = productPanelPath(
    projection,
    p(backMinX, rearY + junctionBottomInset, bodyTop),
    p(w - 4, rearY + junctionBottomInset, bodyTop),
    p(backMinXTop, rearY + junctionTopInset, structuralBackTop),
    p(w - 6, rearY + junctionTopInset, structuralBackTop),
    style.back === 'curved'
  );
  // The loose back cushion is deliberately independent from the structural
  // back. Its top leans toward the rear frame so rotated return modules follow
  // their own back plane instead of all facing the camera.
  const looseBackPath = productPanelPath(
    projection,
    p(leftBackInset - 3, rearY + 28, seatTop - 1),
    p(rightBackX + 3, rearY + 28, seatTop - 1),
    p(leftBackInset, rearY + 12, looseBackTop),
    p(rightBackX, rearY + 12, looseBackTop),
    style.cushion === 'rounded'
  );
  const structuralBackCap = productPolygon(projection, [
    p(6, rearY + 6, structuralBackTop),
    p(w - 6, rearY + 6, structuralBackTop),
    p(w - 6, rearY, structuralBackTop - 2),
    p(6, rearY, structuralBackTop - 2),
  ]);
  const structuralBackLeftEdge = productPolygon(projection, [
    p(4, rearY + 8, bodyTop),
    p(4, rearY, bodyTop),
    p(6, rearY, structuralBackTop - 2),
    p(6, rearY + 6, structuralBackTop),
  ]);
  const structuralBackRightEdge = productPolygon(projection, [
    p(w - 4, rearY + 8, bodyTop),
    p(w - 4, rearY, bodyTop),
    p(w - 6, rearY, structuralBackTop - 2),
    p(w - 6, rearY + 6, structuralBackTop),
  ]);
  const looseBackTopCap = productPolygon(projection, [
    p(leftBackInset, rearY + 12, looseBackTop),
    p(rightBackX, rearY + 12, looseBackTop),
    p(rightBackX, rearY + 7, looseBackTop - 2),
    p(leftBackInset, rearY + 7, looseBackTop - 2),
  ]);
  const looseBackLeftEdge = productPolygon(projection, [
    p(leftBackInset - 3, rearY + 28, seatTop - 1),
    p(leftBackInset - 3, rearY + 23, seatTop - 1),
    p(leftBackInset, rearY + 7, looseBackTop - 2),
    p(leftBackInset, rearY + 12, looseBackTop),
  ]);
  const looseBackRightEdge = productPolygon(projection, [
    p(rightBackX + 3, rearY + 28, seatTop - 1),
    p(rightBackX + 3, rearY + 23, seatTop - 1),
    p(rightBackX, rearY + 7, looseBackTop - 2),
    p(rightBackX, rearY + 12, looseBackTop),
  ]);
  const outline = theme.outline;
  const bodySurfaces: SectionalProductSurface[] = [];
  const bodySurface = (
    layer: SectionalProductSurface['layer'],
    depthPoint: ProductPoint3D,
    markup: string
  ) => bodySurfaces.push({ layer, depthPoint, markup });
  const seatSurfaces: SectionalProductSurface[] = [];
  const seatSurface = (
    layer: SectionalProductSurface['layer'],
    depthPoint: ProductPoint3D,
    markup: string
  ) => seatSurfaces.push({ layer, depthPoint, markup });
  const showLeftSide =
    productPanelFacesCamera(piece, projection, -1, 0) && !localSideConnected('left');
  const showRightSide =
    productPanelFacesCamera(piece, projection, 1, 0) && !localSideConnected('right');
  if (showLeftSide) {
    bodySurface(
      'body',
      p(bodyLeftX, d / 2, bodyTop / 2),
      `<polygon class="sb-body-side sb-body-side-left" points="${leftSideFace}" fill="${shadeHex(theme.body, -23)}" stroke="${outline}" stroke-width="2"/>`
    );
  }
  if (showRightSide) {
    bodySurface(
      'body',
      p(bodyRightX, d / 2, bodyTop / 2),
      `<polygon class="sb-body-side sb-body-side-right" points="${rightSideFace}" fill="${shadeHex(theme.body, -28)}" stroke="${outline}" stroke-width="2"/>`
    );
  }
  if (frontFacesCamera && !frontConnected) {
    bodySurface(
      'body',
      p(w / 2, frontY, bodyTop / 2),
      `<polygon class="sb-body-front" points="${frontFace}" fill="${shadeHex(theme.body, -18)}" stroke="${outline}" stroke-width="2"/>`
    );
  } else if (!frontFacesCamera && !rearConnected) {
    bodySurface(
      'body',
      p(w / 2, rearY, bodyTop / 2),
      `<polygon class="sb-body-rear" points="${rearFace}" fill="${shadeHex(theme.body, -25)}" stroke="${outline}" stroke-width="2"/>`
    );
  }
  bodySurface(
    'body',
    p(w / 2, d / 2, bodyTop),
    `<polygon class="sb-body" points="${topFace}" fill="${theme.body}" stroke="${outline}" stroke-width="2"/>`
  );
  // Block feet ground the module like the CW reference renders. Skirted bases
  // hide their feet; connected edges keep them (they are inset from the joint).
  const hasSkirt =
    style.base === 'long-skirt' || style.base === 'loose-fit' || style.base === 'straight-skirt';
  if (!hasSkirt) {
    const legFill = shadeHex(theme.outline, 12);
    const foot = (corners: ProductPoint3D[], depth: ProductPoint3D) =>
      bodySurface(
        'body',
        depth,
        `<polygon class="sb-body-leg" points="${productPolygon(projection, corners)}" fill="${legFill}" stroke="none"/>`
      );
    if (frontFacesCamera && !frontConnected) {
      [bodyLeftX + 6, bodyRightX - 17].forEach(legX => {
        foot(
          [
            p(legX, frontY, 0),
            p(legX + 11, frontY, 0),
            p(legX + 11, frontY, 9),
            p(legX, frontY, 9),
          ],
          p(legX + 5.5, frontY, 4.5)
        );
      });
    }
    if (showLeftSide) {
      foot(
        [
          p(bodyLeftX, rearY + 9, 0),
          p(bodyLeftX, rearY + 20, 0),
          p(bodyLeftX, rearY + 20, 9),
          p(bodyLeftX, rearY + 9, 9),
        ],
        p(bodyLeftX, rearY + 14.5, 4.5)
      );
    }
    if (showRightSide) {
      foot(
        [
          p(bodyRightX, rearY + 9, 0),
          p(bodyRightX, rearY + 20, 0),
          p(bodyRightX, rearY + 20, 9),
          p(bodyRightX, rearY + 9, 9),
        ],
        p(bodyRightX, rearY + 14.5, 4.5)
      );
    }
  }
  if (
    style.base === 'long-skirt' ||
    style.base === 'loose-fit' ||
    style.base === 'straight-skirt'
  ) {
    const skirtHeight = style.base === 'loose-fit' ? 34 : style.base === 'straight-skirt' ? 26 : 28;
    const skirtFill = shadeHex(theme.body, -9);
    const pleatStroke = shadeHex(theme.body, -18);
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
      });
    }
    skirtPanels.forEach(panel => {
      const pleated = style.base === 'loose-fit';
      const cls = pleated ? `${panel.cls} sb-body-skirt-pleated` : panel.cls;
      bodySurface(
        'body',
        panel.depth,
        `<polygon class="${cls}" points="${productPolygon(projection, panel.corners)}" fill="${skirtFill}" stroke="${outline}" stroke-width="1.4"/>`
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
          `<path class="sb-skirt-pleat" d="M${pt.x.toFixed(1)} ${pt.y.toFixed(1)}L${pb.x.toFixed(1)} ${pb.y.toFixed(1)}" stroke="${pleatStroke}" stroke-width="0.8" opacity="0.5"/>`
        );
      });
      if (style.base !== 'straight-skirt') {
        const hemA = projection.point(panel.corners[0]);
        const hemB = projection.point(panel.corners[1]);
        bodySurface(
          'body',
          panel.corners[0],
          `<path class="sb-skirt-hem" d="M${hemA.x.toFixed(1)} ${hemA.y.toFixed(1)}L${hemB.x.toFixed(1)} ${hemB.y.toFixed(1)}" stroke="${pleatStroke}" stroke-width="1" opacity="0.45"/>`
        );
      }
    });
  }
  const structuralRearPieces: SectionalProductSurface[] = [];
  const rearSurface = (depthPoint: ProductPoint3D, markup: string) =>
    structuralRearPieces.push({ layer: 'rear', depthPoint, markup });
  if (showLeftSide) {
    rearSurface(
      p(5, rearY + 4, structuralBackTop / 2),
      `<polygon class="sb-structural-back-edge sb-structural-back-edge-left" points="${structuralBackLeftEdge}" fill="${shadeHex(theme.body, -19)}" stroke="${outline}" stroke-width="1.7"/>`
    );
  }
  if (showRightSide) {
    rearSurface(
      p(w - 5, rearY + 4, structuralBackTop / 2),
      `<polygon class="sb-structural-back-edge sb-structural-back-edge-right" points="${structuralBackRightEdge}" fill="${shadeHex(theme.body, -14)}" stroke="${outline}" stroke-width="1.7"/>`
    );
  }
  rearSurface(
    p(w / 2, rearY + 3, structuralBackTop),
    `<polygon class="sb-structural-back-cap" points="${structuralBackCap}" fill="${shadeHex(theme.body, 5)}" stroke="${outline}" stroke-width="1.5"/>`
  );
  rearSurface(
    p(w / 2, rearY + 7, (bodyTop + structuralBackTop) / 2),
    `<path class="sb-structural-back" d="${structuralBackPath}" fill="${shadeHex(theme.body, -8)}" stroke="${outline}" stroke-width="2.4"/>`
  );
  const looseRearPieces: SectionalProductSurface[] = [];
  const looseSurface = (depthPoint: ProductPoint3D, markup: string) =>
    looseRearPieces.push({ layer: 'rear', depthPoint, markup });
  if (showLeftSide) {
    looseSurface(
      p(leftBackInset, rearY + 18, (seatTop + looseBackTop) / 2),
      `<polygon class="sb-back-cushion-edge sb-back-cushion-edge-left" points="${looseBackLeftEdge}" fill="${shadeHex(theme.cushion, -16)}" stroke="${theme.cushionStroke}" stroke-width="1.4"/>`
    );
  }
  if (showRightSide) {
    looseSurface(
      p(rightBackX, rearY + 18, (seatTop + looseBackTop) / 2),
      `<polygon class="sb-back-cushion-edge sb-back-cushion-edge-right" points="${looseBackRightEdge}" fill="${shadeHex(theme.cushion, -12)}" stroke="${theme.cushionStroke}" stroke-width="1.4"/>`
    );
  }
  looseSurface(
    p(w / 2, rearY + 10, looseBackTop),
    `<polygon class="sb-back-cushion-cap" points="${looseBackTopCap}" fill="${shadeHex(theme.cushion, 4)}" stroke="${theme.cushionStroke}" stroke-width="1.4"/>`
  );
  looseSurface(
    p(w / 2, rearY + 20, (seatTop + looseBackTop) / 2),
    `<path class="sb-back-cushion" d="${looseBackPath}" fill="${shadeHex(theme.cushion, -4)}" stroke="${theme.cushionStroke}" stroke-width="${style.cushion === 'knife' ? 1.6 : 2.2}"/>`
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
  // return legs read as bare benches.
  const visibleLooseBackPieces: SectionalProductSurface[] =
    capabilities.hasBackFrame && capabilities.hasBackCushion && mainBackFacesCamera
      ? looseRearPieces
      : [];
  if (showLeftSide) {
    seatSurface(
      'body',
      p(leftContentInset, (seatRear + seatFront) / 2, (seatBottom + seatTop) / 2),
      `<polygon class="sb-seat-cushion-side sb-seat-cushion-side-left" points="${cushionLeftSide}" fill="${shadeHex(theme.cushion, -18)}" stroke="${theme.cushionStroke}" stroke-width="1.5"/>`
    );
  }
  if (showRightSide) {
    seatSurface(
      'body',
      p(rightContentX, (seatRear + seatFront) / 2, (seatBottom + seatTop) / 2),
      `<polygon class="sb-seat-cushion-side sb-seat-cushion-side-right" points="${cushionRightSide}" fill="${shadeHex(theme.cushion, -11)}" stroke="${theme.cushionStroke}" stroke-width="1.5"/>`
    );
  }
  if (frontFacesCamera && !frontConnected) {
    seatSurface(
      'body',
      p(w / 2, seatFront, (seatBottom + seatTop) / 2),
      seatCushionFrontElement(shadeHex(theme.cushion, -15), 1.8)
    );
    if (style.cushion === 'knife') {
      const seamA = projection.point(
        p(leftContentInset + 4, seatFront, (seatBottom + seatTop) / 2)
      );
      const seamB = projection.point(p(rightContentX - 4, seatFront, (seatBottom + seatTop) / 2));
      seatSurface(
        'body',
        p(w / 2, seatFront, (seatBottom + seatTop) / 2),
        `<path class="sb-seat-cushion-welt" d="M${seamA.x.toFixed(1)} ${seamA.y.toFixed(1)}L${seamB.x.toFixed(1)} ${seamB.y.toFixed(1)}" stroke="${theme.cushionStroke}" stroke-width="0.9" opacity="0.6"/>`
      );
    }
  } else if (!frontFacesCamera && !rearConnected) {
    seatSurface(
      'body',
      p(w / 2, seatRear, (seatBottom + seatTop) / 2),
      `<polygon class="sb-seat-cushion-rear" points="${cushionRear}" fill="${shadeHex(theme.cushion, -19)}" stroke="${theme.cushionStroke}" stroke-width="1.8"/>`
    );
  }
  seatSurface(
    'body',
    p(w / 2, (seatRear + seatFront) / 2, seatTop),
    seatCushionTopElement(theme.cushion, style.cushion === 'boxed' ? 2.4 : 1.7)
  );
  if (piece.kind === 'corner') {
    const returnStructuralBack = productPanelPath(
      projection,
      p(w - 8, rearY + 8, bodyTop),
      p(w - 8, frontY, bodyTop),
      p(w - 6, rearY + 6, structuralBackTop),
      p(w - 6, frontY, structuralBackTop),
      style.back === 'curved'
    );
    const returnStructuralMarkup = `<path class="sb-structural-back sb-corner-return-back" d="${returnStructuralBack}" fill="${shadeHex(theme.body, -11)}" stroke="${outline}" stroke-width="2.4"/>`;
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
      // back cushion so the two do not interpenetrate.
      const returnCushionPath = productPanelPath(
        projection,
        p(w - 30, rearY + 30, seatTop - 1),
        p(w - 30, frontY - 2, seatTop - 1),
        p(w - 14, rearY + 26, looseBackTop),
        p(w - 14, frontY - 4, looseBackTop),
        style.cushion === 'rounded'
      );
      const returnCushionCap = productPolygon(projection, [
        p(w - 14, rearY + 26, looseBackTop),
        p(w - 14, frontY - 4, looseBackTop),
        p(w - 9, frontY - 6, looseBackTop - 2),
        p(w - 9, rearY + 24, looseBackTop - 2),
      ]);
      visibleLooseBackPieces.push(
        {
          layer: 'rear',
          depthPoint: p(w - 17, d / 2, (seatTop + looseBackTop) / 2),
          markup: `<path class="sb-back-cushion sb-corner-return-cushion" d="${returnCushionPath}" fill="${shadeHex(theme.cushion, -6)}" stroke="${theme.cushionStroke}" stroke-width="${style.cushion === 'knife' ? 1.6 : 2.2}"/>`,
        },
        {
          layer: 'rear',
          depthPoint: p(w - 12, d / 2, looseBackTop),
          markup: `<polygon class="sb-back-cushion-cap sb-corner-return-cushion-cap" points="${returnCushionCap}" fill="${shadeHex(theme.cushion, 3)}" stroke="${theme.cushionStroke}" stroke-width="1.4"/>`,
        }
      );
    } else {
      nearStructuralPieces.push(returnSurface);
    }
  }
  const armPieces: SectionalProductSurface[] = [];
  if (armSide) {
    // The arm is modelled as a real extruded volume: a cross-section profile
    // in (u, z), swept along the module depth. u = 0 is the arm's outer face,
    // u = armThickness its inner face. Square is a box, wedge a sloped box,
    // and round a faceted bolster whose crown rolls over the outer shoulder
    // (Ektorp-style). Panels, roll bands, and end caps are separate surfaces
    // so each camera sees a consistent solid.
    const uX = (u: number) => (armSide === 'left' ? u : w - u);
    // The arm tucks into the back frame so the roll never shows a raw rear
    // end. Its base front is flush with the sofa front, while a roll arm's
    // round face stands a few pixels proud of it, as in the CW references.
    const armRear = rearY + 4;
    const armFront = frontY - 1;
    const rollFront = frontY + 2;
    const armLayer: SectionalProductSurface['layer'] = 'arm';
    const armFacesInterior = productArmInnerFacesCamera(piece, projection, armSide);
    const armFrontFacesCamera = productPanelFacesCamera(piece, projection, 0, 1);
    const rollShoulder = 60;
    const rollOuterShoulder = 56;
    const rollApex = armTop;
    // The round arm is a sock roll: a fat bolster whose fullest point bulges
    // well *past the arm's outer face* (negative u), so the end cap reads as
    // the classic letter-P silhouette instead of a symmetric hump. The roll is
    // ~30% wider than the arm base it sits on.
    const roundProfile: Array<readonly [number, number]> = [
      [0, bodyTop],
      [armThickness, bodyTop],
      [armThickness - 2, rollShoulder],
      [armThickness - 4, 80],
      [14, rollApex - 2],
      [0, rollApex - 5],
      [-9, 72],
      [0, rollOuterShoulder],
    ];
    const squareProfile: Array<readonly [number, number]> = [
      [0, bodyTop],
      [armThickness, bodyTop],
      [armThickness, armTop],
      [0, armTop],
    ];
    const wedgeHeightAt = (localY: number) =>
      armTop + 12 - ((localY - armRear) / Math.max(1, armFront - armRear)) * 32;
    const wedgeProfileAt = (localY: number): Array<readonly [number, number]> => [
      [0, bodyTop],
      [armThickness, bodyTop],
      [armThickness, wedgeHeightAt(localY)],
      [0, wedgeHeightAt(localY)],
    ];
    const profileAt = (localY: number): Array<readonly [number, number]> =>
      style.arm === 'round'
        ? roundProfile
        : style.arm === 'wedge'
          ? wedgeProfileAt(localY)
          : squareProfile;
    // End-cap path. The round profile is drawn as a smooth silhouette through
    // the facet points; square and wedge stay rectilinear.
    const endCapPath = (localY: number): string => {
      const pts = profileAt(localY).map(([u, z]) => projection.point(p(uX(u), localY, z)));
      const s = (pt: SectionalPoint) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      if (style.arm !== 'round' || pts.length !== 8) {
        return `M${pts.map(s).join('L')}Z`;
      }
      const control = (a: SectionalPoint, through: SectionalPoint, b: SectionalPoint) => ({
        x: 2 * through.x - (a.x + b.x) / 2,
        y: 2 * through.y - (a.y + b.y) / 2,
      });
      const c1 = control(pts[2], pts[3], pts[4]);
      const c2 = control(pts[4], pts[5], pts[6]);
      // The bowl tucks concavely into the arm's outer face — the pinch that
      // makes the silhouette read as a letter P instead of a tombstone arch.
      // The cap is the round roll face only; the arm base front is separate.
      const tuck = projection.point(p(uX(1), localY, 64));
      return `M${s(pts[2])}Q${s(c1)} ${s(pts[4])}Q${s(c2)} ${s(pts[6])}Q${s(tuck)} ${s(pts[7])}L${s(pts[2])}Z`;
    };
    // A profile edge swept along the arm's depth becomes one band surface.
    const bandMarkup = (
      a: readonly [number, number],
      b: readonly [number, number],
      cls: string,
      fill: string,
      strokeWidth: number
    ): string => {
      const quad = productPolygon(projection, [
        p(uX(a[0]), armRear, a[1]),
        p(uX(b[0]), armRear, b[1]),
        p(uX(b[0]), armFront, b[1]),
        p(uX(a[0]), armFront, a[1]),
      ]);
      return `<polygon class="${cls}" points="${quad}" fill="${fill}" stroke="${outline}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    };
    const lineJoin = style.arm === 'round' ? 'round' : 'miter';
    // Inner / outer vertical panels are mutually exclusive faces of the arm.
    const visiblePanelPath = (() => {
      const u = armFacesInterior ? armThickness : 0;
      const rearH =
        style.arm === 'wedge'
          ? wedgeHeightAt(armRear)
          : style.arm === 'round'
            ? armFacesInterior
              ? rollShoulder
              : rollOuterShoulder
            : armTop;
      const frontH =
        style.arm === 'wedge'
          ? wedgeHeightAt(armFront)
          : style.arm === 'round'
            ? armFacesInterior
              ? rollShoulder
              : rollOuterShoulder
            : armTop;
      return productPolygon(projection, [
        p(uX(u), armRear, bodyTop),
        p(uX(u), armFront, bodyTop),
        p(uX(u), armFront, frontH),
        p(uX(u), armRear, rearH),
      ]);
    })();
    armPieces.push({
      layer: armLayer,
      depthPoint: p(uX(armFacesInterior ? armThickness : 0), d / 2, (bodyTop + armTop) / 2),
      markup: armFacesInterior
        ? `<polygon class="sb-arm-inner sb-arm-inner-${style.arm}" points="${visiblePanelPath}" fill="${shadeHex(theme.body, -2)}" stroke="${outline}" stroke-width="1.8" stroke-linejoin="${lineJoin}"/>`
        : `<polygon class="sb-arm-panel sb-arm-${style.arm}" points="${visiblePanelPath}" fill="${shadeHex(theme.body, -8)}" stroke="${outline}" stroke-width="2.4" stroke-linejoin="${lineJoin}"/>`,
    });
    // Top surfaces: one flat cap for square/wedge. Round is a swept cylinder:
    // a single stroked silhouette body with *unstroked* shading overlays —
    // dark seams between bands would read as bench slats, not a soft roll.
    if (style.arm === 'round') {
      const prof = roundProfile;
      const rollBodyPoints = [
        ...prof.slice(2).map(([u, z]) => p(uX(u), armRear, z)),
        ...prof
          .slice(2)
          .reverse()
          .map(([u, z]) => p(uX(u), rollFront, z)),
      ];
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(armThickness / 2), d / 2, rollApex - 10),
        markup: `<polygon class="sb-arm-roll-body" points="${productPolygon(projection, rollBodyPoints)}" fill="${shadeHex(theme.body, -1)}" stroke="${outline}" stroke-width="2" stroke-linejoin="round"/>`,
      });
      // Shading overlays: a bright crown along the top, a soft shadow rolling
      // over the outer bulge. No strokes — the eye blends them into a cylinder.
      const overlays: Array<{ from: number; to: number; shade: number; cls: string }> = [
        { from: 2, to: 4, shade: -10, cls: 'sb-arm-roll-band sb-arm-roll-band-inner' },
        { from: 3, to: 6, shade: 20, cls: 'sb-arm-cap sb-arm-roll-band sb-arm-roll-band-crown' },
        { from: 5, to: 8, shade: -26, cls: 'sb-arm-roll-band sb-arm-roll-band-outer' },
      ];
      // Contact shadow where the overhanging roll meets the arm's outer face
      // (only meaningful when that outer face is the camera side).
      if (!armFacesInterior) {
        const rollShadow = productPolygon(projection, [
          p(uX(0), armRear, rollOuterShoulder + 3),
          p(uX(0), armFront, rollOuterShoulder + 3),
          p(uX(0), armFront, rollOuterShoulder - 6),
          p(uX(0), armRear, rollOuterShoulder - 6),
        ]);
        armPieces.push({
          layer: armLayer,
          depthPoint: p(uX(0), d / 2, rollOuterShoulder),
          markup: `<polygon class="sb-arm-roll-shadow" points="${rollShadow}" fill="${shadeHex(theme.body, -34)}" stroke="none"/>`,
        });
      }
      overlays.forEach(({ from, to, shade, cls }) => {
        const strip = [
          ...prof.slice(from, to).map(([u, z]) => p(uX(u), armRear, z)),
          ...prof
            .slice(from, to)
            .reverse()
            .map(([u, z]) => p(uX(u), rollFront, z)),
        ];
        const midU = (prof[from][0] + prof[to - 1][0]) / 2;
        const midZ = (prof[from][1] + prof[to - 1][1]) / 2;
        armPieces.push({
          layer: armLayer,
          depthPoint: p(uX(midU), d / 2, midZ),
          markup: `<polygon class="${cls}" points="${productPolygon(projection, strip)}" fill="${shadeHex(theme.body, shade)}" stroke="none"/>`,
        });
      });
    } else {
      const capProfile = style.arm === 'wedge' ? null : profileAt(armRear);
      const capMarkup =
        style.arm === 'wedge'
          ? (() => {
              const quad = productPolygon(projection, [
                p(uX(0), armRear, wedgeHeightAt(armRear)),
                p(uX(armThickness), armRear, wedgeHeightAt(armRear)),
                p(uX(armThickness), armFront, wedgeHeightAt(armFront)),
                p(uX(0), armFront, wedgeHeightAt(armFront)),
              ]);
              return `<polygon class="sb-arm-cap" points="${quad}" fill="${shadeHex(theme.body, 8)}" stroke="${outline}" stroke-width="1.8" stroke-linejoin="round"/>`;
            })()
          : bandMarkup(capProfile![3], capProfile![2], 'sb-arm-cap', shadeHex(theme.body, 8), 1.8);
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(armThickness / 2), d / 2, style.arm === 'wedge' ? armTop - 4 : armTop),
        markup: capMarkup,
      });
    }
    // Camera-facing end cap carries the arm's silhouette. A round arm splits
    // the end into the arm base front plus the roll's own round face, so the
    // roll reads as a fat disc sitting on the arm (the letter-P read). The
    // disc stands proud of the arm base front.
    const endY = armFrontFacesCamera ? armFront : armRear;
    const rollEndY = armFrontFacesCamera ? rollFront : armRear;
    if (style.arm === 'round') {
      const baseFront = productPolygon(projection, [
        p(uX(0), endY, bodyTop),
        p(uX(armThickness), endY, bodyTop),
        p(uX(armThickness - 2), endY, rollShoulder),
        p(uX(0), endY, rollOuterShoulder),
      ]);
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(armThickness / 2), endY, bodyTop + 8),
        markup: `<polygon class="sb-arm-base-front" points="${baseFront}" fill="${shadeHex(theme.body, -13)}" stroke="${outline}" stroke-width="1.8" stroke-linejoin="round"/>`,
      });
    }
    armPieces.push({
      layer: armLayer,
      depthPoint: p(uX(armThickness / 2), rollEndY, (bodyTop + armTop) / 2),
      markup: armFrontFacesCamera
        ? `<path class="sb-arm-front sb-arm-front-${style.arm}${style.arm === 'round' ? ' sb-arm-roll' : ''}" d="${endCapPath(style.arm === 'round' ? rollFront : armFront)}" fill="${shadeHex(theme.body, style.arm === 'round' ? 3 : -17)}" stroke="${outline}" stroke-width="${style.arm === 'round' ? 2.4 : 1.8}" stroke-linejoin="round"/>`
        : `<path class="sb-arm-rear sb-arm-rear-${style.arm}${style.arm === 'round' ? ' sb-arm-roll' : ''}" d="${endCapPath(armRear)}" fill="${shadeHex(theme.body, style.arm === 'round' ? -3 : -20)}" stroke="${outline}" stroke-width="${style.arm === 'round' ? 2.4 : 1.8}" stroke-linejoin="round"/>`,
    });
    if (style.arm === 'wedge') {
      const slopeU = armFacesInterior ? armThickness : 0;
      const slope = [
        projection.point(p(uX(slopeU), armRear, wedgeHeightAt(armRear))),
        projection.point(p(uX(slopeU), armFront, wedgeHeightAt(armFront))),
      ];
      armPieces.push({
        layer: armLayer,
        depthPoint: p(uX(slopeU), d / 2, armTop),
        markup: `<path class="sb-arm-slope-line" d="M${slope[0].x.toFixed(1)} ${slope[0].y.toFixed(1)}Q${((slope[0].x + slope[1].x) / 2).toFixed(1)} ${(Math.min(slope[0].y, slope[1].y) + 13).toFixed(1)} ${slope[1].x.toFixed(1)} ${slope[1].y.toFixed(1)}" fill="none" stroke="${outline}" stroke-width="2.2"/>`,
      });
    }
  }
  const attributes = `data-piece-id="${piece.id}" data-kind="${piece.kind}" data-rotation="${((piece.rotation % 360) + 360) % 360}" data-arm="${style.arm}" data-arm-extension="${armSide ? armThickness : 0}" data-seat-start="${seatLeftX}" data-seat-end="${seatRightX}" data-back="${style.back}" data-cushion="${style.cushion}" data-base="${style.base}"`;
  // Paint a module as physical anatomy rather than as unrelated polygons:
  // frame and loose back sit behind the upholstered base, the seat cushion
  // rests on top, reverse-facing return shells close over that upholstery,
  // and arms are the final local occluders. This fixed anatomy order is sound
  // because the canonical projection is a consistent oblique projection (see
  // productProjection), so surfaces of one module never falsely overlap.
  const orderedModuleSurfaces = [
    ...farStructuralPieces,
    ...visibleLooseBackPieces,
    ...bodySurfaces,
    ...seatSurfaces,
    ...nearStructuralPieces,
    ...armPieces,
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
  const mirrorTransform =
    viewMode === 'front-left' ? ' transform="translate(920 0) scale(-1 1)"' : '';
  return `<g class="sb-product-view" data-section-view="${viewMode}" data-canonical-view="front-right"${mirrorTransform}><defs><filter id="sbProductShadow" x="-30%" y="-40%" width="160%" height="180%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#24302f" flood-opacity=".18"/></filter></defs><ellipse cx="460" cy="512" rx="330" ry="38" fill="#253132" opacity=".09"/><g filter="url(#sbProductShadow)">${ordered
    .map(entry => entry.markup)
    .join('')}</g></g>`;
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

function dialogMarkup(): string {
  const library = (Object.keys(PIECES) as PieceKind[])
    .map(
      kind =>
        `<button type="button" class="sb-library-item" draggable="true" data-piece-kind="${kind}"><span class="sb-library-icon">${PIECES[kind].short}</span><span><strong>${PIECES[kind].name}</strong><small>${PIECES[kind].width} × ${PIECES[kind].depth} cm</small></span><span class="sb-add-symbol" aria-hidden="true">+</span></button>`
    )
    .join('');
  return `<dialog id="sectionalBuilderDialog" class="sectional-builder-dialog">
    <div class="sb-shell">
      <header class="sb-header"><div><span class="sb-eyebrow">Assembly workspace</span><h2>Sectional Builder</h2></div><div class="sb-presets" aria-label="Assembly presets"><span>Start with</span><button type="button" data-sb-preset="sofa">3-seat</button><button type="button" data-sb-preset="two-seat">2-seat</button><button type="button" data-sb-preset="chaise">Chaise</button><button type="button" data-sb-preset="corner">L-shape</button><button type="button" data-sb-preset="l-chaise">L+Chaise</button><button type="button" data-sb-preset="ottoman-set">+Ottoman</button></div><button type="button" class="sb-close" data-sb-close aria-label="Close sectional builder">×</button></header>
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
        <aside class="sb-inspector"><div class="sb-panel-heading"><h3>Assembly</h3><span id="sbViewLabel">Plan view</span></div><div class="sb-metrics"><div><span>Pieces</span><strong id="sbMetricPieces">0</strong></div><div><span>Width</span><strong id="sbMetricWidth">0 cm</strong></div><div><span>Depth</span><strong id="sbMetricDepth">0 cm</strong></div></div><div class="sb-model-controls" aria-label="Product model"><label><span>Arm profile</span><select id="sbArmStyle"><option value="round">Round roll arm</option><option value="square">Square arm</option><option value="wedge">Wedge arm</option></select></label><label><span>Back frame</span><select id="sbBackStyle"><option value="high">High box back</option><option value="short">Short box back</option><option value="curved">Rounded back</option></select></label><label><span>Loose cushions</span><select id="sbCushionStyle"><option value="boxed">Boxed edge</option><option value="knife">Knife edge</option><option value="rounded">Rounded front</option></select></label><label><span>Base / skirt</span><select id="sbBaseStyle"><option value="snug">Snug fit</option><option value="long-skirt">Long skirt</option><option value="loose-fit">Cornered pleats</option><option value="straight-skirt">Straight skirt</option></select></label></div><div id="sbSelectionInspector" class="sb-selection-inspector is-empty"><span class="sb-eyebrow">Selected piece</span><h3 id="sbSelectedName">Select a piece</h3><p id="sbSelectedSize">Drag pieces on the board to arrange them.</p><div class="sb-inspector-actions"><button type="button" data-sb-action="rotate">Rotate</button><button type="button" data-sb-action="mirror">Mirror</button><button type="button" data-sb-action="duplicate">Duplicate</button><button type="button" class="is-danger" data-sb-action="delete">Delete</button></div></div><div class="sb-handoff"><p>Keep the plan editable, or add the selected product angle as a normal SofaPaint image.</p><label class="sb-modules-toggle"><input type="checkbox" id="sbIncludeModules" checked /><span>Also create a measured view per module</span></label><button type="button" class="sb-primary" data-sb-use>Use plan in project</button><button type="button" class="sb-secondary" data-sb-use-product hidden>Add selected product view</button><button type="button" class="sb-secondary" data-sb-update hidden>Update project image</button><button type="button" class="sb-secondary" data-sb-sync-canvas hidden title="Read piece positions from the canvas back into the builder">Sync from canvas</button></div><div class="sb-pricing"><div class="sb-panel-heading"><h3>Pricing</h3><span>CW unbranded</span></div><div class="sb-pricing-filters"><label><span>Country</span><select id="sbPricingCountry">${(Object.entries(SECTIONAL_PRICING_MARKETS) as [SectionalPricingCountry, SectionalPricingMarket][]).map(([id, market]) => `<option value="${id}"${id === DEFAULT_PRICING_COUNTRY ? ' selected' : ''}>${market.country} · ${market.currency}</option>`).join('')}</select></label><label><span>Fabric</span><select id="sbPricingFabric">${(Object.entries(SECTIONAL_PRICING_FABRICS) as [SectionalPricingFabric, string][]).map(([id, label]) => `<option value="${id}"${id === DEFAULT_PRICING_FABRIC ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div><p id="sbPricingStatus" class="sb-pricing-status">Current US storefront prices</p><div id="sbPricingList"></div><div class="sb-pricing-total"><span>Estimated total</span><strong id="sbPricingTotal">—</strong></div><button type="button" class="sb-pricing-copy" data-sb-copy-pricing>Copy all links</button></div></aside>
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
      ['sbBackStyle', 'back'],
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
        | 'ottoman-set';
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
  bindProductStyle('sbBackStyle', 'back');
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
