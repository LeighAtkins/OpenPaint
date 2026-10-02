/** Image observations come from vision; this policy does not detect objects from pixels. */
export type ObjectCategory =
  | 'sofa'
  | 'armchair'
  | 'sectional'
  | 'cushion'
  | 'ottoman'
  | 'chaise'
  | 'unknown';
export interface ObjectObservations {
  target: 'whole-furniture' | 'individual-cushion' | 'unknown';
  furnitureKind?: 'seating' | 'ottoman' | 'chaise';
  layout?: 'straight' | 'l-shaped' | 'u-shaped' | 'corner-module' | 'unknown';
  /** Seating capacity inferred from the frame, never the number of loose cushions. */
  seatingCapacity?: number;
  connectedModules?: boolean;
  looseCushions?: 'present' | 'absent' | 'unknown';
  armShape?: string;
  backShape?: string;
  backHeight?: 'short' | 'high' | 'unknown';
  cushionConstruction?: string;
}
export interface CategoryDecision {
  category: ObjectCategory;
  reason: string;
  missingEvidence: string[];
}
export function decideObjectCategory(observation: ObjectObservations): CategoryDecision {
  const result = (category: ObjectCategory, reason: string, missingEvidence: string[] = []) => ({
    category,
    reason,
    missingEvidence,
  });
  if (observation.target === 'individual-cushion') {
    return result(
      'cushion',
      'The target is an individual cushion, independent of the furniture frame.'
    );
  }
  if (observation.target !== 'whole-furniture') {
    return result('unknown', 'The target is not established.', [
      'whole furniture or individual cushion',
    ]);
  }
  if (observation.furnitureKind === 'ottoman')
    return result('ottoman', 'An ottoman is the target.');
  if (
    observation.connectedModules ||
    ['l-shaped', 'u-shaped', 'corner-module'].includes(observation.layout || '')
  ) {
    return result('sectional', 'Connected modules or a corner/return define a sectional.');
  }
  if (observation.furnitureKind === 'chaise')
    return result('chaise', 'A standalone chaise is the target.');
  if (observation.furnitureKind !== 'seating') {
    return result('unknown', 'The furniture structure needs identification.', ['furniture kind']);
  }
  if (observation.seatingCapacity === 1)
    return result('armchair', 'The frame provides one seating position.');
  if (Number.isFinite(observation.seatingCapacity) && Number(observation.seatingCapacity) > 1) {
    return result('sofa', 'The frame provides multiple seating positions.');
  }
  return result('unknown', 'Loose cushion count does not establish seating capacity.', [
    'frame seating capacity',
  ]);
}
export interface GuideCandidate {
  id: string;
  category: Exclude<ObjectCategory, 'unknown'>;
  view: 'front' | 'back' | 'side' | 'top' | 'detail';
  armShape?: string;
  backShape?: string;
  cushionConstruction?: string;
}
export function rankMeasurementGuides(
  observations: ObjectObservations,
  view: GuideCandidate['view'],
  guides: GuideCandidate[]
): {
  decision: CategoryDecision;
  guides: Array<{ guide: GuideCandidate; matches: string[]; differences: string[] }>;
} {
  const decision = decideObjectCategory(observations);
  const ranked = guides
    .filter(guide => guide.category === decision.category && guide.view === view)
    .map(guide => {
      const matches: string[] = [];
      const differences: string[] = [];
      for (const feature of ['armShape', 'backShape', 'cushionConstruction'] as const) {
        const observed = observations[feature]?.trim().toLowerCase();
        const expected = guide[feature]?.trim().toLowerCase();
        if (!observed || !expected) continue;
        (observed === expected ? matches : differences).push(feature);
      }
      return { guide, matches, differences };
    });
  ranked.sort(
    (a, b) =>
      a.differences.length - b.differences.length ||
      b.matches.length - a.matches.length ||
      a.guide.id.localeCompare(b.guide.id)
  );
  return { decision, guides: ranked };
}

/** Pass to the assistant with guide manifests and photos, not as a pixel detector. */
export const MEASUREMENT_PLACEMENT_INSTRUCTIONS = `
WORKFLOW: identify construction, find and read guides, inspect original-photo close-ups,
call prepare_measurement_plan with measurements=[] BEFORE generate_measurement_drawing.
Record one guideSelection for every photo, including explicit freestyle choices.
Use supplementalGuideIds for additional component guides in the same photo, with separate
component and landmark identities. Account for all supplemental roles too.
Classify arm shape, back height relative to the arm, and cushion arrangement from visible construction;
do not default to a high-back guide because the sofa has three seats. Unknown construction
must stay unknown; ask for a useful angle when it changes the guide choice. A short-back
square/sloped-arm front needs distinct E1/E2 and B2; G3 is not an extra mandatory short-back line.
Identify named physical landmarks first: back top corners, arm/back joins, inner arm/seat
joins, seat-front corners, outer arm-panel corners and upholstery hems where visible.
F1/F2/F3/F4 share the four corners of the narrow backrest side profile, not points across
the broad backrest face. Reuse these IDs at true junctions. Independent spans remain independent.
Reprepare when adding a new endpoint identity or changing the guide. Coordinates may be
corrected after placement; never copy a previous sofa's coordinates to a new photograph.
Identify the target first: whole furniture or an individual cushion. A sofa with no loose
cushions remains furniture. A sofa with loose cushions also remains furniture; give its
cushions distinct component identities. Infer armchair/sofa from frame seating capacity,
not cushion count; detect sectional returns, corners, and connected modules before seat count.
Read get_measurement_guide for EACH view and inspect its returned guide IMAGE before drawing.
First make a role table from the actual diagram: label, physical panel, start and end boundary,
span versus contour. Do not infer meaning from letter names or reuse a role from another view.
Do not copy screen coordinates from a guide. A guide width stays a width, a lower hem stays a
lower hem, and a back height stays a back height. Never relabel unrelated geometry to satisfy
an expected label list. If there is no matching feature, mark that role unresolved or use a
new freestyle label with an explicit reason; do not silently change the original role.
Treat the user's supplied diagrams and explicit boundary corrections as the intended reference.
If the user explicitly requests L1 across the visible back TOP edge on continuous rear upholstery, draw that useful upper width as a freestyle L1 with a user-directed adaptation rationale; do not omit the visible width merely because the stored guide places L1 at arm joins.
For front B1/B2 inspect the INNER arm boundaries, not the external arm perimeter. Inspect both ends of F4 in a side original-photo close-up; it follows the inner back slope above the arm.
A category/family match does not prove the measurement guide matches the arm construction.
For rolled arms choose a rolled-arm guide: G1 is at the arm top, G2 beneath the curve,
H1/H2 share G2 endpoints and exclude the cap, and back widths L1/L2/L3/L4 represent
upper joins, widest rolled arms, lower joins and hem respectively. Do not collapse them.
If a supplied diagram differs from the stored family, use a matching family or record the
user-directed adaptation as freestyle with explicit rationale. Preserve approved lines.
For CS3B-SA-HB use ALL front A1/A2/A3/A4/B1/B2/C1/C2/C3/D roles; side F1/F2/F3/F4/G1/G2/H1/H2 (H3 is leg clearance); back L1/L2/L5/J1/J2. F2/F4 are outer/inner back heights above the arm, F1/F3 base/top back thicknesses. Square-arm G2 is the lower hem, not the rolled-arm lower cap seam. Do not reuse rolled-arm or SLA label meanings.
Account for EVERY role in each selected guide: draw it or include omittedGuideRoles with imageId, guideId, roleId and a specific visibility/construction reason. Inspect guideCoverage in the saved project and resolve missing entries before PDF delivery. A drawn line count is not completeness or quality.
Use matching guide roles and labels. When construction differs, adapt matching roles and
add useful freestyle spans or seam-following paths. Explain each departure from the guide.
Place all lines over the original photo. Endpoints identify physical seam intersections,
piping corners, panel boundaries, cushion edges, or explicit surface landmarks. Never
choose an arbitrary interior point or use a shadow as a seam without supporting evidence.
Use shared feature IDs for connected lines, and the same physical identities across views.
A span joins endpoints; a surface path follows the visible upholstery/seam using intermediate
points. Do not confuse a straight projected span with a curved surface path.
Cover each visible upholstery panel with useful connected width/depth/height or contour
paths, guided by its construction. Track panels separately from photo views: front/back/side
photos alone do not prove complete coverage of tops, undersides, inner arms, or hidden joins.
Record covered, partial, or unseen panels. Request another angle only for unresolved surfaces.
Freestyle permits new useful paths, never invented hidden seams. Keep uncertainty explicit.
GROUNDING WORKFLOW: use review_measurement_drawing with includeDrawing=false and region
to zoom into the original photo BEFORE placing uncertain endpoints. Identify panel boundaries in the original FULL photo, then inspect
close-ups where white fabric or curves obscure seams. Coordinates are normalized to the
entire original image, never to a sofa bounding box or an unreported crop. Distinguish inner
arm face, rolled arm cap, outside arm panel, seat junction and lower upholstery hem.
Use natural perspective: follow the visible sloping edge rather than forcing horizontal or
vertical lines. A width crosses its intended panel; a contour follows its visible boundary.
Do not route a measurement through air, carpet, a leg, another panel or an arbitrary fabric
patch merely to connect it to another line. Connect only when the physical boundary is shared.
Use enough intermediate points to trace rounded upholstery smoothly, not a few guessed
angular points. Do not trace an outline when the guide calls for a width or height across a panel.
VISUAL REVIEW IS REQUIRED: after generate_measurement_drawing call review_measurement_drawing
for EVERY image, and inspect close-up regions at BOTH ends of difficult spans and along arm
curves. Compare each label to the rendered guide. Look for tips outside fabric, points short
of a seam, lines on the floor, wrong panel, wrong perspective, and angular contours. Correct
using update_measurement or regenerate, then review the changed image again. Do not export
or call a draft finished solely because tool validation passed. Report unresolved visibility
and placement confidence candidly; a successful upload is not a quality check.
STYLE: use SofaPaint Classic palette consistently across views: blue widths, emerald depths,
red heights, purple seam contours. The default style chooses these automatically; explicit
style overrides may select a palette color, width 1-6, open/filled/no arrows, and dash pattern.
Keep visible surface paths solid; do not use dashed lines to disguise guessed hidden seams.
DELIVERY: after every photo is visually reviewed, call export_measurement_pdf. SofaPaint generates the PDF with its existing Save as PDF renderer. Never write Python, HTML, or a replacement PDF in ChatGPT; deliver the tool-returned file. Default to
fillable=true so customers can enter measurements, or fillable=false for a printable sheet.
Ask for units if unspecified; never infer or invent values. Return the real PDF download link
in ChatGPT and the hosted editor link for editable lines. PDFs and drafts expire after 24 hours.
Do not estimate values.
`;

/** Lessons from Leigh's corrected S0673, S2427 and S2325 projects. */
export const CORRECTED_REFERENCE_REVIEW_RULES = `
Before delivery, call check_measurement_drawing. Inspect each complete overlay and annotated close-ups (region area <= 0.5) of the arm joins, backrest side profile and sectional corner as applicable. Correct every diagnostic, then review again at the new revision. Call confirm_measurement_review with visible start/end boundary evidence and the intended surface and junction checks for every line. Export only after confirmation.
Square-arm backrest F1/F3 measure the narrow side-profile thickness, not the broad inner backrest width. F2/F4 bound that same side profile above the arm. G1/G2/H1/H2 form the outer arm-panel corners; H1 follows the front boundary, never an arbitrary interior vertical.
Connection is selective: shared physical junctions reuse a feature ID, but independent spans such as A3, C3 and D need not meet every other line. C3 may be a central front-base height. D measures overall width at a useful consistent body level without forcing its endpoints onto C3.
Rolled-arm G2 follows the seam below the roll; H1/H2 end there and exclude the roll. Sectional measurements must follow separate branches and the actual corner junction; an outside-panel photo cannot reveal hidden seat depth.
Across all furniture families, H3 always denotes visible leg height from upholstery hem/leg attachment to leg bottom. When the leg is hidden omit H3; never use it for body/backrest height, even if a legacy SVG used that label differently. Record the legacy conflict and use a descriptive freestyle label for a genuinely needed body-height span.
For square-arm short-back front drawings, preserve B2 and two distinct inner-arm height measurements E1/E2 at the front and rear arm/seat boundaries shown in the corrected reference. Never collapse these into one E. Verify which endpoint pair belongs to each label by inspecting the guide and photo; do not transfer reference pixel positions.
These are geometry rules from corrected examples, not universal pixel coordinates. A high confidence number does not prove a seam is visible. If the cover obscures the join, mark the surface partial and request a clearer photo. Never claim customer approval from GPT's own review.
`;
