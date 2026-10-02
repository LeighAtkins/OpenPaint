# SofaPaint reliability testing

## Current workflow

New drafts identify construction and landmarks before placing lines. `find_measurement_guides` ranks arm shape and back height before limiting catalogue results. `get_measurement_guide` returns required labels, curated physical roles where available, and corrected short-back E1/E2/B2 meanings.

Before `prepare_measurement_plan`, inspect an original-photo close-up for each photo with `review_measurement_drawing`, `includeDrawing=false`, and a region of area at most 0.5. Prepare one guide or explicit freestyle selection for every image, list supplemental component guides in supplementalGuideIds when needed, record construction evidence, identify components and surfaces, and name visible physical landmarks. Leave measurements empty. Preparing advances the revision and preserves existing lines.

Generate from those landmark identities and selected guides. New endpoints or guide choices require preparing an updated plan. Endpoint coordinates remain editable. Full annotated previews and close-ups, complete role accounting and per-line visual confirmation remain required before native PDF export. Existing drafts remain editable without the new planning prerequisite.

These checks constrain the workflow, not photographic truth. GPT can still misidentify a boundary or describe it incorrectly. Human correction and unseen-photo evaluation remain essential. Unknown construction is explicit; hidden surfaces request another view rather than invented endpoints.

When masks are already cached, `check_measurement_drawing` also checks sampled length-weighted path agreement against the exact row-major instance bitmaps. Photo bytes, dimensions, checkpoint and bitmap integrity are revalidated on cache reads. The tool does not launch inference or change the drawing. It reports instance membership, endpoints unsupported even within a small neighbourhood, lengthy outside-mask segments and suggested close-up regions. Holes and disconnected instances remain intact; overlapping instance fractions must not be summed as union coverage. Sampling spacing is recorded and small missed defects remain possible.

These are advisory warnings, not export gates. Correct spans can cross background and correct seams can lie outside imperfect model predictions. No predictions or no cached evidence is explicit, never a quality pass. Inspect the actual photo before changing a line; matching a predicted boundary is not evidence that the seam is correct.

## Independent live pilot

`scripts/run-sofapaint-drawing-pilot.ts` exercises the actual hosted MCP in explicit `import`, `draw`, `review` and `export` stages. It accepts private local JSON inputs, a new private output directory and unique stage-run names. It is not a vision API client or an unattended landmark detector: candidate landmarks must be authored from the original photos. It never retries a failed stage or automatically confirms visual review.

Import uses the reviewed source-image list, verifies hosted photo bytes against the reviewed model evidence, retains canonical photo bytes, and obtains full and detail original-photo previews. Draw validates a supplied normalized placement and maps its front/side IDs to actual draft photo UUIDs before preparing and generating. Review captures both full/detail overlays at the current revision plus live coverage and bitmap diagnostics. Export requires an explicit per-line visual report bound to all current preview hashes, then uses only the existing SofaPaint Save as PDF service. Stage markers refuse overwrite; stale draft revisions fail. Private state and capability-bearing editor links must remain outside Git.

Validate the native output with `scripts/check-sofapaint-native-pdf.py`. It checks the native manifest, blank measurement fields, per-page centimetre selections, widget/canonical-field ownership and values, unclipped widget rectangles and an in-memory fill/save round trip. The delivered source PDF is never filled or rewritten. Separately render and inspect every PDF page; structural QA cannot prove seam placement or visual quality.

An independent partial pilot is not a complete furniture measurement set or a production-accuracy claim. Record hidden surfaces and avoid duplicate independently fillable fields for the same physical measurement across views. Keep authored candidates and reconstructed human references separate.

`scripts/check-sofapaint-live-editor.ts` opens the actual private draft in fresh desktop/mobile browser contexts. It verifies canonical photo dimensions, exact line and surface-path geometry, canvas labels, settled measurement rows and absence of horizontal overflow. It performs a browser-local label drag, switches away and back, and restores serialized overlays. Hosted project writes are blocked and the project response hash must remain unchanged. Supply the private state path and a new private output folder; the optional third argument `http://127.0.0.1:5173` tests a local editor configured for the same Worker origin. Keep screenshots and draft capabilities outside Git.

Inspect these screenshots separately: matching stored geometry and counting tags can miss misplaced or clipped labels. Assistant placements store label anchors on measurement elements, while legacy SVG guides use separate label elements; both must retain their anchors without overriding saved user offsets. This QA is not evidence of physical seam accuracy.

## Human correction round

Use fresh ChatGPT conversations after refreshing the SofaPaint connection. Use the same ordinary request for each case:

> Please use SofaPaint to create editable seam-to-seam measurement drawings for this sofa from the front and side photos. Leave measurement values blank and deliver the editable project and a fillable SofaPaint PDF in cm.

Start with S2280 (short back: E1/E2/B2, no unnecessary G3), S0673 (square arms: inner B1/B2 and F1–F4), and S2427 (rolled arms: G2 below the cap and body heights ending there). Keep S1804 as the strong F1–F4 example. Save the untouched generated project before editing. Save the corrected version separately, using the same original photos and framing. Record missing labels, unwanted labels, wrong guide choices and hidden boundaries as well as moving endpoints. Do not change the prompt to tell GPT the expected answer.

Keep several different sofas outside the corrected reference set. Repeat on those unseen sofas before claiming broader reliability. Fresh conversations do not guarantee removal of account memory; record that limitation.

## Correction scoring

Run the scoring utility with Bun (the repository runtime resolves TypeScript module imports):

```sh
bun scripts/score-measurement-correction.ts reference.json candidate.json report.json front,side --same-framing
```

References support the stored geometry fixtures and simple centred, unrotated Fabric line vectors from S2280. The manual vectors are authoritative for added B2/E1/E2; its stale MOS SVG is not. Unsupported geometry is explicitly reported; complex Fabric transforms are rejected. Pass the actual photo-view order. Only use identical original photo framing; the flag records that explicit assertion and cannot verify it from pixels.

The report lists missing and unexpected labels, ambiguous duplicated labels, normalized endpoint errors, sampled symmetric path deviation (including a sampling-error upper bound), path-type differences and unscored photos/views. Photo identity is resolved only for a unique image of the stated view; pass an additional comma-separated image-ID list when there are multiple photos of one view. Conflicting correction geometry and off-image coordinates are rejected. Existing reports are never overwritten.

Legacy fixtures do not contain the original photo hashes, so historical framing remains explicitly unverified. The scorer's programmatic API additionally supports binding references and candidates to image SHA-256 and dimensions; mismatches do not receive geometry scores. Pixel-distance scores require that binding. None of these metrics measures millimetres, proves seam identity, or establishes physical accuracy. Compare independently generated and corrected projects, never copied references against themselves. A successful PDF or high self-reported confidence is not a drawing-quality pass.

For a private visual reconstruction of the four existing human corrections over the supplied customer photos, bundle `scripts/review-sofapaint-corrected-references.ts` with the existing Resvg WASM loader. Supply the absolute private mask-review directory and a new output directory. This generates original/mask/reference comparisons and records unverified historical framing. It is not an independent model evaluation and does not invent numeric measurement values.
