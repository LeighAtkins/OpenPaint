# Comfort Works Catalog Database

A local, complete mirror of the comfort-works.com public catalog, structured so an
agent can autonomously build every sofa model in 3D (see `src/modules/sofa3d/`).

Regenerate everything with:

```bash
node tools/cw-catalog/pull-catalog.cjs all   # sitemaps → collections → fabrics → derive
# or phase by phase (each resumable; raw cache is skipped when present)
```

## Contents

| Path | What it is |
| --- | --- |
| `index.html` | **Self-contained review board** — the whole database bundled visually: shelf of built models, work packages, filterable ledger of every family (configurations, reference codes, colourways), fabric swatch book, CW Import grounding. Rebuild with `node tools/cw-catalog/build-view.cjs`. |
| `sofas.json` | **Every model family** (one entry per Comfort Works collection): brands, series, and every configuration as a base product (2-seater, 3-seater, corner 2+2, chaise, sofa-bed, armchair, footstool, protectors…) with reference codes (`IK-EP-3`), style codes, images, URLs. Cross-model category collections (`chair-covers`, `sofa-covers-ikea`…) live under the top-level `categories` key. |
| `fabrics.json` | **Every fabric option** — fabric types → colourways (`Everyday Velvet Cacao`), with sample URLs, SKUs (`MODEL__STYLE__FABRIC`), and which families offer each fabric. Fabrics are a separate dimension from models: any model renders in any colourway. |
| `CHECKLIST.md` | The go-through checklist: family → configuration count → sofa3d coverage status (✅ built / 🟨 partial / ⬜ not built). |
| `raw/collection-handles.json` | All 421 collection handles from the sitemap. |
| `raw/collections/<family>.json` | Full compacted `products.json` per collection (tags included — arm/back types, size, style codes, product refs). |
| `raw/fabrics/<family>.json` | Per-family fabric colourway scan from the product pages (sibling list: title, URL, SKU, price, image) + fabric hub links (`/pages/fabrics-…`). |

## How the catalog is organised (as discovered from the site)

- One **collection per model family** (`/collections/ikea-ektorp-slipcovers`).
- Collections list **base products only — one per configuration** (Ektorp → 14).
- Every **fabric/colourway of a base product is its own product**
  (`ektorp-3-seater-sofa-cover-everyday-velvet-cacao`); the product page embeds the
  full sibling list with structured SKUs: `IK-EP-3__LSKT_SP__CVC-01` =
  `MODEL__STYLE__FABRIC`. Total store ≈ 65k products across all sitemap chunks —
  almost all of them are these fabric variants, which is why this DB stores base
  products + a fabric dimension instead of 65k entries.
- **Coverage check** (against live sitemap samples): every product belongs to a
  collection except one known orphan — the West Elm Monroe 80" sofa
  (`monroe-mid-century-80-sofa-slipcover`), whose family collection was emptied.

## Grounding: CW Import / OMS-PID (already built into Sofapaint)

Confirmed — the "CW Import" feature exists and has deep per-product access:

- **UI**: `src/modules/ui/cw-import-ui.ts` — "Find a sofa — Name, product code, or
  PID" search; version options (scoped references like `IK-KL-3`); style options
  (style codes like `CNRP_PM`, `LSKT_SP`); imports measurement rows
  (label/value/section/pieces/skirt length), image URL groups
  (`imageUrls`, `imageCandidateGroups`, `sectionImageGroups`), and raw OMS payloads.
- **Server relay**: `server/vercel-routes/cw/measurements.js` (+ `shared.js`,
  `guide-models.js`) behind `/api/integrations/cw/measurements/*` — proxies the CW
  OMS at `https://cw40.comfort-works.com` (session-gated dashboard; product edit at
  `/dashboard/#/products/edit/<id>`), including `qcMeasurements` and
  `product_components` (per-part pattern sizes and quantities).
- **Images**: PID image service `https://cw-pid-qylyewlgca-uc.a.run.app` and the
  `pid-storage` GCS bucket, proxied through
  `/api/integrations/cw/measurements/image-proxy`.
- **3D bridge**: `src/modules/sofa3d/adapters.ts` `fromCw()` converts an imported CW
  payload into a `SofaDocument` (overall W/D/H, seat count from Seat Cushion Cover
  quantity, back cushion count, per-cushion pattern sizes, accent pillows,
  single-arm modules via `__L`/`__R` references).

So: **CW Import = per-order depth** (exact QC measurements + production images, needs
OMS auth). **This database = whole-catalog breadth** (every family, configuration and
fabric, no auth). Together they cover everything.

## Pipeline: building the remaining 3D models autonomously

1. Open `CHECKLIST.md`, pick the next ⬜ family (work brand by brand; IKEA first).
2. Read the family in `sofas.json`: each product = one configuration to model.
   Use `reference` codes as stable IDs.
3. Dimensions, in order of quality:
   a. **CW Import** the base product (or its PID) → exact QC measurements and
      component pattern sizes → `fromCw()` gives a working `SofaDocument` to refine.
   b. IKEA/manufacturer product-page overall W×D×H (pattern used by
      `extended-products.json` entries).
   c. Estimate from product photos + tag data (`back_type`, `arm_shape_categories`).
4. Implement as a preset following the existing registries
   (`extended-models.ts` + `extended-products.json` for manufacturer-dimension
   entries; dedicated modules like `norsborg.ts` only when construction is special —
   modular sections, sleeper mechanisms, scanned frames).
5. Set upholstery defaults from `raw/fabrics/<family>.json` sample images (pick a
   representative colourway; matching hex via the product image).
6. `npm run validate`, check the model in the sofa3d studio, then flip the
   checklist row to ✅ in `BUILT_3D` (`tools/cw-catalog/pull-catalog.cjs`) and
   regenerate.
