import sharp from 'sharp';

/** Keep base64 JSON beneath Vercel's 4.5 MB response limit; originals remain intact. */
export async function archiveImageResponse(bytes: Buffer, mime: string) {
  let output = bytes;
  let contentType = mime;
  if (bytes.length > 3_000_000 && mime.startsWith('image/')) {
    output = await sharp(bytes)
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    contentType = 'image/webp';
  }
  if (output.length > 3_000_000) throw new Error('Archived image exceeds the response limit');
  return {
    success: true,
    url: `data:${contentType};base64,${output.toString('base64')}`,
    byteLength: output.length,
    contentType,
  };
}
