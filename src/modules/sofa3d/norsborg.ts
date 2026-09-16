import {
  createSofaDocument,
  NORSBORG_SECTION_KINDS,
  type NorsborgSection,
  type NorsborgSectionKind,
  type PartOverride,
  type SofaDocument,
  type SofaModule,
} from './model';

/**
 * IKEA NORSBORG sections matched to the Comfort Works PID measurements
 * (Original VELC_WR; the armrest PID exists only in Signature LSKT_SI):
 * sections are 88 cm deep on an 18 cm-leg frame, seat height 43 cm; the
 * three-seat section's back frame stands 60 cm tall, every other section 52 cm.
 * Cushion sizes below are the PID cover measurements, to the centimetre.
 */
interface NorsborgSectionSpec {
  name: string;
  width: number;
  depth: number;
  seats: number;
  armOnly?: boolean;
  corner?: boolean;
  /** Back-frame height in cm (three-seat sections stand taller than the rest). */
  frameHeight: number;
  /** Seat cushion per PID: top width, base width, depth, thickness. */
  seat: { width: number; baseWidth?: number; depth: number; thickness: number };
  /** Back cushion per PID for seat-facing backs. */
  back?: { width: number; height: number; thickness: number };
  cover: { name: string; code?: string; unitPrice?: number; unit: 'section' | 'pair' };
}

const taperFor = (top: number, base: number) => Math.round((top / base - 1) * 1000) / 1000;

export const NORSBORG_SECTIONS: Record<NorsborgSectionKind, NorsborgSectionSpec> = {
  armrest: {
    name: 'Armrest',
    width: 16,
    depth: 88,
    seats: 1,
    armOnly: true,
    frameHeight: 52,
    seat: { width: 0, depth: 0, thickness: 0 },
    cover: {
      name: 'Norsborg Armrest Covers (Pair)',
      code: 'IK-NG-8',
      unitPrice: 79,
      unit: 'pair',
    },
  },
  'two-seat': {
    name: 'Two-seat section',
    width: 121,
    depth: 88,
    seats: 2,
    frameHeight: 52,
    seat: { width: 65, baseWidth: 60, depth: 73, thickness: 11.75 },
    back: { width: 61, height: 44, thickness: 12 },
    cover: { name: 'Norsborg Two-seat Section Cover Only', code: 'IK-NG-2X', unit: 'section' },
  },
  'three-seat': {
    name: 'Three-seat section',
    width: 181,
    depth: 88,
    seats: 3,
    frameHeight: 60,
    seat: { width: 66, baseWidth: 61, depth: 73, thickness: 11.5 },
    back: { width: 62, height: 44, thickness: 12 },
    cover: {
      name: 'Norsborg Three-seat Section Cover Only',
      code: 'IK-NG-3X',
      unitPrice: 289,
      unit: 'section',
    },
  },
  corner: {
    name: 'Corner section',
    width: 88,
    depth: 88,
    seats: 1,
    corner: true,
    frameHeight: 52,
    seat: { width: 72.5, depth: 72.5, thickness: 12 },
    // Two unequal back cushions: 74/63 × 44/46 on the back, 87/76 × 46/44 on the side.
    back: { width: 74, height: 45, thickness: 12 },
    cover: {
      name: 'Norsborg Corner Section Cover Only',
      code: 'IK-NG-6',
      unitPrice: 209,
      unit: 'section',
    },
  },
  chaise: {
    name: 'Chaise longue',
    width: 80,
    depth: 157,
    seats: 1,
    frameHeight: 52,
    seat: { width: 78, depth: 142, thickness: 12 },
    back: { width: 81, height: 44, thickness: 12 },
    cover: { name: 'Norsborg Chaise Section Cover Only', code: 'IK-NG-5X', unit: 'section' },
  },
};

/** The ordered configuration from the reference order: 2 × three-seat + corner + armrest pair. */
const ORDER_CONFIGURATION: NorsborgSectionKind[] = [
  'armrest',
  'three-seat',
  'corner',
  'three-seat',
  'armrest',
];
const CHAISE_CONFIGURATION: NorsborgSectionKind[] = ['armrest', 'chaise', 'three-seat', 'armrest'];

/** Picker entries shaped like the catalogue products in extended-products.json. */
export const NORSBORG_PRODUCTS = [
  {
    id: 'norsborg',
    title: 'NORSBORG corner combination · 2 × three-seat + corner + armrests',
    url: 'https://blog.comfort-works.com/ikea-norsborg-sofa-guide-and-resource-page/',
    imageUrl: '',
    reference: 'IK-NG-3X · IK-NG-6 · IK-NG-8',
    dimensions: { width: 285, depth: 285, height: 85 },
    version: 'Sectional · configure covers per section',
    brand: 'IKEA Norsborg',
  },
  {
    id: 'norsborg-chaise',
    title: 'NORSBORG chaise + three-seat + armrests',
    url: 'https://blog.comfort-works.com/ikea-norsborg-sofa-guide-and-resource-page/',
    imageUrl: '',
    reference: 'IK-NG covers, chaise configuration',
    dimensions: { width: 293, depth: 157, height: 85 },
    version: 'Sectional · configure covers per section',
    brand: 'IKEA Norsborg',
  },
] as const;

export function isNorsborgModel(id: string): boolean {
  return NORSBORG_PRODUCTS.some(p => p.id === id);
}

let sectionCounter = 0;
const nextSectionId = () => `norsborg-${Date.now().toString(36)}-${sectionCounter++}`;

export function norsborgSections(kinds: NorsborgSectionKind[]): NorsborgSection[] {
  return kinds.map(kind => ({ id: nextSectionId(), kind }));
}

/**
 * Attach a section to the configuration. IKEA Norsborg combinations always end
 * with an armrest, so a new section slots in before a trailing armrest and the
 * armrests stay at the two outer ends.
 */
export function insertNorsborgSection(doc: SofaDocument, kind: NorsborgSectionKind): void {
  const sections = doc.norsborg?.sections;
  if (!sections) return;
  const section: NorsborgSection = { id: nextSectionId(), kind };
  if (sections.length && sections[sections.length - 1].kind === 'armrest')
    sections.splice(sections.length - 1, 0, section);
  else sections.push(section);
  applyNorsborgLayout(doc);
}

/**
 * Rebuild `doc.modules` and the outer dimensions from `doc.norsborg.sections`.
 * Sections form a chain: each section joins the previous one; a corner section
 * turns the chain 90° into the return leg. Backs stay on one plane per leg and
 * armrests provide the only arms, so any chain assembles without gaps.
 */
export function applyNorsborgLayout(doc: SofaDocument): SofaDocument {
  const sections = doc.norsborg?.sections ?? [];
  const modules: SofaModule[] = [];
  let leg = 0; // 0: +x, 1: +z, 2: -x, 3: -z
  let cursor = 0; // frontier along the current leg
  let backX = 0,
    backZ = 0; // back planes of the current leg
  let minX = 0,
    maxX = 0,
    minZ = 0,
    maxZ = 0;
  const grow = (x0: number, x1: number, z0: number, z1: number) => {
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minZ = Math.min(minZ, z0);
    maxZ = Math.max(maxZ, z1);
  };
  for (const section of sections) {
    const spec = NORSBORG_SECTIONS[section.kind];
    const module: SofaModule = {
      id: section.id,
      width: spec.width,
      depth: spec.depth,
      x: 0,
      z: 0,
      rotation: -90 * leg,
      leftArm: !!spec.armOnly,
      rightArm: false,
      back: !spec.armOnly,
      seats: spec.seats,
      ...(spec.armOnly ? { armOnly: true } : {}),
      ...(spec.corner ? { corner: true, cornerSide: 'right' as const } : {}),
    };
    if (leg === 0) {
      module.x = cursor + spec.width / 2;
      module.z = backZ + spec.depth / 2;
      cursor = module.x + spec.width / 2;
    } else if (leg === 1) {
      module.z = cursor + spec.width / 2;
      module.x = backX - spec.depth / 2;
      cursor = module.z + spec.width / 2;
    } else if (leg === 2) {
      module.x = cursor - spec.width / 2;
      module.z = backZ - spec.depth / 2;
      cursor = module.x - spec.width / 2;
    } else {
      module.z = cursor - spec.width / 2;
      module.x = backX + spec.depth / 2;
      cursor = module.z - spec.width / 2;
    }
    const along = leg % 2 === 0;
    const x0 = along ? module.x - spec.width / 2 : module.x - spec.depth / 2;
    const x1 = along ? module.x + spec.width / 2 : module.x + spec.depth / 2;
    const z0 = along ? module.z - spec.depth / 2 : module.z - spec.width / 2;
    const z1 = along ? module.z + spec.depth / 2 : module.z + spec.width / 2;
    grow(x0, x1, z0, z1);
    modules.push(module);
    if (spec.corner && leg < 3) {
      // The far face along the old travel axis becomes the new back plane; the
      // corner's open face starts the next leg's cursor.
      const half = spec.width / 2;
      if (leg === 0) {
        backX = module.x + half;
        cursor = module.z + spec.depth / 2;
      } else if (leg === 1) {
        backZ = module.z + half;
        cursor = module.x - half;
      } else {
        backX = module.x - half;
        cursor = module.z - half;
      }
      leg += 1;
    }
  }
  doc.modules = modules;
  doc.dimensions.width = Math.max(50, Math.round((maxX - minX) * 10) / 10);
  doc.dimensions.depth = Math.max(50, Math.round((maxZ - minZ) * 10) / 10);
  doc.dimensions.seatCount = Math.min(
    8,
    sections.reduce((sum, s) => sum + NORSBORG_SECTIONS[s.kind].seats, 0)
  );
  return doc;
}

const NAVY = '#2b3f5c';

/**
 * Apply the PID cushion spec to one section. Measurements from the CW product
 * pages: seats wedge wider at the crown (taper), backs are 12 cm thick, and all
 * backs lean against a 15 cm back frame on a 43 cm seat.
 */
function styleNorsborgSection(doc: SofaDocument, module: SofaModule, kind: NorsborgSectionKind) {
  const spec = NORSBORG_SECTIONS[kind];
  const set = (part: string, values: PartOverride) => {
    doc.overrides[`${module.id}:${part}`] = {
      ...(doc.overrides[`${module.id}:${part}`] || {}),
      ...values,
    };
  };
  // Back cushions: bottom on the 43 cm seat, leaning out 20° like the product
  // renders — the back face rests on the back frame's top edge, so the centre
  // sits just in front of the frame (20° swings the base 13.2 cm back from the
  // centre; the 60 cm three-seat frame's contact point sits slightly further
  // back). The rotation override replaces the default orientation, so it must
  // carry the module's own yaw — otherwise cushions on turned legs face the
  // wrong way.
  const backDrop = { x: 0, y: 3, z: spec.frameHeight >= 60 ? -1 : 2 };
  const backLean = { x: 20, y: module.rotation, z: 0 };
  if (spec.back)
    for (let i = 0; i < module.seats; i++)
      set(`back-${i}`, {
        width: spec.back.width,
        height: spec.back.height,
        depth: spec.back.thickness,
        offset: backDrop,
        rotation: backLean,
        softness: 0.55,
        loft: 0.5,
        piping: true,
      });
  if (kind === 'corner') {
    // Second corner back cushion, on the return-leg side: 87 top / 76 base, 45
    // tall. Its mesh turns -90° relative to the module, so the long axis runs
    // down the 88 cm side (centred at local z 0) and the 12 cm thickness rests
    // against the side back wall at x 25. The wedge slopes its base away from
    // the main back so both cushions' crowns converge on the corner.
    set('corner-back-cushion', {
      width: 87,
      height: 45,
      depth: 12,
      taper: taperFor(87, 76),
      outline: 'wedge-left',
      offset: { x: -2, y: 3, z: -15.5 },
      rotation: { x: 20, y: module.rotation - 90, z: 0 },
      softness: 0.55,
      loft: 0.5,
      piping: true,
    });
    // First corner back cushion: 74 top / 63 base, heights 44 and 46, sloped
    // edge facing the return-leg side.
    set('back-0', {
      width: 74,
      height: 45,
      depth: 12,
      taper: taperFor(74, 63),
      outline: 'wedge-right',
      offset: backDrop,
      rotation: backLean,
      softness: 0.55,
      loft: 0.5,
      piping: true,
    });
  }
  // Seats: PID width/depth/thickness plus the crown wedge.
  const seatTaper = spec.seat.baseWidth ? taperFor(spec.seat.width, spec.seat.baseWidth) : 0;
  for (let i = 0; i < module.seats; i++)
    set(`seat-${i}`, {
      width: spec.seat.width || undefined,
      depth: spec.seat.depth || undefined,
      height: spec.seat.thickness || undefined,
      taper: seatTaper,
      loft: 0.3,
      softness: 0.3,
      piping: true,
    });
  // The three-seat section's back frame stands 60 cm tall (8 cm above the rest).
  if (spec.frameHeight !== doc.construction.frameHeight) {
    const floor = doc.dimensions.legHeight;
    const base = doc.construction.frameHeight || doc.dimensions.armHeight;
    set('back-frame', {
      height: spec.frameHeight - floor,
      offset: { x: 0, y: (spec.frameHeight - base) / 2, z: 0 },
    });
  }
}

/** Build an IKEA Norsborg combination from an ordered list of sections. */
export function createNorsborgDocument(kinds?: NorsborgSectionKind[]): SofaDocument {
  const sections = norsborgSections(kinds ?? ORDER_CONFIGURATION);
  const doc = createSofaDocument(sections.some(s => s.kind === 'corner') ? 'corner' : 'chaise');
  doc.catalogueModel = 'norsborg';
  doc.title = 'Norsborg combination';
  doc.preset = sections.some(s => s.kind === 'corner') ? 'corner' : 'chaise';
  Object.assign(doc.dimensions, {
    height: 85,
    armWidth: 16,
    armHeight: 52,
    seatHeight: 43,
    seatThickness: 12,
    backThickness: 15,
    legHeight: 18,
  });
  Object.assign(doc.construction, {
    legStyle: 'square',
    legWidth: 3,
    frameHeight: 52,
    backCushionHeight: 45,
  });
  doc.style = { arm: 'square', back: 'short', cushion: 'boxed', base: 'snug' };
  doc.fabric = { family: 'weave', colour: NAVY };
  doc.pillows = 0;
  doc.norsborg = { sections };
  applyNorsborgLayout(doc);
  for (const module of doc.modules ?? []) {
    const section = sections.find(s => s.id === module.id)!;
    if (!NORSBORG_SECTIONS[section.kind].armOnly) styleNorsborgSection(doc, module, section.kind);
  }
  doc.source = {
    kind: 'cw',
    reference: 'IKEA NORSBORG · Comfort Works section covers',
    notes: [
      'Cushions match the CW PID measurements to the centimetre (Original VELC_WR): 88 cm-deep sections on 18 cm legs, seat height 43, 15 cm back frames; three-seat back frame 60 cm tall, all others 52 cm.',
      'Seat cushions: two-seat 65/60 × 73, three-seat 66/61 × 73, corner 72.5 × 72.5, chaise 78 × 142; thickness 11.5–12. Back cushions 44–45 tall, 12 thick, 61–87 wide.',
      'Reference order: Original, Everyday Weave Navy (EYL-44), velcro wrap fitting (VELC_WR); armrest covers without pockets (VELC_WR_NARM), PID measured in Signature (LSKT_SI).',
      'Each section needs one cover; add or remove sections below and the layout, arms and cover list reconfigure.',
    ],
  };
  return doc;
}

export interface NorsborgCoverLine {
  kind: NorsborgSectionKind;
  name: string;
  code?: string;
  quantity: number;
  unitPrice?: number;
  lineTotal?: number;
  unitLabel: string;
}

/** Covers needed for the current chain, priced like the customer order. */
export function norsborgCoverSummary(sections: NorsborgSection[]): NorsborgCoverLine[] {
  const counts = new Map<NorsborgSectionKind, number>();
  for (const section of sections) counts.set(section.kind, (counts.get(section.kind) || 0) + 1);
  return NORSBORG_SECTION_KINDS.filter(kind => counts.get(kind)).map(kind => {
    const { cover } = NORSBORG_SECTIONS[kind];
    const count = counts.get(kind)!;
    const quantity = cover.unit === 'pair' ? Math.ceil(count / 2) : count;
    return {
      kind,
      name: cover.name,
      code: cover.code,
      quantity,
      unitPrice: cover.unitPrice,
      lineTotal: cover.unitPrice ? cover.unitPrice * quantity : undefined,
      unitLabel:
        cover.unit === 'pair' ? `${count} armrest${count === 1 ? '' : 's'} · pairs` : 'sections',
    };
  });
}

export function norsborgCoverTotal(lines: NorsborgCoverLine[]): number | undefined {
  const priced = lines.filter(l => l.lineTotal !== undefined);
  if (!priced.length) return undefined;
  return priced.reduce((sum, l) => sum + (l.lineTotal || 0), 0);
}

export const NORSBORG_ORDER_CONFIGURATION = ORDER_CONFIGURATION;
export const NORSBORG_CHAISE_CONFIGURATION = CHAISE_CONFIGURATION;
