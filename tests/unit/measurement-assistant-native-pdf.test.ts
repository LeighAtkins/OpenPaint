import { describe, expect, it, vi } from 'vitest';
import {
  buildNativePdfReport,
  exportNativeMeasurementPdf,
} from '../../src/modules/measurement-assistant/native-pdf-export';

describe('native SofaPaint PDF export contract', () => {
  it('uses the existing server schema with blank customer fields and stable per-view field names', () => {
    const placement: any = {
      measurements: [
        { imageId: 'front', label: 'A1' },
        { imageId: 'side', label: 'F4' },
      ],
    };
    const payload = buildNativePdfReport(
      placement,
      [
        { id: 'front', view: 'front', width: 100, height: 100, src: 'data:image/png;base64,AA==' },
        { id: 'side', view: 'side', width: 100, height: 100, src: 'data:image/png;base64,AA==' },
      ],
      { fillable: true, units: 'cm' }
    );
    expect(payload.report.groups[0].mainMeasurements).toEqual([
      { label: 'A1', value: '', fieldName: 'measurement_front_0' },
    ]);
    expect(payload.report.groups[1].mainMeasurements[0].label).toBe('F4');
    expect(payload.options.renderer).toBe('hybrid');
    expect(payload.options.injectFormFields).toBe(true);
    expect(payload.report.reviewManifest.views).toHaveLength(2);
  });
  it('accepts an explicit JPEG presentation raster while preserving native fields and page views', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('%PDF-test', { headers: { 'content-type': 'application/pdf' } })
      );
    vi.stubGlobal('fetch', fetcher);
    try {
      const photos = [
        { id: 'front', view: 'front', width: 800, height: 1067 },
        { id: 'side', view: 'side', width: 800, height: 1067 },
      ];
      const render = vi
        .fn()
        .mockResolvedValue({ bytes: new Uint8Array([255, 216, 255, 217]), mimeType: 'image/jpeg' });
      await exportNativeMeasurementPdf(
        {
          measurements: [
            { imageId: 'front', label: 'A1' },
            { imageId: 'side', label: 'G2' },
          ],
        } as any,
        photos,
        render,
        { fillable: true, units: 'cm' },
        'https://sofapaint.vercel.app/api/pdf/render'
      );
      const payload = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(payload.report.groups).toHaveLength(2);
      expect(payload.report.groups[0].mainImage.src).toMatch(/^data:image\/jpeg;base64,/);
      expect(payload.report.groups[1].mainMeasurements[0].fieldName).toBe('measurement_side_0');
      expect(payload.options.injectFormFields).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('keeps the request-size gate and does not send an oversized raster payload', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(
        exportNativeMeasurementPdf(
          { measurements: [] } as any,
          [{ id: 'front', view: 'front', width: 800, height: 1067 }],
          async () => new Uint8Array(3_100_000),
          { fillable: true, units: 'cm' },
          'https://sofapaint.vercel.app/api/pdf/render'
        )
      ).rejects.toThrow('hosted export size limit');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
