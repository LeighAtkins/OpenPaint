const knownCodes = new Set([
  'AccessDenied',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'NoSuchBucket',
  'InvalidArgument',
  'InvalidRequest',
  'BadDigest',
  'NotImplemented',
  'NetworkingError',
  'TimeoutError',
  'CredentialsProviderError',
]);

/** SDK messages and request objects can contain secrets. Expose fixed codes only. */
export function safeArchiveStorageError(error: unknown) {
  const candidate = error as any;
  const code = knownCodes.has(candidate?.name) ? candidate.name : 'StorageError';
  const status = candidate?.$metadata?.httpStatusCode;
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const hints: Record<string, string> = {
    AccessDenied:
      'Check that the upload token has Object Read & Write permission for cw-measurement-archive.',
    InvalidAccessKeyId: 'Use the upload token Access Key ID, not Token Value.',
    SignatureDoesNotMatch:
      'Copy the Access Key ID and Secret Access Key from the same upload token.',
    NoSuchBucket: 'Check the bucket name and Cloudflare account.',
    BadDigest: 'The upload checksum was rejected.',
    NotImplemented: 'Cloudflare rejected an unsupported storage request option.',
  };
  return {
    code,
    httpStatus,
    hint: hints[code] || 'Share this error code with Codex; do not share keys.',
  };
}
