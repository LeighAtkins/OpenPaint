import {
  PDFDocument,
  degrees,
  drawEllipse,
  drawRectangle,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  TextAlignment,
} from 'pdf-lib';

function safeFieldName(name, fallback) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
}

function createUnitRadioAppearanceProvider() {
  return (_radioGroup, widget) => {
    const { width, height } = widget.getRectangle();
    const size = Math.max(8, Math.min(width, height));
    const x = (width - size) / 2;
    const y = (height - size) / 2;
    const borderWidth = Math.max(1, size * 0.08);
    const dotScale = size * 0.22;
    const square = drawRectangle({
      x,
      y,
      width: size,
      height: size,
      rotate: degrees(0),
      xSkew: degrees(0),
      ySkew: degrees(0),
      borderWidth,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.06, 0.09, 0.16),
    });
    const selectedDot = drawEllipse({
      x: x + size / 2,
      y: y + size / 2,
      xScale: dotScale,
      yScale: dotScale,
      color: rgb(0, 0, 0),
      borderWidth: 0,
    });

    return {
      normal: {
        on: [pushGraphicsState(), ...square, ...selectedDot, popGraphicsState()],
        off: [pushGraphicsState(), ...square, popGraphicsState()],
      },
      down: {
        on: [pushGraphicsState(), ...square, ...selectedDot, popGraphicsState()],
        off: [pushGraphicsState(), ...square, popGraphicsState()],
      },
    };
  };
}

export async function injectPdfFormFields(pdfBuffer, anchors = []) {
  if (!anchors.length) return pdfBuffer;

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const form = pdfDoc.getForm();
  const formFont = await pdfDoc.embedFont(StandardFonts.Courier);
  const pages = pdfDoc.getPages();
  const used = new Set();
  const radioGroups = new Map();

  anchors.forEach((anchor, idx) => {
    const page = pages[anchor.pageIndex || 0];
    if (!page) return;

    const fieldType = String(anchor.fieldType || 'text').toLowerCase();
    const nameBase = safeFieldName(anchor.fieldName, `field_${idx + 1}`);
    if (fieldType === 'radio' || fieldType === 'unit-radio') {
      const pageIndex = Math.max(0, Number(anchor.pageIndex || 0));
      const groupName = safeFieldName(`${nameBase}_${pageIndex + 1}`, `radio_${idx + 1}`);
      let radioGroup = radioGroups.get(groupName);
      if (!radioGroup) {
        radioGroup = form.createRadioGroup(groupName);
        radioGroup.disableOffToggling();
        radioGroups.set(groupName, radioGroup);
      }
      const option = safeFieldName(anchor.fieldOption || `option_${idx + 1}`, `option_${idx + 1}`);
      radioGroup.addOptionToPage(option, page, {
        x: anchor.x,
        y: anchor.y,
        width: Math.max(8, anchor.width),
        height: Math.max(8, anchor.height),
        borderWidth: 0,
      });
      if (String(anchor.value || '').toLowerCase() === 'checked') {
        radioGroup.select(option);
      }
      if (fieldType === 'unit-radio') {
        radioGroup.updateAppearances(createUnitRadioAppearanceProvider());
      }
      return;
    }

    if (fieldType === 'checkbox') {
      let finalName = nameBase;
      let suffix = 2;
      while (used.has(finalName)) {
        finalName = `${nameBase}_${suffix}`;
        suffix += 1;
      }
      used.add(finalName);

      const checkBox = form.createCheckBox(finalName);
      checkBox.addToPage(page, {
        x: anchor.x,
        y: anchor.y,
        width: Math.max(8, anchor.width),
        height: Math.max(8, anchor.height),
        borderWidth: 1,
        borderColor: rgb(0.06, 0.09, 0.16),
      });
      if (String(anchor.value || '').toLowerCase() === 'checked') {
        checkBox.check();
      }
      return;
    }

    let finalName = nameBase;
    let suffix = 2;
    while (used.has(finalName)) {
      finalName = `${nameBase}_${suffix}`;
      suffix += 1;
    }
    used.add(finalName);

    const textField = form.createTextField(finalName);
    textField.setText(String(anchor.value || ''));
    if (Number(anchor.maxLength) > 0) {
      textField.setMaxLength(Math.min(120, Math.max(1, Number(anchor.maxLength))));
    }
    if (String(anchor.textAlign || '').toLowerCase() === 'center') {
      textField.setAlignment(TextAlignment.Center);
    }
    if (anchor.multiline) {
      textField.enableMultiline();
    }
    const insetX = Math.max(0, Number(anchor.paddingLeft || 0));
    const insetRight = Math.max(0, Number(anchor.paddingRight || 0));
    const insetTop = Math.max(0, Number(anchor.paddingTop || 0));
    const insetBottom = Math.max(0, Number(anchor.paddingBottom || 0));
    textField.addToPage(page, {
      x: anchor.x + insetX,
      y: anchor.y + insetBottom,
      width: Math.max(20, anchor.width - insetX - insetRight),
      height: Math.max(10, anchor.height - insetTop - insetBottom),
      borderWidth: Math.max(0, Number(anchor.borderWidth || 0)),
      ...(Number(anchor.borderWidth || 0) > 0 ? { borderColor: rgb(0.06, 0.09, 0.16) } : {}),
    });
    const requestedFontSize = Number(anchor.fontSize);
    textField.setFontSize(
      Number.isFinite(requestedFontSize) ? Math.min(24, Math.max(6, requestedFontSize)) : 10
    );
    textField.updateAppearances(formFont);
  });

  return Buffer.from(await pdfDoc.save());
}
