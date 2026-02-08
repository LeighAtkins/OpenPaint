import {
  evaluateSofaRules,
  getProjectMetadata,
  mergeRuleParams,
  persistRuleParams,
} from '../sofa-rule-engine.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getRuleResult(metadata, params) {
  if (typeof window.evaluateSofaRules === 'function') {
    return window.evaluateSofaRules({ ...metadata, ruleParams: params });
  }
  return evaluateSofaRules(metadata, params);
}

function renderPieceTable(metadata) {
  const pieces = Array.isArray(metadata.pieces) ? metadata.pieces : [];
  if (!pieces.length) {
    return '<p class="muted">No piece data yet.</p>';
  }

  const rows = pieces
    .map(
      piece => `
      <tr>
        <td>${escapeHtml(piece.id)}</td>
        <td>${escapeHtml(piece.pieceType || piece.type || '')}</td>
        <td>${Number(piece.hasLeftArm ? 1 : 0)}</td>
        <td>${Number(piece.hasRightArm ? 1 : 0)}</td>
        <td>${escapeHtml(piece.seatCushionCount ?? '')}</td>
        <td>${escapeHtml(piece.backCushionCount ?? '')}</td>
        <td>${escapeHtml(piece.widthTop ?? '')}</td>
        <td>${escapeHtml(piece.widthBase ?? '')}</td>
        <td>${escapeHtml(piece.depth ?? '')}</td>
        <td>${escapeHtml(piece.height ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <table>
      <thead>
        <tr><th>Piece</th><th>Type</th><th>L Arm</th><th>R Arm</th><th>Seat Cushions</th><th>Back Cushions</th><th>Width Top</th><th>Width Base</th><th>Depth</th><th>Height</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderConnectionTable(metadata) {
  const connections = Array.isArray(metadata.connections) ? metadata.connections : [];
  if (!connections.length) {
    return '<p class="muted">No connections mapped yet.</p>';
  }
  const rows = connections
    .map(
      connection => `
    <tr>
      <td>${escapeHtml(connection.fromPiece)}</td>
      <td>${escapeHtml(connection.fromEdge)}</td>
      <td>${escapeHtml(connection.toPiece)}</td>
      <td>${escapeHtml(connection.toEdge)}</td>
    </tr>`
    )
    .join('');

  return `
    <table>
      <thead><tr><th>From Piece</th><th>From Edge</th><th>To Piece</th><th>To Edge</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderChecks(ruleResult) {
  if (!ruleResult.checks?.length) {
    return '<p class="muted">No checks available yet. Connect Rule Engine v1 branch for full output.</p>';
  }

  return ruleResult.checks
    .map(
      check => `
      <article class="check-item ${escapeHtml(check.status)}">
        <div class="check-top">
          <strong>${escapeHtml(check.id)} - ${escapeHtml(check.label)}</strong>
          <span class="badge ${escapeHtml(check.status)}">${escapeHtml(check.status)}</span>
        </div>
        <p>${escapeHtml(check.message)}</p>
      </article>
    `
    )
    .join('');
}

function buildAdaptiveIntakeHtml(metadata, params, ruleResult) {
  const projectName = document.getElementById('projectName')?.value || 'OpenPaint Intake';
  const sofaType = metadata.sofaType || 'unspecified';
  const pieceCount = Array.isArray(metadata.pieces)
    ? metadata.pieces.length
    : metadata.pieceCount || 0;
  const generatedActions = ruleResult.generatedActions || [];

  const actionsHtml = generatedActions.length
    ? `<ul>${generatedActions
        .map(
          action =>
            `<li><strong>${escapeHtml(action.checkId)}</strong>: ${escapeHtml(action.type)}${action.slot ? ` (${escapeHtml(action.slot)})` : ''}${action.prompt ? ` - ${escapeHtml(action.prompt)}` : ''}</li>`
        )
        .join('')}</ul>`
    : '<p class="muted">No follow-up requests generated.</p>';

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(projectName)} - Adaptive Intake</title>
    <style>
      @page { size: Letter; margin: 14mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: 'Segoe UI', sans-serif; color: #0f172a; }
      .page { page-break-after: always; padding: 8px 2px; }
      .page:last-child { page-break-after: auto; }
      h1 { margin: 0 0 4px; font-size: 22px; }
      h2 { margin: 0 0 8px; font-size: 16px; }
      p { margin: 0 0 8px; font-size: 12px; line-height: 1.5; }
      .muted { color: #475569; }
      .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0 14px; }
      .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; background: #f8fafc; }
      .card strong { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #475569; display: block; margin-bottom: 3px; }
      table { width: 100%; border-collapse: collapse; margin: 6px 0 8px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px; font-size: 11px; text-align: left; }
      th { background: #e2e8f0; }
      .check-item { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; margin-bottom: 8px; }
      .check-item.fail { border-color: #fca5a5; background: #fef2f2; }
      .check-item.warn { border-color: #fcd34d; background: #fffbeb; }
      .check-item.pass { border-color: #86efac; background: #f0fdf4; }
      .check-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
      .badge { font-size: 10px; font-weight: 700; border-radius: 999px; padding: 2px 8px; text-transform: uppercase; }
      .badge.fail { background: #fecaca; color: #991b1b; }
      .badge.warn { background: #fde68a; color: #92400e; }
      .badge.pass { background: #bbf7d0; color: #166534; }
      ul { margin: 0; padding-left: 18px; }
      li { margin-bottom: 6px; font-size: 12px; }
    </style>
  </head>
  <body>
    <section class="page">
      <h1>${escapeHtml(projectName)}</h1>
      <p class="muted">Adaptive Sofa Intake (HTML module preview)</p>
      <div class="meta">
        <div class="card"><strong>Sofa Type</strong>${escapeHtml(sofaType)}</div>
        <div class="card"><strong>Piece Count</strong>${escapeHtml(pieceCount)}</div>
        <div class="card"><strong>Rule Status</strong>${escapeHtml(ruleResult.overallStatus || 'warn')}</div>
      </div>
      <p><strong>Rule Parameters</strong></p>
      <p class="muted">tolSeatSum=${escapeHtml(params.tolSeatSum)}cm, tolJoinHeight=${escapeHtml(params.tolJoinHeight)}cm, tolOverallWidth=${escapeHtml(params.tolOverallWidth)}cm, armTaperThreshold=${escapeHtml(params.armTaperThreshold)}cm</p>
      <h2>Piece Module</h2>
      ${renderPieceTable(metadata)}
      <h2>Connections Module</h2>
      ${renderConnectionTable(metadata)}
    </section>

    <section class="page">
      <h2>Relationship Checks</h2>
      ${renderChecks(ruleResult)}
      <h2>Auto-generated Follow-up Requests</h2>
      ${actionsHtml}
    </section>
  </body>
  </html>`;
}

function openAdaptiveIntakePdf() {
  const metadata = getProjectMetadata();
  let params = mergeRuleParams(metadata);

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,.58);z-index:12800;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <section style="width:min(1100px,100%);height:min(90vh,920px);background:#fff;border-radius:16px;box-shadow:0 24px 45px rgba(15,23,42,.22);padding:14px;display:flex;flex-direction:column;gap:12px;">
      <header style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <h2 style="margin:0;font-size:20px;color:#0f172a;">Adaptive Intake PDF (Beta)</h2>
          <p style="margin:4px 0 0;font-size:12px;color:#475569;">Rule params are editable and persisted to project metadata.</p>
        </div>
        <button id="adaptivePdfClose" type="button" style="border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:8px 10px;font-weight:600;cursor:pointer;">Close</button>
      </header>

      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;align-items:end;">
        <label style="font-size:12px;color:#334155;">tolSeatSum (cm)<input id="rule_tolSeatSum" type="number" step="0.1" style="width:100%;margin-top:4px;border:1px solid #cbd5e1;border-radius:8px;padding:7px;" /></label>
        <label style="font-size:12px;color:#334155;">tolJoinHeight (cm)<input id="rule_tolJoinHeight" type="number" step="0.1" style="width:100%;margin-top:4px;border:1px solid #cbd5e1;border-radius:8px;padding:7px;" /></label>
        <label style="font-size:12px;color:#334155;">tolOverallWidth (cm)<input id="rule_tolOverallWidth" type="number" step="0.1" style="width:100%;margin-top:4px;border:1px solid #cbd5e1;border-radius:8px;padding:7px;" /></label>
        <label style="font-size:12px;color:#334155;">armTaperThreshold (cm)<input id="rule_armTaperThreshold" type="number" step="0.1" style="width:100%;margin-top:4px;border:1px solid #cbd5e1;border-radius:8px;padding:7px;" /></label>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="adaptivePdfRegenerate" type="button" style="border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:8px 10px;font-weight:600;cursor:pointer;">Regenerate</button>
        <button id="adaptivePdfPrint" type="button" style="border:none;background:#1d4ed8;color:#fff;border-radius:8px;padding:8px 10px;font-weight:600;cursor:pointer;">Print / Save PDF</button>
      </div>

      <iframe id="adaptivePdfFrame" title="Adaptive intake preview" style="width:100%;height:100%;border:1px solid #cbd5e1;border-radius:10px;"></iframe>
    </section>
  `;

  const inputIds = [
    'rule_tolSeatSum',
    'rule_tolJoinHeight',
    'rule_tolOverallWidth',
    'rule_armTaperThreshold',
  ];

  const setInputs = () => {
    overlay.querySelector('#rule_tolSeatSum').value = String(params.tolSeatSum);
    overlay.querySelector('#rule_tolJoinHeight').value = String(params.tolJoinHeight);
    overlay.querySelector('#rule_tolOverallWidth').value = String(params.tolOverallWidth);
    overlay.querySelector('#rule_armTaperThreshold').value = String(params.armTaperThreshold);
  };

  const readInputs = () => {
    const next = { ...params };
    inputIds.forEach(id => {
      const input = overlay.querySelector(`#${id}`);
      const raw = Number.parseFloat(input.value);
      if (!Number.isFinite(raw)) return;
      if (id === 'rule_tolSeatSum') next.tolSeatSum = raw;
      if (id === 'rule_tolJoinHeight') next.tolJoinHeight = raw;
      if (id === 'rule_tolOverallWidth') next.tolOverallWidth = raw;
      if (id === 'rule_armTaperThreshold') next.armTaperThreshold = raw;
    });
    params = next;
    persistRuleParams(params);
  };

  const renderFrame = () => {
    const currentMetadata = getProjectMetadata();
    const result = getRuleResult(currentMetadata, params);
    const html = buildAdaptiveIntakeHtml(currentMetadata, params, result);
    const frame = overlay.querySelector('#adaptivePdfFrame');
    frame.srcdoc = html;
  };

  overlay.querySelector('#adaptivePdfClose')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#adaptivePdfRegenerate')?.addEventListener('click', () => {
    readInputs();
    renderFrame();
  });
  overlay.querySelector('#adaptivePdfPrint')?.addEventListener('click', () => {
    readInputs();
    const frame = overlay.querySelector('#adaptivePdfFrame');
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  });

  setInputs();
  renderFrame();
  document.body.appendChild(overlay);
}

function installLauncher() {
  if (document.getElementById('openAdaptiveIntakePdfBtn')) return;
  const controls = document.getElementById('elementsControls');
  if (!controls) return;
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.innerHTML =
    '<button id="openAdaptiveIntakePdfBtn" type="button" class="w-full px-2 py-1 text-xs bg-sky-50 border border-sky-300 rounded-lg hover:bg-sky-100 transition-colors">Adaptive Intake PDF (Beta)</button>';
  controls.appendChild(wrap);
  wrap
    .querySelector('#openAdaptiveIntakePdfBtn')
    ?.addEventListener('click', () => window.openAdaptiveIntakePdf?.());
}

export function initAdaptiveIntakePdf() {
  window.openAdaptiveIntakePdf = openAdaptiveIntakePdf;
  installLauncher();
  const retry = setInterval(() => {
    if (document.getElementById('openAdaptiveIntakePdfBtn')) {
      clearInterval(retry);
      return;
    }
    installLauncher();
  }, 600);
  setTimeout(() => clearInterval(retry), 12000);
}
