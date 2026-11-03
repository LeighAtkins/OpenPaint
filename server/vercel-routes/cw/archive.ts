import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readEncryptedArchiveFile } from './encrypted-storage.ts';
import { archiveImageResponse } from './image-response.ts';
import { isConfirmedArchiveAsset } from './asset-access.ts';
import { measurementCatalogue } from './search-catalogue.ts';
import { pid2VerifiedReferences } from './pid2-verified.ts';
import { archivedStyleAvailability } from './archive-availability.ts';

const assetPattern = /^[a-f0-9]{64}\.[a-zA-Z0-9]{1,10}$/;
const recordPattern = /^[a-f0-9]{64}\.json$/;
const markerOrigin = 'https://cw-archive.invalid';
let pendingIndex: { key: string; promise: Promise<any> } | undefined;
let cachedIndex:
  | { key: string; at: number; products: any[]; configs: any[]; tuples: any[] }
  | undefined;

export function isCwArchiveConfigured(): boolean {
  return Boolean(
    process.env.CW_ARCHIVE_DIR || process.env.CW_ARCHIVE_R2_BUCKET || process.env.CW_ARCHIVE_BUCKET
  );
}

async function readArchiveFile(relative: string): Promise<Buffer> {
  if (
    !/^(runtime-index\.json|measurement-tuples\.json|measurements\/[a-f0-9]{64}\.json|asset-maps\/[a-f0-9]{64}\.json|assets\/[a-f0-9]{64}\.[a-zA-Z0-9]{1,10})$/.test(
      relative
    )
  )
    throw new Error('Invalid archive path');
  if (process.env.CW_ARCHIVE_DIR)
    return fs.readFile(path.join(process.env.CW_ARCHIVE_DIR, relative));
  if (process.env.CW_ARCHIVE_R2_BUCKET) return readEncryptedArchiveFile(relative);
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.CW_ARCHIVE_BUCKET;
  if (!url || !key || !bucket) throw new Error('Private archive storage is not configured');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const info = await client.storage.getBucket(bucket);
  if (info.error || !info.data || info.data.public)
    throw new Error('Measurement storage must use a private bucket');
  const { data, error } = await client.storage.from(bucket).download(relative);
  if (error || !data) throw new Error('Archived file unavailable');
  return Buffer.from(await data.arrayBuffer());
}
async function json(relative: string): Promise<any> {
  return JSON.parse((await readArchiveFile(relative)).toString('utf8'));
}
async function index() {
  const key = [
    process.env.CW_ARCHIVE_DIR,
    process.env.CW_ARCHIVE_BUCKET,
    process.env.CW_ARCHIVE_R2_BUCKET,
    process.env.CW_ARCHIVE_R2_PREFIX,
    process.env.CW_ARCHIVE_ENCRYPTION_KEY,
  ].join('|');
  if (cachedIndex?.key === key && Date.now() - cachedIndex.at < 300000) return cachedIndex;
  if (pendingIndex?.key === key) return pendingIndex.promise;
  const promise = (async () => {
    const [runtime, tuples] = await Promise.all([
      json('runtime-index.json'),
      json('measurement-tuples.json'),
    ]);
    cachedIndex = {
      key,
      at: Date.now(),
      products: runtime.products,
      configs: runtime.configs,
      tuples,
    };
    return cachedIndex;
  })();
  pendingIndex = { key, promise };
  try {
    return await promise;
  } finally {
    if (pendingIndex?.promise === promise) pendingIndex = undefined;
  }
}

export function archivedAssetName(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    if (
      url.origin !== markerOrigin ||
      !url.pathname.startsWith('/assets/') ||
      url.search ||
      url.hash
    )
      return null;
    const name = url.pathname.slice('/assets/'.length);
    return assetPattern.test(name) ? name : null;
  } catch {
    return null;
  }
}
export function replaceArchivedImageUrls(value: any, assetMap: any[]): any {
  const mappings = new Map(
    assetMap
      .filter(item => item.localPath && !item.error)
      .map(item => [item.sourceKey, `${markerOrigin}/${item.localPath}`])
  );
  const urls = new Map(
    assetMap
      .filter(item => item.localPath && !item.error)
      .map(item => [item.sourceUrl, `${markerOrigin}/${item.localPath}`])
  );
  function walk(item: any): any {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== 'object')
      return typeof item === 'string' && urls.has(item) ? urls.get(item) : item;
    const result: any = Object.fromEntries(
      Object.entries(item).map(([key, child]) => [key, walk(child)])
    );
    if (typeof item.url === 'string' && /^https?:/.test(item.url)) {
      result.url = mappings.get(item.file_path) || urls.get(item.url) || null;
      if ('file_path' in result) result.file_path = null;
    }
    return result;
  }
  return walk(value);
}

/** Style key used by the availability list: the style code, or the style name when uncoded. */
export function archivedStyleKey(style: unknown, styleCode: unknown): string {
  const code = String(styleCode || '')
    .trim()
    .toUpperCase();
  return (
    code ||
    `STYLE:${String(style || '')
      .trim()
      .toUpperCase()}`
  );
}

export function countArchivedMeasurements(content: any): number {
  return (content?.product_components || []).reduce(
    (total: number, component: any) =>
      total +
      (component?.measurements || []).filter(
        (item: any) => item?.value !== null && item?.value !== undefined && item?.value !== ''
      ).length,
    0
  );
}

function isPid2Verified(reference: unknown): boolean {
  return pid2VerifiedReferences.has(String(reference || '').toUpperCase());
}

/** "Please select one" / "Default" entries the old editor kept as a blank first choice. */
function isPlaceholderVersion(option: any): boolean {
  return (
    option?.source === 'confirmed-archive' &&
    /^(DF|base)$/i.test(String(option?.code || '')) &&
    !isPid2Verified(option?.scopedReference)
  );
}

/**
 * Version options as staff should see them: pid2-verified versions confirmed, blank
 * placeholders dropped when real versions exist, and each option tagged with the
 * styles that actually hold measurements.
 */
export function presentArchivedVersionOptions(config: any): any[] {
  const options: any[] = Array.isArray(config?.versionOptions) ? config.versionOptions : [];
  const real = options.filter(option => !isPlaceholderVersion(option));
  return (real.length ? real : options).map(option => {
    const reference = String(option.scopedReference || '').toUpperCase();
    const verified = isPid2Verified(reference);
    const known = Object.prototype.hasOwnProperty.call(archivedStyleAvailability, reference);
    const availableStyleKeys = known ? archivedStyleAvailability[reference] : undefined;
    return {
      ...option,
      ...(verified ? { modelSetConfirmed: true, confirmed: true, verifiedOnPid2: true } : {}),
      ...(availableStyleKeys ? { availableStyleKeys } : {}),
      ...(availableStyleKeys && !availableStyleKeys.length ? { measurementsArchived: false } : {}),
    };
  });
}

function searchScore(product: any, query: string, words: string[]): number {
  const reference = String(product.reference || '').toLowerCase();
  const names = [
    product.name,
    ...(product.translations?.edges || []).map((edge: any) => edge.node?.name),
    ...(product.catalogueTitles || []),
  ]
    .filter(Boolean)
    .map((name: string) => name.toLowerCase());
  const haystack = `${reference} ${product.brand?.name || ''} ${names.join(' ')}`.toLowerCase();
  let score = 0;
  if (reference === query) score = 1000;
  else if (query.startsWith(`${reference}__`)) score = 800;
  else if (reference.startsWith(query) && query.length >= 3) score = 400;
  else if (words.every(word => haystack.includes(word))) {
    score = 100;
    // Whole-word hits in the English name rank above substring hits elsewhere.
    const english = String(product.name || '').toLowerCase();
    const wordHits = words.filter(word =>
      new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(english)
    ).length;
    score += wordHits * 10;
    if (english.startsWith(words[0])) score += 5;
  } else return 0;
  if (product.status === 'ENABLED') score += 50;
  return score;
}

export function searchArchivedProducts(products: any[], configs: any[], term: string) {
  const query = term.toLowerCase().trim();
  const words = query.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const configById = new Map(configs.map(config => [config.id, config]));
  return products
    .map(product => ({
      product,
      score: searchScore(product, query, words),
      config: configById.get(product.id),
    }))
    .filter(row => row.score)
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.product.name || '').length - String(b.product.name || '').length
    )
    .slice(0, 50)
    .map(({ product, config }) => {
      const versionOptions = presentArchivedVersionOptions(config);
      const shown = new Set(versionOptions.map(option => option.scopedReference));
      return {
        id: product.id,
        productReference: product.reference,
        productName:
          product.translations?.edges?.find((edge: any) => edge.node?.lang === 'en')?.node?.name ||
          product.name ||
          product.reference,
        status: product.status,
        styleOptions: config?.styleOptions || [],
        versionOptions,
        derivedScopedReferences: (config?.derivedScopedReferences || []).filter(
          (reference: string) =>
            shown.has(reference) ||
            !(config?.versionOptions || []).some(
              (option: any) => option.scopedReference === reference
            )
        ),
        configParsed: true,
        measurementsUnconfirmed: Boolean(
          (config?.hasVersionConfiguration &&
            !versionOptions.some(option => option.modelSetConfirmed === true)) ||
            (versionOptions.length &&
              versionOptions.every(option => option.modelSetConfirmed === false))
        ),
      };
    });
}

export function isArchivedModelUnconfirmed(config: any, reference: string): boolean {
  if (isPid2Verified(reference)) return false;
  if (!config) return true;
  const version = config?.versionOptions?.find(
    (option: any) => option.scopedReference?.toUpperCase() === reference.toUpperCase()
  );
  return (
    version?.modelSetConfirmed === false ||
    Boolean(config?.hasVersionConfiguration && version?.modelSetConfirmed !== true)
  );
}

export function isArchivedStyleMismatch(style: string, styleCode: string, content: any): boolean {
  const normalize = (value: unknown) =>
    String(value || '')
      .trim()
      .toUpperCase();
  return Boolean(
    (normalize(style) && normalize(style) !== normalize(content?.style_name)) ||
      (normalize(styleCode) && normalize(styleCode) !== normalize(content?.style_code))
  );
}

async function selectedItem(selection: any, archiveIndex: Awaited<ReturnType<typeof index>>) {
  const reference = String(selection.scopedReference || selection.productReference || '').trim();
  const styleCode = String(selection.styleCode || '').toUpperCase();
  const style = String(selection.style || '').toLowerCase();
  const tuple = archiveIndex.tuples.find(
    row =>
      row.reference.toUpperCase() === reference.toUpperCase() &&
      (styleCode ? row.styleCode.toUpperCase() === styleCode : row.style.toLowerCase() === style)
  );
  const basketItem = {
    ...selection,
    selectionKey:
      selection.selectionKey ||
      `${selection.productReference || reference}|${selection.versionCode || ''}|${selection.style || ''}|${selection.styleCode || ''}`,
  };
  const failure = (message: string, code = 'CW_ARCHIVED_MEASUREMENTS_NOT_FOUND') => ({
    success: false as const,
    selectionKey: basketItem.selectionKey,
    basketItem,
    code,
    message,
    data: { success: false, qcMeasurements: null, measurements: [], images: [] },
  });
  if (!tuple || !recordPattern.test(tuple.file))
    return failure('No archived measurements match this configuration and style.');
  const config = archiveIndex.configs.find(item => item.id === tuple.productId);
  if (isArchivedModelUnconfirmed(config, reference))
    return failure(
      'This model is marked unconfirmed. Confirmed measurements are not available.',
      'CW_MODEL_MEASUREMENTS_UNCONFIRMED'
    );
  let record: any;
  try {
    record = await json(`measurements/${tuple.file}`);
  } catch {
    return failure('This measurement record has not been archived.');
  }
  if (record.httpStatus !== 200 || Number(record.data?.status) !== 200)
    return failure(
      'The original measurement service did not provide measurements for this selection.'
    );
  if (isArchivedStyleMismatch(tuple.style, tuple.styleCode, record.data.content))
    return failure(
      'The source returned a different style code. These measurements require review.',
      'CW_ARCHIVED_STYLE_MISMATCH'
    );
  if (!countArchivedMeasurements(record.data.content))
    return failure(
      'No measurements were recorded for this configuration and style. Choose another size or style.',
      'CW_ARCHIVED_MEASUREMENTS_EMPTY'
    );
  let assetMap: any[] = [];
  try {
    assetMap = await json(`asset-maps/${tuple.file}`);
  } catch {
    /* measurement values are still usable */
  }
  const content = replaceArchivedImageUrls(record.data.content, assetMap);
  const images = assetMap
    .filter(item => item.localPath && !item.error)
    .map(item => `${markerOrigin}/${item.localPath}`);
  return {
    success: true as const,
    message: null,
    selectionKey: basketItem.selectionKey,
    basketItem,
    code: 'CW_ARCHIVED_MEASUREMENTS_READY',
    product: { reference, name: selection.productName },
    data: {
      success: true,
      source: 'private-archive',
      product: { reference, name: selection.productName },
      qcMeasurements: { data: content },
      measurements: content.product_components || [],
      images,
    },
  };
}

/** Called only after requireStaffOrRespond has authenticated the request. */
export async function handleCwArchiveRequest(req: any, res: any, body: any): Promise<boolean> {
  if (!isCwArchiveConfigured()) return false;
  const formId = String(req.query?.formId || '');
  const phase = String(body?.phase || '');
  if (
    formId === 'search' &&
    ['storefront-product', 'storefront-comparison', 'sectional-pricing'].includes(phase)
  )
    return false;
  // Only product lookup and its images come from the archive. Other CW routes keep
  // their own handling.
  if (formId !== 'search' && formId !== 'image-proxy') return false;
  try {
    if (formId === 'image-proxy') {
      for (const candidate of Array.isArray(body.candidates) ? body.candidates : []) {
        const name = archivedAssetName(candidate);
        if (!name || !isConfirmedArchiveAsset(name)) continue;
        const bytes = await readArchiveFile(`assets/${name}`);
        const ext = name.split('.').at(-1)?.toLowerCase();
        const mime =
          (
            {
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              webp: 'image/webp',
              gif: 'image/gif',
              svg: 'image/svg+xml',
              pdf: 'application/pdf',
            } as Record<string, string>
          )[ext || ''] || 'application/octet-stream';
        res.status(200).json(await archiveImageResponse(bytes, mime));
        return true;
      }
      res.status(404).json({
        success: false,
        code: 'CW_ARCHIVED_IMAGE_NOT_FOUND',
        message: 'No archived image matched.',
      });
      return true;
    }
    if (phase === 'catalogue-index') {
      res.status(200).json({ success: true, ...measurementCatalogue });
      return true;
    }
    const archiveIndex = await index();
    if (['load-selected', 'load-selected-details'].includes(phase)) {
      const selections = Array.isArray(body.selectedItems) ? body.selectedItems.slice(0, 50) : [];
      if (!selections.length) {
        res
          .status(400)
          .json({ success: false, message: 'Select a product configuration and style.' });
        return true;
      }
      const items = await Promise.all(
        selections.map((item: any) => selectedItem(item, archiveIndex))
      );
      const loadedCount = items.filter(item => item.success).length;
      res.status(200).json({
        success: loadedCount > 0,
        phase: 'load-selected',
        source: 'private-archive',
        items,
        summary: {
          selectedCount: items.length,
          loadedCount,
          failedCount: items.length - loadedCount,
        },
      });
    } else if (phase === 'public-measurements') {
      const item = await selectedItem(
        { ...body, productReference: body.productReference || body.search },
        archiveIndex
      );
      res.status(item.success ? 200 : 404).json({
        success: item.success,
        source: 'private-archive',
        ...(item.success
          ? {
              measurements: {
                width: (item as any).data.qcMeasurements.data.width || null,
                depth: (item as any).data.qcMeasurements.data.depth || null,
                height: (item as any).data.qcMeasurements.data.height || null,
              },
              productReference: item.product.reference,
              style: String(body.style || ''),
              styleCode: String(body.styleCode || ''),
            }
          : { message: item.message }),
      });
    } else {
      const results = searchArchivedProducts(
        archiveIndex.products,
        archiveIndex.configs,
        String(body.search || body.query || '')
      );
      res.status(200).json({
        success: true,
        phase: 'discover',
        source: 'private-archive',
        results,
        summary: { resultCount: results.length },
      });
    }
  } catch {
    res.status(503).json({
      success: false,
      code: 'CW_ARCHIVE_UNAVAILABLE',
      message: 'The private measurement archive is currently unavailable.',
    });
  }
  return true;
}
