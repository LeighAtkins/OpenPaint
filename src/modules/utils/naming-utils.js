const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeFilenamePart(input, fallback = 'untitled') {
  const raw = String(input || '')
    .trim()
    .replace(INVALID_FILENAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim();
  return raw || fallback;
}

export function hasInvalidFilenameChars(input) {
  return INVALID_FILENAME_CHARS.test(String(input || ''));
}

export function composeProjectTitleParts({
  customerName = '',
  sofaTypeLabel = '',
  jobDate = '',
  extraLabel = '',
}) {
  return [customerName, sofaTypeLabel, jobDate, extraLabel]
    .map(part => String(part || '').trim())
    .filter(Boolean);
}

export function composeProjectTitle(parts, fallback = 'OpenPaint Project') {
  const list = Array.isArray(parts) ? parts : [];
  return list.length ? list.join(' - ') : fallback;
}

export function buildImageExportFilename(projectTitle, imageLabel, index = 0) {
  const safeProject = sanitizeFilenamePart(projectTitle, 'OpenPaint Project');
  const defaultLabel = `view-${String(index + 1).padStart(2, '0')}`;
  const safeImageLabel = sanitizeFilenamePart(imageLabel, defaultLabel);
  return `${safeProject} - ${safeImageLabel}`;
}
