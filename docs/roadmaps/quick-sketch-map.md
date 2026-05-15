# Quick Sketch Map Plan

## Scope

- Add optional top-down sketch canvas for piece layout (`P1..Pn`).
- Support rectangular region creation, select/move/resize/delete, and undo/redo.
- Persist map in project metadata and keep save non-blocking.

## Initial Build Steps

1. Add onboarding/project-info entry point for sketch map.
2. Build grid canvas with snap-to-grid default enabled.
3. Implement piece creation (rect tool) with incremental IDs.
4. Implement editing actions and piece list sidebar.
5. Persist to `metadata.quickSketchMap` with optional preview image.

## Feedback Needed

- Whether sketch appears before editor, inside editor, or both.
- Required toolset for MVP (rect only vs polygon).
- Naming rules for piece labels beyond default `P{n}`.
