import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cssPath = path.join(__dirname, '../print.css');
const logoPath = path.join(__dirname, '../assets/comfort-works-logo.png');

let cachedCss = null;
let cachedLogoDataUrl = null;

function getPrintCss() {
  if (!cachedCss) {
    cachedCss = fs.readFileSync(cssPath, 'utf8');
  }
  return cachedCss;
}

function getLogoDataUrl() {
  if (cachedLogoDataUrl === null) {
    try {
      const logo = fs.readFileSync(logoPath);
      cachedLogoDataUrl = `data:image/png;base64,${logo.toString('base64')}`;
    } catch {
      cachedLogoDataUrl = '';
    }
  }
  return cachedLogoDataUrl;
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
        <span class="unit-pill ${normalized === 'cm' ? 'active' : ''}">
          <span>cm</span>
          <span
            class="unit-checkbox pdf-field-anchor"
            data-field-type="radio"
            data-field-name="unit_measurement"
            data-field-option="cm"
            data-field-value="${normalized === 'cm' ? 'checked' : ''}"
            aria-hidden="true"
          ></span>
        </span>
        <span class="unit-pill ${normalized === 'inch' ? 'active' : ''}">
          <span>inch</span>
          <span
            class="unit-checkbox pdf-field-anchor"
            data-field-type="radio"
            data-field-name="unit_measurement"
            data-field-option="inch"
            data-field-value="${normalized === 'inch' ? 'checked' : ''}"
            aria-hidden="true"
          ></span>
        </span>
      </div>
    </div>
  `;
}

function renderMeasurementRows(rows, fieldPrefix, groupIndex) {
  return rows
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
            data-field-type="text"
            data-field-name="${escapeHtml(fieldName(fieldPrefix, groupIndex + 1, row.label, rowIndex + 1))}"
            data-field-value="${escapeHtml(row.value || '')}"
          >${escapeHtml(row.value || '')}</div>
        </div>
      `;
    })
    .join('');
}

// Filter out measurements that are letters-only (no numeric content in label or value)
function filterMeaningfulMeasurements(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => {
    const label = String(row?.label || '');
    const value = String(row?.value || '');
    // Keep if the value has any digit, or if the label has a digit
    return /\d/.test(value) || /\d/.test(label);
  });
}

function renderMeasurementsTable(rows, groupIndex) {
  const filtered = filterMeaningfulMeasurements(rows);
  if (!filtered.length) {
    return `
      <aside class="measure-panel">
        <div class="form-heading">Measurements:</div>
        <div class="empty-state">No measurements recorded</div>
      </aside>
    `;
  }

  // Split into two side-by-side columns if there are more than 12 rows
  const useTwoColumns = filtered.length > 12;
  const halfCount = Math.ceil(filtered.length / 2);
  const col1 = useTwoColumns ? filtered.slice(0, halfCount) : filtered;
  const col2 = useTwoColumns ? filtered.slice(halfCount) : [];

  const tableHtml = useTwoColumns
    ? `<div class="measurement-grid two-col">
        <div class="measurement-col">${renderMeasurementRows(col1, 'main', groupIndex)}</div>
        <div class="measurement-col">${renderMeasurementRows(col2, 'main2', groupIndex)}</div>
      </div>`
    : `<div class="measurement-grid">${renderMeasurementRows(col1, 'main', groupIndex)}</div>`;

  return `
    <aside class="measure-panel">
      <div class="form-heading">Measurements:</div>
      ${tableHtml}
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
            const rows = filterMeaningfulMeasurements(card.rows || [])
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
                      data-field-type="text"
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

function renderPageHeader(report, sheetIndex, subtitle = '') {
  const logoDataUrl = getLogoDataUrl();
  return `
    <header class="header">
      <div class="header-top">
        <div class="brand-lockup">
          <div class="cw-logo" aria-label="Comfort Works">
            ${
              logoDataUrl
                ? `<img class="cw-logo-img" src="${logoDataUrl}" alt="" aria-hidden="true" />`
                : ''
            }
            <span class="cw-word">Comfort<br />Works</span>
          </div>
          <h1 class="title">Custom Sofa Measuring Diagram</h1>
        </div>
        <div class="header-right">
          <span class="sheet-tag">Sheet ${sheetIndex}</span>
        </div>
      </div>
      <div class="header-rule"></div>
      <div class="meta meta-primary">${escapeHtml(report.projectName)}</div>
      <div class="meta meta-secondary">${escapeHtml(report.namingLine || '')}</div>
      ${subtitle ? `<div class="meta meta-secondary">${escapeHtml(subtitle)}</div>` : ''}
    </header>
  `;
}

function renderPageFooter(pageIndex) {
  return `
    <footer class="footer">
      <span>Generated by OpenPaint</span>
      <span>Page ${pageIndex}</span>
    </footer>
  `;
}

function renderComparisonPages(report, startIndex) {
  const groups = (report.comparisonGroups || []).filter(group => group?.items?.length >= 2);
  if (!groups.length) return '';

  return `
    <section class="page comparison-page" data-page-index="${startIndex}">
      ${renderPageHeader(report, startIndex + 1, 'Repeated Label Comparison')}
      ${renderUnitToggle(report.unit)}

      <div class="comparison-note">
        Repeated labels are isolated here for side-by-side checking. Other measurement marks are hidden in these captures only.
      </div>

      <div class="comparison-stack">
        ${groups
          .map(
            group => `
              <section class="comparison-group">
                <h2 class="comparison-title">Label ${escapeHtml(group.label)}</h2>
                <div class="comparison-grid item-count-${group.items.length}">
                  ${group.items
                    .map(
                      item => `
                        <figure class="comparison-card">
                          <img src="${escapeHtml(item.src)}" alt="${escapeHtml(
                            `${group.label} - ${item.title || 'comparison frame'}`
                          )}" />
                          <figcaption>${escapeHtml(item.title || '')}</figcaption>
                        </figure>
                      `
                    )
                    .join('')}
                </div>
              </section>
            `
          )
          .join('')}
      </div>

      ${renderPageFooter(startIndex + 1)}
    </section>
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
  const groupPages = groups
    .map((group, index) => {
      const subtitle = [group.title, group.subtitle].filter(Boolean).join(' - ');
      return `
      <section class="page" data-page-index="${index}">
        ${renderPageHeader(report, index + 1, subtitle)}

        ${renderUnitToggle(report.unit)}

        <div class="sheet-main avoid-break">
          <figure class="figure-panel">
            <div class="section-kicker">Main Piece</div>
            <img class="hero-image" src="${escapeHtml(group.mainImage.src)}" alt="${escapeHtml(
              group.mainImage.title || 'Main image'
            )}" onload="if(this.naturalHeight>this.naturalWidth){this.closest('.sheet-main').classList.add('portrait')}" />
            <figcaption class="figure-caption">${escapeHtml(group.mainImage.title || '')}</figcaption>
          </figure>
          ${renderMeasurementsTable(group.mainMeasurements || [], index)}
        </div>

        ${renderRelatedFrames(group.relatedFrames || [])}
        ${renderRelatedMeasurementCards(group.relatedMeasurementCards || [], index)}

        ${renderPageFooter(index + 1)}
      </section>
      `;
    })
    .join('');
  const pages = `${groupPages}${renderComparisonPages(report, groups.length)}`;

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
