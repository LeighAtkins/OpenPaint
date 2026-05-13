function toBaseViewId(imageLabel) {
  const raw = String(imageLabel || '').trim();
  if (!raw) return '';
  const tabMarker = '::tab:';
  const tabIndex = raw.indexOf(tabMarker);
  return tabIndex >= 0 ? raw.slice(0, tabIndex) : raw;
}

function buildMeasurementKey(ref) {
  if (!ref || typeof ref !== 'object') return '';
  const viewId = toBaseViewId(ref.imageLabel);
  const strokeLabel = String(ref.strokeLabel || '').trim();
  if (!viewId || !strokeLabel) return '';
  return `${viewId}:${strokeLabel}`;
}

function buildPairKey(fromKey, toKey) {
  const a = String(fromKey || '');
  const b = String(toKey || '');
  return a <= b ? `${a}__${b}` : `${b}__${a}`;
}

function getProjectMetadataManager() {
  return window.app?.projectManager || null;
}

export function addAutoMeasurementConnections(newStrokeRef, snapTargets) {
  const fromKey = buildMeasurementKey(newStrokeRef);
  if (!fromKey) return 0;

  const uniqueToKeys = new Set();
  (snapTargets || []).forEach(target => {
    const toKey = buildMeasurementKey(target);
    if (!toKey || toKey === fromKey) return;
    uniqueToKeys.add(toKey);
  });

  if (!uniqueToKeys.size) return 0;

  const manager = getProjectMetadataManager();
  const metadata = manager?.getProjectMetadata?.() || window.projectMetadata || {};
  const existing = Array.isArray(metadata.measurementConnections)
    ? [...metadata.measurementConnections]
    : [];

  const existingPairs = new Set();
  existing.forEach(connection => {
    const existingFrom = String(connection?.fromKey || '');
    const existingTo = String(connection?.toKey || '');
    if (!existingFrom || !existingTo) return;
    existingPairs.add(buildPairKey(existingFrom, existingTo));
  });

  let addedCount = 0;
  uniqueToKeys.forEach(toKey => {
    const pairKey = buildPairKey(fromKey, toKey);
    if (existingPairs.has(pairKey)) return;
    existingPairs.add(pairKey);
    existing.push({
      id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromKey,
      toKey,
      note: 'Auto-linked from Ctrl snap',
    });
    addedCount += 1;
  });

  if (!addedCount) return 0;

  if (manager?.setProjectMetadata) {
    manager.setProjectMetadata({ measurementConnections: existing });
  } else {
    window.projectMetadata = {
      ...(window.projectMetadata || {}),
      measurementConnections: existing,
    };
  }

  return addedCount;
}
