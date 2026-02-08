# Piece + Connection Editor Plan

## Scope

- Build form-first editor for `pieces`, `cushions`, and `connections`.
- Support piece IDs (`P1..Pn`) and edge-to-edge connection rows.
- Persist all edits into project metadata.

## Initial Build Steps

1. Add project panel section for piece registry and connection table.
2. Implement piece CRUD (type, arms, cushion counts, key dimensions).
3. Implement connection CRUD (`from_piece/from_edge/to_piece/to_edge`).
4. Show lightweight validation badges for missing required fields.
5. Save everything to `metadata.pieces` and `metadata.connections`.

## Feedback Needed

- Preferred location in UI (left panel, right panel, or modal).
- Required piece fields for MVP vs optional fields.
- Whether auto-generated piece IDs can be renamed by users.
