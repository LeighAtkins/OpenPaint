import { PDFDocument } from 'pdf-lib';

function safeFieldName(name, fallback) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
}

export async function injectPdfFormFields(pdfBuffer, anchors = []) {
  if (!anchors.length) return pdfBuffer;

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();
  const used = new Set();

  anchors.forEach((anchor, idx) => {
    const page = pages[anchor.pageIndex || 0];
    if (!page) return;

    const nameBase = safeFieldName(anchor.fieldName, `field_${idx + 1}`);
    let finalName = nameBase;
    let suffix = 2;
    while (used.has(finalName)) {
      finalName = `${nameBase}_${suffix}`;
      suffix += 1;
    }
    used.add(finalName);

    const textField = form.createTextField(finalName);
    textField.setText(String(anchor.value || ''));
    const insetX = 3;
    const insetY = 2;
    textField.addToPage(page, {
      x: anchor.x + insetX,
      y: anchor.y + insetY,
      width: Math.max(20, anchor.width - insetX * 2),
      height: Math.max(10, anchor.height - insetY * 2),
      borderWidth: 0,
    });
    textField.setFontSize(10);
  });

  return Buffer.from(await pdfDoc.save());
}
