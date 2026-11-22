import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  overallModel,
  overallProtocol,
  overallPrompt,
  parseOverallPlacement,
} from '../../../src/modules/catalogue/overall-dimensions.ts';
import { selectCatalogueStyle } from '../../../src/modules/catalogue/product-selection.ts';

const cache = new Map<string, { at: number; result: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const daily = new Map<string, number>();
export async function catalogueProduct(item: { productReference: string; codes?: string[] }) {
  if (!/^[A-Z0-9-]+(?:__[A-Z0-9_-]+)*$/.test(item.productReference || ''))
    throw Error('Invalid product reference.');
  const response = await fetch(
    'https://measure.comfort-works.com/api/public-all-options-product-measurements/?format=json&product_reference=' +
      encodeURIComponent(item.productReference),
    { signal: AbortSignal.timeout(12000) }
  );
  if (!response.ok) throw Error('Catalogue measurements are unavailable.');
  return selectCatalogueStyle(item, await response.json());
}
export function cataloguePhotoUrl(value: unknown): string {
  if (typeof value !== 'string') throw Error('A verified catalogue photo is required.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !['img.comfort-works.com', 'cdn.shopify.com'].includes(url.hostname) ||
    !/\.(webp|png|jpe?g)(?:$|\?)/i.test(url.pathname + url.search)
  )
    throw Error('Only catalogue product photographs are supported.');
  return url.href;
}
async function infer(imageUrl: string) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const token = process.env.SOFAPAINT_AI_TOKEN_FILE
    ? (await readFile(process.env.SOFAPAINT_AI_TOKEN_FILE, 'utf8')).trim()
    : process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw Error('Qwen catalogue placement is not configured on this server.');
  const imageResponse = await fetch(imageUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!imageResponse.ok || Number(imageResponse.headers.get('content-length')) > 8 * 1024 * 1024)
    throw Error('Catalogue image could not be loaded.');
  const reader = imageResponse.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8 * 1024 * 1024) {
      await reader.cancel();
      throw Error('Catalogue photo exceeds 8 MB.');
    }
    chunks.push(value);
  }
  const original = Buffer.concat(chunks);
  const image = await sharp(original, { limitInputPixels: 40000000 })
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const day = new Date().toISOString().slice(0, 10),
    limit = Number(process.env.CATALOGUE_AI_DAILY_LIMIT || 12);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw Error('Catalogue Qwen daily limit must be between 1 and 500.');
  if ((daily.get(day) || 0) >= limit) throw Error('Catalogue Qwen daily allowance reached.');
  for (const key of daily.keys()) if (key !== day) daily.delete(key);
  daily.set(day, (daily.get(day) || 0) + 1);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1/chat/completions`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: overallModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: overallPrompt() },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,' + image.data.toString('base64') },
              },
            ],
          },
        ],
        temperature: 0,
        reasoning_effort: 'low',
        max_completion_tokens: 5000,
        stream: false,
      }),
    }
  );
  if (!response.ok) throw Error(`Qwen placement failed (HTTP ${response.status}).`);
  const raw: any = await response.json();
  if (raw.choices?.[0]?.finish_reason === 'length')
    throw Error('Qwen reached its response limit. No drawing was applied; try this photo again.');
  const text = raw.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw Error('Qwen returned no placement answer.');
  const placement = parseOverallPlacement(
    JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
    )
  );
  return {
    placement,
    model: overallModel,
    protocol: overallProtocol,
    imageUrl,
    imageSha256: createHash('sha256').update(original).digest('hex'),
    imageSize: { width: image.info.width, height: image.info.height },
    usage: raw.usage || null,
    generatedAt: new Date().toISOString(),
    reviewRequired: true,
  };
}
export async function placeCatalogueDimensions(input: { imageUrl: string }) {
  const url = cataloguePhotoUrl(input.imageUrl),
    key = overallProtocol + ':' + url;
  const stored = cache.get(key);
  if (stored && Date.now() - stored.at < 86400000) return stored.result;
  if (pending.has(key)) return pending.get(key);
  const task = infer(url)
    .then(result => {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
