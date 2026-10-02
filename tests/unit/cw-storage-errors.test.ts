import { describe, expect, it } from 'vitest';
import { safeArchiveStorageError } from '../../server/vercel-routes/cw/storage-errors';

describe('Private storage diagnostics', () => {
  it('reports useful fixed error codes without exposing request credentials', () => {
    const result = safeArchiveStorageError({
      name: 'AccessDenied',
      message: 'SECRET KEY IN MESSAGE',
      request: { authorization: 'SECRET KEY IN REQUEST' },
      $metadata: { httpStatusCode: 403 },
    });
    expect(result.code).toBe('AccessDenied');
    expect(result.httpStatus).toBe(403);
    expect(result.hint).toContain('Object Read & Write');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('does not echo arbitrary SDK names, messages, or malformed metadata', () => {
    const result = safeArchiveStorageError({
      name: 'SECRET-NAME',
      message: 'SECRET-MESSAGE',
      $metadata: { httpStatusCode: 'SECRET-STATUS' },
    });
    expect(result.code).toBe('StorageError');
    expect(result.httpStatus).toBeNull();
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
