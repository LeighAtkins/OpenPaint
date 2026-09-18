#!/usr/bin/env node
/**
 * Builds data/comfort-works/plan-request.xml — a self-contained request handed to
 * an external planner (GPT Astra running GLM Flash) to produce the complete
 * Sofa3D modeling plan for the whole Comfort Works catalog. The returned plan is
 * executed later by autonomous z-ai overnight runs.
 *
 *   node tools/cw-catalog/build-plan-request.cjs
 *
 * Embeds: database summary, CW Import grounding, built-model registry, the
 * SofaDocument API surface, planning rules, output schema, and the full 371-family
 * manifest — so the planner needs no access to this repo.
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '../../data/comfort-works');
const sofas = JSON.parse(fs.readFileSync(path.join(DATA, 'sofas.json'), 'utf8'));
const fabricsJson = JSON.parse(fs.readFileSync(path.join(DATA, 'fabrics.json'), 'utf8'));

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const statusOf = (v) => (v.startsWith('built') ? 'built' : v.startsWith('partial') ? 'partial' : 'todo');

const display = (f) =>
  f.series[0] ||
  f.id
    .replace(/^(ikea|slipcovers-for-[a-z-]*)/, '')
    .replace(/-(sofa-?covers?|slipcovers?|sofas?|covers?)$/, '') ||
  f.id;

/* ---------- manifest ---------- */
const famLine = (f) => {
  const kinds = [...new Set(f.products.map((p) => p.kind))].join(',');
  const refs = [...new Set(f.products.map((p) => p.reference).filter(Boolean))].join(',');
  const attrs = [
    `id="${esc(f.id)}"`,
    `name="${esc(display(f))}"`,
    `brand="${esc(f.brands.join(', '))}"`,
    `cfg="${f.productCount}"`,
    `st="${statusOf(f.sofa3d)}"`,
    `kinds="${esc(kinds)}"`,
    refs ? `refs="${esc(refs)}"` : null,
    f.cover ? `cover="${esc(f.cover)}"` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `    <fam ${attrs}/>`;
};

const families = sofas.families;
const built = families.filter((f) => statusOf(f.sofa3d) !== 'todo');
const todo = families.filter((f) => statusOf(f.sofa3d) === 'todo');
const totalConfigs = families.reduce((s, f) => s + f.productCount, 0);
const todoConfigs = todo.reduce((s, f) => s + f.productCount, 0);

/* ---------- static XML sections ---------- */
const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<planRequest id="cw-sofa3d-complete" version="1.0" generated="${new Date().toISOString().slice(0, 10)}">

  <meta>
    <title>Complete 3D Sofa Modeling Plan — Comfort Works catalog → Sofa3D</title>
    <requester>OpenPaint / Sofapaint — sofa3d pipeline (repo "OpenPaint")</requester>
    <planner engine="GPT Astra" model="GLM Flash" role="Produces the plan document only. Does not execute, does not have repo access — everything you need is embedded in this request."/>
    <executor engine="z-ai" model="GLM Flash" role="Autonomous overnight coding runs in the OpenPaint repo. Will receive YOUR plan document as its work order."/>
    <objective>
      Produce the complete, ordered, batched execution plan for modeling every sofa family in the
      embedded manifest as a real-time 3D preset in Sofa3D's sofa3d module. The catalog is
      ${families.length} model families / ${totalConfigs} configurations; ${built.length} families are already built
      (${todo.length} remain, covering ${todoConfigs} configurations). The executor works overnight in
      unattended runs, so the plan must be fully deterministic: every family gets a work order with
      approach, dimension source, construction parameters, colourway, validation steps, and effort
      class — no decisions left to improvisation at 3am.
    </objective>
    <nonGoals>
      Building the models yourself; modifying the catalog database; fabric texture authoring
      (colourways are flat hex values); ordering or touching anything outside src/modules/sofa3d
      plus the checklist/registry files named below.
    </nonGoals>
  </meta>

  <grounding>
    <database location="data/comfort-works/">
      <file name="sofas.json">All ${families.length} model families; each family lists every configuration as a base product with reference code (e.g. IK-EP-3), kind (sofa/corner/sofa-bed/chaise/armchair/sectional/ottoman/protector/other), style names, cover image, availability.</file>
      <file name="fabrics.json">17 fabric types / 81 colourways (e.g. "Everyday Velvet Cacao") with sample product URLs and images. Fabrics are a separate dimension: any model renders in any colourway.</file>
      <file name="raw/collections/&lt;family-id&gt;.json">Full per-family product records incl. tags: arm_shape_categories, back_type, size, style codes — use these to pick construction parameters.</file>
      <file name="raw/fabrics/&lt;family-id&gt;.json">Per-family colourway lists with sample images — the source for default fabric colours.</file>
      <file name="CHECKLIST.md">Markdown coverage checklist; executor flips rows here as families complete.</file>
    </database>
    <cwImport>
      Sofapaint already contains "CW Import": search the Comfort Works OMS by product reference
      (the refs attribute in the manifest) to pull exact QC measurements (overall W/D/H) and
      product_components pattern sizes (seat/back/accent cushion W×H×D + quantities). Production
      images come from the PID image service. The adapter src/modules/sofa3d/adapters.ts
      fromCw() converts a CW payload into a starting SofaDocument. Where a work order uses
      CW Import, the executor runs the import inside Sofapaint first and refines from there.
    </cwImport>
    <builtRegistry note="Do NOT re-plan these from scratch; partial entries list exactly what is missing.">
${built
  .map(
    (f) => `      <built fam="${esc(f.id)}" st="${statusOf(f.sofa3d)}">${esc(f.sofa3d)}</built>`
  )
  .join('\n')}
    </builtRegistry>
  </grounding>

  <technicalConstraints>
    <architecture>
      Vanilla TypeScript + THREE.js, no frameworks. Entry: src/modules/sofa3d/. A sofa is a
      SofaDocument (src/modules/sofa3d/model.ts): dimensions (width, depth, height, armWidth,
      armHeight, seatHeight, seatThickness, backThickness, legHeight, seatCount), construction
      knobs (see apiReference), modules[] (each: id, width, depth, x, z, rotation, leftArm,
      rightArm, back, seats, backs, corner, armOnly), per-part overrides, pillows count, sleeper
      {open, moduleId, extension}, fabric.colour. Renderer: renderer.ts; arm/skirt profiles:
      profiles.ts; upholstery softness: upholstery.ts + cushion-contact.ts.
    </architecture>
    <registryPattern>
      Default path for a new family: append an entry to src/modules/sofa3d/extended-products.json
      (id, title, url, imageUrl, reference, dimensions W×D×H cm, version note, brand) and add an
      id-keyed override block in extended-models.ts createExtendedModel() following the existing
      nammaro/soderhamn/jattebo/friheten examples. A dedicated module (like norsborg.ts) is ONLY
      for construction the generic model cannot express: modular sections (norsborg), scanned
      frames (scanned-frame.ts), or special mechanisms. Benchmarks (benchmarks.ts +
      benchmark-products.json) are legacy and not extended. Dispatch already routes ids via
      popular-models.ts / extended-models.ts — no dispatch changes needed for registry entries.
    </registryPattern>
    <apiReference note="Construction knobs the work orders must speak in">
      preset: 'two-seat'|'sofa'|'chaise'|'corner'|'armchair'|'ottoman'
      construction: frameStyle 'upholstered'|'slatted'; backCushions bool; looseCushions bool;
        armRollRadius (rolled arms, 8-16 typical); armStemWidth; armFlare; armSetback;
        backCushionHeight; frameHeight; legStyle 'round'|'square'|'block'|'plinth'; legWidth;
        skirtPleatDepth (0 = no skirt); skirtFlare; frontExtension; backRake; backTopThickness.
      part overrides (doc.overrides['main:seat-i' | 'main:back-i' | 'main:pillow-i' | '&lt;module-id&gt;:…']):
        width, height, depth, offset{x,y,z}, rotation{x,y,z}, loft (fill plumpness 0-1), softness
        0-1, piping bool, shape 'boxed'|'rounded'|'knife'|'half-knife', outline
        'rect'|'t'|'t-left'|'t-right'|'miter-left'|'miter-right'|'rl-left'|'rl-right'|'wedge-left'|'wedge-right',
        notchDrop (back cushions dropping behind the seat, PB-style).
      modules: single-module sofas keep main only; sectionals add modules with corner/cornerSide,
        armOnly (Norsborg-style armrest sections), per-module seats/backs.
      cushions doc.cushionLayout = { backs } when back-cushion count ≠ seat count.
    </apiReference>
    <codingConventions>
      TypeScript first; 2-space indent; kebab-case test files; Conventional Commits
      ("feat: sofa3d &lt;family&gt; preset"); validation gate = npm run type-check &amp;&amp; npm run lint
      &amp;&amp; npm test, then render the preset in Sofa Studio and compare against the family cover
      image before flipping its CHECKLIST.md row.
    </codingConventions>
  </technicalConstraints>

  <planningRules>
    <dimensionHierarchy severity="must">
      1. CW Import by the family's refs — exact QC measurements + component patterns (preferred).
      2. Manufacturer catalogue overall W×D×H (IKEA product pages etc.) — the extended-products.json
         pattern; component geometry estimated to the cover photo.
      3. Photo + tag estimate (arm_shape_categories, back_type, size tags) — allowed only when 1-2
         are unavailable; the work order must set estimate="true" and the model notes must say so.
    </dimensionHierarchy>
    <priorityOrder>
      partials first → IKEA by config count desc → sofa-bed mechanism families → corner/sectional
      families → US majors (Pottery Barn, West Elm, Restoration Hardware, Crate and Barrel,
      Room &amp; Board, Article, Burrow, Albany Park, 7th Avenue) → long tail grouped by brand
      alphabetically (1-config families batch together as warm-up/catch-up work).
    </priorityOrder>
    <batching>
      One batch = one overnight run ≈ 7 h of budgeted effort. Effort classes: S ≈ 20 min
      (single-config, preset + light overrides), M ≈ 45 min (2-6 configs), L ≈ 2 h (7+ configs or
      corner/sectional module layouts), XL ≈ 4 h (dedicated module or new mechanism — keep these
      rare, max 1 per batch, never the last item). Batch total must stay ≤ 6.5 h. Every batch ends
      with a validation + commit window (included in budget).
    </batching>
    <consistency>
      Families sharing an arm/back archetype (from tags) reuse a shared baseline of construction
      values; work orders state the baseline id and only list deviations. Reuse mechanisms: open
      sofa-beds extend the friheten sleeper pattern; modular sectionals extend the norsborg
      module machinery; rolled arms follow the ektorp/karlstad baseline; slope arms follow the
      PB York profile in profiles.ts; plinth-base modulars follow jattebo/cloud baselines.
    </consistency>
    <failurePolicy>
      Unattended runs must never block: if a dimension source fails or validation can't pass
      after 2 attempts, mark the work order blocked with reason and continue with the next.
      One conventional commit per completed family; CHECKLIST.md row flipped in the same commit;
      run "node tools/cw-catalog/pull-catalog.cjs derive &amp;&amp; node tools/cw-catalog/build-view.cjs"
      at batch end to refresh the checklist and review board.
    </failurePolicy>
    <colourways>
      Each work order picks one default colourway from the family's list (choose the cover
      photo's fabric where identifiable, else the family's first signature-range fabric) and
      gives its hex-free name — the executor samples the cover image for the hex.
    </colourways>
  </planningRules>

  <requiredOutput>
    <format>
      Return ONE well-formed XML document, no prose before or after, matching this schema:
      &lt;sofaPlan generated="YYYY-MM-DD" planner="gpt-astra" model="glm-flash"&gt;
        &lt;summary totalFamilies="N" totalConfigs="N" batchCount="N" estimatedRuns="N"
                 totalEffortHours="N" coverageGoal="100% of manifest"/&gt;
        &lt;policy priorityOrder="…" batchSize="…" checkpoint="…" failurePolicy="…"/&gt;
        &lt;throughput note="assumptions behind effort classes and run count"/&gt;
        &lt;batch n="1" theme="…" estMinutes="N"&gt;
          &lt;workOrder fam="&lt;family id from manifest&gt;" class="S|M|L|XL"
                     approach="preset|dedicated" estimate="true|false"&gt;
            &lt;dimensionSource type="cw-import|catalogue|photo" refs="…" url="…"/&gt;
            &lt;construction baseline="&lt;built family id or 'new'&gt;"&gt;
              &lt;!-- concrete knob values + deviations, using apiReference names --&gt;
            &lt;/construction&gt;
            &lt;colourway name="…"/&gt;
            &lt;steps&gt;&lt;step&gt;…&lt;/step&gt;…&lt;/steps&gt;
            &lt;validation&gt;&lt;check&gt;…&lt;/check&gt;…&lt;/validation&gt;
            &lt;dependencies&gt;…&lt;/dependencies&gt;
            &lt;blocked-if&gt;…&lt;/blocked-if&gt;
          &lt;/workOrder&gt;
        &lt;/batch&gt;
        … one batch per overnight run, covering EVERY todo family exactly once …
      &lt;/sofaPlan&gt;
    </format>
    <qualityBar>
      Every todo family in the manifest appears exactly once across batches; order follows
      priorityOrder; every workOrder names concrete apiReference knobs (no "tune as needed");
      effort sums per batch ≤ 390 min; built families appear only as baselines/dependencies,
      never as work; partial families carry a work order scoped to exactly the missing pieces.
    </qualityBar>
  </requiredOutput>

  <manifest count="${families.length}" configs="${totalConfigs}" todo="${todo.length}" todoConfigs="${todoConfigs}"
            note="st: built|partial|todo. refs = CW product reference codes for CW Import. kinds from product titles/tags. cover = family cover photo for proportion checks.">
${families.map(famLine).join('\n')}
  </manifest>

</planRequest>
`;

fs.writeFileSync(path.join(DATA, 'plan-request.xml'), HEAD);
console.log(
  `plan-request.xml written: ${(fs.statSync(path.join(DATA, 'plan-request.xml')).size / 1024).toFixed(0)} KB, ${families.length} families (${todo.length} todo)`
);
