function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function findImageSource(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const source =
    value.src ||
    value.image ||
    value.imageUrl ||
    value.url ||
    value.dataUrl ||
    value.previewUrl ||
    '';
  return typeof source === 'string' ? source : '';
}

function normalizeMeasurements(value) {
  if (Array.isArray(value)) {
    return value
      .map(row => ({
        label: cleanText(row?.label || row?.name || row?.key || ''),
        value: cleanText(row?.value || row?.measurement || row?.text || ''),
      }))
      .filter(row => row.label);
  }

  const measurements = toRecord(value);
  return Object.entries(measurements)
    .map(([label, raw]) => {
      if (raw && typeof raw === 'object') {
        const item = raw;
        const finalValue =
          item.value ?? item.text ?? item.display ?? item.cm ?? item.inches ?? item.inchWhole ?? '';
        return { label: cleanText(label), value: cleanText(finalValue) };
      }
      return { label: cleanText(label), value: cleanText(raw) };
    })
    .filter(row => row.label);
}

function buildViewMap(project) {
  const viewsMap = new Map();
  const viewsInput = project?.views;

  if (Array.isArray(viewsInput)) {
    viewsInput.forEach((view, idx) => {
      const id = cleanText(view?.id || view?.viewId || `view-${idx + 1}`);
      viewsMap.set(id, view);
    });
    return viewsMap;
  }

  const record = toRecord(viewsInput);
  Object.entries(record).forEach(([id, view]) => {
    viewsMap.set(cleanText(id), view);
  });
  return viewsMap;
}

function getViewLabel(view, viewId) {
  return cleanText(view?.label || view?.name || view?.title || view?.partLabel || viewId, viewId);
}

function normalizeFrames(view, viewId) {
  const explicitFrames = toArray(view?.tabs?.length ? view.tabs : view?.frames);
  if (explicitFrames.length > 0) {
    return explicitFrames
      .map((frame, idx) => ({
        id: cleanText(frame?.id || frame?.tabId || `${viewId}-frame-${idx + 1}`),
        title: cleanText(frame?.name || frame?.tabName || frame?.title || `Frame ${idx + 1}`),
        src: findImageSource(frame) || findImageSource(view),
        measurements: normalizeMeasurements(frame?.measurements || frame?.measurementRows),
      }))
      .filter(frame => frame.src);
  }

  const src = findImageSource(view);
  if (!src) return [];
  return [
    {
      id: `${viewId}-frame-1`,
      title: 'Frame 1',
      src,
      measurements: normalizeMeasurements(view?.measurements || view?.measurementRows),
    },
  ];
}

function formatFrameTitle(viewLabel, frameTitle, frameCount) {
  const normalized = cleanText(frameTitle);
  const isFrame1 = /^frame\s*1$/i.test(normalized);
  if (!normalized || (frameCount <= 1 && isFrame1)) return viewLabel;
  return `${viewLabel} - ${normalized}`;
}

function buildGroupsFromProject(project) {
  const pieceGroups = toArray(project?.pieceGroups);
  const viewsMap = buildViewMap(project);
  const groups = [];

  pieceGroups.forEach((pieceGroup, index) => {
    const mainViewId = cleanText(pieceGroup?.mainViewId);
    if (!mainViewId || !viewsMap.has(mainViewId)) return;

    const mainView = viewsMap.get(mainViewId);
    const mainLabel = getViewLabel(mainView, mainViewId);
    const mainFrames = normalizeFrames(mainView, mainViewId);
    const mainFrame = mainFrames[0];
    if (!mainFrame) return;

    const relatedIds = toArray(pieceGroup?.relatedViewIds)
      .map(id => cleanText(id))
      .filter(Boolean);

    const relatedFrames = [];
    const relatedCards = [];

    relatedIds.forEach(relatedId => {
      const relatedView = viewsMap.get(relatedId);
      if (!relatedView) return;
      const relatedLabel = getViewLabel(relatedView, relatedId);
      const frames = normalizeFrames(relatedView, relatedId);

      frames.forEach(frame => {
        const title = formatFrameTitle(relatedLabel, frame.title, frames.length);
        relatedFrames.push({ title, src: frame.src });

        const rows = normalizeMeasurements(frame.measurements);
        if (rows.length > 0) {
          relatedCards.push({ title, rows });
        }
      });
    });

    groups.push({
      title: cleanText(pieceGroup?.label || `Group ${index + 1}`),
      subtitle: cleanText(pieceGroup?.note || ''),
      mainImage: {
        title: formatFrameTitle(mainLabel, mainFrame.title, mainFrames.length),
        src: mainFrame.src,
      },
      mainMeasurements: normalizeMeasurements(mainFrame.measurements),
      relatedFrames,
      relatedMeasurementCards: relatedCards,
    });
  });

  return groups;
}

function normalizeExistingGroups(groupsInput) {
  return toArray(groupsInput)
    .map((group, idx) => ({
      title: cleanText(group?.title || `Group ${idx + 1}`),
      subtitle: cleanText(group?.subtitle || ''),
      mainImage: {
        title: cleanText(group?.mainImage?.title || ''),
        src: findImageSource(group?.mainImage),
      },
      mainMeasurements: normalizeMeasurements(group?.mainMeasurements),
      relatedFrames: toArray(group?.relatedFrames)
        .map(frame => ({
          title: cleanText(frame?.title || ''),
          src: findImageSource(frame),
        }))
        .filter(frame => frame.src),
      relatedMeasurementCards: toArray(group?.relatedMeasurementCards)
        .map(card => ({
          title: cleanText(card?.title || ''),
          rows: normalizeMeasurements(card?.rows),
        }))
        .filter(card => card.title),
    }))
    .filter(group => group.mainImage.src);
}

export function mapProjectToReportModel(project) {
  const projectRecord = toRecord(project);
  const projectName =
    cleanText(projectRecord.projectName) || cleanText(projectRecord.name) || 'OpenPaint Project';

  const normalizedGroups = normalizeExistingGroups(projectRecord.groups);
  const groups =
    normalizedGroups.length > 0 ? normalizedGroups : buildGroupsFromProject(projectRecord);

  return {
    projectName,
    namingLine: cleanText(projectRecord.namingLine || projectRecord.metaLine || ''),
    groups,
  };
}
