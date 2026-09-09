# Sectional Builder 45-Degree Review

The Sectional Builder has a paired visual contract for every preset:

- 3-seat
- 2-seat
- Chaise
- L-shape
- L+Chaise
- +Ottoman

Each run renders Left 45° and Right 45° side by side on one review sheet. The
test compares that sheet pixel-for-pixel with the approved rendering and also
checks the furniture structure.

## Run The Check

```bash
npm run test:sectional:visual
```

The check fails when pixels move or when a known physical rule is broken. Its
error names the preset, angle, piece kind, and failed rule where possible.

Rules include:

- every module has one body and one seat cushion;
- ottomans have no structural back or back cushion;
- perpendicular returns show their loose back cushions when their upholstered
  back faces the camera, and never through a rear-facing shell;
- arm modules have a face, front, and top;
- paired Left 45° and Right 45° views have comparable bounds.

On a pixel failure, open the generated `actual`, `expected`, and `diff` images
inside `test-results`. Review both columns, even if only one angle was edited.

## Approve An Intentional Change

Only after visually checking all twelve cells:

```bash
npm run test:sectional:visual:update
npm run test:sectional:visual
```

The second command proves the new approved image is stable. Never update the
snapshot merely to make a failure disappear.
