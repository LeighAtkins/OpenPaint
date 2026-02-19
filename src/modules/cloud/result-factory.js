import { SAVE_MESSAGE_KEYS } from './messages.js';

function makeRequestId(operation) {
  return `${operation}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {'save'|'load'|'list'|'delete'|'bootstrap'|'assets_exists'|'asset_upload'|'manifest_patch'|'view_patch'} operation
 * @param {any} data
 * @param {{statusCode?: number, requestId?: string, startedAt?: number}} [meta]
 */
export function makeCloudSuccess(operation, data, meta = {}) {
  return {
    status: 'ok',
    operation,
    statusCode: meta.statusCode,
    requestId: meta.requestId || makeRequestId(operation),
    timestamp: new Date().toISOString(),
    durationMs: typeof meta.startedAt === 'number' ? Date.now() - meta.startedAt : undefined,
    data,
  };
}

/**
 * @param {'save'|'load'|'list'|'delete'|'bootstrap'|'assets_exists'|'asset_upload'|'manifest_patch'|'view_patch'} operation
 * @param {any} error
 * @param {{statusCode?: number, requestId?: string, startedAt?: number}} [meta]
 */
export function makeCloudFailure(operation, error, meta = {}) {
  return {
    status: 'error',
    operation,
    statusCode: meta.statusCode ?? error?.statusCode,
    requestId: meta.requestId || makeRequestId(operation),
    timestamp: new Date().toISOString(),
    durationMs: typeof meta.startedAt === 'number' ? Date.now() - meta.startedAt : undefined,
    error,
  };
}

/**
 * @param {import('./types.js').SaveOutcome} outcome
 */
export function decideFinalSaveMessageKey(outcome) {
  if (outcome.local.status !== 'success') return SAVE_MESSAGE_KEYS.fail;
  if (outcome.cloud.attempted && outcome.cloud.status === 'success') return SAVE_MESSAGE_KEYS.ok;
  return SAVE_MESSAGE_KEYS.localOnly;
}

/**
 * @param {import('./types.js').SaveOutcome} outcome
 */
export function formatSaveOutcomeLines(outcome) {
  const localLine =
    outcome.local.status === 'success'
      ? 'Local Save: Success'
      : `Local Save: Failed${outcome.local.error ? ` (${outcome.local.error})` : ''}`;

  let cloudLine = 'Cloud Sync: Not attempted';
  if (outcome.cloud.attempted && outcome.cloud.status === 'success') {
    cloudLine = 'Cloud Sync: Success';
  } else if (outcome.cloud.attempted && outcome.cloud.status === 'failed') {
    cloudLine = `Cloud Sync: Failed (${outcome.cloud.error?.userMessage || 'Unexpected error'})`;
  }

  return `${localLine}\n${cloudLine}`;
}
