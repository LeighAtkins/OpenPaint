import { describe, expect, it, vi } from 'vitest';
import { authService } from '../../src/services/auth/authService';
import { getCwMeasurementIdentity, getCwRequestHeaders } from '../../src/services/auth/cwAccess';

vi.mock('../../src/services/auth/authService', () => ({
  authService: { getCurrentSession: vi.fn(), getCurrentUser: vi.fn() },
}));

describe('CW Sofapaint sessions', () => {
  it('sends the current Sofapaint token and omits authorization without a session', async () => {
    vi.mocked(authService.getCurrentSession).mockResolvedValueOnce({
      success: true,
      data: { access_token: 'current-sofapaint-token' },
    } as any);
    expect(await getCwRequestHeaders()).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer current-sofapaint-token',
    });
    vi.mocked(authService.getCurrentSession).mockResolvedValueOnce({
      success: true,
      data: null,
    } as any);
    expect(await getCwRequestHeaders()).toEqual({ 'Content-Type': 'application/json' });
  });

  it('invalidates in-flight library responses after logout or an email change on the same account', () => {
    const user = {
      id: 'same-user',
      email: 'leigh@comfort-works.com',
      emailConfirmed: true,
      createdAt: '',
    };
    const previous = getCwMeasurementIdentity(user);
    expect(getCwMeasurementIdentity(null)).not.toBe(previous);
    expect(getCwMeasurementIdentity({ ...user, email: 'leigh@example.com' })).not.toBe(previous);
    expect(getCwMeasurementIdentity({ ...user, emailConfirmed: false })).not.toBe(previous);
    expect(getCwMeasurementIdentity({ ...user, email: 'LEIGH@COMFORT-WORKS.COM' })).toBe(previous);
  });
});
