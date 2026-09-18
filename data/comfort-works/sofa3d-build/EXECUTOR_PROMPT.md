# Sofa3D: reliable overnight build prompt

Prepared from the six supplied files on 18 September 2026.

## How to use

Give GLM-5.3-flash the **Executor prompt** below, access to the actual OpenPaint repository, and the supplied catalogue files. Use this in place of the planning instructions emitted by the attached JavaScript. That JavaScript is a planning-request generator, not a completed modelling plan. Its API descriptions are leads to verify against the repository.

The objective is a complete library across resumable runs. An eight-hour limit is a limit on each run, not a promise that the entire catalogue can be modelled and verified within eight hours. A prompt cannot keep a terminated agent running: the runner must support the intended session length, tool access, and restarting from the saved state.

The prompt intentionally permits useful provisional models while preventing them from being reported as verified. Geometric checks catch structural failures; they cannot establish likeness to a real sofa without reliable reference evidence.

## What the attached files actually establish

| Finding | Consequence |
| --- | --- |
| 371 entries under `sofas.json.families`; 1,198 product occurrences | Family count is not the number of distinct objects to build. |
| 1,125 unique product references and 1,125 unique handles within those families | Reconcile duplicates before creating work orders. |
| 72 references occur more than once, accounting for 73 extra occurrences | Preserve collection memberships as aliases instead of generating duplicate models. |
| 12 families labelled built, two partial, 357 not built | Existing labels are declarations, not proof that every configuration exists. |
| Partial families: Klippan, four entries; Pottery Barn York, 17 entries | Audit configuration coverage before deciding what remains. |
| 1,074 product occurrences are in the 357 not-built families | This excludes the partial families and may include duplicate memberships. |
| 159 product occurrences have kind `other` | Classification needs evidence, not a default sofa preset. |
| Six protector products are labelled `chaise` | Title, identity and reference evidence must override unreliable kind heuristics. |
| Every family product occurrence has a reference and image URL | An image URL's presence does not prove the image is available or shows the correct configuration. |
| 17 fabric types and 81 colourways | Material variants should not multiply geometry jobs. |

Specific failures in the previous request: it counts partial families as already built in its objective, exempts built families from configuration-level audit, asks for unsupported exact parameters, conflates cover-pattern sizes with assembled dimensions, and makes a weak self-reported image comparison the final acceptance gate. It also allows edits to generated checklist rows that regeneration can overwrite. The replacement below addresses these issues.

---

# Executor prompt

You are implementing the Comfort Works catalogue in the existing OpenPaint Sofa3D application. Work autonomously in the repository for a maximum of eight hours per run. Continue the saved queue on subsequent runs until every source product has an explicit, evidence-backed disposition.

Your job is to produce recognisable, structurally correct, selectable 3D configurations and an honest coverage report. Quantity never overrides correctness. Do the implementation, validation and checkpointing, rather than ending with a proposed plan.

## 1. Operating contract

1. Inspect the repository and its applicable instructions before changing code. Preserve unrelated work. Record the initial branch, HEAD, dirty paths and validation baseline. Use an isolated branch or worktree if needed and supported; do not discard existing changes.
2. Reuse existing types, renderer, geometry, registry and test infrastructure. The supplied API summary is not authoritative. Read the actual implementations before using a field or declaring an API missing.
3. Build a durable local work queue from the complete input. Never attempt to remember the catalogue or progress only in conversation context.
4. Work sequentially by configuration, grouping related configurations into family-sized commits. Do not start parallel coding workers for this task.
5. Do not publish, deploy, push, send messages, change authentication, update packages, or modify production systems. Read-only use of already authorised data sources is sufficient. Do not log credentials or raw private customer payloads.
6. Implement shared changes only when an evidence-backed configuration requires them. No broad renderer rewrite, new UI framework, photorealistic fabric project, or unrelated refactoring.
7. Never silence a failed gate, widen a tolerance, alter a reference specification, or add an exception merely to make a model pass. Corrections require independent evidence and a recorded reason.
8. A successful build or render is not evidence that the model resembles its product. Never state that an image was inspected unless image inspection actually occurred.
9. Continue past isolated blocked items. Stop product implementation only for a systemic integrity problem that prevents safe progress; save a diagnostic handover in that case.

## 2. Inputs and scope

Locate these supplied files in the repo or supplied attachment directory:

- `sofas.json`: catalogue identities, family memberships and configuration-level references.
- `fabrics.json`: fabric and colourway membership.
- `README.md`: intended integration and generation paths.
- `CHECKLIST.md`: declared coverage, to audit rather than trust blindly.
- `index.html`: generated review board, not geometry evidence.
- `貼り付けたコード（1）.js`: previous planning-request generator, useful only as architectural context.

Expected initial inventory: 371 family entries, 1,198 family-product occurrences, 1,125 distinct product references, 12 declared-built families and two partial families. Recompute these from the actual inputs and record file hashes. If they differ, explain the discrepancy and use the actual source snapshot; do not force the expected totals.

The repository paths named by the input include:

```text
src/modules/sofa3d/model.ts
src/modules/sofa3d/adapters.ts
src/modules/sofa3d/renderer.ts
src/modules/sofa3d/profiles.ts
src/modules/sofa3d/upholstery.ts
src/modules/sofa3d/cushion-contact.ts
src/modules/sofa3d/extended-models.ts
src/modules/sofa3d/extended-products.json
src/modules/sofa3d/popular-models.ts
src/modules/sofa3d/benchmarks.ts
src/modules/sofa3d/benchmark-products.json
src/modules/sofa3d/norsborg.ts
tools/cw-catalog/pull-catalog.cjs
tools/cw-catalog/build-view.cjs
data/comfort-works/raw/collections/
data/comfort-works/raw/fabrics/
```

Verify existence. Do not fabricate contents of missing files. Catalogue metadata alone is insufficient to reconstruct an absent application. If the repository is missing, produce the reconciled queue and a precise repository-access blocker; do not create a substitute application.

## 3. Reconcile the full catalogue before building

Create a machine-readable inventory covering every product occurrence in `families`, with source family ID, handle, reference, title, product URL, image URL and original kind. Keep the source files unchanged.

Group matching references and handles into candidate canonical products. Confirm identity using the product URL and configuration description. Preserve every collection membership. Conflicting reference/handle matches go to an identity-review queue; do not merge on name similarity alone.

Inspect `categories` for products absent from the canonical inventory. Record these separately for reconciliation. Do not silently add category counts to the build denominator or silently drop unique category-only products. Report any unresolved scope additions.

Classify each canonical product into a supported object type: complete sofa, armchair, dining chair, ottoman/footstool, chaise, corner/module, sectional assembly, sofa-bed, recliner, headrest, armrest, protector, loose cushion, custom parametric template, or unresolved. These are inventory labels, not assumed renderer enum values.

Use title, product evidence and tags together. The `kind` field is a hint. For example, `backabro-chaise-armrest-protector-covers` is not automatically a complete chaise. Custom products need parametric templates, not invented standard dimensions. An accessory may need a reusable component attached to a parent model rather than a full sofa.

Resolve geometry-relevant variants: width, depth, seat/back count, chaise side, left/right arm, sectional composition, skirt style, and sleeper state. A reference can have multiple such variants. Record the convention used for handedness. Do not assume a single family image represents every product.

Create stable internal configuration IDs using canonical identity plus confirmed geometry variants. Material colourways remain a separate dimension. Preserve all 81 colourways in the material mapping, but do not create 81 copies of each mesh.

Produce both family-level roll-ups and configuration-level coverage. Audit declared-built families against actual selectable configurations. Reuse valid existing assets; schedule missing variants and genuine defects. Do not rebuild working models merely because they predate this run.

## 4. Persist state outside the conversation

Prefer existing project conventions; otherwise create the following small set of files under `data/comfort-works/sofa3d-build/`:

```text
inventory.json             source occurrences, canonical identities and aliases
queue.json                 ordered configuration jobs, dependencies and statuses
specs/<configuration>.json independently sourced target specifications
evidence/<configuration>/  reference metadata and generated validation artefacts
events.jsonl               append-only progress and failure events
checkpoint.json            run times, active item and next item
RUNBOOK.md                 actual commands, conventions and recovery procedure
REPORT.md                  latest reconciled outcomes and blockers
```

Keep saved state compact. Store images in an appropriate existing artefact location and reference them by path; avoid committing unnecessarily large screenshot sets. Use atomic writes for queue/checkpoint state and an append-only event log. Do not write secrets into these files.

Each job records at least:

```text
configurationId; canonicalProductId; familyIds; sourceReference;
sourceHandle; variant; objectType; dependencyIds; sourceInputHash;
specPath; buildStatus; dimensionStatus; structureStatus;
renderStatus; visualStatus; evidencePaths; implementationFiles;
attemptCount; lastError; nextAction; testedRevisionOrContentHash
```

Use separate statuses, not a single misleading green tick:

- Build: queued / sourcing / specified / implementing / implemented / blocked.
- Dimensions: verified / mixed / estimated / missing.
- Structure: pass / fail / not_run.
- Render: pass / fail / unavailable / not_run.
- Visual likeness: verified / needs_review / fail / unavailable.

Derive acceptance from these fields. `accepted` requires verified dimensions for the declared acceptance scope, passing structure and render gates, and recorded visual approval against independent evidence. Any remaining estimated shape-critical detail keeps the model provisional. `provisional` is useful selectable draft geometry with passing structure/render checks and explicit uncertainty. Blocked and failed models are not accepted assets. If existing UI cannot label drafts, keep provisional registrations behind a review-only path.

An alias is a mapping, not another accepted model. An accessory is not excluded merely because it is inconvenient. Give unsupported objects an explicit blocker. Coverage reports must show all these dispositions.

## 5. Eight-hour schedule and recovery

Record a real start time and absolute deadline. A resumed run must not reset an existing run's deadline unless the operator actually starts a new run. Check elapsed time between jobs and before expensive operations.

- Minutes 0–45: preflight, reconciliation, verify existing harness and run calibration cases. Reuse existing tools rather than building a new framework.
- Minutes 45–435: source, implement and validate configuration batches. Begin useful product work earlier if preflight is complete. If minimal tooling takes longer, record the cost and revise the forecast honestly.
- Minutes 435–480: stop starting new jobs; finish or isolate the current change, run required final validation, regenerate derived outputs, checkpoint, commit eligible work and write the handover.

Treat these as budget allocations, not permission to skip validation at a deadline. Prefer a clean incomplete batch over an untested accepted batch. If remaining time is less than estimated job time plus the finalisation reserve, do not start that job.

After every configuration, and at least every 10 minutes, save progress. Include exact next actions so a replacement session can resume without rereading the whole transcript. On resume, inspect saved state and file hashes, reconcile unfinished edits, and rerun stale checks before accepting anything. Do not restart completed work or regenerate IDs.

Time-box normal source research to roughly 10 minutes per configuration, shared where evidence applies to several variants. Allow up to two deliberate repair attempts after an initial validation failure. Two repeat failures of the same cause trigger a blocker and continuation. A new attempt must state what changed and why it should fix the error.

For repeated service timeouts or authentication failures, mark the source temporarily unavailable and move to the next permitted source. Do not retry it separately for hundreds of products. Preserve unresolved jobs for later retry. Use bounded command timeouts and terminate only task-owned stalled processes.

Measure throughput after the first few completed configurations. Forecast remaining runs from observed sourcing, implementation and validation times by complexity. Never adopt the previous S/M/L/XL estimates as measured capacity.

## 6. Source measurements correctly

Use evidence in this order, but verify its meaning:

1. Product-matched CW assembled/QC dimensions whose labels, units, measurement endpoints and revision are understood.
2. Manufacturer specifications or dimensioned drawings for the exact model, size and version.
3. Other clearly attributable product documentation, with explicit confidence and discrepancies.
4. Photo-derived proportions and estimates, restricted to provisional models.

A cover-pattern dimension is not automatically the assembled furniture dimension. It may include seam allowances, ease, shrinkage allowances, wrapping, flaps or a different measurement direction. Do not feed an unclassified pattern measurement into overall W/D/H. `fromCw()` is a starting adapter whose interpretation must be checked, not an accuracy certificate.

Store each measurement with value, original unit, normalised unit, semantic meaning, endpoints, source URL or internal record identifier, relevant label/excerpt, retrieval time, exact product/version match and confidence. Record conflicts rather than silently averaging them. Never infer a production measurement solely from a SKU suffix.

Identify the renderer's units, axes, rotations and origin from code and a known model. Normalise once at the boundary. Use 1 inch = 2.54 cm where applicable. Do not assume that a field named `height` means top-of-cushion height or that an angle is in degrees.

If verified dimensions are unavailable, either create an explicitly estimated review draft from sufficient reference evidence or block that configuration. Do not label a default size as measured. Never claim unseen source pages or unavailable raw tags were consulted.

## 7. Write the target specification before geometry

Create a per-configuration specification containing:

- Identity, version, configuration and references.
- Overall assembled envelope with dimensional semantics and source precision.
- Number and positions of seats, backs, modules, arms, visible legs and accent cushions, distinguishing known facts from uncertain ones.
- Absolute seat-top height, arm-top height, frame/back heights and component thicknesses where supported.
- Arm form: track, roll, flare, slope, armless or other verified profile; explicit front/side profile landmarks when available.
- Cushion shape, seams/piping, skirt coverage and length, base/leg form, back rake and distinctive silhouette features.
- Module connectivity, handedness convention, exposed edges and expected joins.
- Mechanism behaviour only when supported by evidence and the application scope.
- Measurement tolerances, permitted contacts/overlaps and known unknowns.

Numerical fields must have evidence or an explicit estimate flag. Never invent a detailed parameter sheet just to satisfy a schema. Freeze the target spec before tuning the implementation. Tests should compare actual rendered geometry to that independent spec, not merely compare a parameter to its own copied value.

## 8. Calibrate before scaling

Select a small set of existing assets, if available: a straight upholstered sofa, a rolled-arm sofa, an asymmetric chaise/sectional and an ottoman or chair. Verify their identity and reference evidence before treating them as baselines.

Confirm that the proposed harness can distinguish a known good case from task-local deliberately perturbed fixtures: wrong overall scale, missing back cushion, reversed chaise side, and empty render. Keep fixtures out of production registrations. The harness must detect these failures rather than just execute successfully.

Calibrate engineering tolerances against intended upholstery contacts and rendering softness. Record tolerances before bulk generation. Do not impose a zero-intersection rule on upholstery or symmetrical rules on intentionally asymmetric furniture.

If reliable visual truth is unavailable, calibrate structural/render checks and record the visual gate as unavailable. Continue producing provisional models without falsely certifying likeness.

## 9. Geometry implementation rules

Prefer data-driven presets and verified shared archetypes. Reuse code for repeated construction, not an unrelated sofa's silhouette. A shared arm profile must match the target's geometry. Do not assume every sleeper uses a Friheten mechanism or every sofa in a family has the same arm, seat or back layout.

Use `extended-products.json` and `extended-models.ts` only after verifying their actual schema and registration path. Do not extend legacy benchmark structures by default. Add a dedicated construction module only when the existing representation cannot express a required verified feature.

Derive dimensions from explicit relationships instead of unrelated magic numbers. For example, when the construction supports it:

```text
usable seat span = overall width - verified left arm span - verified right arm span
usable seat span = sum(seat widths) + sum(designed gaps) + end clearances
seat top = seat support top + rendered seat cushion thickness
```

These are examples, not assumptions that apply to every sofa. Use local coordinates and documented transforms for modular assemblies. Do not stretch a two-seat sofa uniformly to create a three-seat sofa. Width, arms, cushions and module arrangement must change according to the target spec.

Respect T cushions, notches, handed outlines, asymmetric arms, corners and intentional cushion overhangs. Do not mirror an entire assembly when mechanisms, piping or attachment details are not symmetric. Map each geometry variant explicitly to the selectable product entry.

Closed sofa-bed geometry can be delivered independently if that is the evidenced state. Do not pretend an unsupported open-bed state exists. Where open states are implemented, validate both endpoints and representative intermediate positions appropriate to the actual mechanism. Apply the same evidence requirement to recliners.

Keep fabric identity separate from geometry. Use a neutral matte diagnostic material for shape inspection. Use an existing verified swatch map for colour when possible. Colours sampled from lit product photography are approximate and must be labelled as such; colour matching must not block otherwise valid geometry work.

## 10. Structural acceptance checks for every configuration

Run checks on generated world-space geometry after transforms and deformations, not only on the input document. Exclude helpers, floor, lights and camera from furniture bounds. Define whether cushions and optional pillows belong to each reference envelope.

Required checks, where applicable:

1. All coordinates, transforms and dimensions are finite; required dimensions are positive; mesh geometry is non-empty; module and part IDs are unique.
2. Rendered overall W/D/H matches the independent target spec. Start with an engineering tolerance of `max(1 cm, 1% of the relevant dimension)` only where source precision and construction support it. Record calibrated exceptions in the spec. Estimated targets passing this check remain estimated.
3. Counts of seats, backs, arms and modules match the specified configuration. Do not automatically require seat count to equal back count.
4. Absolute height relationships match the spec, including seat top, arm top, back top, frame and floor contacts. No unintended below-floor geometry.
5. Cushion placement fills intended support regions with specified gaps and clearances. Detect unintended floating parts, excessive overlap and cushions disappearing inside the frame.
6. Modules join at documented interfaces, with correct transforms and no duplicate internal arms/backs unless the real construction has them.
7. Handedness, chaise footprint and module order match the source convention. Assert explicit landmark positions, not a vague left/right label.
8. Profile-critical landmarks or sampled sections match independently specified arm/back/base shapes within recorded tolerances.
9. Normals, winding and visibility are sensible for the existing material/culling setup. Generated assets stay within the application's established geometry/performance budget; if none exists, record measured costs against representative existing models before proposing a budget.
10. Registration resolves the exact product/configuration, and selecting another model or colour does not mutate shared preset state. Use existing isolation/deep-copy conventions.

Broad bounding-box overlap is a screening signal, not proof of collision. Use the appropriate local geometry or semantic contact checks for suspect pairs. Expected upholstery contacts must be defined in the target spec. Do not blanket-ignore all seat/frame or back/frame intersections.

## 11. Rendering checks that do not depend on visual intuition

Use the existing application renderer or the closest established automated renderer. Standardise viewport, device pixel ratio, camera definitions, lighting, background and neutral material. Wait for fonts/textures/geometry as relevant and a stable rendered frame before capture.

For every implemented configuration save front, side, top, rear and three-quarter views. Add the opposite side for asymmetric designs and open-state views for supported mechanisms. Generate cameras from bounds plus margin to prevent clipping, and save their parameters. For meaningful scale comparisons, use a common documented scale where required, not independently zoomed thumbnails.

Check for runtime/render errors, non-empty PNGs, visible foreground occupancy, framing, unexpected clipping and missing furniture. Inspect image pixels or use a reliable object-mask pass; a screenshot file existing is not a pass. Save the checks and images against a model/source hash so stale evidence cannot approve new geometry.

The contact sheet should show identity, reference, configuration, dimensions, status, source images and diagnostic renders. Use a neutral render to expose proportions. Do not hide defects with perspective, dramatic lighting, fabric patterns or a carefully chosen single angle.

If browser or renderer capability is unavailable, record `renderStatus: unavailable`; code validation alone cannot promote the model to provisional-rendered or accepted. Continue with independently useful preparation and other jobs whose gates are available.

## 12. Visual likeness gate

Do not award yourself an unsupported similarity score. Compare explicit features from the target spec: arm outline, back rake/height, seat/back counts, cushion divisions, seat-to-arm proportion, base/legs/skirt and the sectional footprint.

Use reference photographs of the exact configuration wherever possible. A family hero image, a cover-only photograph or another width is insufficient evidence for every variant. Missing rear or side evidence remains an explicit uncertainty.

Silhouette overlap, landmark error or profile distances are useful only when the reference and render share compatible viewpoint, projection, scale and object mask. Record alignment and normalisation. Do not use raw pixel differences between an arbitrary product photograph and an arbitrary render as an acceptance gate. Do not adopt an uncalibrated universal similarity threshold.

Visual verification requires either a previously approved reference/spec with applicable calibrated checks, or an actual independent visual review whose reviewer, evidence and outcome are recorded. If no independent review capability is configured, use `needs_review` and continue. Your own weak image judgement cannot turn missing evidence into approval.

For each reviewed feature report pass / fail / unknown with evidence. Any failed identity-critical feature prevents acceptance. Unknown identity-critical features require review. Keep provisional assets useful and clearly labelled; never resolve review backlog by changing all statuses to pass.

## 13. Per-configuration execution loop

Repeat until finalisation time:

1. Read checkpoint and select the highest-priority unblocked job with ready dependencies.
2. Resolve its exact identity and evidence. Reuse sourced facts only where they apply to that variant.
3. Write or verify the independent target spec; mark unknowns explicitly.
4. Choose the narrowest existing construction path, then implement the configuration.
5. Run relevant code validation and structural checks. Repair only with a stated hypothesis and bounded attempts.
6. Render all required views, perform objective checks, and record available visual review.
7. Assign honest orthogonal statuses; make only qualifying assets available through the appropriate production/review registry.
8. Save evidence, queue, event log and checkpoint. Commit a coherent validated family or subfamily unit, staging only task-owned files. Provisional work must be identified as provisional in the commit/report.
9. If blocked, isolate or revert only this task's failing edits, preserving prior good work. Record exact failure and next action; continue.

Priority: repair partial coverage first, then evidence-ready IKEA families and their simpler variants, then other evidence-ready families grouped by brand and reusable construction. Respect dependency order. Do not spend the entire night on a difficult mechanism while straightforward jobs remain. Existing declared-built families receive an audit, not automatic exemption or automatic rebuild.

If an item requires changing a shared profile/renderer, run regression checks for the baseline configurations that use it before proceeding. A systemic regression takes priority over new products. If it cannot be repaired within the attempt budget, isolate the shared change and continue only with unaffected jobs.

## 14. Code checks and generated output

Read `package.json` and repository instructions to identify actual required commands. The old request mentions `npm run validate`, `type-check`, `lint` and `test`; do not assume every script exists or run redundant full suites per configuration.

Run focused checks for each change, applicable regressions after shared changes, and required repository-wide gates at batch completion. Record existing baseline failures separately from introduced failures. Do not delete or weaken tests to obtain a pass.

Find the authoritative coverage source. The supplied README names `BUILT_3D` in `tools/cw-catalog/pull-catalog.cjs`; verify how it drives generated files. Do not simply hand-edit a green tick into `CHECKLIST.md` or `index.html`.

Derive coverage from configuration evidence. If the old family status cannot express provisional/partial coverage, add a narrow compatible reporting path rather than lying through the old label. A family is complete only when all its in-scope canonical configurations and geometry variants meet the declared completion criteria. Alias memberships must not inflate totals.

After checking their implementation and side effects, use the existing derive/review-board commands to refresh generated outputs. Do not re-pull the entire live catalogue at the end of the run. Keep the run's input snapshot stable; report external changes separately.

## 15. Final handover

Leave the repository in a coherent state and write a concise `REPORT.md` including:

- Input hashes, starting and ending revisions, elapsed time and actual time spent on preflight, sourcing, building and validation.
- Catalogue reconciliation: source occurrences, canonical products, expanded geometry variants, alias mappings and unresolved identity/scope conflicts.
- Counts for accepted, provisional, implemented-but-unvalidated, blocked and untouched configurations, plus audited existing assets. Reconcile totals without counting aliases as builds.
- Configuration-level table of output identity, status, dimensions/confidence, registry entry, validation evidence and remaining issue.
- Links to review contact sheets, source specifications and failing checks.
- Exact commands actually executed with outcomes, including skipped/unavailable gates and pre-existing failures.
- Newly implemented behaviour, limitations and any shared renderer changes.
- Measured throughput, estimated remaining work and next queue items. State assumptions; do not promise all models will finish in the next run.
- A short exact resume instruction using saved state.

End the run with verified progress, explicit uncertainty and a reproducible continuation point. Do not report “whole library complete” while any in-scope configuration is missing, blocked, provisional or unreviewed.

Begin by inspecting the repository and reconciling the supplied catalogue. Make routine implementation decisions yourself within this contract. Save blockers and continue whenever the next item can be advanced safely.

---

## Resume prompt for later runs

Continue the Sofa3D catalogue build under the same executor contract. Read the actual repository instructions, `data/comfort-works/sofa3d-build/RUNBOOK.md`, `REPORT.md`, `checkpoint.json`, `queue.json`, and the current git state. Reconcile unfinished edits and stale evidence, preserve completed assets, and start a new eight-hour run with a 45-minute finalisation reserve. Do not rebuild the inventory unless its input hashes changed. If they changed, reconcile added/changed/removed identities without losing historical status. Continue with the next eligible configuration and save the same final handover.
