import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import type { MeasurementPlacement } from './placement-model';
import { resolveDrawingStyle } from './drawing-style';

export interface MeasurementPdfOptions {
  fillable: boolean;
  title?: string;
  units: 'cm' | 'in';
}
export interface MeasurementPdfPhoto {
  id: string;
  view: string;
  width: number;
  height: number;
}
const text = (value: string, limit = 100) => value.replace(/[^\x20-\x7e]/g, ' ').slice(0, limit);
const ink = rgb(0.12, 0.16, 0.21),
  muted = rgb(0.38, 0.43, 0.49),
  pale = rgb(0.94, 0.96, 0.98);
const color = (hex: string) =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  );
/** Portable AcroForm PDF, generated without headless browsers or paid vision calls. */
export async function createMeasurementPdf(
  placement: MeasurementPlacement,
  photos: MeasurementPdfPhoto[],
  renderPhoto: (photo: MeasurementPdfPhoto) => Promise<Uint8Array>,
  options: MeasurementPdfOptions
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(text(options.title || 'SofaPaint measurement drawing'));
  pdf.setAuthor('SofaPaint');
  pdf.setSubject('Customer-entered upholstery measurements');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const title = text(options.title || 'Sofa measurements', 65);
  const draw = (
    page: PDFPage,
    value: string,
    x: number,
    y: number,
    size = 10,
    selectedFont: PDFFont = font,
    fill = ink
  ) => page.drawText(text(value), { x, y, size, font: selectedFont, color: fill });
  let pageNumber = 0;
  for (const photo of photos) {
    const measurements = placement.measurements.filter(item => item.imageId === photo.id);
    const png = await pdf.embedPng(await renderPhoto(photo));
    // Cap the rows per page so arbitrary projects cannot overlap fields or footers.
    for (let offset = 0; offset < Math.max(1, measurements.length); offset += 17) {
      const page = pdf.addPage([841.89, 595.28]);
      pageNumber++;
      page.drawRectangle({ x: 0, y: 535, width: 841.89, height: 60, color: pale });
      draw(page, 'SOFAPAINT', 28, 566, 10, bold, muted);
      draw(page, title, 28, 544, 19, bold);
      draw(page, `${photo.view.toUpperCase()}${offset ? ' - continued' : ''}`, 610, 553, 11, bold);
      draw(
        page,
        options.fillable
          ? 'Fill in the fields, then save your PDF.'
          : 'Write your measurements in the boxes.',
        610,
        536,
        9,
        font,
        muted
      );
      const scale = Math.min(550 / png.width, 445 / png.height);
      const width = png.width * scale,
        height = png.height * scale;
      page.drawImage(png, { x: 28 + (550 - width) / 2, y: 70 + (445 - height) / 2, width, height });
      draw(page, 'TAG', 610, 508, 9, bold, muted);
      draw(page, `MEASUREMENT (${options.units})`, 657, 508, 9, bold, muted);
      measurements.slice(offset, offset + 17).forEach((measurement, row) => {
        const y = 477 - row * 24;
        const style = resolveDrawingStyle(measurement);
        page.drawCircle({ x: 614, y: y + 8, size: 3, color: color(style.strokeColor) });
        draw(page, measurement.label, 624, y + 4, 10, bold);
        const box = {
          x: 680,
          y,
          width: 128,
          height: 20,
          borderWidth: 0.7,
          borderColor: rgb(0.75, 0.8, 0.85),
          backgroundColor: rgb(1, 1, 1),
        };
        if (options.fillable) {
          const field = form.createTextField(`measurement.${photo.id}.${measurement.id}`);
          field.setMaxLength(24);
          field.addToPage(page, { ...box, font });
          field.setFontSize(11);
        } else page.drawRectangle({ ...box, color: rgb(1, 1, 1) });
      });
      draw(page, 'Widths', 28, 47, 9, font, color('#3b82f6'));
      draw(page, 'Depths', 92, 47, 9, font, color('#10b981'));
      draw(page, 'Heights', 154, 47, 9, font, color('#ef4444'));
      draw(page, 'Seam contours', 220, 47, 9, font, color('#a855f7'));
      draw(
        page,
        'Measure between the labeled arrow tips. Values are supplied by you.',
        28,
        30,
        9,
        font,
        muted
      );
      draw(page, `Page ${pageNumber}`, 758, 30, 9, font, muted);
    }
  }
  if (options.fillable) form.updateFieldAppearances(font);
  return pdf.save();
}
