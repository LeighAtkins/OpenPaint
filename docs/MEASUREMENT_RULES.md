# Sectional Builder — Measurement Rules Proposal

Derived from the Comfort Works measuring-diagram PDFs (sofa/sectional frame
forms, universal arm/side views, cushion forms) and the code layout extracted
from their form fields.

## Code inventory (what each family covers)

| Family | Codes | Meaning (per CW diagrams) |
| --- | --- | --- |
| A — widths | A1, A2, A3… | A1 = overall arm-to-arm width; A2 = overall depth (side view); A3+ = per-module widths |
| B — inner spans | B1, B2 | Seat area between arms; second row / return span |
| C — cushions | C1…C4 | Seat cushion widths, left to right |
| D — depth | D, D1, D2 | Frame depth per row (chaise/return rows add D1, D2…) |
| E — corner/return | E1…E7 | Corner & return-leg dims on sectional forms |
| F — arms | F1…F4 | Arm width/height/slope (F2 = arm width in front view) |
| G — back | G1…G3 | Back heights (frame, cushion, mid) |
| H — seat | H1…H3 | Seat heights (deck, cushion top, front edge) |
| J — arms side | J1, J2 | Arm inner/outer heights on the side view |
| L — rear/legs | L1…L4 | Rear view widths, leg heights, skirt |

## Rule families proposed

### 1. Partition (sum) rules — severity: error
A whole must equal the sum of its parts (within 2 cm).

- `A1 = Σ module widths` — arm-to-arm width equals the sum of the side-by-side modules (A3 + A4 + …)
- `A1 = B1 + F2(left) + F2(right)` — inner span plus both arms (the user's "B1 + F2 = G1" family; exact F/G code varies by arm style, so we check every filled combination)
- `B1 = Σ Cn` — inner seat span equals the seat-cushion widths (the "A2 + A4 = total cushion width" family: cushions must fill the seat)
- `D_total = D + D1 + D2…` — overall depth equals the per-row depths on multi-row plans

### 2. Equality (consistency) rules — severity: warn
Codes describing the same physical dimension must agree (within 1–3 cm).

- Left/right arm symmetry — `F2(left) = F2(right)`, `SLA-L = SLA-R`
- Front vs rear total width — `A1 = L1`
- Overall depth vs frame depth — `A2 ≈ D + back allowance`
- Back height consistency — `G1/G2/G3` across modules of the same back style
- Seat height consistency — `H1` equal across seat modules

### 3. Range (plausibility) rules — severity: warn
Every filled code must sit in a physically plausible window:

- A1: 60–500 cm · A2: 50–200 · D: 50–130 · B1: 40–300
- Cushion Cn: 30–160 · F2 arm width: 8–45 · G1 back height: 50–130 · H1 seat height: 25–60

### 4. Derived (auto-compute) rules — severity: info
The builder can fill values the user doesn't have to:

- Overall width/depth are computed from the plan geometry (already seeded as A1/A2)
- Module widths seed A3+ automatically from piece dimensions
- Row depths seed D1/D2 automatically on multi-row plans
- Suggested cushion widths: `Cn = module inner width` so users only adjust

### 5. Completeness — submission gate
A submission is ready when every code in the assembly's expected set is filled
and no error-severity issues remain. The inspector shows `N of M codes filled ·
E error(s), W warning(s)`.

## Builder integration (implemented)

- `sectional-measurement-rules.ts` — catalog builder + evaluator (sum, equality, range)
- Seeds now draw, by default: overall width (A1), overall depth (A2), one width
  per module (A3+), and one depth per extra row (D1, D2…) — matching the front +
  side views of the PDFs
- Inspector shows a live **Measurement checks** panel fed by the stroke
  measurement values of the seeded codes

## Follow-ups (not yet implemented)

- Cushion-form parity: per-cushion type entries (box/T/L) as a second tab in the
  builder, feeding Type 1 / Type 2 quantity tables like PDF page 2
- Arm-style-specific compose rules (WA/SLA use different F codes)
- Auto-derived values shown greyed-out but editable (override = info issue)
- Replace the PDF: render our own measuring diagram from the plan SVG with the
  same code annotations, exported as page 1 of the PDF
