import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { renderSvgPng } from '../src/modules/measurement-assistant/mcp/raster-preview';

const font = new Uint8Array(await readFile('dist/mcp-guides/preview-font.ttf'));
for (const [name, width, height] of [
  ['portrait', 1080, 2600],
  ['landscape', 1600, 900],
  ['wide', 4000, 300],
] as const) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height / 2}" fill="red"/><rect y="${height / 2}" width="${width}" height="${height / 2}" fill="blue"/></svg>`;
  const png = await renderSvgPng(svg, font, 1200);
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bottom = ((info.height - 1) * info.width + info.width - 1) * info.channels;
  if (
    info.width > 1200 ||
    info.height > 2400 ||
    Math.abs(info.height / info.width - height / width) > 0.01 ||
    data[0] !== 255 ||
    data[2] !== 0 ||
    data[bottom] !== 0 ||
    data[bottom + 2] !== 255
  )
    throw new Error(`${name}: cropped, distorted, blank or unbounded preview`);
  console.log(
    JSON.stringify({ name, width: info.width, height: info.height, cornersPreserved: true })
  );
}
let rejected = false;
try {
  await renderSvgPng(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="10000"><rect width="1" height="10000"/></svg>',
    font
  );
} catch {
  rejected = true;
}
if (!rejected) throw new Error('Unrenderable extreme aspect ratio was not rejected');
console.log('Raster budget rejection passed.');
