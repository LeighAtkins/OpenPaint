// PDF export utilities (inline version)
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Extracted from index.html inline scripts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buildImageExportFilename, sanitizeFilenamePart } from '../utils/naming-utils.js';

function toBaseViewId(scopeOrViewId) {
  const raw = String(scopeOrViewId || '');
  return raw.split('::tab:')[0] || raw;
}

function getScopedMeasurements(scopeKey, options = {}) {
  const includeBase = options.includeBase === true;
  const allMeasurements = window.app?.metadataManager?.strokeMeasurements || {};
  const merged = {};
  const baseViewId = toBaseViewId(scopeKey);
  Object.entries(allMeasurements).forEach(([entryKey, bucket]) => {
    const inScope = entryKey === scopeKey;
    const isBase = includeBase && entryKey === baseViewId;
    if (!inScope && !isBase) {
      return;
    }
    Object.entries(bucket || {}).forEach(([strokeLabel, measurement]) => {
      if (!measurement || typeof measurement !== 'object') return;
      merged[strokeLabel] = measurement;
    });
  });
  return merged;
}

function getScopedStrokeLabels(scopeKey, options = {}) {
  const includeBase = options.includeBase === true;
  const strokeMap = window.app?.metadataManager?.vectorStrokesByImage || {};
  const baseViewId = toBaseViewId(scopeKey);
  const labels = new Set();
  Object.entries(strokeMap).forEach(([entryKey, bucket]) => {
    const inScope = entryKey === scopeKey;
    const isBase = includeBase && entryKey === baseViewId;
    if (!inScope && !isBase) {
      return;
    }
    Object.keys(bucket || {}).forEach(strokeLabel => labels.add(strokeLabel));
  });
  return Array.from(labels).sort((a, b) => a.localeCompare(b));
}

function getPdfPageTargets(viewIds) {
  const ensureTabs =
    typeof window.ensureCaptureTabsForLabel === 'function'
      ? window.ensureCaptureTabsForLabel
      : null;
  const states = window.captureTabsByLabel || {};
  const targets = [];

  viewIds.forEach((viewId, viewIndex) => {
    const state = ensureTabs ? ensureTabs(viewId) : states[viewId];
    const normalTabs = (state?.tabs || []).filter(tab => tab.type !== 'master');

    if (!normalTabs.length) {
      targets.push({
        viewId,
        viewIndex,
        tabId: null,
        tabName: 'Frame 1',
        scopeKey: viewId,
        includeBase: true,
      });
      return;
    }

    const primaryTabId = normalTabs[0].id;
    normalTabs.forEach((tab, tabIndex) => {
      const scopeKey =
        typeof window.getCaptureTabScopeForTab === 'function'
          ? window.getCaptureTabScopeForTab(viewId, tab.id)
          : `${viewId}::tab:${tab.id}`;
      targets.push({
        viewId,
        viewIndex,
        tabId: tab.id,
        tabName: tab.name || `Frame ${tabIndex + 1}`,
        scopeKey,
        includeBase: tab.id === primaryTabId,
      });
    });
  });

  return targets;
}

function sanitizePdfFieldPart(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function createUniquePdfFieldName(baseName, usedNames) {
  let candidate = baseName;
  let suffix = 1;
  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = `${baseName}_${suffix}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function safePdfText(value) {
  return String(value || '').replace(/[^\x20-\x7E]/g, ' ');
}

export function initPdfExport() {
  // Export utilities for saving multiple images and PDF generation with pdf-lib
  window.saveAllImages = async function () {
    const projectName = document.getElementById('projectName')?.value || 'OpenPaint';
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const partLabels = metadata.imagePartLabels || {};
    const views = window.app?.projectManager?.views || {};
    const viewIds = Object.keys(views).filter(id => views[id].image);
    if (viewIds.length === 0) {
      alert('No images to save. Please upload images first.');
      return;
    }
    console.log(`[Export] Saving ${viewIds.length} images`);
    for (let i = 0; i < viewIds.length; i++) {
      const viewId = viewIds[i];
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
          const imageLabel = partLabels[viewId] || '';
          a.download = `${buildImageExportFilename(projectName, imageLabel, i)}.png`;
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
    const pageTargets = getPdfPageTargets(viewIds);
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
      await generatePDFWithPDFLib(projectName, pageTargets, quality, pageSize, includeMeasurements);
      overlay.remove();
    };
  };

  async function generatePDFWithPDFLib(
    projectName,
    pageTargets,
    quality,
    pageSize,
    includeMeasurements
  ) {
    // PDFDocument, StandardFonts, rgb imported from pdf-lib above
    const progressBar = document.getElementById('pdfProgressBar');
    const progressText = document.getElementById('pdfProgressText');
    const pdfDoc = await PDFDocument.create();
    const usedFieldNames = new Set();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const naming = metadata.naming || {};
    const partLabels = metadata.imagePartLabels || {};
    let relations = { checks: [], connections: [] };
    if (typeof window.evaluateMeasurementRelations === 'function') {
      try {
        relations = window.evaluateMeasurementRelations() || relations;
      } catch (error) {
        console.warn('[PDF] Failed to evaluate measurement relations, continuing:', error);
      }
    }
    const pageSizes = { letter: { width: 612, height: 792 }, a4: { width: 595, height: 842 } };
    const { width: pageWidth, height: pageHeight } = pageSizes[pageSize] || pageSizes.letter;
    const qualityScales = { high: 3.0, medium: 2.0, low: 1.5 };
    const scale = qualityScales[quality] || 2.0;
    for (let i = 0; i < pageTargets.length; i++) {
      const target = pageTargets[i];
      const { viewId, tabId, tabName, scopeKey, includeBase } = target;
      progressText.textContent = `Processing ${viewId} - ${tabName} (${i + 1}/${pageTargets.length})...`;
      progressBar.style.width = `${(i / pageTargets.length) * 100}%`;
      await window.app.projectManager.switchView(viewId);
      if (tabId && typeof window.setActiveCaptureTab === 'function') {
        window.setActiveCaptureTab(viewId, tabId);
      }
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
      page.drawText(safePdfText(projectName), {
        x: pageWidth / 2 - projectName.length * 6,
        y: pageHeight - 30,
        size: 16,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
      page.drawText(safePdfText(viewId), {
        x: pageWidth / 2 - viewId.length * 4,
        y: pageHeight - 45,
        size: 10,
        font,
        color: rgb(0.8, 0.9, 1),
      });
      const partLabel =
        partLabels[viewId] || `view-${String(target.viewIndex + 1).padStart(2, '0')}`;
      const pageLabel = `${partLabel} - ${tabName}`;
      page.drawText(safePdfText(pageLabel), {
        x: 36,
        y: pageHeight - 45,
        size: 10,
        font,
        color: rgb(0.8, 0.9, 1),
      });
      const namingLine = [naming.customerName, naming.sofaTypeLabel, naming.jobDate]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' | ');
      if (namingLine) {
        page.drawText(safePdfText(namingLine), {
          x: 36,
          y: pageHeight - 58,
          size: 8,
          font,
          color: rgb(0.88, 0.94, 1),
        });
      }
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
        const measurements = getScopedMeasurements(scopeKey, { scopeKey, includeBase });
        const measuredStrokes = Object.keys(measurements);
        const strokes = Array.from(
          new Set([
            ...getScopedStrokeLabels(scopeKey, { scopeKey, includeBase }),
            ...measuredStrokes,
          ])
        ).sort((a, b) => a.localeCompare(b));
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
          const safeView = sanitizePdfFieldPart(scopeKey, `view_${i + 1}`);
          const cmName = createUniquePdfFieldName(`unit_cm_${safeView}`, usedFieldNames);
          const cmCheck = form.createCheckBox(cmName);
          cmCheck.addToPage(page, { x: pageWidth - 150, y: measureY + 5, width: 12, height: 12 });
          if (currentUnit === 'cm') cmCheck.check();
          page.drawText('cm', {
            x: pageWidth - 135,
            y: measureY + 7,
            size: 9,
            font,
            color: rgb(1, 1, 1),
          });
          const inchName = createUniquePdfFieldName(`unit_inch_${safeView}`, usedFieldNames);
          const inchCheck = form.createCheckBox(inchName);
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
            const m = measurements[strokeLabel] || {};
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
            const safeStroke = sanitizePdfFieldPart(strokeLabel, `stroke_${idx + 1}`);
            const fieldName = createUniquePdfFieldName(
              `m_${safeView}_${safeStroke}`,
              usedFieldNames
            );
            const textField = form.createTextField(fieldName);
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
        `Generated: ${new Date().toLocaleDateString()} | Page ${i + 1} of ${pageTargets.length}`,
        { x: 40, y: 20, size: 8, font, color: rgb(0.4, 0.4, 0.4) }
      );
    }

    // Relationship summary page
    if ((relations.checks?.length || 0) + (relations.connections?.length || 0) > 0) {
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      page.drawRectangle({
        x: 0,
        y: pageHeight - 50,
        width: pageWidth,
        height: 50,
        color: rgb(0.12, 0.25, 0.69),
      });
      page.drawText('Measurement Checks + Connections', {
        x: 36,
        y: pageHeight - 30,
        size: 16,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
      let y = pageHeight - 80;
      page.drawText('Checks', { x: 36, y, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
      y -= 16;
      (relations.checks || []).forEach(check => {
        const status = String(check.status || 'pending').toUpperCase();
        const isPending = String(check.status || '').toLowerCase() === 'pending';
        const text = `${check.formula || check.id || 'Check'} [${status}]${!isPending && check.reason ? ` - ${check.reason}` : ''}`;
        page.drawText(safePdfText(text).slice(0, 120), {
          x: 36,
          y,
          size: 9,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 12;
        if (y < 90) return;
      });
      y -= 6;
      page.drawText('Connections', {
        x: 36,
        y,
        size: 12,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 16;
      (relations.connections || []).forEach(connection => {
        const status = String(connection.status || 'pending').toUpperCase();
        const left = connection.fromDisplay || connection.fromKey || '-';
        const right = connection.toDisplay || connection.toKey || '-';
        const isPending = String(connection.status || '').toLowerCase() === 'pending';
        const label = `${left} <-> ${right} [${status}]${!isPending && connection.reason ? ` - ${connection.reason}` : ''}`;
        page.drawText(safePdfText(label).slice(0, 120), {
          x: 36,
          y,
          size: 9,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 12;
      });
    }

    progressBar.style.width = '100%';
    progressText.textContent = 'Saving PDF...';
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilenamePart(projectName, 'OpenPaint Project')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[PDF] Generated with editable form fields using pdf-lib');
  }
}
