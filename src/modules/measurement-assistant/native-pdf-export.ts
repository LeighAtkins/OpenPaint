import type { MeasurementPlacement } from './placement-model';
import type { MeasurementPdfOptions, MeasurementPdfPhoto } from './pdf-export';

/** Same report contract used by the editor's Save as PDF action. */
export function buildNativePdfReport(
  placement: MeasurementPlacement,
  photos: Array<MeasurementPdfPhoto & { src: string }>,
  options: MeasurementPdfOptions
) {
  const projectName = options.title || 'SofaPaint measurements';
  const views = photos.map(photo => ({
    viewId: photo.id,
    title: photo.view.toUpperCase(),
    measurements: placement.measurements
      .filter(m => m.imageId === photo.id)
      .map(m => ({ label: m.label, value: m.value || '' })),
  }));
  return {
    source: 'report' as const,
    report: {
      projectName,
      namingLine: 'SofaPaint measurement drawing',
      unit: options.units === 'in' ? 'inch' : 'cm',
      groups: photos.map((photo, index) => ({
        title: views[index].title,
        subtitle: 'Measure between the marked endpoints.',
        mainImage: { title: views[index].title, src: photo.src },
        mainMeasurements: views[index].measurements.map((row, rowIndex) => ({
          ...row,
          fieldName: `measurement_${photo.id}_${rowIndex}`,
        })),
        relatedFrames: [],
        relatedMeasurementCards: [],
      })),
      reviewManifest: {
        version: 1,
        projectName,
        unit: options.units === 'in' ? 'inch' : 'cm',
        views,
      },
    },
    options: {
      renderer: 'hybrid',
      pageSize: 'letter',
      landscape: false,
      injectFormFields: options.fillable,
    },
  };
}

export async function exportNativeMeasurementPdf(
  placement: MeasurementPlacement,
  photos: MeasurementPdfPhoto[],
  renderPhoto: (photo: MeasurementPdfPhoto) => Promise<Uint8Array>,
  options: MeasurementPdfOptions,
  endpoint: string
): Promise<Uint8Array> {
  const images: Array<MeasurementPdfPhoto & { src: string }> = [];
  for (const photo of photos) {
    const bytes = await renderPhoto(photo);
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192)
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    images.push({ ...photo, src: `data:image/png;base64,${btoa(chunks.join(''))}` });
  }
  const body = JSON.stringify(buildNativePdfReport(placement, images, options));
  if (new TextEncoder().encode(body).byteLength > 4_000_000)
    throw new Error(
      'This PDF exceeds the hosted export size limit. Export fewer photo views together.'
    );
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf'))
    throw new Error(
      `SofaPaint Save as PDF failed (${response.status}). No substitute PDF was generated.`
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-')
    throw new Error('SofaPaint returned an invalid PDF.');
  return bytes;
}
