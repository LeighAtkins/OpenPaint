export type SofaPreset = 'two-seat' | 'sofa' | 'chaise' | 'corner' | 'armchair' | 'ottoman';
export type CushionShape = 'boxed' | 'rounded' | 'knife' | 'half-knife';
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface SofaDimensions {
  width: number;
  depth: number;
  height: number;
  armWidth: number;
  armHeight: number;
  seatHeight: number;
  seatThickness: number;
  backThickness: number;
  legHeight: number;
  seatCount: number;
}
export interface SofaConstruction {
  frameStyle: 'upholstered' | 'slatted';
  backCushions: boolean;
  frontExtension: number;
  backTopThickness: number;
  backRake: number;
  backTopDrop: number;
  looseCushions: boolean;
  armRollRadius: number;
  armStemWidth: number;
  armFlare: number;
  armSetback: number;
  backCushionHeight: number;
  frameHeight: number;
  legStyle: 'round' | 'square' | 'block' | 'plinth';
  legWidth: number;
  skirtPleatDepth: number;
  skirtFlare: number;
}
export const DEFAULT_CONSTRUCTION: SofaConstruction = {
  frameStyle: 'upholstered',
  backCushions: true,
  frontExtension: 0,
  backTopThickness: 10,
  backRake: 6,
  backTopDrop: 1,
  looseCushions: true,
  armRollRadius: 0,
  armStemWidth: 0,
  armFlare: 0,
  armSetback: 0,
  backCushionHeight: 0,
  frameHeight: 0,
  legStyle: 'round',
  legWidth: 4.5,
  skirtPleatDepth: 3,
  skirtFlare: 1,
};
export interface SofaModule {
  corner?: boolean;
  cornerSide?: 'left' | 'right';
  id: string;
  width: number;
  depth: number;
  x: number;
  z: number;
  rotation: number;
  leftArm: boolean;
  rightArm: boolean;
  back: boolean;
  seats: number;
}
export type CushionOutline =
  | 'rect'
  | 't'
  | 't-left'
  | 't-right'
  | 'miter-left'
  | 'miter-right'
  | 'rl-left'
  | 'rl-right';
export interface PartOverride {
  rotation?: Vec3;
  loft?: number;
  taper?: number;
  softness?: number;
  piping?: boolean;
  outline?: CushionOutline;
  notchDrop?: number;
  width?: number;
  height?: number;
  depth?: number;
  offset?: Vec3;
  shape?: CushionShape;
}
export interface SurfaceAnchor {
  partId: string;
  point: Vec3;
}
export interface CustomDimension {
  id: string;
  a: SurfaceAnchor;
  b: SurfaceAnchor;
}
export interface SofaDocument {
  version: 1;
  title: string;
  preset: SofaPreset;
  dimensions: SofaDimensions;
  style: {
    arm: 'square' | 'round' | 'wedge';
    back: 'high' | 'short' | 'curved';
    cushion: CushionShape;
    base: 'snug' | 'long-skirt' | 'loose-fit' | 'straight-skirt';
  };
  construction: SofaConstruction;
  guideCode?: string;
  catalogueModel?: string;
  sleeper?: { open: boolean; moduleId: string; extension: number };
  fabric: { family: 'linen' | 'boucle' | 'velvet' | 'weave'; colour: string };
  overrides: Record<string, PartOverride>;
  modules?: SofaModule[];
  pillows: number;
  labelOffsets: Record<string, { x: number; y: number }>;
  customDimensions: CustomDimension[];
  referenceImage?: string;
  source?: { kind: 'cw' | 'sectional' | 'manufacturer'; reference: string; notes: string[] };
}
export interface SofaPart {
  id: string;
  name: string;
  role: 'frame' | 'seat' | 'back' | 'arm' | 'pillow' | 'leg' | 'skirt';
  size: Vec3;
  position: Vec3;
  rotation: Vec3;
  shape: CushionShape | 'square' | 'round' | 'wedge';
  guide: string;
  profile?: 'raised-back' | 'timber';
  skirtAttachment?: { leftWing: number; rightWing: number; setback: number; projection: number };
  loft: number;
  taper: number;
  softness: number;
  piping: boolean;
  outline: CushionOutline;
  notchDrop?: number;
}
export const SOFA_PRESETS: Record<
  SofaPreset,
  { name: string; width: number; depth: number; seats: number }
> = {
  'two-seat': { name: 'The two-seater', width: 218, depth: 96, seats: 2 },
  sofa: { name: 'The three-seater', width: 278, depth: 96, seats: 3 },
  chaise: { name: 'The chaise sofa', width: 278, depth: 165, seats: 3 },
  corner: { name: 'The corner sofa', width: 278, depth: 230, seats: 3 },
  armchair: { name: 'The armchair', width: 105, depth: 96, seats: 1 },
  ottoman: { name: 'The ottoman', width: 100, depth: 70, seats: 1 },
};
export const SOFA_SWATCHES = [
  { name: 'Oat', colour: '#bcb09b' },
  { name: 'Chalk', colour: '#dedbd0' },
  { name: 'Moss', colour: '#68715c' },
  { name: 'Clay', colour: '#a06851' },
  { name: 'Ink', colour: '#394859' },
  { name: 'Charcoal', colour: '#4a4743' },
];
export function createSofaDocument(preset: SofaPreset = 'two-seat'): SofaDocument {
  const spec = SOFA_PRESETS[preset];
  return {
    version: 1,
    construction: { ...DEFAULT_CONSTRUCTION },
    title: spec.name,
    preset,
    dimensions: {
      width: spec.width,
      depth: spec.depth,
      height: 82,
      armWidth: 17,
      armHeight: 62,
      seatHeight: 43,
      seatThickness: 17,
      backThickness: 16,
      legHeight: 9,
      seatCount: spec.seats,
    },
    style: { arm: 'square', back: 'high', cushion: 'boxed', base: 'snug' },
    fabric: { family: 'linen', colour: '#bcb09b' },
    overrides: {},
    pillows: preset === 'ottoman' ? 0 : preset === 'armchair' ? 1 : 2,
    labelOffsets: {},
    customDimensions: [],
  };
}
export function cloneSofa(doc: SofaDocument): SofaDocument {
  return JSON.parse(JSON.stringify(doc));
}
export function validateDimension(value: unknown, min = 1, max = 1000): number {
  if (value === null || value === undefined || typeof value === 'boolean' || value === '')
    throw new Error('Enter a numeric value.');
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`Enter a value between ${min} and ${max} cm.`);
  return max <= 2 ? n : Math.round(n * 10) / 10;
}
export function parseSofaDocument(raw: unknown): SofaDocument {
  if (!raw || typeof raw !== 'object') throw new Error('This is not a Sofa Studio model.');
  const input = raw as SofaDocument;
  if (
    input.version !== 1 ||
    !SOFA_PRESETS[input.preset] ||
    !input.dimensions ||
    !input.style ||
    !input.fabric
  )
    throw new Error('Unsupported Sofa Studio model.');
  const doc = cloneSofa(input);
  doc.construction = { ...DEFAULT_CONSTRUCTION, ...doc.construction };
  for (const k of [
    'frontExtension',
    'backTopThickness',
    'backRake',
    'backTopDrop',
    'armRollRadius',
    'armStemWidth',
    'armFlare',
    'armSetback',
    'backCushionHeight',
    'frameHeight',
    'legWidth',
    'skirtPleatDepth',
    'skirtFlare',
  ] as const)
    doc.construction[k] = validateDimension(doc.construction[k], 0, 100);
  if (!['round', 'square', 'block', 'plinth'].includes(doc.construction.legStyle))
    throw new Error('Invalid leg style.');
  if (
    !['upholstered', 'slatted'].includes(doc.construction.frameStyle) ||
    typeof doc.construction.backCushions !== 'boolean'
  )
    throw new Error('Invalid frame construction.');
  if (doc.sleeper) {
    if (typeof doc.sleeper.open !== 'boolean' || typeof doc.sleeper.moduleId !== 'string')
      throw new Error('Invalid sofa bed state.');
    doc.sleeper.extension = validateDimension(doc.sleeper.extension, 1, 300);
    if (!modulesFor(doc).some(m => m.id === doc.sleeper!.moduleId))
      throw new Error('Sofa bed module is missing.');
  }
  if (typeof doc.construction.looseCushions !== 'boolean')
    throw new Error('Invalid cushion visibility.');
  for (const key of Object.keys(createSofaDocument().dimensions) as Array<keyof SofaDimensions>)
    doc.dimensions[key] = validateDimension(
      doc.dimensions[key],
      key === 'legHeight' ? 0 : 1,
      key === 'seatCount' ? 8 : 1000
    );
  doc.dimensions.seatCount = Math.round(doc.dimensions.seatCount);
  if (
    !/^#[0-9a-f]{6}$/i.test(doc.fabric.colour) ||
    !['linen', 'boucle', 'velvet', 'weave'].includes(doc.fabric.family)
  )
    throw new Error('Invalid fabric.');
  if (
    !['square', 'round', 'wedge'].includes(doc.style.arm) ||
    !['high', 'short', 'curved'].includes(doc.style.back) ||
    !['boxed', 'rounded', 'knife', 'half-knife'].includes(doc.style.cushion) ||
    !['snug', 'long-skirt', 'loose-fit', 'straight-skirt'].includes(doc.style.base)
  )
    throw new Error('Invalid model style.');
  if (
    doc.dimensions.width <= doc.dimensions.armWidth * 2 + 15 ||
    doc.dimensions.seatHeight <= doc.dimensions.legHeight + doc.dimensions.seatThickness
  )
    throw new Error('The frame must have room for the arms and seat cushions.');
  const floor =
    doc.style.base === 'snug'
      ? doc.dimensions.legHeight
      : doc.dimensions.seatHeight - doc.dimensions.seatThickness;
  if (
    doc.dimensions.armHeight <= floor ||
    (doc.construction.frameHeight > 0 && doc.construction.frameHeight <= floor)
  )
    throw new Error('Arm and frame heights must sit above the base.');
  doc.title = (typeof doc.title === 'string' ? doc.title : 'My sofa').slice(0, 120);
  doc.overrides ||= {};
  doc.labelOffsets ||= {};
  doc.customDimensions ||= [];
  if (Object.keys(doc.overrides).length > 500 || doc.customDimensions.length > 100)
    throw new Error('This model has too many parts or dimensions.');
  for (const override of Object.values(doc.overrides)) {
    for (const k of ['width', 'height', 'depth'] as const)
      if (override[k] !== undefined) override[k] = validateDimension(override[k]);
    if (override.notchDrop !== undefined)
      override.notchDrop = validateDimension(override.notchDrop, 0, 500);
    if (override.rotation)
      for (const k of ['x', 'y', 'z'] as const)
        override.rotation[k] = validateDimension(override.rotation[k], -180, 180);
    for (const k of ['loft', 'softness'] as const)
      if (override[k] !== undefined) override[k] = validateDimension(override[k], 0, 1);
    if (override.taper !== undefined) override.taper = validateDimension(override.taper, -0.5, 0.5);
    if (override.piping !== undefined && typeof override.piping !== 'boolean')
      throw new Error('Invalid piping setting.');
    if (
      override.outline &&
      ![
        'rect',
        't',
        't-left',
        't-right',
        'miter-left',
        'miter-right',
        'rl-left',
        'rl-right',
      ].includes(override.outline)
    )
      throw new Error('Invalid cushion outline.');
    if (override.offset)
      for (const k of ['x', 'y', 'z'] as const)
        override.offset[k] = validateDimension(override.offset[k], -1000, 1000);
    if (override.shape && !['boxed', 'rounded', 'knife', 'half-knife'].includes(override.shape))
      throw new Error('Invalid cushion shape.');
  }
  doc.pillows = Math.round(validateDimension(doc.pillows ?? 0, 0, 8));
  if (doc.referenceImage && !/^data:image\/(png|jpeg|webp);base64,/.test(doc.referenceImage))
    delete doc.referenceImage;
  if (doc.modules) {
    if (!Array.isArray(doc.modules) || doc.modules.length > 60)
      throw new Error('Invalid module layout.');
    for (const m of doc.modules) {
      m.width = validateDimension(m.width);
      m.depth = validateDimension(m.depth);
      m.x = validateDimension(m.x, -1500, 1500);
      m.z = validateDimension(m.z, -1500, 1500);
      m.rotation = validateDimension(m.rotation, -360, 360);
      m.seats = Math.round(validateDimension(m.seats, 1, 8));
    }
  }
  for (const dimension of doc.customDimensions)
    for (const anchor of [dimension.a, dimension.b]) {
      if (!anchor || typeof anchor.partId !== 'string' || !anchor.point)
        throw new Error('Invalid measurement anchor.');
      for (const k of ['x', 'y', 'z'] as const)
        anchor.point[k] = validateDimension(anchor.point[k], -1, 1);
    }
  for (const offset of Object.values(doc.labelOffsets)) {
    offset.x = validateDimension(offset.x, -2, 2);
    offset.y = validateDimension(offset.y, -2, 2);
  }
  return doc;
}
function modulesFor(doc: SofaDocument): SofaModule[] {
  if (doc.modules?.length) return doc.modules;
  const d = doc.dimensions;
  const base: SofaModule = {
    id: 'main',
    width: d.width,
    depth: d.depth,
    x: 0,
    z: 0,
    rotation: 0,
    leftArm: true,
    rightArm: true,
    back: doc.preset !== 'ottoman',
    seats: d.seatCount,
  };
  if (doc.preset === 'ottoman') return [{ ...base, leftArm: false, rightArm: false }];
  if (doc.preset === 'chaise') {
    const cw = Math.max(70, d.width / d.seatCount);
    return [
      {
        ...base,
        width: d.width - cw,
        depth: Math.min(98, d.depth),
        x: -cw / 2,
        rightArm: false,
        seats: Math.max(1, d.seatCount - 1),
      },
      {
        ...base,
        id: 'chaise',
        width: cw,
        x: (d.width - cw) / 2,
        z: (d.depth - Math.min(98, d.depth)) / 2,
        leftArm: false,
        seats: 1,
      },
    ];
  }
  if (doc.preset === 'corner') {
    const depth = Math.min(98, d.depth / 2);
    const straight = Math.max(60, d.width - depth);
    const returnLength = Math.max(60, d.depth - depth);
    return [
      {
        ...base,
        width: straight,
        depth,
        x: -depth / 2,
        rightArm: false,
        seats: Math.max(1, d.seatCount - 1),
      },
      {
        ...base,
        id: 'corner',
        width: depth,
        depth,
        x: straight / 2,
        leftArm: false,
        rightArm: false,
        seats: 1,
        corner: true,
        cornerSide: 'right',
      },
      {
        ...base,
        id: 'return',
        width: returnLength,
        depth,
        x: straight / 2,
        z: (depth + returnLength) / 2,
        rotation: -90,
        leftArm: true,
        rightArm: false,
        seats: Math.max(1, Math.round(returnLength / 85)),
      },
    ];
  }
  return [base];
}
/** Outer upright is inset beneath the rolled overhang; skirt hangs from that upright. */
export function armSkirtInset(width: number, construction: SofaConstruction): number {
  return (
    width -
    Math.min(width * 0.95, construction.armStemWidth || width * 0.66) +
    Math.min(construction.armFlare, width * 0.3)
  );
}
export function buildSofaParts(doc: SofaDocument): SofaPart[] {
  const d = doc.dimensions;
  const construction = { ...DEFAULT_CONSTRUCTION, ...doc.construction };
  const parts: SofaPart[] = [];
  const add = (
    module: SofaModule,
    localId: string,
    name: string,
    role: SofaPart['role'],
    size: Vec3,
    position: Vec3,
    shape: SofaPart['shape'],
    guide: string,
    tilt = 0,
    roll = 0,
    localYaw = 0,
    profile?: SofaPart['profile']
  ) => {
    const id = `${module.id}:${localId}`;
    const override = doc.overrides[id];
    const yaw = (module.rotation * Math.PI) / 180;
    const offset = override?.offset || { x: 0, y: 0, z: 0 };
    parts.push({
      id,
      name,
      role,
      size: {
        x: override?.width ?? size.x,
        y: override?.height ?? size.y,
        z: override?.depth ?? size.z,
      },
      position: {
        x: module.x + position.x * Math.cos(yaw) + position.z * Math.sin(yaw) + offset.x,
        y: position.y + offset.y,
        z: module.z - position.x * Math.sin(yaw) + position.z * Math.cos(yaw) + offset.z,
      },
      rotation: {
        x: override?.rotation ? (override.rotation.x * Math.PI) / 180 : tilt,
        y: override?.rotation ? (override.rotation.y * Math.PI) / 180 : yaw + localYaw,
        z: override?.rotation ? (override.rotation.z * Math.PI) / 180 : roll,
      },
      loft: override?.loft ?? (role === 'pillow' ? 0.65 : 0.16),
      taper: override?.taper ?? 0,
      softness: override?.softness ?? (role === 'pillow' ? 0.7 : 0.25),
      piping: override?.piping ?? true,
      outline: override?.outline ?? 'rect',
      notchDrop: override?.notchDrop,
      profile,
      shape: override?.shape || shape,
      guide,
    });
  };
  for (const m of modulesFor(doc)) {
    const aw = d.armWidth;
    const left = m.leftArm ? aw : m.corner && m.cornerSide === 'left' ? d.backThickness : 0;
    const right = m.rightArm ? aw : m.corner && m.cornerSide !== 'left' ? d.backThickness : 0;
    const inner = Math.max(15, m.width - left - right);
    const baseH = Math.max(8, d.seatHeight - d.seatThickness - d.legHeight);
    const center = (left - right) / 2;
    const skirted = doc.style.base !== 'snug';
    const inset = doc.style.arm === 'round' ? armSkirtInset(aw, construction) : 0;
    const leftInset = m.leftArm ? inset : 0,
      rightInset = m.rightArm ? inset : 0;
    const skirtWidth = m.width - leftInset - rightInset;
    const skirtCenter = (leftInset - rightInset) / 2;
    const upholsteryFloor = skirted ? d.seatHeight - d.seatThickness : d.legHeight;
    add(
      m,
      'frame',
      'Frame',
      'frame',
      {
        x: (skirted ? skirtWidth : m.width) - (skirted ? construction.skirtPleatDepth * 2 + 2 : 0),
        y: baseH,
        z:
          m.depth +
          construction.frontExtension -
          (skirted ? construction.skirtPleatDepth * 2 + 2 : 0),
      },
      { x: 0, y: d.legHeight + baseH / 2, z: construction.frontExtension / 2 },
      'boxed',
      'Frame'
    );
    if (skirted) {
      add(
        m,
        'skirt',
        'Skirt',
        'skirt',
        { x: skirtWidth, y: d.legHeight + baseH - 1, z: m.depth },
        { x: skirtCenter, y: (d.legHeight + baseH + 1) / 2, z: 0 },
        'boxed',
        'Skirt'
      );
      parts[parts.length - 1].skirtAttachment = {
        leftWing: m.leftArm ? aw - leftInset : 0,
        rightWing: m.rightArm ? aw - rightInset : 0,
        setback: construction.armSetback,
        projection: construction.frontExtension,
      };
    }
    if (m.back) {
      const lowerHeight = (construction.frameHeight || d.armHeight) - upholsteryFloor;
      const addBack = (side: boolean) => {
        const sideSign = m.cornerSide === 'left' ? -1 : 1;
        const width = side ? m.depth - d.backThickness : skirted ? skirtWidth : m.width;
        const position = side
          ? { x: (sideSign * (m.width - d.backThickness)) / 2, z: d.backThickness / 2 }
          : { x: 0, z: -m.depth / 2 + d.backThickness / 2 };
        const yaw = side ? Math.PI / 2 : 0;
        add(
          m,
          side ? 'corner-back-frame' : 'back-frame',
          side ? 'Corner return back' : 'Back frame',
          'frame',
          { x: width, y: lowerHeight, z: d.backThickness },
          { ...position, y: upholsteryFloor + lowerHeight / 2 },
          doc.style.back === 'short' ? 'rounded' : 'boxed',
          'Back frame',
          0,
          0,
          yaw
        );
        if (doc.style.back !== 'short') {
          const rise = Math.max(1, d.height - (construction.frameHeight || d.armHeight));
          add(
            m,
            side ? 'corner-back-raised' : 'back-raised',
            side ? 'Corner raised back' : 'Raised back · F1–F4',
            'frame',
            {
              x:
                side || doc.guideCode?.endsWith('HB2') ? width : Math.max(15, width - left - right),
              y: rise,
              z: d.backThickness,
            },
            { ...position, y: (construction.frameHeight || d.armHeight) + rise / 2 },
            'boxed',
            'F1–F4',
            0,
            0,
            yaw,
            'raised-back'
          );
        }
      };
      addBack(false);
      if (m.corner) addBack(true);
    }
    for (const side of ['left', 'right'] as const)
      if (side === 'left' ? m.leftArm : m.rightArm)
        add(
          m,
          `arm-${side}`,
          `${side === 'left' ? 'Left' : 'Right'} arm`,
          'arm',
          {
            x: aw,
            y: Math.max(10, d.armHeight - upholsteryFloor),
            z: Math.max(10, m.depth - construction.armSetback),
          },
          {
            x: ((side === 'left' ? -1 : 1) * (m.width - aw)) / 2,
            y: (d.armHeight + upholsteryFloor) / 2,
            z: -construction.armSetback / 2,
          },
          doc.style.arm,
          'Arm'
        );
    const gap = 1.4;
    const seatWidth = Math.max(10, (inner - (m.seats - 1) * gap - 2) / m.seats);
    let cursor = -m.width / 2 + left + 1;
    for (let i = 0; i < m.seats; i++) {
      const actualWidth = doc.overrides[`${m.id}:seat-${i}`]?.width ?? seatWidth;
      const seatDepth =
        doc.overrides[`${m.id}:seat-${i}`]?.depth ?? m.depth - (m.back ? d.backThickness : 0) - 3;
      const outline = doc.overrides[`${m.id}:seat-${i}`]?.outline;
      const inset = outline?.startsWith('rl-') ? Math.min(actualWidth * 0.23, seatDepth * 0.28) : 0;
      const occupiedWidth = actualWidth - inset;
      const cx = cursor + occupiedWidth / 2;
      const seatX =
        cx + (outline === 'rl-left' ? -inset / 2 : outline === 'rl-right' ? inset / 2 : 0);
      if (construction.looseCushions)
        add(
          m,
          `seat-${i}`,
          m.corner ? 'Corner seat cushion' : `Seat cushion ${i + 1}`,
          'seat',
          { x: seatWidth, y: d.seatThickness, z: seatDepth },
          { x: seatX, y: d.seatHeight - d.seatThickness / 2, z: m.back ? d.backThickness / 2 : 0 },
          doc.style.cushion,
          'CC-BE'
        );
      if (m.back && construction.looseCushions && construction.backCushions && !doc.sleeper?.open) {
        const bh = construction.backCushionHeight || Math.max(15, d.height - d.seatHeight + 3);
        add(
          m,
          `back-${i}`,
          `Back cushion ${i + 1}`,
          'back',
          { x: seatWidth, y: bh, z: Math.max(10, d.backThickness * 0.8) },
          { x: cx, y: d.seatHeight + bh / 2 - 3, z: -m.depth / 2 + d.backThickness * 1.3 + 5 },
          doc.style.cushion,
          'CC-BE',
          -0.1
        );
      }
      cursor += occupiedWidth + gap;
    }
    if (m.corner && construction.looseCushions && construction.backCushions && !doc.sleeper?.open) {
      const bh = construction.backCushionHeight || Math.max(15, d.height - d.seatHeight + 3);
      const sign = m.cornerSide === 'left' ? -1 : 1;
      add(
        m,
        'corner-back-cushion',
        'Corner return cushion',
        'back',
        {
          x: Math.max(10, m.depth - d.backThickness * 2 - 15),
          y: bh,
          z: Math.max(10, d.backThickness * 0.8),
        },
        {
          x: sign * (m.width / 2 - d.backThickness * 1.3 - 5),
          y: d.seatHeight + bh / 2 - 3,
          z: d.backThickness / 2 + 8,
        },
        doc.style.cushion,
        'CC-BK-BE',
        0,
        0,
        -Math.PI / 2
      );
    }
    if (construction.frameStyle === 'slatted') {
      // Replace upholstered solids with actual open rails and slats.
      for (let i = parts.length - 1; i >= 0; i--)
        if (parts[i].id.startsWith(`${m.id}:`) && ['frame', 'arm'].includes(parts[i].role))
          parts.splice(i, 1);
      const timber = (id: string, name: string, size: Vec3, position: Vec3) =>
        add(m, id, name, 'frame', size, position, 'square', '', 0, 0, 0, 'timber');
      for (const z of [-1, 1])
        timber(
          `rail-${z}`,
          'Timber deck rail',
          { x: m.width, y: 6, z: 4 },
          { x: 0, y: d.seatHeight - d.seatThickness - 3, z: z * (m.depth / 2 - 6) }
        );
      for (let i = 0; i < 12; i++)
        timber(
          `slat-${i}`,
          'Seat slat',
          { x: (m.width - 6) / 12 - 1.2, y: 3, z: m.depth - 6 },
          {
            x: -m.width / 2 + 3 + ((i + 0.5) * (m.width - 6)) / 12,
            y: d.seatHeight - d.seatThickness - 1.5,
            z: 0,
          }
        );
      for (const side of [-1, 1]) {
        if (!(side < 0 ? m.leftArm : m.rightArm)) continue;
        const x = side * (m.width / 2 - 3);
        for (const z of [-1, 1])
          timber(
            `arm-post-${side}-${z}`,
            'Arm upright',
            { x: 4, y: d.armHeight - d.legHeight, z: 4 },
            { x, y: (d.armHeight + d.legHeight) / 2, z: z * (m.depth / 2 - 5) }
          );
        for (let i = 0; i < 5; i++)
          timber(
            `arm-slat-${side}-${i}`,
            'Arm slat',
            { x: 3, y: 4.5, z: m.depth - 6 },
            { x, y: d.seatHeight + 4 + (i * (d.armHeight - d.seatHeight - 6)) / 4, z: 0 }
          );
      }
      if (m.back) {
        for (const x of [-1, 1])
          timber(
            `back-post-${x}`,
            'Back upright',
            { x: 4, y: d.armHeight - d.legHeight, z: 4 },
            { x: x * (m.width / 2 - 5), y: (d.armHeight + d.legHeight) / 2, z: -m.depth / 2 + 3 }
          );
        for (let i = 0; i < 5; i++)
          timber(
            `back-slat-${i}`,
            'Back slat',
            { x: m.width - 6, y: 4.5, z: 3 },
            { x: 0, y: d.seatHeight + 4 + i * 6, z: -m.depth / 2 + 3 }
          );
      }
    }
    if (doc.sleeper?.open && m.id === doc.sleeper.moduleId) {
      const extension = doc.sleeper.extension;
      add(
        m,
        'bed-extension',
        'Pull-out mattress',
        'seat',
        { x: inner, y: d.seatThickness, z: extension },
        { x: center, y: d.seatHeight - d.seatThickness / 2, z: m.depth / 2 + extension / 2 },
        'boxed',
        'Bed'
      );
      add(
        m,
        'bed-support',
        'Pull-out support',
        'frame',
        { x: inner - 4, y: 6, z: extension - 2 },
        { x: center, y: d.seatHeight - d.seatThickness - 3, z: m.depth / 2 + extension / 2 },
        'boxed',
        ''
      );
      for (const x of [-1, 1])
        add(
          m,
          `bed-leg-${x}`,
          'Pull-out leg',
          'leg',
          { x: 4, y: d.seatHeight - d.seatThickness - 6, z: 4 },
          {
            x: center + x * (inner / 2 - 8),
            y: (d.seatHeight - d.seatThickness - 6) / 2,
            z: m.depth / 2 + extension - 6,
          },
          'square',
          ''
        );
    }
    if (construction.legStyle === 'block' || construction.legStyle === 'plinth') {
      for (const x of construction.legStyle === 'plinth' ? [0] : [-1, 1])
        add(
          m,
          `support-${x}`,
          construction.legStyle === 'plinth' ? 'Recessed plinth' : 'Timber support',
          'leg',
          {
            x: construction.legStyle === 'plinth' ? m.width - 14 : construction.legWidth,
            y: Math.max(0.5, d.legHeight),
            z: m.depth - 18,
          },
          { x: x * (m.width / 2 - construction.legWidth / 2 - 10), y: d.legHeight / 2, z: 0 },
          'square',
          ''
        );
    } else
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          add(
            m,
            `leg-${x}-${z}`,
            'Leg',
            'leg',
            { x: construction.legWidth, y: Math.max(0.5, d.legHeight), z: construction.legWidth },
            {
              x: skirtCenter + x * ((skirted ? skirtWidth : m.width) / 2 - 9),
              y: d.legHeight / 2,
              z: z * (m.depth / 2 - 9),
            },
            construction.legStyle === 'square' ? 'square' : 'round',
            ''
          );
    if (construction.looseCushions && m.id === 'main' && m.back)
      for (let i = 0; i < doc.pillows; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        add(
          m,
          `pillow-${i}`,
          `Accent pillow ${i + 1}`,
          'pillow',
          { x: 42, y: 42, z: 13 },
          {
            x: center + side * (inner / 2 - 29) - Math.floor(i / 2) * 28 * side,
            y: d.seatHeight + 19,
            z: -m.depth / 2 + d.backThickness + 25 + Math.floor(i / 2) * 6,
          },
          'knife',
          'CC-KE',
          -0.22,
          side * -0.17
        );
      }
  }
  return parts;
}
export function sofaFitNotes(doc: SofaDocument): string[] {
  const notes: string[] = [];
  const parts = buildSofaParts(doc);
  for (const m of modulesFor(doc)) {
    const seats = parts.filter(p => p.role === 'seat' && p.id.startsWith(`${m.id}:`));
    const available =
      m.width -
      (m.leftArm
        ? doc.dimensions.armWidth
        : m.corner && m.cornerSide === 'left'
          ? doc.dimensions.backThickness
          : 0) -
      (m.rightArm
        ? doc.dimensions.armWidth
        : m.corner && m.cornerSide !== 'left'
          ? doc.dimensions.backThickness
          : 0) -
      2;
    const used =
      seats.reduce(
        (sum, p) =>
          sum +
          p.size.x -
          (p.outline.startsWith('rl-') ? Math.min(p.size.x * 0.23, p.size.z * 0.28) : 0),
        0
      ) +
      Math.max(0, seats.length - 1) * 1.4;
    if (used > available + 0.5)
      notes.push(
        `Seat cushions overlap the available width by ${(used - available).toFixed(1)} cm.`
      );
    else if (available - used > 2)
      notes.push(`${(available - used).toFixed(1)} cm of space remains beside the seat cushions.`);
  }
  return notes;
}
export function setPartSize(
  doc: SofaDocument,
  id: string,
  field: 'width' | 'height' | 'depth',
  value: number
): SofaDocument {
  const next = cloneSofa(doc);
  next.overrides[id] = { ...next.overrides[id], [field]: validateDimension(value) };
  return next;
}
