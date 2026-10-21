#!/usr/bin/env node
/**
 * Builds src/data/pdf-templates.json from the Comfort Works PDF library and
 * copies the library's SVG diagrams to public/cw-svgs/<code>/<view>.svg.
 *
 *   node scripts/build-pdf-registry.mjs [--library DIR]          build
 *   node scripts/build-pdf-registry.mjs --check [--library DIR]  identify every PDF, print a table
 *
 * The fingerprint and matching rules live in src/modules/cw-form-pdf and are
 * bundled here with esbuild, so the app and this script agree.
 */
import { build } from 'esbuild';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const LIBRARY = resolve(option('--library', '/tmp/cw-mt/pdf-library'));
const OUT_JSON = resolve(ROOT, option('--out', 'src/data/pdf-templates.json'));
const OUT_GEOMETRY = resolve(dirname(OUT_JSON), 'pdf-template-geometry.json');
const SVG_DIR = resolve(ROOT, 'public/cw-svgs');

async function loadModules() {
  const result = await build({
    stdin: {
      contents: `export * from './src/modules/cw-form-pdf/pdf-fingerprint';
export * from './src/modules/cw-form-pdf/pdf-template-match';
export { extractCwPageData } from './src/modules/cw-form-pdf/parse-cw-form';
export { buildTemplateGeometry } from './src/modules/cw-form-pdf/template-geometry';`,
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const tmp = join(ROOT, 'node_modules/.cache/pdf-registry-bundle.mjs');
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, result.outputFiles[0].text);
  return import(`${pathToFileURL(tmp).href}?t=${Date.now()}`);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** FNV-1a, 32 bit, base 36. */
function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const slug = s =>
  s
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

/** Folder an SVG or PDF belongs to: archived copies count as their parent folder. */
const groupOf = path => dirname(path).replace(/[\\/]Archive$/i, '');

function svgInfo(path, rel) {
  const text = readFileSync(path, 'utf8');
  const letters = new Set();
  for (const match of text.matchAll(/id="[mbc]([A-Z]\d{0,2})cm/g)) letters.add(match[1]);
  const labelIds = letters.size > 0;
  // Illustrator exports print the letters as text, sometimes "B" and "2" apart.
  const glyphs = [...text.matchAll(/<text[^>]*matrix\(1 0 0 1 ([\d.-]+) ([\d.-]+)\)[^>]*>([^<]*)/g)]
    .map(m => ({ x: +m[1], y: +m[2], s: m[3].trim() }))
    .filter(g => g.s);
  for (const g of glyphs) {
    if (
      /^[A-Z]\d{0,2}$/.test(g.s) &&
      !(
        g.s.length === 1 &&
        glyphs.some(d => /^\d$/.test(d.s) && Math.abs(d.y - g.y) < 2 && d.x > g.x && d.x - g.x < 25)
      )
    ) {
      letters.add(g.s);
    } else if (/^[A-Z]$/.test(g.s) || /^\d$/.test(g.s)) {
      if (/^[A-Z]$/.test(g.s)) {
        const digit = glyphs.find(
          d => /^\d$/.test(d.s) && Math.abs(d.y - g.y) < 2 && d.x > g.x && d.x - g.x < 25
        );
        if (digit) letters.add(`${g.s}${digit.s}`);
      }
    }
  }
  const base = rel
    .replace(/^.*[\\/]/, '')
    .replace(/\.svg$/i, '')
    .replace(/\s*\(\d+\)$/, '');
  let view = null;
  if (/^front[_-]/i.test(base)) view = 'front';
  else if (/^back[_-]/i.test(base)) view = 'back';
  else if (/-side$/i.test(base)) view = 'side';
  const code = base
    .replace(/^(front|back)[_-]/i, '')
    .replace(/-side$/i, '')
    .replace(/^-+/, '')
    .replace(/-1$/, '')
    .toUpperCase()
    .replace(/\s+/g, '-');
  return { path, rel, group: groupOf(rel), letters: [...letters].sort(), labelIds, view, code };
}

async function readPdf(mod, pdfjs, path, rel, fileName = rel) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(path)),
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const subject = String(meta?.info?.Subject || '');
  const pages = [];
  const geometries = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const data = await mod.extractCwPageData(page, pdfjs.OPS);
    const fp = mod.fingerprintPage(data, { fileName });
    pages.push(fp);
    geometries.push(mod.buildTemplateGeometry(data, fp.fieldMap));
    page.cleanup();
  }
  await doc.cleanup?.();
  await doc.loadingTask?.destroy?.();
  return { pages, subject, geometries };
}

const jaccard = (a, b) => {
  if (!a.length || !b.length) return 0;
  const s = new Set(b);
  const both = a.filter(x => s.has(x)).length;
  return both / new Set([...a, ...b]).size;
};

function pickSvg(template, svgs) {
  const sameFolder = svgs.filter(s => s.group === groupOf(template.source));
  const byCode = svgs.filter(s => template.modelCodes.includes(s.code));
  const pool = sameFolder.length ? sameFolder : byCode;
  if (!pool.length) return null;
  const ranked = pool
    .map(s => ({
      s,
      score:
        jaccard(template.letters, s.letters) +
        (s.view && template.views.includes(s.view) ? 1 : 0) +
        (template.modelCodes.includes(s.code) ? 0.25 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  // A folder with Front_/Back_ diagrams only fits pages of that view.
  if (
    best.s.view &&
    template.view &&
    !template.views.includes(best.s.view) &&
    sameFolder.length > 1
  )
    return null;
  if (
    best.s.letters.length &&
    template.letters.length &&
    jaccard(template.letters, best.s.letters) === 0
  )
    return null;
  return best.s;
}

async function buildRegistry(mod, pdfjs) {
  const files = walk(LIBRARY);
  const pdfs = files.filter(f => /\.pdf$/i.test(f));
  const svgs = files.filter(f => /\.svg$/i.test(f)).map(f => svgInfo(f, relative(LIBRARY, f)));
  const templates = [];
  const geometryOf = new Map();
  const failures = [];
  for (const path of pdfs) {
    const rel = relative(LIBRARY, path);
    try {
      const { pages, geometries } = await readPdf(mod, pdfjs, path, rel);
      for (const [index, fp] of pages.entries()) {
        const kind = mod.classifyTemplate(rel, fp);
        // Super-Template pages carry order details and photo boxes, not measurements.
        if (kind === 'super') {
          fp.view = 'photos';
          fp.views = ['photos'];
        }
        templates.push({
          id: `${slug(rel.replace(/\.pdf$/i, ''))}-p${fp.pageNumber}`,
          source: rel,
          page: fp.pageNumber,
          kind,
          modelCodes: fp.modelCodes,
          view: fp.view,
          views: fp.views,
          letters: fp.letters,
          layoutHashes: fp.layoutHashes,
          title: fp.title,
          width: fp.width,
          height: fp.height,
          fieldCount: fp.fieldCount,
          fieldNames: fp.fieldNames,
          lineHashes: fp.lineHashes,
          fieldMap: fp.fieldMap,
          svg: null,
          svgUrl: null,
          language: fp.language,
        });
        geometryOf.set(templates[templates.length - 1].id, geometries[index]);
      }
    } catch (error) {
      failures.push(`${rel}: ${error.message}`);
    }
  }

  // Sheets named after a shape ("MT-RollBack-Back") take the code of the coded sheet beside them;
  // model forms without a code in their name keep their file name as the code.
  for (const template of templates) {
    if (template.modelCodes.length) continue;
    const siblings = templates.filter(
      t => t !== template && groupOf(t.source) === groupOf(template.source) && t.modelCodes.length
    );
    const codes = [...new Set(siblings.flatMap(t => t.modelCodes))];
    if (template.kind === 'universal' && codes.length === 1) template.modelCodes = codes;
    else if (template.kind === 'model') {
      template.modelCodes = [
        slug(template.source.replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '')).toUpperCase(),
      ];
      template.codeFromFileName = true;
    }
  }

  // Codes for the copied SVGs come from the PDFs beside them when there is one.
  rmSync(SVG_DIR, { recursive: true, force: true });
  const used = new Map();
  for (const svg of svgs) {
    const neighbours = templates.filter(t => groupOf(t.source) === svg.group);
    const codes = [...new Set(neighbours.flatMap(t => t.modelCodes))];
    const code =
      codes.find(c => c === svg.code) ||
      codes.find(c => c.endsWith(`-${svg.code}`)) ||
      (codes.length === 1 ? codes[0] : svg.code);
    const match = neighbours
      .map(t => ({ t, score: jaccard(t.letters, svg.letters) }))
      .sort((a, b) => b.score - a.score)[0];
    const view = svg.view || match?.t.view || 'front';
    let target = `${slug(code).toUpperCase()}/${view}.svg`;
    for (let n = 2; used.has(target); n += 1)
      target = `${slug(code).toUpperCase()}/${view}-${n}.svg`;
    used.set(target, svg.rel);
    svg.publicUrl = `/cw-svgs/${target}`;
    svg.publicCode = code;
    svg.publicView = view;
    mkdirSync(dirname(join(SVG_DIR, target)), { recursive: true });
    copyFileSync(svg.path, join(SVG_DIR, target));
  }
  for (const template of templates) {
    const svg = pickSvg(template, svgs);
    if (svg) {
      template.svg = svg.rel;
      template.svgUrl = svg.publicUrl;
    }
  }

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  const svgIndex = svgs.map(s => ({
    url: s.publicUrl,
    source: s.rel,
    code: s.publicCode,
    view: s.publicView,
    letters: s.letters,
    labelIds: s.labelIds,
  }));
  writeFileSync(OUT_JSON, `${JSON.stringify({ version: 1, templates, svgs: svgIndex })}\n`);
  // Box and printed-word positions, shared by forms with the same layout; loaded only for
  // flattened and scanned PDFs.
  const shapes = {};
  const byTemplate = {};
  for (const template of templates) {
    const geometry = geometryOf.get(template.id);
    if (!geometry || (!geometry.cells.length && !geometry.anchors.length)) continue;
    const text = JSON.stringify(geometry);
    const key = hashText(text);
    shapes[key] = geometry;
    byTemplate[template.id] = key;
  }
  writeFileSync(OUT_GEOMETRY, `${JSON.stringify({ version: 1, shapes, byTemplate })}\n`);
  console.log(
    `Wrote ${templates.length} template pages from ${pdfs.length} PDFs to ${relative(ROOT, OUT_JSON)}; ${svgs.length} SVGs to ${relative(ROOT, SVG_DIR)}`
  );
  if (failures.length) console.log(`Could not read:\n  ${failures.join('\n  ')}`);
}

async function check(mod, pdfjs) {
  const registry = JSON.parse(readFileSync(OUT_JSON, 'utf8')).templates;
  const pdfs = walk(LIBRARY).filter(f => /\.pdf$/i.test(f));
  const rows = [];
  for (const path of pdfs) {
    const rel = relative(LIBRARY, path);
    let read;
    try {
      // Customers rename files, so identify from the content alone.
      read = await readPdf(mod, pdfjs, path, rel, flag('--with-names') ? rel : 'customer.pdf');
    } catch (error) {
      rows.push({
        file: rel,
        kind: 'error',
        codes: '',
        view: '',
        letters: 0,
        svg: 'no',
        confidence: 0,
        note: error.message,
      });
      continue;
    }
    const doc = mod.matchPdfDocument(read.pages, registry);
    const matches = read.pages.map((fp, i) => ({ fp, m: doc.pages[i] }));
    const best = matches[0]?.m.template;
    const rival = doc.rival;
    const note =
      doc.confidence < 0.8 && rival
        ? `close to ${rival.source} (${rival.score.toFixed(2)} vs ${doc.candidates[0].score.toFixed(2)})`
        : '';
    rows.push({
      file: rel,
      kind: best?.kind || 'other',
      codes: doc.modelCodes.join(' '),
      view: [...new Set(matches.map(x => x.m.template?.view).filter(Boolean))].join('/'),
      letters: new Set(matches.flatMap(x => x.m.template?.letters || [])).size,
      svg: matches.some(x => x.m.template?.svg) ? 'yes' : 'no',
      confidence: doc.confidence,
      note,
    });
  }
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  console.log(
    `${pad('file', 70)} ${pad('kind', 9)} ${pad('model codes', 26)} ${pad('view', 18)} ltr svg  conf  note`
  );
  for (const r of rows) {
    console.log(
      `${pad(r.file, 70)} ${pad(r.kind, 9)} ${pad(r.codes, 26)} ${pad(r.view, 18)} ${String(r.letters).padStart(3)} ${pad(r.svg, 4)} ${r.confidence.toFixed(2)}  ${r.note}`
    );
  }
  const high = rows.filter(r => r.confidence >= 0.8).length;
  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log(
    `\n${rows.length} PDFs: ${high} identify with confidence >= 0.8, ${rows.length - high} below; ` +
      `svg found for ${rows.filter(r => r.svg === 'yes').length}; kinds ${JSON.stringify(byKind)}`
  );
  if (flag('--json')) writeFileSync(option('--json', ''), JSON.stringify(rows, null, 1));
}

const mod = await loadModules();
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
if (!existsSync(LIBRARY)) {
  console.error(`Library not found: ${LIBRARY}`);
  process.exit(1);
}
if (flag('--check')) await check(mod, pdfjs);
else await buildRegistry(mod, pdfjs);
