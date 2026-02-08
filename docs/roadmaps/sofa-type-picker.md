# Sofa Type Picker Plan

## Scope

- Add onboarding step to select sofa type before entering editor.
- Persist selected type to project metadata (`metadata.sofaType`, `metadata.customSofaType`).
- Add save-time prompt when sofa type is missing (`Choose now` / `Save anyway`).

## Initial Build Steps

1. Render modal/step screen with keyboard-accessible tile buttons.
2. Disable `Continue` until selection exists; keep `Skip for now` path.
3. Wire selection to `window.app.projectManager.setSofaType(...)`.
4. Use selected type to prefill project naming pattern on first save.
5. Add save-time guard prompt when type is missing.

## Feedback Needed

- Final icon set for each sofa type tile.
- Whether "Custom" appears as tile or secondary option.
- Preferred wording for save-time prompt.
