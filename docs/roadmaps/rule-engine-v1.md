# Rule Engine v1 Plan

## Scope

- Implement configurable relationship checks and follow-up action generation.
- Start with checks: `E2`, `E3`, `E5`, `R_ARM_TAPER`, `R_WIDTH_RECON`.
- Output pass/fail statuses and generated requests for PDF + UI review.

## Initial Build Steps

1. Define rule parameter store (tolerances and severities).
2. Implement computation helpers for cushion sums and connection comparisons.
3. Add evaluator that returns structured check results.
4. Add follow-up generator mapping failed checks to actions (ask/request_photo/tape_proof).
5. Expose rule results for PDF rendering and intake UI badges.

## Feedback Needed

- Default tolerance values for launch.
- Severity mapping (`warn` vs `fail`) for each rule.
- Preferred wording style for generated customer questions.
