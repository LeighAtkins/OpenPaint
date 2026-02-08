# Naming + Relationship PDF Flow Plan

## Goals

- Keep existing measure-first workflow.
- Add structured naming fields (customer, sofa type, date) without forcing them.
- Make image part labels first-class and include them in PDF/export names.
- Add measurement check formulas and cross-image connections in existing stroke flow.
- Render checks/connections in the primary PDF output.

## Filename Rules

- Project/PDF base: `{Customer} - {Sofa Type} - {Date}`
- Image export: `{Customer} - {Sofa Type} - {Date} - {Image Label}`
- If image label missing, fallback to `view-01`, `view-02`, etc.

## UX Constraints

- Remove/de-emphasize beta clutter buttons from the primary panel.
- Keep edits in existing controls rather than modal-heavy alternate paths.
