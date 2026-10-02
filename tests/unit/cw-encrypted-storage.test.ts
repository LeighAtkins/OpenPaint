import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import {
  archiveEncryptionKey,
  decryptArchiveObject,
  encryptArchiveObject,
} from '../../server/vercel-routes/cw/encrypted-storage';
import { archiveImageResponse } from '../../server/vercel-routes/cw/image-response';

describe('Hosted measurement archive', () => {
  const key = randomBytes(32);
  const objectKey = 'private/cw-measurements/2026-09-29/runtime-index.json';
  const bytes = Buffer.from(JSON.stringify({ measurements: [1, 2, 3] }));
  it('round-trips compressed records and binary assets without exposing plaintext', () => {
    for (const name of [objectKey, objectKey.replace('.json', '.png')]) {
      const encrypted = encryptArchiveObject(bytes, name, key);
      expect(encrypted.includes(bytes)).toBe(false);
      expect(decryptArchiveObject(encrypted, name, key)).toEqual(bytes);
      expect(encryptArchiveObject(bytes, name, key)).not.toEqual(encrypted);
    }
  });
  it('rejects different paths, different keys, tampering, and unencrypted files', () => {
    const encrypted = encryptArchiveObject(bytes, objectKey, key);
    expect(() => decryptArchiveObject(encrypted, `${objectKey}.other`, key)).toThrow();
    expect(() => decryptArchiveObject(encrypted, objectKey, randomBytes(32))).toThrow();
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptArchiveObject(tampered, objectKey, key)).toThrow();
    expect(() => decryptArchiveObject(bytes, objectKey, key)).toThrow();
    expect(() => archiveEncryptionKey('')).toThrow();
    expect(() => archiveEncryptionKey('abc')).toThrow();
  });
  it('fits large diagrams inside Vercel JSON limits while preserving the original', async () => {
    const original = await sharp({
      create: { width: 1200, height: 1200, channels: 3, background: '#fff' },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(original.length).toBeGreaterThan(3_000_000);
    const response = await archiveImageResponse(original, 'image/png');
    expect(response.contentType).toBe('image/webp');
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(4_500_000);
    expect((await sharp(original).metadata()).format).toBe('png');
    const small = await archiveImageResponse(Buffer.from('small'), 'image/png');
    expect(small.byteLength).toBe(5);
  });
});
