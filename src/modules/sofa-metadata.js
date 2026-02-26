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
    measurementGuideCode: '',
    measurementGuideCodes: [],
    measurementGuideLibraryCodes: [],
    naming: {
      customerName: '',
      sofaTypeLabel: '',
      jobDate: '',
      extraLabel: '',
      autoProjectTitle: '',
      firstSavedAt: '',
    },
    measurementChecks: [],
    measurementConnections: [],
    measurementGuideCodesByView: {},
    measurementGuideLockByView: {},
    measurementGuideBindingsByScope: {},
    measurementGuideProjectDefaults: {
      codes: [],
      activeCode: '',
    },
    measurementGuideModelSelections: [],
    measurementGuideModelLinksByImage: {},
    tagColorTheme: null,
    pieceGroups: [],
    imagePartLabels: {},
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
  const measurementGuideCode =
    typeof source.measurementGuideCode === 'string' ? source.measurementGuideCode.trim() : '';
  const measurementGuideCodes = Array.isArray(source.measurementGuideCodes)
    ? source.measurementGuideCodes
        .map(code => (typeof code === 'string' ? code.trim().toUpperCase() : ''))
        .filter(Boolean)
    : measurementGuideCode
      ? [measurementGuideCode.toUpperCase()]
      : [];
  const measurementGuideLibraryCodes = Array.isArray(source.measurementGuideLibraryCodes)
    ? source.measurementGuideLibraryCodes
        .map(code => (typeof code === 'string' ? code.trim().toUpperCase() : ''))
        .filter(Boolean)
    : measurementGuideCodes;

  const measurementChecks = Array.isArray(source.measurementChecks)
    ? safeClone(source.measurementChecks, [])
    : [];
  const measurementConnections = Array.isArray(source.measurementConnections)
    ? safeClone(source.measurementConnections, [])
    : [];
  const measurementGuideCodesByView =
    source.measurementGuideCodesByView && typeof source.measurementGuideCodesByView === 'object'
      ? safeClone(source.measurementGuideCodesByView, {})
      : {};
  const measurementGuideLockByView =
    source.measurementGuideLockByView && typeof source.measurementGuideLockByView === 'object'
      ? safeClone(source.measurementGuideLockByView, {})
      : {};
  const measurementGuideBindingsByScope =
    source.measurementGuideBindingsByScope &&
    typeof source.measurementGuideBindingsByScope === 'object'
      ? safeClone(source.measurementGuideBindingsByScope, {})
      : {};
  const projectDefaultsSource =
    source.measurementGuideProjectDefaults &&
    typeof source.measurementGuideProjectDefaults === 'object'
      ? source.measurementGuideProjectDefaults
      : {};
  const measurementGuideProjectDefaults = {
    codes: Array.isArray(projectDefaultsSource.codes)
      ? projectDefaultsSource.codes
          .map(code => (typeof code === 'string' ? code.trim().toUpperCase() : ''))
          .filter(Boolean)
      : measurementGuideCodes,
    activeCode:
      typeof projectDefaultsSource.activeCode === 'string'
        ? projectDefaultsSource.activeCode.trim().toUpperCase()
        : measurementGuideCodes[0] || '',
  };
  const measurementGuideModelSelections = Array.isArray(source.measurementGuideModelSelections)
    ? source.measurementGuideModelSelections
        .map(item => {
          const value = item && typeof item === 'object' ? item : {};
          const code = typeof value.code === 'string' ? value.code.trim().toUpperCase() : '';
          const variantRaw =
            typeof value.variant === 'string' ? value.variant.trim().toLowerCase() : 'front';
          const variant =
            variantRaw === 'front' || variantRaw === 'back' || variantRaw === 'side'
              ? variantRaw
              : 'front';
          if (!code) return null;
          return {
            id:
              typeof value.id === 'string' && value.id.trim()
                ? value.id.trim()
                : `${code}::${variant}`,
            code,
            variant,
          };
        })
        .filter(Boolean)
    : [];
  const measurementGuideModelLinksByImage =
    source.measurementGuideModelLinksByImage &&
    typeof source.measurementGuideModelLinksByImage === 'object'
      ? Object.fromEntries(
          Object.entries(source.measurementGuideModelLinksByImage)
            .map(([imageId, selectionId]) => [
              String(imageId || '').trim(),
              String(selectionId || '').trim(),
            ])
            .filter(([imageId, selectionId]) => imageId && selectionId)
        )
      : {};
  const tagColorTheme =
    source.tagColorTheme && typeof source.tagColorTheme === 'object'
      ? {
          background:
            typeof source.tagColorTheme.background === 'string'
              ? source.tagColorTheme.background
              : null,
          border:
            typeof source.tagColorTheme.border === 'string' ? source.tagColorTheme.border : null,
          text: typeof source.tagColorTheme.text === 'string' ? source.tagColorTheme.text : null,
        }
      : null;
  const pieceGroups = Array.isArray(source.pieceGroups) ? safeClone(source.pieceGroups, []) : [];
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
          firstSavedAt:
            typeof source.naming.firstSavedAt === 'string' ? source.naming.firstSavedAt : '',
        }
      : defaults.naming;

  return {
    ...defaults,
    sofaType,
    customSofaType,
    measurementGuideCode,
    measurementGuideCodes,
    measurementGuideLibraryCodes,
    measurementChecks,
    measurementConnections,
    measurementGuideCodesByView,
    measurementGuideLockByView,
    measurementGuideBindingsByScope,
    measurementGuideProjectDefaults,
    measurementGuideModelSelections,
    measurementGuideModelLinksByImage,
    tagColorTheme,
    pieceGroups,
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
