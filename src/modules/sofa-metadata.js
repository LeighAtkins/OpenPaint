const SOFA_TYPES = [
  'two_seater',
  'three_seater',
  'sectional_l_shape',
  'armchair',
  'sofa_bed',
  'custom',
];

function safeClone(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export function createDefaultSofaMetadata() {
  return {
    version: 1,
    sofaType: null,
    customSofaType: '',
    pieceCount: 0,
    pieces: [],
    connections: [],
    photos: [],
    quickSketchMap: null,
  };
}

export function normalizeSofaMetadata(input) {
  const defaults = createDefaultSofaMetadata();
  const source = input && typeof input === 'object' ? input : {};

  const rawSofaType = typeof source.sofaType === 'string' ? source.sofaType : null;
  const sofaType = SOFA_TYPES.includes(rawSofaType || '') ? rawSofaType : null;

  const customSofaType =
    typeof source.customSofaType === 'string' ? source.customSofaType.trim() : '';

  const pieces = Array.isArray(source.pieces) ? safeClone(source.pieces, []) : [];
  const connections = Array.isArray(source.connections) ? safeClone(source.connections, []) : [];
  const photos = Array.isArray(source.photos) ? safeClone(source.photos, []) : [];

  const derivedPieceCount = pieces.length;
  const pieceCountInput =
    typeof source.pieceCount === 'number' && Number.isFinite(source.pieceCount)
      ? Math.max(0, Math.floor(source.pieceCount))
      : derivedPieceCount;
  const pieceCount = Math.max(pieceCountInput, derivedPieceCount);

  return {
    ...defaults,
    sofaType,
    customSofaType,
    pieceCount,
    pieces,
    connections,
    photos,
    quickSketchMap: source.quickSketchMap ? safeClone(source.quickSketchMap, null) : null,
  };
}

export function mergeSofaMetadata(current, patch) {
  const base = normalizeSofaMetadata(current);
  const updates = patch && typeof patch === 'object' ? patch : {};
  return normalizeSofaMetadata({ ...base, ...updates });
}
