# Sofa Studio

Open `/?studio=3d`, the toolbar's **3D Studio**, **Edit in 3D** in Sectional Builder, or **Model in 3D** on a loaded CW product.

Three.js generates separate frame, arm, seat, back, pillow and leg meshes in centimetres. Select a component and edit its dimensions, or click its measurement label. Drag labels to reposition them. Move mode provides a translation gizmo; Measure mode anchors a new line to two clicked surface points. Anchors follow component resizing. Drafts save in local storage; JSON retains editability, GLB exports geometry in metres, and PNG includes measurements. Use in SofaPaint imports a rendered PNG.

The model library provides six starting layouts, measurement-guide profiles, illustrative fabric materials, and five selectable catalogue presets: IKEA Karlstad and Ektorp, Pottery Barn Basic, West Elm Harmony, and RH Cloud Corner. Open a preset with `/?studio=3d&model=karlstad` (also `ektorp`, `pb-basic`, `harmony`, `cloud-corner`). Each preset includes its public product reference photo and source link.

Construction controls include P-shaped rolled arms with separate roll radius, stem width, flare and setback; short/high back proportions; front deck extension; pleated skirts; and round, square, block or plinth supports. Individual cushions expose loft, softness, taper, piping, rectangular/T/miter outlines, three-axis rotation and offsets. Corner models include the return back and cushion. Piping follows the generated cushion contour. Catalogue overall dimensions are supplied values; component proportions and upholstery shapes are adjustable photo estimates. RH Cloud’s listed height is treated as a frame-height reference; its assembled cushion height remains estimated.

It is a modelling foundation, not automatic photo reconstruction or a complete Comfort Works catalogue/fabric library. Reference photos remain visual references. Product component cover measurements initialize estimated component geometry; construction allowances and missing assembled dimensions require review. Sectional imports approximate modules as rectangular footprints; shaped/45-degree module geometry is not yet faithfully reproduced. The inspector's height controls the back-frame target; the overall annotation measures the actual bounds including loose cushions.

Validation: TypeScript checking, module ESLint, production build and 15 targeted model tests. Tests cover all five preset round trips, finite geometry and cushion bounds, support styles, skirt extents, rotation persistence, invalid values and older draft defaults. Browser checks cover the five renders, component selection, rotation editing and undo. The isolated test configuration avoids starting a second Express backend.

## Extended reference models

The library also includes `nammaro` (armless outdoor slatted timber), `soderhamn` (thin arms and layered loose cushions), `jattebo` (double chaise, fixed upholstered backs), and `friheten` (corner pull-out sofa bed). Manufacturer sources and public dimensions are recorded in `src/modules/sofa3d/extended-products.json`. Component shapes remain estimates; these presets do not claim verified CW cover compatibility. NÄMMARÖ has a source link but no reference thumbnail available.

FRIHETEN's Open bed control removes the loose back cushions and adds an editable mattress extension and supports. Closing restores the original cushions. Open/closed state and extension depth persist in JSON and undo history. The default sleeping surface spans 204 × 140 cm. This represents the two usable configurations, not articulated linkage or storage internals.

Skirts now start at the rolled-arm uprights, follow arm-front setbacks, and flare toward the floor; pleats develop below the attachment seam. Supports are inset within that narrower skirt footprint. Added tests check both arm joins and the bed's continuous dimensions and open/closed round trip.
