#!/usr/bin/env node
/**
 * Sources PB York assembled dimensions (W/D/H) for every configuration through
 * the local OpenPaint CW relay, which handles OMS session + PID QC lookups.
 *
 *   node tools/cw-catalog/source-york.cjs
 *
 * Writes evidence/oms/<ref>.json and specs/<ref>.json (frozen, tier-1).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BUILD = path.join(ROOT, 'data/comfort-works/sofa3d-build');
const PORT = 3000;

const REFS = [
  'PB-YRA-63', 'PB-YRA-83',
  'PB-YDRA-62', 'PB-YDRA-97',
  'PB-YSLA-60', 'PB-YSLA-81-2C', // 95 covered by existing pb-york-slope-95-* presets
  'PB-YDSA-60', 'PB-YDSA-80', 'PB-YDSA-95',
  'PB-YSA-81-1C', 'PB-YSA-81-2C', 'PB-YSA-96',
  'PB-YSAD-44X', 'PB-YSAD-54M', 'PB-YSAD-81', 'PB-YSAD-94',
];

async function relay(body) {
  const res = await fetch(`http://localhost:${PORT}/api/integrations/cw/measurements/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ search: body.search, ...body }),
  });
  return res.json();
}

(async () => {
  fs.mkdirSync(path.join(BUILD, 'evidence/oms'), { recursive: true });
  const out = {};
  for (const ref of REFS) {
    let record = { reference: ref };
    try {
      const pub = await relay({ phase: 'public-measurements', productReference: ref });
      record.public = {
        ok: Boolean(pub?.success),
        code: pub?.code,
        measurements: pub?.measurements,
        scopedReference: pub?.productReference,
        style: pub?.style,
        styleCode: pub?.styleCode,
      };
      if (!pub?.success) {
        // authenticated fallback: discover then QC-load
        const disc = await relay({ phase: 'discover', search: ref });
        const node =
          disc?.nodes?.find(n => (n.reference || '').toUpperCase().startsWith(ref)) ||
          disc?.nodes?.[0] || null;
        record.discover = { ok: Boolean(disc?.success), nodeCount: disc?.nodes?.length ?? 0, node };
        if (node) {
          const loaded = await relay({
            phase: 'load-selected',
            selectedItems: [
              {
                productReference: node.reference || ref,
                productName: node.name || ref,
                versionCode: '',
                versionLabel: '',
                scopedReference: node.scopedReference || node.reference || ref,
                style: node.style || '',
                styleCode: node.styleCode || '',
              },
            ],
          });
          const r = loaded?.results?.[0];
          record.qc = {
            ok: Boolean(r?.success),
            code: r?.code,
            message: r?.message,
            qc: r?.data?.qcMeasurements?.data
              ? {
                  width: r.data.qcMeasurements.data.width,
                  depth: r.data.qcMeasurements.data.depth,
                  height: r.data.qcMeasurements.data.height,
                }
              : null,
            components: (r?.data?.measurements || []).map(c => ({
              name: c.name,
              quantity: c.quantity,
              measurements: c.measurements,
            })),
          };
        }
      }
    } catch (e) {
      record.error = String(e.message || e);
    }
    out[ref] = record;
    fs.writeFileSync(
      path.join(BUILD, 'evidence/oms', `${ref}.json`),
      JSON.stringify(record, null, 1)
    );
    const m = record.public?.measurements || record.qc?.qc;
    console.log(
      ref.padEnd(14),
      m ? `W ${m.width?.cm ?? m.width} × D ${m.depth?.cm ?? m.depth} × H ${m.height?.cm ?? m.height}` : `MISSING (${record.public?.code || record.qc?.code || record.error || '?'})`
    );
    await new Promise(r => setTimeout(r, 1200));
  }
  fs.writeFileSync(path.join(BUILD, 'evidence/oms/york-sourced.json'), JSON.stringify(out, null, 1));
})();
