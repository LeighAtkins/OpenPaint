# Real sofa reconstruction benchmark

Five products across IKEA, Pottery Barn, West Elm and Restoration Hardware were rendered with the same `SofaDocument`, `buildSofaParts` and `SofaRenderer` used by the editor. The original storefront photographs are displayed beside the live model in `tmp/sofa-guide-review/benchmark.html` (local development artifact). Each model can be opened in the studio with `/?studio=3d&benchmark=<id>` or exported as editable JSON.

## Method and limits

CW's public measurement endpoint returned the dimensions below. Component sizes were estimated from the photos using existing controls; authenticated PID component measurements were not loaded for this exercise. The exact product variant is recorded. This is a visual capability test, not a dimensional certification or an image-to-3D automation claim. The photo and render cameras are approximate matches; no numerical silhouette similarity score is claimed. Back/side construction hidden in the product photo cannot be verified from that photo alone.

| Model / benchmark ID | CW dimensions, W × D × H cm | Result | Main missing controls |
|---|---|---|---|
| [IKEA Karlstad 3 seater](https://comfort-works.com/products/karlstad-3-seater-sofa-cover) / `karlstad` | 205 × 93 × 80 | Closest family match; not accurate | Square timber legs, cushion crown/boxing, independent back cushion lean |
| [IKEA Ektorp 3 seater](https://comfort-works.com/products/ektorp-3-seater-sofa-cover) / `ektorp` | 218 × 88 × 88 | Recognisable | Independently adjustable rolled-arm radius and upright, shaped end cushions, skirt panels/pleats |
| [PB Basic, Mitchell Gold, Classic](https://comfort-works.com/products/pb-basic-sofa-slipcover) / `pb-basic` | 209.5 × 90 × 96.5 | Too similar to Ektorp | Flared scroll profile, arm face seam, skirt openings and drape |
| [West Elm Harmony 82 inch, 47 inch depth](https://comfort-works.com/products/harmony-82-sofa-slipcover) / `harmony` | 208.28 × 119.38 × 86.36 | Basic layout only | Recessed timber supports, per-pillow rotation, loft, sag and softer edge profiles |
| [RH Cloud corner chair, extra depth](https://comfort-works.com/products/cloud-modular-corner-chair-slipcover) / `cloud-corner` | 114.3 × 114.3 × 46.99 | Correct corner topology; wrong upholstery | Independent cushion rotation and corner edges, oversized pillow loft, explicit frame-versus-cushion height datum |

The Cloud height appears to describe the low frame, based on the photograph; this interpretation is not verified. Its trial model uses an explicitly labelled 80 cm estimate for loose-cushion height, retaining the 46.99 cm source value in model notes. Using that source field blindly as total height would squash the sofa. This is an important measurement-binding failure mode.

## What to build next, in order

1. **Bind typed measurements to geometry.** Keep frame height, overall height with cushions, arm height, seat height and cover-pattern dimensions separate. Preserve PID, version, units, measurement guide field (e.g. F1–F4), confidence and origin for every bound value. Mark missing values as estimates in the editor. The existence of data does not prove that a generic width/height/depth mapping is correct.
2. **Make gallery profiles parametric.** RA needs roll radius, overhang, stem width, flare and front setback. HB needs four side-profile edges; SB needs its own frame profile. Add independent deck projection and T/L/notched cushion outlines. Use shared editable profile control points so new gallery variants do not require another hard-coded box.
3. **Add independent upholstery controls.** Per-component rotation, crown/loft, taper, edge type, piping, top/bottom thickness and asymmetric front/back widths. Corner cushions need editable joins and collision/clearance feedback. A half-knife cushion cannot be the same geometry as a knife cushion with a different label.
4. **Replace placeholder bases.** Square/tapered legs, recessed plinths and sled/block supports; skirt panels with pleats, openings and controlled drape. These visibly distinguish the products even in a plain fabric.
5. **Use these five as recurring acceptance examples.** Compare front, side and three-quarter views using aligned cameras; verify bound dimensions and cushion fit separately from visual likeness. Tune appearance only after geometry passes.

## Gallery corrections included before this exercise

The editor now has the RA overhanging upright profile, HB raised back with F1–F4 annotations, SB frame-height behavior, flush/projecting deck variants, gallery SVG reference views, and a dedicated corner seat with perpendicular backs. Seven focused geometry/model tests, module lint, type checking and production build passed before this benchmark. These changes address specific reported omissions; they do not establish perfect coverage of the full measurement gallery.

## Preset implementation follow-up

The five benchmark products are now selectable in Sofa Studio. The upgrade adds photo-estimated rolled-arm profiles, T cushions, cushion loft/taper/rotation, contour piping, pleated skirts and distinct supports. These address the initial comparison gaps below, but do not constitute a verified dimensional reconstruction. See SOFA_STUDIO.md for controls and validation.
