# Sofa3D build — run 1 report

Date: 2026-09-18 · Branch: `sofa3d/overnight-1` (from `main` @ `4315f1a`) · Contract: `EXECUTOR_PROMPT.md` + `ADDENDUM_REPO_FACTS.md`

## Reconciliation

| Measure | Value |
| --- | --- |
| Source snapshot | `data/comfort-works/sofas.json` sha256-16 `ed40fd279421ce80` (unchanged through run) |
| Family entries / occurrences | 371 / 1,198 (matches plan expectations) |
| Canonical identities | **1,125** (all carry reference + image) |
| Identity conflicts | **0** — all 72 repeated refs resolve to same handle; 73 alias memberships preserved |
| Category-only extras | 32 recorded in `inventory.json` (not added to build denominator) |
| Object types | sofa 413 · sofa-bed 101 · chair 92 · sectional 67 · chaise 67 · ottoman 62 · corner 53 · armchair 59 · footstool 30 · cushion 47 · protector 41 · armrest 16 · headrest 7 · bench 7 · daybed 6 · recliner 1 · unresolved 56 |
| Queue | 1,125 jobs: 20 partial-repair · 103 audit · 851 build · 100 accessory · 51 identity-review |

The 6 "protector labelled chaise" mislabels and the 159 `other` kinds from the old
heuristic are replaced by the evidence-ordered classifier in `tools/cw-catalog/reconcile.cjs`
(accessories before furniture kinds; `kind` treated as hint only).

## Infrastructure built (reusable by every later run)

- `tools/cw-catalog/reconcile.cjs` — inventory + prioritised queue generator.
- `src/modules/sofa3d/geometry.ts` — part-geometry dispatch extracted verbatim from
  `SofaRenderer` so validation measures exactly what renders.
- `tests/helpers/sofa3d-harness.ts` — headless world-space assembly (same layout +
  `fitCushionToSeats` deformation as the renderer) + §10 structural checks
  (finite/positive/unique, non-empty, overall W/D/H vs independent spec,
  floor contact, seat/back/arm counts, chaise handedness landmark, module overlap).
- `tests/unit/sofa3d-structural.test.ts` — all **17 registry presets** pass universal
  invariants; calibration fixtures prove the harness DETECTS wrong scale, missing
  backs, a chaise misplaced onto the base (overlap + width collapse) and empty models.
- `tools/cw-catalog/render-models.cjs` (+ `render-page.html`) — renders any model
  through the real `SofaRenderer` in headless Chrome: 5 views, pixel occupancy
  checks, and a contact sheet with the CW product photo for likeness review.

## Coverage outcome

| Disposition | Count |
| --- | --- |
| Accepted this run (implemented + structure pass + render pass) | **3** — Klippan 2-seat (verified dims), Klippan footstool (tier-3 dims), Klippan 4-seat (provisional, estimated width) |
| Declared-built families audited | 14 audited at family level; every preset exercised by the harness |
| Audit findings (recorded, unfixed) | PB Charleston rendered depth +8.3 cm vs declared; PB York W +2.6 / H +7.7; Cloud corner-chair renders 122.7 cm tall vs 46.99 benchmark declaration (likely full-height back defect); PB English sleeve depth +1.2 (skirt drape — tolerance exception); NÄMMARÖ height +7.7 (slatted-back cushions) |
| Fixed audit defects | Norsborg armrest sections no longer counted in declared seatCount (8 → 7, matches rendered) |
| Blocked | 0 |

Visual status for all three Klippan models is **needs_review** (§12: no independent
reviewer configured; executor self-review recorded with sheets in
`evidence/renders/<id>/sheet.png` — arms, cushion layout, proportions and legs match
the CW photos on inspection).

## Validation

- `npm run type-check` — pass.
- `vitest`: 46/46 pass across structural, klippan, norsborg, york-slope suites.
- `eslint` on every touched src file — clean. Full `npm run validate` remains red on
  **180 pre-existing legacy lint errors** unrelated to sofa3d (see
  `evidence/baseline-validate.log`, recorded before any change).
- Catalogue source files untouched; only derived outputs regenerated
  (`pull-catalog.cjs derive` + `build-view.cjs`).

## Commits

- `f72a8fe` baseline: pre-existing WIP + catalog database (verbatim snapshot).
- `62f926f` harness + reconciliation + norsborg fix.
- (this commit) Klippan family implementation + evidence + regenerated outputs.

## Measured throughput & next queue

Sourcing ≈ 6 min/config (IKEA PDP route), implementation+validation ≈ 15 min/config
once specs are frozen. Remaining: 1,122 jobs (1,019 furniture builds incl. 17 PB York
repair configs, 100 accessories, 51 identity reviews, 103 audits to complete at
configuration level).

**Next run (exact):** 1. read `checkpoint.json`; 2. PB York batch — source the 16
missing width/config variants (CW40 dashboard per PID `PB-YRA-62…PB-YSLA-60`,
needs OMS session via CW Import; fallback tier-3 Pottery Barn factory pages), extend
`YORK_CONFIGS`-style width map in `extended-models.ts`; 3. IKEA backlog by config
count (Kivik 12, Söderhamn already built-audit, Landskrona, Ektorp subsets…).
Do not re-run reconciliation unless `sofas.json` hash changed.
