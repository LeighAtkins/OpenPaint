# TypeScript Migration Plan

## Goal
Consolidate application code into TypeScript-first packages and remove legacy JS entrypoints while keeping the build pipeline and runtime behavior stable.

## Target Structure
- `apps/web/` for the Vite frontend (TS-only under `src/`).
- `apps/server/` for Express (TS-only).
- `packages/worker/` for the Cloudflare Worker (TS-only).
- `public/` for static assets only.
- `tests/` for integration/e2e; unit tests live alongside TS source.

## Current Baseline (LoC)
- JS: 118,602 lines
- TS: 12,662 lines
- DTS: 16,568 lines
- TS share (incl DTS): ~19.8%

## Target Outcome (Estimated)
- After converting JS to TS, JS lines should be near zero.
- TS lines (including converted JS): ~131,264 lines
- Expected TS share (TS only): ~88.8%
- Expected TS share (TS + DTS): ~100%

## Staged Checklist
1) **Guardrails**
   - Add lint rules to disallow new `.js` under `apps/` and `src/` (except `legacy/`).
   - Define TS path aliases for `@app`, `@modules`, `@services`.

2) **Frontend consolidation**
   - Move `public/js/` and root `js/` into `apps/web/src/legacy/`.
   - Replace inline script tags with Vite entry imports.
   - Keep `public/` for icons/images only.

3) **Server migration**
   - Move `app.js` to `apps/server/src/index.ts`.
   - Convert middleware/routes to TS and update start/build scripts.

4) **Worker isolation**
   - Move `worker/` to `packages/worker/`.
   - Ensure TS entry and dedicated build config.

5) **Module conversion**
   - Convert leaf utilities and services first, then UI modules and tools.
   - Delete `legacy/` as soon as the last module is converted.

6) **Test alignment**
   - Move TS unit tests next to source (`apps/*/src/__tests__`).
   - Keep `tests/` for integration/e2e until stable.

7) **Cleanup**
   - Remove legacy JS entrypoints and redundant build steps.
   - Ensure `npm run build` is the single pipeline.

## Tracking
Create a short checklist per directory (e.g., `apps/web/src/modules`, `apps/web/src/services`) and mark converted files as they move to `.ts`.
