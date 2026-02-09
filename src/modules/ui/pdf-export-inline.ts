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

function getGroupedPdfPageTargets(pageTargets, pieceGroups, partLabels) {
  // Build a map: viewId -> array of targets for that view
  const targetsByView = {};
  pageTargets.forEach(target => {
    if (!targetsByView[target.viewId]) targetsByView[target.viewId] = [];
    targetsByView[target.viewId].push(target);
  });

  const consumed = new Set(); // viewId values consumed into grouped entries
  const grouped = [];

  // For each piece group, render one grouped page with:
  // - main view hero frame (first tab)
  // - all frames from each related view
  (pieceGroups || []).forEach(group => {
    const mainId = group.mainViewId;
    const relatedIds = Array.isArray(group.relatedViewIds) ? group.relatedViewIds : [];
    if (!mainId || consumed.has(mainId)) return;

    const mainTargets = targetsByView[mainId];
    if (!mainTargets?.length) return;

    const validRelatedIds = relatedIds.filter(
      id => id && id !== mainId && !consumed.has(id) && targetsByView[id]?.length
    );
    if (!validRelatedIds.length) {
      return;
    }

    const mainTarget = mainTargets[0];
    const relatedTargets = validRelatedIds.flatMap(id => targetsByView[id] || []);

    consumed.add(mainId);
    validRelatedIds.forEach(id => consumed.add(id));

    grouped.push({
      type: 'grouped',
      mainTarget,
      relatedTargets,
      note: group.label || '',
      partLabels: [
        partLabels[mainId] || `view-${String((mainTarget?.viewIndex || 0) + 1).padStart(2, '0')}`,
        ...validRelatedIds.map(id => {
          const firstTarget = (targetsByView[id] || [])[0];
          return (
            partLabels[id] || `view-${String((firstTarget?.viewIndex || 0) + 1).padStart(2, '0')}`
          );
        }),
      ],
    });
  });

  // Remaining unconsumed views become singles
  pageTargets.forEach(target => {
    if (!consumed.has(target.viewId)) {
      grouped.push({ type: 'single', target });
    }
  });

  return grouped;
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
    const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const naming = metadata.naming || {};
    const partLabels = metadata.imagePartLabels || {};
    // Pre-check whether checks/connections/pieceGroups exist (for page count).
    // Full evaluation is deferred until after the image loop so all views are loaded.
    const metaChecks = Array.isArray(metadata.measurementChecks) ? metadata.measurementChecks : [];
    const metaConnections = Array.isArray(metadata.measurementConnections)
      ? metadata.measurementConnections
      : [];
    const metaPieceGroups = Array.isArray(metadata.pieceGroups) ? metadata.pieceGroups : [];
    const pageSizes = { letter: { width: 612, height: 792 }, a4: { width: 595, height: 842 } };
    const { width: pageWidth, height: pageHeight } = pageSizes[pageSize] || pageSizes.letter;
    const qualityScales = { high: 3.0, medium: 2.0, low: 1.5 };
    const scale = qualityScales[quality] || 2.0;

    // ── Design System ────────────────────────────────────────────────
    const colors = {
      headerBg: rgb(0.09, 0.11, 0.2), // dark navy
      accentStripe: rgb(0.22, 0.47, 0.96), // vivid blue
      accentLight: rgb(0.92, 0.95, 1.0), // light blue tint
      white: rgb(1, 1, 1),
      textPrimary: rgb(0.12, 0.12, 0.14),
      textSecondary: rgb(0.4, 0.42, 0.48),
      textMuted: rgb(0.58, 0.6, 0.65),
      border: rgb(0.82, 0.84, 0.88),
      borderLight: rgb(0.91, 0.93, 0.95),
      tableRowAlt: rgb(0.96, 0.97, 0.99),
      frameShadow: rgb(0.78, 0.8, 0.84),
      frameBorder: rgb(0.7, 0.72, 0.76),
      statusPass: rgb(0.13, 0.59, 0.33),
      statusFail: rgb(0.82, 0.18, 0.18),
      statusWarn: rgb(0.8, 0.58, 0.08),
      statusPending: rgb(0.55, 0.57, 0.62),
      badgePassBg: rgb(0.88, 0.97, 0.91),
      badgeFailBg: rgb(0.99, 0.9, 0.9),
      badgeWarnBg: rgb(1.0, 0.96, 0.88),
      badgePendBg: rgb(0.93, 0.94, 0.95),
    };
    const layout = {
      marginX: 40,
      headerH: 56,
      accentH: 3,
      footerH: 32,
      contentTop: pageHeight - 56 - 3 - 16, // below header + accent + gap
      contentBottom: 32 + 12, // above footer + gap
      contentWidth: pageWidth - 80,
    };
    const typo = {
      title: 18,
      subtitle: 10,
      sectionHeader: 13,
      body: 10,
      table: 9,
      tableHeader: 9,
      small: 8,
      footer: 7,
    };

    // totalPages is computed after grouping; use a mutable variable so
    // header/footer helpers (closed over this scope) can reference it.
    let totalPages = pageTargets.length; // updated below after grouping

    // ── Helper Functions ─────────────────────────────────────────────

    function centerText(text, y, size, usedFont, color, page) {
      const w = usedFont.widthOfTextAtSize(safePdfText(text), size);
      page.drawText(safePdfText(text), {
        x: (pageWidth - w) / 2,
        y,
        size,
        font: usedFont,
        color,
      });
    }

    function rightAlignText(text, y, size, usedFont, color, page, rightMargin) {
      const w = usedFont.widthOfTextAtSize(safePdfText(text), size);
      page.drawText(safePdfText(text), {
        x: rightMargin - w,
        y,
        size,
        font: usedFont,
        color,
      });
    }

    function drawHeader(page, titleText, subtitleText, namingText, pageNum) {
      // Dark navy header bar
      page.drawRectangle({
        x: 0,
        y: pageHeight - layout.headerH,
        width: pageWidth,
        height: layout.headerH,
        color: colors.headerBg,
      });
      // Accent stripe below header
      page.drawRectangle({
        x: 0,
        y: pageHeight - layout.headerH - layout.accentH,
        width: pageWidth,
        height: layout.accentH,
        color: colors.accentStripe,
      });
      // Project name — centered
      centerText(titleText, pageHeight - 24, typo.title, fontBold, colors.white, page);
      // Naming line — centered below title
      if (namingText) {
        centerText(namingText, pageHeight - 38, typo.small, font, rgb(0.72, 0.78, 0.9), page);
      }
      // Subtitle (page label) — left
      if (subtitleText) {
        page.drawText(safePdfText(subtitleText), {
          x: layout.marginX,
          y: pageHeight - 52,
          size: typo.subtitle,
          font,
          color: rgb(0.6, 0.68, 0.82),
        });
      }
      // Page number — right
      rightAlignText(
        `Page ${pageNum} of ${totalPages}`,
        pageHeight - 52,
        typo.subtitle,
        font,
        rgb(0.6, 0.68, 0.82),
        page,
        pageWidth - layout.marginX
      );
    }

    function drawFooter(page, pageNum) {
      const footerY = 20;
      // Separator line
      page.drawRectangle({
        x: layout.marginX,
        y: footerY + 10,
        width: layout.contentWidth,
        height: 0.5,
        color: colors.border,
      });
      // Date left
      page.drawText(safePdfText(`Generated: ${new Date().toLocaleDateString()}`), {
        x: layout.marginX,
        y: footerY,
        size: typo.footer,
        font,
        color: colors.textMuted,
      });
      // Page right
      rightAlignText(
        `Page ${pageNum} of ${totalPages}`,
        footerY,
        typo.footer,
        font,
        colors.textMuted,
        page,
        pageWidth - layout.marginX
      );
    }

    function drawImageFrame(page, image, maxWidth, maxHeight, topY, columnOpts) {
      // columnOpts: optional { columnX, columnWidth } for half-page columns
      const imgAspect = image.width / image.height;
      let imgWidth = maxWidth;
      let imgHeight = imgWidth / imgAspect;
      if (imgHeight > maxHeight) {
        imgHeight = maxHeight;
        imgWidth = imgHeight * imgAspect;
      }
      // Center within column or full page
      const colX = columnOpts?.columnX ?? 0;
      const colW = columnOpts?.columnWidth ?? pageWidth;
      const imgX = colX + (colW - imgWidth) / 2;
      const imgY = topY - imgHeight;
      // Shadow (offset rectangle)
      page.drawRectangle({
        x: imgX + 2,
        y: imgY - 2,
        width: imgWidth,
        height: imgHeight,
        color: colors.frameShadow,
      });
      // White mat border
      const pad = 4;
      page.drawRectangle({
        x: imgX - pad,
        y: imgY - pad,
        width: imgWidth + pad * 2,
        height: imgHeight + pad * 2,
        color: colors.white,
        borderColor: colors.frameBorder,
        borderWidth: 0.75,
      });
      // Image
      page.drawImage(image, { x: imgX, y: imgY, width: imgWidth, height: imgHeight });
      return { imgX, imgY, imgWidth, imgHeight };
    }

    function drawSectionHeader(page, text, y, startX) {
      const x = startX ?? layout.marginX;
      page.drawText(safePdfText(text), {
        x,
        y,
        size: typo.sectionHeader,
        font: fontBold,
        color: colors.textPrimary,
      });
      // Accent underline
      const textW = fontBold.widthOfTextAtSize(safePdfText(text), typo.sectionHeader);
      page.drawRectangle({
        x,
        y: y - 4,
        width: textW + 8,
        height: 2,
        color: colors.accentStripe,
      });
      return y - 22;
    }

    function drawStatusBadge(page, status, x, y) {
      const s = String(status || 'pending').toLowerCase();
      const labelMap = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', pending: 'PENDING' };
      const bgMap = {
        pass: colors.badgePassBg,
        fail: colors.badgeFailBg,
        warn: colors.badgeWarnBg,
        pending: colors.badgePendBg,
      };
      const fgMap = {
        pass: colors.statusPass,
        fail: colors.statusFail,
        warn: colors.statusWarn,
        pending: colors.statusPending,
      };
      const label = labelMap[s] || 'PENDING';
      const bg = bgMap[s] || colors.badgePendBg;
      const fg = fgMap[s] || colors.statusPending;
      const badgeW = fontBold.widthOfTextAtSize(label, 7) + 10;
      const badgeH = 12;
      // Badge background
      page.drawRectangle({
        x,
        y: y - 2,
        width: badgeW,
        height: badgeH,
        color: bg,
        borderColor: fg,
        borderWidth: 0.5,
      });
      // Badge text
      page.drawText(label, {
        x: x + 5,
        y: y + 1,
        size: 7,
        font: fontBold,
        color: fg,
      });
      return badgeW;
    }

    function drawMeasurementTable(
      page,
      strokes,
      measurements,
      currentUnit,
      scopeKey,
      pageIndex,
      form,
      columnOpts
    ) {
      // columnOpts: optional { tableX, tableW } for column-scoped tables
      const safeView = sanitizePdfFieldPart(scopeKey, `view_${pageIndex + 1}`);
      const tableX = columnOpts?.tableX ?? layout.marginX;
      const tableW = columnOpts?.tableW ?? layout.contentWidth;
      const rowH = 22;
      const headerH = 20;
      const labelColW = tableW * 0.45;
      const valueColW = tableW * 0.55;

      // Start Y — called after image frame, caller passes startY
      return function (startY) {
        let y = startY;

        // Section header
        y = drawSectionHeader(page, 'Measurements', y, tableX);
        y -= 2;

        // Unit checkboxes row
        const unitRowY = y;
        page.drawText('Unit:', {
          x: tableX,
          y: unitRowY,
          size: typo.small,
          font: fontBold,
          color: colors.textSecondary,
        });
        const cmName = createUniquePdfFieldName(`unit_cm_${safeView}`, usedFieldNames);
        const cmCheck = form.createCheckBox(cmName);
        cmCheck.addToPage(page, { x: tableX + 32, y: unitRowY - 2, width: 10, height: 10 });
        if (currentUnit === 'cm') cmCheck.check();
        page.drawText('cm', {
          x: tableX + 45,
          y: unitRowY,
          size: typo.small,
          font,
          color: colors.textSecondary,
        });
        const inchName = createUniquePdfFieldName(`unit_inch_${safeView}`, usedFieldNames);
        const inchCheck = form.createCheckBox(inchName);
        inchCheck.addToPage(page, { x: tableX + 68, y: unitRowY - 2, width: 10, height: 10 });
        if (currentUnit === 'inch') inchCheck.check();
        page.drawText('inch', {
          x: tableX + 81,
          y: unitRowY,
          size: typo.small,
          font,
          color: colors.textSecondary,
        });
        y -= 18;

        // Table header row
        page.drawRectangle({
          x: tableX,
          y: y - headerH + 6,
          width: tableW,
          height: headerH,
          color: colors.headerBg,
        });
        page.drawText('Label', {
          x: tableX + 8,
          y: y - 8,
          size: typo.tableHeader,
          font: fontBold,
          color: colors.white,
        });
        page.drawText('Measurement', {
          x: tableX + labelColW + 8,
          y: y - 8,
          size: typo.tableHeader,
          font: fontBold,
          color: colors.white,
        });
        y -= headerH + 2;

        // Table rows
        strokes.forEach((strokeLabel, idx) => {
          if (y < layout.contentBottom + rowH) return; // don't overflow into footer

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

          // Alternating row background
          if (idx % 2 === 0) {
            page.drawRectangle({
              x: tableX,
              y: y - rowH + 8,
              width: tableW,
              height: rowH,
              color: colors.tableRowAlt,
            });
          }

          // Row border bottom
          page.drawRectangle({
            x: tableX,
            y: y - rowH + 8,
            width: tableW,
            height: 0.5,
            color: colors.borderLight,
          });

          // Label text
          page.drawText(safePdfText(strokeLabel), {
            x: tableX + 8,
            y: y - 6,
            size: typo.table,
            font: fontBold,
            color: colors.textPrimary,
          });

          // Editable form field for value
          const safeStroke = sanitizePdfFieldPart(strokeLabel, `stroke_${idx + 1}`);
          const fieldName = createUniquePdfFieldName(`m_${safeView}_${safeStroke}`, usedFieldNames);
          const textField = form.createTextField(fieldName);
          textField.setText(measurement);
          textField.addToPage(page, {
            x: tableX + labelColW + 6,
            y: y - rowH + 10,
            width: valueColW - 14,
            height: rowH - 4,
            borderWidth: 0.75,
            borderColor: colors.border,
            backgroundColor: colors.white,
          });
          textField.setFontSize(typo.table);

          y -= rowH;
        });

        // Table outer border
        const tableTopY = startY - 18 - 2; // after unit row
        const tableBottomY = y + 8;
        if (tableTopY > tableBottomY) {
          page.drawRectangle({
            x: tableX,
            y: tableBottomY,
            width: tableW,
            height: tableTopY - tableBottomY + headerH,
            borderColor: colors.border,
            borderWidth: 0.75,
          });
        }

        return y;
      };
    }

    // ── Canvas Capture Helper ────────────────────────────────────────
    async function captureViewImage(viewId, tabId) {
      await window.app.projectManager.switchView(viewId);
      if (tabId && typeof window.setActiveCaptureTab === 'function') {
        window.setActiveCaptureTab(viewId, tabId);
      }
      await new Promise(resolve => setTimeout(resolve, 150));

      const canvas = window.app.canvasManager.fabricCanvas;
      const captureFrame = document.getElementById('captureFrame');
      if (!canvas || !captureFrame) return null;

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
      return pdfDoc.embedJpg(imageBytes);
    }

    function getTargetStrokes(scopeKey, includeBase) {
      if (!includeMeasurements) return { strokes: [], measurements: {} };
      const measurements = getScopedMeasurements(scopeKey, { scopeKey, includeBase });
      const measuredStrokes = Object.keys(measurements);
      const strokes = Array.from(
        new Set([...getScopedStrokeLabels(scopeKey, { scopeKey, includeBase }), ...measuredStrokes])
      ).sort((a, b) => a.localeCompare(b));
      return { strokes, measurements };
    }

    // ── Build grouped targets ─────────────────────────────────────────
    const groupedTargets = getGroupedPdfPageTargets(pageTargets, metaPieceGroups, partLabels);
    const hasRelationshipPage = metaChecks.length > 0 || metaConnections.length > 0;
    totalPages = groupedTargets.length + (hasRelationshipPage ? 1 : 0);

    // ── Image Pages ──────────────────────────────────────────────────
    const namingLine = [naming.customerName, naming.sofaTypeLabel, naming.jobDate]
      .map(part => String(part || '').trim())
      .filter(Boolean)
      .join('  |  ');
    const frameCountByView = pageTargets.reduce((acc, target) => {
      acc[target.viewId] = (acc[target.viewId] || 0) + 1;
      return acc;
    }, {});
    const formatTargetDisplayName = target => {
      const partLabel = partLabels[target.viewId] || target.viewId;
      const tabName = String(target.tabName || '').trim();
      const frameCount = frameCountByView[target.viewId] || 1;
      const isSingleFrameOne = frameCount <= 1 && /^frame\s*1$/i.test(tabName);
      if (!tabName || isSingleFrameOne) return partLabel;
      return `${partLabel} - ${tabName}`;
    };

    for (let i = 0; i < groupedTargets.length; i++) {
      const entry = groupedTargets[i];
      const pageNum = i + 1;

      if (entry.type === 'grouped') {
        progressText.textContent = `Processing grouped page (${i + 1}/${groupedTargets.length})...`;
        progressBar.style.width = `${(i / groupedTargets.length) * 100}%`;

        const heroTarget = entry.mainTarget;
        const heroImage = heroTarget
          ? await captureViewImage(heroTarget.viewId, heroTarget.tabId)
          : null;
        if (!heroImage) continue;

        const relatedFrames = [];
        for (const relatedTarget of entry.relatedTargets || []) {
          const image = await captureViewImage(relatedTarget.viewId, relatedTarget.tabId);
          if (!image) continue;
          relatedFrames.push({ target: relatedTarget, image });
        }

        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const form = pdfDoc.getForm();
        const subtitle = (entry.partLabels || []).filter(Boolean).join(' + ');
        drawHeader(page, projectName, subtitle, namingLine, pageNum);

        const currentUnit = document.getElementById('unitSelector')?.value || 'inch';
        const splitGap = 14;
        const leftPaneW = layout.contentWidth * 0.56;
        const rightPaneW = layout.contentWidth - leftPaneW - splitGap;
        const leftPaneX = layout.marginX;
        const rightPaneX = leftPaneX + leftPaneW + splitGap;

        const topStartY = layout.contentTop;
        const leftStartY = drawSectionHeader(page, 'Main Piece', topStartY, leftPaneX);
        const rightStartY = drawSectionHeader(page, 'Main Measurements', topStartY, rightPaneX);

        const heroFrame = drawImageFrame(page, heroImage, leftPaneW - 10, 250, leftStartY + 2, {
          columnX: leftPaneX,
          columnWidth: leftPaneW,
        });
        page.drawText(safePdfText(`${formatTargetDisplayName(heroTarget)} (main)`).slice(0, 64), {
          x: leftPaneX + 4,
          y: heroFrame.imgY - 12,
          size: typo.small,
          font,
          color: colors.textSecondary,
        });

        const heroData = getTargetStrokes(heroTarget.scopeKey, heroTarget.includeBase);
        let rightEndY = rightStartY;
        if (heroData.strokes.length > 0) {
          const drawMainTable = drawMeasurementTable(
            page,
            heroData.strokes,
            heroData.measurements,
            currentUnit,
            heroTarget.scopeKey,
            i,
            form,
            { tableX: rightPaneX, tableW: rightPaneW }
          );
          rightEndY = drawMainTable(rightStartY);
        }

        const relatedRows = [];
        (entry.relatedTargets || []).forEach(target => {
          const { strokes, measurements } = getTargetStrokes(target.scopeKey, target.includeBase);
          const targetName = formatTargetDisplayName(target);
          strokes.forEach((strokeLabel, idx) => {
            const m = measurements[strokeLabel] || {};
            let measurementValue = '';
            if (currentUnit === 'inch') {
              const whole = m.inchWhole || 0;
              const frac = m.inchFraction || 0;
              measurementValue =
                whole > 0 || frac > 0
                  ? `${whole > 0 ? whole + '"' : ''}${frac > 0 ? ' ' + frac.toFixed(2) + '"' : ''}`.trim()
                  : '';
            } else {
              measurementValue = m.cm ? `${m.cm.toFixed(1)} cm` : '';
            }
            relatedRows.push({
              targetName,
              strokeLabel,
              measurementValue,
              scopeKey: target.scopeKey,
              rowIndex: idx,
            });
          });
        });

        const relatedRowsLimit = 8;
        const visibleRelatedRows = relatedRows.slice(0, relatedRowsLimit);
        const relatedTableH =
          visibleRelatedRows.length > 0 ? 32 + visibleRelatedRows.length * 18 : 0;
        const relatedTableY = layout.contentBottom + 6;
        const relatedGridBottom = relatedTableY + relatedTableH + 10;

        const relatedSectionTop = Math.min(heroFrame.imgY - 24, rightEndY - 12);
        if (relatedFrames.length > 0) {
          const sectionTop = drawSectionHeader(
            page,
            'Related Frames',
            relatedSectionTop,
            layout.marginX
          );
          const sectionBottom = Math.max(layout.contentBottom + 48, relatedGridBottom);
          const sectionHeight = Math.max(70, sectionTop - sectionBottom);

          const maxCols = 4;
          const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(relatedFrames.length))));
          const rows = Math.max(1, Math.ceil(relatedFrames.length / cols));
          const gap = 8;
          const cellW = (layout.contentWidth - gap * (cols - 1)) / cols;
          const cellH = (sectionHeight - gap * (rows - 1)) / rows;

          relatedFrames.forEach((frameEntry, idx) => {
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            const colX = layout.marginX + col * (cellW + gap);
            const rowTop = sectionTop - row * (cellH + gap);
            const frame = drawImageFrame(page, frameEntry.image, cellW - 8, cellH - 18, rowTop, {
              columnX: colX,
              columnWidth: cellW,
            });
            const caption = formatTargetDisplayName(frameEntry.target);
            page.drawText(safePdfText(caption).slice(0, 36), {
              x: colX + 2,
              y: Math.max(sectionBottom, frame.imgY - 10),
              size: typo.small,
              font,
              color: colors.textSecondary,
            });
          });
        }

        if (visibleRelatedRows.length > 0) {
          const boxX = layout.marginX;
          const boxY = relatedTableY;
          const boxW = layout.contentWidth;
          const boxH = relatedTableH;
          const partColW = boxW * 0.5;
          const labelColW = boxW * 0.2;
          const valueColW = boxW - partColW - labelColW;

          page.drawRectangle({
            x: boxX,
            y: boxY,
            width: boxW,
            height: boxH,
            color: colors.accentLight,
            borderColor: colors.border,
            borderWidth: 0.75,
          });

          page.drawText('Related Measurements', {
            x: boxX + 8,
            y: boxY + boxH - 13,
            size: typo.tableHeader,
            font: fontBold,
            color: colors.textPrimary,
          });

          const headerY = boxY + boxH - 26;
          page.drawRectangle({
            x: boxX + 1,
            y: headerY - 2,
            width: boxW - 2,
            height: 14,
            color: colors.headerBg,
          });
          page.drawText('Part / Frame', {
            x: boxX + 6,
            y: headerY + 2,
            size: typo.small,
            font: fontBold,
            color: colors.white,
          });
          page.drawText('Label', {
            x: boxX + partColW + 6,
            y: headerY + 2,
            size: typo.small,
            font: fontBold,
            color: colors.white,
          });
          page.drawText('Value', {
            x: boxX + partColW + labelColW + 6,
            y: headerY + 2,
            size: typo.small,
            font: fontBold,
            color: colors.white,
          });

          visibleRelatedRows.forEach((row, idx) => {
            const rowY = headerY - 18 * (idx + 1);
            if (idx % 2 === 0) {
              page.drawRectangle({
                x: boxX + 1,
                y: rowY,
                width: boxW - 2,
                height: 18,
                color: colors.white,
              });
            }
            page.drawText(safePdfText(row.targetName).slice(0, 38), {
              x: boxX + 6,
              y: rowY + 4,
              size: typo.small,
              font,
              color: colors.textPrimary,
            });
            page.drawText(safePdfText(row.strokeLabel).slice(0, 16), {
              x: boxX + partColW + 6,
              y: rowY + 4,
              size: typo.small,
              font: fontBold,
              color: colors.textPrimary,
            });

            const safeScope = sanitizePdfFieldPart(row.scopeKey, `scope_${i + 1}`);
            const safeStroke = sanitizePdfFieldPart(row.strokeLabel, `s_${idx + 1}`);
            const fieldName = createUniquePdfFieldName(
              `gm_${safeScope}_${safeStroke}_${row.rowIndex + 1}`,
              usedFieldNames
            );
            const textField = form.createTextField(fieldName);
            textField.setText(row.measurementValue || '');
            textField.addToPage(page, {
              x: boxX + partColW + labelColW + 4,
              y: rowY + 2,
              width: valueColW - 10,
              height: 14,
              borderWidth: 0.75,
              borderColor: colors.border,
              backgroundColor: colors.white,
            });
            textField.setFontSize(typo.small);
          });

          if (relatedRows.length > relatedRowsLimit) {
            page.drawText(`+${relatedRows.length - relatedRowsLimit} more`, {
              x: boxX + 8,
              y: boxY + 4,
              size: typo.small,
              font,
              color: colors.textMuted,
            });
          }
        }

        drawFooter(page, pageNum);
      } else {
        // ── Single page (existing logic) ──
        const target = entry.target;
        const { viewId, tabId, tabName, scopeKey, includeBase } = target;
        progressText.textContent = `Processing ${viewId} - ${tabName} (${i + 1}/${groupedTargets.length})...`;
        progressBar.style.width = `${(i / groupedTargets.length) * 100}%`;

        const image = await captureViewImage(viewId, tabId);
        if (!image) continue;

        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const form = pdfDoc.getForm();

        // Page label
        const partLabel =
          partLabels[viewId] || `view-${String(target.viewIndex + 1).padStart(2, '0')}`;
        const pageLabel = `${partLabel} - ${tabName}`;

        // Header
        drawHeader(page, projectName, pageLabel, namingLine, pageNum);

        // Image frame — allocate space based on whether we have measurements
        const { strokes, measurements } = getTargetStrokes(scopeKey, includeBase);

        const hasMeasurements = strokes.length > 0;
        // Reserve space: if measurements exist, cap image height to leave room for table
        const maxImgH = hasMeasurements
          ? Math.min(340, layout.contentTop - layout.contentBottom - strokes.length * 22 - 80)
          : layout.contentTop - layout.contentBottom - 20;
        const imgMaxH = Math.max(180, maxImgH);

        const { imgY } = drawImageFrame(
          page,
          image,
          layout.contentWidth - 20,
          imgMaxH,
          layout.contentTop
        );

        // Measurements table
        if (hasMeasurements) {
          const currentUnit = document.getElementById('unitSelector')?.value || 'inch';
          const tableStartY = imgY - 16;
          const drawTable = drawMeasurementTable(
            page,
            strokes,
            measurements,
            currentUnit,
            scopeKey,
            i,
            form
          );
          drawTable(tableStartY);
        }

        // Footer
        drawFooter(page, pageNum);
      }
    }

    // ── Evaluate relationships AFTER image loop (all views now loaded) ──
    let relations = { checks: [], connections: [], pieceGroups: [] };
    if (hasRelationshipPage && typeof window.evaluateMeasurementRelations === 'function') {
      try {
        relations = window.evaluateMeasurementRelations() || relations;
      } catch (error) {
        console.warn('[PDF] Failed to evaluate measurement relations, continuing:', error);
      }
    }

    // ── Relationship Summary Page ────────────────────────────────────
    if (hasRelationshipPage) {
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const pageNum = groupedTargets.length + 1;

      drawHeader(page, projectName, 'Measurement Checks & Connections', namingLine, pageNum);

      let y = layout.contentTop;
      const cardPadX = 10;
      const cardW = layout.contentWidth;

      // Helper to start a new page if needed
      const checkPageBreak = neededHeight => {
        if (y - neededHeight < layout.contentBottom) {
          return false;
        }
        return true;
      };

      // ── Checks Section ──
      if (relations.checks?.length > 0) {
        y = drawSectionHeader(page, 'Checks', y);
        y -= 4;

        relations.checks.forEach(check => {
          if (!checkPageBreak(42)) return;

          const cardH = 36;
          // Card background
          page.drawRectangle({
            x: layout.marginX,
            y: y - cardH,
            width: cardW,
            height: cardH,
            color: colors.accentLight,
            borderColor: colors.borderLight,
            borderWidth: 0.5,
          });

          // Status badge
          const badgeW = drawStatusBadge(page, check.status, layout.marginX + cardPadX, y - 10);

          // Formula in monospace
          const formulaText = safePdfText(check.formula || check.id || 'Check');
          page.drawText(formulaText.slice(0, 80), {
            x: layout.marginX + cardPadX + badgeW + 8,
            y: y - 10,
            size: typo.table,
            font: fontMono,
            color: colors.textPrimary,
          });

          // Reason (if not pending)
          const isPending = String(check.status || '').toLowerCase() === 'pending';
          if (!isPending && check.reason) {
            page.drawText(safePdfText(check.reason).slice(0, 100), {
              x: layout.marginX + cardPadX,
              y: y - 26,
              size: typo.small,
              font,
              color: colors.textSecondary,
            });
          }

          y -= cardH + 6;
        });

        y -= 8;
      }

      // ── Connections Section (per-measurement links with status) ──
      if (relations.connections?.length > 0) {
        if (checkPageBreak(40)) {
          y = drawSectionHeader(page, 'Cross-image Connections', y);
          y -= 4;

          relations.connections.forEach(connection => {
            if (!checkPageBreak(42)) return;

            const cardH = 36;
            // Card background
            page.drawRectangle({
              x: layout.marginX,
              y: y - cardH,
              width: cardW,
              height: cardH,
              color: colors.accentLight,
              borderColor: colors.borderLight,
              borderWidth: 0.5,
            });

            // Status badge
            const badgeW = drawStatusBadge(
              page,
              connection.status,
              layout.marginX + cardPadX,
              y - 10
            );

            // Connection text: "FromDisplay <-> ToDisplay"
            const fromLabel = safePdfText(connection.fromDisplay || connection.fromKey || '-');
            const toLabel = safePdfText(connection.toDisplay || connection.toKey || '-');
            const connText = `${fromLabel}  <->  ${toLabel}`;
            page.drawText(connText.slice(0, 80), {
              x: layout.marginX + cardPadX + badgeW + 8,
              y: y - 10,
              size: typo.table,
              font: fontMono,
              color: colors.textPrimary,
            });

            // Reason line
            const isPending = String(connection.status || '').toLowerCase() === 'pending';
            if (!isPending && connection.reason) {
              page.drawText(safePdfText(connection.reason).slice(0, 100), {
                x: layout.marginX + cardPadX,
                y: y - 26,
                size: typo.small,
                font,
                color: colors.textSecondary,
              });
            }

            y -= cardH + 6;
          });

          y -= 8;
        }
      }

      // ── Piece Groups Section (lightweight listing) ──
      const summaryPieceGroups = relations.pieceGroups || metaPieceGroups;
      if (summaryPieceGroups.length > 0) {
        if (checkPageBreak(40)) {
          y = drawSectionHeader(page, 'Piece Groups', y);
          page.drawText('Grouped images appear side-by-side in the PDF.', {
            x: layout.marginX,
            y: y + 4,
            size: typo.small,
            font,
            color: colors.textSecondary,
          });
          y -= 14;

          summaryPieceGroups.forEach((group, gIdx) => {
            if (!checkPageBreak(22)) return;

            const rowH = 18;
            if (gIdx % 2 === 0) {
              page.drawRectangle({
                x: layout.marginX,
                y: y - rowH + 4,
                width: cardW,
                height: rowH,
                color: colors.tableRowAlt,
              });
            }

            const mainLabel = safePdfText(partLabels[group.mainViewId] || group.mainViewId || '-');
            const relatedLabels = (group.relatedViewIds || [])
              .map(id => safePdfText(partLabels[id] || id || '-'))
              .join(', ');
            const groupText = `${mainLabel}  +  ${relatedLabels || 'none'}`;
            page.drawText(groupText.slice(0, 90), {
              x: layout.marginX + cardPadX,
              y: y - 8,
              size: typo.table,
              font: fontBold,
              color: colors.textPrimary,
            });

            y -= rowH + 2;
          });
        }
      }

      drawFooter(page, pageNum);
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
