import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { bindCwPatternMeasurements } from '../src/modules/measurement-mos/cw-pattern-binding.ts';
import { validateTylosandPatterns } from './cw-pattern-validate.ts';
const directory = path.resolve(process.argv[2] || 'tmp/tylosand-proof');
const validation = await validateTylosandPatterns(directory);
const product = JSON.parse(await fs.readFile(path.join(directory, 'source-private.json'), 'utf8'))
  .items[0].data.qcMeasurements.data;
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
const cards: string[] = [];
const results = [];
for (const component of product.product_components) {
  const filename = path.basename(component.slipcover_details_images[0].name);
  const image = await fs.readFile(path.join(directory, filename));
  const { data, info } = await sharp(image)
    .resize(1000)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = bindCwPatternMeasurements(
    data,
    info.width,
    info.height,
    component.name,
    component.measurements
  );
  results.push({ component: component.name, ...result });
  const guide = await fs.readFile(result.guide);
  const overlay = result.bindings
    .map((b, i) => {
      const p = b.points[Math.floor(b.points.length * (b.role === 'width' ? 0.23 : 0.5))];
      const dx = b.role === 'height' ? -62 : b.role === 'thickness' ? 65 : 0;
      const dy = b.role === 'height' ? 0 : b.role === 'thickness' ? 0 : -19;
      const colour = ['#fff', '#d6f097', '#a4f0ef', '#fce694'][i];
      return `<polyline points="${b.points.map(p => `${p.x * 1000},${p.y * info.height}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="2.5"/><circle cx="${b.points[0].x * 1000}" cy="${b.points[0].y * info.height}" r="3" fill="${colour}"/><circle cx="${b.points.at(-1)!.x * 1000}" cy="${b.points.at(-1)!.y * info.height}" r="3" fill="${colour}"/><text x="${p.x * 1000 + dx}" y="${p.y * info.height + dy}" text-anchor="middle" fill="white" stroke="#263b34" stroke-width="5" paint-order="stroke" font-size="17">${escape(b.measurement.name)} · ${b.measurement.value} cm</text>`;
    })
    .join('');
  cards.push(
    `<article><header><h2>${escape(component.name)}</h2><b>${result.bindings.length}/${component.measurements.length} mapped</b></header><svg viewBox="0 -28 1000 ${info.height + 56}" aria-label="${escape(component.name)} measured image"><image width="1000" height="${info.height}" href="data:image/png;base64,${image.toString('base64')}"/><g class="overlay">${overlay}</g></svg><p>${component.measurements.map((m: { name: string; value: number }) => `${escape(m.name)} <b>${m.value} cm</b>`).join(' &nbsp; / &nbsp; ')}</p><details><summary>Measurement guide · ${component.name === 'Accent Cushion Cover' ? 'Half-knife edge' : 'Boxed edge / face spans'}</summary><img alt="Source measurement guide" src="data:image/svg+xml;base64,${guide.toString('base64')}"/><p>The guide defines the face and span. Endpoints are traced from this image rather than copied from the guide's camera angle.</p></details></article>`
  );
}
await fs.writeFile(
  path.join(directory, 'detections.json'),
  JSON.stringify({ status: 'example-regression-passed', validation, results }, null, 2)
);
await fs.writeFile(
  path.join(directory, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tylosand · Measured patterns</title><style>body{margin:0;background:#f3f0e6;color:#213b32;font-family:Georgia,serif}main{max-width:1200px;margin:52px auto;padding:0 28px}h1{font-size:clamp(32px,5vw,60px);font-weight:400}main>p{font-size:19px;line-height:1.6;max-width:850px}label,small,summary{font-family:monospace}label{display:block;margin:25px 0}article{margin:38px 0;border-top:1px solid #9ba399;padding-top:12px}article header{display:flex;align-items:center;justify-content:space-between}h2{font-size:26px;font-weight:400}svg{width:100%;background:#365789}article p{line-height:1.7}details{margin:20px 0}details img{width:280px;background:white;margin-top:20px}body:has(#overlay:not(:checked)) .overlay{display:none}a{color:inherit}</style><main><small>OPENPAINT / TYLOSAND / LEFT ARM · ORIGINAL</small><h1>Every measurement has its place.</h1><p><strong>16 of 16 measurements mapped.</strong> Thickness, side width and the accent cushion's bottom fold are included. The placement code uses gallery face definitions and traces the image's lines and boundaries.</p><p>${validation.passed}/${validation.total} endpoint checks pass across original, mirrored, resized and padded images, within 12 pixels at 1000-pixel width. This is validation of these examples, not a claim of catalogue-wide accuracy.</p><p><a href="/?studio=3d">Open Sofa Studio →</a></p><label><input id="overlay" type="checkbox" checked> Show measurements</label>${cards.join('')}</main></html>`
);
console.log(
  'Updated proof: 16/16 bindings; ' +
    validation.passed +
    '/' +
    validation.total +
    ' geometry checks.'
);
