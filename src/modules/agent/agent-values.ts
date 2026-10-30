/**
 * Writing measurement values and line visibility for the agent API.
 *
 * Kept apart from sofapaint-agent.ts so it can be tested against a fake app:
 * the rules here are what keep a value alive through view switches, Cloud
 * Save and PDF export.
 */

type AnyObj = Record<string, any>;

/**
 * Every scope that holds a value for `label` on `viewId`: the view itself plus
 * any per-frame scope (`viewId::tab:…`) whose strokes or values mention the
 * label. Hand-drawn lines keep their own copy in the frame scope, and the PDF
 * export reads that copy first, so all of them must be written together.
 */
export function valueScopes(metadata: AnyObj, viewId: string, label: string): string[] {
  const scopes = new Set<string>([viewId]);
  for (const map of ['strokeMeasurements', 'vectorStrokesByImage']) {
    for (const [scope, bucket] of Object.entries(metadata?.[map] || {})) {
      if (scope.startsWith(`${viewId}::`) && (bucket as AnyObj)?.[label] !== undefined) {
        scopes.add(scope);
      }
    }
  }
  return [...scopes];
}

/**
 * Open a view and wait until SofaPaint has actually switched to it. A value
 * written while another view is open goes to the live maps only, and is
 * replaced by the view's saved state the next time that view opens.
 */
export async function openView(app: AnyObj, viewId: string, timeoutMs = 8000): Promise<void> {
  const pm = app?.projectManager;
  if (!pm?.views?.[viewId]) throw new Error(`No view "${viewId}"`);
  if (pm.currentViewId === viewId) return;
  await pm.switchView(viewId);
  const started = Date.now();
  // switchView defers while another switch or image hydration is running.
  while (pm.currentViewId !== viewId) {
    if (Date.now() - started > timeoutMs) throw new Error(`Could not open view "${viewId}"`);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (pm.currentViewId !== viewId && !pm.isSwitchingView) await pm.switchView(viewId);
  }
}

/** Set (or clear, with null) a line's value in inches on every scope that holds it. */
export async function setMeasurementValue(
  app: AnyObj,
  viewId: string,
  label: string,
  inch: number | null
): Promise<boolean> {
  const metadata = app?.metadataManager;
  if (!metadata?.parseAndSaveMeasurement) throw new Error('Measurements are not available');
  await openView(app, viewId);
  const text = inch === null ? '' : `${inch} in`;
  let ok = true;
  for (const scope of valueScopes(metadata, viewId, label)) {
    if (metadata.parseAndSaveMeasurement(scope, label, text) === false) ok = false;
  }
  app.tagManager?.updateTagText?.(label, viewId);
  app.canvasManager?.fabricCanvas?.requestRenderAll?.();
  return ok;
}

const VISIBILITY_MAPS = ['strokeVisibilityByImage', 'strokeLabelVisibility'];
const scopeView = (scope: string) => scope.split('::')[0];

/**
 * Turn hidden lines and labels back on, for the given views or all of them.
 * Updates the live maps and each view's saved state, so the change survives
 * view switches. Returns the `viewId:label` pairs that were hidden.
 */
export function showAllLines(app: AnyObj, viewIds?: string[]): string[] {
  const wanted = viewIds?.length ? new Set(viewIds) : null;
  const shown = new Set<string>();
  const reveal = (maps: AnyObj | undefined) => {
    for (const name of VISIBILITY_MAPS) {
      for (const [scope, bucket] of Object.entries(maps?.[name] || {})) {
        if (wanted && !wanted.has(scopeView(scope))) continue;
        for (const [label, value] of Object.entries((bucket as AnyObj) || {})) {
          if (value === false) {
            (bucket as AnyObj)[label] = true;
            shown.add(`${scopeView(scope)}:${label}`);
          }
        }
      }
    }
  };
  reveal(app?.metadataManager);
  for (const [viewId, view] of Object.entries(app?.projectManager?.views || {})) {
    if (!wanted || wanted.has(viewId)) reveal((view as AnyObj)?.metadata);
  }
  return [...shown].sort();
}
