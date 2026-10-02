import { z } from 'zod';
import { readBoundedBody, readImageDimensions } from './image-input';
import { escapeXml } from '../svg-preview';

const point = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
export const maskEvidenceSchema = z.object({
  schema: z.literal('sofapaint-masks-v1'),
  coordinateSystem: z.literal('normalized-full-photo'),
  image: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  model: z.object({
    id: z.string().min(1).max(120),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    classes: z.array(z.string().max(50)).length(5),
  }),
  instances: z
    .array(
      z.object({
        id: z.string().regex(/^mask_\d+$/),
        classId: z.number().int().min(0).max(4),
        label: z.enum([
          'physical_left_arm',
          'physical_right_arm',
          'seat_cushions',
          'back_and_base',
          'sofa_back',
        ]),
        confidence: z.number().finite().min(0.25).max(1),
        areaPixels: z.number().int().positive(),
        bbox: z.tuple([
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().positive().max(1),
          z.number().positive().max(1),
        ]),
        rings: z
          .array(z.object({ hole: z.boolean(), points: z.array(point).min(3).max(20000) }))
          .max(2000),
        bitmap: z.object({
          order: z.literal('row-major'),
          counts: z.array(z.number().int().nonnegative()).min(1).max(200000),
        }),
      })
    )
    .max(100),
  warnings: z.array(z.string().max(500)).max(20),
});
export type MaskEvidence = z.infer<typeof maskEvidenceSchema>;
export const MASK_CLASSES = [
  'physical_left_arm',
  'physical_right_arm',
  'seat_cushions',
  'back_and_base',
  'sofa_back',
];
export const MASK_INSTRUCTIONS =
  'Use these masks as proposals for physical parts and visible outer boundaries. Inspect the original photo and seams before placing measurements. Keep physical left/right labels; never swap them by screen position. The merged back_and_base mask is body evidence, not a distinction between front base and rear exterior. seat_cushions does not prove all loose cushions were found. Holes and disconnected islands belong to their original instance. Do not use mask extrema as automatic seam landmarks, infer hidden surfaces, or invent dimension values.';
interface MaskConfig {
  url?: string;
  token?: string;
  modelSha256?: string;
  local?: boolean;
}

function serviceUrl(config: MaskConfig): URL {
  if (!config.url || !config.token || !config.modelSha256)
    throw new Error('The masking service is not configured for this deployment.');
  const url = new URL(config.url);
  const local = config.local && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!local && url.protocol !== 'https:') ||
    (local && !['http:', 'https:'].includes(url.protocol))
  )
    throw new Error('Expected a private HTTPS masking endpoint.');
  return url;
}

export async function normalizeMaskInput(
  bytes: Uint8Array,
  config: MaskConfig,
  fetcher: typeof fetch = fetch
) {
  const url = serviceUrl(config);
  url.pathname = url.pathname.replace(/\/segment\/?$/, '/normalize');
  if (!url.pathname.endsWith('/normalize')) throw new Error('Mask endpoint must end in /segment.');
  const response = await fetcher(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: bytes as BodyInit,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Photo orientation normalization failed (${response.status}).`);
  const normalized = await readBoundedBody(response.body, 20 * 1024 * 1024);
  const dimensions = readImageDimensions(normalized);
  if (dimensions.width * dimensions.height > 12000000)
    throw new Error('Masking supports photos up to 12 megapixels.');
  return { bytes: normalized, ...dimensions };
}

export async function fetchMaskEvidence(
  bytes: Uint8Array,
  image: { width: number; height: number },
  config: MaskConfig,
  fetcher: typeof fetch = fetch
): Promise<MaskEvidence> {
  const url = serviceUrl(config);
  const response = await fetcher(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: bytes as BodyInit,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(
      `Masking service failed (${response.status}); original-photo drawing remains available.`
    );
  const raw = JSON.parse(
    new TextDecoder().decode(await readBoundedBody(response.body, 4 * 1024 * 1024))
  );
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const inputSha = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  return validateMaskEvidence(raw, { ...image, sha256: inputSha }, config.modelSha256!);
}

/** Cache hits must satisfy the same photo/model/bitmap checks as fresh predictions. */
export function validateMaskEvidence(
  raw: unknown,
  image: { width: number; height: number; sha256: string },
  modelSha256: string
): MaskEvidence {
  const evidence = maskEvidenceSchema.parse(raw);
  if (
    evidence.image.width !== image.width ||
    evidence.image.height !== image.height ||
    evidence.image.sha256 !== image.sha256 ||
    image.width * image.height > 12000000
  )
    throw new Error('Mask evidence does not match this original photo and coordinate system.');
  if (
    evidence.model.sha256 !== modelSha256 ||
    JSON.stringify(evidence.model.classes) !== JSON.stringify(MASK_CLASSES)
  )
    throw new Error('Mask evidence came from an unexpected checkpoint or class schema.');
  const ids = new Set<string>();
  for (const instance of evidence.instances) {
    const pixels = image.width * image.height;
    const area = instance.bitmap.counts.reduce((total, n, index) => total + (index % 2 ? n : 0), 0);
    const [x, y, w, h] = instance.bbox;
    if (
      ids.has(instance.id) ||
      instance.label !== MASK_CLASSES[instance.classId] ||
      instance.bitmap.counts.reduce((sum, n) => sum + n, 0) !== pixels ||
      area !== instance.areaPixels ||
      x + w > 1.000001 ||
      y + h > 1.000001 ||
      instance.rings.reduce((n, ring) => n + ring.points.length, 0) > 20000
    )
      throw new Error('Malformed mask identity, bounds or bitmap evidence.');
    ids.add(instance.id);
  }
  return evidence;
}

export function renderMaskOverlay(evidence: MaskEvidence, photoUrl: string): string {
  const { width, height } = evidence.image;
  const colors = ['#ff264f', '#50ff00', '#008cff', '#ffe600', '#ff00ed'];
  const labels = ['Left arm', 'Right arm', 'Seat cushion', 'Merged body', 'Sofa back'];
  const layers = evidence.instances
    .map(instance => {
      const path = instance.rings
        .map(
          ring =>
            ring.points
              .map(
                ([x, y], i) =>
                  `${i ? 'L' : 'M'}${(x * width).toFixed(2)},${(y * height).toFixed(2)}`
              )
              .join(' ') + ' Z'
        )
        .join(' ');
      const [x, y] = instance.bbox;
      const size = Math.max(14, Math.min(width, height) / 45);
      const label = `${instance.id.replace('mask_', '#')} ${labels[instance.classId]} ${Math.round(instance.confidence * 100)}%`;
      const labelX = Math.max(0, Math.min(x * width, width - label.length * size * 0.65));
      const labelY = Math.min(height - size / 3, Math.max(size, y * height));
      return `<path d="${path}" fill="${colors[instance.classId]}" fill-opacity=".4" fill-rule="evenodd" stroke="${colors[instance.classId]}" stroke-width="${Math.max(1, width / 600)}"/><text x="${labelX}" y="${labelY}" font-family="Roboto, sans-serif" font-size="${size}" fill="white" stroke="black" stroke-width="${size / 12}" paint-order="stroke">${escapeXml(label)}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${escapeXml(photoUrl)}" width="${width}" height="${height}"/>${layers}</svg>`;
}
