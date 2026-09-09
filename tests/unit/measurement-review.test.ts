import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { parseSofaPaintReviewPdf } from '../../src/modules/ui/measurement-review';

describe('SofaPaint measurement review PDFs', () => {
  it('reads the embedded view manifest and the latest editable field values', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    pdf.setSubject(
      `SOFAPAINT_REVIEW_V1:${JSON.stringify({
        version: 1,
        projectName: 'Chair check',
        views: [
          {
            viewId: 'cs1l-sa-hb-front',
            title: 'Front',
            measurements: [
              { label: 'A1', value: '100 cm' },
              { label: 'D', value: '50 cm' },
            ],
          },
        ],
      })}`
    );
    const field = pdf.getForm().createTextField('m_cs1l-sa-hb-front_D');
    field.setText('52 cm');
    field.addToPage(page, { x: 10, y: 10, width: 80, height: 20 });

    const parsed = await parseSofaPaintReviewPdf(await pdf.save());
    expect(parsed.projectName).toBe('Chair check');
    expect(parsed.views[0].measurements).toEqual([
      { label: 'A1', value: '100 cm' },
      { label: 'D', value: '52 cm' },
    ]);
  });

  it('can recover measurements from older editable SofaPaint field names', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    const form = pdf.getForm();
    const a1 = form.createTextField('m_front_A1');
    a1.setText('38 in');
    a1.addToPage(page, { x: 10, y: 40, width: 80, height: 20 });
    const d = form.createTextField('m_front_D');
    d.setText('24 in');
    d.addToPage(page, { x: 10, y: 10, width: 80, height: 20 });

    const parsed = await parseSofaPaintReviewPdf(await pdf.save());
    expect(parsed.views).toHaveLength(1);
    expect(parsed.views[0].viewId).toBe('front');
    expect(parsed.views[0].measurements).toEqual([
      { label: 'A1', value: '38 in' },
      { label: 'D', value: '24 in' },
    ]);
  });
});
