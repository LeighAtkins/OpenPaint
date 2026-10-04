/**
 * Runtime-only presentation of a text annotation.
 *
 * Fabric does not serialise these properties, so they are applied both when a
 * note is created and when it is restored from a saved project. Keeping one
 * definition guarantees a reloaded note renders and selects exactly like a
 * freshly typed one.
 */
export const TEXT_ANNOTATION_RUNTIME_DEFAULTS = {
  borderColor: '#3b82f6',
  editingBorderColor: '#3b82f6',
  padding: 5,
  hoverCursor: 'text',
  // IText changes dimensions on every keystroke. Rendering it directly avoids
  // Safari reusing a stale Fabric cache that can clip the canvas beneath it.
  objectCaching: false,
  noScaleCache: false,
} as const;
