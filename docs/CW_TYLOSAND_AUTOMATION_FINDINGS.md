# Tylosand automatic measurement placement — first experiment

Inspected 2026-09-05. This records a local feasibility experiment, not an integrated or validated automatic import feature.

## Verified source

Product: **Tylosand 2 Seat Right/Left Arm Sofa Cover**, `IK-TD-2M`.
Discovery exposes left (`L`) and right (`R`) variants and Original (`VELC_SP`) / Signature (`LSKT_WR`) styles.
The worked example uses **left / Original**, `IK-TD-2M__L`.

Existing `/api/integrations/cw/measurements/search` routes were used without changing authentication:

- `discover` finds the exact product and configuration.
- `load-selected` returns public overall dimensions but empty component measurement arrays and no images for this example.
- `load-selected-details` successfully returns authenticated QC details: five component images and 16 measurement rows.

Overall values are 154 × 89 × 55 cm. Component values are:

| Component | Measurements (cm) |
| --- | --- |
| Frame | Front panel width 160; front panel height 16; side width 89 |
| Seat cushion | Width 133; height 72; thickness 21 |
| Back cushion | Width 130; height 55; thickness 18 |
| Side cushion | Width 84; height 55; thickness 18 |
| Accent cushion | Top width 49; bottom width 54; height 47; bottom thickness 3 |

Do not equate overall width (154) with front panel width (160). The source provides distinct measurements; the reason for the difference has not been verified.

The API associates images and measurements through component objects. The images are orange pattern simulations on a blue background, with black surface lines. They are not labelled dimension-arrow diagrams. Their `type` is `pattern_simulation`. The accent image is named for `IK-TD-1X` despite belonging to this product's component: API association is stronger evidence than matching filename product prefixes alone.

## Implemented experiment

- `src/modules/measurement-mos/cw-pattern-lines.ts`: experimental pixel detector. It finds straight black segments with orange surface on both sides, returns normalized coordinates, and assigns no numeric measurements.
- `scripts/cw-pattern-proof.ts`: loads the local authenticated response and images, runs detection, proposes width/height bindings for the three box cushion components, and creates a self-contained HTML comparison plus JSON detections.
- `tests/unit/cw-pattern-lines.test.ts`: interior-line recovery and blank/malformed input checks.

Run with Node supporting TypeScript stripping:

```sh
node scripts/cw-pattern-proof.ts tmp/tylosand-proof
```

The local directory contains `source-private.json` and images named exactly as returned in `slipcover_details_images[].name`. Output: `index.html`, `detections.json`. It is gitignored. Authenticated source data and signed URLs must not be copied into tracked fixtures.

Result: six proposed bindings, out of 16 available measurement rows. No hand-entered coordinates or saved manual recipes were used. These are hypotheses, not six proven-correct measurements. Pixel detection is automatic; the restricted component-specific width/height interpretation is a heuristic. Some spans are partial approximations of slightly curved lines. Frame, thickness, and accent measurements remain unresolved. Overall dimensions have not been placed on an assembled product image. Right-arm and Signature variants have not been tested.

This detector deliberately excludes silhouettes and darker side surfaces. It is specific to these orange simulation renders; it is not a general photo detector. Do not integrate it into automatic completion of measurement rows yet.

## Next engineering steps

1. Trace entire black curves to their actual surface endpoints rather than treating every mark as a straight segment. Retain separate evidence for the path and the measurement identity.
2. Establish source-specific rules for frame dimensions, thickness, and the accent cushion's top/bottom widths. Check whether the simulation renderer or source model contains explicit measurement anchors.
3. Verify left/right, styles, and shared components. The existing line library key drops the left/right suffix and permits style fallback; it cannot safely be the identity contract for this automation.
4. Bind current numeric values by product/version/style/component/measurement ID, not by an old saved drawing's value or a global A/B label.
5. Only after source-to-geometry validation, create editable native OpenPaint strokes through existing metadata, units, history, tags and coordinate transforms. Preserve all five stroke maps.

## 3D implication

The source images appear to be rendered geometry. Investigate the original simulation assets before attempting generative reconstruction. No original mesh or CAD asset has been verified in this experiment. Image generation cannot recover guaranteed exact hidden geometry. A measurement-constrained model remains a separate possible path.

## Validation

Two targeted unit tests pass. TypeScript checking and detector lint pass. The local HTML was inspected in the browser. Vitest also attempted to start Express on occupied port 3000 and reported a shutdown timeout; the tests themselves passed. No production deployment, live import wiring, library persistence changes, or authentication changes were made.
