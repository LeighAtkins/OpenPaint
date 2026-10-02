import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import { Buffer } from 'node:buffer';

// Only immutable renderer initialization is shared; photos and results remain request-local.
const ready = initWasm(wasm);
export interface PreviewRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function cropSvg(svg: string, region: PreviewRegion): string {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  const box = root
    ?.match(/viewBox=["']([^"']+)["']/i)?.[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!root || !box || box.length !== 4 || !box.every(Number.isFinite))
    throw new Error('Preview requires a valid SVG viewBox.');
  if (
    region.width <= 0 ||
    region.height <= 0 ||
    region.x < 0 ||
    region.y < 0 ||
    region.x + region.width > 1 ||
    region.y + region.height > 1
  )
    throw new Error('Crop must stay within the original image.');
  const width = box[2] * region.width;
  const height = box[3] * region.height;
  const clean = root.replace(/\s(?:width|height|viewBox)=["'][^"']*["']/gi, '');
  return svg.replace(
    root,
    clean.replace(
      />$/,
      ` width="${width}" height="${height}" viewBox="${box[0] + box[2] * region.x} ${box[1] + box[3] * region.y} ${width} ${height}">`
    )
  );
}
export async function renderSvgPng(
  svg: string,
  font: Uint8Array,
  width = 1200
): Promise<Uint8Array> {
  await ready;
  const renderer = new Resvg(svg, {
    font: { fontBuffers: [font], defaultFontFamily: 'Roboto', sansSerifFamily: 'Roboto' },
    background: 'white',
    fitTo: { mode: 'width', value: Math.max(1, Math.min(1200, Math.round(width))) },
  });
  try {
    if (renderer.height / renderer.width > 2 || renderer.height / renderer.width < 0.15)
      throw new Error('Preview aspect ratio is outside the supported range.');
    const rendered = renderer.render();
    try {
      return rendered.asPng().slice();
    } finally {
      rendered.free();
    }
  } finally {
    renderer.free();
  }
}
export function bytesToBase64(bytes: Uint8Array): string {
  // Native encoding avoids copying photo bytes through large JavaScript strings.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}
