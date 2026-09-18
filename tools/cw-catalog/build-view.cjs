#!/usr/bin/env node
/**
 * Builds data/comfort-works/index.html — a self-contained review board bundling
 * the catalog database (sofas, configurations, fabrics), the sofa3d coverage
 * checklist, the CW Import grounding, and clickable work packages.
 *
 *   node tools/cw-catalog/build-view.cjs
 *
 * Reads only derived + raw JSON produced by pull-catalog.cjs. Output is a single
 * HTML file with embedded data (open directly via file://; fonts/images load
 * from the web).
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '../../data/comfort-works');
const RAW = path.join(DATA, 'raw');

const sofas = JSON.parse(fs.readFileSync(path.join(DATA, 'sofas.json'), 'utf8'));
const fabricsJson = JSON.parse(fs.readFileSync(path.join(DATA, 'fabrics.json'), 'utf8'));

/* ---------- compact data model ---------- */
const FABSETS = [];
const fabsetIndex = new Map();
function fabset(names) {
  const key = names.join('|');
  if (!fabsetIndex.has(key)) {
    fabsetIndex.set(key, FABSETS.length);
    FABSETS.push(names);
  }
  return fabsetIndex.get(key);
}

const titleCase = (s) =>
  s
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

const families = sofas.families.map((f) => {
  let colourways = [];
  const fabFile = path.join(RAW, 'fabrics', `${f.id}.json`);
  if (fs.existsSync(fabFile)) {
    const rec = JSON.parse(fs.readFileSync(fabFile, 'utf8'));
    colourways = [...new Set((rec.fabrics || []).map((x) => x.fabric).filter(Boolean))];
  }
  const display =
    f.series[0] ||
    f.id
      .replace(/^(ikea|slipcovers-for-[a-z-]*)/, '')
      .replace(/-(sofa-?covers?|slipcovers?|sofas?|covers?)$/, '') ||
    f.id;
  return {
    i: f.id,
    n: display,
    s: f.series,
    b: f.brands,
    v: f.sofa3d,
    c: f.productCount,
    img: f.cover || (f.products.find((p) => p.image) || {}).image || null,
    url: f.collection,
    p: f.products.map((p) => [p.title, p.reference || '', p.kind]),
    f: fabset(colourways),
    q: [f.id, display, f.series.join(' '), f.brands.join(' '), f.products.map((p) => p.reference).join(' ')]
      .join(' ')
      .toLowerCase(),
  };
});

const colourwayImage = new Map(
  fabricsJson.allColourways.map((c) => [c.fabric, c.sampleImage || null])
);
const fabricTypes = fabricsJson.fabrics.map((t) => {
  const seen = new Set();
  const ways = [];
  for (const c of t.colourways) {
    if (seen.has(c.fullName)) continue;
    seen.add(c.fullName);
    ways.push({ n: c.fullName });
  }
  return {
    t: t.fabric,
    hero: ways.map((w) => colourwayImage.get(w.n)).find(Boolean) || null,
    w: ways,
  };
});

const statusOf = (v) => (v.startsWith('built') ? 'built' : v.startsWith('partial') ? 'partial' : 'todo');

/* ---------- work packages ---------- */
const has = (f, kinds) => f.p.some((p) => kinds.includes(p[2]));
const familyFilter = {
  partials: (f) => statusOf(f.v) === 'partial',
  ikea: (f) => f.b.includes('IKEA') && statusOf(f.v) === 'todo',
  sofabeds: (f) => statusOf(f.v) === 'todo' && has(f, ['sofa-bed', 'corner sofa-bed']),
  corners: (f) => statusOf(f.v) === 'todo' && has(f, ['corner', 'sectional']),
  us: (f) =>
    statusOf(f.v) === 'todo' &&
    f.b.some((b) => /pottery barn|west elm|restoration hardware|crate and barrel|room & board|article|burrow|7th avenue|albany park/i.test(b)),
};
const pkgDefs = [
  {
    id: 'partials',
    num: '01',
    title: 'Finish the partials',
    desc: 'Klippan has no dedicated preset; PB York needs its Roll Arm, Deep Seat and remaining widths. Smallest batch, highest completeness win.',
    apply: { status: ['partial'] },
  },
  {
    id: 'ikea',
    num: '02',
    title: 'IKEA backlog, biggest first',
    desc: 'Every unbuilt IKEA family, ordered by configuration count — the core of the catalog and the most-ordered covers.',
    apply: { status: ['todo'], brand: 'IKEA', sort: 'configs' },
  },
  {
    id: 'sofabeds',
    num: '03',
    title: 'Sofa-beds & sleepers',
    desc: 'Families with bed mechanisms (Friheten-style open-bed work already exists in the renderer to reuse).',
    apply: { pkg: 'sofabeds', sort: 'configs' },
  },
  {
    id: 'corners',
    num: '04',
    title: 'Corners & sectionals',
    desc: 'Families with corner or sectional configurations — exercises the modular Norsborg/Jättebo machinery.',
    apply: { pkg: 'corners', sort: 'configs' },
  },
  {
    id: 'us',
    num: '05',
    title: 'US retail brands',
    desc: 'Pottery Barn, West Elm, RH, Crate & Barrel, Room & Board and other non-IKEA families.',
    apply: { pkg: 'us', sort: 'configs' },
  },
  {
    id: 'fabric',
    num: '06',
    title: 'Fabric → hex pipeline',
    desc: 'Not a modeling batch: map all 81 colourways to renderer hex values + sample images so any built model can be dressed correctly. One sitting.',
    apply: null,
    count: fabricsJson._meta.counts.colourways,
  },
];
const pkgCounts = {
  partials: families.filter(familyFilter.partials).length,
  ikea: families.filter(familyFilter.ikea).length,
  sofabeds: families.filter(familyFilter.sofabeds).length,
  corners: families.filter(familyFilter.corners).length,
  us: families.filter(familyFilter.us).length,
};

/* ---------- embed ---------- */
const EMBED = {
  pulledAt: sofas._meta.pulledAt,
  counts: {
    families: sofas._meta.counts.modelFamilies,
    products: sofas._meta.counts.baseProducts,
    types: fabricTypes.length,
    colourways: fabricsJson._meta.counts.colourways,
    categories: (sofas.categories || []).length,
    built: families.filter((f) => statusOf(f.v) === 'built').length,
    partial: families.filter((f) => statusOf(f.v) === 'partial').length,
  },
  families,
  fabsets: FABSETS,
  fabricTypes,
  categories: (sofas.categories || []).map((c) => [c.id, c.productCount]),
  packages: pkgDefs.map((p) => ({ ...p, count: pkgCounts[p.id] ?? p.count })),
  built: families
    .filter((f) => statusOf(f.v) !== 'todo')
    .sort((a, b) => statusOf(a.v).localeCompare(statusOf(b.v)) || a.n.localeCompare(b.n))
    .map((f) => ({ i: f.i, n: f.n, s: f.s, b: f.b, v: f.v, c: f.c, img: f.img, url: f.url })),
};

const json = JSON.stringify(EMBED).replace(/</g, '\\u003c');

/* ---------- html ---------- */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comfort Works → Sofa3D · Production Ledger</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --paper:#f4efe3; --paper-deep:#ece5d2; --card:#faf7ee;
  --ink:#221c12; --ink-soft:#6a5f4b; --line:#d9cfb6; --line-soft:#e6ddc7;
  --green:#3e5a40; --green-soft:#dfe6d8;
  --ochre:#a97a24; --ochre-soft:#f0e4c6;
  --rust:#a4401f; --rust-soft:#f2ddd0;
  --grey:#8f8570;
  --serif:'Fraunces',Georgia,serif; --mono:'IBM Plex Mono',ui-monospace,monospace; --sans:'Instrument Sans',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  background:var(--paper); color:var(--ink); font-family:var(--sans);
  font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased;
  background-image:radial-gradient(rgba(34,28,18,.045) 1px, transparent 1px);
  background-size:5px 5px;
}
.wrap{max-width:1180px;margin:0 auto;padding:0 32px}
a{color:inherit}
.mono{font-family:var(--mono)}
.overline{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft)}

/* masthead */
header{padding:56px 0 0}
.mast-top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid var(--ink);padding-bottom:10px}
.mast-top .mono{font-size:11px;color:var(--ink-soft)}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(44px,6.5vw,84px);line-height:1.02;letter-spacing:-.01em;margin:36px 0 20px;max-width:14ch}
h1 em{font-style:italic;font-weight:300;color:var(--rust)}
.deck{max-width:60ch;color:var(--ink-soft);font-size:16.5px;margin-bottom:28px}
.deck b{color:var(--ink);font-weight:600}
.meta-line{display:flex;flex-wrap:wrap;gap:10px 28px;font-family:var(--mono);font-size:11.5px;color:var(--ink-soft);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:12px 0}
.meta-line code{background:var(--paper-deep);padding:2px 7px;border:1px solid var(--line);font-size:11px;color:var(--ink)}

/* stat band */
.stats{display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid var(--line)}
.stat{padding:26px 18px 22px;border-right:1px solid var(--line)}
.stat:last-child{border-right:0}
.stat .num{font-family:var(--mono);font-size:clamp(26px,3.4vw,40px);font-weight:500;letter-spacing:-.02em}
.stat .lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);margin-top:6px}
.stat.hl .num{color:var(--green)}
.stat.pt .num{color:var(--ochre)}
.reveal{opacity:0;transform:translateY(14px);animation:rise .7s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes rise{to{opacity:1;transform:none}}

/* sections */
section{padding:64px 0 8px}
.sec-head{display:flex;align-items:baseline;gap:18px;border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:26px}
.sec-head h2{font-family:var(--serif);font-weight:500;font-size:30px;letter-spacing:-.01em}
.sec-head .overline{margin-left:auto}
.sec-note{color:var(--ink-soft);font-size:14px;max-width:72ch;margin:-14px 0 26px}

/* shelf */
.shelf{display:grid;grid-auto-flow:column;grid-auto-columns:214px;gap:16px;overflow-x:auto;padding:6px 2px 18px;scrollbar-width:thin}
.shelf-card{background:var(--card);border:1px solid var(--line);display:flex;flex-direction:column;min-height:250px}
.shelf-card .ph{height:120px;background:var(--paper-deep);display:flex;align-items:center;justify-content:center;overflow:hidden;border-bottom:1px solid var(--line-soft)}
.shelf-card img{width:100%;height:100%;object-fit:cover}
.shelf-card .ph .mono{font-size:10px;color:var(--grey)}
.shelf-card .bd{padding:12px 13px 13px;display:flex;flex-direction:column;gap:8px;flex:1;align-items:flex-start}
.shelf-card .nm{font-family:var(--serif);font-size:17.5px;line-height:1.15}
.shelf-card .mt{font-family:var(--mono);font-size:10.5px;color:var(--ink-soft);margin-top:auto}
.chip{display:inline-block;font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;padding:3px 8px 2px;border:1px solid}
.chip.built{color:var(--green);border-color:var(--green);background:var(--green-soft)}
.chip.partial{color:var(--ochre);border-color:var(--ochre);background:var(--ochre-soft)}
.chip.todo{color:var(--grey);border-color:var(--grey);background:transparent}
.chip.kind{color:var(--ink-soft);border-color:var(--line);background:var(--paper)}

/* work packages */
.pkgs{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:26px}
.pkg{position:relative;background:var(--card);border:1px solid var(--line);padding:20px 20px 18px;text-align:left;cursor:pointer;font:inherit;color:inherit;transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease}
.pkg:hover{transform:translateY(-3px);box-shadow:0 10px 24px -14px rgba(34,28,18,.45);border-color:var(--ink)}
.pkg.active{border-color:var(--rust);box-shadow:inset 0 0 0 1px var(--rust)}
.pkg .row1{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
.pkg .num{font-family:var(--serif);font-style:italic;font-size:26px;color:var(--rust)}
.pkg .count{font-family:var(--mono);font-size:12px;color:var(--ink-soft)}
.pkg .count b{font-size:20px;color:var(--ink);font-weight:500}
.pkg h3{font-family:var(--serif);font-weight:500;font-size:20px;margin-bottom:8px}
.pkg p{font-size:13px;color:var(--ink-soft);line-height:1.5}
.pkg .cta{margin-top:14px;font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--rust)}
.pkg.static{cursor:default}
.pkg.static:hover{transform:none;box-shadow:none;border-color:var(--line)}

/* ledger */
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.controls input[type=search]{flex:1 1 260px;background:var(--card);border:1px solid var(--line);padding:10px 14px;font:14px var(--sans);color:var(--ink);outline:none}
.controls input[type=search]:focus{border-color:var(--ink)}
.controls select{background:var(--card);border:1px solid var(--line);padding:10px 12px;font:13px var(--sans);color:var(--ink);outline:none}
.fchip{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:9px 14px;border:1px solid var(--line);background:var(--card);cursor:pointer;color:var(--ink-soft)}
.fchip.on{border-color:var(--ink);color:var(--ink);background:var(--ink);color:var(--paper)}
.fchip.on.f-built{background:var(--green);border-color:var(--green)}
.fchip.on.f-partial{background:var(--ochre);border-color:var(--ochre)}
.fchip.on.f-todo{background:var(--rust);border-color:var(--rust)}
.ledger-meta{font-family:var(--mono);font-size:11.5px;color:var(--ink-soft);margin:0 0 10px;text-align:right}
table.ledger{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}
.ledger thead th{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);text-align:left;padding:12px 14px;border-bottom:2px solid var(--ink);cursor:pointer;user-select:none;white-space:nowrap}
.ledger thead th:hover{color:var(--ink)}
.ledger thead th .arr{color:var(--rust)}
.ledger tbody td{padding:11px 14px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
.ledger tbody tr.fam{cursor:pointer;transition:background .12s}
.ledger tbody tr.fam:hover{background:var(--paper-deep)}
.ledger tbody tr.fam.open{background:var(--paper-deep)}
.ledger .fam-name{font-family:var(--serif);font-size:17px}
.ledger .fam-sub{font-family:var(--mono);font-size:10.5px;color:var(--ink-soft)}
.ledger .num-cell{font-family:var(--mono);font-size:14px;text-align:right}
tr.detail td{padding:0;border-bottom:1px solid var(--line)}
.detail-inner{display:grid;grid-template-columns:230px 1fr;gap:0;animation:rise .35s ease}
.detail-ph{border-right:1px solid var(--line-soft);background:var(--paper-deep);min-height:230px;display:flex;align-items:center;justify-content:center}
.detail-ph img{width:100%;height:100%;object-fit:cover}
.detail-body{padding:18px 20px}
.detail-body h4{font-family:var(--serif);font-weight:500;font-size:19px;margin-bottom:4px}
.detail-body .links{font-family:var(--mono);font-size:11px;margin-bottom:14px}
.detail-body .links a{color:var(--rust);text-decoration:none;border-bottom:1px dotted var(--rust)}
.detail-body .cw-hint{font-family:var(--mono);font-size:11px;color:var(--ink-soft);background:var(--paper);border:1px dashed var(--line);padding:8px 10px;margin-bottom:14px}
.detail-body .cw-hint b{color:var(--ink)}
.cfgs{display:flex;flex-direction:column;gap:4px;margin-bottom:16px}
.cfg{display:flex;gap:10px;align-items:baseline;font-size:13px}
.cfg .chip{min-width:86px;text-align:center}
.cfg .ref{font-family:var(--mono);font-size:11px;color:var(--rust)}
.swatches{display:flex;flex-wrap:wrap;gap:6px}
.swatch{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--paper);padding:3px 8px 3px 4px;font-family:var(--mono);font-size:10.5px;color:var(--ink-soft)}
.swatch img{width:22px;height:22px;object-fit:cover;border:1px solid var(--line)}
.empty{padding:34px;text-align:center;color:var(--ink-soft);font-family:var(--serif);font-style:italic;font-size:17px}

/* fabric book */
.book{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.fab{background:var(--card);border:1px solid var(--line);padding:18px}
.fab-hero{margin:-18px -18px 14px;height:120px;overflow:hidden;border-bottom:1px solid var(--line-soft)}
.fab-hero img{width:100%;height:100%;object-fit:cover}
.fab h3{font-family:var(--serif);font-weight:500;font-size:20px;margin-bottom:2px}
.fab .overline{font-size:10px}
.fab .swatches{margin-top:14px}
.fab .swatch{font-size:10px;padding:3px 8px 3px 4px}

/* grounding */
.ground{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px}
.gcard{background:var(--card);border:1px solid var(--line);padding:18px}
.gcard .tag{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--rust);margin-bottom:10px}
.gcard h3{font-family:var(--serif);font-weight:500;font-size:17.5px;margin-bottom:8px}
.gcard p{font-size:12.5px;color:var(--ink-soft);line-height:1.55}
.gcard code{font-family:var(--mono);font-size:10.5px;background:var(--paper);border:1px solid var(--line);padding:1px 5px;word-break:break-all}
.files{background:var(--card);border:1px solid var(--line);padding:18px 20px}
.files table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px}
.files td{padding:7px 10px;border-bottom:1px solid var(--line-soft)}
.files td:first-child{color:var(--rust);white-space:nowrap}
.files td:last-child{color:var(--ink-soft)}
.files tr:last-child td{border-bottom:0}

footer{padding:48px 0 64px;color:var(--ink-soft);font-family:var(--mono);font-size:11.5px}
footer .rule{border-top:2px solid var(--ink);margin-bottom:18px}
footer code{background:var(--paper-deep);border:1px solid var(--line);padding:2px 8px}

@media (max-width:960px){
  .stats{grid-template-columns:repeat(3,1fr)}
  .stat:nth-child(3n){border-right:0}
  .pkgs,.book,.ground{grid-template-columns:1fr 1fr}
  .detail-inner{grid-template-columns:1fr}
  .detail-ph{min-height:180px;border-right:0;border-bottom:1px solid var(--line-soft)}
}
@media (max-width:640px){
  .wrap{padding:0 18px}
  .stats{grid-template-columns:repeat(2,1fr)}
  .pkgs,.book,.ground{grid-template-columns:1fr}
  .hide-sm{display:none}
}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="mast-top reveal">
      <span class="overline">OpenPaint · Sofa3D · Production Ledger</span>
      <span class="mono" id="mast-date"></span>
    </div>
    <h1 class="reveal" style="animation-delay:.08s">Comfort Works,<br>bound &amp; <em>ready to model.</em></h1>
    <p class="deck reveal" style="animation-delay:.16s">
      Every sofa family and configuration on <b>comfort-works.com</b>, every fabric colourway,
      and the <b>Sofa3D coverage</b> of each — bundled so you can point at a batch and I'll build it.
      Expand any family for its configurations, reference codes and colourways.
    </p>
    <div class="meta-line reveal" style="animation-delay:.22s">
      <span>Pulled <span id="meta-date"></span></span>
      <span>Source <code>comfort-works.com</code> (Shopify)</span>
      <span>Regenerate <code>node tools/cw-catalog/pull-catalog.cjs all</code></span>
      <span>View <code>node tools/cw-catalog/build-view.cjs</code></span>
    </div>
  </div>
</header>

<div class="wrap">
  <div class="stats" id="stats"></div>

  <section id="shelf">
    <div class="sec-head"><h2>The current shelf</h2><span class="overline">built &amp; partial models in src/modules/sofa3d</span></div>
    <p class="sec-note">What exists today. Green = dedicated model; ochre = partial coverage of the family.</p>
    <div class="shelf" id="shelf-cards"></div>
  </section>

  <section id="work">
    <div class="sec-head"><h2>Work packages</h2><span class="overline">pick one — or name any family below</span></div>
    <div class="pkgs" id="pkgs"></div>
  </section>

  <section id="ledger-sec">
    <div class="sec-head"><h2>The ledger</h2><span class="overline" id="ledger-count"></span></div>
    <p class="sec-note">All model families. Click a row to open its configurations, reference codes (usable in CW Import) and colourways. Click a column header to sort.</p>
    <div class="controls">
      <input type="search" id="q" placeholder="Search family, series, brand or reference — e.g. kivik, Friheten, IK-KK…">
      <select id="brand"><option value="">All brands</option></select>
      <button class="fchip on f-all" data-st="all">All</button>
      <button class="fchip f-built" data-st="built">Built ✅</button>
      <button class="fchip f-partial" data-st="partial">Partial ◐</button>
      <button class="fchip f-todo" data-st="todo">Not built</button>
      <button class="fchip" id="clear">Clear</button>
    </div>
    <div class="ledger-meta" id="ledger-meta"></div>
    <table class="ledger">
      <thead><tr>
        <th style="width:34px"></th>
        <th data-sort="name">Family</th>
        <th class="hide-sm" data-sort="brand">Brand</th>
        <th class="hide-sm">Series</th>
        <th data-sort="configs" style="text-align:right">Configs</th>
        <th class="hide-sm" data-sort="fabrics" style="text-align:right">Colourways</th>
        <th style="width:90px">Status</th>
      </tr></thead>
      <tbody id="ledger"></tbody>
    </table>
  </section>

  <section id="fabrics">
    <div class="sec-head"><h2>Fabric swatch book</h2><span class="overline">a separate dimension — any model × any colourway</span></div>
    <p class="sec-note">Every fabric type sold today with its colourways (thumbnails are live product photography). Family-level availability is in each ledger row; the full JSON is in fabrics.json.</p>
    <div class="book" id="book"></div>
  </section>

  <section id="ground">
    <div class="sec-head"><h2>Grounding — what Sofapaint already reaches</h2><span class="overline">CW Import · OMS · PID</span></div>
    <p class="sec-note">Confirmed during this pass: CW Import is built in and gives per-order depth; this database gives whole-catalog breadth. The modeling loop uses both.</p>
    <div class="ground">
      <div class="gcard"><div class="tag">OMS</div><h3>Product &amp; measurement search</h3><p><code>src/modules/ui/cw-import-ui.ts</code> searches by name, code or PID via <code>/api/integrations/cw/measurements/search</code> → OMS at <code>cw40.comfort-works.com</code>, with version + style options per product.</p></div>
      <div class="gcard"><div class="tag">Measurements</div><h3>QC measurements &amp; patterns</h3><p>Imports measurement rows (value, section, pieces, skirt) and <code>product_components</code> pattern sizes — seat/back/accent cushion W×H×D and quantities, already parsed by the 3D adapter.</p></div>
      <div class="gcard"><div class="tag">Images</div><h3>PID image service</h3><p>Production images resolve from <code>cw-pid-qylyewlgca-uc.a.run.app</code> and the <code>pid-storage</code> GCS bucket, proxied through <code>/api/integrations/cw/measurements/image-proxy</code>.</p></div>
      <div class="gcard"><div class="tag">3D bridge</div><h3>fromCw() → SofaDocument</h3><p><code>src/modules/sofa3d/adapters.ts</code> turns an imported payload into an editable 3D document: overall W/D/H, seat &amp; back counts, per-cushion sizes, accent pillows, single-arm modules.</p></div>
    </div>
    <div class="files">
      <table>
        <tr><td>sofas.json</td><td>${EMBED.counts.families} model families · ${EMBED.counts.products} configurations · ${EMBED.counts.categories} category collections</td></tr>
        <tr><td>fabrics.json</td><td>${EMBED.counts.types} fabric types · ${EMBED.counts.colourways} colourways</td></tr>
        <tr><td>CHECKLIST.md</td><td>markdown twin of the ledger above (regenerated with the view)</td></tr>
        <tr><td>raw/</td><td>per-family products.json + per-family colourway scans — the full evidence trail</td></tr>
      </table>
    </div>
  </section>

  <footer>
    <div class="rule"></div>
    <div>generated by <code>tools/cw-catalog/build-view.cjs</code> · do not hand-edit · data: <code>data/comfort-works/</code> · next: point me at a work package or name any family.</div>
  </footer>
</div>

<script>
const DATA = ${json};
const $ = (s) => document.querySelector(s);
const statusOf = (v) => (v.startsWith('built') ? 'built' : v.startsWith('partial') ? 'partial' : 'todo');
const STATUS_CHIP = { built: ['built','BUILT'], partial: ['partial','PARTIAL'], todo: ['todo','—'] };

$('#mast-date').textContent = new Date(DATA.pulledAt).toISOString().slice(0,10);
$('#meta-date').textContent = new Date(DATA.pulledAt).toISOString().slice(0,10);

/* stats */
const C = DATA.counts;
const pct = Math.round(100 * C.built / C.families);
$('#stats').innerHTML = [
  [C.families, 'model families', ''],
  [C.products, 'configurations', ''],
  [C.types + ' / ' + C.colourways, 'fabric types / colourways', ''],
  [C.built, 'families built', 'hl reveal'],
  [C.partial, 'partial', 'pt reveal'],
  [pct + '%', 'catalog coverage', 'reveal'],
].map(([n, l, cls], i) =>
  \`<div class="stat \${cls}" style="animation-delay:\${.1 + i * .06}s"><div class="num">\${n}</div><div class="lbl">\${l}</div></div>\`
).join('');

/* shelf */
$('#shelf-cards').innerHTML = DATA.built.map((f, i) => \`
  <div class="shelf-card reveal" style="animation-delay:\${.05 * i}s">
    <div class="ph">\${f.img ? \`<img loading="lazy" src="\${f.img}" alt="">\` : '<span class="mono">no image</span>'}</div>
    <div class="bd">
      <span class="chip \${statusOf(f.v)}">\${STATUS_CHIP[statusOf(f.v)][1]}</span>
      <div class="nm">\${f.s[0] || f.n}</div>
      <div class="mt">\${(f.b[0] || '').toUpperCase()} · \${f.c} configs</div>
    </div>
  </div>\`).join('');

/* packages */
const PKG_APPLY = {
  partials: (f) => statusOf(f.v) === 'partial',
  sofabeds: (f) => statusOf(f.v) === 'todo' && f.p.some((p) => p[2] === 'sofa-bed' || p[2] === 'corner sofa-bed'),
  corners: (f) => statusOf(f.v) === 'todo' && f.p.some((p) => p[2] === 'corner' || p[2] === 'sectional'),
  us: (f) => statusOf(f.v) === 'todo' && f.b.some((b) => /pottery barn|west elm|restoration hardware|crate and barrel|room & board|article|burrow|7th avenue|albany park/i.test(b)),
};
$('#pkgs').innerHTML = DATA.packages.map((p, i) => \`
  <button class="pkg reveal\${p.apply ? '' : ' static'}" style="animation-delay:\${.06 * i}s" data-pkg="\${p.id}">
    <div class="row1"><span class="num">\${p.num}</span>
      <span class="count"><b>\${p.count}</b> \${p.apply ? 'items' : 'colourways'}</span></div>
    <h3>\${p.title}</h3><p>\${p.desc}</p>
    \${p.apply ? '<div class="cta">Show in ledger ↓</div>' : ''}
  </button>\`).join('');
document.querySelectorAll('.pkg').forEach((el) =>
  el.addEventListener('click', () => {
    const pkg = DATA.packages.find((p) => p.id === el.dataset.pkg);
    if (!pkg || !pkg.apply) return;
    state.search = ''; state.status = 'all'; state.brand = ''; state.sort = 'configs'; state.pkg = pkg.id;
    $('#q').value = ''; $('#brand').value = '';
    setStatusChips('all');
    document.querySelectorAll('.pkg').forEach((x) => x.classList.toggle('active', x === el));
    render();
    document.getElementById('ledger-sec').scrollIntoView({ behavior: 'smooth' });
  })
);

/* ledger */
const state = { search: '', status: 'all', brand: '', sort: 'configs', dir: -1, pkg: null, open: null };
const brands = [...new Set(DATA.families.flatMap((f) => f.b))].sort();
$('#brand').innerHTML = '<option value="">All brands</option>' + brands.map((b) => \`<option>\${b}</option>\`).join('');

function setStatusChips(active) {
  document.querySelectorAll('.fchip[data-st]').forEach((c) => {
    c.classList.toggle('on', c.dataset.st === active);
    if (active === 'all') c.classList.toggle('on', c.dataset.st === 'all');
  });
}
document.querySelectorAll('.fchip[data-st]').forEach((c) =>
  c.addEventListener('click', () => { state.status = c.dataset.st; state.pkg = null; setStatusChips(c.dataset.st); document.querySelectorAll('.pkg').forEach((x) => x.classList.remove('active')); render(); })
);
$('#q').addEventListener('input', (e) => { state.search = e.target.value.toLowerCase(); state.pkg = null; document.querySelectorAll('.pkg').forEach((x) => x.classList.remove('active')); render(); });
$('#brand').addEventListener('change', (e) => { state.brand = e.target.value; state.pkg = null; render(); });
$('#clear').addEventListener('click', () => { state.search = ''; state.status = 'all'; state.brand = ''; state.pkg = null; state.sort = 'configs'; state.dir = -1; $('#q').value = ''; $('#brand').value = ''; setStatusChips('all'); document.querySelectorAll('.pkg').forEach((x) => x.classList.remove('active')); render(); });
document.querySelectorAll('th[data-sort]').forEach((th) =>
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sort === key) state.dir *= -1; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
    render();
  })
);

function filtered() {
  let rows = DATA.families.filter((f) => {
    if (state.status !== 'all' && statusOf(f.v) !== state.status) return false;
    if (state.brand && !f.b.includes(state.brand)) return false;
    if (state.pkg && !PKG_APPLY[state.pkg](f)) return false;
    if (state.search && !f.q.includes(state.search)) return false;
    return true;
  });
  const val = (f) =>
    state.sort === 'name' ? f.n.toLowerCase()
      : state.sort === 'brand' ? (f.b[0] || '').toLowerCase()
      : state.sort === 'fabrics' ? DATA.fabsets[f.f].length
      : f.c;
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    return (va < vb ? -1 : va > vb ? 1 : 0) * state.dir;
  });
  return rows;
}

function detailHtml(f) {
  const fabset = DATA.fabsets[f.f];
  const refs = [...new Set(f.p.map((p) => p[1]).filter(Boolean))];
  return \`
    <div class="detail-ph">\${f.img ? \`<img loading="lazy" src="\${f.img}" alt="">\` : '<span class="mono">no image</span>'}</div>
    <div class="detail-body">
      <h4>\${f.s[0] || f.n} <span class="overline" style="margin-left:8px">\${f.b.join(' · ')}</span></h4>
      <div class="links"><a href="\${f.url}" target="_blank" rel="noopener">collection ↗</a>\${f.img ? \` · <a href="\${f.img}" target="_blank" rel="noopener">cover image ↗</a>\` : ''}</div>
      <div class="cw-hint">CW IMPORT — search <b>\${refs.slice(0, 4).join(', ') || f.i}</b> to pull exact QC measurements &amp; production images, then <b>Open in Studio</b> → fromCw() gives the starting 3D document.</div>
      <div class="overline" style="margin-bottom:8px">\${f.c} configurations</div>
      <div class="cfgs">\${f.p.map((p) => \`<div class="cfg"><span class="chip kind">\${p[2]}</span><span>\${p[0]}</span><span class="ref">\${p[1] || ''}</span></div>\`).join('')}</div>
      <div class="overline" style="margin-bottom:8px">\${fabset.length} colourways available</div>
      <div class="swatches">\${fabset.slice(0, 40).map((n) => \`<span class="swatch">\${n}</span>\`).join('')}\${fabset.length > 40 ? \`<span class="swatch">+ \${fabset.length - 40} more</span>\` : ''}</div>
    </div>\`;
}

function render() {
  const rows = filtered();
  $('#ledger-count').textContent = rows.length + ' of ' + DATA.families.length + ' families';
  $('#ledger-meta').textContent = 'sorted by ' + state.sort + (state.dir < 0 ? ' ↓' : ' ↑');
  document.querySelectorAll('th .arr').forEach((a) => a.remove());
  const th = document.querySelector('th[data-sort="' + state.sort + '"]');
  if (th) th.insertAdjacentHTML('beforeend', ' <span class="arr">' + (state.dir < 0 ? '↓' : '↑') + '</span>');
  $('#ledger').innerHTML = rows.length
    ? rows.map((f) => {
        const st = statusOf(f.v);
        const open = state.open === f.i;
        return \`
        <tr class="fam\${open ? ' open' : ''}" data-i="\${f.i}">
          <td class="num-cell" style="color:var(--ink-soft);font-size:11px">\${open ? '−' : '+'}</td>
          <td><div class="fam-name">\${f.s[0] || f.n}</div><div class="fam-sub">\${f.i}</div></td>
          <td class="hide-sm" style="font-size:13px;color:var(--ink-soft)">\${f.b.join(', ')}</td>
          <td class="hide-sm" style="font-size:13px;color:var(--ink-soft)">\${f.s.join(', ') || '—'}</td>
          <td class="num-cell">\${f.c}</td>
          <td class="num-cell hide-sm" style="color:var(--ink-soft)">\${DATA.fabsets[f.f].length}</td>
          <td><span class="chip \${st}">\${STATUS_CHIP[st][1]}</span></td>
        </tr>\${open ? \`<tr class="detail"><td colspan="7"><div class="detail-inner">\${detailHtml(f)}</div></td></tr>\` : ''}\`;
      }).join('')
    : '<tr><td colspan="7"><div class="empty">Nothing matches — clear the filters or try another name.</div></td></tr>';
  document.querySelectorAll('tr.fam').forEach((tr) =>
    tr.addEventListener('click', () => { state.open = state.open === tr.dataset.i ? null : tr.dataset.i; render(); })
  );
}
render();

/* fabric book */
$('#book').innerHTML = DATA.fabricTypes.map((t) => \`
  <div class="fab">
    \${t.hero ? \`<div class="fab-hero"><img loading="lazy" src="\${t.hero}" alt=""></div>\` : ''}
    <div class="overline">\${t.w.length} colourways</div>
    <h3>\${t.t}</h3>
    <div class="swatches">\${t.w.map((c) => \`<span class="swatch">\${c.n}</span>\`).join('')}</div>
  </div>\`).join('');
</script>
</body>
</html>`;

fs.writeFileSync(path.join(DATA, 'index.html'), html);
console.log(
  `index.html written: ${(fs.statSync(path.join(DATA, 'index.html')).size / 1024 / 1024).toFixed(2)} MB, ${families.length} families, ${FABSETS.length} unique colourway sets`
);
