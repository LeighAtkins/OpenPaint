const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<Uint8Array> {
  if (!body) throw new Error('Empty response body.');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Payload exceeds allowed size.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export function readImageDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
  mimeType: string;
} {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0,
    mimeType = '';
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  ) {
    width = data.getUint32(16);
    height = data.getUint32(20);
    mimeType = 'image/png';
  } else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) continue;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      ) {
        height = data.getUint16(offset + 3);
        width = data.getUint16(offset + 5);
        mimeType = 'image/jpeg';
        break;
      }
      offset += length;
    }
  } else if (
    bytes.length >= 30 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  ) {
    const kind = new TextDecoder().decode(bytes.slice(12, 16));
    if (kind === 'VP8X') {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = data.getUint16(26, true) & 16383;
      height = data.getUint16(28, true) & 16383;
    } else if (kind === 'VP8L' && bytes[20] === 47) {
      const bits = data.getUint32(21, true);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    }
    mimeType = 'image/webp';
  }
  if (!width || !height || width * height > 80000000)
    throw new Error('Expected a JPEG, PNG, or WebP image within the pixel limit.');
  return { width, height, mimeType };
}
export function validateImageUrl(
  raw: string,
  allowedHosts: string[],
  localDevelopment = false
): URL {
  const url = new URL(raw);
  const local = localDevelopment && ['127.0.0.1', 'localhost'].includes(url.hostname);
  const allowed = allowedHosts.some(
    host => url.hostname === host || url.hostname.endsWith(`.${host}`)
  );
  if (
    url.username ||
    url.password ||
    (url.port && !local) ||
    (!local && (url.protocol !== 'https:' || !allowed)) ||
    (local && !['http:', 'https:'].includes(url.protocol))
  )
    throw new Error(`File host is not approved for image handoff (${url.hostname}).`);
  return url;
}
export async function downloadInputImage(url: URL, fetcher: typeof fetch = fetch) {
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES)
    throw new Error('Image download failed or image exceeds 20 MB.');
  const bytes = await readBoundedBody(response.body, MAX_IMAGE_BYTES);
  return { bytes, ...readImageDimensions(bytes) };
}
