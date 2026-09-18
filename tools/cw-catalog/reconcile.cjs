#!/usr/bin/env node
/**
 * Reconciles the Comfort Works catalog snapshot into the executor build state:
 *
 *   node tools/cw-catalog/reconcile.cjs
 *
 * Reads   data/comfort-works/sofas.json (+ categories) — never modified.
 * Writes  data/comfort-works/sofa3d-build/{inventory.json,queue.json}
 *
 * Contract: EXECUTOR_PROMPT.md §3. Every source occurrence is accounted for as
 * exactly one of: canonical product occurrence, alias membership, identity
 * conflict, or category-only extra. `kind` is treated as a hint only.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'data/comfort-works');
const BUILD = path.join(DATA, 'sofa3d-build');
const sofas = JSON.parse(fs.readFileSync(path.join(DATA, 'sofas.json'), 'utf8'));

/* ---------------- classification (evidence order: accessories first) --------------- */
const TYPE_RULES = [
  [/protector/, 'protector'],
  [/headrest/, 'headrest'],
  [/armrest/, 'armrest'],
  [/cushion-cover|cushions-cover|loose-cushion|pilloc|bolster|back-cushion-cover|seat-cushion-cover/, 'cushion'],
  [/(^|-)pillow/, 'cushion'],
  [/sofa-?bed|sleeper/, 'sofa-bed'],
  [/corner/, 'corner'],
  [/sectional|modular/, 'sectional'],
  [/chaise/, 'chaise'],
  [/recliner/, 'recliner'],
  [/armchair/, 'armchair'],
  [/footstool|pouf?e?\b/, 'footstool'],
  [/ottoman/, 'ottoman'],
  [/bench/, 'bench'],
  [/chair/, 'chair'],
  [/sofa|couch|loveseat|love-seat/, 'sofa'],
  [/\bdaybed\b|\bbed\b/, 'daybed'],
];
function classify(title, handle) {
  const s = `${handle} ${title}`.toLowerCase();
  for (const [re, type] of TYPE_RULES) if (re.test(s)) return type;
  return /custom/.test(s) ? 'custom' : 'unresolved';
}

/* ---------------- geometry variants from titles/references --------------- */
function variantsOf(p) {
  const s = `${p.handle} ${p.title}`;
  const v = {};
  const seats = s.match(/(\d+(?:\.\d+)?)\s*[- ]?\s*(?:seat|seater)/i);
  if (seats) v.seats = Number(seats[1]);
  if (/two-seat/i.test(s)) v.seats = v.seats ?? 2;
  if (/three-seat/i.test(s)) v.seats = v.seats ?? 3;
  if (/2-2|2\+2/.test(s)) v.cornerLayout = '2-2';
  if (/3-2/.test(s)) v.cornerLayout = '3-2';
  if (/\bdeep[- ]seat/i.test(s)) v.deepSeat = true;
  const w = s.match(/(\d{2})\s?(?:["”]|inch)/i);
  if (w) v.widthInches = Number(w[1]);
  if (/__L\b/.test(p.reference || '')) v.arm = 'left-only';
  if (/__R\b/.test(p.reference || '')) v.arm = 'right-only';
  if (/\bleft\b/i.test(s) && /chaise/i.test(s)) v.chaiseSide = 'left';
  if (/\bright\b/i.test(s) && /chaise/i.test(s)) v.chaiseSide = 'right';
  if (/no-arms|no arms|armless/i.test(s)) v.arm = 'armless';
  return v;
}

/* ---------------- explode occurrences ---------------- */
const occurrences = [];
for (const fam of sofas.families) {
  for (const p of fam.products) {
    occurrences.push({
      familyId: fam.id,
      handle: p.handle,
      reference: p.reference || '',
      title: p.title,
      url: p.url,
      image: p.image,
      declaredKind: p.kind,
      objectType: classify(p.title, p.handle),
      variants: variantsOf(p),
      available: p.available,
      sourceIndex: occurrences.length,
    });
  }
}

/* ---------------- canonical grouping by reference ---------------- */
const byRef = new Map();
for (const occ of occurrences) {
  const key = occ.reference || `handle:${occ.handle}`;
  if (!byRef.has(key)) byRef.set(key, []);
  byRef.get(key).push(occ);
}

const canonical = [];
const conflicts = [];
for (const [ref, occs] of byRef) {
  const handles = [...new Set(occs.map((o) => o.handle))];
  const titles = [...new Set(occs.map((o) => o.title))];
  const types = [...new Set(occs.map((o) => o.objectType))];
  const variantSigs = [...new Set(occs.map((o) => JSON.stringify(o.variants)))];
  const id = ref.startsWith('handle:')
    ? occs[0].handle
    : `ref-${ref}`.replace(/[^A-Za-z0-9._-]+/g, '-');

  if (handles.length > 1 || types.length > 1) {
    // Same reference claimed by different products — identity review, never merged.
    conflicts.push({
      id: `conflict-${id}`,
      reference: ref,
      handles,
      titles,
      types,
      familyIds: [...new Set(occs.map((o) => o.familyId))],
      resolution: 'identity-review',
    });
    continue;
  }
  canonical.push({
    id,
    reference: ref.startsWith('handle:') ? null : ref,
    handle: occs[0].handle,
    title: occs[0].title,
    objectType: occs[0].objectType,
    variants: occs[0].variants,
    familyIds: [...new Set(occs.map((o) => o.familyId))],
    aliasCount: occs.length,
    url: occs[0].url,
    image: occs[0].image,
    available: occs[0].available,
    variantSigs: variantSigs.length,
  });
}

/* ---------------- category-only products (reported, not in denominator) -------- */
const knownHandles = new Set(occurrences.map((o) => o.handle));
const categoryOnly = [];
for (const cat of sofas.categories || []) {
  for (const p of cat.products) {
    if (!knownHandles.has(p.handle))
      categoryOnly.push({ category: cat.id, handle: p.handle, title: p.title, sku: p.sku });
  }
}

/* ---------------- inventory ---------------- */
const inputHash = fs
  .createHash ? null : null; // placeholder to keep node version-agnostic below

const crypto = require('crypto');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sofasSha = sha(path.join(DATA, 'sofas.json')).slice(0, 16);

const inventory = {
  _meta: {
    generated: new Date().toISOString(),
    source: 'data/comfort-works/sofas.json',
    sofasSha256_16: sofasSha,
    contract: 'EXECUTOR_PROMPT.md §3',
    counts: {
      families: sofas.families.length,
      occurrences: occurrences.length,
      canonical: canonical.length,
      conflicts: conflicts.length,
      aliasOccurrences: occurrences.length - canonical.length - conflicts.flatMap((c) => c.handles).length,
      categoryOnly: categoryOnly.length,
      byType: canonical.reduce((m, c) => ((m[c.objectType] = (m[c.objectType] || 0) + 1), m), {}),
    },
  },
  canonical,
  conflicts,
  categoryOnly,
  occurrencesByFamily: sofas.families.map((f) => ({ familyId: f.id, products: f.products.length })),
};
fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, 'inventory.json'), JSON.stringify(inventory, null, 1));

/* ---------------- queue (contract §4 + §13 priority) ---------------- */
const BUILT = {
  'ikea-karlstad-slipcovers': ['karlstad'],
  'ikea-ektorp-slipcovers': ['ektorp'],
  'ikea-norsborg-slipcovers': ['norsborg', 'norsborg-chaise'],
  'ikea-soderhamn-slipcovers': ['soderhamn'],
  'ikea-friheten-slipcovers': ['friheten'],
  'ikea-jattebo-slipcovers': ['jattebo'],
  'ikea-nammaro-slipcovers': ['nammaro'],
  'pottery-barn-basic-slipcovers': ['pb-basic'],
  'pottery-barn-charleston-slipcovers': ['pb-charleston'],
  'pottery-barn-english-slipcovers': ['pb-english-sleeper'],
  'pottery-barn-york-slipcovers': ["pb-york-slope-95-1s2b", "pb-york-slope-95-1s3b", "pb-york-slope-95-2s2b", "pb-york-slope-95-3s3b"],
  'west-elm-harmony-slipcovers': ['harmony'],
  'replacement-restoration-hardware-cloud-slipcovers': ['cloud-corner'],
};
const PARTIAL = new Set(['ikea-klippan-slipcovers', 'pottery-barn-york-slipcovers']);
const US_MAJORS = /pottery barn|west elm|restoration hardware|crate and barrel|room & board|article|burrow|7th avenue|albany park/i;

const FURNITURE = new Set(['sofa', 'sofa-bed', 'corner', 'sectional', 'chaise', 'recliner', 'armchair', 'chair', 'footstool', 'ottoman', 'bench', 'daybed', 'custom']);
const ACCESSORY = new Set(['protector', 'headrest', 'armrest', 'cushion']);

function priorityOf(c) {
  if (!FURNITURE.has(c.objectType)) return 90; // accessories & unresolved last
  const fams = c.familyIds;
  if (fams.some((f) => PARTIAL.has(f))) return 1; // partial repair first
  if (fams.some((f) => BUILT[f])) return 2; // audit built-family coverage
  if (fams.every((f) => f.startsWith('ikea-'))) return 10; // IKEA (ordered by size below)
  if (c.objectType === 'sofa-bed') return 20;
  if (c.objectType === 'corner' || c.objectType === 'sectional') return 25;
  if (c.familyIds.some((f) => US_MAJORS.test(f.replace(/-slipcovers$/, '').replace(/-/g, ' ')))) return 30;
  return 40; // long tail
}

const sofaFamilySize = new Map(sofas.families.map((f) => [f.id, f.productCount]));
const jobs = canonical.map((c) => {
  const prio = priorityOf(c);
  // Built-family configs map to existing presets; they need an audit job, not a rebuild.
  const existing = c.familyIds.flatMap((f) => BUILT[f] || []);
  const job = {
    configurationId: c.id,
    canonicalProductId: c.id,
    familyIds: c.familyIds,
    sourceReference: c.reference,
    sourceHandle: c.handle,
    variant: c.variants,
    objectType: c.objectType,
    dependencyIds: [],
    sourceInputHash: sofasSha,
    specPath: `specs/${c.id}.json`,
    evidencePaths: [],
    implementationFiles: [],
    attemptCount: 0,
    lastError: null,
    nextAction: 'source-dimensions',
    buildStatus: 'queued',
    dimensionStatus: 'missing',
    structureStatus: 'not_run',
    renderStatus: 'not_run',
    visualStatus: 'unavailable',
    priority: prio,
    title: c.title,
    url: c.url,
    image: c.image,
    existingPresets: existing,
    jobClass:
      existing.length && !PARTIAL.has(c.familyIds.find((f) => BUILT[f]) || '')
        ? 'audit'
        : prio === 1
          ? 'partial-repair'
          : FURNITURE.has(c.objectType)
            ? 'build'
            : c.objectType === 'unresolved'
              ? 'identity-review'
              : 'accessory',
  };
  return job;
});

// Order: priority asc, then IKEA families by family size desc, then reference.
jobs.sort((a, b) => {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const sizeA = Math.max(...a.familyIds.map((f) => sofaFamilySize.get(f) || 0));
  const sizeB = Math.max(...b.familyIds.map((f) => sofaFamilySize.get(f) || 0));
  if (sizeB !== sizeA) return sizeB - sizeA;
  return a.configurationId.localeCompare(b.configurationId);
});

const queue = {
  _meta: {
    generated: new Date().toISOString(),
    sourceHash: sofasSha,
    contract: 'EXECUTOR_PROMPT.md §4/§13',
    counts: {
      total: jobs.length,
      partialRepair: jobs.filter((j) => j.jobClass === 'partial-repair').length,
      audit: jobs.filter((j) => j.jobClass === 'audit').length,
      build: jobs.filter((j) => j.jobClass === 'build').length,
      accessory: jobs.filter((j) => j.jobClass === 'accessory').length,
      identityReview: jobs.filter((j) => j.jobClass === 'identity-review').length,
    },
    note: 'Jobs are complete-furniture canonical configurations. Accessories are queued but build after furniture; identity conflicts never auto-merge.',
  },
  jobs,
};
fs.writeFileSync(path.join(BUILD, 'queue.json'), JSON.stringify(queue, null, 1));

console.log(JSON.stringify({ inventory: inventory._meta.counts, queue: queue._meta.counts }, null, 1));
