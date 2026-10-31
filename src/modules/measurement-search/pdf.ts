import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  comparisonDifference,
  comparisonRows,
  formatMeasurement,
  unitLabel,
  type CatalogueProduct,
  type Selection,
  type Detail,
  type DisplayUnits,
} from './model';
export interface PdfModel {
  product: CatalogueProduct;
  selection: Selection;
  detail: Detail | null;
}
const width = 841.89,
  height = 595.28,
  margin = 30;
const ink = rgb(0.16, 0.2, 0.25),
  muted = rgb(0.43, 0.48, 0.54),
  blue = rgb(0.2, 0.34, 0.54),
  line = rgb(0.85, 0.88, 0.91);
/** Fully local PDF: values remain vectors; source diagrams are embedded images.
 * Unicode source notes use browser-rendered text so nothing gets dropped. */
export async function buildMeasurementPdf(
  models: PdfModel[],
  units: DisplayUnits,
  diagrams: Map<string, string>,
  showTolerances = false
): Promise<Uint8Array> {
  models = models.map(model =>
    model.selection.status === 'confirmed' ? model : { ...model, detail: null }
  );
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const imageCache = new Map<string, any>();
  const canEncode = (font: PDFFont, value: string) => {
    try {
      font.encodeText(value);
      return true;
    } catch {
      return false;
    }
  };
  const canvasText = (value: string, size: number, weight: string) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = `${weight} ${size * 3}px 'Instrument Sans', sans-serif`;
    canvas.width = Math.ceil(context.measureText(value).width) + 6;
    canvas.height = Math.ceil(size * 4.5);
    context.font = `${weight} ${size * 3}px 'Instrument Sans', sans-serif`;
    context.fillStyle = '#344455';
    context.textBaseline = 'top';
    context.fillText(value, 0, 0);
    return {
      url: canvas.toDataURL('image/png'),
      width: canvas.width / 3,
      height: canvas.height / 3,
    };
  };
  async function text(
    page: PDFPage,
    value: string,
    x: number,
    y: number,
    size = 9,
    strong = false,
    color = ink
  ) {
    const font = strong ? bold : regular;
    if (canEncode(font, value)) page.drawText(value, { x, y, size, font, color });
    else {
      const raster = canvasText(value, size, strong ? '600' : '400');
      page.drawImage(await pdf.embedPng(raster.url), {
        x,
        y: y - size * 0.25,
        width: raster.width,
        height: raster.height,
      });
    }
  }
  function textWidth(value: string, size: number) {
    if (canEncode(regular, value)) return regular.widthOfTextAtSize(value, size);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = `${size}px 'Instrument Sans', sans-serif`;
    return context.measureText(value).width;
  }
  function wrap(value: string, max: number, size = 9): string[] {
    const lines: string[] = [];
    for (const paragraph of value.split('\n')) {
      let current = '';
      for (const word of paragraph.split(/(?<=\s)|(?=[\u2e80-\u9fff])/u)) {
        if (current && textWidth(current + word, size) > max) {
          lines.push(current.trimEnd());
          current = '';
        }
        // References/long words also wrap rather than clipping a PDF column.
        for (const char of word) {
          if (current && textWidth(current + char, size) > max) {
            lines.push(current.trimEnd());
            current = '';
          }
          current += char;
        }
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }
  async function paragraph(
    page: PDFPage,
    value: string,
    x: number,
    y: number,
    max: number,
    size = 9,
    strong = false
  ) {
    for (const row of wrap(value, max, size)) {
      await text(page, row, x, y, size, strong);
      y -= size + 4;
    }
    return y;
  }
  function rule(page: PDFPage, y: number, x = margin, end = width - margin) {
    page.drawLine({ start: { x, y }, end: { x: end, y }, thickness: 0.6, color: line });
  }
  async function newPage(model?: PdfModel, suffix = '') {
    const page = pdf.addPage([width, height]);
    await text(page, 'SofaPaint / Comfort Works', margin, height - 23, 8, true, muted);
    await text(
      page,
      `Measurements in ${units === 'in' ? 'inches' : 'cm'} | Archive 29 September 2026`,
      width - 300,
      height - 23,
      8,
      false,
      muted
    );
    if (model) {
      let y = await paragraph(
        page,
        model.product.name + suffix,
        margin,
        height - 48,
        width - margin * 2,
        15,
        true
      );
      y = await paragraph(
        page,
        `${model.selection.scopedReference} | ${model.selection.style} (${model.selection.styleCode}) | ${model.selection.status.toUpperCase()}`,
        margin,
        y - 1,
        width - margin * 2,
        8
      );
      if (model.selection.versionLabel)
        y = await paragraph(
          page,
          model.selection.versionLabel,
          margin,
          y - 1,
          width - margin * 2,
          8
        );
      if (model.detail) {
        await text(
          page,
          model.detail.dimensions
            .map(d => `${d.name}: ${formatMeasurement(d.value, 'cm', units)} ${units}`)
            .join('    '),
          margin,
          y - 2,
          9
        );
        y -= 19;
      }
      rule(page, y + 2);
      return { page, y: y - 14 };
    }
    return { page, y: height - 48 };
  }
  async function embedDiagram(url: string, selectionKey: string) {
    const scoped = `${selectionKey}|${url}`;
    const cacheKey = diagrams.has(scoped) ? scoped : url;
    if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
    const source = diagrams.get(scoped) || diagrams.get(url);
    if (!source) throw new Error('A diagram is missing. Retry it before saving the PDF.');
    let image;
    if (source.startsWith('data:image/png;')) image = await pdf.embedPng(source);
    else if (source.startsWith('data:image/jpeg;')) image = await pdf.embedJpg(source);
    else {
      const picture = new Image();
      picture.src = source;
      await picture.decode();
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / picture.naturalWidth);
      canvas.width = picture.naturalWidth * scale;
      canvas.height = picture.naturalHeight * scale;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      image = await pdf.embedPng(canvas.toDataURL('image/png'));
    }
    imageCache.set(cacheKey, image);
    return image;
  }
  async function tableHeader(page: PDFPage, y: number, end = margin + 515) {
    await text(page, 'Name', margin + 7, y, 8, true, muted);
    await text(page, 'Value', margin + (showTolerances ? 295 : 470), y, 8, true, muted);
    if (showTolerances) {
      await text(page, 'Tolerance (min)', margin + 355, y, 8, true, muted);
      await text(page, 'Tolerance (max)', margin + 442, y, 8, true, muted);
    }
    rule(page, y - 8, margin, end);
    return y - 25;
  }
  if (models.length > 1) {
    let { page, y } = await newPage();
    await text(page, 'Model comparison', margin, y, 16, true);
    y -= 28;
    const labelWidth = 185,
      differenceWidth = 105,
      columnWidth = (width - margin * 2 - labelWidth - differenceWidth) / models.length,
      differenceX = margin + labelWidth + models.length * columnWidth + 7;
    const header = async () => {
      let lowest = y;
      for (let i = 0; i < models.length; i++) {
        const model = models[i],
          x = margin + labelWidth + i * columnWidth;
        let end = await paragraph(page, model.product.name, x + 7, y, columnWidth - 14, 9, true);
        end = await paragraph(
          page,
          `${model.selection.scopedReference}\n${model.selection.style} / ${model.selection.styleCode}\n${model.selection.status}`,
          x + 7,
          end - 2,
          columnWidth - 14,
          7
        );
        lowest = Math.min(lowest, end);
      }
      await text(page, 'Difference', differenceX, y, 8, true, blue);
      await text(
        page,
        models.length === 2 ? 'right - left' : 'max - min',
        differenceX,
        y - 13,
        7,
        false,
        muted
      );
      y = lowest - 10;
      rule(page, y);
      y -= 18;
    };
    await header();
    const compared = comparisonRows(models.map(m => m.detail));
    const rows = [
      ...['width', 'depth', 'height'].map(name => ({
        section: 'Overall dimensions',
        name,
        unit: 'cm',
        values: models.map(model =>
          model.detail?.dimensions.find(d => d.name === name)
            ? { value: model.detail.dimensions.find(d => d.name === name)!.value, min: '', max: '' }
            : null
        ),
      })),
      ...compared,
    ];
    let previous = '';
    for (const row of rows) {
      if (y < 70) {
        ({ page, y } = await newPage());
        await header();
        previous = '';
      }
      if (row.section !== previous) {
        page.drawRectangle({
          x: margin,
          y: y - 4,
          width: width - margin * 2,
          height: 17,
          color: rgb(0.95, 0.96, 0.98),
        });
        await text(page, row.section, margin + 7, y, 8, true, blue);
        y -= 23;
        previous = row.section;
      }
      const wrapped = wrap(`${row.name} (${unitLabel(row.unit, units)})`, labelWidth - 12, 8);
      await paragraph(page, wrapped.join('\n'), margin + 7, y, labelWidth - 12, 8);
      for (let i = 0; i < models.length; i++) {
        const measurement = row.values[i],
          x = margin + labelWidth + i * columnWidth + 7;
        await text(
          page,
          formatMeasurement(measurement?.value || '—', row.unit, units),
          x,
          y,
          10,
          true,
          blue
        );
        if (showTolerances && measurement?.min)
          await text(
            page,
            `${formatMeasurement(measurement.min, row.unit, units)} – ${formatMeasurement(measurement.max, row.unit, units)}`,
            x,
            y - 12,
            7,
            false,
            muted
          );
      }
      const difference = comparisonDifference(
        row.values.map(measurement => measurement?.value ?? null),
        row.unit,
        units
      );
      if (difference.kind !== 'unavailable') {
        await text(
          page,
          `${difference.amount} ${difference.unit}`,
          differenceX,
          y,
          9,
          true,
          difference.kind === 'same' ? rgb(0.09, 0.38, 0.26) : rgb(0.51, 0.31, 0.05)
        );
        await text(
          page,
          difference.kind === 'same' ? 'Same' : difference.mode === 'range' ? 'Range' : 'Different',
          differenceX,
          y - 11,
          7,
          false,
          muted
        );
      }
      y -= Math.max(28, wrapped.length * 12 + 5);
      rule(page, y + 12);
    }
  }
  for (const model of models) {
    if (!model.detail) {
      const { page, y } = await newPage(model);
      await paragraph(
        page,
        model.selection.status === 'unconfirmed'
          ? 'This model exists, but its measurements are unconfirmed. Values and diagrams are withheld.'
          : 'Measurements are unavailable or require review. Values and diagrams are withheld.',
        margin,
        y - 10,
        width - margin * 2,
        11
      );
      continue;
    }
    if (!model.detail.components.length) {
      const { page, y } = await newPage(model);
      await text(page, 'No component measurements supplied.', margin, y, 10);
    }
    for (const component of model.detail.components) {
      let { page, y } = await newPage(model);
      await text(
        page,
        `${component.name} | ${component.quantity} piece(s)${component.skirt ? ` | ${component.skirt}` : ''}`,
        margin,
        y,
        12,
        true
      );
      y -= 20;
      for (let i = 0; i < component.images.length; i += 2) {
        if (y < 270) {
          ({ page, y } = await newPage(model, ' / continued'));
        }
        const batch = component.images.slice(i, i + 2),
          slot = (width - margin * 2 - 14) / 2,
          imageHeight = 155;
        for (let j = 0; j < batch.length; j++) {
          const image = await embedDiagram(batch[j].url, model.selection.key);
          const scaled = image.scaleToFit(slot, imageHeight);
          page.drawImage(image, {
            x: margin + j * (slot + 14) + (slot - scaled.width) / 2,
            y: y - imageHeight + (imageHeight - scaled.height) / 2,
            width: scaled.width,
            height: scaled.height,
          });
        }
        y -= imageHeight + 14;
      }
      if (y < 100) ({ page, y } = await newPage(model, ' / continued'));
      const sidebarY = y;
      const sidebarPage = page;
      await text(page, 'Measurements', margin, y, 11, true);
      y = await tableHeader(page, y - 22);
      for (const measurement of component.measurements) {
        const nameLines = wrap(measurement.name, showTolerances ? 275 : 445, 9);
        const rowHeight = Math.max(23, nameLines.length * 13 + 5);
        if (y - rowHeight < 34) {
          ({ page, y } = await newPage(model, ' / continued'));
          await text(page, component.name, margin, y, 11, true);
          y = await tableHeader(page, y - 22);
        }
        await paragraph(page, measurement.name, margin + 7, y, showTolerances ? 275 : 445, 9);
        await text(
          page,
          formatMeasurement(measurement.value, measurement.unit, units),
          margin + (showTolerances ? 295 : 470),
          y,
          9,
          true,
          blue
        );
        if (showTolerances) {
          await text(
            page,
            formatMeasurement(measurement.min, measurement.unit, units),
            margin + 355,
            y,
            9
          );
          await text(
            page,
            formatMeasurement(measurement.max, measurement.unit, units),
            margin + 442,
            y,
            9
          );
        }
        y -= rowHeight;
        rule(page, y + 7, margin, margin + 515);
      }
      // A separate notes page when the sidebar cannot fit; nothing is clipped.
      const notes = [
        'Attributes',
        ...component.attributes.map(a => `• ${a}`),
        '',
        `Comments: ${component.comments || '—'}`,
        `Lining: ${component.lining || model.detail.lining || '—'}`,
        ...(model.detail.flexifit ? [`Flexifit: ${model.detail.flexifit}`] : []),
      ];
      let notePage = sidebarPage;
      let noteY = sidebarY;
      for (const note of notes) {
        const noteHeight = wrap(note, 220, 9).length * 13 + 7;
        if (noteY - noteHeight < 34) {
          const next = await newPage(model, ' / component notes');
          notePage = next.page;
          noteY = next.y;
          await text(notePage, component.name, margin + 545, noteY, 10, true);
          noteY -= 20;
        }
        noteY = await paragraph(notePage, note, margin + 545, noteY, 220, 9, note === 'Attributes');
        noteY -= 7;
      }
    }
  }
  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++)
    await text(pages[i], `${i + 1} / ${pages.length}`, width - margin - 38, 17, 8, false, muted);
  pdf.setTitle(
    models.length === 1
      ? `${models[0].product.name} — ${units}`
      : `Sofa measurement comparison — ${units}`
  );
  pdf.setCreator('SofaPaint');
  return pdf.save();
}
