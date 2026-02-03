// Export utilities for saving multiple images and PDF generation using PDFMake

// Save all images as individual PNG files
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
    const view = views[viewId];

    // Switch to this view temporarily
    await window.app.projectManager.switchView(viewId);

    // Wait a tick for the view to load
    await new Promise(resolve => setTimeout(resolve, 100));

    // Trigger the save
    const canvas = window.app.canvasManager.fabricCanvas;
    const captureFrame = document.getElementById('captureFrame');

    if (!canvas || !captureFrame) {
      console.warn(`[Export] Skipping ${viewId} - canvas or frame not available`);
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
        console.log(`[Export] Saved ${viewId}`);
        resolve();
      });
    });

    // Small delay between downloads
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  alert(`Saved ${viewIds.length} images!`);
};

// Generate PDF with PDFMake (supports form fields)
window.showPDFExportDialog = async function (projectName) {
  projectName = projectName || document.getElementById('projectName')?.value || 'OpenPaint';

  const views = window.app?.projectManager?.views || {};
  const viewIds = Object.keys(views).filter(id => views[id].image);

  if (viewIds.length === 0) {
    alert('No images to export. Please upload images first.');
    return;
  }

  // Create simple dialog
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  overlay.innerHTML = `
    <div style="background: white; border-radius: 12px; padding: 30px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
      <h2 style="margin: 0 0 20px 0; color: #333;">Export PDF - ${projectName}</h2>
      
      <div style="margin-bottom: 20px;">
        <p style="color: #666; margin-bottom: 15px;">
          This will create a PDF with ${viewIds.length} page(s) - one per image view.
        </p>
        
        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">
            Image Quality:
          </label>
          <select id="pdfQuality" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
            <option value="high">High Quality (Larger file)</option>
            <option value="medium" selected>Medium Quality</option>
            <option value="low">Low Quality (Smaller file)</option>
          </select>
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">
            Page Size:
          </label>
          <select id="pdfPageSize" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
            <option value="letter" selected>Letter (8.5" × 11")</option>
            <option value="a4">A4</option>
            <option value="tabloid">Tabloid (11" × 17")</option>
          </select>
        </div>

        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="includeMeasurements" checked style="transform: scale(1.3);">
          <span style="color: #333;">Include measurement labels</span>
        </label>
      </div>

      <div style="display: flex; gap: 10px;">
        <button id="generatePdfBtn" style="flex: 1; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
          Generate PDF
        </button>
        <button id="cancelPdfBtn" style="flex: 1; padding: 12px; background: #6b7280; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
          Cancel
        </button>
      </div>
      
      <div id="pdfProgress" style="display: none; margin-top: 20px; text-align: center;">
        <div style="width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
          <div id="pdfProgressBar" style="width: 0%; height: 100%; background: #3b82f6; transition: width 0.3s;"></div>
        </div>
        <p id="pdfProgressText" style="color: #666; font-size: 14px;">Preparing PDF...</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('cancelPdfBtn').onclick = () => overlay.remove();
  document.getElementById('generatePdfBtn').onclick = async () => {
    const quality = document.getElementById('pdfQuality').value;
    const pageSize = document.getElementById('pdfPageSize').value;
    const includeMeasurements = document.getElementById('includeMeasurements').checked;

    document.getElementById('pdfProgress').style.display = 'block';
    document.getElementById('generatePdfBtn').disabled = true;
    document.getElementById('cancelPdfBtn').disabled = true;

    await generatePDFWithPDFMake(projectName, viewIds, quality, pageSize, includeMeasurements);

    overlay.remove();
  };
};

async function generatePDFWithPDFMake(
  projectName,
  viewIds,
  quality,
  pageSize,
  includeMeasurements
) {
  const progressBar = document.getElementById('pdfProgressBar');
  const progressText = document.getElementById('pdfProgressText');

  // Quality settings - larger scale for higher quality
  const qualityScales = {
    high: 3.0,
    medium: 2.0,
    low: 1.5,
  };
  const scale = qualityScales[quality] || 2.0;

  const pages = [];

  for (let i = 0; i < viewIds.length; i++) {
    const viewId = viewIds[i];
    progressText.textContent = `Processing ${viewId} (${i + 1}/${viewIds.length})...`;
    progressBar.style.width = `${(i / viewIds.length) * 100}%`;

    // Switch to view
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

    // Create high-res canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width * scale;
    tempCanvas.height = height * scale;
    const ctx = tempCanvas.getContext('2d');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(scale, scale);
    ctx.drawImage(canvasEl, left, top, width, height, 0, 0, width, height);

    const imageData = tempCanvas.toDataURL('image/jpeg', 0.95);

    // Build page content
    const pageContent = [];

    // Header
    pageContent.push({
      canvas: [
        {
          type: 'rect',
          x: 0,
          y: 0,
          w: 595,
          h: 40,
          color: '#1e40af',
        },
      ],
      absolutePosition: { x: 0, y: 0 },
    });

    pageContent.push({
      text: projectName,
      style: 'header',
      alignment: 'center',
      margin: [0, 10, 0, 5],
    });

    pageContent.push({
      text: viewId,
      style: 'viewLabel',
      alignment: 'center',
      margin: [0, 0, 0, 15],
    });

    // Image
    const imgAspect = tempCanvas.width / tempCanvas.height;
    let imgWidth = 500;
    let imgHeight = imgWidth / imgAspect;

    if (imgHeight > 400) {
      imgHeight = 400;
      imgWidth = imgHeight * imgAspect;
    }

    pageContent.push({
      image: imageData,
      width: imgWidth,
      alignment: 'center',
      margin: [0, 0, 0, 15],
    });

    // Measurements section
    if (includeMeasurements) {
      const measurements = window.app?.metadataManager?.strokeMeasurements?.[viewId] || {};
      const strokes = Object.keys(measurements);

      if (strokes.length > 0) {
        const currentUnit = document.getElementById('unitSelector')?.value || 'inch';

        // Header with unit selector
        pageContent.push({
          table: {
            widths: ['*', 50, 50],
            body: [
              [
                {
                  text: 'MEASUREMENTS',
                  style: 'measurementHeader',
                  border: [false, false, false, false],
                },
                { text: '☐ cm', style: 'unitOption', border: [false, false, false, false] },
                { text: '☐ inch', style: 'unitOption', border: [false, false, false, false] },
              ],
            ],
          },
          layout: {
            fillColor: '#2962ff',
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            paddingTop: () => 5,
            paddingBottom: () => 5,
          },
          margin: [0, 0, 0, 10],
        });

        // 3-column measurement grid
        const columns = [[], [], []];
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

          const col = idx % 3;
          columns[col].push({
            stack: [
              { text: strokeLabel, bold: true, fontSize: 8, margin: [0, 0, 0, 2] },
              {
                text: measurement || '__________',
                fontSize: 9,
                color: measurement ? '#333' : '#999',
              },
            ],
            margin: [0, 0, 0, 8],
          });
        });

        pageContent.push({
          columns: columns,
          columnGap: 10,
        });
      }
    }

    // Footer
    pageContent.push({
      text: `Generated: ${new Date().toLocaleDateString()} | Page ${i + 1} of ${viewIds.length}`,
      style: 'footer',
      absolutePosition: { x: 40, y: 780 },
    });

    pages.push(pageContent);
  }

  // Define document
  const docDefinition = {
    pageSize: pageSize.toUpperCase(),
    pageMargins: [40, 50, 40, 40],
    content: pages.flat(),
    styles: {
      header: {
        fontSize: 18,
        bold: true,
        color: 'white',
      },
      viewLabel: {
        fontSize: 11,
        color: '#3b82f6',
        bold: true,
      },
      measurementHeader: {
        fontSize: 12,
        bold: true,
        color: 'white',
      },
      unitOption: {
        fontSize: 9,
        color: 'white',
      },
      footer: {
        fontSize: 8,
        color: '#666',
      },
    },
  };

  progressBar.style.width = '100%';
  progressText.textContent = 'Generating PDF...';

  pdfMake.createPdf(docDefinition).download(`${projectName}.pdf`);

  console.log('[PDF] Generated successfully with PDFMake');
}
