import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createMeasurementPdf } from '../../src/modules/measurement-assistant/pdf-export';
import {
  resolveDrawingStyle,
  drawingStyleSchema,
} from '../../src/modules/measurement-assistant/drawing-style';
import { assistantPlacement } from '../helpers/assistant-placement';

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh2kAAAAASUVORK5CYII=',
    'base64'
  )
);
describe('customer PDF delivery', () => {
  it('creates blank fields for every line and preserves customer values when saved', async () => {
    const plan = assistantPlacement('photo');
    const bytes = await createMeasurementPdf(
      plan,
      [{ id: 'photo', view: 'front', width: 1, height: 1 }],
      async () => png,
      { fillable: true, units: 'cm' }
    );
    const pdf = await PDFDocument.load(bytes);
    const fields = pdf.getForm().getFields();
    expect(fields).toHaveLength(plan.measurements.length);
    const name = fields[0].getName();
    expect(pdf.getForm().getTextField(name).getText()).toBeUndefined();
    pdf.getForm().getTextField(name).setText('82.5');
    const saved = await PDFDocument.load(await pdf.save());
    expect(saved.getForm().getTextField(name).getText()).toBe('82.5');
  });
  it('provides a printable version without interactive fields and paginates large lists', async () => {
    const plan = assistantPlacement('photo');
    const base = plan.measurements[0];
    plan.measurements = Array.from({ length: 35 }, (_, i) => ({
      ...base,
      id: `m${i}`,
      label: `A${i + 1}`,
    }));
    const bytes = await createMeasurementPdf(
      plan,
      [{ id: 'photo', view: 'front', width: 1, height: 1 }],
      async () => png,
      { fillable: false, units: 'in' }
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getForm().getFields()).toHaveLength(0);
  });
  it('uses consistent built-in colors and rejects unsafe or unreadable overrides', () => {
    const measurement = assistantPlacement('photo').measurements[0];
    expect(
      resolveDrawingStyle({
        ...measurement,
        label: 'A3',
        source: {
          kind: 'guide',
          guideId: 'remote:measurement-guides/Front_CS3B-RA-HB.svg',
          guideVersion: 'current',
          roleId: 'A3',
        },
      }).strokeColor
    ).toBe('#ef4444');
    expect(
      resolveDrawingStyle({
        ...measurement,
        label: 'G1',
        source: {
          kind: 'guide',
          guideId: 'remote:measurement-guides/Side_CS3B-RA-HB.svg',
          guideVersion: 'current',
          roleId: 'G1',
        },
      }).strokeColor
    ).toBe('#10b981');
    expect(
      drawingStyleSchema.safeParse({
        strokeColor: 'red" onload="bad',
        strokeWidth: 2,
        arrowStyle: 'filled',
      }).success
    ).toBe(false);
    expect(
      drawingStyleSchema.safeParse({ strokeColor: '#3b82f6', strokeWidth: 0, arrowStyle: 'filled' })
        .success
    ).toBe(false);
  });
});
