# Operator addendum — repo facts verified 2026-09-18

Read this together with `EXECUTOR_PROMPT.md`. Every factual claim in that document's
inventory table was re-verified against the actual snapshot this run will consume.
Nothing below modifies the contract; it only supplies the repo-specific truths the
prompt tells the executor to discover itself.

## 1. Inventory verification — all confirmed

| Claim in EXECUTOR_PROMPT.md | Verified value |
| --- | --- |
| 371 families / 1,198 occurrences | ✅ 371 / 1,198 |
| 1,125 unique references | ✅ 1,125 (all 1,198 occurrences carry a reference) |
| 1,125 unique handles | ✅ 1,125 |
| 72 references occur more than once / 73 extra occurrences | ✅ 72 / 73 |
| 12 built · 2 partial · 357 not built | ✅ 12 / 2 / 357 |
| 1,074 occurrences in not-built families | ✅ 1,074 |
| Klippan 4 entries · PB York 17 entries | ✅ 4 / 17 |
| 159 occurrences kind `other` | ✅ 159 |
| 6 protectors labelled `chaise` | ✅ 6: backabro, ektorp, fagelbo, friheten, manstad, moheda chaise-armrest-protector covers |
| Every occurrence has reference + image URL | ✅ 0 missing either |
| 17 fabric types / 81 colourways | ✅ |

## 2. Why the six protectors are mislabelled — root cause, already known

`kindOf()` in `tools/cw-catalog/pull-catalog.cjs` (KIND_RULES) tests `chaise`
before `protector`, so "chaise armrest protector" titles match `chaise` first.
The `kind` field is derived metadata, not source data — the prompt's rule
("title, identity and reference evidence override the kind hint") is exactly
right. Reclassify from title/handle/tags during reconciliation; do not trust
`kind` for these 159+6 items.

## 3. File mapping for the prompt's inputs

| Prompt names | Repo reality |
| --- | --- |
| `貼り付けたコード（1）.js` ("previous planning-request generator") | `tools/cw-catalog/build-plan-request.cjs` — generates `data/comfort-works/plan-request.xml`. Correctly characterised: a request generator, not a plan. Superseded by EXECUTOR_PROMPT.md. |
| Coverage source of truth | `BUILT_3D` map in `tools/cw-catalog/pull-catalog.cjs`. `CHECKLIST.md`, `sofas.json` `sofa3d` fields and `index.html` are all GENERATED from it — never hand-edit them. After changing BUILT_3D: `node tools/cw-catalog/pull-catalog.cjs derive && node tools/cw-catalog/build-view.cjs`. |
| Review board | `data/comfort-works/index.html` (generated, self-contained). |

The prompt's critique that the old request allowed hand-editing generated
checklist rows was correct — this addendum supersedes that instruction.

## 4. Commands — verified to exist in package.json

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint src --max-warnings 0   (src/ only — tools/ and data/ are not linted)
npm test             # vitest run
npm run validate     # type-check && lint && test
```

Sofa3d tests live in `tests/unit/` (e.g. `norsborg.test.ts`, `york-slope.test.ts`)
— follow that pattern for new per-family tests. Visual inspection entry point:
Sofa Studio (`src/modules/sofa3d/studio.ts`), reachable from the app; it is the
closest thing to the prompt's "existing automated renderer" — any headless render
harness must be built against it or against `renderer.ts` directly.

## 5. Repository state at plan acceptance

- Branch `main`; dirty (uncommitted) paths in `src/modules/sofa3d/*` and
  `src/modules/ui/cw-import-ui.ts`; untracked: `profile3.cjs`,
  `tests/unit/york-slope.test.ts`, `.zcode/`. These predate this plan — record,
  do not discard or "clean up". The executor's step-1 snapshot requirement is
  already satisfied by listing exactly these.
- The catalog snapshot this plan consumes: `data/comfort-works/` as of
  2026-09-18 (pull via `tools/cw-catalog/pull-catalog.cjs`; manifest totals in
  §1 are from this snapshot — hash `sofas.json` at run start per the contract).

## 6. Sourcing notes for section 6 of the contract

- CW Import refs in the manifest resolve through the in-app CW Import UI
  (`src/modules/ui/cw-import-ui.ts`, server relay `server/vercel-routes/cw/`).
  `fromCw()` (`src/modules/sofa3d/adapters.ts`) maps cover-pattern component
  sizes onto geometry as STARTING estimates — the adapter's own source notes say
  exactly what the prompt warns: pattern sizes may include construction
  allowances. Treat its output as `dimensions: estimated` until overall
  assembled W/D/H are confirmed from qcMeasurements.
- IKEA catalogue dimensions (extended-products.json pattern) are the
  tier-2 source; `extended-models.ts` id-blocks show the established override
  idiom.
