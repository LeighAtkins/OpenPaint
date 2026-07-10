import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
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
  test('uses matching type sizes for measurement labels and values', () => {
    const css = fs.readFileSync('server/pdf/print.css', 'utf8');
    expect(css).toMatch(/\.measurement-code\s*\{[\s\S]*?font-size:\s*15px/);
    expect(css).toMatch(/\.input-box\s*\{[\s\S]*?font-size:\s*15px/);
  });

  test('uses one project title in the header without repeated metadata', () => {
    const html = renderReportTemplate(sampleReport, { pageSize: 'a4' });
    expect(html).toContain('<h1 class="title">Test Project</h1>');
    expect(html).not.toContain('Custom Sofa Measuring Diagram');
    expect(html).not.toContain('Customer | Sofa | 2026-02-10');
  });

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

  test('renders unit toggle with active cm state', () => {
    const html = renderReportTemplate({ ...sampleReport, unit: 'cm' }, { pageSize: 'a4' });
    expect(html).toContain('class="unit-pill active"');
    expect(html).toContain('data-field-type="unit-radio"');
    expect(html).toContain('data-field-name="unit_measurement"');
    expect(html).toContain('data-field-option="cm"');
    expect(html).toContain('class="unit-checkbox pdf-field-anchor active"');
    expect(html).toContain('class="unit-checkbox pdf-field-anchor "');
    expect(html).toContain('data-field-option="inch"');
    expect(html).toContain('data-field-value="checked"');
  });

  test('renders repeated-label comparison page when comparison groups are present', () => {
    const html = renderReportTemplate(
      {
        ...sampleReport,
        comparisonGroups: [
          {
            label: 'J1',
            items: [
              { title: 'Front', src: 'data:image/png;base64,AAAA' },
              { title: 'Side', src: 'data:image/png;base64,BBBB' },
            ],
          },
        ],
      },
      { pageSize: 'a4' }
    );
    expect(html).toContain('Label J1');
    expect(html).toContain('Repeated labels are isolated here');
  });

  test('paginates comparison groups across multiple pages when there are more than 2 groups', () => {
    const groups = Array.from({ length: 5 }, (_, i) => ({
      label: `J${i + 1}`,
      items: [
        { title: 'Front', src: 'data:image/png;base64,AAAA' },
        { title: 'Side', src: 'data:image/png;base64,BBBB' },
      ],
    }));
    const html = renderReportTemplate(
      { ...sampleReport, comparisonGroups: groups },
      { pageSize: 'a4' }
    );
    // 5 groups at 2 per page => 3 pages
    const pageMatches = html.match(/class="page comparison-page"/g);
    expect(pageMatches).toHaveLength(3);
    // Main page plus 3 comparison pages all use the same compact project header.
    const headerMatches = html.match(/<h1 class="title">Test Project<\/h1>/g);
    expect(headerMatches).toHaveLength(4);
    // All 5 group labels present
    expect(html).toContain('Label J1');
    expect(html).toContain('Label J5');
  });

  test('uses two-column measurement table for dense measurement lists', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      label: `A${index + 1}`,
      value: `${index + 10} cm`,
    }));
    const html = renderReportTemplate(
      {
        ...sampleReport,
        groups: [
          {
            ...sampleReport.groups[0],
            mainMeasurements: rows,
          },
        ],
      },
      { pageSize: 'a4' }
    );
    expect(html).toContain('sheet-main-dense');
    expect(html).toContain('measure-panel-wide');
    expect(html).toContain('measurement-grid two-col');
  });

  test('keeps letter-only measurement labels in the editable table', () => {
    const html = renderReportTemplate(
      {
        ...sampleReport,
        groups: [
          {
            ...sampleReport.groups[0],
            mainMeasurements: [
              { label: 'A', value: '' },
              { label: 'B', value: '12 cm' },
              { label: 'C', value: '' },
              { label: 'D', value: 'pending' },
            ],
          },
        ],
      },
      { pageSize: 'a4' }
    );
    expect(html).toContain('<span class="measurement-code">A</span>');
    expect(html).toContain('<span class="measurement-code">B</span>');
    expect(html).toContain('<span class="measurement-code">C</span>');
    expect(html).toContain('<span class="measurement-code">D</span>');
    expect(html).not.toContain('No measurements recorded');
  });
});
