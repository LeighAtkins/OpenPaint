import { describe, expect, it, vi } from 'vitest';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '99999999-8888-7777-6666-555555555555';

vi.mock('../../server/supabase-auth.js', () => {
  class AuthError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  return {
    AuthError,
    requireRequestUser: async req => {
      if (req.headers?.authorization !== 'Bearer good')
        throw new AuthError(401, 'Sign in required');
      return { id: USER_ID };
    },
  };
});

const {
  authorizeR2Read,
  authorizeR2Upload,
  authorizeR2Write,
  getR2ErrorStatus,
  getSafeObjectHeaders,
} = await import('../../server/r2-access.js');

const anonymousReq = { headers: {} };
const signedInReq = { headers: { authorization: 'Bearer good' } };

async function statusOf(promise) {
  try {
    await promise;
    return 200;
  } catch (error) {
    return getR2ErrorStatus(error);
  }
}

describe('R2 access policy', () => {
  it('rejects every operation without a signed-in user', async () => {
    const key = `${USER_ID}/views/front/1.png`;
    expect(await statusOf(authorizeR2Upload(anonymousReq, key, 'image/png'))).toBe(401);
    expect(await statusOf(authorizeR2Read(anonymousReq, key))).toBe(401);
    expect(await statusOf(authorizeR2Read(anonymousReq, 'projects/views/front/1.png'))).toBe(401);
    expect(await statusOf(authorizeR2Write(anonymousReq, key))).toBe(401);
  });

  it('only lets users upload and delete under their own prefix', async () => {
    await expect(
      authorizeR2Upload(signedInReq, `${USER_ID}/views/front/1.png`, 'image/png')
    ).resolves.toEqual({ key: `${USER_ID}/views/front/1.png`, contentType: 'image/png' });
    expect(
      await statusOf(authorizeR2Upload(signedInReq, `${OTHER_ID}/views/front/1.png`, 'image/png'))
    ).toBe(403);
    expect(await statusOf(authorizeR2Write(signedInReq, 'projects/views/front/1.png'))).toBe(403);
  });

  it('rejects non-image uploads, including SVG and HTML', async () => {
    const key = `${USER_ID}/x/p.html`;
    expect(await statusOf(authorizeR2Upload(signedInReq, key, 'text/html'))).toBe(400);
    expect(await statusOf(authorizeR2Upload(signedInReq, key, 'image/svg+xml'))).toBe(400);
  });

  it('lets signed-in users read user images and legacy view images only', async () => {
    await expect(authorizeR2Read(signedInReq, `${OTHER_ID}/views/a.png`)).resolves.toBe(
      `${OTHER_ID}/views/a.png`
    );
    await expect(authorizeR2Read(signedInReq, 'projects/views/front/1.png')).resolves.toBe(
      'projects/views/front/1.png'
    );
    expect(await statusOf(authorizeR2Read(signedInReq, 'cw-line-library/v1.json'))).toBe(403);
    expect(await statusOf(authorizeR2Read(signedInReq, '../secret'))).toBe(400);
  });

  it('never serves stored non-image content inline', () => {
    expect(getSafeObjectHeaders('text/html')).toMatchObject({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(getSafeObjectHeaders('image/png; charset=binary')).toMatchObject({
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    });
  });
});
