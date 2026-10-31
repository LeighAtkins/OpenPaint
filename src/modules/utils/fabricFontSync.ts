/**
 * Keeps Fabric text in step with web font loading.
 *
 * Fabric measures text the moment an object is created and caches every
 * character width per font family. Web fonts load lazily, so the first note in
 * a session (or a project restored before its fonts arrive) is measured with
 * the fallback font, and that stale measurement then sticks: the note keeps
 * the wrong width, background box and hit area, and looks different the next
 * time the project is opened with the font already available.
 *
 * The fix is to drop Fabric's cached metrics and re-measure whenever a font
 * finishes loading.
 */

declare const fabric: any;

interface FabricCanvasLike {
  getObjects(): any[];
  requestRenderAll(): void;
}

const TEXT_TYPES = new Set(['i-text', 'text', 'textbox']);

function normalizeFamily(family: unknown): string {
  return (typeof family === 'string' ? family : '').replace(/["']/g, '').trim().toLowerCase();
}

function isTextObject(object: any): boolean {
  return Boolean(object && TEXT_TYPES.has(object.type));
}

export function buildFontSpec(object: {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: string;
}): string {
  const family = (object.fontFamily || 'sans-serif').replace(/["']/g, '');
  return `${object.fontStyle || 'normal'} ${object.fontWeight || 'normal'} ${
    Number(object.fontSize) || 24
  }px "${family}"`;
}

/**
 * Re-measure text objects after their font became available.
 * Pass `families` to limit the work to the fonts that just loaded.
 */
export function remeasureFabricText(
  canvas: FabricCanvasLike | null | undefined,
  families?: Iterable<string> | null
): number {
  if (!canvas || typeof canvas.getObjects !== 'function') return 0;
  const wanted = families ? new Set(Array.from(families, normalizeFamily)) : null;
  let updated = 0;

  const refresh = (object: any, parent: any | null) => {
    if (typeof object?.getObjects === 'function') {
      object.getObjects().forEach((child: any) => refresh(child, object));
      return;
    }
    if (!isTextObject(object)) return;
    if (wanted && !wanted.has(normalizeFamily(object.fontFamily))) return;
    // Editing text re-measures itself on every keystroke.
    if (object.isEditing) return;
    object.initDimensions?.();
    object.setCoords?.();
    object.dirty = true;
    if (parent) parent.dirty = true;
    updated += 1;
  };

  canvas.getObjects().forEach(object => refresh(object, null));
  if (updated > 0) canvas.requestRenderAll();
  return updated;
}

/** Forget Fabric's cached character widths for fonts that were measured too early. */
export function clearFabricFontMetrics(families: Iterable<string>): void {
  const clear = typeof fabric !== 'undefined' ? fabric?.util?.clearFabricFontCache : null;
  if (typeof clear !== 'function') return;
  for (const family of families) {
    const name = (family || '').replace(/["']/g, '');
    if (name) clear(name);
  }
}

/**
 * Make sure the font for a text style is loaded. Resolves `true` when a load
 * was needed, in which case Fabric's cached metrics for it were discarded.
 */
export async function ensureFontLoaded(style: {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: string;
}): Promise<boolean> {
  const fontSet = typeof document !== 'undefined' ? document.fonts : null;
  if (!fontSet || typeof fontSet.load !== 'function') return false;
  const spec = buildFontSpec(style);
  try {
    if (fontSet.check(spec)) return false;
    await fontSet.load(spec);
  } catch {
    return false;
  }
  clearFabricFontMetrics([style.fontFamily || '']);
  return true;
}

/** Start loading every font used by text on the canvas that is not available yet. */
export function requestFontsForCanvasText(canvas: FabricCanvasLike | null | undefined): void {
  if (!canvas || typeof canvas.getObjects !== 'function') return;
  const seen = new Set<string>();
  const visit = (object: any) => {
    if (typeof object?.getObjects === 'function') {
      object.getObjects().forEach(visit);
      return;
    }
    if (!isTextObject(object)) return;
    const spec = buildFontSpec(object);
    if (seen.has(spec)) return;
    seen.add(spec);
    void ensureFontLoaded(object).then(loaded => {
      if (loaded) remeasureFabricText(canvas, [String(object.fontFamily || '')]);
    });
  };
  canvas.getObjects().forEach(visit);
}

/**
 * Re-measure canvas text every time the browser finishes loading fonts, however
 * the load was started. Returns a function that removes the listener.
 */
export function watchFontLoads(getCanvas: () => FabricCanvasLike | null | undefined): () => void {
  const fontSet = typeof document !== 'undefined' ? document.fonts : null;
  if (!fontSet || typeof fontSet.addEventListener !== 'function') return () => undefined;
  const onLoadingDone = (event: Event) => {
    const faces = (event as FontFaceSetLoadEvent).fontfaces || [];
    const families = Array.from(new Set(faces.map(face => face.family || '')));
    if (!families.length) return;
    clearFabricFontMetrics(families);
    remeasureFabricText(getCanvas(), families);
  };
  fontSet.addEventListener('loadingdone', onLoadingDone);
  return () => fontSet.removeEventListener('loadingdone', onLoadingDone);
}
