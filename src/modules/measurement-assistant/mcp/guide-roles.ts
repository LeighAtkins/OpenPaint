import { selectedGuideIds } from './construction-plan';
import type { MeasurementPlacement } from '../placement-model';

/** Reviewed against the stored CS3B-SLA-HB2 diagrams, not inferred from label letters. */
const roles: Record<string, Record<string, string>> = {
  front: {
    A1: 'Width of the backrest at its top edge, between the two backrest side boundaries.',
    A2: 'Width of the backrest at the seat/back junction, between the inner arm joins.',
    A3: 'Backrest height through the centre, from its top edge to the seat/back junction. Do not move this onto an arm.',
    B1: 'Short seat-level span shown at the left inner arm join. Inspect the diagram endpoints; do not substitute an arm outline.',
    B2: 'Short horizontal span shown at the upper left arm/back join. Inspect the diagram endpoints; do not substitute an arm contour.',
    C1: 'Width across the upper right arm face, from its inner boundary to its outer boundary; a straight span, not the curved arm perimeter.',
    C2: 'Width across the lower right arm face at seat-front level; a straight span, not a descending contour.',
    C3: 'Vertical height of the left arm face from its upper boundary to the lower upholstery hem; excludes legs and floor.',
    C4: 'Height of the front seat/base panel from its upper seam to the upholstery hem, drawn near the centre; not an arm diagonal.',
    D: 'Overall width of the upholstered front at the lower hem, ending at left and right upholstery boundaries; never on the floor.',
    E: 'Short vertical inner arm height at the right rear seat/back join, between the arm top and seat-level junction.',
  },
  side: {
    F1: 'Thickness of the backrest at its base: short depth span from outer rear back boundary to inner back/arm junction; not the length of the side panel.',
    F2: 'Thickness of the backrest at its top: short span across the top of the backrest; not a diagonal across the seat.',
    G1: 'Overall arm/body depth from outer rear boundary to front arm boundary at the arm panel; not a vertical arm height.',
    G2: 'Inner arm depth from the inner back/arm junction to the front arm boundary; follows depth perspective, not back height.',
    G3: 'Overall upholstered body depth along the LOWER HEM from rear to front; not a vertical line up the backrest.',
    H1: 'Front arm/body height from the arm top boundary to the lower upholstery hem at the front.',
    H2: 'Rear arm/body height from the inner back/arm junction to the lower upholstery hem; not a diagonal from the front arm tip.',
    H3: 'Leg height/clearance only: lower upholstery hem at the leg attachment to the bottom of the visible leg. If the leg is hidden, omit H3 with an explicit visibility reason. Never use H3 for backrest or body height.',
    H4: 'Leg clearance from lower upholstery hem to leg bottom. Omit for upholstery-only requests and record the omission; do not repurpose as another span.',
  },
  back: {
    L1: 'Width of the upholstered back at its TOP boundary; both arrow tips stop at the actual left and right boundary corners.',
    L2: 'Width of the upholstered back at its LOWER HEM; both arrow tips stop at the actual left and right hem corners, above legs/floor.',
    J1: 'Back panel height at its centre from top upholstery boundary to lower hem; follows the panel perspective.',
  },
};
/** Rolled-arm family: arm cap, lower cap seam and hem are separate boundaries. */
const rolledRoles: Record<string, Record<string, string>> = {
  front: {
    A1: roles.front.A1,
    A2: roles.front.A2,
    A3: roles.front.A3,
    A4: 'Seat-front width between the front inner arm/seat seam intersections.',
    B1: 'Inner arm depth from rear seat/back join to front inner arm/seat intersection.',
    B2: 'Arm top depth between rear and front cap boundaries; not arm-face width.',
    C1: 'Width across the widest rolled arm FRONT cap, between its inner and outer visible boundaries; not at the rear arm/back join.',
    C2: 'Width across the arm FRONT face at the seat-front seam, beneath the rolled cap.',
    C3: 'Arm front height from the top of its rolled cap to its lower upholstery hem.',
    C4: roles.front.C4,
    D: roles.front.D,
    E1: 'Surface path around the rolled front arm cap, following its visible seam from the inner lower join over the crown to the outer lower join.',
  },
  side: {
    F1: 'Backrest thickness at the arm-top level.',
    F2: 'Outer backrest height above the arm top.',
    F3: 'Backrest thickness across its top.',
    F4: 'Inner backrest height above the arm top.',
    G1: 'Arm depth along its TOP boundary, between front and rear arm boundaries; above the rolled cap lower seam.',
    G2: 'Arm/body depth along the seam UNDER the rolled curve, joining the tops of H1 and H2.',
    G3: roles.side.G3,
    H1: 'Front side-body height from the lower upholstery hem ONLY to G2 beneath the rolled curve; excludes the rolled cap.',
    H2: 'Rear side-body height from the lower upholstery hem ONLY to G2 beneath the rolled curve; excludes the rolled cap.',
    H3: 'Visible leg height only, from upholstery hem to leg bottom. Omit if the leg is not visible; never use for backrest or body height.',
  },
  back: {
    L1: 'Back width between rear arm/back joins at the UPPER arm level; not the backrest top.',
    L2: 'Overall back width between the widest outer rolled-arm boundaries.',
    L3: 'Back body width immediately UNDER the rolled arms, between their lower joins.',
    L4: 'Back body width at the LOWER upholstery hem; both tips stop on fabric.',
    J1: roles.back.J1,
    J2: 'Outer rear side height from upper arm/back join to lower upholstery hem.',
  },
};
/** Reviewed against the production CS3B-SA-HB SVG, including its supplemental labels. */
const squareRoles: Record<string, Record<string, string>> = {
  front: {
    A1: 'Backrest upper width between its side boundaries, on the photographed top edge. Follow perspective; never float a horizontal line above the sofa.',
    A2: roles.front.A2,
    A3: roles.front.A3,
    A4: rolledRoles.front.A4,
    B1: 'Inner arm depth INSIDE the armrest at seat level: rear seat/back/arm join to front seat/inner-arm seam intersection.',
    B2: 'Arm top depth INSIDE the armrest, along its inner upper upholstery boundary from rear arm/back join to front arm top INNER corner; never on the outside arm edge or backrest thickness.',
    C1: 'Front arm cap width between inner and outer top corners of the same arm face.',
    C2: 'Entire front arm face height from its top corner to lower upholstery hem; exclude legs.',
    C3: 'Lower front arm/base height from the seat-front seam to lower upholstery hem.',
    D: roles.front.D,
  },
  side: {
    F1: 'Backrest thickness at its BASE above the arm: outer rear back/arm-level join to inner sloping back/arm-top join. Short span, not arm depth.',
    F2: 'Outer backrest height ABOVE the arm: outer rear back top corner to outer rear back/arm-level join. Not top thickness or full body height.',
    F3: 'Backrest TOP thickness: outer rear top corner to inner top corner. Follow the sloping top edge.',
    F4: 'Inner backrest height ABOVE the arm: identify the INNER top corner and INNER back/arm-top join in an original-photo close-up, then follow that visible sloping edge. Never substitute the outer rear edge or an arbitrary point on the arm.',
    G1: 'Side arm depth along the TOP arm boundary from rear arm-level boundary to front arm top corner.',
    G2: 'Side body depth along the LOWER upholstery HEM from rear hem corner to front hem corner; not a second arm-top line.',
    H1: 'Front side-body height from front arm TOP to front upholstery hem. Share endpoints with G1 and G2.',
    H2: 'Rear side-body height from rear arm level to rear upholstery hem; excludes the backrest above the arm. Share endpoints with G1 and G2.',
    H3: 'Visible leg height only, from rear upholstery hem to leg bottom. Omit with a visibility reason if the leg is hidden.',
  },
  back: {
    L1: 'Backrest width BETWEEN the arm/back joins at ARM-TOP level; not at the backrest top.',
    L2: 'Overall upholstered back width along the LOWER HEM, between outer side boundaries.',
    L5: 'Width across one rear arm at arm-top level, from outer arm boundary to arm/back join.',
    J1: roles.back.J1,
    J2: 'Rear side-body height from outer arm TOP level to lower upholstery hem; excludes the backrest above the arm.',
  },
};
export function getGuideRoles(guideId: string) {
  const match = /\/(front|side|back)_(CS3B-SLA-HB2|CS3B-RA-HB|CS3B-SA-HB)\.svg$/i.exec(guideId);
  if (!match) return undefined;
  return Object.entries(
    (match[2].toUpperCase() === 'CS3B-SA-HB'
      ? squareRoles
      : match[2].toUpperCase() === 'CS3B-RA-HB'
        ? rolledRoles
        : roles)[match[1].toLowerCase()]
  ).map(([label, meaning]) => ({
    roleId: label,
    label,
    meaning,
    pathKind: label === 'E1' ? ('surface-path' as const) : ('span' as const),
  }));
}

export function validateGuideRoles(placement: MeasurementPlacement): void {
  for (const measurement of placement.measurements) {
    const source = measurement.source;
    if (source.kind !== 'guide') continue;
    const roles = getGuideRoles(source.guideId);
    if (!roles) continue;
    const role = roles.find(item => item.roleId === source.roleId.replace(/(?:cm|in)$/i, ''));
    if (!role || measurement.label !== role.label)
      throw new Error(
        `Unknown or relabelled guide role for ${measurement.label}. Read the guide role table.`
      );
    const guideView = /\/(front|side|back)_/i.exec(source.guideId)?.[1].toLowerCase();
    if (placement.images.find(image => image.id === measurement.imageId)?.view !== guideView)
      throw new Error(`${measurement.label} uses a guide from a different view.`);
    if (measurement.path.kind !== role.pathKind)
      throw new Error(
        `${measurement.label} must retain its guide path type: ${role.meaning} Use a separate freestyle label for contours.`
      );
  }
}

/** Missing roles stay visible while editing; PDF delivery requires explicit accounting. */
export function getGuideCoverage(placement: MeasurementPlacement) {
  const selections = new Map<string, { imageId: string; guideId: string }>();
  for (const selection of placement.guideSelections || []) {
    for (const guideId of selectedGuideIds(selection))
      selections.set(`${selection.imageId}:${guideId}`, { imageId: selection.imageId, guideId });
  }
  for (const m of placement.measurements) {
    if (m.source.kind === 'guide')
      selections.set(`${m.imageId}:${m.source.guideId}`, {
        imageId: m.imageId,
        guideId: m.source.guideId,
      });
  }
  return [...selections.values()].flatMap(({ imageId, guideId }) => {
    const roles = getGuideRoles(guideId);
    if (!roles) return [];
    return roles.map(role => {
      const drawn = placement.measurements.some(
        m =>
          m.imageId === imageId &&
          m.source.kind === 'guide' &&
          m.source.guideId === guideId &&
          m.label === role.label
      );
      const omission = placement.omittedGuideRoles?.find(
        o => o.imageId === imageId && o.guideId === guideId && o.roleId === role.roleId
      );
      return {
        imageId,
        guideId,
        label: role.label,
        meaning: role.meaning,
        status: drawn ? 'drawn' : omission ? 'omitted' : 'missing',
        reason: omission?.reason,
      };
    });
  });
}
export function assertGuideCoverage(placement: MeasurementPlacement) {
  const missing = getGuideCoverage(placement).filter(role => role.status === 'missing');
  if (missing.length)
    throw new Error(
      `Incomplete guide coverage: ${missing.map(r => `${r.label} (${r.imageId})`).join(', ')}. Draw these physical spans, or supply omittedGuideRoles with an honest visibility/construction reason. Do not invent endpoints or relabel another span.`
    );
}
