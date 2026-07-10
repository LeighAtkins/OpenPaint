import { describe, expect, test } from 'vitest';
import { PDFDocument, TextAlignment } from 'pdf-lib';
import { injectPdfFormFields } from '../../server/pdf/inject-form-fields.js';
import { pdfRenderRequestSchema } from '../../server/pdf/schema.js';
import { renderReportTemplate } from '../../server/pdf/templates/report-template.js';

const image = { title: 'Seat cushion', src: 'data:image/png;base64,AAAA' };

function reportGroup(overrides = {}) {
  return {
    title: 'Seat cushion',
    subtitle: '',
    mainImage: image,
    mainMeasurements: [{ label: 'A1', value: '50 cm' }],
    relatedFrames: [],
    relatedMeasurementCards: [],
    ...overrides,
  };
}

describe('modern PDF cushion quantity', () => {
  test('renders a fillable quantity box only when the group requests one', () => {
    const html = renderReportTemplate({
      projectName: 'Cushion test',
      groups: [reportGroup({ cushionQuantity: '3' }), reportGroup({ title: 'Sofa frame' })],
    });

    expect(html.match(/>QTY</g)).toHaveLength(1);
    expect(html).toMatch(/measurement-code">QTY<\/span>[\s\S]*data-field-name="cushion_qty_1"/);
    expect(html.indexOf('measurement-code">QTY')).toBeLessThan(
      html.indexOf('measurement-code">A1')
    );
    expect(html).toContain('data-field-name="cushion_qty_1"');
    expect(html).toContain('data-field-value="3"');
    expect(html).toContain('data-field-max-length="2"');
    expect(html).toContain('data-field-align="center"');
    expect(html).not.toContain('class="cushion-quantity"');
  });

  test('keeps a blank cushion quantity box available for the PDF recipient', () => {
    const html = renderReportTemplate({
      projectName: 'Cushion request',
      groups: [reportGroup({ cushionQuantity: '' })],
    });

    expect(html).toContain('QTY');
    expect(html).toContain('data-field-value=""');
  });

  test('adds editable seat, back, and accent checkboxes below the units', () => {
    const html = renderReportTemplate({
      projectName: 'Cushion types',
      groups: [reportGroup({ cushionQuantity: '' })],
    });

    expect(html).toContain('data-field-name="cushion_type_1_seat"');
    expect(html).toContain('data-field-name="cushion_type_1_back"');
    expect(html).toContain('data-field-name="cushion_type_1_accent"');
  });

  test('renders an editable one-line note at the top of the page', () => {
    const html = renderReportTemplate({
      projectName: 'Customer note',
      groups: [reportGroup({ customerNote: 'Check seam and match piping' })],
    });

    expect(html).toContain('data-field-name="note_1"');
    expect(html).toContain('data-field-max-length="90"');
    expect(html).toContain('Check seam and match piping');
    expect(html.indexOf('class="customer-note-top')).toBeLessThan(
      html.indexOf('class="unit-block')
    );
    expect(html).not.toContain('measurement-code">NOTE');
  });

  test('accepts blank or two-digit quantities in the report schema', () => {
    const base = {
      source: 'report',
      report: { projectName: 'Schema test', groups: [reportGroup({ cushionQuantity: '' })] },
      options: {},
    };
    expect(pdfRenderRequestSchema.safeParse(base).success).toBe(true);
    expect(
      pdfRenderRequestSchema.safeParse({
        ...base,
        report: { ...base.report, groups: [reportGroup({ cushionQuantity: '12' })] },
      }).success
    ).toBe(true);
    expect(
      pdfRenderRequestSchema.safeParse({
        ...base,
        report: { ...base.report, groups: [reportGroup({ cushionQuantity: '123' })] },
      }).success
    ).toBe(false);
  });

  test('injects a centered, two-character AcroForm text field', async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    const buffer = Buffer.from(await source.save());
    const output = await injectPdfFormFields(buffer, [
      {
        pageIndex: 0,
        fieldType: 'text',
        fieldName: 'cushion_qty_1',
        value: '2',
        maxLength: 2,
        textAlign: 'center',
        x: 100,
        y: 600,
        width: 40,
        height: 24,
        fontSize: 11.25,
      },
    ]);
    const loaded = await PDFDocument.load(output);
    const field = loaded.getForm().getTextField('cushion_qty_1');

    expect(field.getText()).toBe('2');
    expect(field.getMaxLength()).toBe(2);
    expect(field.getAlignment()).toBe(TextAlignment.Center);
    expect(field.acroField.getDefaultAppearance()).toContain('/Courier 11.25 Tf');
  });
});
