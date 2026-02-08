// PDF export utilities (inline version)
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Extracted from index.html inline scripts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export function initPdfExport() {
  // Export utilities for saving multiple images and PDF generation with pdf-lib
  window.saveAllImages = async function () {
    const projectName = document.getElementById('projectName')?.value || 'OpenPaint';
    const views = window.app?.projectManager?.views || {};
    const viewIds = Object.keys(views).filter(id => views[id].image);
    if (viewIds.length === 0) {
      alert('No images to save. Please upload images first.');
      return;
    }
    console.log(`[Export] Saving ${viewIds.length} images`);
    for (const viewId of viewIds) {
      await window.app.projectManager.switchView(viewId);
      await new Promise(resolve => setTimeout(resolve, 100));
      const canvas = window.app.canvasManager.fabricCanvas;
      const captureFrame = document.getElementById('captureFrame');
      if (!canvas || !captureFrame) {
        console.warn(`[Export] Skipping ${viewId}`);
        continue;
      }
      const frameRect = captureFrame.getBoundingClientRect();
      const canvasEl = canvas.lowerCanvasEl;
      const scaleX = canvasEl.width / canvasEl.offsetWidth;
      const scaleY = canvasEl.height / canvasEl.offsetHeight;
      const canvasRect = canvasEl.getBoundingClientRect();
      const left = (frameRect.left - canvasRect.left) * scaleX;
      const top = (frameRect.top - canvasRect.top) * scaleY;
      const width = frameRect.width * scaleX;
      const height = frameRect.height * scaleY;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(canvasEl, left, top, width, height, 0, 0, width, height);
      await new Promise(resolve => {
        tempCanvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${projectName}_${viewId}.png`;
          a.click();
          URL.revokeObjectURL(url);
          resolve();
        });
      });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    alert(`Saved ${viewIds.length} images!`);
  };

  window.showPDFExportDialog = async function (projectName) {
    projectName = projectName || document.getElementById('projectName')?.value || 'OpenPaint';
    const views = window.app?.projectManager?.views || {};
    const viewIds = Object.keys(views).filter(id => views[id].image);
    if (viewIds.length === 0) {
      alert('No images to export. Please upload images first.');
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `<div style="background:white;border-radius:12px;padding:30px;max-width:500px;box-shadow:0 10px 40px rgba(0,0,0,0.3);"><h2 style="margin:0 0 20px 0;color:#333;">Export PDF - ${projectName}</h2><p style="color:#666;margin-bottom:15px;">Creating PDF with ${viewIds.length} page(s) and editable form fields.</p><div style="margin-bottom:15px;"><label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Image Quality:</label><select id="pdfQuality" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"><option value="high">High Quality</option><option value="medium" selected>Medium Quality</option><option value="low">Low Quality</option></select></div><div style="margin-bottom:15px;"><label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Page Size:</label><select id="pdfPageSize" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"><option value="letter" selected>Letter (8.5" × 11")</option><option value="a4">A4</option></select></div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:20px;"><input type="checkbox" id="includeMeasurements" checked style="transform:scale(1.3);"><span style="color:#333;">Include editable measurement fields</span></label><div style="display:flex;gap:10px;"><button id="generatePdfBtn" style="flex:1;padding:12px;background:#3b82f6;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Generate PDF</button><button id="cancelPdfBtn" style="flex:1;padding:12px;background:#6b7280;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Cancel</button></div><div id="pdfProgress" style="display:none;margin-top:20px;text-align:center;"><div style="width:100%;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-bottom:10px;"><div id="pdfProgressBar" style="width:0%;height:100%;background:#3b82f6;transition:width 0.3s;"></div></div><p id="pdfProgressText" style="color:#666;font-size:14px;">Preparing PDF...</p></div></div>`;
    document.body.appendChild(overlay);
    document.getElementById('cancelPdfBtn').onclick = () => overlay.remove();
    document.getElementById('generatePdfBtn').onclick = async () => {
      const quality = document.getElementById('pdfQuality').value;
      const pageSize = document.getElementById('pdfPageSize').value;
      const includeMeasurements = document.getElementById('includeMeasurements').checked;
      document.getElementById('pdfProgress').style.display = 'block';
      document.getElementById('generatePdfBtn').disabled = true;
      document.getElementById('cancelPdfBtn').disabled = true;
      await generatePDFWithPDFLib(projectName, viewIds, quality, pageSize, includeMeasurements);
      overlay.remove();
    };
  };

  async function generatePDFWithPDFLib(
    projectName,
    viewIds,
    quality,
    pageSize,
    includeMeasurements
  ) {
    // PDFDocument, StandardFonts, rgb imported from pdf-lib above
    const progressBar = document.getElementById('pdfProgressBar');
    const progressText = document.getElementById('pdfProgressText');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pageSizes = { letter: { width: 612, height: 792 }, a4: { width: 595, height: 842 } };
    const { width: pageWidth, height: pageHeight } = pageSizes[pageSize] || pageSizes.letter;
    const qualityScales = { high: 3.0, medium: 2.0, low: 1.5 };
    const scale = qualityScales[quality] || 2.0;
    for (let i = 0; i < viewIds.length; i++) {
      const viewId = viewIds[i];
      progressText.textContent = `Processing ${viewId} (${i + 1}/${viewIds.length})...`;
      progressBar.style.width = `${(i / viewIds.length) * 100}%`;
      await window.app.projectManager.switchView(viewId);
      await new Promise(resolve => setTimeout(resolve, 150));
      const canvas = window.app.canvasManager.fabricCanvas;
      const captureFrame = document.getElementById('captureFrame');
      if (!canvas || !captureFrame) continue;
      const frameRect = captureFrame.getBoundingClientRect();
      const canvasEl = canvas.lowerCanvasEl;
      const scaleX = canvasEl.width / canvasEl.offsetWidth;
      const scaleY = canvasEl.height / canvasEl.offsetHeight;
      const canvasRect = canvasEl.getBoundingClientRect();
      const left = (frameRect.left - canvasRect.left) * scaleX;
      const top = (frameRect.top - canvasRect.top) * scaleY;
      const width = frameRect.width * scaleX;
      const height = frameRect.height * scaleY;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width * scale;
      tempCanvas.height = height * scale;
      const ctx = tempCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(scale, scale);
      ctx.drawImage(canvasEl, left, top, width, height, 0, 0, width, height);
      const imageData = tempCanvas.toDataURL('image/jpeg', 0.95);
      const imageBytes = Uint8Array.from(atob(imageData.split(',')[1]), c => c.charCodeAt(0));
      const image = await pdfDoc.embedJpg(imageBytes);
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const form = pdfDoc.getForm();
      page.drawRectangle({
        x: 0,
        y: pageHeight - 50,
        width: pageWidth,
        height: 50,
        color: rgb(0.12, 0.25, 0.69),
      });
      page.drawText(projectName, {
        x: pageWidth / 2 - projectName.length * 6,
        y: pageHeight - 30,
        size: 16,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
      page.drawText(viewId, {
        x: pageWidth / 2 - viewId.length * 4,
        y: pageHeight - 45,
        size: 10,
        font,
        color: rgb(0.8, 0.9, 1),
      });
      const imgAspect = image.width / image.height;
      let imgWidth = 500;
      let imgHeight = imgWidth / imgAspect;
      if (imgHeight > 400) {
        imgHeight = 400;
        imgWidth = imgHeight * imgAspect;
      }
      const imgX = (pageWidth - imgWidth) / 2;
      const imgY = pageHeight - 70 - imgHeight;
      page.drawImage(image, { x: imgX, y: imgY, width: imgWidth, height: imgHeight });
      if (includeMeasurements) {
        const measurements = window.app?.metadataManager?.strokeMeasurements?.[viewId] || {};
        const strokes = Object.keys(measurements);
        if (strokes.length > 0) {
          const currentUnit = document.getElementById('unitSelector')?.value || 'inch';
          const measureY = imgY - 40;
          page.drawRectangle({
            x: 40,
            y: measureY,
            width: pageWidth - 80,
            height: 25,
            color: rgb(0.16, 0.38, 1),
          });
          page.drawText('MEASUREMENTS', {
            x: 50,
            y: measureY + 8,
            size: 12,
            font: fontBold,
            color: rgb(1, 1, 1),
          });
          const cmCheck = form.createCheckBox(`unit_cm_${viewId}`);
          cmCheck.addToPage(page, { x: pageWidth - 150, y: measureY + 5, width: 12, height: 12 });
          if (currentUnit === 'cm') cmCheck.check();
          page.drawText('cm', {
            x: pageWidth - 135,
            y: measureY + 7,
            size: 9,
            font,
            color: rgb(1, 1, 1),
          });
          const inchCheck = form.createCheckBox(`unit_inch_${viewId}`);
          inchCheck.addToPage(page, { x: pageWidth - 80, y: measureY + 5, width: 12, height: 12 });
          if (currentUnit === 'inch') inchCheck.check();
          page.drawText('inch', {
            x: pageWidth - 65,
            y: measureY + 7,
            size: 9,
            font,
            color: rgb(1, 1, 1),
          });
          const colWidth = (pageWidth - 100) / 3;
          let yPos = measureY - 20;
          let col = 0;
          strokes.forEach((strokeLabel, idx) => {
            const m = measurements[strokeLabel];
            let measurement = '';
            if (currentUnit === 'inch') {
              const whole = m.inchWhole || 0;
              const frac = m.inchFraction || 0;
              measurement =
                whole > 0 || frac > 0
                  ? `${whole > 0 ? whole + '"' : ''}${frac > 0 ? ' ' + frac.toFixed(2) + '"' : ''}`.trim()
                  : '';
            } else {
              measurement = m.cm ? `${m.cm.toFixed(1)} cm` : '';
            }
            const x = 50 + col * colWidth;
            page.drawText(strokeLabel, {
              x,
              y: yPos,
              size: 8,
              font: fontBold,
              color: rgb(0, 0, 0),
            });
            const textField = form.createTextField(`${viewId}_${strokeLabel}`);
            textField.setText(measurement);
            textField.addToPage(page, {
              x,
              y: yPos - 18,
              width: colWidth - 10,
              height: 15,
              borderWidth: 1,
              borderColor: rgb(0.4, 0.6, 1),
              backgroundColor: rgb(1, 1, 1),
            });
            textField.setFontSize(9);
            col++;
            if (col >= 3) {
              col = 0;
              yPos -= 30;
            }
          });
        }
      }
      page.drawText(
        `Generated: ${new Date().toLocaleDateString()} | Page ${i + 1} of ${viewIds.length}`,
        { x: 40, y: 20, size: 8, font, color: rgb(0.4, 0.4, 0.4) }
      );
    }
    progressBar.style.width = '100%';
    progressText.textContent = 'Saving PDF...';
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[PDF] Generated with editable form fields using pdf-lib');
  }
}
