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

function renderMeasurementsTable(rows, groupIndex) {
  if (!rows?.length) {
    return '<div class="card right"><p class="section-label">Main Measurements</p><p>No measurements</p></div>';
  }

  const body = rows
    .map(
      (row, rowIndex) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td>
          <div
            class="input-box pdf-field-anchor"
            data-field-name="${escapeHtml(fieldName('main', groupIndex + 1, row.label, rowIndex + 1))}"
            data-field-value="${escapeHtml(row.value || '')}"
          >${escapeHtml(row.value || '')}</div>
        </td>
      </tr>
    `
    )
    .join('');

  return `
    <div class="card right">
      <p class="section-label">Main Measurements</p>
      <table class="table">
        <thead><tr><th>Label</th><th>Measurement</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderRelatedFrames(frames) {
  if (!frames?.length) return '';
  return `
    <div class="avoid-break">
      <p class="section-label">Related Frames</p>
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
    <div class="avoid-break">
      <p class="section-label">Related Measurements</p>
      <div class="cards-grid">
        ${cards
          .map((card, cardIndex) => {
            const rows = (card.rows || [])
              .slice(0, 4)
              .map(
                (row, rowIndex) => `
                <div class="measure-row">
                  <div class="measure-label">${escapeHtml(row.label)}</div>
                  <div
                    class="input-box pdf-field-anchor"
                    data-field-name="${escapeHtml(fieldName('rel', groupIndex + 1, card.title, row.label, cardIndex + 1, rowIndex + 1))}"
                    data-field-value="${escapeHtml(row.value || '')}"
                  >${escapeHtml(row.value || '')}</div>
                </div>
              `
              )
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
          <h1 class="title">${escapeHtml(report.projectName)}</h1>
          <div class="meta">${escapeHtml(report.namingLine || '')}</div>
          <div class="meta">${escapeHtml(subtitle)}</div>
        </header>

        <div class="split avoid-break">
          <div class="card left">
            <p class="section-label">Main Piece</p>
            <img class="hero-image" src="${escapeHtml(group.mainImage.src)}" alt="${escapeHtml(
              group.mainImage.title || 'Main image'
            )}" />
            <div class="meta">${escapeHtml(group.mainImage.title || '')}</div>
          </div>
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
