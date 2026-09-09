import './studio.css';
import { POPULAR_MODELS, createPopularModel } from './popular-models';
import { createBenchmarkDocument } from './benchmarks';
import { STUDIO_GUIDES, applyGalleryGuide } from './gallery';
import { SofaRenderer, type StudioDimension } from './renderer';
import {
  createSofaDocument,
  cloneSofa,
  parseSofaDocument,
  buildSofaParts,
  setPartSize,
  sofaFitNotes,
  SOFA_PRESETS,
  SOFA_SWATCHES,
  type SofaDocument,
  type SofaPreset,
} from './model';
import { fromCw, fromSectional, type StudioOpenRequest } from './adapters';
let launch: ((request?: StudioOpenRequest) => void) | undefined;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
export async function openSofaStudio(request?: StudioOpenRequest): Promise<void> {
  if (launch) {
    launch(request);
    return;
  }
  let doc = createSofaDocument();
  try {
    const saved = localStorage.getItem('sofa-studio-v1');
    if (saved) doc = parseSofaDocument(JSON.parse(saved));
  } catch {
    /* Ignore incompatible saved drafts. */
  }
  let selected: string | null = null;
  let guideView = 'front';
  const undo: SofaDocument[] = [],
    redo: SofaDocument[] = [];
  const dialog = document.createElement('dialog');
  dialog.className = 's3d';
  dialog.setAttribute('aria-label', 'Sofa Studio');
  dialog.innerHTML = `<header class="s3d-header"><div class="s3d-brand">sofa<i>studio</i><small>3D</small></div><input class="s3d-title" aria-label="Model name"><span class="s3d-saved">Saved on this device</span><div class="s3d-header-actions"><button class="s3d-icon-btn" data-action="undo" aria-label="Undo">↶</button><button class="s3d-icon-btn" data-action="redo" aria-label="Redo">↷</button><button class="s3d-btn" data-action="load">Open model</button><button class="s3d-btn" data-action="export">Export ↓</button><button class="s3d-btn primary" data-action="paint">Use in SofaPaint</button><button class="s3d-icon-btn" data-action="close" aria-label="Close studio">×</button></div></header><div class="s3d-body"><aside class="s3d-sidebar left"></aside><main class="s3d-stage"><div class="s3d-canvas"></div><div class="s3d-labels"></div><div class="s3d-stage-top"><div class="s3d-stage-heading">Made to measure<strong>Your sofa, in every dimension.</strong></div><div class="s3d-viewbar">${['perspective', 'front', 'side', 'back', 'top'].map(v => `<button data-view="${v}">${v === 'perspective' ? '3D' : v}</button>`).join('')}</div></div><div class="s3d-toolrail">${[
    ['orbit', '↖', 'Select / orbit'],
    ['move', '✥', 'Move component'],
    ['measure', '↔', 'Measure two surface points'],
    ['dimensions', '⌗', 'Toggle dimensions'],
    ['grid', '▦', 'Toggle floor grid'],
    ['explode', '◇', 'Explode components'],
  ]
    .map(([a, i, t]) => `<button data-tool="${a}" title="${t}" aria-label="${t}">${i}</button>`)
    .join(
      ''
    )}</div><div class="s3d-stage-bottom"><span>Drag to orbit · Scroll to zoom · Click a dimension to resize</span><button data-action="fit">Fit view</button><span class="s3d-unit">CM</span></div></main><aside class="s3d-sidebar right"></aside></div><div class="s3d-menu" hidden>${[
    ['png', 'Image · PNG'],
    ['glb', '3D model · GLB'],
    ['json', 'Editable model · JSON'],
  ]
    .map(([a, t]) => `<button data-action="${a}">${t}</button>`)
    .join('')}</div><div class="s3d-toast" role="status" hidden></div>`;
  document.body.append(dialog);
  dialog.showModal();
  const $ = <T extends HTMLElement = HTMLElement>(q: string) => dialog.querySelector<T>(q)!;
  let toastTimer: ReturnType<typeof setTimeout>;
  const toast = (message: string) => {
    $('.s3d-toast').textContent = message;
    $('.s3d-toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('.s3d-toast').hidden = true), 4500);
  };
  const commit = (next: SofaDocument) => {
    try {
      next = parseSofaDocument(next);
    } catch (e) {
      toast((e as Error).message);
      renderPanels();
      return;
    }
    undo.push(cloneSofa(doc));
    if (undo.length > 60) undo.shift();
    redo.length = 0;
    doc = next;
    refresh();
  };
  const editSize = (field: 'width' | 'height' | 'depth', value: number, partId = selected) => {
    try {
      if (partId) commit(setPartSize(doc, partId, field, value));
      else {
        const next = cloneSofa(doc);
        next.dimensions[field] = value;
        commit(next);
      }
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const inline = (dimension: StudioDimension, anchor: HTMLElement) => {
    dialog.querySelector('.s3d-inline-editor')?.remove();
    const form = document.createElement('form');
    form.className = 's3d-inline-editor';
    const rect = anchor.getBoundingClientRect();
    form.style.left = `${Math.min(innerWidth - 190, rect.left)}px`;
    form.style.top = `${rect.bottom + 5}px`;
    form.innerHTML = `<input type="number" min="1" max="1000" step="0.1" aria-label="${dimension.name}" value="${dimension.value.toFixed(1)}"><span>cm</span><button>Apply</button>`;
    dialog.append(form);
    form.addEventListener('submit', e => {
      e.preventDefault();
      editSize(
        dimension.edit!.field,
        Number(form.querySelector('input')!.value),
        dimension.edit!.partId || null
      );
      form.remove();
    });
    form.querySelector('input')!.select();
  };
  const renderer = new SofaRenderer($('.s3d-canvas'), $('.s3d-labels'), {
    select(id) {
      selected = id;
      renderer.select(id);
      renderPanels();
    },
    move(id, delta) {
      const next = cloneSofa(doc);
      const old = next.overrides[id]?.offset || { x: 0, y: 0, z: 0 };
      next.overrides[id] = {
        ...next.overrides[id],
        offset: { x: old.x + delta.x, y: old.y + delta.y, z: old.z + delta.z },
      };
      commit(next);
    },
    measure(a, b) {
      const next = cloneSofa(doc);
      next.customDimensions.push({ id: crypto.randomUUID(), a, b });
      commit(next);
    },
    edit: inline,
    label(id, offset) {
      const next = cloneSofa(doc);
      next.labelOffsets[id] = offset;
      commit(next);
    },
  });
  function refresh() {
    renderer.update(doc, selected);
    renderPanels();
    try {
      localStorage.setItem('sofa-studio-v1', JSON.stringify(doc));
      $('.s3d-saved').textContent = 'Saved on this device';
    } catch {
      $('.s3d-saved').textContent = 'Export JSON to save';
    }
  }
  const selectField = (label: string, key: string, values: string[], value: string) =>
    `<label class="s3d-field">${label}<select data-style="${key}">${values.map(v => `<option ${v === value ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
  function renderPanels() {
    const constructionOpen =
      dialog.querySelector<HTMLDetailsElement>('.s3d-construction')?.open || false;
    const product = POPULAR_MODELS.find(p => p.id === doc.catalogueModel);
    $('.s3d-title').setAttribute('value', doc.title);
    ($('.s3d-title') as HTMLInputElement).value = doc.title;
    const parts = buildSofaParts(doc);
    const part = parts.find(p => p.id === selected);
    if (selected && !part) selected = null;
    $('.left').innerHTML =
      `<div class="s3d-tabs"><button aria-selected="true">Model & material</button></div><section class="s3d-section s3d-gallery-picker"><h2 class="s3d-section-title">Popular sofas</h2><select data-popular aria-label="Popular sofa model"><option value="">Choose a sofa…</option>${POPULAR_MODELS.map(p => `<option value="${p.id}" ${doc.catalogueModel === p.id ? 'selected' : ''}>${escape(p.brand)} · ${escape(p.title)}</option>`).join('')}</select>${product ? `${product.imageUrl ? `<img class="s3d-product-thumb" src="${escape(product.imageUrl)}" alt="${escape(product.title)} reference">` : ''}<p class="s3d-size-help">${escape(product.version)} · <a href="${escape(product.url)}" target="_blank" rel="noopener">View original</a></p>` : ''}</section>${doc.sleeper ? `<section class="s3d-section"><h2 class="s3d-section-title">Sofa bed</h2><label class="s3d-field">Open bed<input aria-label="Open sofa bed" data-sleeper="open" type="checkbox" ${doc.sleeper.open ? 'checked' : ''}></label><label class="s3d-field">Pull-out depth · cm<input aria-label="Pull-out depth" data-sleeper="extension" type="number" min="1" max="300" value="${doc.sleeper.extension}"></label><p class="s3d-size-help">${doc.sleeper.open ? 'Bed open · back cushions removed' : 'Sofa closed · cushions in place'}</p></section>` : ''}<section class="s3d-section s3d-gallery-picker"><h2 class="s3d-section-title">Measurement guide model</h2><select data-guide aria-label="Measurement guide model"><option value="">Choose gallery construction…</option>${STUDIO_GUIDES.map(([code, name]) => `<option value="${code}" ${doc.guideCode === code ? 'selected' : ''}>${code} · ${name}</option>`).join('')}</select></section><section class="s3d-section"><h2 class="s3d-section-title">Start with a shape</h2><div class="s3d-presets">${Object.entries(
        SOFA_PRESETS
      )
        .map(
          ([id, p]) =>
            `<button class="s3d-preset" data-preset="${id}" aria-pressed="${doc.preset === id}"><svg viewBox="0 0 60 36"><rect x="7" y="8" width="46" height="18" rx="4"/><path d="M4 16h7v14H4zM49 16h7v14h-7zM11 22h38M30 9v13M9 30v4M51 30v4"/></svg>${p.name.replace('The ', '')}</button>`
        )
        .join(
          ''
        )}</div></section><details class="s3d-section s3d-construction"><summary>Construction & proportions</summary>${selectField('Arms', 'arm', ['square', 'round', 'wedge'], doc.style.arm)}${selectField('Back', 'back', ['high', 'short', 'curved'], doc.style.back)}${selectField('Cushions', 'cushion', ['boxed', 'rounded', 'knife', 'half-knife'], doc.style.cushion)}${selectField('Base', 'base', ['snug', 'long-skirt', 'loose-fit', 'straight-skirt'], doc.style.base)}<label class="s3d-field">Frame material<select data-construction="frameStyle"><option value="upholstered" ${doc.construction.frameStyle === 'upholstered' ? 'selected' : ''}>Upholstered</option><option value="slatted" ${doc.construction.frameStyle === 'slatted' ? 'selected' : ''}>Slatted timber</option></select></label><label class="s3d-field">Separate back cushions<input data-construction="backCushions" type="checkbox" ${doc.construction.backCushions ? 'checked' : ''}></label><label class="s3d-field">Loose cushions<input data-construction="looseCushions" type="checkbox" ${doc.construction.looseCushions ? 'checked' : ''}></label><label class="s3d-field">Front projection · cm<input data-construction="frontExtension" type="number" min="0" max="60" value="${doc.construction.frontExtension}"></label>${[
        ['armHeight', 'Arm height'],
        ['armWidth', 'Arm width'],
        ['seatHeight', 'Seat height'],
        ['seatThickness', 'Seat thickness'],
        ['legHeight', 'Support height'],
        ['backThickness', 'F1 · Back base depth'],
      ]
        .map(
          ([key, name]) =>
            `<label class="s3d-field">${name}<input data-global="${key}" type="number" min="1" max="150" value="${doc.dimensions[key as keyof typeof doc.dimensions]}"></label>`
        )
        .join('')}${[
        ['backTopThickness', 'F3 · Back top depth'],
        ['backRake', 'Back rake'],
        ['backTopDrop', 'Back top slope'],
        ['armRollRadius', 'Roll radius'],
        ['armStemWidth', 'Arm upright width'],
        ['armFlare', 'Arm flare'],
        ['armSetback', 'Arm setback'],
        ['backCushionHeight', 'Back cushion height'],
        ['frameHeight', 'Frame height (0: auto)'],
        ['legWidth', 'Support width'],
        ['skirtPleatDepth', 'Pleat depth'],
        ['skirtFlare', 'Skirt flare'],
      ]
        .map(
          ([key, name]) =>
            `<label class="s3d-field">${name}<input data-construction="${key}" type="number" min="0" max="100" value="${doc.construction[key as 'backRake']}"></label>`
        )
        .join(
          ''
        )}<label class="s3d-field">Supports<select data-construction="legStyle">${['round', 'square', 'block', 'plinth'].map(v => `<option ${doc.construction.legStyle === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="s3d-field">Accent pillows<input data-pillows type="number" min="0" max="8" value="${doc.pillows}"></label></details><section class="s3d-section"><h2 class="s3d-section-title">Fabric study</h2><div class="s3d-families">${['linen', 'boucle', 'velvet', 'weave'].map(f => `<button class="s3d-family" data-family="${f}" aria-pressed="${doc.fabric.family === f}"><i></i>${f}</button>`).join('')}</div><div class="s3d-swatches" style="margin-top:14px">${SOFA_SWATCHES.map(s => `<button class="s3d-swatch" data-colour="${s.colour}" style="--swatch:${s.colour}" aria-label="${s.name}"></button>`).join('')}</div><label class="s3d-colour-field"><input data-custom-colour type="color" value="${doc.fabric.colour}">Custom colour</label></section><section><h2 class="s3d-section-title">Components</h2><div class="s3d-component-list"><button class="s3d-component" data-part="">Whole sofa</button>${parts
        .filter(p => p.role !== 'leg')
        .map(
          p =>
            `<button class="s3d-component" data-part="${escape(p.id)}" aria-pressed="${selected === p.id}">${escape(p.name)}</button>`
        )
        .join('')}</div></section>`;
    const constructionDetails = dialog.querySelector<HTMLDetailsElement>('.s3d-construction');
    if (constructionDetails) constructionDetails.open = constructionOpen;
    const oldGuide = dialog.querySelector('.s3d-gallery-reference');
    oldGuide?.remove();
    if (doc.guideCode) {
      const reference = document.createElement('details');
      reference.className = 's3d-gallery-reference';
      reference.open = true;
      reference.innerHTML = `<summary>${escape(doc.guideCode)} · ${guideView} reference</summary><img src="/api/measurement-guides/svg?code=${encodeURIComponent(doc.guideCode)}&view=${guideView}" alt="Original measurement gallery ${guideView} SVG"><span>Original gallery outline · compare with the 3D frame</span>`;
      $('.s3d-stage').append(reference);
    }
    const sizes = part
      ? { width: part.size.x, height: part.size.y, depth: part.size.z }
      : doc.dimensions;
    const notes = sofaFitNotes(doc);
    const override = selected ? doc.overrides[selected] || {} : {};
    const upholstery = part && ['seat', 'back', 'pillow'].includes(part.role);
    const refinement = part
      ? `<details class="s3d-refinement" open><summary>Shape & placement</summary>${
          upholstery
            ? `${[
                ['loft', 'Loft'],
                ['softness', 'Edge softness'],
                ['taper', 'Taper'],
              ]
                .map(
                  ([key, label]) =>
                    `<label class="s3d-field">${label}<input data-part-property="${key}" type="number" min="${key === 'taper' ? -0.5 : 0}" max="${key === 'taper' ? 0.5 : 1}" step="0.05" value="${part[key as 'loft']}"></label>`
                )
                .join(
                  ''
                )}<label class="s3d-field">Edge style<select data-part-property="shape">${['boxed', 'rounded', 'knife', 'half-knife'].map(v => `<option ${part.shape === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="s3d-field">Outline<select data-part-property="outline">${['rect', 't', 't-left', 't-right', 'miter-left', 'miter-right'].map(v => `<option ${part.outline === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="s3d-field">Piping<input data-part-property="piping" type="checkbox" ${part.piping ? 'checked' : ''}></label>`
            : ''
        }${[
          ['x', 'Lean'],
          ['y', 'Turn'],
          ['z', 'Tilt'],
        ]
          .map(
            ([key, label]) =>
              `<label class="s3d-field">${label} · degrees<input data-rotation="${key}" type="number" min="-180" max="180" step="1" value="${Number((override.rotation?.[key as 'x'] ?? (part.rotation[key as 'x'] * 180) / Math.PI).toFixed(1))}"></label>`
          )
          .join(
            ''
          )}${['x', 'y', 'z'].map(key => `<label class="s3d-field">Offset ${key} · cm<input data-offset="${key}" type="number" min="-1000" max="1000" step="1" value="${override.offset?.[key as 'x'] || 0}"></label>`).join('')}</details>`
      : '';
    $('.right').innerHTML =
      `<select class="s3d-part-picker" data-select-part aria-label="Edit component"><option value="">Whole sofa</option>${parts
        .filter(p => p.role !== 'leg')
        .map(
          p =>
            `<option value="${escape(p.id)}" ${p.id === selected ? 'selected' : ''}>${escape(p.name)}</option>`
        )
        .join(
          ''
        )}</select><span class="s3d-selected-tag">${part ? 'Component' : 'Overall dimensions'}</span><h2 class="s3d-selected-name">${escape(part?.name || 'Your sofa')}</h2><p class="s3d-selected-hint">${part ? 'Change this component independently. Measurements follow its geometry.' : 'Frame inputs and height target. On-model labels show the outer bounds, including loose cushions.'}</p>${(['width', 'height', 'depth'] as const).map(k => `<label class="s3d-size-row"><span>${k === 'height' && part?.role === 'seat' ? 'Thickness' : k === 'depth' && ['back', 'pillow'].includes(part?.role || '') ? 'Thickness' : k}</span><div><input data-size="${k}" aria-label="${k} in cm" type="number" min="1" max="1000" step="0.1" value="${Number(sizes[k].toFixed(1))}" ${!part && doc.modules && k !== 'height' ? 'disabled' : ''}><small>cm</small></div></label>`).join('')}${part ? `<input class="s3d-range" aria-label="Component width" data-size="width" type="range" min="10" max="${Math.max(200, sizes.width * 1.5)}" step="1" value="${sizes.width}"><button class="s3d-subtle-button" data-action="reset-part">Reset component</button>` : ''}${refinement}<div class="s3d-fit ${notes.length ? 'warning' : ''}"><b>${notes.length ? 'Check the fit' : 'Ready to shape'}</b>${escape(notes.join(' ') || 'Select any cushion, arm or frame to adjust it independently.')}</div><div class="s3d-right-section"><h3 class="s3d-section-title">Reference image</h3><button class="s3d-upload" data-action="reference">＋ Add a sofa photo<br>Keep the original beside your model</button>${doc.referenceImage ? `<img class="s3d-reference-img" src="${escape(doc.referenceImage)}" alt="Sofa reference">` : ''}</div>${doc.customDimensions.length ? `<button class="s3d-subtle-button" data-action="clear-measurements">Clear custom measurements (${doc.customDimensions.length})</button>` : ''}${doc.source ? `<div class="s3d-source"><strong>${escape(doc.source.reference)}</strong>${doc.source.notes.map(escape).join('<br>')}</div>` : '<p class="s3d-source">Parametric model. Fabric swatches are illustrative; a photo serves as a visual reference.</p>'}`;
    ($('[data-action=undo]') as HTMLButtonElement).disabled = !undo.length;
    ($('[data-action=redo]') as HTMLButtonElement).disabled = !redo.length;
  }
  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.replace(/[^a-z0-9-]/gi, '-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const file = (accept: string, read: (f: File) => Promise<void>) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      if (input.files?.[0]) void read(input.files[0]).catch(e => toast(e.message));
    };
    input.click();
  };
  dialog.addEventListener('change', event => {
    const el = event.target as HTMLInputElement;
    const next = cloneSofa(doc);
    if (el.dataset.size) {
      editSize(el.dataset.size as 'width', Number(el.value));
      return;
    }
    if (el.hasAttribute('data-select-part')) {
      selected = el.value || null;
      renderer.select(selected);
      renderPanels();
      return;
    }
    if (el.hasAttribute('data-popular')) {
      if (!el.value) return;
      selected = null;
      commit(createPopularModel(el.value));
      renderer.view('perspective');
      return;
    }
    if (selected && (el.dataset.partProperty || el.dataset.rotation || el.dataset.offset)) {
      const part = buildSofaParts(doc).find(p => p.id === selected)!;
      const override = { ...next.overrides[selected] };
      if (el.dataset.partProperty)
        (override as unknown as Record<string, unknown>)[el.dataset.partProperty] =
          el.type === 'checkbox'
            ? el.checked
            : el.tagName === 'SELECT'
              ? el.value
              : Number(el.value);
      if (el.dataset.rotation)
        override.rotation = {
          ...(override.rotation || {
            x: (part.rotation.x * 180) / Math.PI,
            y: (part.rotation.y * 180) / Math.PI,
            z: (part.rotation.z * 180) / Math.PI,
          }),
          [el.dataset.rotation]: Number(el.value),
        };
      if (el.dataset.offset)
        override.offset = {
          ...(override.offset || { x: 0, y: 0, z: 0 }),
          [el.dataset.offset]: Number(el.value),
        };
      next.overrides[selected] = override;
      commit(next);
      return;
    }
    if (el.hasAttribute('data-guide')) {
      selected = null;
      commit(applyGalleryGuide(el.value, doc));
      renderer.view('front');
      return;
    }
    if (el.dataset.sleeper && next.sleeper) {
      if (el.dataset.sleeper === 'open') next.sleeper.open = el.checked;
      else next.sleeper.extension = Number(el.value);
      selected = null;
      commit(next);
      renderer.view('perspective');
      return;
    }
    if (el.dataset.global) {
      (next.dimensions as unknown as Record<string, number>)[el.dataset.global] = Number(el.value);
      commit(next);
      return;
    }
    if (el.dataset.construction) {
      (next.construction as unknown as Record<string, number | boolean | string>)[
        el.dataset.construction
      ] =
        el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value);
      commit(next);
      return;
    }
    if (el.dataset.style)
      (next.style as unknown as Record<string, string>)[el.dataset.style] = el.value;
    else if (el.hasAttribute('data-pillows')) next.pillows = Number(el.value);
    else if (el.hasAttribute('data-custom-colour')) next.fabric.colour = el.value;
    else if (el.classList.contains('s3d-title')) next.title = el.value;
    else return;
    commit(next);
  });
  dialog.addEventListener('click', event => {
    void (async () => {
      const el = (event.target as HTMLElement).closest<HTMLElement>('button');
      if (!el) return;
      try {
        if (el.dataset.preset) {
          selected = null;
          commit(createSofaDocument(el.dataset.preset as SofaPreset));
          renderer.view('perspective');
        }
        if (el.hasAttribute('data-part')) {
          selected = el.dataset.part || null;
          renderer.select(selected);
          renderPanels();
        }
        if (el.dataset.family || el.dataset.colour) {
          const next = cloneSofa(doc);
          if (el.dataset.family)
            next.fabric.family = el.dataset.family as SofaDocument['fabric']['family'];
          if (el.dataset.colour) next.fabric.colour = el.dataset.colour;
          commit(next);
        }
        if (el.dataset.view) {
          renderer.view(el.dataset.view as 'front');
          if (['front', 'side', 'back'].includes(el.dataset.view)) {
            guideView = el.dataset.view;
            renderPanels();
          }
        }
        const tool = el.dataset.tool;
        if (tool) {
          if (tool === 'grid') renderer.setGrid(!renderer.showGrid);
          else if (tool === 'dimensions') renderer.setDimensions(!renderer.showDimensions);
          else if (tool === 'explode') {
            renderer.exploded = !renderer.exploded;
            renderer.update(doc);
          } else renderer.setMode(tool as 'orbit');
          el.setAttribute(
            'aria-pressed',
            String(
              tool === 'grid'
                ? renderer.showGrid
                : tool === 'dimensions'
                  ? renderer.showDimensions
                  : tool === 'explode'
                    ? renderer.exploded
                    : true
            )
          );
        }
        const action = el.dataset.action;
        if (action === 'close') dialog.close();
        if (action === 'fit') renderer.view('perspective');
        if (action === 'undo' && undo.length) {
          redo.push(cloneSofa(doc));
          doc = undo.pop()!;
          refresh();
        }
        if (action === 'redo' && redo.length) {
          undo.push(cloneSofa(doc));
          doc = redo.pop()!;
          refresh();
        }
        if (action === 'export') $('.s3d-menu').hidden = !$('.s3d-menu').hidden;
        if (action === 'json')
          download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), 'json');
        if (action === 'png') download(await renderer.snapshot(), 'png');
        if (action === 'glb') download(await renderer.glb(), 'glb');
        if (action === 'load')
          file('.json', async f => {
            selected = null;
            commit(parseSofaDocument(JSON.parse(await f.text())));
            renderer.view('perspective');
          });
        if (action === 'reference')
          file('image/png,image/jpeg,image/webp', async f => {
            if (f.size > 8e6) throw new Error('Choose an image smaller than 8 MB.');
            const data = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
              r.onerror = reject;
              r.readAsDataURL(f);
            });
            const next = cloneSofa(doc);
            next.referenceImage = data;
            commit(next);
          });
        if (action === 'reset-part' && selected) {
          const next = cloneSofa(doc);
          delete next.overrides[selected];
          commit(next);
        }
        if (action === 'clear-measurements') {
          const next = cloneSofa(doc);
          next.customDimensions = [];
          commit(next);
        }
        if (action === 'paint') {
          const manager = (window as any).app?.uploadManager;
          if (!manager?.handleFiles) throw new Error('The image workspace is still loading.');
          await manager.handleFiles([
            new File([await renderer.snapshot()], `${doc.title}.png`, { type: 'image/png' }),
          ]);
          dialog.close();
        }
        if (['png', 'glb', 'json'].includes(action || '')) $('.s3d-menu').hidden = true;
      } catch (e) {
        toast((e as Error).message);
      }
    })();
  });
  dialog.addEventListener('close', () => renderer.pause());
  launch = req => {
    if (req?.model) doc = createPopularModel(req.model);
    else if (req?.benchmark) doc = createBenchmarkDocument(req.benchmark);
    else if (req?.sectional) doc = fromSectional(req.sectional);
    else if (req?.cw) doc = fromCw(req.cw);
    selected = null;
    if (!dialog.open) dialog.showModal();
    refresh();
    renderer.resume();
    renderer.view('perspective');
  };
  launch(request);
}
