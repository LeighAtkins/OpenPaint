import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser = null;
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () =>
        currentUser ? { data: { user: currentUser }, error: null } : { data: {}, error: {} },
    },
  }),
}));

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
const { requireStaffUser } = await import('../../server/supabase-auth.js');

const req = { headers: { authorization: 'Bearer token' } };

describe('requireStaffUser', () => {
  beforeEach(() => {
    currentUser = null;
  });

  it('accepts a confirmed comfort-works.com account', async () => {
    currentUser = { email: 'Leigh@Comfort-Works.com', email_confirmed_at: '2026-01-01' };
    await expect(requireStaffUser(req)).resolves.toBe(currentUser);
  });

  it('rejects other domains, look-alike domains, and unconfirmed emails', async () => {
    for (const user of [
      { email: 'someone@gmail.com', email_confirmed_at: '2026-01-01' },
      { email: 'x@evilcomfort-works.com', email_confirmed_at: '2026-01-01' },
      { email: 'x@comfort-works.com.evil.io', email_confirmed_at: '2026-01-01' },
      { email: 'x@comfort-works.com', email_confirmed_at: null },
    ]) {
      currentUser = user;
      await expect(requireStaffUser(req)).rejects.toMatchObject({ status: 403 });
    }
  });

  it('requires a token', async () => {
    await expect(requireStaffUser({ headers: {} })).rejects.toMatchObject({ status: 401 });
  });
});
