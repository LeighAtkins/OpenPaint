import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  cmText,
  convertPdfToCm,
  convertValueText,
  mergeCmPdfs,
  scanPdfText,
} from '../../src/modules/ui/pdf-cm-convert';
import { parseSofaPaintReviewPdf } from '../../src/modules/ui/measurement-review';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(__dirname, '../fixtures/noms-pdfs', name)));
const DATE = new Date(2026, 9, 21);

async function pageText(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    out.push((content.items as any[]).map(i => i.str).join(' | '));
  }
  return out;
}

describe('cm text', () => {
  it('rounds half up without float drift', () => {
    expect(cmText(2.5)).toBe('6.4');
    expect(cmText(23)).toBe('58.4');
    expect(cmText(22.25)).toBe('56.5');
  });
  it('keeps words and both ends of a range', () => {
    expect(convertValueText('approx 24.5 -  25"')).toBe('approx 62.2 - 63.5');
    expect(convertValueText('7" see photos')).toBe('17.8 see photos');
    expect(convertValueText('2 7/8"')).toBe('7.3');
    expect(convertValueText('22-1/4"')).toBe('56.5');
    expect(convertValueText('n/a')).toBeNull();
  });
});

describe('convertPdfToCm on a SofaPaint review PDF (Ria)', () => {
  it('writes cm into the m_ fields, sets the unit radios to cm and keeps the manifest readable', async () => {
    const result = await convertPdfToCm(fixture('ria-filled.pdf'), {
      orderNumber: '125964',
      date: DATE,
    });
    expect(result.kind).toBe('sofapaint-review');
    expect(result.alreadyCm).toBe(false);
    const pdf = await PDFDocument.load(result.bytes);
    const form = pdf.getForm();
    const text = (name: string) => form.getTextField(name).getText();
    expect(text('m_front_A1')).toBe('58.4');
    expect(text('m_front_C1')).toBe('6.4');
    expect(text('m_front_C2')).toBe('17.8 see photos');
    expect(text('m_side_A3')).toBe('approx 62.2 - 63.5');
    expect(text('m_side-1_F1')).toBe('7.3');
    expect(text('m_side-1_G2')).toBe('41.3 - 41.9');
    expect(text('m_side-1_H1')).toBe('12.7 - 13.3');
    const radios = form
      .getFields()
      .filter(f => f instanceof PDFRadioGroup && /^unit_measurement/.test(f.getName()));
    expect(radios).toHaveLength(6);
    for (const radio of radios) expect((radio as PDFRadioGroup).getSelected()).toBe('cm');
    const manifest = await parseSofaPaintReviewPdf(result.bytes);
    expect(manifest.unit).toBe('cm');
    expect(manifest.views[0].measurements.find((m: any) => m.label === 'A1').value).toBe('58.4');
    const texts = await pageText(result.bytes);
    expect(texts[0]).toContain(
      'Converted to cm by SofaPaint for NOMS #125964, 2026-10-21; original values in inches'
    );
  });

  it('passes a PDF already in cm through with the footer only', async () => {
    const first = await convertPdfToCm(fixture('ria-filled.pdf'), { orderNumber: '1', date: DATE });
    const again = await convertPdfToCm(first.bytes, { orderNumber: '125964', date: DATE });
    expect(again.alreadyCm).toBe(true);
    expect(again.converted).toHaveLength(0);
    const form = (await PDFDocument.load(again.bytes)).getForm();
    expect(form.getTextField('m_front_A1').getText()).toBe('58.4');
    const texts = await pageText(again.bytes);
    expect(texts[0]).toContain('values already in cm');
  });
});

describe('convertPdfToCm on CW forms typed over as page text (Ben)', () => {
  it('draws a cm box beside each printed inch value and sets CM', async () => {
    const bytes = fixture('ben-middle-sofa-section.pdf');
    const scan = await scanPdfText(bytes, pdfjs);
    expect(scan.printed.length).toBeGreaterThan(10);
    expect(scan.printed.find(p => p.label === 'A3')?.value).toBe('22-1/4"');
    const result = await convertPdfToCm(bytes, { orderNumber: '777', date: DATE, scan });
    expect(result.kind).toBe('cw-form');
    const byLabel = Object.fromEntries(
      result.converted.filter(c => c.pageIndex === 0).map(c => [c.label, c.to])
    );
    expect(byLabel).toMatchObject({
      A1: '180.3',
      A3: '56.5',
      B: '85.1',
      C: '17.1',
      H3: '2.5',
    });
    expect(result.converted.every(c => c.where === 'printed')).toBe(true);
    const pdf = await PDFDocument.load(result.bytes);
    const radio = pdf.getForm().getRadioGroup('Radio Button 1');
    // Choice1 sits beside the CM word on this template.
    expect(radio.getSelected()).toBe('Choice1');
    const texts = await pageText(result.bytes);
    expect(texts[0]).toContain('56.5');
    expect(texts[0]).toContain('22-1/4"');
    expect(texts[0]).toContain('Converted to cm by SofaPaint for NOMS #777');
  });

  it('converts both pages of the R and L sofa frame, the shared radio and its second page', async () => {
    const bytes = fixture('ben-r-and-l-sofa.pdf');
    const scan = await scanPdfText(bytes, pdfjs);
    const result = await convertPdfToCm(bytes, { orderNumber: '777', date: DATE, scan });
    const p1 = Object.fromEntries(
      result.converted.filter(c => c.pageIndex === 0).map(c => [c.label, c.to])
    );
    const p2 = Object.fromEntries(
      result.converted.filter(c => c.pageIndex === 1).map(c => [c.label, c.to])
    );
    expect(p1).toMatchObject({ A1: '104.1', A3: '56.5', C2: '20.3', H3: '2.5', M3: '187.3' });
    expect(p2).toMatchObject({ J1: '68.6', L1: '104.8', L2: '113.7' });
    const radio = (await PDFDocument.load(result.bytes)).getForm().getRadioGroup('Radio Button 1');
    expect(radio.getSelected()).toBe('Choice1');
    // Page 2's CM button belongs to the same group, so it is marked by hand.
    expect(result.unitControls).toBe(2);
  });

  it('without a scan, empty fields are left alone and the footer is added', async () => {
    const result = await convertPdfToCm(fixture('ben-r-and-l-sofa.pdf'), {
      orderNumber: '777',
      date: DATE,
    });
    expect(result.alreadyCm).toBe(true);
    const fields = (await PDFDocument.load(result.bytes)).getForm().getFields();
    expect(fields.filter(f => f instanceof PDFTextField && f.getText())).toHaveLength(0);
  });
});

describe('mergeCmPdfs', () => {
  it('joins converted PDFs page by page', async () => {
    const a = await convertPdfToCm(fixture('ria-filled.pdf'), { orderNumber: '1', date: DATE });
    const bytes = fixture('ben-middle-sofa-section.pdf');
    const b = await convertPdfToCm(bytes, {
      orderNumber: '1',
      date: DATE,
      scan: await scanPdfText(bytes, pdfjs),
    });
    const merged = await PDFDocument.load(await mergeCmPdfs([a.bytes, b.bytes]));
    expect(merged.getPageCount()).toBe(6 + 2);
    const texts = await pageText(await merged.save());
    expect(texts[0]).toContain('58.4');
  });
});
