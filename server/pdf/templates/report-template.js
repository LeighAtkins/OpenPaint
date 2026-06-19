import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cssPath = path.join(__dirname, '../print.css');

let cachedCss = null;

function getPrintCss() {
  if (!cachedCss) {
    cachedCss = fs.readFileSync(cssPath, 'utf8');
  }
  return cachedCss;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fieldName(...parts) {
  return parts
    .map(part =>
      String(part || '')
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, '_')
    )
    .filter(Boolean)
    .join('_')
    .slice(0, 120);
}

function detectRowStatus(value) {
  const text = String(value || '').toLowerCase();
  if (/\b(pass|ok|approved|match)\b/.test(text)) return 'pass';
  if (/\b(fail|error|invalid|mismatch)\b/.test(text)) return 'fail';
  if (/\b(warn|warning|review|check)\b/.test(text)) return 'warn';
  if (/\b(pending|todo|n\/a|na|unknown)\b/.test(text)) return 'pending';
  return null;
}

function renderStatusBadge(status) {
  if (!status) return '';
  const label = status.toUpperCase();
  const icon =
    status === 'pass'
      ? '<span class="status-dot" style="color:#1E9E5A;">&#10003;</span>'
      : status === 'fail'
        ? '<span class="status-dot" style="color:#E24A3B;">&#10005;</span>'
        : status === 'warn'
          ? '<span class="status-dot" style="color:#E7A400;">!</span>'
          : '<span class="status-dot">?</span>';
  return `<span class="status-badge status-${status}">${icon}${label}</span>`;
}

function renderUnitToggle(unit) {
  const normalized = String(unit || 'inch').toLowerCase() === 'cm' ? 'cm' : 'inch';
  return `
    <div class="unit-block" aria-label="Measurement units">
      <div class="unit-heading">Unit of Measurement:</div>
      <div class="unit-toggle">
        <span class="unit-pill ${normalized === 'cm' ? 'active' : ''}">cm</span>
        <span class="unit-pill ${normalized === 'inch' ? 'active' : ''}">inch</span>
      </div>
    </div>
  `;
}

function renderMeasurementRows(rows, fieldPrefix, groupIndex, maxRows = rows?.length || 0) {
  const visibleRows = rows.slice(0, maxRows);
  return visibleRows
    .map((row, rowIndex) => {
      const rowStatus = detectRowStatus(row.value);
      return `
        <div class="measurement-item">
          <div class="measurement-label">
            <span class="measurement-code">${escapeHtml(row.label)}</span>
            ${renderStatusBadge(rowStatus)}
          </div>
          <div
            class="input-box pdf-field-anchor ${rowStatus ? `input-${rowStatus}` : ''}"
            data-field-name="${escapeHtml(fieldName(fieldPrefix, groupIndex + 1, row.label, rowIndex + 1))}"
            data-field-value="${escapeHtml(row.value || '')}"
          >${escapeHtml(row.value || '')}</div>
        </div>
      `;
    })
    .join('');
}

function renderMeasurementsTable(rows, groupIndex) {
  if (!rows?.length) {
    return `
      <aside class="measure-panel">
        <div class="form-heading">Measurements:</div>
        <div class="empty-state">No measurements recorded</div>
      </aside>
    `;
  }

  const overflow = rows.length > 18 ? rows.length - 18 : 0;
  const body = renderMeasurementRows(rows, 'main', groupIndex, 18);

  return `
    <aside class="measure-panel">
      <div class="form-heading">Measurements:</div>
      <div class="measurement-grid">${body}</div>
      ${overflow ? `<div class="overflow-note">+${overflow} additional measurements not shown on this sheet</div>` : ''}
    </aside>
  `;
}

function renderRelatedFrames(frames) {
  if (!frames?.length) return '';
  return `
    <div>
      <div class="section-kicker section-spaced">Related Frames</div>
      <div class="related-grid">
        ${frames
          .map(
            frame => `
            <div class="thumb">
              <img src="${escapeHtml(frame.src)}" alt="${escapeHtml(frame.title || 'Related frame')}" />
              <div class="thumb-caption">${escapeHtml(frame.title || '')}</div>
            </div>
          `
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderRelatedMeasurementCards(cards, groupIndex) {
  if (!cards?.length) return '';
  return `
    <div>
      <div class="section-kicker section-spaced">Related Measurements</div>
      <div class="cards-grid">
        ${cards
          .map((card, cardIndex) => {
            const rows = (card.rows || [])
              .slice(0, 8)
              .map((row, rowIndex) => {
                const rowStatus = detectRowStatus(row.value);
                return `
                  <div class="related-measure-row">
                    <div class="measurement-label compact">
                      <span class="measurement-code">${escapeHtml(row.label)}</span>
                      ${renderStatusBadge(rowStatus)}
                    </div>
                    <div
                      class="input-box pdf-field-anchor compact-input ${rowStatus ? `input-${rowStatus}` : ''}"
                      data-field-name="${escapeHtml(fieldName('rel', groupIndex + 1, card.title, row.label, cardIndex + 1, rowIndex + 1))}"
                      data-field-value="${escapeHtml(row.value || '')}"
                    >${escapeHtml(row.value || '')}</div>
                  </div>
                `;
              })
              .join('');
            return `
              <div class="measure-card">
                <h4 class="measure-card-title">${escapeHtml(card.title)}</h4>
                <div class="measure-list">${rows}</div>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

export function renderReportTemplate(report, options = {}) {
  const pageSize = String(options.pageSize || 'letter').toLowerCase();
  const pageFormat = pageSize === 'a4' ? 'A4' : 'Letter';
  const pageCssVars =
    pageSize === 'a4'
      ? '--content-width: 182mm; --content-height: 269mm;'
      : '--content-width: 188mm; --content-height: 251mm;';
  const groups = report.groups || [];
  const pages = groups
    .map((group, index) => {
      const subtitle = [group.title, group.subtitle].filter(Boolean).join(' - ');
      return `
      <section class="page" data-page-index="${index}">
        <header class="header">
          <div class="header-top">
            <div class="brand-lockup">
              <div class="cw-logo" aria-label="Comfort Works">
                <span class="cw-mark" aria-hidden="true"></span>
                <span class="cw-word">Comfort<br />Works</span>
              </div>
              <h1 class="title">Custom Sofa Measuring Diagram</h1>
            </div>
            <div class="header-right">
              <span class="sheet-tag">Sheet ${index + 1}</span>
            </div>
          </div>
          <div class="header-rule"></div>
          <div class="meta meta-primary">${escapeHtml(report.projectName)}</div>
          <div class="meta meta-secondary">${escapeHtml(report.namingLine || '')}</div>
          <div class="meta meta-secondary">${escapeHtml(subtitle)}</div>
        </header>

        ${renderUnitToggle(report.unit)}

        <div class="sheet-main avoid-break">
          <figure class="figure-panel">
            <div class="section-kicker">Main Piece</div>
            <img class="hero-image" src="${escapeHtml(group.mainImage.src)}" alt="${escapeHtml(
              group.mainImage.title || 'Main image'
            )}" />
            <figcaption class="figure-caption">${escapeHtml(group.mainImage.title || '')}</figcaption>
          </figure>
          ${renderMeasurementsTable(group.mainMeasurements || [], index)}
        </div>

        ${renderRelatedFrames(group.relatedFrames || [])}
        ${renderRelatedMeasurementCards(group.relatedMeasurementCards || [], index)}

        <footer class="footer">
          <span>Generated by OpenPaint</span>
          <span>Page ${index + 1}</span>
        </footer>
      </section>
      `;
    })
    .join('');

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <style>:root { ${pageCssVars} }</style>
      <style>${getPrintCss()}</style>
      <style>@page { size: ${pageFormat}; margin: 14mm; }</style>
    </head>
    <body>
      ${pages}
    </body>
  </html>
  `;
}
