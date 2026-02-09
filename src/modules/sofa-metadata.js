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
    naming: {
      customerName: '',
      sofaTypeLabel: '',
      jobDate: '',
      extraLabel: '',
      autoProjectTitle: '',
    },
    pieceCount: 0,
    pieces: [],
    connections: [],
    measurementChecks: [],
    measurementConnections: [],
    imagePartLabels: {},
    ruleParams: {},
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
  const measurementChecks = Array.isArray(source.measurementChecks)
    ? safeClone(source.measurementChecks, [])
    : [];
  const measurementConnections = Array.isArray(source.measurementConnections)
    ? safeClone(source.measurementConnections, [])
    : [];
  const photos = Array.isArray(source.photos) ? safeClone(source.photos, []) : [];
  const imagePartLabels =
    source.imagePartLabels && typeof source.imagePartLabels === 'object'
      ? safeClone(source.imagePartLabels, {})
      : {};
  const naming =
    source.naming && typeof source.naming === 'object'
      ? {
          customerName:
            typeof source.naming.customerName === 'string' ? source.naming.customerName : '',
          sofaTypeLabel:
            typeof source.naming.sofaTypeLabel === 'string' ? source.naming.sofaTypeLabel : '',
          jobDate: typeof source.naming.jobDate === 'string' ? source.naming.jobDate : '',
          extraLabel: typeof source.naming.extraLabel === 'string' ? source.naming.extraLabel : '',
          autoProjectTitle:
            typeof source.naming.autoProjectTitle === 'string'
              ? source.naming.autoProjectTitle
              : '',
        }
      : defaults.naming;
  const ruleParams =
    source.ruleParams && typeof source.ruleParams === 'object'
      ? safeClone(source.ruleParams, {})
      : {};

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
    measurementChecks,
    measurementConnections,
    imagePartLabels,
    naming,
    ruleParams,
    photos,
    quickSketchMap: source.quickSketchMap ? safeClone(source.quickSketchMap, null) : null,
  };
}

export function mergeSofaMetadata(current, patch) {
  const base = normalizeSofaMetadata(current);
  const updates = patch && typeof patch === 'object' ? patch : {};
  return normalizeSofaMetadata({ ...base, ...updates });
}
