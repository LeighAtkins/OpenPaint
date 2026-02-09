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
    measurementChecks: [],
    measurementConnections: [],
    imagePartLabels: {},
    photos: [],
    quickSketchMap: null,
  };
}

function migrateConnections(rawConnections) {
  if (!Array.isArray(rawConnections) || !rawConnections.length) return [];
  // Old format used fromKey/toKey (per-measurement, e.g. "viewId:strokeLabel").
  // New format uses fromViewId/toViewId (per-image).
  const hasOldFormat = rawConnections.some(c => c.fromKey && !c.fromViewId);
  if (!hasOldFormat) return rawConnections;

  const seen = new Set();
  const migrated = [];
  rawConnections.forEach(c => {
    const fromViewId = String(c.fromKey || '').split(':')[0];
    const toViewId = String(c.toKey || '').split(':')[0];
    if (!fromViewId || !toViewId || fromViewId === toViewId) return;
    const pairKey = [fromViewId, toViewId].sort().join('|');
    if (seen.has(pairKey)) return;
    seen.add(pairKey);
    migrated.push({
      id: c.id || `conn-${Date.now()}-${migrated.length}`,
      fromViewId,
      toViewId,
      note: c.note || '',
    });
  });
  return migrated;
}

export function normalizeSofaMetadata(input) {
  const defaults = createDefaultSofaMetadata();
  const source = input && typeof input === 'object' ? input : {};

  const rawSofaType = typeof source.sofaType === 'string' ? source.sofaType : null;
  const sofaType = SOFA_TYPES.includes(rawSofaType || '') ? rawSofaType : null;

  const customSofaType =
    typeof source.customSofaType === 'string' ? source.customSofaType.trim() : '';

  const measurementChecks = Array.isArray(source.measurementChecks)
    ? safeClone(source.measurementChecks, [])
    : [];
  const rawConnections = Array.isArray(source.measurementConnections)
    ? safeClone(source.measurementConnections, [])
    : [];
  const measurementConnections = migrateConnections(rawConnections);
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

  return {
    ...defaults,
    sofaType,
    customSofaType,
    measurementChecks,
    measurementConnections,
    imagePartLabels,
    naming,
    photos,
    quickSketchMap: source.quickSketchMap ? safeClone(source.quickSketchMap, null) : null,
  };
}

export function mergeSofaMetadata(current, patch) {
  const base = normalizeSofaMetadata(current);
  const updates = patch && typeof patch === 'object' ? patch : {};
  return normalizeSofaMetadata({ ...base, ...updates });
}
