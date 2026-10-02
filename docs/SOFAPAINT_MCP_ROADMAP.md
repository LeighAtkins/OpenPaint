# SofaPaint: first image, Cloudflare, then MCP

Target: sofa and cushion photographs produce editable, seam-aware measurement drawings guided by existing measurement SVGs across front, back, and side views. ChatGPT selects geometrically meaningful endpoints and line paths; SofaPaint renders and preserves editable annotations. Numerical dimension estimation is outside scope.

## 1. First-image reliability

First-image initialization must distinguish an empty saved workspace from saved artwork. Empty canvas JSON and viewport records alone must not preserve an old pan/zoom. Initialize the frame to the image aspect ratio, reset the empty viewport, and refresh any pending resize anchor after the image and tab metadata agree.

Acceptance: portrait, landscape, square, compact-sidebar upload, and upload after saving an empty shifted/zoomed workspace all align image center and edges within four pixels. Saved drawings, label offsets, and image replacement must retain their geometry.

## 2. Cloudflare API and direct R2 assets

The supplied plan leaves orchestration on Vercel. The intended revised target moves API orchestration to Cloudflare Workers as well. Static frontend hosting can move independently.

Existing starting points:

| Area | Current implementation | Next action |
| --- | --- | --- |
| R2 signing and operations | `server/r2-storage.js`, `server/vercel-routes/r2/shared.js`, `api/storage/r2/[action].js` | Extract TypeScript service and authenticated Worker routes; keep a temporary compatible API adapter during cutover. |
| Cloudflare image/guide API | `sofapaint-api/src/index.ts` | Reuse deployment structure; replace shared-key/default development gate for public user access. |
| AI geometry/SVG | `worker/src/index.js` and sibling modules | Audit and reuse rendering logic; define normalized semantic anchor input. |
| PDF | `api/pdf/render.js`, `server/pdf/service.js` | Separate migration: browser rendering is a distinct workload; SVG/PNG is sufficient for the MCP MVP. |
| CW archive/search | `server/vercel-routes/cw/` | Preserve existing access controls; migrate separately from public measurement projects. |

Upload flow: client requests authorization from Worker → receives short-lived presigned PUT → uploads directly to private R2 → calls completion endpoint → Worker verifies stored size/type and records the asset. Read/export flow returns temporary URLs or streams from Cloudflare, avoiding Vercel binary proxy routes.

Asset record: assetId, owner/sessionId, projectId, storageKey, type, MIME, dimensions, byteSize, sha256, createdAt, status. Generate keys server-side. Reserve upload slots before issuing URLs; enforce 20 MB and ten images per project. Pending assets cannot be used by rendering tools until validated. Quarantine or delete rejected uploads.

Guest Quick Use remains local with no server calls. Remote drafts need an explicit ownership mechanism (authenticated account or scoped expiring guest session); the planned ENABLE_AUTH feature is not an implemented ownership check.

Before public launch: enforce per-user storage and upload quotas, per-tool request limits, expiration/cleanup, rendering concurrency limits, maximum job retries, and a service-side admission stop when the application budget is reached. Provider alerts alone are insufficient to enforce an application spend ceiling. Repeated signed uploads and abandoned objects must count against quotas. Bound paid image processing and AI work independently of API traffic.

Acceptance: a 15 MB photo sends only metadata through API orchestration; rejected/oversized uploads are unusable; another user cannot read/delete an asset; repeated completions are idempotent; abandoned assets expire; overload rejects new work before expensive processing.

## 3. Measurement core

Use the existing vanilla TypeScript/Fabric frontend, not React. Separate semantic measurements and normalized anchors from canvas-specific objects. Keep all five stroke maps and normalized label offsets intact. Produce shared project state and editable SVG from the same measurement model.

Normalize orientation and create preview/vision derivatives without overwriting originals. Record the coordinate transform so vision anchors map consistently into the editable project.

## 3a. SVG-guided seam placement across views

The primary outcome is useful line geometry, not calculated dimension values. Each endpoint must identify a physical feature: seam intersection, piping corner, panel boundary, cushion edge, or a guide-required silhouette boundary. A visually convenient point with no structural meaning is not an acceptable endpoint. Do not substitute an outer edge for an internal seam when the guide calls for that seam.

Use the selected measurement SVG as a reference template. Identify the applicable sofa/cushion shape and front/back/side guide; preserve its measurement roles and printed labels, then map those roles onto actual photo features. Match component structure and seam layout as well as silhouette. Classify the target automatically before choosing a guide: whole furniture versus individual cushion, then sectional structure, then frame seating capacity for sofa versus armchair. The absence of loose cushions never implies a cushion category. Offer correction where evidence is ambiguous, without requiring a category setup screen. Adapt to photo perspective instead of copying or uniformly scaling SVG coordinates. Distinguish a straight seam-to-seam span from a path following a curved seam; the guide determines which is intended.

Starting points in the repository: `src/modules/ui/svg-measurement-parser.js` parses guide geometry; `src/modules/measurement-mos/svg-role-instances.ts` keeps repeated printed labels independently attached; `src/modules/measurement-mos/cw-pattern-binding.ts` already defines semantic cushion guide slots. Audit and reuse these pieces; they do not establish general unmarked-photo seam recognition.

Create a template manifest per guide with guideId/version, component type, view, measurement role/label, start/end feature descriptions, permitted boundary types, line/path type, and required visibility. SVG path IDs and coordinates help extract the diagram, but may need reviewed semantic descriptions to explain what each endpoint means.

For each placed measurement record guide role, component instance, photo/view ID, normalized endpoints, optional curve control points, feature identities, visibility/confidence, and supporting image crop. Keep component and measurement identities consistent across views even though image coordinates differ. Repeated cushions must have distinct instances. Hidden seams remain unresolved rather than receiving invented endpoints; request a more revealing view or user correction.

Workflow: read guide and photos → match structure → find physical endpoints and paths → create editable drawing → return rendered preview and close-up endpoint crops → inspect against the guide and photo → correct placements. The MCP tool output must make previews available for assistant inspection. Allow conversational corrections such as “A should stop at the piping seam” and manual endpoint dragging.

Acceptance uses reviewed sofa/cushion fixtures paired with front/back/side guides: correct guide roles and component instances, endpoints on the intended visible seam/boundary, appropriate line or curve paths, and consistent labels across views. Measure endpoint distance to reviewed feature regions in normalized image coordinates, not dimension-value accuracy. Include shadows, low-contrast seams, occlusion, repeated cushions, and perspective changes. Confidence alone is not proof of precision; retain unresolved cases and review failures.

## 4. MCP workflow

Required tool capabilities: start_measurement_project, get_measurement_guide, add_project_image, generate_measurement_drawing, update_measurement, and export_measurement_drawing. Drawing inputs include guide-linked feature identities, explicit normalized endpoints, optional curve points, and label/annotation offsets. Drawing and update results return inspectable previews and unresolved guide roles.

Do not assume an MCP server can automatically access every chat attachment or invoke ChatGPT's own vision. Validate the supported file handoff in the chosen ChatGPT integration. Have the assistant supply the normalized anchor/measurement schema, or explicitly implement and budget a separate vision API operation. Add analyze_sofa_image only if that server-side operation is intentional.

Return project and asset identifiers, editable project URL, preview, confidence, and requests for missing views. Keep uncertain anchors editable. Do not infer centimeters from uncalibrated photo pixels.

## Implemented foundation

`src/modules/measurement-assistant/decision-policy.ts` supplies the category decision tree, view/category-filtered guide ranking, and assistant placement instructions. It consumes vision observations; it does not recognize objects from pixels by itself.

`placement-model.ts` defines validated physical features shared across photos, components, surface coverage, guide/freestyle paths, and explicit evidence for endpoints. `overlay-elements.ts` converts those placements into the existing editable MOS element format. Numerical dimension values are intentionally absent.

These modules now run through a deployed MCP endpoint, the real guide catalogue, original-photo inspection, editable placements, and revision-gated preview/export. ChatGPT supplies the visual observations and geometry; structural validation alone does not prove a seam is aligned.

## Delivery order

1. Fix and regression-test first-image geometry.
2. Implement owned, quota-controlled Worker upload authorization and completion.
3. Cut browser asset traffic to direct R2 and verify binary traffic bypasses Vercel.
4. Extract shared semantic measurement/SVG renderer and normalize image coordinates.
5. Prove SVG guide → seam-aware editable drawing, then front/back/side consistency inside SofaPaint.
6. Add MCP transport and validate ChatGPT file handoff and correction flow.
7. Migrate remaining API families individually with rollback and route-parity checks.

Reference: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) support direct browser access; signing Content-Type and bucket CORS are part of that setup. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) must be checked for each migrated workload. Cloudflare migration by itself does not establish a cost ceiling.

## Deployed delivery status — 1 October 2026

- Hosted editor: https://sofapaint.vercel.app/ (Vercel; no localhost requirement).
- Public connection and support: https://sofapaint.vercel.app/plugin/.
- Public MCP: https://sofapaint-mcp.sofapaint-api.workers.dev/public/mcp, with ten independently exposed tools. No shared private MCP token is distributed. Each temporary draft and PDF requires its own project capability.
- Cloudflare handles photo input, R2 draft storage, guide retrieval, native PNG inspection, editable placements, and PDF rendering. The MCP does not call a paid OpenAI model or use publisher API credits.
- The Classic palette maps width to blue, depth to green, height to red, and surface contours to purple. Style overrides are validated; both native previews and editable overlays retain the styles.
- PDFs contain the original annotated photos and matching blank fields. Fillable AcroForms and printable boxes are available in cm/in. All full photos must be reviewed at the current revision. Export reuses those PNGs to avoid combining repeated rasterization with PDF generation in one memory-limited request.
- Initial global daily capacity: 500 projects, 1 GiB uploaded image bytes, 3,000 preview renders, 500 new PDF artifacts, and 20,000 service requests. Separate daily SQLite Durable Object counters enforce admission atomically. Per-IP requests remain limited to 60/minute. These are capacity controls, not a guarantee against every infrastructure charge.
- Draft access expires after 24 hours, with hourly physical cleanup. Request invocation logging is disabled to avoid recording capability URLs.
- Public ZIP source: `plugin/sofapaint/`; includes public metadata, public MCP endpoint, icon, an illustrated editor screenshot, five positive and three negative cases, and a hosted illustrated video walkthrough. No customer photos, credentials, or private draft URLs are in the public package.
- The personal publisher identity is verified as LEIGH GEORGE ATKINS. SofaPaint 1.0.0 was uploaded with self-contained reviewer image examples; its metadata checks passed and review information was saved for all supported countries. The public Worker domain challenge passed and all 10 tools were discovered. The initial update_measurement destructive-hint finding was corrected and the latest MCP scan has no issues. The user confirmed the binding terms and all submission attestations. The publisher portal now shows version 1.0.0 **In review**, MCP **Configured**, and **Not published**. Submission is complete; approval and public directory publication remain pending.

### Personal ChatGPT account test (2026-10-01)

- Refreshed the existing development connection's tools, with 6 write and 4 read tools shown in ChatGPT.
- Three user-uploaded sofa photos were tested in the personal account. The regional attachment host `oaisdmntprindiasocentral.blob.core.windows.net` initially failed the image allowlist; this exact host was added and deployed, with deceptive-host regression coverage. All 24 focused tests passed.
- ChatGPT's model-facing file input is a reference string; the host resolves valid uploaded-file references into the MCP file object. Manually supplying an object to the model-facing interface fails its string validation. After the host fix and native-reference retry, front, side and back imports all succeeded in the same project.
- Sequential native front-original preview succeeded. The side-original preview was blocked by OpenAI safety checks with “Please double check what you are sending.” No more specific reason was supplied. Do not bypass that block through another client or modified payload.
- End-to-end drawing and PDF delivery in this ChatGPT conversation remain **unverified**. Prior direct MCP rendering/PDF checks passed, but do not count them as a successful ChatGPT workflow.

Focused checks: project access, revision conflicts, guide roles, full-photo review gates, original-photo overlays, blank/fillable PDF fields and persistence, printable pagination, style validation, and atomic shared quota admission. The real three-view sofa exported as three PDF pages with 21 blank form fields. Public synthetic example upload → placement → review → PDF succeeded without account authentication.

### Personal ChatGPT retry succeeded — 2026-10-01
The same three-photo personal-account draft now saves revision 4 with 14 lines (front 4, side 7, back 3). ChatGPT completed sequential original and overlay reviews and returned a working fillable PDF. The hosted editor visibly shows the front A1/A2/A3/D lines. This verifies drawing and PDF delivery through ChatGPT; broader guide coverage and placement quality still need assessment.

### Square-arm guide fidelity — 2026-10-01
Production CS3B-SA-HB SVGs already contain front A1/A2/A3/A4/B1/B2/C1/C2/C3/D, side F1/F2/F3/F4/G1/G2/H1/H2/H3, and back L1/L2/L5/J1/J2. Earlier personal-account output incorrectly selected SLA-HB2 and silently dropped guide roles. Added reviewed SA-HB semantic roles, per-image guideCoverage, explicit omittedGuideRoles, and a PDF gate for unaccounted known-guide roles. Perspective and original seam evidence remain visual-review requirements, not automatic pixel detection. Worker version 7e65c1f8-8bad-4624-80a2-cc741cc3d200 deployed; 26 focused tests, both type checks and scoped lint pass. Same-project ChatGPT correction test in progress; do not claim placement quality from these checks alone.

Same-project personal ChatGPT correction completed at revision 6: 20 SA-HB lines (front 10, side 8, back 2), 4 explicitly explained omissions. Connection tool refresh resolved cached omission schema. Native reviews completed and ChatGPT delivered the new PDF; verified 3 pages, 20 blank fields. Independent rendered-photo review confirms sloping A1, front arm spans, and distinct side F1-F4. Rear arm-level joins remain hidden; no endpoints invented.

### Editor persistence and native PDF renderer — 2026-10-02
Fixed MOS edit persistence: grouped arrows now save transformed child-line endpoints rather than saving the group centre twice; curves retain their edited point arrays. Two regression tests pass, and live production UI verified whole-line dragging and endpoint dragging survive switching photos away and back. Editor deployment dpl_FuRU2b5sVNQeWfmttNVQ8VQY2NCe is READY on sofapaint.vercel.app. MCP PDF export now calls the same /api/pdf/render report contract and hybrid renderer used by Save as PDF; the separate assistant PDF layout is no longer in the Worker export path. Native endpoint and MCP-to-native integration verified three-page fillable output with blank fields. Native export body capped at 4 MB; larger exports fail explicitly instead of generating a substitute layout. Worker version 6c8dc55b-7673-4975-8c16-6db832918692 deployed. User-directed L1 upper rear width restored as an explicitly adapted freestyle role, leaving the stored guide arm-level omission honest. Tightened B1/B2 inner-arm and F4 inner-back-slope instructions. 27 focused assistant tests plus two MOS persistence regressions pass; type checks and scoped lint pass. Existing customer editor tabs were not reloaded or overwritten during isolated UI testing.

### Tag appearance parity — 2026-10-02
The editor and MCP photo renderer share the automatic tag-shape policy: missing/blank values use circular white tags; supplied values use rounded square tags. MCP previews now include black text, colored tag borders, and connectors to the measurement geometry instead of bare colored text. Default label anchors are offset above the line without changing endpoints. Native PDF rows retain supplied values; PDF and preview cache versions invalidate earlier plain-label output. Visual review now stores raw PNG bytes before encoding the MCP image response, avoiding the large base64 decode allocation that exhausted a Worker on the third photo. Production MCP verification produced three pages, 21 measurement fields and three unit fields, all blank for the customer test. Live isolated editor verification confirmed circle → square → circle on input and clearing. Both type checks and 29 focused assistant tests pass. Portrait report layout uses explicit image/table columns to prevent table overflow. Line selection and geometry compatibility are outside this appearance pass.
Repeated full-photo review now reuses its revision-scoped PNG, and newly rendered review rasters are capped at 800 px width to reduce warm-Worker allocations. Final hosted editor deployment dpl_4F8Ac2Zk1oGRj7daUZXxFk134XPb is READY; Worker 9a6f6a23-829f-4323-8724-d25448ce9650. Repeated full-project MCP review and native PDF export passed after these changes.

### Drawing review gate — 2026-10-02

Added `check_measurement_drawing` diagnostics and `confirm_measurement_review` per-line visual review. PDF and single-image exports require a revision-matched confirmation; confirmation requires full annotated previews and annotated close-ups (crop area <= 0.5) for every photo. Corrections invalidate prior confirmation by revision. This records model review, never customer approval or automatic seam detection.

SVG coverage now reads measurement IDs from every selected guide, including sectional guides outside the named family tables. Unreadable guides fail explicitly. Missing roles must be drawn or explicitly omitted. Diagnostics flag weak endpoint evidence and enforce the four reviewed square-arm side panel corner connections without forcing independent front measurements into that network.

Corrected S0673/S2427/S2325 geometry fixtures are preserved under `tests/fixtures/measurement-corrections/`, without photos/contact details. Placement instructions incorporate the corrected thickness/profile, inner-arm and selective-junction rules. Unseen-sofa quality has not yet been evaluated after this release.

Validation: 12 focused tests passed; MCP type checking and scoped lint passed. Worker deployed as c17c5cf3-4f07-4fad-924c-7aeeca8cb8c3.
