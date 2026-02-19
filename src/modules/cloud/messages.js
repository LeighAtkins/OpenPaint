export const CLOUD_COPY = {
  save: {
    localSuccess: 'Local file saved (.opaint).',
    localFailed: 'Local save failed. Your project was not downloaded.',
    cloudSkippedLoggedOut: 'Cloud sync not attempted: you are not logged in.',
    cloudSkippedDisabled: 'Cloud sync not attempted: cloud is unavailable.',
    cloudSuccess: 'Cloud sync complete.',
    cloudAuthExpired: 'Cloud sync failed: session expired. Please sign in again.',
    cloudAuthInvalid: 'Cloud sync failed: invalid login session. Please sign in again.',
    cloudPermission: 'Cloud sync failed: you do not have permission for this project.',
    cloudConflict: 'Cloud sync conflict: project changed elsewhere. Reload and retry.',
    cloudNetwork: 'Cloud sync failed: network error.',
    cloudServer: 'Cloud sync failed: server error.',
    cloudUnknown: 'Cloud sync failed: unexpected error.',
    combinedOk: 'Saved locally and synced to cloud.',
    combinedLocalOnly: 'Saved locally. Cloud sync did not complete.',
    combinedFail: 'Save failed.',
  },
  auth: {
    loggedOut: 'Logged out',
    loggedIn: email => `Logged in as ${email}`,
    expired: 'Session expired - sign in again',
    checking: 'Checking session...',
  },
  cloudBadge: {
    ready: 'Cloud: Ready',
    syncing: 'Cloud: Syncing...',
    error: 'Cloud: Error',
    offline: 'Cloud: Offline',
  },
};

export const SAVE_MESSAGE_KEYS = {
  ok: 'save.combined.ok',
  localOnly: 'save.combined.local_only',
  fail: 'save.combined.fail',
};

export function getSaveMessageByKey(key) {
  if (key === SAVE_MESSAGE_KEYS.ok) return CLOUD_COPY.save.combinedOk;
  if (key === SAVE_MESSAGE_KEYS.localOnly) return CLOUD_COPY.save.combinedLocalOnly;
  return CLOUD_COPY.save.combinedFail;
}
