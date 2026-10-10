import { describe, expect, it } from 'vitest';
import {
  getCwCredentials,
  isCwSessionUrl,
  resolveCwBaseUrl,
  resolveCwPidBaseUrl,
} from '../../server/vercel-routes/cw/shared.js';

describe('CW base URL allowlist', () => {
  it('defaults to the configured CW hosts', () => {
    expect(resolveCwBaseUrl('')).toBe('https://cw40.comfort-works.com');
    expect(resolveCwPidBaseUrl(undefined)).toBe('https://cw-pid-qylyewlgca-uc.a.run.app');
  });

  it('accepts the CW host with a trailing path', () => {
    expect(resolveCwBaseUrl('https://cw40.comfort-works.com/')).toBe(
      'https://cw40.comfort-works.com'
    );
  });

  it('rejects other hosts so env credentials never leave CW', () => {
    expect(() => resolveCwBaseUrl('https://evil.example')).toThrow(/not an allowed CW host/);
    expect(() => resolveCwPidBaseUrl('https://evil.example')).toThrow(/not an allowed CW host/);
    expect(() => getCwCredentials({ baseUrl: 'https://evil.example' })).toThrow();
  });

  it('only treats CW-origin URLs as session URLs', () => {
    const session = { baseUrl: 'https://cw40.comfort-works.com' };
    expect(isCwSessionUrl(session, 'https://cw40.comfort-works.com/media/a.png')).toBe(true);
    expect(isCwSessionUrl(session, 'https://evil.example/a.png')).toBe(false);
  });
});
