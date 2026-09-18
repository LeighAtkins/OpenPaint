#!/usr/bin/env node
/**
 * Renders sofa3d models through the REAL SofaRenderer in headless Chrome and
 * saves multi-view evidence + a comparison contact sheet per model.
 *
 *   node tools/cw-catalog/render-models.cjs <modelId> [moreIds...]
 *
 * Requires: system Chrome (channel:'chrome'). Starts `vite` dev server itself.
 * Writes to data/comfort-works/sofa3d-build/evidence/renders/<id>/.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'data/comfort-works/sofa3d-build/evidence/renders');
const PORT = 5199;
const VIEWS = ['perspective', 'front', 'side', 'back', 'top'];

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('usage: render-models.cjs <modelId> [moreIds...]');
  process.exit(1);
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await wait(500);
  }
  throw new Error('vite dev server did not start');
}

(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  try {
    await waitForServer(`http://localhost:${PORT}/tools/cw-catalog/render-page.html`);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1420, height: 800 } });
    await page.goto(`http://localhost:${PORT}/tools/cw-catalog/render-page.html`, {
      waitUntil: 'load',
    });
    await wait(1200);

    for (const id of ids) {
      const dirId = id.split(':')[0];
      const dir = path.join(OUT, dirId);
      fs.mkdirSync(dir, { recursive: true });
      const coverPath = path.join(dir, 'cover.jpg');
      // cover: fetch product image server-side to avoid canvas taint.
      // `modelId:SKU` form picks the queue job providing the cover image.
      const [, sku] = id.split(':');
      let coverUrl = null;
      try {
        const queue = JSON.parse(
          fs.readFileSync(path.join(ROOT, 'data/comfort-works/sofa3d-build/queue.json'), 'utf8')
        );
        const job = queue.jobs.find(
          j => j.configurationId === sku || j.sourceReference === sku
        );
        if (job && job.image) {
          const res = await fetch(job.image);
          if (res.ok) {
            fs.writeFileSync(coverPath, Buffer.from(await res.arrayBuffer()));
            coverUrl = `/data/comfort-works/sofa3d-build/evidence/renders/${id.split(':')[0]}/cover.jpg`;
          }
        }
      } catch {}

      const meta = await page.evaluate(async modelId => {
        return window.__sofa.load(modelId, window.__coverUrl || null);
      }, id.split(':')[0]).catch(e => ({ error: String(e) }));
      if (meta.error) {
        console.error(`${id}: load failed — ${meta.error}`);
        continue;
      }
      await page.evaluate(coverUrl => {
        window.__coverUrl = coverUrl;
      }, coverUrl);

      const views = {};
      const stats = {};
      for (const view of VIEWS) {
        await page.evaluate(v => window.__sofa.view(v), view);
        await wait(350);
        const dataUrl = await page.evaluate(() => {
          const gl = document.querySelector('#host canvas');
          return gl.toDataURL('image/png');
        });
        const png = Buffer.from(dataUrl.split(',')[1], 'base64');
        fs.writeFileSync(path.join(dir, `${view}.png`), png);
        stats[view] = await page.evaluate(() => window.__sofa.canvasStats());
        views[view] = dataUrl;
      }

      const sheetDataUrl = await page.evaluate(
        m => window.__sofa.composeSheet(m),
        { id, title: meta.title, declared: [meta.width, meta.depth, meta.height], coverUrl, views }
      );
      fs.writeFileSync(
        path.join(dir, 'sheet.png'),
        Buffer.from(sheetDataUrl.split(',')[1], 'base64')
      );

      const report = {
        id,
        title: meta.title,
        declared: { width: meta.width, depth: meta.depth, height: meta.height },
        pixelChecks: Object.fromEntries(
          Object.entries(stats).map(([v, s]) => [
            v,
            { occupancy: Number(s.occupancy.toFixed(3)), nonEmpty: s.occupancy > 0.01 },
          ])
        ),
        views: VIEWS,
        renderedAt: new Date().toISOString(),
        renderer: 'SofaRenderer (real) via system Chrome',
      };
      fs.writeFileSync(path.join(dir, 'render-report.json'), JSON.stringify(report, null, 1));
      const allVisible = Object.values(report.pixelChecks).every(p => p.nonEmpty);
      console.log(`${id}: ${allVisible ? 'OK' : 'SUSPECT'} — ${JSON.stringify(report.pixelChecks)}`);
    }
    await browser.close();
  } finally {
    try {
      process.kill(-vite.pid);
    } catch {}
  }
})();
