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

function normalizeTagTheme(theme) {
  if (!theme || typeof theme !== 'object') return null;
  const background = typeof theme.background === 'string' ? theme.background : null;
  const border = typeof theme.border === 'string' ? theme.border : null;
  const text = typeof theme.text === 'string' ? theme.text : null;
  return background && border && text ? { background, border, text } : null;
}

function createDefaultTagStyleConfig() {
  return {
    presets: {
      lettersOnly: null,
      lettersNumbers: null,
      highlight: null,
    },
    perTagThemes: {},
    highlightedTagKeys: [],
  };
}

function normalizeTagStyleConfig(input) {
  const source = input && typeof input === 'object' ? input : {};
  const presetsSource = source.presets && typeof source.presets === 'object' ? source.presets : {};
  const highlightedTagKeys = Array.isArray(source.highlightedTagKeys)
    ? source.highlightedTagKeys.map(value => String(value || '').trim()).filter(Boolean)
    : [];

  return {
    presets: {
      lettersOnly: normalizeTagTheme(presetsSource.lettersOnly),
      lettersNumbers: normalizeTagTheme(presetsSource.lettersNumbers),
      highlight: normalizeTagTheme(presetsSource.highlight),
    },
    perTagThemes: Object.entries(
      source.perTagThemes && typeof source.perTagThemes === 'object' ? source.perTagThemes : {}
    ).reduce((acc, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      const normalizedTheme = normalizeTagTheme(value);
      if (normalizedKey && normalizedTheme) {
        acc[normalizedKey] = normalizedTheme;
      }
      return acc;
    }, {}),
    highlightedTagKeys,
  };
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
    measurementGuideModelLinksByScope: {},
    tagSize: 20,
    tagSizeByView: {},
    tagColorTheme: null,
    tagStyleConfig: createDefaultTagStyleConfig(),
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
  const measurementGuideModelLinksByScope =
    source.measurementGuideModelLinksByScope &&
    typeof source.measurementGuideModelLinksByScope === 'object'
      ? Object.fromEntries(
          Object.entries(source.measurementGuideModelLinksByScope)
            .map(([scopeId, selectionId]) => [
              String(scopeId || '').trim(),
              String(selectionId || '').trim(),
            ])
            .filter(([scopeId, selectionId]) => scopeId && selectionId)
        )
      : Object.fromEntries(
          Object.entries(measurementGuideModelLinksByImage).map(([imageId, selectionId]) => [
            imageId,
            selectionId,
          ])
        );
  const tagSizeRaw = Number(source.tagSize);
  const tagSize = Number.isFinite(tagSizeRaw)
    ? Math.max(8, Math.min(72, Math.round(tagSizeRaw)))
    : 20;
  const tagSizeByView =
    source.tagSizeByView && typeof source.tagSizeByView === 'object'
      ? Object.fromEntries(
          Object.entries(source.tagSizeByView)
            .map(([viewId, size]) => {
              const normalizedViewId = String(viewId || '').trim();
              const parsedSize = Number(size);
              if (!normalizedViewId || !Number.isFinite(parsedSize)) return null;
              return [normalizedViewId, Math.max(8, Math.min(72, Math.round(parsedSize)))];
            })
            .filter(Boolean)
        )
      : {};
  const tagColorTheme =
    source.tagColorTheme && typeof source.tagColorTheme === 'object'
      ? normalizeTagTheme(source.tagColorTheme)
      : null;
  const tagStyleConfig =
    source.tagStyleConfig && typeof source.tagStyleConfig === 'object'
      ? normalizeTagStyleConfig(source.tagStyleConfig)
      : tagColorTheme
        ? {
            presets: {
              lettersOnly: safeClone(tagColorTheme, null),
              lettersNumbers: safeClone(tagColorTheme, null),
              highlight: null,
            },
            perTagThemes: {},
            highlightedTagKeys: [],
          }
        : safeClone(defaults.tagStyleConfig, createDefaultTagStyleConfig());
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
    measurementGuideModelLinksByScope,
    tagSize,
    tagSizeByView,
    tagColorTheme,
    tagStyleConfig,
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
