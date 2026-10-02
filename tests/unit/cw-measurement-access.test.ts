import { describe, expect, it, vi } from 'vitest';
import {
  checkCwMeasurementAccess,
  isVerifiedComfortWorksUser,
} from '../../server/vercel-routes/cw/access';

describe('CW measurement access', () => {
  it('requires a verified exact company email domain', () => {
    expect(
      isVerifiedComfortWorksUser({
        email: 'Leigh@COMFORT-WORKS.COM',
        email_confirmed_at: '2026-09-29',
      })
    ).toBe(true);
    for (const email of [
      'leigh@gmail.com',
      'leigh@comfort-works.com.attacker.example',
      'leigh@sub.comfort-works.com',
      'leigh@comfort-works.com ',
      'leigh@@comfort-works.com',
    ]) {
      expect(isVerifiedComfortWorksUser({ email, email_confirmed_at: '2026-09-29' })).toBe(false);
    }
    expect(isVerifiedComfortWorksUser({ email: 'leigh@comfort-works.com' })).toBe(false);
  });
  it('denies anonymous requests before contacting auth', async () => {
    const validate = vi.fn();
    expect(await checkCwMeasurementAccess(undefined, validate)).toMatchObject({
      allowed: false,
      status: 401,
    });
    expect(validate).not.toHaveBeenCalled();
  });
  it('validates the bearer token and denies invalid or external accounts', async () => {
    expect(await checkCwMeasurementAccess('Bearer invalid', async () => null)).toMatchObject({
      allowed: false,
      status: 401,
    });
    expect(
      await checkCwMeasurementAccess('Bearer valid', async () => ({
        email: 'someone@gmail.com',
        email_confirmed_at: 'date',
      }))
    ).toMatchObject({ allowed: false, status: 403 });
    const validate = vi.fn(async () => ({
      email: 'staff@comfort-works.com',
      email_confirmed_at: 'date',
    }));
    expect(await checkCwMeasurementAccess('Bearer valid', validate)).toEqual({ allowed: true });
    expect(validate).toHaveBeenCalledWith('valid');
  });
  it('fails closed when authentication is unavailable', async () => {
    expect(
      await checkCwMeasurementAccess('Bearer valid', async () => {
        throw new Error('Offline');
      })
    ).toMatchObject({ allowed: false, status: 503 });
  });
});
