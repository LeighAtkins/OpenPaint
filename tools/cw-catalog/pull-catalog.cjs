#!/usr/bin/env node
/**
 * Pulls the complete Comfort Works public catalog into data/comfort-works/.
 *
 * Phases (run in order, each resumable — finished raw files are skipped):
 *   node tools/cw-catalog/pull-catalog.cjs sitemaps   # refresh collection list
 *   node tools/cw-catalog/pull-catalog.cjs collections # one products.json per collection
 *   node tools/cw-catalog/pull-catalog.cjs fabrics     # PDP sibling scan → fabric colorways
 *   node tools/cw-catalog/pull-catalog.cjs derive      # build sofas.json, fabrics.json, CHECKLIST.md
 *
 * Data model discovered on comfort-works.com (Shopify):
 * - One collection per model family (e.g. /collections/ikea-ektorp-slipcovers).
 * - Collections list BASE products only, one per configuration
 *   (Ektorp → 14: 2-seater, 3-seater, corner 2+2, chaise, armchair, footstool, protectors…).
 * - Every fabric/colourway of a base product is a separate product whose PDP embeds the
 *   full sibling list (handle, title "- <Fabric> <Colour>", SKU "MODEL__STYLE__FABRIC",
 *   price, image). The fabrics phase reads one representative PDP per family.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'data/comfort-works');
const RAW = path.join(DATA, 'raw');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const BASE = 'https://comfort-works.com';
const CONCURRENCY = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(250 + Math.random() * 450);

async function fetchText(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.text();
    } catch (err) {
      if (i === tries - 1) {
        console.warn(`  ! giving up on ${url}: ${err.message}`);
        return null;
      }
      // Rate limiting needs a long cooldown; plain errors retry quickly.
      await sleep(err.message === 'HTTP 429' ? 5000 * (i + 1) : 800 * 2 ** i);
    }
  }
  return null;
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

async function pool(items, worker) {
  const queue = [...items];
  let done = 0;
  const reporters = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
      done++;
      if (done % 25 === 0 || done === items.length)
        console.log(`  ${done}/${items.length}`);
      await jitter();
    }
  });
  await Promise.all(reporters);
}

/* ------------------------------------------------------------------ */
/* Phase: sitemaps                                                     */
/* ------------------------------------------------------------------ */
async function phaseSitemaps() {
  fs.mkdirSync(RAW, { recursive: true });
  const index = await fetchText(`${BASE}/sitemap.xml`);
  const urls = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, '&')
  );
  const defaultLocale = urls.filter((u) => !/\/[a-z]{2}-[a-z]{2}\//.test(u));
  const collectionUrls = defaultLocale.filter((u) => u.includes('sitemap_collections'));
  const handles = new Set();
  for (const cu of collectionUrls) {
    const xml = await fetchText(cu);
    if (!xml) continue;
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const handle = m[1].replace(/.*\/collections\//, '').replace(/\/$/, '');
      if (handle) handles.add(handle);
    }
    await jitter();
  }
  const list = [...handles].sort();
  fs.writeFileSync(path.join(RAW, 'collection-handles.json'), JSON.stringify(list, null, 1));
  console.log(`collections: ${list.length}`);
}

/* ------------------------------------------------------------------ */
/* Phase: collections                                                  */
/* ------------------------------------------------------------------ */
function compactProduct(p) {
  return {
    handle: p.handle,
    title: p.title,
    type: p.type,
    vendor: p.vendor,
    sku: p.variants?.[0]?.sku || null,
    price: p.variants?.[0]?.price ?? null,
    available: !!p.available,
    image:
      p.images?.[0]?.src ||
      (p.featured_image ? `https:${p.featured_image}`.replace('https:https:', 'https:') : null),
    images: (p.images || []).slice(0, 3).map((i) => i.src || i),
    tags: p.tags || [],
    variants: (p.variants || []).map((v) => ({
      title: v.title,
      sku: v.sku,
      price: v.price,
      option1: v.option1,
      available: !!v.available,
    })),
    options: p.options || [],
  };
}

async function phaseCollections() {
  const handles = readJson(path.join(RAW, 'collection-handles.json'), []);
  const dir = path.join(RAW, 'collections');
  fs.mkdirSync(dir, { recursive: true });
  console.log(`collections: ${handles.length}`);
  await pool(handles, async (handle) => {
    const file = path.join(dir, `${handle}.json`);
    if (fs.existsSync(file)) return;
    const products = [];
    let complete = false;
    for (let page = 1; page <= 12; page++) {
      const text = await fetchText(
        `${BASE}/collections/${handle}/products.json?limit=250&page=${page}`
      );
      if (text === null) return; // fetch failed — leave unwritten so a rerun retries
      let batch = [];
      try {
        batch = JSON.parse(text).products || [];
      } catch {
        return; // non-JSON (challenge page) — retry on a rerun
      }
      products.push(...batch);
      if (batch.length < 250) {
        complete = true;
        break;
      }
    }
    if (!complete) return;
    fs.writeFileSync(
      file,
      JSON.stringify(
        { handle, fetchedAt: new Date().toISOString(), count: products.length, products: products.map(compactProduct) },
        null,
        1
      )
    );
  });
}

/* ------------------------------------------------------------------ */
/* Phase: fabrics (PDP sibling scan)                                   */
/* ------------------------------------------------------------------ */
// JSON strings may contain escaped slashes ("\/products\/…"), so every value is
// matched as a generic escaped string rather than a literal path.
const STR = '(?:[^"\\\\]|\\\\.)*';
const SIBLING_RE = new RegExp(
  `\\{"id":"\\d+","handle":"${STR}","isCollective":null,` +
    `"title":"${STR}","type":"(?:[^"\\\\]|\\\\.)*",` +
    `"untranslatedTitle":"${STR}","url":"${STR}",` +
    `"vendor":"(?:[^"\\\\]|\\\\.)*","remoteShopId":null,"variants":\\[.*?\\]\\}`,
  'gs'
);
const VARIANT_RE = new RegExp(
  `"image":\\{"src":"(${STR})"\\},"price":\\{"amount":([\\d.]+),"currencyCode":"([A-Z]+)"\\},"sku":"(${STR})"`
);

function pickRepresentative(products) {
  const score = (p) => {
    const h = p.handle;
    if (/footstool|protector|headrest|armrest|cushion-cover|pilloc|cover-for/.test(h)) return 0;
    if (/sofa-cover|sofa-slipcover|sofas-cover/.test(h)) return 3;
    if (/corner|sectional|chaise/.test(h)) return 2;
    if (/cover|slipcover/.test(h)) return 1;
    return 0;
  };
  return [...products].sort((a, b) => score(b) - score(a) || b.title.length - a.title.length)[0];
}

function unescapeJson(s) {
  return JSON.parse(`"${s}"`);
}

async function phaseFabrics() {
  const dir = path.join(RAW, 'fabrics');
  fs.mkdirSync(dir, { recursive: true });
  const colDir = path.join(RAW, 'collections');
  const handles = fs
    .readdirSync(colDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(colDir, f), 'utf8')))
    .filter((c) => c.count > 0)
    .map((c) => c.handle);
  console.log(`families with products: ${handles.length}`);
  await pool(handles, async (handle) => {
    const file = path.join(dir, `${handle}.json`);
    if (fs.existsSync(file)) return;
    const col = JSON.parse(fs.readFileSync(path.join(colDir, `${handle}.json`), 'utf8'));
    const rep = pickRepresentative(col.products);
    if (!rep) {
      fs.writeFileSync(file, JSON.stringify({ handle, fabrics: [], note: 'no representative product' }));
      return;
    }
    const html = await fetchText(`${BASE}/products/${rep.handle}`);
    if (!html) return; // fetch failed — leave unwritten so a rerun retries
    const seen = new Map();
    for (const m of html.matchAll(SIBLING_RE)) {
      let obj;
      try {
        obj = JSON.parse(m[0]);
      } catch {
        continue;
      }
      const v = obj.variants?.[0] || {};
      const skuMatch = v.sku ? v.sku.match(VARIANT_RE) : null;
      // Title convention: "<Base Title> - <Fabric> <Colour>"
      const dash = obj.title.lastIndexOf(' - ');
      const fabricName = dash > 0 ? obj.title.slice(dash + 3) : null;
      const key = fabricName || obj.handle;
      if (!seen.has(key))
        seen.set(key, {
          fabric: fabricName,
          handle: obj.handle,
          url: `${BASE}/products/${obj.handle}`,
          sku: skuMatch ? skuMatch[4] : v.sku || null,
          price: skuMatch ? Number(skuMatch[2]) : null,
          currency: skuMatch ? skuMatch[3] : null,
          image: v.image?.src ? `https:${v.image.src}`.replace('https:https:', 'https:') : null,
        });
    }
    const hubLinks = [...new Set([...html.matchAll(/hyperlink_anchor:\s*"([^"]*fabrics[^"]*)"/g)].map((m) => m[1]))];
    fs.writeFileSync(
      file,
      JSON.stringify(
        { handle, representative: rep.handle, hubLinks, fabricCount: seen.size, fabrics: [...seen.values()] },
        null,
        1
      )
    );
  });
}

/* ------------------------------------------------------------------ */
/* Phase: derive                                                       */
/* ------------------------------------------------------------------ */
const KIND_RULES = [
  ['corner-sofa-bed', 'corner sofa-bed'],
  ['sofa-bed', 'sofa-bed'],
  ['corner', 'corner'],
  ['sectional', 'sectional'],
  ['chaise', 'chaise'],
  ['sofa-bed', 'sofa-bed'],
  ['2-seat-sofa-bed', 'sofa-bed'],
  ['sofa', 'sofa'],
  ['armchair', 'armchair'],
  ['chair', 'chair'],
  ['footstool', 'footstool'],
  ['ottoman', 'ottoman'],
  ['protector', 'protector'],
  ['headrest', 'headrest'],
  ['armrest', 'armrest'],
  ['recliner', 'recliner'],
];

function kindOf(title, handle) {
  const s = `${handle} ${title}`.toLowerCase();
  for (const [needle, kind] of KIND_RULES) if (s.includes(needle)) return kind;
  return 'other';
}

// Models already built in src/modules/sofa3d (see README in this folder).
const BUILT_3D = {
  'ikea-karlstad': 'built — benchmarks (karlstad)',
  'ikea-ektorp': 'built — benchmarks (ektorp)',
  'ikea-norsborg': 'built — norsborg module (+chaise)',
  'ikea-soderhamn': 'built — extended (soderhamn)',
  'ikea-friheten': 'built — extended (friheten, incl. bed)',
  'ikea-jattebo': 'built — extended (jattebo)',
  'ikea-nammaro': 'built — extended (nammaro, armless outdoor)',
  'ikea-klippan': 'partial — generic profile only, no dedicated preset',
  'pottery-barn-basic': 'built — benchmarks (pb-basic)',
  'pottery-barn-charleston': 'built — extended (pb-charleston)',
  'pottery-barn-english': 'built — extended (pb-english-sleeper, scanned frame)',
  'pottery-barn-york': 'partial — York Slope Arm 95" built (4 cushion configs); Roll Arm / Deep Seat / other widths not built',
  'west-elm-harmony': 'built — benchmarks (harmony)',
  'replacement-restoration-hardware-cloud': 'built — benchmarks (cloud-corner)',
};

function family3dStatus(handle) {
  const key = handle.replace(/^\/?collections\//, '').replace(/-(sofa-?covers?|slipcovers?|sofas?|covers?)$/, '');
  return BUILT_3D[key] || null;
}

function phaseDerive() {
  const colDir = path.join(RAW, 'collections');
  const fabDir = path.join(RAW, 'fabrics');
  const families = [];
  const categories = [];
  const fabricUnion = new Map();
  const fabricHubs = new Set();

  for (const f of fs.readdirSync(colDir).filter((f) => f.endsWith('.json'))) {
    const col = JSON.parse(fs.readFileSync(path.join(colDir, f), 'utf8'));
    if (!col.count) continue;
    const products = col.products.map((p) => {
      const series = (p.tags.find((t) => t.startsWith('series:')) || '').slice(7) || null;
      const ref = (p.tags.find((t) => t.startsWith('FLT___Product_Ref__New____')) || '').replace('FLT___Product_Ref__New____', '') || p.sku || null;
      const styles = p.tags.filter((t) => t.startsWith('FLT___Style_Name___')).map((t) => t.replace('FLT___Style_Name___', ''));
      return {
        handle: p.handle,
        title: p.title,
        url: `${BASE}/products/${p.handle}`,
        kind: kindOf(p.title, p.handle),
        reference: ref,
        series,
        styles: [...new Set(styles)],
        image: p.image,
        available: p.available,
      };
    });
    const vendors = [...new Set(col.products.map((p) => p.vendor).filter(Boolean))];
    const seriesNames = [...new Set(products.map((p) => p.series).filter(Boolean))];
    const tagSubset = [
      ...new Set(
        col.products.flatMap((p) => p.tags.filter((t) => /^(categories|size|back_type|arm_shape_categories):/.test(t)))
      ),
    ].sort();
    // Cover image: prefer the flagship sofa product, never a footstool/protector.
    const coverScore = (p) => {
      const h = p.handle;
      if (/footstool|protector|headrest|armrest|pilloc|cover-for/.test(h)) return 0;
      if (/sofa-cover|sofa-slipcover|sofas-cover/.test(h)) return 3;
      if (/corner|sectional|chaise/.test(h)) return 2;
      if (/cover|slipcover/.test(h)) return 1;
      return 0;
    };
    const cover = [...products].sort((a, b) => coverScore(b) - coverScore(a))[0];
    const entry = {
      id: col.handle,
      collection: `${BASE}/collections/${col.handle}`,
      brands: vendors,
      series: seriesNames,
      productCount: col.count,
      categories: tagSubset,
      products,
      cover: cover?.image || null,
    };
    // Cross-model category pages (e.g. "chair-covers") aggregate many series;
    // a model family concentrates on one or two.
    entry.kind = seriesNames.length > 3 ? 'category' : 'model-family';
    entry.sofa3d = entry.kind === 'model-family' ? family3dStatus(col.handle) || 'not built' : 'n/a (category)';
    (entry.kind === 'model-family' ? families : categories).push(entry);
  }
  families.sort((a, b) => a.id.localeCompare(b.id));
  categories.sort((a, b) => a.id.localeCompare(b.id));

  for (const f of fs.readdirSync(fabDir).filter((f) => f.endsWith('.json'))) {
    const rec = JSON.parse(fs.readFileSync(path.join(fabDir, f), 'utf8'));
    for (const hub of rec.hubLinks || []) fabricHubs.add(hub);
    for (const fab of rec.fabrics || []) {
      if (!fab.fabric) continue;
      if (!fabricUnion.has(fab.fabric))
        fabricUnion.set(fab.fabric, {
          fabric: fab.fabric,
          families: [],
          sampleUrl: fab.url,
          sampleImage: fab.image,
          sampleSku: fab.sku,
          samplePrice: fab.price,
          currency: fab.currency,
        });
      const entry = fabricUnion.get(fab.fabric);
      if (!entry.families.includes(rec.handle)) entry.families.push(rec.handle);
    }
  }
  const fabricList = [...fabricUnion.values()].sort((a, b) => a.fabric.localeCompare(b.fabric));

  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(
    path.join(DATA, 'sofas.json'),
    JSON.stringify(
      {
        _meta: {
          source: 'comfort-works.com (Shopify)',
          pulledAt: new Date().toISOString(),
          generator: 'tools/cw-catalog/pull-catalog.cjs',
          counts: {
            modelFamilies: families.length,
            categoryCollections: categories.length,
            baseProducts: families.reduce((s, f) => s + f.productCount, 0),
          },
          notes: [
            'One entry per model family (collection). products = one base product per configuration.',
            'Every product also exists in dozens of fabric/colourway variants; see fabrics.json and raw/fabrics/<family>.json for the per-family colourway list.',
            'kind=model-family vs category: categories (e.g. "chair-covers") aggregate many models — kept under the top-level "categories" key.',
            'sofa3d field: coverage status in src/modules/sofa3d.',
          ],
        },
        families,
        categories,
      },
      null,
      1
    )
  );

  // Group colourways into fabric types: type = name minus a trailing known colour.
  const COLOURS = [
    'Antique Beige', 'Basil Green', 'Bayleaf', 'Burnt Orange', 'Cacao', 'Caramel', 'Charcoal',
    'Cinnamon', 'Coral', 'Cream', 'Dark Coral', 'Dark Teal', 'Denim', 'Espresso', 'Eucalyptus',
    'Flax', 'Forest Green', 'Gray', 'Grey', 'Hazel', 'Khaki', 'Midnight', 'Mineral Blue', 'Mist',
    'Navy New', 'Navy', 'Natural', 'Nutmeg', 'Oatmeal', 'Peach', 'Pebble', 'Pewter', 'Rust',
    'Maroon', 'Sand', 'Sage', 'Silver Sage', 'Snow', 'Storm', 'Sunset', 'Teal', 'White', 'Amber',
    'Ash', 'Beige', 'Blue', 'Green', 'Ivory', 'Blush', 'Taupe', 'Ink', 'Onyx', 'Pearl',
  ].sort((a, b) => b.length - a.length);
  const fabricTypes = new Map();
  for (const f of fabricList) {
    if (/^[A-Z0-9_-]+$/.test(f.fabric)) continue; // accessory SKUs (e.g. "USB1-CBL"), not fabric
    const norm = f.fabric.replace(/✚/g, '+');
    // Legacy colourways carry a trailing "Old" version marker ("Everyday Cotton Sand Old").
    let base = norm;
    let version = '';
    if (/ Old$/i.test(base)) {
      version = ' Old';
      base = base.replace(/ Old$/i, '');
    }
    const colour = COLOURS.find((c) => base.toLowerCase().endsWith(' ' + c.toLowerCase()));
    const type = colour ? base.slice(0, -colour.length - 1).trim() : base.replace(/\s+\S+$/, '');
    if (!fabricTypes.has(type)) fabricTypes.set(type, { fabric: type, colourways: [] });
    fabricTypes
      .get(type)
      .colourways.push({
        colour: (colour || base.split(/\s+/).pop()) + version,
        fullName: norm,
        sampleUrl: f.sampleUrl,
        sampleSku: f.sampleSku,
      });
  }
  fs.writeFileSync(
    path.join(DATA, 'fabrics.json'),
    JSON.stringify(
      {
        _meta: {
          source: 'comfort-works.com product-page sibling scans',
          pulledAt: new Date().toISOString(),
          counts: { fabricTypes: fabricTypes.size, colourways: fabricList.length },
          hubPages: [...fabricHubs].sort(),
          notes: [
            'colourways = fabric type + colour name as sold per product ("Ektorp 3 Seater Sofa Cover - Everyday Velvet Cacao").',
            'families lists which model families offer the fabric (see raw/fabrics/<family>.json).',
            'Fabric type grouping uses a vocabulary list; unmapped types fall back to heuristics — check "colourways" if a type looks wrong.',
          ],
        },
        fabrics: [...fabricTypes.values()].sort((a, b) => a.fabric.localeCompare(b.fabric)),
        allColourways: fabricList,
      },
      null,
      1
    )
  );

  // Checklist
  const built = families.filter((f) => f.sofa3d !== 'not built');
  const baseProducts = families.reduce((s, f) => s + f.productCount, 0);
  const display = (f) =>
    f.series[0] ||
    f.id.replace(/^(ikea|slipcovers-for-[a-z-]*)/, '').replace(/-(sofa-?covers?|slipcovers?|sofas?|covers?)$/, '') ||
    f.id;
  const lines = [
    '# Comfort Works Catalog → Sofa3D Checklist',
    '',
    `Pulled ${new Date().toISOString().slice(0, 10)} · ${families.length} model families · ${baseProducts} base products (configurations) · ${fabricTypes.size} fabric types / ${fabricList.length} colourways.`,
    'Regenerate with `node tools/cw-catalog/pull-catalog.cjs all` (raw cache in `data/comfort-works/raw/`).',
    '',
    `## Coverage: ${built.filter((f) => f.sofa3d.startsWith('built')).length}/${families.length} model families built (${built.length} touched)`,
    '',
    'Legend: ✅ dedicated model built · 🟨 partial · ⬜ not built',
    '',
    '## IKEA families',
    '',
    '| Family | Series | Configs | sofa3d status |',
    '| --- | --- | --- | --- |',
  ];
  for (const f of families.filter((f) => f.brands.includes('IKEA'))) {
    const mark = f.sofa3d.startsWith('built') ? '✅' : f.sofa3d.startsWith('partial') ? '🟨' : '⬜';
    lines.push(`| [${display(f)}](${f.collection}) | ${(f.series.join(', ') || '—')} | ${f.productCount} | ${mark} ${f.sofa3d} |`);
  }
  const nonIkea = families.filter((f) => !f.brands.includes('IKEA'));
  const byBrand = new Map();
  for (const f of nonIkea)
    for (const b of f.brands.length ? f.brands : ['(other)'])
      byBrand.set(b, [...(byBrand.get(b) || []), f]);
  for (const brand of [...byBrand.keys()].sort()) {
    lines.push('', `## ${brand} families`, '', '| Family | Series | Configs | sofa3d status |', '| --- | --- | --- | --- |');
    for (const f of byBrand.get(brand)) {
      const mark = f.sofa3d.startsWith('built') ? '✅' : f.sofa3d.startsWith('partial') ? '🟨' : '⬜';
      lines.push(`| [${display(f)}](${f.collection}) | ${(f.series.join(', ') || '—')} | ${f.productCount} | ${mark} ${f.sofa3d} |`);
    }
  }
  lines.push(
    '',
    '## Cross-model category collections',
    '',
    'These aggregate every model by product type — useful for parts (armrest/headrest covers) but not separate models:',
    '',
    '| Collection | Products |',
    '| --- | --- |',
  );
  for (const c of categories) lines.push(`| [${c.id}](${c.collection}) | ${c.productCount} |`);
  lines.push(
    '',
    '## Fabric options',
    '',
    `${fabricTypes.size} fabric types, ${fabricList.length} colourways — full list in [fabrics.json](fabrics.json). Fabrics are a separate dimension: any built model can be rendered in any colourway.`,
  );
  fs.writeFileSync(path.join(DATA, 'CHECKLIST.md'), lines.join('\n') + '\n');

  console.log(
    `derived: ${families.length} model families (${baseProducts} products), ${categories.length} category collections, ${fabricTypes.size} fabric types / ${fabricList.length} colourways`
  );
}

/* ------------------------------------------------------------------ */
async function main() {
  const phase = process.argv[2] || 'all';
  if (phase === 'sitemaps' || phase === 'all') await phaseSitemaps();
  if (phase === 'collections' || phase === 'all') await phaseCollections();
  if (phase === 'fabrics' || phase === 'all') await phaseFabrics();
  if (phase === 'derive' || phase === 'all') phaseDerive();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
