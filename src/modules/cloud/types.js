/**
 * Shared JSDoc typedefs for cloud operations.
 * This file intentionally exports nothing at runtime.
 */

/** @typedef {'save'|'load'|'list'|'delete'|'bootstrap'|'assets_exists'|'asset_upload'|'manifest_patch'|'view_patch'} CloudOperation */

/** @typedef {'ok'|'error'} CloudResultStatus */

/** @typedef {'auth_expired'|'auth_invalid'|'permission'|'conflict'|'not_found'|'validation'|'network'|'server'|'unknown'} CloudErrorCategory */

/**
 * @typedef {Object} CloudErrorInfo
 * @property {CloudErrorCategory} category
 * @property {number=} statusCode
 * @property {string=} code
 * @property {string} message
 * @property {string} userMessage
 * @property {boolean} retryable
 * @property {boolean} requiresRelogin
 * @property {Object<string, any>=} details
 */

/**
 * @typedef {Object} CloudOpResultBase
 * @property {CloudResultStatus} status
 * @property {CloudOperation} operation
 * @property {number=} statusCode
 * @property {string} requestId
 * @property {string} timestamp
 * @property {number=} durationMs
 */

/**
 * @typedef {CloudOpResultBase & {
 *   status: 'ok',
 *   data: any
 * }} CloudOpSuccess
 */

/**
 * @typedef {CloudOpResultBase & {
 *   status: 'error',
 *   error: CloudErrorInfo
 * }} CloudOpFailure
 */

/** @typedef {CloudOpSuccess | CloudOpFailure} CloudOpResult */

/** @typedef {'success'|'failed'|'not_attempted'} SaveStepStatus */

/**
 * @typedef {Object} SaveOutcome
 * @property {{
 *   status: SaveStepStatus,
 *   fileName?: string,
 *   bytes?: number,
 *   durationMs?: number,
 *   error?: string
 * }} local
 * @property {{
 *   attempted: boolean,
 *   status: SaveStepStatus,
 *   projectId?: string,
 *   manifestVersion?: number,
 *   syncedViewIds?: string[],
 *   uploadedAssetHashes?: string[],
 *   durationMs?: number,
 *   error?: CloudErrorInfo
 * }} cloud
 * @property {'save.combined.ok'|'save.combined.local_only'|'save.combined.fail'} finalMessageKey
 * @property {string} timestamp
 */

export {};
