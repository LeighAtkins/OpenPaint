function getMetadata() {
  const metadata = window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata;
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function setMetadata(patch) {
  if (window.app?.projectManager?.setProjectMetadata) {
    return window.app.projectManager.setProjectMetadata(patch);
  }
  window.projectMetadata = { ...(window.projectMetadata || {}), ...patch };
  return window.projectMetadata;
}

function toInchDecimal(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  const whole = Number(bucket.inchWhole || 0);
  const fraction = Number(bucket.inchFraction || 0);
  const direct = Number(bucket.inch || 0);
  const value = direct || whole + fraction;
  return Number.isFinite(value) ? value : null;
}

function toCmDecimal(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  const value = Number(bucket.cm);
  return Number.isFinite(value) ? value : null;
}

function buildMeasurementIndex() {
  const unit = document.getElementById('unitSelector')?.value || 'inch';
  const strokeMeasurements = window.app?.metadataManager?.strokeMeasurements || {};
  const strokeMap = window.app?.metadataManager?.vectorStrokesByImage || {};
  const views = Object.keys(window.app?.projectManager?.views || {});
  const entries = [];
  const lookup = {};
  const byStrokeLabel = {};

  views.forEach((viewId, viewIdx) => {
    const scopedStrokeLabels = new Set();
    const scopedMeasurements = {};

    Object.entries(strokeMap).forEach(([scopeKey, bucket]) => {
      if (scopeKey !== viewId && !scopeKey.startsWith(`${viewId}::tab:`)) return;
      Object.keys(bucket || {}).forEach(strokeLabel => scopedStrokeLabels.add(strokeLabel));
    });

    Object.entries(strokeMeasurements).forEach(([scopeKey, bucket]) => {
      if (scopeKey !== viewId && !scopeKey.startsWith(`${viewId}::tab:`)) return;
      Object.entries(bucket || {}).forEach(([strokeLabel, measurement]) => {
        scopedStrokeLabels.add(strokeLabel);
        scopedMeasurements[strokeLabel] = measurement;
      });
    });

    scopedStrokeLabels.forEach(strokeLabel => {
      const measurement = scopedMeasurements[strokeLabel] || null;
      const numeric = unit === 'cm' ? toCmDecimal(measurement) : toInchDecimal(measurement);
      const key = `${viewId}:${strokeLabel}`;
      const partLabel =
        window.app?.projectManager?.getProjectMetadata?.()?.imagePartLabels?.[viewId] ||
        `view-${String(viewIdx + 1).padStart(2, '0')}`;
      const entry = {
        key,
        viewId,
        partLabel,
        strokeLabel,
        value: numeric,
        display: `${partLabel} (${viewId}) - ${strokeLabel}`,
      };
      entries.push(entry);
      lookup[key] = entry;
      if (!byStrokeLabel[strokeLabel]) byStrokeLabel[strokeLabel] = [];
      byStrokeLabel[strokeLabel].push(entry);
    });
  });

  entries.sort((a, b) => a.display.localeCompare(b.display));
  return { unit, entries, lookup, byStrokeLabel };
}

function safeEvalExpression(expression, context) {
  if (!expression) return null;
  const tokenized = expression.replace(/[A-Za-z]\w*/g, token => {
    if (Object.prototype.hasOwnProperty.call(context, token)) {
      return String(context[token]);
    }
    return 'NaN';
  });
  try {
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${tokenized});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function evaluateChecks(checks, measurementIndex) {
  const measurementLookup = measurementIndex.lookup;
  return (checks || []).map(check => {
    const formula = String(check.formula || '').trim();
    if (!formula || !formula.includes('=')) {
      return { ...check, status: 'pending', result: null, delta: null, reason: 'Missing formula' };
    }

    const [leftRaw, rightRaw] = formula.split('=').map(part => part.trim());
    const tokens = Array.from(new Set(formula.match(/[A-Za-z]\w*/g) || []));
    const context = {};
    let missingToken = null;
    tokens.forEach(token => {
      let measured = null;
      const aliasKey = check.aliasMap?.[token];
      if (aliasKey) {
        measured = measurementLookup[aliasKey] || null;
      }
      if (!measured && measurementLookup[token]) {
        measured = measurementLookup[token];
      }
      if (!measured) {
        const labelMatches = measurementIndex.byStrokeLabel?.[token] || [];
        if (labelMatches.length === 1) {
          measured = labelMatches[0];
        }
      }
      if (!measured || measured.value === null || measured.value === undefined) {
        if (!missingToken) missingToken = token;
      } else {
        context[token] = measured.value;
      }
    });

    if (missingToken) {
      return {
        ...check,
        status: 'pending',
        result: null,
        delta: null,
        reason: `Waiting for ${missingToken} value (informational)`,
      };
    }

    const left = safeEvalExpression(leftRaw, context);
    const right = safeEvalExpression(rightRaw, context);
    if (left === null || left === undefined || right === null || right === undefined) {
      return {
        ...check,
        status: 'pending',
        result: null,
        delta: null,
        reason: 'Invalid expression',
      };
    }

    const tolerance = Number.isFinite(Number(check.tolerance)) ? Number(check.tolerance) : 0;
    const delta = Math.abs(left - right);
    return {
      ...check,
      status: delta <= tolerance ? 'pass' : 'fail',
      result: `${left.toFixed(2)} = ${right.toFixed(2)}`,
      delta,
      reason: delta <= tolerance ? 'Within tolerance' : 'Outside tolerance',
    };
  });
}

function evaluateConnections(connections, measurementLookup, tolerance = 0) {
  return (connections || []).map(connection => {
    const from = measurementLookup[connection.fromKey || ''];
    const to = measurementLookup[connection.toKey || ''];
    if (
      !from ||
      !to ||
      from.value === null ||
      from.value === undefined ||
      to.value === null ||
      to.value === undefined
    ) {
      return {
        ...connection,
        status: 'pending',
        delta: null,
        reason: 'Waiting for values (informational)',
        fromDisplay: from?.display || connection.fromKey || '-',
        toDisplay: to?.display || connection.toKey || '-',
      };
    }
    const delta = Math.abs(from.value - to.value);
    return {
      ...connection,
      status: delta <= tolerance ? 'pass' : 'fail',
      delta,
      reason: delta <= tolerance ? 'Connected values align' : 'Connected values differ',
      fromDisplay: from.display,
      toDisplay: to.display,
    };
  });
}

function evaluateMeasurementRelations() {
  const metadata = getMetadata();
  const checks = Array.isArray(metadata.measurementChecks) ? metadata.measurementChecks : [];
  const connections = Array.isArray(metadata.measurementConnections)
    ? metadata.measurementConnections
    : [];
  const pieceGroups = Array.isArray(metadata.pieceGroups) ? metadata.pieceGroups : [];
  const index = buildMeasurementIndex();
  const checkResults = evaluateChecks(checks, index);
  const connectionResults = evaluateConnections(connections, index.lookup, 0);
  return {
    unit: index.unit,
    checks: checkResults,
    connections: connectionResults,
    pieceGroups,
    measurements: index.entries,
  };
}

function ensureStyles() {
  if (document.getElementById('measurementRelationsStyles')) return;
  const style = document.createElement('style');
  style.id = 'measurementRelationsStyles';
  style.textContent = `
    .relations-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.58); z-index: 12700; display:flex; align-items:center; justify-content:center; padding:20px; }
    .relations-card { width:min(980px,100%); max-height:88vh; overflow:auto; background:#fff; border-radius:16px; padding:16px; box-shadow:0 24px 45px rgba(15,23,42,.24); }
    .relations-section { border:1px solid #e2e8f0; border-radius:10px; padding:10px; margin-top:10px; }
    .relations-table { width:100%; border-collapse:collapse; font-size:12px; }
    .relations-table th,.relations-table td { border-bottom:1px solid #e2e8f0; padding:6px; text-align:left; }
    .relations-table input,.relations-table select { width:100%; border:1px solid #cbd5e1; border-radius:7px; padding:4px 6px; font-size:12px; }
    .status-chip { font-size:10px; font-weight:700; border-radius:999px; padding:2px 7px; text-transform:uppercase; }
    .status-chip.pass { background:#dcfce7; color:#166534; }
    .status-chip.fail { background:#fee2e2; color:#991b1b; }
    .status-chip.pending { background:#e2e8f0; color:#334155; }
    .piece-group-card { border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px; background:#f8fafc; }
    .piece-group-card .related-tag { display:inline-flex; align-items:center; gap:4px; background:#e2e8f0; border-radius:6px; padding:2px 8px; font-size:11px; margin:2px; }
    .piece-group-card .related-tag button { border:none; background:transparent; color:#94a3b8; cursor:pointer; font-size:14px; line-height:1; padding:0 2px; }
    .piece-group-card .related-tag button:hover { color:#ef4444; }
  `;
  document.head.appendChild(style);
}

async function preWarmAllViews() {
  const views = window.app?.projectManager?.views || {};
  const viewIds = Object.keys(views).filter(id => views[id]?.image);
  if (!viewIds.length) return;
  const currentViewId = window.app?.projectManager?.currentViewId;
  for (const viewId of viewIds) {
    try {
      await window.app.projectManager.switchView(viewId);
      await new Promise(resolve => setTimeout(resolve, 80));
    } catch (_) {
      /* skip */
    }
  }
  if (currentViewId) {
    try {
      await window.app.projectManager.switchView(currentViewId);
    } catch (_) {
      /* skip */
    }
  }
}

async function openMeasurementRelationsEditor() {
  ensureStyles();

  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'relations-overlay';
  loadingOverlay.innerHTML =
    '<div style="background:#fff;border-radius:12px;padding:24px 32px;box-shadow:0 8px 32px rgba(0,0,0,.2);text-align:center;"><p style="margin:0;font-size:14px;color:#334155;">Loading measurements from all images...</p></div>';
  document.body.appendChild(loadingOverlay);

  await preWarmAllViews();
  loadingOverlay.remove();

  const metadata = getMetadata();
  let checks = Array.isArray(metadata.measurementChecks) ? [...metadata.measurementChecks] : [];
  let connections = Array.isArray(metadata.measurementConnections)
    ? [...metadata.measurementConnections]
    : [];
  let pieceGroups = Array.isArray(metadata.pieceGroups) ? [...metadata.pieceGroups] : [];

  const index = buildMeasurementIndex();
  const measurementOptions = index.entries
    .map(entry => `<option value="${entry.key}">${entry.display}</option>`)
    .join('');

  // Build view options for piece groups
  const views = window.app?.projectManager?.views || {};
  const viewIds = Object.keys(views).filter(id => views[id]?.image);
  const viewOptions = viewIds
    .map((id, idx) => {
      const partLabel =
        metadata.imagePartLabels?.[id] || `view-${String(idx + 1).padStart(2, '0')}`;
      return `<option value="${id}">${partLabel} (${id})</option>`;
    })
    .join('');

  const overlay = document.createElement('div');
  overlay.className = 'relations-overlay';
  overlay.innerHTML = `
    <section class="relations-card" role="dialog" aria-modal="true" aria-label="Measurement checks and connections">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <h2 style="margin:0;font-size:20px;color:#0f172a;">Checks + Links</h2>
          <p style="margin:4px 0 0;font-size:12px;color:#475569;">Tag formulas, link measurements, and group related images for PDF exports.</p>
        </div>
        <button id="closeRelationsEditor" type="button" style="border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 10px;font-weight:600;cursor:pointer;">Close</button>
      </div>

      <section class="relations-section">
        <h3 style="margin:0 0 4px;font-size:14px;color:#0f172a;">Piece Groups</h3>
        <p style="margin:0 0 8px;font-size:11px;color:#64748b;">Group related images so they appear side-by-side in PDF exports.</p>
        <div id="pieceGroupsContainer"></div>
        <button id="addPieceGroup" type="button" style="margin-top:8px;border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;">Add group</button>
      </section>

      <section class="relations-section">
        <h3 style="margin:0 0 8px;font-size:14px;color:#0f172a;">Formula Checks</h3>
        <table class="relations-table">
          <thead><tr><th>Formula</th><th>Tolerance</th><th>Note</th><th>Status</th><th></th></tr></thead>
          <tbody id="relationsChecksBody"></tbody>
        </table>
        <button id="addRelationCheck" type="button" style="margin-top:8px;border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;">Add check</button>
      </section>

      <section class="relations-section">
        <h3 style="margin:0 0 8px;font-size:14px;color:#0f172a;">Cross-image Connections</h3>
        <p style="margin:0 0 8px;font-size:11px;color:#64748b;">Link specific measurements across images to verify they connect at the same point.</p>
        <table class="relations-table">
          <thead><tr><th>From</th><th>To</th><th>Note</th><th>Status</th><th></th></tr></thead>
          <tbody id="relationsConnectionsBody"></tbody>
        </table>
        <button id="addRelationConnection" type="button" style="margin-top:8px;border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;">Add connection</button>
      </section>

      <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
        <button id="saveRelations" type="button" style="border:none;background:#1d4ed8;color:#fff;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;">Save tags</button>
      </div>
    </section>
  `;

  const pieceGroupsContainer = overlay.querySelector('#pieceGroupsContainer');
  const checksBody = overlay.querySelector('#relationsChecksBody');
  const connectionsBody = overlay.querySelector('#relationsConnectionsBody');

  const render = () => {
    const evaluated = evaluateMeasurementRelations();

    // ── Piece Groups ──
    pieceGroupsContainer.innerHTML = '';
    if (!pieceGroups.length) {
      pieceGroupsContainer.innerHTML =
        '<p style="color:#64748b;font-size:12px;margin:4px 0;">No piece groups yet.</p>';
    }
    pieceGroups.forEach((group, gIdx) => {
      const card = document.createElement('div');
      card.className = 'piece-group-card';

      // Build related image tags
      const relatedTags = (group.relatedViewIds || [])
        .map((rid, rIdx) => {
          const rLabel = metadata.imagePartLabels?.[rid] || rid;
          return `<span class="related-tag">${rLabel}<button data-remove-related="${rIdx}" title="Remove">&times;</button></span>`;
        })
        .join('');

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <label style="font-size:11px;font-weight:600;color:#334155;white-space:nowrap;">Main Image:</label>
              <select data-field="mainViewId" style="flex:1;border:1px solid #cbd5e1;border-radius:7px;padding:4px 6px;font-size:12px;">${viewOptions}</select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <label style="font-size:11px;font-weight:600;color:#334155;white-space:nowrap;">Related:</label>
              <span id="relatedTags-${gIdx}">${relatedTags || '<span style="color:#94a3b8;font-size:11px;">None</span>'}</span>
              <button data-add-related="${gIdx}" type="button" style="border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;">+ Add</button>
            </div>
          </div>
          <button data-remove-group="${gIdx}" type="button" style="border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:7px;padding:4px 8px;font-size:11px;cursor:pointer;">Remove</button>
        </div>
      `;

      // Set main view select value
      const mainSelect = card.querySelector('[data-field="mainViewId"]');
      mainSelect.value = group.mainViewId || viewIds[0] || '';
      mainSelect.addEventListener('change', () => {
        pieceGroups[gIdx] = { ...group, mainViewId: mainSelect.value };
      });

      // Remove related image buttons
      card.querySelectorAll('[data-remove-related]').forEach(btn => {
        btn.addEventListener('click', () => {
          const rIdx = Number(btn.dataset.removeRelated);
          const updated = [...(group.relatedViewIds || [])];
          updated.splice(rIdx, 1);
          pieceGroups[gIdx] = { ...group, relatedViewIds: updated };
          render();
        });
      });

      // Add related image
      card.querySelector(`[data-add-related="${gIdx}"]`)?.addEventListener('click', () => {
        // Pick the first view not already used in this group
        const usedInGroup = new Set([group.mainViewId, ...(group.relatedViewIds || [])]);
        const available = viewIds.find(id => !usedInGroup.has(id));
        if (!available) return;
        pieceGroups[gIdx] = {
          ...group,
          relatedViewIds: [...(group.relatedViewIds || []), available],
        };
        render();
      });

      // Remove group
      card.querySelector(`[data-remove-group="${gIdx}"]`)?.addEventListener('click', () => {
        pieceGroups = pieceGroups.filter((_, i) => i !== gIdx);
        render();
      });

      pieceGroupsContainer.appendChild(card);
    });

    // ── Checks ──
    checksBody.innerHTML = '';
    if (!checks.length) {
      checksBody.innerHTML = '<tr><td colspan="5" style="color:#64748b;">No checks yet.</td></tr>';
    }
    checks.forEach((check, idx) => {
      const status = evaluated.checks[idx]?.status || 'pending';
      const reason = evaluated.checks[idx]?.reason || '';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input data-field="formula" value="${check.formula || ''}" placeholder="e.g. B1 + F1 = G1" /></td>
        <td><input data-field="tolerance" type="number" step="0.1" value="${check.tolerance ?? 0}" /></td>
        <td><input data-field="note" value="${check.note || ''}" placeholder="Optional" /></td>
        <td><span class="status-chip ${status}">${status}</span><div style="font-size:10px;color:#64748b;">${reason}</div></td>
        <td><button data-remove="${idx}" type="button" style="border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:7px;padding:4px 8px;cursor:pointer;">Remove</button></td>
      `;
      row.querySelectorAll('[data-field]').forEach(input => {
        const field = input.dataset.field;
        input.addEventListener('change', () => {
          const next = { ...check };
          next[field] = field === 'tolerance' ? Number(input.value || 0) : input.value;
          checks[idx] = next;
        });
      });
      row.querySelector(`[data-remove="${idx}"]`)?.addEventListener('click', () => {
        checks = checks.filter((_, i) => i !== idx);
        render();
      });
      checksBody.appendChild(row);
    });

    // ── Connections (per-measurement fromKey/toKey) ──
    connectionsBody.innerHTML = '';
    if (!connections.length) {
      connectionsBody.innerHTML =
        '<tr><td colspan="5" style="color:#64748b;">No connections yet.</td></tr>';
    }
    connections.forEach((connection, idx) => {
      const status = evaluated.connections[idx]?.status || 'pending';
      const reason = evaluated.connections[idx]?.reason || '';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><select data-field="fromKey">${measurementOptions}</select></td>
        <td><select data-field="toKey">${measurementOptions}</select></td>
        <td><input data-field="note" value="${connection.note || ''}" placeholder="Optional" /></td>
        <td><span class="status-chip ${status}">${status}</span><div style="font-size:10px;color:#64748b;">${reason}</div></td>
        <td><button data-remove="${idx}" type="button" style="border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:7px;padding:4px 8px;cursor:pointer;">Remove</button></td>
      `;
      row.querySelector('[data-field="fromKey"]').value =
        connection.fromKey || index.entries[0]?.key || '';
      row.querySelector('[data-field="toKey"]').value =
        connection.toKey || index.entries[0]?.key || '';
      row.querySelectorAll('[data-field]').forEach(input => {
        const field = input.dataset.field;
        input.addEventListener('change', () => {
          connections[idx] = { ...connection, [field]: input.value };
        });
      });
      row.querySelector(`[data-remove="${idx}"]`)?.addEventListener('click', () => {
        connections = connections.filter((_, i) => i !== idx);
        render();
      });
      connectionsBody.appendChild(row);
    });
  };

  overlay.querySelector('#addPieceGroup')?.addEventListener('click', () => {
    pieceGroups = [
      ...pieceGroups,
      {
        id: `group-${Date.now()}`,
        mainViewId: viewIds[0] || '',
        relatedViewIds: [],
        label: '',
      },
    ];
    render();
  });

  overlay.querySelector('#addRelationCheck')?.addEventListener('click', () => {
    checks = [...checks, { id: `check-${Date.now()}`, formula: '', tolerance: 0, note: '' }];
    render();
  });

  overlay.querySelector('#addRelationConnection')?.addEventListener('click', () => {
    const firstKey = index.entries[0]?.key || '';
    connections = [
      ...connections,
      { id: `conn-${Date.now()}`, fromKey: firstKey, toKey: firstKey, note: '' },
    ];
    render();
  });

  overlay.querySelector('#saveRelations')?.addEventListener('click', () => {
    setMetadata({
      measurementChecks: checks,
      measurementConnections: connections,
      pieceGroups,
    });
    window.app?.projectManager?.showStatusMessage?.(
      'Measurement checks, connections, and piece groups saved.',
      'success'
    );
    overlay.remove();
  });

  overlay.querySelector('#closeRelationsEditor')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  render();
  document.body.appendChild(overlay);
}

function installLauncher() {
  if (document.getElementById('openMeasurementRelationsBtn')) return;
  const controls = document.getElementById('elementsControls');
  if (!controls) return;
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.innerHTML =
    '<button id="openMeasurementRelationsBtn" type="button" class="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Checks + Links</button>';
  controls.appendChild(wrap);
  wrap
    .querySelector('#openMeasurementRelationsBtn')
    ?.addEventListener('click', openMeasurementRelationsEditor);
}

export function initMeasurementRelations() {
  window.evaluateMeasurementRelations = evaluateMeasurementRelations;
  window.openMeasurementRelationsEditor = openMeasurementRelationsEditor;
  installLauncher();
  const retry = setInterval(() => {
    if (document.getElementById('openMeasurementRelationsBtn')) {
      clearInterval(retry);
      return;
    }
    installLauncher();
  }, 600);
  setTimeout(() => clearInterval(retry), 12000);
}
