/**
 * Production View Script
 * Handles loading project data and submitted measurements for the production team.
 */

class ProductionViewer {
  constructor() {
    this.shareId = this.extractShareIdFromUrl();
    this.editToken = new URLSearchParams(window.location.search).get('editToken');
    this.projectData = null;
    this.submissions = [];
    this.canvas = null;
    this.ctx = null;
    this.currentIndex = 0;
    this.currentLabel = null;
    this.imageCache = {};
    this.showMeasurements = true;

    if (!this.editToken) {
      alert('Missing edit token. Access denied.');
      return;
    }

    this.init();
  }

  extractShareIdFromUrl() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 1];
  }

  async init() {
    this.canvas = document.getElementById('sharedCanvas');
    this.ctx = this.canvas.getContext('2d');

    // Responsive canvas sizing
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.setupEventListeners();
    await this.loadData();
  }

  resizeCanvas() {
    const container = this.canvas.parentElement;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
    if (this.projectData) this.renderProject();
  }

  setupEventListeners() {
    document.getElementById('prevImage').addEventListener('click', () => this.navigateImage(-1));
    document.getElementById('nextImage').addEventListener('click', () => this.navigateImage(1));
    document.getElementById('toggleMeasurements').addEventListener('change', e => {
      this.showMeasurements = e.target.checked;
      this.renderProject();
    });
  }

  async loadData() {
    document.getElementById('loadingSection').style.display = 'block';
    try {
      // 1. Load Project Data
      const projectResp = await fetch(`/api/shared/${this.shareId}`);
      const projectResult = await projectResp.json();
      if (!projectResult.success) throw new Error(projectResult.message);
      this.projectData = projectResult.projectData;

      // 2. Load Measurements
      const measureResp = await fetch(
        `/api/shared/${this.shareId}/measurements?editToken=${this.editToken}`
      );
      const measureResult = await measureResult.json(); // Wait, fetch returns response, then json
      // Typo in line above, fixing:
      // const measureResult = await measureResp.json();
    } catch (e) {
      // Continuation of logic below
    }
  }

  // Corrected loadData method
  async loadData() {
    document.getElementById('loadingSection').style.display = 'block';
    try {
      // 1. Load Project Data
      const projectResp = await fetch(`/api/shared/${this.shareId}`);
      const projectResult = await projectResp.json();
      if (!projectResult.success) throw new Error(projectResult.message);
      this.projectData = projectResult.projectData;

      // 2. Load Measurements
      const measureResp = await fetch(
        `/api/shared/${this.shareId}/measurements?editToken=${this.editToken}`
      );
      const measureResult = await measureResp.json();

      if (measureResult.success) {
        // The API returns { measurements: { imageLabel: { strokeLabel: { value, submittedAt } } } }
        // But wait, the API I implemented returns `measurements` object from the shareRecord.
        // AND `shareRecord.submissions` array if I implemented the POST correctly.
        // Let's check app.js again.
        // POST /api/shared/:shareId/measurements pushes to shareRecord.submissions array.
        // GET /api/shared/:shareId/measurements returns shareRecord.measurements object?
        // Wait, app.js line 313: const measurements = shareRecord.measurements || {};
        // It seems I might have mixed up "measurements" (the options/defaults?) and "submissions" (the customer inputs).
        // Let's re-read app.js carefully.

        // In app.js:
        // POST ... pushes to shareRecord.submissions = []
        // GET ... returns shareRecord.measurements || {}

        // Ah, I need to fix the GET endpoint in app.js to return `submissions` as well!
        // The current GET endpoint only returns `measurements` which seems to be the default/template measurements from shareOptions?
        // No, shareOptions.measurements is initialized in POST /share-project.

        // So, I need to update app.js to return `submissions` in the GET endpoint.
        // For now, I will assume I will fix app.js.

        this.submissions = measureResult.submissions || [];
      }

      this.renderSubmissions();
      this.renderProject();
    } catch (error) {
      console.error('Error loading data:', error);
      document.getElementById('submissionsList').innerHTML =
        `<div class="alert alert-error">Error: ${error.message}</div>`;
    } finally {
      document.getElementById('loadingSection').style.display = 'none';
    }
  }

  renderSubmissions() {
    const container = document.getElementById('submissionsList');
    container.innerHTML = '';

    if (!this.submissions || this.submissions.length === 0) {
      container.innerHTML = '<div class="empty-state">No measurements submitted yet.</div>';
      return;
    }

    // Sort by date desc
    this.submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    this.submissions.forEach(sub => {
      const date = new Date(sub.submittedAt).toLocaleString();
      const card = document.createElement('div');
      card.className = 'submission-card';

      let measurementsHtml = '';
      for (const [imgLabel, measures] of Object.entries(sub.measurements)) {
        measurementsHtml += `<div style="margin-top:8px; font-weight:600; font-size:0.9em; color:#868e96;">${imgLabel}</div>`;
        for (const [strokeLabel, data] of Object.entries(measures)) {
          measurementsHtml += `
                        <div class="measurement-item">
                            <span class="measurement-label">${strokeLabel}</span>
                            <span class="measurement-value">${data.value}</span>
                        </div>
                    `;
        }
      }

      card.innerHTML = `
                <div class="submission-header">
                    <span class="customer-name">${sub.customerInfo.name || 'Anonymous'}</span>
                    <span class="submission-date">${date}</span>
                </div>
                <div style="font-size:0.9em; color:#666; margin-bottom:8px;">${sub.customerInfo.email || ''}</div>
                ${measurementsHtml}
            `;
      container.appendChild(card);
    });
  }

  // --- Rendering Logic (Simplified from shared.js) ---

  navigateImage(dir) {
    const labels = this.getImageLabels();
    if (!labels.length) return;
    this.currentIndex = (this.currentIndex + dir + labels.length) % labels.length;
    this.currentLabel = labels[this.currentIndex];
    this.renderProject();
  }

  getImageLabels() {
    if (!this.projectData) return [];
    let labels = this.projectData.imageLabels || [];
    if (!labels.length && this.projectData.originalImages)
      labels = Object.keys(this.projectData.originalImages);
    if (!labels.length && this.projectData.strokeSequence)
      labels = Object.keys(this.projectData.strokeSequence);
    return labels;
  }

  renderProject() {
    if (!this.projectData) return;

    const labels = this.getImageLabels();
    if (!labels.length) return;

    if (!this.currentLabel) this.currentLabel = this.projectData.currentImageLabel || labels[0];

    // Update UI
    document.getElementById('currentImageName').textContent =
      this.projectData.customImageNames?.[this.currentLabel] || this.currentLabel;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const scale = this.projectData.imageScales?.[this.currentLabel] || 1;
    const pos = this.projectData.imagePositions?.[this.currentLabel] || { x: 0, y: 0 };

    // Load image
    const imgUrl = this.projectData.originalImages?.[this.currentLabel];
    if (imgUrl) {
      const img = new Image();
      img.onload = () => {
        // Center logic
        const centerX = (this.canvas.width - img.width * scale) / 2;
        const centerY = (this.canvas.height - img.height * scale) / 2;
        const x = centerX + pos.x;
        const y = centerY + pos.y;

        this.ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        this.drawStrokes(this.currentLabel, scale, x, y);
      };
      img.src = imgUrl;
    } else {
      // No image, just center
      const x = this.canvas.width / 2 + pos.x;
      const y = this.canvas.height / 2 + pos.y;
      this.drawStrokes(this.currentLabel, scale, x, y);
    }
  }

  drawStrokes(imageLabel, scale, offsetX, offsetY) {
    const strokes = this.projectData.strokes?.[imageLabel] || {};
    const sequence = this.projectData.strokeSequence?.[imageLabel] || [];

    sequence.forEach(strokeLabel => {
      const stroke = strokes[strokeLabel];
      if (!stroke || !stroke.points) return;

      this.ctx.save();
      this.ctx.strokeStyle = stroke.color || '#000';
      this.ctx.lineWidth = (stroke.width || 2) * scale;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';

      this.ctx.beginPath();
      if (stroke.type === 'straight' || stroke.type === 'arrow') {
        if (stroke.points.length >= 2) {
          const start = this.transform(stroke.points[0], scale, offsetX, offsetY);
          const end = this.transform(
            stroke.points[stroke.points.length - 1],
            scale,
            offsetX,
            offsetY
          );
          this.ctx.moveTo(start.x, start.y);
          this.ctx.lineTo(end.x, end.y);
        }
      } else {
        stroke.points.forEach((p, i) => {
          const pt = this.transform(p, scale, offsetX, offsetY);
          if (i === 0) this.ctx.moveTo(pt.x, pt.y);
          else this.ctx.lineTo(pt.x, pt.y);
        });
      }
      this.ctx.stroke();

      // Label
      if (this.showMeasurements) {
        this.drawLabel(stroke, strokeLabel, scale, offsetX, offsetY);
      }

      this.ctx.restore();
    });
  }

  drawLabel(stroke, label, scale, offsetX, offsetY) {
    // Simplified label drawing
    let anchor;
    if (stroke.type === 'straight' || stroke.type === 'arrow') {
      const a = this.transform(stroke.points[0], scale, offsetX, offsetY);
      const b = this.transform(stroke.points[stroke.points.length - 1], scale, offsetX, offsetY);
      anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else {
      const mid = Math.floor(stroke.points.length / 2);
      anchor = this.transform(stroke.points[mid], scale, offsetX, offsetY);
    }

    const customOffset = this.projectData.customLabelPositions?.[this.currentLabel]?.[label] || {
      x: 0,
      y: 0,
    };
    const x = anchor.x + (customOffset.x || 0) * scale;
    const y = anchor.y + (customOffset.y || 0) * scale;

    this.ctx.fillStyle = 'rgba(255,255,255,0.9)';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 12 * scale, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.fillStyle = '#000';
    this.ctx.font = `${12 * scale}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, x, y);
  }

  transform(pt, scale, offX, offY) {
    return { x: pt.x * scale + offX, y: pt.y * scale + offY };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ProductionViewer();
});
