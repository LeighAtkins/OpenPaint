import './search.css';
import { authService, type AuthUser } from '../../services/auth/authService';
import { getCwMeasurementIdentity } from '../../services/auth/cwAccess';
import { MeasurementSession } from './session';
import {
  comparisonDifference,
  comparisonRows,
  drawingPath,
  formatMeasurement,
  unitLabel,
  indexProducts,
  normalizeDetail,
  searchProducts,
  selectionFromPath,
  selectionPath,
  type CatalogueProduct,
  type Detail,
  type Selection,
  type DisplayUnits,
} from './model';

const escape = (value: unknown) =>
  String(
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : ''
  ).replace(
    /[&<>"']/g,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
const labels = {
  confirmed: 'Confirmed',
  unconfirmed: 'Unconfirmed',
  unavailable: 'No measurements',
  review: 'Needs review',
};
const session = new MeasurementSession();
let products: CatalogueProduct[] = [];
let searchIndex: ReturnType<typeof indexProducts> = [];
let active: { product: CatalogueProduct; selection: Selection } | null = null;
let comparisons: Array<{ product: CatalogueProduct; selection: Selection }> = [];
const details = new Map<string, Detail>();
const errors = new Map<string, string>();
const loading = new Set<string>();
let identity = '';
let generation = 0;
let query = new URLSearchParams(location.search).get('q') || '';
let resultLimit = 20;
let showResults = true;
let focusedIndex = -1;
let imageObserver: IntersectionObserver | null = null;
let partObserver: IntersectionObserver | null = null;
let drawingEditor: typeof import('./editor') | null = null;
let imageQueue: HTMLImageElement[] = [];
let imageRequests = 0;
let prefetches = 0;
let catalogueReady = false;
let units: DisplayUnits = new URLSearchParams(location.search).get('units') === 'in' ? 'in' : 'cm';
let pdfBusy = false;
let showTolerances = new URLSearchParams(location.search).get('tolerances') === '1';
function toleranceToggle() {
  return `<button class="ms-secondary ms-tolerance-toggle" data-action="tolerances" aria-pressed="${showTolerances}">${showTolerances ? '✓ ' : ''}Tolerances</button>`;
}
function copyAttributes(label: string, number: string, unit = 'cm') {
  if (number === '—') return '';
  const displayedUnit = unitLabel(unit, units);
  return `data-copy-label="${escape(label)}" data-copy-value="${escape(formatMeasurement(number, unit, units))}" data-copy-unit="${escape(displayedUnit === 'in' ? 'inches' : displayedUnit)}"`;
}
function copyValue(label: string, number: string, unit = 'cm') {
  return number === '—'
    ? '—'
    : `<button class="ms-copy-value" ${copyAttributes(label, number, unit)} title="Copy measurement">${value(number, unit)}</button>`;
}
const copyIcon =
  '<svg class="ms-copy-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 1H4a2 2 0 00-2 2v12h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z"></path></svg>';
function unitToggle() {
  return `<div class="ms-unit-toggle" role="group" aria-label="Measurement units"><button data-units="cm" aria-pressed="${units === 'cm'}" class="${units === 'cm' ? 'is-selected' : ''}">cm</button><button data-units="in" aria-pressed="${units === 'in'}" class="${units === 'in' ? 'is-selected' : ''}">inches</button></div>`;
}
const value = (number: string, unit = 'cm') => escape(formatMeasurement(number, unit, units));
let root: HTMLElement;

function status(selection: Selection) {
  return `<span class="ms-status ${selection.status}">${labels[selection.status]}</span>`;
}
function productFor(selection: Selection) {
  return products.find(product => product.id === selection.productId)!;
}
function notice(selection: Selection) {
  return selection.status === 'unconfirmed'
    ? 'This model exists, but its measurements are unconfirmed. Values and diagrams are withheld.'
    : selection.status === 'review'
      ? 'The source returned a different style. Measurements are withheld until reviewed.'
      : 'The original service did not provide measurements for this configuration.';
}
function header(user: AuthUser | null) {
  return `<header class="ms-header"><a class="ms-logo" href="/" aria-label="SofaPaint drawing workspace">sofa<span>paint</span><span class="ms-logo-dot">.</span></a><span class="ms-header-divider"></span><a href="/search" class="ms-library-link">Measurement library</a><div class="ms-account">${user ? `<span>${escape(user.email)}</span><button data-action="signout" class="ms-text-button">Sign out</button>` : '<a href="/">Drawing workspace ↗</a>'}</div></header>`;
}
function gate(user: AuthUser | null, message = '') {
  catalogueReady = false;
  root.innerHTML = `${header(user)}<section class="ms-gate"><span class="ms-eyebrow">COMFORT WORKS · MEASUREMENT LIBRARY</span><h1>Measurement library</h1><p>${user ? 'Use a verified @comfort-works.com account to open the measurement library.' : 'Sign in to SofaPaint with your @comfort-works.com account to search and compare sofa measurements.'}</p><button class="ms-primary" data-action="signin">Continue with Google <span>→</span></button><p class="ms-error" role="status">${escape(message)}</p></section>`;
}
function shell(user: AuthUser) {
  root.innerHTML = `${header(user)}<div class="ms-page"><section class="ms-search-section"><div class="ms-search-heading"><div><span class="ms-eyebrow">COMFORT WORKS</span></div><span id="ms-catalogue-state" class="ms-catalogue-state" role="status">Opening the library…</span></div><div class="ms-search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.4"/><path d="m16 16 4.5 4.5"/></svg><input id="ms-query" type="search" autocomplete="off" aria-label="Search sofas by name, reference or brand" placeholder="Search a sofa name, reference or brand…" value="${escape(query)}" disabled/><kbd>/</kbd></div><div class="ms-search-under"><div><button class="ms-text-button" data-example="Stocksund">Stocksund</button><span>·</span><button class="ms-text-button" data-example="Axis">Axis</button><span>·</span><button class="ms-text-button" data-example="Ektorp">Ektorp</button></div></div><div id="ms-results" aria-label="Sofa search results"></div></section><section id="ms-compare" aria-label="Model comparison"></section><section id="ms-detail" aria-label="Product measurements"></section><div id="ms-empty" class="ms-empty"><span class="ms-empty-rule"></span><p>Search by sofa name, reference or brand.</p></div><footer class="ms-footer"><span>SofaPaint / Comfort Works</span><span>Archive · 29 September 2026</span></footer></div>`;
  const input = root.querySelector<HTMLInputElement>('#ms-query')!;
  input.addEventListener('input', () => {
    query = input.value;
    showResults = true;
    resultLimit = 20;
    focusedIndex = -1;
    updateUrl(false);
    renderResults();
  });
  input.addEventListener('keydown', event => {
    const results = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-open-result]'));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusedIndex = Math.min(
        results.length - 1,
        Math.max(0, focusedIndex + (event.key === 'ArrowDown' ? 1 : -1))
      );
      results[focusedIndex]?.focus();
    } else if (event.key === 'Enter' && results.length) {
      event.preventDefault();
      results[0].click();
    } else if (event.key === 'Escape') {
      input.value = '';
      query = '';
      updateUrl(false);
      renderResults();
    }
  });
}
function updateUrl(push: boolean) {
  const url = new URL(location.href);
  url.pathname = active ? selectionPath(active.selection) : '/search';
  url.search = '';
  if (query) url.searchParams.set('q', query);
  if (units === 'in') url.searchParams.set('units', units);
  if (showTolerances) url.searchParams.set('tolerances', '1');
  comparisons.forEach(item => url.searchParams.append('compare', selectionPath(item.selection)));
  history[push ? 'pushState' : 'replaceState']({}, '', url);
}
function renderResults() {
  const area = root.querySelector<HTMLElement>('#ms-results');
  if (!area || !catalogueReady) return;
  if (active && !showResults) {
    area.innerHTML = `<div class="ms-search-selection"><span>${escape(active.product.name)} · ${escape(active.selection.style)}</span><button class="ms-text-button" data-action="browse">Choose another model ↓</button></div>`;
    return;
  }
  const matches = searchProducts(searchIndex, query);
  if (!query.trim()) {
    area.innerHTML = '';
    return;
  }
  const rows = matches.slice(0, resultLimit);
  area.innerHTML = `<div class="ms-results-meta"><span>${matches.length} product${matches.length === 1 ? '' : 's'}</span><span>Choose a model to view · ＋ to compare</span></div>${rows
    .map(
      product =>
        `<article class="ms-product-result"><div class="ms-result-product"><span class="ms-brand">${escape(product.brand || 'Comfort Works')}</span><h2>${escape(product.name)}</h2><code>${escape(product.reference)}</code></div><div class="ms-result-models">${
          product.selections.length
            ? [...product.selections]
                .sort((a, b) => Number(b.status === 'confirmed') - Number(a.status === 'confirmed'))
                .map(
                  selection =>
                    `<div class="ms-model-result ${active?.selection.key === selection.key ? 'is-active' : ''}"><button class="ms-model-open" data-open-result="${escape(selection.key)}"><span class="ms-model-name">${escape(selection.versionLabel || 'Standard model')}<span class="ms-model-style">${escape(selection.style)} <code>${escape(selection.styleCode)}</code></span></span><span class="ms-result-reference">${escape(selection.scopedReference)}</span>${status(selection)}<span aria-hidden="true" class="ms-arrow">→</span></button><button class="ms-compare-add ${comparisons.some(item => item.selection.key === selection.key) ? 'is-added' : ''}" data-compare="${escape(selection.key)}" aria-label="${comparisons.some(item => item.selection.key === selection.key) ? 'Remove from' : 'Add to'} comparison: ${escape(product.name)}, ${escape(selection.versionLabel || 'Standard')}, ${escape(selection.style)}">${comparisons.some(item => item.selection.key === selection.key) ? '✓' : '＋'}</button></div>`
                )
                .join('')
            : '<p class="ms-no-models">No model configuration was supplied by the original service.</p>'
        }</div></article>`
    )
    .join(
      ''
    )}${!matches.length ? '<div class="ms-no-results">No sofas match that search. Try a shorter name or the product reference.</div>' : matches.length > resultLimit ? `<button class="ms-more" data-action="more">Show ${Math.min(20, matches.length - resultLimit)} more products</button>` : ''}`;
}
function imageMarkup(
  image: { url: string; name: string },
  section: string,
  selectionKey = active?.selection.key || ''
) {
  const scope = `${selectionKey}|${image.url}`;
  const drawing = drawingEditor?.getMeasurementDrawing(scope);
  return `<figure class="ms-diagram ${drawing?.preview ? 'is-loaded' : ''}"><button class="ms-image-open" data-image-open="${escape(image.url)}" data-image-selection="${escape(selectionKey)}" aria-label="Draw on ${escape(section)} diagram"><img data-archive-image="${escape(image.url)}" data-drawing-scope="${escape(scope)}" ${drawing?.preview ? `src="${escape(drawing.preview)}"` : ''} alt="${escape(section)} diagram — ${escape(image.name)}" decoding="async"/></button><span class="ms-drawing-badge" ${drawing?.count ? '' : 'hidden'}>${drawing?.count || 0} annotation${drawing?.count === 1 ? '' : 's'} · ${drawing?.units === 'in' ? 'inches' : 'cm'}</span><figcaption>${escape(section)} <span>Measurement diagram</span></figcaption><button class="ms-image-retry" data-image-retry hidden>Retry diagram</button></figure>`;
}
function renderDetail() {
  const target = root.querySelector<HTMLElement>('#ms-detail');
  if (!target) return;
  root.querySelector<HTMLElement>('#ms-empty')!.hidden = Boolean(active || comparisons.length);
  if (!active) {
    target.innerHTML = '';
    document.title = 'Measurements · SofaPaint';
    return;
  }
  root.classList.toggle('ms-show-tolerances', showTolerances);
  const { product, selection } = active;
  const detail = details.get(selection.key);
  const error = errors.get(selection.key);
  document.title = `${product.name} · SofaPaint`;
  target.innerHTML = `<div class="ms-detail-heading"><div><div class="ms-detail-kicker"><span>${escape(product.brand)}</span>${status(selection)}</div><h2>${escape(product.name)}</h2><p>${escape(selection.versionLabel || 'Standard model')} <span> / </span> ${escape(selection.style)} <code>${escape(selection.styleCode)}</code></p><code class="ms-detail-reference">${escape(selection.scopedReference)}</code></div><div class="ms-detail-actions">${unitToggle()}${toleranceToggle()}${selection.status === 'confirmed' && detail ? `<button class="ms-secondary" data-action="pdf" ${pdfBusy ? 'disabled' : ''}>${pdfBusy ? 'Preparing PDF…' : 'Save PDF ↓'}</button>` : ''}<button class="ms-secondary" data-compare="${escape(selection.key)}">${comparisons.some(item => item.selection.key === selection.key) ? 'Remove comparison' : '＋ Compare model'}</button>${selection.status === 'confirmed' ? `<a class="ms-primary" href="${escape(drawingPath(selection))}">Draw in SofaPaint ↗</a>` : ''}</div></div>${selection.status !== 'confirmed' ? `<div class="ms-withheld"><strong>${labels[selection.status]}</strong><p>${notice(selection)}</p><div class="ms-dimensions">${['Width', 'Depth', 'Height'].map(name => `<div><span>${name}</span><strong>—</strong></div>`).join('')}</div><div class="ms-blank-table"><span>Measurements</span><span>—</span><span>—</span><span>—</span></div></div>` : error ? `<div class="ms-withheld" role="alert"><p>${escape(error)}</p><button class="ms-secondary" data-retry="${escape(selection.key)}">Try again</button></div>` : !detail ? '<div class="ms-loading" role="status"><span></span>Opening measurements…</div>' : `<div class="ms-overview"><div class="ms-dimensions">${detail.dimensions.map(dimension => `<div><span>${escape(dimension.name)}</span><strong>${copyValue(dimension.name.charAt(0).toUpperCase() + dimension.name.slice(1), dimension.value)} <small>${units}</small></strong></div>`).join('')}</div><div class="ms-overview-notes">${detail.flexifit ? `<span>Flexifit</span><p>${escape(detail.flexifit)}</p>` : ''}${detail.lining ? `<span>Lining</span><p>${escape(detail.lining)}</p>` : ''}<span>${detail.components.length} components · ${detail.components.reduce((n, c) => n + c.measurements.length, 0)} measurements</span></div></div><nav class="ms-part-index" aria-label="Jump to component"><span class="ms-part-index-label">Parts</span>${detail.components.map((component, i) => `<a href="#ms-component-${i}" aria-label="Jump to ${escape(component.name)}"><span class="ms-part-name">${escape(component.name)}</span></a>`).join('')}</nav>${detail.components.map((component, i) => `<section class="ms-component" id="ms-component-${i}"><div class="ms-component-heading"><h3>${escape(component.name)}</h3><span>${escape(component.quantity)} piece${component.quantity === '1' ? '' : 's'}${component.skirt ? ` · ${escape(component.skirt)}` : ''}</span></div>${component.images.length ? `<div class="ms-diagrams">${component.images.map(image => imageMarkup(image, component.name)).join('')}</div>` : '<div class="ms-missing-diagram">No diagram was provided for this component.</div>'}<div class="ms-component-data"><div class="ms-table-panel"><div class="ms-panel-heading"><h4>Measurements</h4><span>Values in ${escape([...new Set(component.measurements.map(row => (unitLabel(row.unit || 'cm', units) === 'in' ? 'inches' : unitLabel(row.unit || 'cm', units))))].join(', '))}</span></div><div class="ms-table-scroll"><table><thead><tr><th scope="col">Name</th><th scope="col">Value</th>${showTolerances ? '<th scope="col">Tolerance (min)</th><th scope="col">Tolerance (max)</th>' : ''}</tr></thead><tbody>${component.measurements.map(measurement => `<tr class="ms-copy-row" ${copyAttributes(measurement.name, measurement.value, measurement.unit)}><th scope="row"><button class="ms-copy-name" ${copyAttributes(measurement.name, measurement.value, measurement.unit)} title="Copy measurement">${escape(measurement.name)}${copyIcon}</button></th><td class="ms-value">${copyValue(measurement.name, measurement.value, measurement.unit)}</td>${showTolerances ? `<td>${value(measurement.min, measurement.unit)}</td><td>${value(measurement.max, measurement.unit)}</td>` : ''}</tr>`).join('') || '<tr><td colspan="4">No measurements supplied.</td></tr>'}</tbody></table></div></div><aside class="ms-attribute-panel"><div class="ms-panel-heading"><h4>Attributes</h4></div>${component.attributes.length ? `<ul>${component.attributes.map(attribute => `<li>${escape(attribute)}</li>`).join('')}</ul>` : '<p class="ms-muted">No attributes supplied.</p>'}${component.comments ? `<div class="ms-component-note"><span>Comments</span><p>${escape(component.comments)}</p></div>` : ''}${component.lining ? `<div class="ms-component-note"><span>Lining</span><p>${escape(component.lining)}</p></div>` : ''}</aside></div></section>`).join('')}`}`;
  observeImages();
  observeParts();
}
function renderComparisonDifference(result: ReturnType<typeof comparisonDifference>) {
  if (result.kind === 'unavailable')
    return '<td class="ms-difference-cell is-unavailable" aria-label="Difference unavailable">—</td>';
  const note = result.kind === 'same' ? 'Same' : result.mode === 'range' ? 'Range' : 'Different';
  return `<td class="ms-difference-cell is-${result.kind}"><strong>${escape(result.amount)} <small>${escape(result.unit)}</small></strong><span>${note}</span></td>`;
}
function renderComparison() {
  root.classList.toggle('ms-show-tolerances', showTolerances);
  const area = root.querySelector<HTMLElement>('#ms-compare');
  if (!area) return;
  if (!comparisons.length) {
    area.innerHTML = '';
    return;
  }
  const models = comparisons.map(item =>
    item.selection.status === 'confirmed' ? details.get(item.selection.key) || null : null
  );
  const rows = comparisonRows(models);
  const showDifference = comparisons.length > 1;
  const blankCells = Array.from(
    { length: comparisons.length + Number(showDifference) },
    () => '<td></td>'
  ).join('');
  const differences = [
    ...['width', 'depth', 'height'].map(name =>
      comparisonDifference(
        models.map(model => model?.dimensions.find(d => d.name === name)?.value ?? null),
        'cm',
        units
      )
    ),
    ...rows.map(row =>
      comparisonDifference(
        row.values.map(value => value?.value ?? null),
        row.unit,
        units
      )
    ),
  ];
  const sameCount = differences.filter(item => item.kind === 'same').length;
  const differentCount = differences.filter(item => item.kind === 'different').length;
  const differenceHeader = showDifference
    ? `<th scope="col" class="ms-difference-heading"><strong>Difference</strong><span>${comparisons.length === 2 ? 'right − left' : 'largest − smallest'}</span><div class="ms-difference-summary"><div class="is-same"><b>${sameCount}</b> same</div><div class="is-different"><b>${differentCount}</b> different</div></div><small>At one decimal place</small></th>`
    : '';
  const modelHeaders = comparisons
    .map(
      ({ product, selection }, index) =>
        `<th scope="col"><div class="ms-compare-column-title"><button data-open="${escape(selection.key)}">${escape(product.name)}</button><button class="ms-remove" data-compare="${escape(selection.key)}" aria-label="Remove ${escape(product.name)}, ${escape(selection.versionLabel)}, ${escape(selection.style)} from comparison">×</button></div><p>${escape(selection.versionLabel || 'Standard model')}</p><span class="ms-compare-style">${escape(selection.style)} / ${escape(selection.styleCode)}</span><code>${escape(selection.scopedReference)}</code>${status(selection)}${models[index]?.components[0]?.images[0] ? imageMarkup(models[index]!.components[0].images[0], 'Frame', selection.key) : `<div class="ms-compare-placeholder">${selection.status === 'confirmed' ? (errors.has(selection.key) ? `<button class="ms-text-button" data-retry="${escape(selection.key)}">Retry measurements</button>` : 'Loading measurements…') : 'Measurements withheld'}</div>`}</th>`
    )
    .join('');
  const dimensionRows = ['width', 'depth', 'height']
    .map(name => {
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      const values = models.map(
        model => model?.dimensions.find(d => d.name === name)?.value ?? null
      );
      const difference = comparisonDifference(values, 'cm', units);
      const cells = values
        .map(raw => `<td class="ms-value">${copyValue(label, raw ?? '—')}</td>`)
        .join('');
      return `<tr class="${showDifference && difference.kind !== 'unavailable' ? `ms-measurement-${difference.kind}` : ''}"><th scope="row">${label} <small>${units}</small></th>${cells}${showDifference ? renderComparisonDifference(difference) : ''}</tr>`;
    })
    .join('');
  const componentRows = rows
    .map((row, index) => {
      const group =
        index === 0 || rows[index - 1].section !== row.section
          ? `<tr class="ms-compare-group"><th scope="row">${escape(row.section)}</th>${blankCells}</tr>`
          : '';
      const difference = comparisonDifference(
        row.values.map(value => value?.value ?? null),
        row.unit,
        units
      );
      const cells = row.values
        .map(
          value =>
            `<td><strong class="ms-value">${copyValue(row.name, value?.value ?? '—', row.unit)}</strong>${value && showTolerances ? `<small class="ms-tolerance">${escape(formatMeasurement(value.min, row.unit, units))} – ${escape(formatMeasurement(value.max, row.unit, units))}</small>` : ''}</td>`
        )
        .join('');
      return `${group}<tr class="${showDifference && difference.kind !== 'unavailable' ? `ms-measurement-${difference.kind}` : ''}"><th scope="row">${escape(row.name)} <small>${escape(unitLabel(row.unit, units))}</small></th>${cells}${showDifference ? renderComparisonDifference(difference) : ''}</tr>`;
    })
    .join('');
  const attributes = models
    .map(
      model =>
        `<td class="ms-compare-attributes">${model?.components.map(component => `<strong>${escape(component.name)} × ${escape(component.quantity)}</strong><ul>${component.attributes.map(attribute => `<li>${escape(attribute)}</li>`).join('')}</ul>${component.skirt ? `<p>Style: ${escape(component.skirt)}</p>` : ''}${component.comments && component.comments !== 'No comments' ? `<p>${escape(component.comments)}</p>` : ''}${component.lining ? `<p>Lining: ${escape(component.lining)}</p>` : ''}`).join('') || '—'}</td>`
    )
    .join('');
  area.innerHTML = `<div class="ms-comparison-title"><div><span class="ms-eyebrow">SIDE BY SIDE</span><h2>Compare models <span>${comparisons.length}/4</span></h2></div><div class="ms-detail-actions">${unitToggle()}${toleranceToggle()}<button class="ms-secondary" data-action="pdf" ${pdfBusy ? 'disabled' : ''}>${pdfBusy ? 'Preparing PDF…' : 'Save PDF ↓'}</button><button class="ms-text-button" data-action="clear-compare">Clear comparison</button></div></div><div class="ms-comparison-scroll"><table class="ms-comparison-table"><thead><tr><th scope="col" class="ms-comparison-label">Measurements<span>${showTolerances ? 'Values and tolerance ranges' : 'Measurement values'}</span></th>${modelHeaders}${differenceHeader}</tr></thead><tbody><tr class="ms-compare-group"><th scope="row">Overall dimensions</th>${blankCells}</tr>${dimensionRows}${componentRows}<tr class="ms-compare-group"><th scope="row">Attributes & details</th>${blankCells}</tr><tr><th scope="row">Component details</th>${attributes}${showDifference ? '<td class="ms-difference-cell is-unavailable">—</td>' : ''}</tr></tbody></table></div><p class="ms-compare-footnote">${showDifference ? 'Green rows match at the displayed precision; amber rows differ. ' : ''}Unconfirmed models stay blank. A dash also means that measurement is unavailable for that model.</p>`;
  observeImages();
}
async function loadDetail(selection: Selection, quiet = false) {
  if (selection.status !== 'confirmed' || details.has(selection.key) || loading.has(selection.key))
    return;
  const current = generation;
  loading.add(selection.key);
  errors.delete(selection.key);
  try {
    const product = productFor(selection);
    const response = await session.request(`detail:${selection.key}`, {
      phase: 'load-selected',
      selectedItems: [{ ...selection, productName: product.name, selectionKey: selection.key }],
    });
    if (current !== generation) return;
    const item = response.items?.find((item: any) => item.success);
    if (!item?.data?.qcMeasurements?.data)
      throw new Error(response.items?.[0]?.message || 'No measurements are available.');
    details.set(selection.key, normalizeDetail(item.data.qcMeasurements.data, selection.status));
  } catch (error) {
    if (current !== generation || (error as Error).name === 'AbortError') return;
    errors.set(selection.key, (error as Error).message);
  } finally {
    if (current === generation) {
      loading.delete(selection.key);
      if (
        !quiet ||
        active?.selection.key === selection.key ||
        comparisons.some(item => item.selection.key === selection.key)
      ) {
        renderDetail();
        renderComparison();
      }
    }
  }
}
function findSelection(key: string) {
  for (const product of products) {
    const selection = product.selections.find(selection => selection.key === key);
    if (selection) return { product, selection };
  }
  return null;
}
function openSelection(key: string) {
  const item = findSelection(key);
  if (!item) return;
  active = item;
  showResults = false;
  updateUrl(true);
  renderResults();
  renderDetail();
  void loadDetail(item.selection);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function toggleCompare(key: string) {
  const index = comparisons.findIndex(item => item.selection.key === key);
  if (index >= 0) comparisons.splice(index, 1);
  else {
    const item = findSelection(key);
    if (!item) return;
    if (comparisons.length === 4) {
      root.querySelector('#ms-compare')?.scrollIntoView({ behavior: 'instant' });
      return;
    }
    comparisons.push(item);
    void loadDetail(item.selection);
  }
  updateUrl(true);
  renderResults();
  renderDetail();
  renderComparison();
}
function observeImages() {
  root.querySelectorAll<HTMLImageElement>('img[data-archive-image]').forEach(image => {
    if (image.dataset.observed) return;
    image.dataset.observed = 'true';
    imageObserver?.observe(image);
  });
}
function pumpImages() {
  while (imageRequests < 4 && imageQueue.length) {
    const image = imageQueue.shift()!;
    if (!image.isConnected) continue;
    imageRequests++;
    const current = generation;
    const url = image.dataset.archiveImage!;
    void session
      .request(`image:${url}`, { candidates: [url] }, 'image-proxy')
      .then(data => {
        if (current !== generation || !image.isConnected) return;
        if (!/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(data.url || ''))
          throw new Error('Diagram unavailable');
        const drawing = drawingEditor?.getMeasurementDrawing(image.dataset.drawingScope || '');
        image.src = drawing?.preview || data.url;
        image.closest('figure')?.classList.add('is-loaded');
      })
      .catch(() => {
        if (current !== generation || !image.isConnected) return;
        image.alt = 'Diagram could not load.';
        const retry = image
          .closest('figure')
          ?.querySelector<HTMLButtonElement>('[data-image-retry]');
        if (retry) retry.hidden = false;
      })
      .finally(() => {
        imageRequests--;
        pumpImages();
      });
  }
}
function restoreRoute() {
  active = selectionFromPath(products, location.pathname);
  showResults = !active;
  comparisons = new URLSearchParams(location.search)
    .getAll('compare')
    .map(path => selectionFromPath(products, path))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter(
      (item, index, list) =>
        list.findIndex(row => row.selection.key === item.selection.key) === index
    )
    .slice(0, 4);
  query = new URLSearchParams(location.search).get('q') || '';
  units = new URLSearchParams(location.search).get('units') === 'in' ? 'in' : 'cm';
  showTolerances = new URLSearchParams(location.search).get('tolerances') === '1';
  const input = root.querySelector<HTMLInputElement>('#ms-query');
  if (input) input.value = query;
  renderResults();
  renderDetail();
  renderComparison();
  if (location.pathname !== '/search' && !active) {
    const area = root.querySelector('#ms-detail');
    if (area)
      area.innerHTML =
        '<div class="ms-withheld" role="status">This model link could not be found. Search the sofa name or reference above.</div>';
  }
  if (active) void loadDetail(active.selection);
  comparisons.forEach(item => {
    void loadDetail(item.selection);
  });
}
async function onIdentity(user: AuthUser | null) {
  const next = getCwMeasurementIdentity(user);
  if (next === identity) return;
  identity = next;
  generation++;
  session.setIdentity(next);
  products = [];
  searchIndex = [];
  details.clear();
  errors.clear();
  loading.clear();
  active = null;
  comparisons = [];
  catalogueReady = false;
  drawingEditor?.clearMeasurementDrawings();
  imageObserver?.disconnect();
  partObserver?.disconnect();
  imageQueue = [];
  if (!user || !user.emailConfirmed || !/^[^@]+@comfort-works\.com$/i.test(user.email)) {
    gate(user);
    return;
  }
  shell(user);
  const current = generation;
  try {
    const data = await session.request('catalogue', { phase: 'catalogue-index' });
    if (current !== generation) return;
    products = data.products;
    searchIndex = indexProducts(products);
    catalogueReady = true;
    root.querySelector<HTMLInputElement>('#ms-query')!.disabled = false;
    root.querySelector('#ms-catalogue-state')!.textContent =
      `${products.length.toLocaleString()} products · Ready to search`;
    restoreRoute();
    if (!active) root.querySelector<HTMLInputElement>('#ms-query')!.focus();
  } catch (error) {
    if (current !== generation) return;
    root.querySelector('#ms-catalogue-state')!.textContent = 'Library unavailable';
    root.querySelector('#ms-results')!.innerHTML =
      `<div class="ms-withheld" role="alert">${escape((error as Error).message)} <button class="ms-secondary" data-action="retry-catalogue">Try again</button></div>`;
  }
}
export async function initMeasurementSearch() {
  root =
    document.getElementById('measurement-search') ||
    document.body.appendChild(document.createElement('main'));
  root.id = 'measurement-search';
  imageObserver = new IntersectionObserver(
    entries => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          imageObserver?.unobserve(entry.target);
          imageQueue.push(entry.target as HTMLImageElement);
        }
      pumpImages();
    },
    { rootMargin: '250px' }
  );
  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-action],[data-open-result],[data-open],[data-compare],[data-example],[data-retry],[data-image-retry],[data-image-open],[data-units],[data-copy-label]'
    );
    if (!button) return;
    if (button.dataset.copyLabel) {
      void copyMeasurement(button);
    } else if (button.dataset.action === 'tolerances') {
      showTolerances = !showTolerances;
      updateUrl(false);
      renderDetail();
      renderComparison();
    } else if (button.dataset.units) {
      units = button.dataset.units === 'in' ? 'in' : 'cm';
      updateUrl(false);
      renderDetail();
      renderComparison();
      void refreshDrawingUnits();
    } else if (button.dataset.action === 'pdf') {
      void savePdf();
    } else if (button.dataset.action === 'signin') {
      sessionStorage.setItem('sofapaint:auth-return', location.pathname + location.search);
      void authService.signInWithGoogle().then(result => {
        if (!result.success) gate(authService.getCurrentUser(), result.error.message);
      });
    } else if (button.dataset.action === 'signout') {
      session.clear();
      drawingEditor?.clearMeasurementDrawings();
      generation++;
      details.clear();
      imageObserver?.disconnect();
      imageQueue = [];
      gate(null);
      void authService.signOut().then(result => {
        if (!result.success) gate(authService.getCurrentUser(), result.error.message);
      });
    } else if (button.dataset.action === 'retry-catalogue') {
      identity = '!retry';
      void onIdentity(authService.getCurrentUser());
    } else if (button.dataset.action === 'browse') {
      showResults = true;
      renderResults();
      root.querySelector<HTMLInputElement>('#ms-query')?.focus();
    } else if (button.dataset.action === 'more') {
      resultLimit += 20;
      renderResults();
    } else if (button.dataset.action === 'clear-compare') {
      comparisons = [];
      updateUrl(true);
      renderComparison();
      renderResults();
      renderDetail();
    } else if (button.dataset.openResult || button.dataset.open)
      openSelection(button.dataset.openResult || button.dataset.open!);
    else if (button.dataset.compare) toggleCompare(button.dataset.compare);
    else if (button.dataset.example) {
      if (!catalogueReady) return;
      query = button.dataset.example;
      showResults = true;
      root.querySelector<HTMLInputElement>('#ms-query')!.value = query;
      updateUrl(false);
      renderResults();
    } else if (button.dataset.retry) {
      const item = findSelection(button.dataset.retry);
      if (item) {
        void loadDetail(item.selection);
        renderDetail();
      }
    } else if (button.dataset.imageOpen) {
      void openDiagram(button.dataset.imageOpen, button.dataset.imageSelection || '');
    } else if (button.hasAttribute('data-image-retry')) {
      const image = button.closest('figure')?.querySelector<HTMLImageElement>('img');
      if (image) {
        button.hidden = true;
        imageQueue.push(image);
        pumpImages();
      }
    }
  });
  root.addEventListener('keydown', event => {
    const focused = (event.target as HTMLElement).closest('[data-open-result]');
    if (!focused || !['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      root.querySelector<HTMLInputElement>('#ms-query')?.focus();
      return;
    }
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-open-result]'));
    const index = buttons.indexOf(focused as HTMLButtonElement);
    buttons[
      Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    ]?.focus();
  });
  root.addEventListener('pointerover', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-open-result]');
    const item = button?.dataset.openResult ? findSelection(button.dataset.openResult) : null;
    if (
      !item ||
      item.selection.status !== 'confirmed' ||
      prefetches >= 2 ||
      details.has(item.selection.key)
    )
      return;
    prefetches++;
    void loadDetail(item.selection, true).finally(() => {
      prefetches--;
    });
  });
  window.addEventListener('popstate', () => {
    if (catalogueReady) restoreRoute();
  });
  window.addEventListener('keydown', event => {
    if (event.key === '/' && !(event.target instanceof HTMLInputElement) && catalogueReady) {
      event.preventDefault();
      root.querySelector<HTMLInputElement>('#ms-query')?.focus();
    }
  });
  window.addEventListener('pagehide', () => {
    session.clear();
    drawingEditor?.clearMeasurementDrawings();
    generation++;
    details.clear();
    products = [];
    searchIndex = [];
    imageQueue = [];
    root.replaceChildren();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      identity = '!restored';
      void onIdentity(authService.getCurrentUser());
    }
  });
  gate(null, 'Restoring your SofaPaint session…');
  authService.onAuthStateChange(user => {
    void onIdentity(user);
  });
  try {
    await authService.initialize();
    if (!authService.getCurrentUser()) gate(null);
  } catch {
    gate(null, 'Sign-in is unavailable. Please try again.');
  }
}

function observeParts() {
  partObserver?.disconnect();
  partObserver = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        root.querySelectorAll('.ms-part-index a').forEach(link => {
          const selected = link.getAttribute('href') === `#${entry.target.id}`;
          link.classList.toggle('is-current', selected);
          if (selected) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }
    },
    { rootMargin: '-10% 0px -65% 0px', threshold: 0 }
  );
  root
    .querySelectorAll('#ms-detail .ms-component')
    .forEach(section => partObserver?.observe(section));
}

async function savePdf() {
  if (pdfBusy) return;
  const current = generation;
  const exportUnits = units;
  const exportTolerances = showTolerances;
  const chosen = [...comparisons, ...(active ? [active] : [])].filter(
    (item, index, list) =>
      list.findIndex(other => other.selection.key === item.selection.key) === index
  );
  if (!chosen.length) return;
  pdfBusy = true;
  renderDetail();
  renderComparison();
  try {
    await Promise.all(chosen.map(item => loadDetail(item.selection)));
    if (current !== generation) return;
    if (
      chosen.some(item => item.selection.status === 'confirmed' && !details.has(item.selection.key))
    )
      throw new Error('A model could not load. Retry its measurements before saving the PDF.');
    const diagrams = new Map<string, string>();
    const sources = [
      ...new Set(
        chosen.flatMap(
          item =>
            details
              .get(item.selection.key)
              ?.components.flatMap(component => component.images.map(image => image.url)) || []
        )
      ),
    ];
    // Bounded parallelism; all components, including ones not yet scrolled into
    // view, are included. Each request is still tied to the verified identity.
    for (let offset = 0; offset < sources.length; offset += 4) {
      await Promise.all(
        sources.slice(offset, offset + 4).map(async url => {
          const data = await session.request(`image:${url}`, { candidates: [url] }, 'image-proxy');
          if (!data.url?.startsWith('data:image/'))
            throw new Error('A diagram could not load. Retry Save PDF.');
          diagrams.set(url, data.url);
        })
      );
      if (current !== generation) return;
    }
    for (const item of chosen) {
      for (const component of details.get(item.selection.key)?.components || []) {
        for (const image of component.images) {
          const drawing = await drawingEditor?.getMeasurementDrawingPreview(
            `${item.selection.key}|${image.url}`,
            exportUnits
          );
          if (current !== generation) return;
          if (drawing) diagrams.set(`${item.selection.key}|${image.url}`, drawing);
        }
      }
    }
    await document.fonts.ready;
    const { buildMeasurementPdf } = await import('./pdf');
    const bytes = await buildMeasurementPdf(
      chosen.map(item => ({
        ...item,
        detail: item.selection.status === 'confirmed' ? details.get(item.selection.key)! : null,
      })),
      exportUnits,
      diagrams,
      exportTolerances
    );
    if (current !== generation) return;
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${chosen.length === 1 ? chosen[0].selection.scopedReference + '-' + chosen[0].selection.styleCode : 'sofa-comparison'}-${exportUnits}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    if (current !== generation) return;
    const message = document.createElement('p');
    message.className = 'ms-withheld';
    message.setAttribute('role', 'alert');
    message.textContent = (error as Error).message;
    root.querySelector('#ms-detail')?.prepend(message);
  } finally {
    pdfBusy = false;
    if (current === generation) {
      root.querySelectorAll<HTMLButtonElement>('[data-action="pdf"]').forEach(button => {
        button.disabled = false;
        button.textContent = 'Save PDF ↓';
      });
    }
  }
}

function updateDrawingPreviews() {
  root.querySelectorAll<HTMLImageElement>('img[data-drawing-scope]').forEach(image => {
    const drawing = drawingEditor?.getMeasurementDrawing(image.dataset.drawingScope || '');
    if (!drawing?.preview) return;
    image.src = drawing.preview;
    image.closest('figure')?.classList.add('is-loaded');
    const badge = image.closest('figure')?.querySelector<HTMLElement>('.ms-drawing-badge');
    if (badge) {
      badge.hidden = !drawing.count;
      badge.textContent = `${drawing.count} annotation${drawing.count === 1 ? '' : 's'} · ${drawing.units === 'in' ? 'inches' : 'cm'}`;
    }
  });
}
async function refreshDrawingUnits() {
  const current = generation;
  await drawingEditor?.refreshMeasurementDrawingUnits(units);
  if (current === generation) updateDrawingPreviews();
}
async function openDiagram(url: string, selectionKey: string) {
  const current = generation;
  const item = findSelection(selectionKey);
  const detail = details.get(selectionKey);
  const component = detail?.components.find(component =>
    component.images.some(image => image.url === url)
  );
  if (!item || !component) return;
  try {
    const [data, module] = await Promise.all([
      session.request(`image:${url}`, { candidates: [url] }, 'image-proxy'),
      import('./editor'),
    ]);
    if (current !== generation) return;
    drawingEditor = module;
    await module.openMeasurementEditor({
      scope: `${selectionKey}|${url}`,
      source: data.url,
      title: `${item.product.name} / ${component.name}`,
      filename: component.images.find(image => image.url === url)!.name,
      units,
      section: component.name,
      measurements: detail!.components.flatMap(component =>
        component.measurements.map(row => ({
          ...row,
          key: `${component.key}|${row.key}`,
          section: component.name,
        }))
      ),
      onPreview: () => {
        if (current === generation) updateDrawingPreviews();
      },
      onUnits: next => {
        if (current !== generation) return;
        units = next;
        updateUrl(false);
        renderDetail();
        renderComparison();
        void refreshDrawingUnits();
      },
    });
  } catch (error) {
    if (current !== generation) return;
    const message = document.createElement('p');
    message.className = 'ms-withheld';
    message.setAttribute('role', 'alert');
    message.textContent = (error as Error).message;
    root.querySelector('#ms-detail')?.prepend(message);
  }
}

async function copyMeasurement(element: HTMLElement) {
  const label = element.dataset.copyLabel,
    number = element.dataset.copyValue,
    unit = element.dataset.copyUnit;
  if (!label || !number || !unit) return;
  const text = `${label} = ${number} ${unit}`;
  let toast = root.querySelector<HTMLElement>('.ms-copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'ms-copy-toast';
    toast.setAttribute('role', 'status');
    root.appendChild(toast);
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.textContent = `Copied: ${text}`;
  } catch {
    toast.textContent =
      'Clipboard access was blocked. Select the measurement and copy it manually.';
  }
  toast.dataset.message = text;
  toast.hidden = false;
  setTimeout(() => {
    if (toast?.dataset.message === text) toast.hidden = true;
  }, 2200);
}
