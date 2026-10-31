# Sofa3D build runbook

Contract: `EXECUTOR_PROMPT.md` (+ `ADDENDUM_REPO_FACTS.md`). State lives beside this file.

## State files
- `inventory.json` — canonical products from `sofas.json` (regenerate: `node tools/cw-catalog/reconcile.cjs`)
- `queue.json` — ordered configuration jobs; update `buildStatus`/statuses per job
- `specs/<configurationId>.json` — frozen target spec BEFORE geometry (contract §7)
- `evidence/` — validation logs, render sheets per configuration
- `events.jsonl` — append-only; one event per completed step/job
- `checkpoint.json` — resume pointer; update after every job (atomic write)
- `REPORT.md` — end-of-run handover

## Commands
- Reconcile: `node tools/cw-catalog/reconcile.cjs`
- Focused tests: `npx vitest --config vitest.config.ts run tests/unit/<file>`
- Type-check: `npm run type-check`
- Lint a touched file only (baseline has 180 legacy errors): `npx eslint src/modules/sofa3d/<file> --max-warnings 0`
- Refresh generated checklist/board after BUILT_3D changes: `node tools/cw-catalog/pull-catalog.cjs derive && node tools/cw-catalog/build-view.cjs`

## Conventions
- New families: entry in `src/modules/sofa3d/extended-products.json` + id-block in `extended-models.ts` (see nammaro/friheten patterns). Dedicated module only when the generic model cannot express the verified feature.
- One commit per completed family/subfamily: `feat: sofa3d <family> preset`
- Never hand-edit `CHECKLIST.md`/`index.html` (generated). Coverage truth = `BUILT_3D` in `tools/cw-catalog/pull-catalog.cjs`.
- Gate per change: `npm run type-check && npx vitest run <touched tests> && npx eslint <touched files>`; full `npm run validate` only at batch end (it fails on pre-existing legacy lint — compare against `evidence/baseline-validate.log`).

## Resume procedure
1. Read `checkpoint.json` + tail of `events.jsonl`; verify `inventory.json` source hash still matches `sofas.json` (re-run reconcile if changed).
2. Reconcile unfinished edits (`git status`); rerun stale checks before accepting anything.
3. Continue at `checkpoint.nextItem`.
