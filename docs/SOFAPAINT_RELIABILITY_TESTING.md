# SofaPaint reliability testing

## Current workflow

New drafts identify construction and landmarks before placing lines. `find_measurement_guides` ranks arm shape and back height before limiting catalogue results. `get_measurement_guide` returns required labels, curated physical roles where available, and corrected short-back E1/E2/B2 meanings.

Before `prepare_measurement_plan`, inspect an original-photo close-up for each photo with `review_measurement_drawing`, `includeDrawing=false`, and a region of area at most 0.5. Prepare one guide or explicit freestyle selection for every image, list supplemental component guides in supplementalGuideIds when needed, record construction evidence, identify components and surfaces, and name visible physical landmarks. Leave measurements empty. Preparing advances the revision and preserves existing lines.

Generate from those landmark identities and selected guides. New endpoints or guide choices require preparing an updated plan. Endpoint coordinates remain editable. Full annotated previews and close-ups, complete role accounting and per-line visual confirmation remain required before native PDF export. Existing drafts remain editable without the new planning prerequisite.

These checks constrain the workflow, not photographic truth. GPT can still misidentify a boundary or describe it incorrectly. Human correction and unseen-photo evaluation remain essential. Unknown construction is explicit; hidden surfaces request another view rather than invented endpoints.

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

The report lists missing and unexpected labels, ambiguous duplicated labels, normalized endpoint errors, path-type differences and unscored views. It does not measure millimetres, prove seams are correct, or establish contour quality. Compare generated and corrected projects on the same photos. A successful PDF or high self-reported confidence is not a drawing-quality pass.
