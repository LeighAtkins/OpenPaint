// @ts-nocheck
import { PDFDocument, PDFTextField, PDFRadioGroup } from 'pdf-lib';

const MANIFEST_PREFIX = 'SOFAPAINT_REVIEW_V1:';

function baseViewId(scope = ''): string {
  return String(scope).split('::tab:')[0];
}

function fieldPart(value = ''): string {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function naturalLabelSort(a, b): number {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export async function parseSofaPaintReviewPdf(bytes: ArrayBuffer | Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const subject = pdf.getSubject() || '';
  let manifest = null;
  if (subject.startsWith(MANIFEST_PREFIX)) {
    try {
      manifest = JSON.parse(subject.slice(MANIFEST_PREFIX.length));
    } catch (error) {
      console.warn('[Measurement Review] Invalid SofaPaint manifest:', error);
    }
  }

  const fields = [];
  try {
    pdf
      .getForm()
      .getFields()
      .forEach(field => {
        if (!(field instanceof PDFTextField)) return;
        const name = field.getName();
        if (!name.startsWith('m_')) return;
        fields.push({ name, value: field.getText() || '' });
      });
  } catch (error) {
    console.warn('[Measurement Review] Could not read PDF form values:', error);
  }

  // The unit toggle per rendered page is a radio group named unit_measurement_N.
  // Bare field values ("83.75") are meaningless without it.
  const unitSelections = new Set();
  try {
    pdf
      .getForm()
      .getFields()
      .forEach(field => {
        if (!(field instanceof PDFRadioGroup)) return;
        if (!/^unit_measurement/i.test(field.getName())) return;
        const selected = field.getSelected();
        if (!selected) return;
        // Older templates used Y/N toggles here; only real unit values count.
        const normalized = selected.toLowerCase();
        if (normalized === 'inch' || normalized === 'inches' || normalized === 'cm') {
          unitSelections.add(normalized);
        }
      });
  } catch (error) {
    console.warn('[Measurement Review] Could not read PDF unit selection:', error);
  }
  const detectedUnit =
    unitSelections.size === 1 ? (unitSelections.has('inch') ? 'inch' : 'cm') : null;

  if (!manifest?.views?.length) {
    const grouped = new Map();
    fields.forEach(({ name, value }) => {
      const match = /^m_(.+)_([A-Za-z]+(?:\d+(?:\(\d+\))?)?)_?\d*$/.exec(name);
      if (!match) return;
      const [, viewId, label] = match;
      if (!grouped.has(viewId)) grouped.set(viewId, []);
      grouped.get(viewId).push({ label, value });
    });
    manifest = {
      version: 1,
      projectName: pdf.getTitle() || '',
      views: Array.from(grouped, ([viewId, measurements]) => ({
        viewId,
        title: viewId.replace(/_/g, ' '),
        measurements,
      })),
    };
  }

  const valueByField = new Map(fields.map(field => [field.name, field.value]));
  // A manifest may list the same viewId once per capture frame; the writer
  // disambiguates duplicate fields with _2/_3 suffixes in that order, so the
  // k-th occurrence of a viewId must read its values from `_<k+1>` fields —
  // otherwise every frame would repeat frame 1's values.
  const viewFrameCounts = new Map();
  manifest.views.forEach(view => {
    const frameKey = fieldPart(view.viewId);
    const frameIndex = viewFrameCounts.get(frameKey) ?? 0;
    viewFrameCounts.set(frameKey, frameIndex + 1);
    view.measurements = (view.measurements || []).map(row => {
      const key = `m_${frameKey}_${fieldPart(row.label)}`;
      let value;
      if (frameIndex > 0) {
        value = valueByField.get(`${key}_${frameIndex + 1}`) ?? row.value ?? '';
      } else {
        const exactValue = valueByField.get(key);
        const suffixedValue = fields.find(field => {
          if (!field.name.startsWith(`${key}_`)) return false;
          return /^\d+$/.test(field.name.slice(key.length + 1));
        })?.value;
        value = exactValue ?? suffixedValue ?? row.value ?? '';
      }
      return { ...row, value };
    });
    // The manifest lists the letters that had a value when the PDF was made;
    // the customer fills in the rest. Field values for letters the manifest
    // does not list are kept too (first frame of a view only: later frames
    // carry _2/_3 suffixes).
    if (frameIndex === 0) {
      const listed = new Set(view.measurements.map(row => fieldPart(row.label)));
      const prefix = `m_${frameKey}_`;
      fields.forEach(({ name, value }) => {
        if (!name.startsWith(prefix) || !String(value || '').trim()) return;
        const label = name.slice(prefix.length);
        if (!/^[A-Za-z]+\d*$/.test(label) || listed.has(label)) return;
        listed.add(label);
        view.measurements.push({ label, value });
      });
      view.measurements.sort((a, b) => naturalLabelSort(a.label, b.label));
    }
  });
  manifest.unit = manifest.unit || detectedUnit;
  return manifest;
}

function getProjectReviewViews() {
  const app = window.app;
  const manager = app?.metadataManager;
  const projectManager = app?.projectManager;
  const partLabels = projectManager?.getProjectMetadata?.()?.imagePartLabels || {};
  const viewIds = new Set();

  Object.entries(projectManager?.views || {}).forEach(([viewId, view]) => {
    if (view?.image) viewIds.add(viewId);
  });
  Object.keys(manager?.vectorStrokesByImage || {}).forEach(scope => viewIds.add(baseViewId(scope)));

  return Array.from(viewIds).map(viewId => {
    const labels = new Set();
    const visibilityByLabel = new Map();
    Object.entries(manager?.vectorStrokesByImage || {}).forEach(([scope, bucket]) => {
      if (baseViewId(scope) !== viewId) return;
      Object.keys(bucket || {}).forEach(label => {
        labels.add(label);
        const visible =
          manager?.strokeVisibilityByImage?.[scope]?.[label] !== false &&
          manager?.strokeLabelVisibility?.[scope]?.[label] !== false;
        visibilityByLabel.set(label, (visibilityByLabel.get(label) ?? true) && visible);
      });
    });
    Object.entries(manager?.strokeMeasurements || {}).forEach(([scope, bucket]) => {
      if (baseViewId(scope) !== viewId) return;
      Object.keys(bucket || {}).forEach(label => labels.add(label));
    });
    return {
      viewId,
      title: partLabels[viewId] || viewId,
      measurements: Array.from(labels)
        .sort(naturalLabelSort)
        .map(label => {
          let value = '';
          Object.entries(manager?.strokeMeasurements || {}).some(([scope, bucket]) => {
            if (baseViewId(scope) !== viewId || !bucket?.[label]) return false;
            const measurement = bucket[label];
            value = measurement?.inputValue || measurement?.displayValue || '';
            if (!value && Number(measurement?.cm) > 0) value = `${measurement.cm} cm`;
            return true;
          });
          return { label, value, visible: visibilityByLabel.get(label) !== false };
        }),
    };
  });
}

function mergePdfWithProject(pdfManifest, projectViews) {
  if (!pdfManifest?.views?.length) return projectViews;
  return projectViews.map(projectView => {
    const exact = pdfManifest.views.find(view => view.viewId === projectView.viewId);
    const normalized = pdfManifest.views.find(
      view => fieldPart(view.viewId) === fieldPart(projectView.viewId)
    );
    const titled = pdfManifest.views.find(
      view => String(view.title).toLowerCase() === String(projectView.title).toLowerCase()
    );
    const pdfView = exact || normalized || titled;
    if (!pdfView) return projectView;
    const pdfByLabel = new Map((pdfView.measurements || []).map(row => [row.label, row.value]));
    const labels = new Set([
      ...projectView.measurements.map(row => row.label),
      ...(pdfView.measurements || []).map(row => row.label),
    ]);
    return {
      ...projectView,
      pdfTitle: pdfView.title,
      measurements: Array.from(labels)
        .sort(naturalLabelSort)
        .map(label => ({
          label,
          value:
            pdfByLabel.get(label) ??
            projectView.measurements.find(row => row.label === label)?.value ??
            '',
          existsInProject: projectView.measurements.some(row => row.label === label),
          visible: projectView.measurements.find(row => row.label === label)?.visible !== false,
        })),
    };
  });
}

function applyReviewVisibility(viewId, selectedLabels: Set<string>, showAll = false) {
  const app = window.app;
  const manager = app?.metadataManager;
  if (!manager) return;
  const labels = new Set();
  Object.entries(manager.vectorStrokesByImage || {}).forEach(([scope, bucket]) => {
    if (baseViewId(scope) !== viewId) return;
    Object.entries(bucket || {}).forEach(([label, stroke]) => {
      labels.add(label);
      const visible = showAll || selectedLabels.has(label);
      manager.setStrokeVisibility(scope, label, visible);
      manager.setLabelVisibility(scope, label, visible);
      app.tagManager?.updateTagVisibility?.(label, scope, visible, stroke);
    });
  });
  Object.entries(manager.strokeMeasurements || {}).forEach(([scope, bucket]) => {
    if (baseViewId(scope) !== viewId) return;
    Object.keys(bucket || {}).forEach(label => labels.add(label));
  });
  window.syncCaptureTabCanvasVisibility?.(viewId);
  manager.updateStrokeVisibilityControls?.();
  app.canvasManager?.fabricCanvas?.requestRenderAll?.();
}

export function initMeasurementReview(): void {
  const trigger = document.getElementById('measurementReviewBtn');
  if (!trigger || trigger.dataset.bound === 'true') return;
  trigger.dataset.bound = 'true';

  trigger.addEventListener('click', () => {
    document.getElementById('projectMenuPanel')?.classList.remove('open');
    const overlay = document.createElement('div');
    overlay.className = 'measurement-review-overlay';
    overlay.innerHTML = `
      <section class="measurement-review-shell" role="dialog" aria-modal="true" aria-label="Review a returned PDF">
        <header class="measurement-review-header">
          <div><span class="measurement-review-kicker">CHECK WORKSPACE</span><h2>Review a returned PDF</h2></div>
          <div class="measurement-review-header-actions">
            <label class="measurement-review-upload">Open returned SofaPaint PDF<input type="file" accept="application/pdf" hidden></label>
            <button type="button" data-review-close aria-label="Close review">×</button>
          </div>
        </header>
        <div class="measurement-review-body">
          <aside class="measurement-review-views"><div class="measurement-review-side-title">Views</div><div data-review-views></div></aside>
          <main class="measurement-review-main">
            <div class="measurement-review-toolbar">
              <div><h3 data-review-title></h3><p data-review-source>Current project measurements</p></div>
              <div><button type="button" data-review-all>Select all</button><button type="button" data-review-none>Clear</button></div>
            </div>
            <div class="measurement-review-list" data-review-list></div>
          </main>
          <aside class="measurement-review-summary">
            <span class="measurement-review-kicker">VISIBLE CHECKS</span>
            <strong data-review-count>0</strong>
            <p>Only selected lines and tags will show on this view. Measurements are never deleted.</p>
            <button type="button" class="primary" data-review-apply>Show selected</button>
            <button type="button" data-review-show-all>Show all on view</button>
            <span class="measurement-review-kicker" style="margin-top:18px">PDF VALUES</span>
            <button type="button" class="primary" data-review-save disabled title="Open a returned SofaPaint PDF first">Save values to project</button>
            <p data-review-save-status>Open a returned PDF to save its values into this project.</p>
          </aside>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    let views = getProjectReviewViews();
    let pdfManifest = null;
    let rangeChoices = null;
    const saveButton = overlay.querySelector('[data-review-save]');
    const saveStatus = overlay.querySelector('[data-review-save-status]');
    const setSaveStatus = (text, isError = false) => {
      saveStatus.textContent = text;
      saveStatus.classList.toggle('error', isError);
    };
    let activeViewId = window.app?.projectManager?.currentViewId || views[0]?.viewId;
    const selections = new Map(
      views.map(view => [
        view.viewId,
        new Set(view.measurements.filter(row => row.visible !== false).map(row => row.label)),
      ])
    );

    const render = () => {
      if (!views.some(view => view.viewId === activeViewId)) activeViewId = views[0]?.viewId;
      const active = views.find(view => view.viewId === activeViewId);
      const viewList = overlay.querySelector('[data-review-views]');
      const list = overlay.querySelector('[data-review-list]');
      viewList.innerHTML = views
        .map(
          view =>
            `<button type="button" class="${view.viewId === activeViewId ? 'active' : ''}" data-review-view="${encodeURIComponent(view.viewId)}"><span>${view.title}</span><small>${view.measurements.length}</small></button>`
        )
        .join('');
      overlay.querySelector('[data-review-title]').textContent = active?.title || 'No measurements';
      const selected = selections.get(activeViewId) || new Set();
      list.innerHTML = active?.measurements?.length
        ? active.measurements
            .map(
              row => `
          <label class="measurement-review-row ${row.existsInProject === false ? 'pdf-only' : ''}">
            <input type="checkbox" data-review-label="${encodeURIComponent(row.label)}" ${selected.has(row.label) ? 'checked' : ''} ${row.existsInProject === false ? 'disabled' : ''}>
            <span class="measurement-review-code">${row.label}</span>
            <span class="measurement-review-value">${row.value || 'No value entered'}</span>
            <span class="measurement-review-state">${row.existsInProject === false ? 'PDF only' : 'Check'}</span>
          </label>`
            )
            .join('')
        : '<div class="measurement-review-empty">No measurements found for this view.</div>';
      overlay.querySelector('[data-review-count]').textContent = String(selected.size);
    };

    // One save path for returned PDFs: the same savePdfValuesToProject (and
    // range pills) as the check-request dialog. Imported lazily because that
    // module imports this one.
    const saveValues = async ({ choosing }) => {
      if (!pdfManifest) {
        setSaveStatus('Open a returned SofaPaint PDF first.', true);
        return;
      }
      const check = await import('./measurement-check-request');
      if (!choosing) {
        const plan = check.planPdfValueSaves(check.buildCheckContextFromApp(), pdfManifest);
        if (!plan.entries.length) {
          setSaveStatus('No project views matched the PDF. Open the project it belongs to.', true);
          return;
        }
        const rangeCount = plan.entries.filter(entry => entry.range).length;
        if (rangeCount) {
          rangeChoices = {};
          overlay.querySelector('[data-review-list]').innerHTML = `
            <div class="measurement-check-summary">The customer wrote two numbers for ${rangeCount} value(s). Pick the one to use; their words are kept as a note.</div>
            <table class="measurement-check-table"><thead><tr><th>Code</th><th>Use</th></tr></thead><tbody>${check.rangeChooserRowsHtml(plan, rangeChoices)}</tbody></table>
            <div class="measurement-check-actions"><button type="button" class="primary" data-review-save-ranges>Save ${plan.entries.length} value(s) to project</button></div>`;
          setSaveStatus(`Pick a number for ${rangeCount} range(s), then save.`);
          return;
        }
      }
      setSaveStatus('Saving PDF values to the project…');
      try {
        const result = await check.savePdfValuesToProject(pdfManifest, { rangeChoices });
        rangeChoices = null;
        if (result.cancelled) {
          setSaveStatus('Save cancelled. Nothing was written.');
          render();
          return;
        }
        views = mergePdfWithProject(pdfManifest, getProjectReviewViews());
        render();
        const failureNote = result.failures.length
          ? ` ${result.failures.length} could not be read: ${result.failures.join('; ')}`
          : '';
        setSaveStatus(
          `Saved ${result.saved} value(s)${result.noteCount ? `, ${result.noteCount} note(s) kept` : ''}.${failureNote} Save the project (Ctrl+S) to keep them.`,
          result.failures.length > 0
        );
        window.showStatusMessage?.(
          `Saved ${result.saved} PDF measurement value(s) to the project.`
        );
      } catch (error) {
        console.error('[Measurement Review] Save PDF values failed:', error);
        setSaveStatus(`Could not save PDF values: ${error?.message || error}`, true);
      }
    };

    overlay.addEventListener('click', async event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.matches('[data-review-close]')) overlay.remove();
      if (target.matches('[data-check-pill]')) {
        const check = await import('./measurement-check-request');
        rangeChoices = check.applyRangePillClick(target, rangeChoices);
        return;
      }
      if (target.matches('[data-review-save]')) {
        await saveValues({ choosing: false });
        return;
      }
      if (target.matches('[data-review-save-ranges]')) {
        await saveValues({ choosing: true });
        return;
      }
      if (target.dataset.reviewView) {
        activeViewId = decodeURIComponent(target.dataset.reviewView);
        render();
      }
      const active = views.find(view => view.viewId === activeViewId);
      if (!active) return;
      if (target.matches('[data-review-all]')) {
        selections.set(
          activeViewId,
          new Set(
            active.measurements.filter(row => row.existsInProject !== false).map(row => row.label)
          )
        );
        render();
      }
      if (target.matches('[data-review-none]')) {
        selections.set(activeViewId, new Set());
        render();
      }
      if (target.matches('[data-review-apply]')) {
        await window.app?.projectManager?.switchView?.(activeViewId, true);
        applyReviewVisibility(activeViewId, selections.get(activeViewId) || new Set());
        window.showStatusMessage?.(
          `${selections.get(activeViewId)?.size || 0} checks shown on ${active.title}`
        );
      }
      if (target.matches('[data-review-show-all]')) {
        const all = new Set(
          active.measurements.filter(row => row.existsInProject !== false).map(row => row.label)
        );
        selections.set(activeViewId, all);
        await window.app?.projectManager?.switchView?.(activeViewId, true);
        applyReviewVisibility(activeViewId, all, true);
        render();
      }
    });

    overlay.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-review-label]');
      if (!checkbox) return;
      const label = decodeURIComponent(checkbox.dataset.reviewLabel);
      const selected = selections.get(activeViewId) || new Set();
      checkbox.checked ? selected.add(label) : selected.delete(label);
      selections.set(activeViewId, selected);
      overlay.querySelector('[data-review-count]').textContent = String(selected.size);
    });

    overlay.querySelector('input[type="file"]').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const manifest = await parseSofaPaintReviewPdf(await file.arrayBuffer());
        pdfManifest = manifest;
        rangeChoices = null;
        saveButton.disabled = false;
        saveButton.title = "Write this PDF's values into the project";
        setSaveStatus(`${file.name} loaded. Save its values into the project when ready.`);
        views = mergePdfWithProject(manifest, getProjectReviewViews());
        views.forEach(view => {
          if (!selections.has(view.viewId)) {
            selections.set(
              view.viewId,
              new Set(
                view.measurements
                  .filter(row => row.existsInProject !== false && row.visible !== false)
                  .map(row => row.label)
              )
            );
          }
        });
        overlay.querySelector('[data-review-source]').textContent =
          `${file.name} · editable PDF values loaded`;
        render();
      } catch (error) {
        console.error('[Measurement Review] PDF import failed:', error);
        window.showStatusMessage?.('This PDF could not be read. Try a SofaPaint PDF.');
      }
    });

    render();
  });
}
