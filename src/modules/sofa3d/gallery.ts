import { createSofaDocument, type SofaDocument } from './model';
export const STUDIO_GUIDES = [
  ['CS3B-RA-HB', 'Round arm · high back'],
  ['CS3B-RA-SB', 'Round arm · short back'],
  ['CS3L-RA-HB', 'Round arm · high back · projecting deck'],
  ['CS3L-RA-SB', 'Round arm · short back · projecting deck'],
  ['CS3B-SA-HB', 'Square arm · high back'],
  ['CS3B-SA-HB2', 'Square arm · full-width high back'],
  ['CS3B-SA-SB', 'Square arm · short back'],
  ['CS3L-SA-HB', 'Square arm · projecting deck'],
  ['CS3B-WA-HB', 'Wedge arm · high back'],
  ['CS3B-WA-SB', 'Wedge arm · short back'],
  ['CS1-CNR', 'Corner seat'],
] as const;
export function applyGalleryGuide(code: string, previous: SofaDocument): SofaDocument {
  const corner = code === 'CS1-CNR';
  const next = createSofaDocument(corner ? 'armchair' : 'sofa');
  next.title = code;
  next.guideCode = code;
  next.fabric = { ...previous.fabric };
  next.pillows = 0;
  next.style.arm = code.includes('-RA-') ? 'round' : code.includes('-WA-') ? 'wedge' : 'square';
  next.style.back = code.includes('-SB') ? 'short' : 'high';
  next.construction.looseCushions = false;
  next.construction.frontExtension = code.startsWith('CS3L') ? 14 : 0;
  next.dimensions.armWidth = next.style.arm === 'round' ? 25 : 17;
  next.dimensions.backThickness = 20;
  next.construction.backTopThickness = 12;
  next.construction.backRake = 8;
  if (corner)
    next.modules = [
      {
        id: 'main',
        width: 100,
        depth: 100,
        x: 0,
        z: 0,
        rotation: 0,
        leftArm: false,
        rightArm: false,
        back: true,
        seats: 1,
        corner: true,
        cornerSide: 'right',
      },
    ];
  return next;
}
