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

function normalizeTagScopeStyle(input) {
  if (!input || typeof input !== 'object') return null;
  const style = {};
  const numberFields = {
    tagSize: [8, 72],
    outlineWidth: [0, 8],
    connectorWidth: [0.25, 12],
  };
  Object.entries(numberFields).forEach(([field, [min, max]]) => {
    const parsed = Number(input[field]);
    if (Number.isFinite(parsed)) {
      style[field] = Math.max(min, Math.min(max, parsed));
    }
  });

  if (typeof input.backgroundStyle === 'string') {
    const value = input.backgroundStyle.trim();
    if (
      ['solid', 'no-fill', 'clear-black', 'clear-color', 'clear-white', 'frosted'].includes(value)
    ) {
      style.backgroundStyle = value;
    }
  }
  if (typeof input.tagShape === 'string') {
    const value = input.tagShape.trim();
    if (['square', 'circle'].includes(value)) {
      style.tagShape = value;
    }
  }
  if (typeof input.connectorColorMode === 'string') {
    const value = input.connectorColorMode.trim();
    if (['same-as-line', 'custom'].includes(value)) {
      style.connectorColorMode = value;
    }
  }
  ['connectorColor', 'fillColor', 'outlineColor', 'textColor'].forEach(field => {
    if (typeof input[field] === 'string' && input[field].trim()) {
      style[field] = input[field].trim();
    }
  });
  if (Array.isArray(input.connectorDash)) {
    const dash = input.connectorDash
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0)
      .slice(0, 4);
    if (dash.length) style.connectorDash = dash;
  }
  if (typeof input.connectorAvoidsTag === 'boolean') {
    style.connectorAvoidsTag = input.connectorAvoidsTag;
  }
  return Object.keys(style).length ? style : null;
}

function normalizeTagStyleByScope(input) {
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input).reduce((acc, [scopeKey, value]) => {
    const normalizedKey = String(scopeKey || '').trim();
    const normalizedStyle = normalizeTagScopeStyle(value);
    if (normalizedKey && normalizedStyle) {
      acc[normalizedKey] = normalizedStyle;
    }
    return acc;
  }, {});
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
    measurementGuideLabelsByImage: {},
    tagSize: 20,
    tagSizeByView: {},
    tagColorTheme: null,
    tagStyleConfig: createDefaultTagStyleConfig(),
    tagStyleByScope: {},
    pieceGroups: [],
    imagePartLabels: {},
    measurementNotes: {},
    checkSessions: [],
    externalSources: {
      gorgiasTickets: {},
    },
    sectionalAssemblies: {},
    photos: [],
    quickSketchMap: null,
  };
}

const SECTIONAL_PIECE_KINDS = [
  'left-arm',
  'seat',
  'corner',
  'chaise',
  'right-arm',
  'ottoman',
  'left-arm-chaise',
  'right-arm-chaise',
  'armchair',
  'two-arm-chaise',
];
const SECTIONAL_PRICING_COUNTRIES = [
  'US',
  'AU',
  'AT',
  'BE',
  'CA',
  'CN',
  'FR',
  'DE',
  'GLOBAL',
  'HK',
  'JP',
  'MO',
  'MY',
  'NZ',
  'SG',
  'ES',
  'CH',
  'TW',
  'GB',
];
const SECTIONAL_PRICING_FABRICS = [
  'everyday-weave',
  'everyday-cotton',
  'everyday-velvet',
  'care-canvas',
  'care-linen',
  'care-tweed',
  'mod-boucle',
  'mod-chenille',
  'signature-microfiber',
  'signature-velvet',
  'crypton®-chenille',
  'sunbrella®-canvas',
  'sunbrella®-fretwork',
  'classic-velvet',
];

function normalizeSectionalAssemblies(source) {
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => {
        const entry = value && typeof value === 'object' ? value : {};
        const id = String(entry.id || key || '').trim();
        if (!id) return null;
        const pieces = (Array.isArray(entry.pieces) ? entry.pieces : [])
          .map(piece => {
            const candidate = piece && typeof piece === 'object' ? piece : {};
            if (!SECTIONAL_PIECE_KINDS.includes(candidate.kind)) return null;
            const col = Math.round(Number(candidate.col));
            const row = Math.round(Number(candidate.row));
            if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
            const rotationRaw = Math.round(Number(candidate.rotation) / 90) * 90;
            const rotation = Number.isFinite(rotationRaw) ? ((rotationRaw % 360) + 360) % 360 : 0;
            return {
              id:
                typeof candidate.id === 'string' && candidate.id.trim()
                  ? candidate.id.trim()
                  : `${id}-${col}-${row}`,
              kind: candidate.kind,
              col,
              row,
              rotation,
              mirrored: candidate.mirrored === true,
              guideCode:
                typeof candidate.guideCode === 'string' && candidate.guideCode.trim()
                  ? candidate.guideCode.trim()
                  : undefined,
              widthCm:
                Number.isFinite(Number(candidate.widthCm)) && Number(candidate.widthCm) > 0
                  ? Number(candidate.widthCm)
                  : undefined,
              depthCm:
                Number.isFinite(Number(candidate.depthCm)) && Number(candidate.depthCm) > 0
                  ? Number(candidate.depthCm)
                  : undefined,
            };
          })
          .filter(Boolean);
        const liveTransforms =
          entry.liveTransforms && typeof entry.liveTransforms === 'object'
            ? Object.fromEntries(
                Object.entries(entry.liveTransforms)
                  .map(([pieceId, value]) => {
                    const transform = value && typeof value === 'object' ? value : {};
                    const x = Number(transform.x);
                    const y = Number(transform.y);
                    const scaleX = Number(transform.scaleX);
                    const scaleY = Number(transform.scaleY);
                    const angle = Number(transform.angle);
                    if (
                      !pieceId ||
                      !Number.isFinite(x) ||
                      !Number.isFinite(y) ||
                      !Number.isFinite(scaleX) ||
                      !Number.isFinite(scaleY) ||
                      !Number.isFinite(angle)
                    ) {
                      return null;
                    }
                    return [
                      pieceId,
                      {
                        x,
                        y,
                        scaleX: Math.max(0.01, scaleX),
                        scaleY: Math.max(0.01, scaleY),
                        angle,
                      },
                    ];
                  })
                  .filter(Boolean)
              )
            : undefined;
        return [
          id,
          {
            id,
            name:
              typeof entry.name === 'string' && entry.name.trim()
                ? entry.name.trim()
                : 'Custom sectional',
            pieces,
            imageViewId: typeof entry.imageViewId === 'string' ? entry.imageViewId : '',
            updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
            theme:
              typeof entry.theme === 'string' &&
              ['flax', 'charcoal', 'navy', 'terracotta', 'forest', 'sand'].includes(entry.theme)
                ? entry.theme
                : undefined,
            pricingCountry:
              typeof entry.pricingCountry === 'string' &&
              SECTIONAL_PRICING_COUNTRIES.includes(entry.pricingCountry)
                ? entry.pricingCountry
                : undefined,
            pricingFabric:
              typeof entry.pricingFabric === 'string' &&
              SECTIONAL_PRICING_FABRICS.includes(entry.pricingFabric)
                ? entry.pricingFabric
                : undefined,
            liveTransforms,
          },
        ];
      })
      .filter(Boolean)
  );
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
  const measurementGuideLabelsByImage =
    source.measurementGuideLabelsByImage && typeof source.measurementGuideLabelsByImage === 'object'
      ? Object.fromEntries(
          Object.entries(source.measurementGuideLabelsByImage)
            .map(([imageId, label]) => [String(imageId || '').trim(), String(label || '').trim()])
            .filter(([imageId, label]) => imageId && label)
        )
      : {};
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
  const tagStyleByScope = normalizeTagStyleByScope(source.tagStyleByScope);
  const pieceGroups = Array.isArray(source.pieceGroups) ? safeClone(source.pieceGroups, []) : [];
  const photos = Array.isArray(source.photos) ? safeClone(source.photos, []) : [];
  const imagePartLabels =
    source.imagePartLabels && typeof source.imagePartLabels === 'object'
      ? safeClone(source.imagePartLabels, {})
      : {};
  const measurementNotes =
    source.measurementNotes && typeof source.measurementNotes === 'object'
      ? safeClone(source.measurementNotes, {})
      : {};
  const checkSessions = Array.isArray(source.checkSessions)
    ? safeClone(source.checkSessions, []).slice(0, 10)
    : [];
  const rawGorgiasTickets =
    source.externalSources?.gorgiasTickets &&
    typeof source.externalSources.gorgiasTickets === 'object'
      ? source.externalSources.gorgiasTickets
      : {};
  const gorgiasTickets = Object.fromEntries(
    Object.entries(rawGorgiasTickets)
      .map(([ticketId, value]) => {
        const entry = value && typeof value === 'object' ? value : {};
        const normalizedTicketId = String(ticketId || entry.ticketId || '').trim();
        if (!normalizedTicketId) return null;
        return [
          normalizedTicketId,
          {
            ticketId: normalizedTicketId,
            ticketUrl: typeof entry.ticketUrl === 'string' ? entry.ticketUrl : '',
            customerName: typeof entry.customerName === 'string' ? entry.customerName : '',
            productName: typeof entry.productName === 'string' ? entry.productName : '',
            productSku: typeof entry.productSku === 'string' ? entry.productSku : '',
            guideCode: typeof entry.guideCode === 'string' ? entry.guideCode : '',
            importedImageHashes: Array.isArray(entry.importedImageHashes)
              ? Array.from(
                  new Set(
                    entry.importedImageHashes
                      .map(hash => (typeof hash === 'string' ? hash.trim().toLowerCase() : ''))
                      .filter(Boolean)
                  )
                )
              : [],
            lastImportedAt: typeof entry.lastImportedAt === 'string' ? entry.lastImportedAt : '',
          },
        ];
      })
      .filter(Boolean)
  );
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
    measurementGuideLabelsByImage,
    tagSize,
    tagSizeByView,
    tagColorTheme,
    tagStyleConfig,
    tagStyleByScope,
    pieceGroups,
    imagePartLabels,
    measurementNotes,
    checkSessions,
    externalSources: { gorgiasTickets },
    sectionalAssemblies: normalizeSectionalAssemblies(source.sectionalAssemblies),
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
