import { describe, expect, test } from 'vitest';
import { renderReportTemplate } from '../../server/pdf/templates/report-template.js';

const sampleReport = {
  projectName: 'Test Project',
  namingLine: 'Customer | Sofa | 2026-02-10',
  groups: [
    {
      title: 'Group 1',
      subtitle: '',
      mainImage: { title: 'Main', src: 'data:image/png;base64,AAAA' },
      mainMeasurements: [{ label: 'A1', value: '12"' }],
      relatedFrames: [],
      relatedMeasurementCards: [],
    },
  ],
};

describe('report template page size', () => {
  test('renders letter @page size when letter option selected', () => {
    const html = renderReportTemplate(sampleReport, { pageSize: 'letter' });
    expect(html).toContain('@page { size: Letter; margin: 14mm; }');
    expect(html).toContain('--content-width: 188mm; --content-height: 251mm;');
  });

  test('renders a4 @page size when a4 option selected', () => {
    const html = renderReportTemplate(sampleReport, { pageSize: 'a4' });
    expect(html).toContain('@page { size: A4; margin: 14mm; }');
    expect(html).toContain('--content-width: 182mm; --content-height: 269mm;');
  });
});
