# Adaptive HTML-to-PDF Modules Plan

## Scope

- Render intake PDF from HTML components with conditional sections.
- Support repeating piece sections and relationship/formula blocks.
- Keep engine compatible with existing export path.

## Initial Build Steps

1. Define module registry (`MOD_PREP`, `MOD_OVERVIEW`, `MOD_PIECES`, etc.).
2. Build reusable HTML partials for tips, photo slots, piece cards, and formula rows.
3. Add conditional assembly based on metadata (`sofaType`, `pieceCount`, arms).
4. Add page-break and print CSS rules for stable multipage rendering.
5. Render to PDF and attach output to existing export flow.

## Feedback Needed

- Preferred visual style (clinical worksheet vs branded intake doc).
- Mandatory sections for first release.
- Whether formula/check status should be condensed or full-detail by default.
