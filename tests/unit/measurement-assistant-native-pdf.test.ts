import { describe, expect, it } from 'vitest';
import { buildNativePdfReport } from '../../src/modules/measurement-assistant/native-pdf-export';

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
});
