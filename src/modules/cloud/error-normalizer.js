import { CLOUD_COPY } from './messages.js';

const AUTH_EXPIRED_CODES = new Set(['jwt_expired', 'refresh_token_not_found']);
const AUTH_INVALID_CODES = new Set(['invalid_jwt']);

function containsAny(haystack, needles) {
  return needles.some(token => haystack.includes(token));
}

/**
 * Normalize cloud errors into one consistent shape.
 *
 * @param {{
 *   statusCode?: number,
 *   code?: string,
 *   message?: string,
 *   name?: string,
 *   details?: Record<string, any>
 * }} raw
 */
export function normalizeCloudError(raw = {}) {
  const statusCode = raw.statusCode;
  const code = String(raw.code || '').toLowerCase();
  const message = String(raw.message || 'Unknown cloud error');
  const lower = message.toLowerCase();

  if (statusCode === 401 || AUTH_EXPIRED_CODES.has(code)) {
    return {
      category: 'auth_expired',
      statusCode,
      code: raw.code,
      message,
      userMessage: CLOUD_COPY.save.cloudAuthExpired,
      retryable: false,
      requiresRelogin: true,
      details: raw.details,
    };
  }

  if (AUTH_INVALID_CODES.has(code)) {
    return {
      category: 'auth_invalid',
      statusCode,
      code: raw.code,
      message,
      userMessage: CLOUD_COPY.save.cloudAuthInvalid,
      retryable: false,
      requiresRelogin: true,
      details: raw.details,
    };
  }

  if (
    statusCode === 403 ||
    containsAny(lower, ['forbidden', 'not authorized', 'not authorised', 'permission'])
  ) {
    return {
      category: 'permission',
      statusCode,
      code: raw.code,
      message,
      userMessage: CLOUD_COPY.save.cloudPermission,
      retryable: false,
      requiresRelogin: false,
      details: raw.details,
    };
  }

  if (statusCode === 404 || containsAny(lower, ['not found', 'no rows'])) {
    return {
      category: 'not_found',
      statusCode,
      code: raw.code,
      message,
      userMessage: 'Cloud project not found.',
      retryable: false,
      requiresRelogin: false,
      details: raw.details,
    };
  }

  if (statusCode === 409 || containsAny(lower, ['conflict', 'version mismatch', 'stale'])) {
    return {
      category: 'conflict',
      statusCode,
      code: raw.code,
      message,
      userMessage: CLOUD_COPY.save.cloudConflict,
      retryable: true,
      requiresRelogin: false,
      details: raw.details,
    };
  }

  if (
    raw.name === 'TypeError' ||
    containsAny(lower, ['failed to fetch', 'network error', 'network request failed'])
  ) {
    return {
      category: 'network',
      statusCode,
      code: raw.code,
      message,
      userMessage: CLOUD_COPY.save.cloudNetwork,
      retryable: true,
      requiresRelogin: false,
      details: raw.details,
    };
  }

  if (typeof statusCode === 'number' && statusCode >= 500) {
    return {
      category: 'server',
      statusCode,
      code: raw.code,
      message,
      userMessage: CLOUD_COPY.save.cloudServer,
      retryable: true,
      requiresRelogin: false,
      details: raw.details,
    };
  }

  return {
    category: 'unknown',
    statusCode,
    code: raw.code,
    message,
    userMessage: CLOUD_COPY.save.cloudUnknown,
    retryable: true,
    requiresRelogin: false,
    details: raw.details,
  };
}
