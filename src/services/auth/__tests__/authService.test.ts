import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../authService';

describe('AuthService', () => {
  it('does not block Supabase auth callback when user hydration is pending', () => {
    const service = new AuthService();
    const onAuthStateChange = vi.fn();
    const mockClient = {
      auth: {
        onAuthStateChange,
      },
    } as any;

    const pendingHydration = new Promise<void>(() => {});
    (service as any).setCurrentUser = vi.fn(() => pendingHydration);

    (service as any).setupAuthListener(mockClient);

    const authCallback = onAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: { user?: { id: string } } | null
    ) => unknown;

    const callbackReturn = authCallback('SIGNED_IN', { user: { id: 'user-1' } });

    expect(callbackReturn).toBeUndefined();
    expect((service as any).setCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('notifies listeners immediately on SIGNED_OUT', () => {
    const service = new AuthService();
    const onAuthStateChange = vi.fn();
    const mockClient = {
      auth: {
        onAuthStateChange,
      },
    } as any;
    const listener = vi.fn();

    service.onAuthStateChange(listener);
    (service as any).setupAuthListener(mockClient);
    const authCallback = onAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: null
    ) => unknown;

    const callbackReturn = authCallback('SIGNED_OUT', null);

    expect(callbackReturn).toBeUndefined();
    expect(listener).toHaveBeenCalledWith(null);
  });
});
