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

function renderCushionTypes(group, groupIndex) {
  if (!Object.prototype.hasOwnProperty.call(group || {}, 'cushionQuantity')) return '';
  return `
    <div class="cushion-types" aria-label="Cushion type">
      ${['Seat', 'Back', 'Accent']
        .map(type => {
          const key = type.toLowerCase();
          return `
            <span class="cushion-type-option">
              <span>${type}</span>
              <span
                class="cushion-type-checkbox pdf-field-anchor"
                data-field-type="checkbox"
                data-field-name="${escapeHtml(fieldName('cushion_type', groupIndex + 1, key))}"
                data-field-value=""
                aria-hidden="true"
              ></span>
            </span>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderUnitToggle(unit, group = null, groupIndex = 0) {
  const normalized = String(unit || 'inch').toLowerCase() === 'cm' ? 'cm' : 'inch';
  return `
    <div class="unit-block" aria-label="Measurement units">
      <div class="unit-heading">Unit of Measurement:</div>
      <div class="unit-toggle">
        <span class="unit-pill ${normalized === 'cm' ? 'active' : ''}">
          <span>cm</span>
          <span
            class="unit-checkbox pdf-field-anchor ${normalized === 'cm' ? 'active' : ''}"
            data-field-type="unit-radio"
            data-field-name="unit_measurement"
            data-field-option="cm"
            data-field-value="${normalized === 'cm' ? 'checked' : ''}"
            aria-hidden="true"
          ></span>
        </span>
        <span class="unit-pill ${normalized === 'inch' ? 'active' : ''}">
          <span>inch</span>
          <span
            class="unit-checkbox pdf-field-anchor ${normalized === 'inch' ? 'active' : ''}"
            data-field-type="unit-radio"
            data-field-name="unit_measurement"
            data-field-option="inch"
            data-field-value="${normalized === 'inch' ? 'checked' : ''}"
            aria-hidden="true"
          ></span>
        </span>
      </div>
      ${renderCushionTypes(group, groupIndex)}
    </div>
  `;
}

function renderMeasurementRows(rows, fieldPrefix, groupIndex) {
  return rows
    .map((row, rowIndex) => {
      const rowStatus = detectRowStatus(row.value);
      const customFieldName = row.fieldName || '';
      const maxLength = Number(row.maxLength) > 0 ? Number(row.maxLength) : 0;
      const textAlign = row.textAlign || '';
      return `
        <div class="measurement-item">
          <div class="measurement-label">
            <span class="measurement-code">${escapeHtml(row.label)}</span>
            ${renderStatusBadge(rowStatus)}
          </div>
          <div
            class="input-box pdf-field-anchor ${rowStatus ? `input-${rowStatus}` : ''}"
            data-field-type="text"
            data-field-name="${escapeHtml(
              customFieldName || fieldName(fieldPrefix, groupIndex + 1, row.label, rowIndex + 1)
            )}"
            data-field-value="${escapeHtml(row.value || '')}"
            ${maxLength ? `data-field-max-length="${maxLength}"` : ''}
            ${textAlign ? `data-field-align="${escapeHtml(textAlign)}"` : ''}
          >${escapeHtml(row.value || '')}</div>
        </div>
      `;
    })
    .join('');
}

function filterMeaningfulMeasurements(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => {
    const label = String(row?.label || '');
    const value = String(row?.value || '');
    return label.trim() || value.trim();
  });
}

function renderMeasurementsTable(rows, group, groupIndex) {
  const filtered = filterMeaningfulMeasurements(rows);
  if (Object.prototype.hasOwnProperty.call(group || {}, 'cushionQuantity')) {
    filtered.unshift({
      label: 'QTY',
      value: String(group.cushionQuantity || '')
        .replace(/\D+/g, '')
        .slice(0, 2),
      fieldName: fieldName('cushion_qty', groupIndex + 1),
      maxLength: 2,
      textAlign: 'center',
    });
  }
  if (!filtered.length) {
    return `
      <aside class="measure-panel">
        <div class="form-heading">Measurements:</div>
        <div class="empty-state">No measurements recorded</div>
      </aside>
    `;
  }

  // Split before the table gets tall enough to collide with the page footer.
  const useTwoColumns = filtered.length > 6;

  // Flat 2-column grid: items flow left-to-right, top-to-bottom. With an odd
  // count the last row's right cell is simply absent (no phantom border).
  const tableHtml = filtered.length
    ? useTwoColumns
      ? `<div class="measurement-grid two-col">${renderMeasurementRows(filtered, 'main', groupIndex)}</div>`
      : `<div class="measurement-grid">${renderMeasurementRows(filtered, 'main', groupIndex)}</div>`
    : '';
  return `
    <aside class="measure-panel ${useTwoColumns ? 'measure-panel-wide' : ''}">
      <div class="form-heading">Measurements:</div>
      ${tableHtml}
    </aside>
  `;
}

function renderCustomerNoteTop(group, groupIndex) {
  if (!Object.prototype.hasOwnProperty.call(group || {}, 'customerNote')) return '';
  const note = String(group.customerNote || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 90);
  return `
    <div
      class="customer-note-top pdf-field-anchor"
      data-field-type="text"
      data-field-name="${escapeHtml(fieldName('note', groupIndex + 1))}"
      data-field-value="${escapeHtml(note)}"
      data-field-max-length="90"
      data-field-align="center"
    >${escapeHtml(note)}</div>
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

function renderPageHeader(report, sheetIndex) {
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
          <h1 class="title">${escapeHtml(report.projectName)}</h1>
        </div>
        <div class="header-right">
          <span class="sheet-tag">Sheet ${sheetIndex}</span>
        </div>
      </div>
      <div class="header-rule"></div>
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

  // Render at most 2 groups per page so content stays within the page height.
  // Each group contains title + an image grid (~68mm for 2 items, ~52mm for 3–4).
  const GROUPS_PER_PAGE = 2;
  const result = [];
  for (let pageOffset = 0; pageOffset < groups.length; pageOffset += GROUPS_PER_PAGE) {
    const pageGroups = groups.slice(pageOffset, pageOffset + GROUPS_PER_PAGE);
    const pageIndex = startIndex + result.length;
    const pageNumber = startIndex + result.length + 1;

    result.push(`
      <section class="page comparison-page" data-page-index="${pageIndex}">
        ${renderPageHeader(report, pageNumber, 'Repeated Label Comparison')}
        ${renderUnitToggle(report.unit)}

        <div class="comparison-note">
          Repeated labels are isolated here for side-by-side checking. Other measurement marks are hidden in these captures only.
        </div>

        <div class="comparison-stack">
          ${pageGroups
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

        ${renderPageFooter(pageNumber)}
      </section>
    `);
  }
  return result.join('');
}

// One worksheet row per measurement guide gallery diagram. The client embeds
// each gallery SVG (and its circled measurement letters) as a data URL.
const CUSHION_WORKSHEET_ROWS = [
  { shape: 'T', name: 'T-SHAPED', guideCode: 'CC-BK-T' },
  { shape: 'L', name: 'L-SHAPED', guideCode: 'CC-BK-L' },
  { shape: 'B', name: 'BOX-SHAPED', guideCode: 'CC-ST-BE' },
  { shape: 'W', name: 'WEDGE-SHAPED', guideCode: 'CC-BK-W' },
];

function renderCushionWorksheet(report, index) {
  const table = (shape, type, labels) =>
    `<table class="cushion-grid" aria-label="${shape} ${type} cushions"><thead><tr><th>${shape}</th><th>TYPE 1</th><th>TYPE 2</th></tr></thead><tbody>${['Qty', ...labels].map(label => `<tr><th>${escapeHtml(label)}</th>${[1, 2].map(variant => `<td><div class="pdf-field-anchor cushion-cell" data-field-type="text" data-field-transparent="true" data-field-name="${escapeHtml(fieldName('cushions', shape, type, variant, label))}" data-field-value=""></div></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const figure = row => {
    const diagram = report.cushionDiagrams?.[row.shape];
    if (diagram?.src) {
      return `<img src="${escapeHtml(diagram.src)}" alt="${escapeHtml(`${row.name} cushion measurement diagram (${row.guideCode})`)}" />`;
    }
    return `<div class="cushion-diagram-missing">Diagram unavailable<br />(${escapeHtml(row.guideCode)})</div>`;
  };
  return `<section class="page cushion-worksheet" data-page-index="${index}"><header class="cushion-header"><img src="${getLogoDataUrl()}" alt="Comfort Works"><h1>CUSTOM SOFA MEASURING DIAGRAM</h1></header><div class="cushion-intro"><h2>CUSHIONS</h2><p>Please provide the quantity and measure according to the diagrams below. If you have multiple sizes of the same cushion shape, please fill in TYPE 2.</p></div>${renderUnitToggle(report.unit)}<div class="cushion-rows">${CUSHION_WORKSHEET_ROWS.map(
    row =>
      `<section class="cushion-row"><figure>${figure(row)}<figcaption>${row.name} CUSHION</figcaption></figure><div class="cushion-table-wrap"><h3>SEAT CUSHIONS</h3>${table(row.shape, 'seat', report.cushionDiagrams?.[row.shape]?.labels || [])}</div><div class="cushion-table-wrap"><h3>BACK CUSHIONS</h3>${table(row.shape, 'back', report.cushionDiagrams?.[row.shape]?.labels || [])}</div></section>`
  ).join(
    ''
  )}</div><footer class="cushion-footer">${escapeHtml(report.projectName)} <span>${index + 1}</span></footer></section>`;
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
      const measurementCount =
        filterMeaningfulMeasurements(group.mainMeasurements || []).length +
        (Object.prototype.hasOwnProperty.call(group || {}, 'cushionQuantity') ? 1 : 0) +
        (Object.prototype.hasOwnProperty.call(group || {}, 'customerNote') ? 1 : 0);
      const sheetMainClass = [
        'sheet-main',
        'avoid-break',
        measurementCount > 6 ? 'sheet-main-dense' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `
      <section class="page" data-page-index="${index}">
        ${renderPageHeader(report, index + 1, subtitle)}

        ${renderCustomerNoteTop(group, index)}

        ${renderUnitToggle(report.unit, group, index)}

        <div class="${sheetMainClass}">
          <figure class="figure-panel">
            <div class="section-kicker">Main Piece</div>
            <img class="hero-image" src="${escapeHtml(group.mainImage.src)}" alt="${escapeHtml(
              group.mainImage.title || 'Main image'
            )}" onload="if(this.naturalHeight>this.naturalWidth){this.closest('.sheet-main').classList.add('portrait')}" />
            <figcaption class="figure-caption">${escapeHtml(group.mainImage.title || '')}</figcaption>
          </figure>
          ${renderMeasurementsTable(group.mainMeasurements || [], group, index)}
        </div>

        ${renderRelatedFrames(group.relatedFrames || [])}
        ${renderRelatedMeasurementCards(group.relatedMeasurementCards || [], index)}

        ${renderPageFooter(index + 1)}
      </section>
      `;
    })
    .join('');
  const comparisonPages = renderComparisonPages(report, groups.length);
  const comparisonCount = Math.ceil(
    (report.comparisonGroups || []).filter(group => group?.items?.length >= 2).length / 2
  );
  const pages = `${groupPages}${comparisonPages}${report.includeCushionWorksheet ? renderCushionWorksheet(report, groups.length + comparisonCount) : ''}`;

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <style>${getPrintCss()}</style>
      <style>:root { ${pageCssVars} }</style>
      <style>@page { size: ${pageFormat}; margin: 14mm; }</style>
    </head>
    <body>
      ${pages}
    </body>
  </html>
  `;
}
