/**
 * Lines a saved project keeps only in its stroke metadata.
 *
 * A view is saved twice over: its canvas objects (canvasJSON.objects) and the
 * metadata buckets (vectorStrokesByImage), where every stroke is stored as its
 * own fabric record. Some projects come back with lines in the second place
 * only: the canvas snapshot was taken while the base view's lines were off the
 * canvas, so the objects list is empty while the strokes are still there.
 * Loading then rebuilt the metadata from the canvas and the lines were gone.
 *
 * This finds those records so the loader can enliven them again.
 */

export interface StrokeRecordRef {
  scope: string;
  label: string;
  record: Record<string, unknown>;
}

interface CanvasObjectLike {
  strokeMetadata?: { imageLabel?: string; strokeLabel?: string } | null;
}

const isSerializedStroke = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as { toObject?: unknown }).toObject !== 'function' &&
  typeof (value as { type?: unknown }).type === 'string';

/**
 * Stroke records in `scopedVectors` (scope -> label -> record) that belong to
 * `viewId` and have no live object on the canvas. Records that are already
 * fabric objects are skipped: those are live and the rebuild step keeps them.
 */
export function strokesMissingFromCanvas(
  scopedVectors: Record<string, Record<string, unknown> | undefined> | null | undefined,
  canvasObjects: readonly CanvasObjectLike[],
  viewId: string,
  inScope: (scope: string, viewId: string) => boolean = (scope, id) =>
    scope === id || scope.startsWith(`${id}::tab:`)
): StrokeRecordRef[] {
  const present = new Set<string>();
  for (const obj of canvasObjects) {
    const label = obj?.strokeMetadata?.strokeLabel;
    if (!label) continue;
    present.add(`${obj.strokeMetadata?.imageLabel || viewId}|${label}`);
  }
  const out: StrokeRecordRef[] = [];
  for (const [scope, strokes] of Object.entries(scopedVectors || {})) {
    if (!strokes || !inScope(scope, viewId)) continue;
    for (const [label, record] of Object.entries(strokes)) {
      if (!isSerializedStroke(record)) continue;
      if (present.has(`${scope}|${label}`)) continue;
      out.push({ scope, label, record });
    }
  }
  return out;
}
