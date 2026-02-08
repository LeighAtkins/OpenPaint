const EDGE_OPTIONS = ['left', 'right', 'front', 'back'];

function getMetadata() {
  const metadata = window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata;
  return metadata && typeof metadata === 'object'
    ? {
        ...metadata,
        pieces: Array.isArray(metadata.pieces) ? metadata.pieces : [],
        connections: Array.isArray(metadata.connections) ? metadata.connections : [],
      }
    : { pieces: [], connections: [] };
}

function persistMetadata(next) {
  if (window.app?.projectManager?.setProjectMetadata) {
    return window.app.projectManager.setProjectMetadata(next);
  }
  window.projectMetadata = { ...(window.projectMetadata || {}), ...next };
  return window.projectMetadata;
}

function buildNextPieceId(existingPieces) {
  const maxId = existingPieces
    .map(piece => Number.parseInt(String(piece.id || '').replace(/^P/i, ''), 10))
    .filter(Number.isFinite)
    .reduce((max, current) => Math.max(max, current), 0);
  return `P${maxId + 1}`;
}

function coerceNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureStyles() {
  if (document.getElementById('pieceConnectionEditorStyles')) return;
  const style = document.createElement('style');
  style.id = 'pieceConnectionEditorStyles';
  style.textContent = `
    .piece-editor-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.55); z-index: 12500; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .piece-editor-card { width: min(1040px, 100%); max-height: min(88vh, 920px); overflow: auto; background: #fff; border-radius: 16px; box-shadow: 0 24px 44px rgba(15,23,42,.24); padding: 20px; }
    .piece-editor-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; }
    .piece-editor-title { margin: 0; color: #0f172a; font-size: 22px; }
    .piece-editor-sub { margin: 4px 0 0; color: #475569; font-size: 13px; }
    .piece-editor-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
    .piece-editor-section { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
    .piece-editor-section h3 { margin: 0 0 10px; color: #0f172a; font-size: 15px; }
    .piece-editor-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .piece-editor-table th, .piece-editor-table td { border-bottom: 1px solid #e2e8f0; padding: 6px; text-align: left; vertical-align: middle; }
    .piece-editor-table th { color: #334155; font-weight: 600; background: #f8fafc; position: sticky; top: 0; }
    .piece-editor-table input, .piece-editor-table select { width: 100%; border: 1px solid #cbd5e1; border-radius: 7px; padding: 4px 6px; font-size: 12px; background: #fff; }
    .piece-editor-check { display: flex; align-items: center; justify-content: center; }
    .piece-editor-actions { display: flex; justify-content: space-between; gap: 10px; margin-top: 12px; }
    .piece-editor-btn { border-radius: 8px; border: 1px solid transparent; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .piece-editor-btn.primary { background: #1d4ed8; color: #fff; }
    .piece-editor-btn.secondary { background: #fff; border-color: #cbd5e1; color: #334155; }
    .piece-editor-btn.ghost { background: #fff; border-color: #fecaca; color: #b91c1c; }
    .piece-editor-empty { color: #64748b; font-size: 12px; margin: 0; }
  `;
  document.head.appendChild(style);
}

function createPieceDefault(existingPieces) {
  return {
    id: buildNextPieceId(existingPieces),
    name: '',
    pieceType: 'seat_module',
    hasLeftArm: false,
    hasRightArm: false,
    seatCushionCount: 0,
    backCushionCount: 0,
    widthTop: null,
    widthBase: null,
    depth: null,
    height: null,
  };
}

function renderPieceRows(tbody, pieces, onChange, onRemove) {
  tbody.innerHTML = '';
  if (!pieces.length) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td colspan="12"><p class="piece-editor-empty">No pieces yet. Add your first piece.</p></td>';
    tbody.appendChild(tr);
    return;
  }

  pieces.forEach((piece, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-field="id" value="${piece.id || ''}" /></td>
      <td><input data-field="name" value="${piece.name || ''}" placeholder="Optional" /></td>
      <td>
        <select data-field="pieceType">
          <option value="armchair">Armchair</option>
          <option value="seat_module">Seat module</option>
          <option value="corner">Corner</option>
          <option value="chaise">Chaise</option>
          <option value="ottoman">Ottoman</option>
          <option value="armless_unit">Armless unit</option>
          <option value="other">Other</option>
        </select>
      </td>
      <td class="piece-editor-check"><input data-field="hasLeftArm" type="checkbox" ${piece.hasLeftArm ? 'checked' : ''} /></td>
      <td class="piece-editor-check"><input data-field="hasRightArm" type="checkbox" ${piece.hasRightArm ? 'checked' : ''} /></td>
      <td><input data-field="seatCushionCount" type="number" min="0" value="${piece.seatCushionCount ?? 0}" /></td>
      <td><input data-field="backCushionCount" type="number" min="0" value="${piece.backCushionCount ?? 0}" /></td>
      <td><input data-field="widthTop" type="number" step="0.1" value="${piece.widthTop ?? ''}" /></td>
      <td><input data-field="widthBase" type="number" step="0.1" value="${piece.widthBase ?? ''}" /></td>
      <td><input data-field="depth" type="number" step="0.1" value="${piece.depth ?? ''}" /></td>
      <td><input data-field="height" type="number" step="0.1" value="${piece.height ?? ''}" /></td>
      <td><button type="button" class="piece-editor-btn ghost" data-remove="${index}">Remove</button></td>
    `;

    tr.querySelector('select[data-field="pieceType"]').value = piece.pieceType || 'seat_module';

    tr.querySelectorAll('[data-field]').forEach(input => {
      const field = input.dataset.field;
      input.addEventListener('change', () => {
        const next = { ...piece };
        if (input.type === 'checkbox') {
          next[field] = input.checked;
        } else if (
          [
            'seatCushionCount',
            'backCushionCount',
            'widthTop',
            'widthBase',
            'depth',
            'height',
          ].includes(field)
        ) {
          const value = coerceNumber(input.value);
          next[field] =
            field === 'seatCushionCount' || field === 'backCushionCount'
              ? Math.max(0, Math.floor(value || 0))
              : value;
        } else {
          next[field] = input.value;
        }
        onChange(index, next);
      });
    });

    tr.querySelector(`[data-remove="${index}"]`).addEventListener('click', () => onRemove(index));
    tbody.appendChild(tr);
  });
}

function renderConnectionRows(tbody, connections, pieces, onChange, onRemove) {
  tbody.innerHTML = '';
  const pieceOptions = pieces.map(piece => piece.id).filter(Boolean);

  if (!connections.length) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td colspan="5"><p class="piece-editor-empty">No connections yet. Add a row to map joins.</p></td>';
    tbody.appendChild(tr);
    return;
  }

  connections.forEach((connection, index) => {
    const pieceSelect = optionValue =>
      `<select data-field="${optionValue}">${pieceOptions
        .map(pieceId => `<option value="${pieceId}">${pieceId}</option>`)
        .join('')}</select>`;
    const edgeSelect = optionValue =>
      `<select data-field="${optionValue}">${EDGE_OPTIONS.map(edge => `<option value="${edge}">${edge}</option>`).join('')}</select>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${pieceSelect('fromPiece')}</td>
      <td>${edgeSelect('fromEdge')}</td>
      <td>${pieceSelect('toPiece')}</td>
      <td>${edgeSelect('toEdge')}</td>
      <td><button type="button" class="piece-editor-btn ghost" data-remove="${index}">Remove</button></td>
    `;

    tr.querySelector('[data-field="fromPiece"]').value =
      connection.fromPiece || pieceOptions[0] || '';
    tr.querySelector('[data-field="toPiece"]').value = connection.toPiece || pieceOptions[0] || '';
    tr.querySelector('[data-field="fromEdge"]').value = connection.fromEdge || 'left';
    tr.querySelector('[data-field="toEdge"]').value = connection.toEdge || 'right';

    tr.querySelectorAll('[data-field]').forEach(input => {
      const field = input.dataset.field;
      input.addEventListener('change', () => {
        onChange(index, { ...connection, [field]: input.value });
      });
    });

    tr.querySelector(`[data-remove="${index}"]`).addEventListener('click', () => onRemove(index));
    tbody.appendChild(tr);
  });
}

function openPieceConnectionEditor() {
  ensureStyles();
  const metadata = getMetadata();
  let pieces = [...metadata.pieces];
  let connections = [...metadata.connections];

  const overlay = document.createElement('div');
  overlay.className = 'piece-editor-overlay';
  overlay.innerHTML = `
    <div class="piece-editor-card" role="dialog" aria-modal="true" aria-label="Piece and connection editor">
      <div class="piece-editor-header">
        <div>
          <h2 class="piece-editor-title">Piece + Connection Editor</h2>
          <p class="piece-editor-sub">Define sofa pieces, cushions, and how sections connect.</p>
        </div>
        <button type="button" class="piece-editor-btn secondary" id="pieceEditorCloseTop">Close</button>
      </div>

      <div class="piece-editor-grid">
        <section class="piece-editor-section">
          <h3>Pieces</h3>
          <div style="max-height: 42vh; overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px;">
            <table class="piece-editor-table">
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>Type</th><th>L Arm</th><th>R Arm</th>
                  <th>Seat Cushions</th><th>Back Cushions</th>
                  <th>Width Top (cm)</th><th>Width Base (cm)</th><th>Depth (cm)</th><th>Height (cm)</th><th></th>
                </tr>
              </thead>
              <tbody id="pieceEditorPieceBody"></tbody>
            </table>
          </div>
          <div class="piece-editor-actions">
            <button type="button" class="piece-editor-btn secondary" id="pieceEditorAddPiece">Add piece</button>
            <div style="font-size:12px;color:#475569;">Piece count: <span id="pieceEditorPieceCount">0</span></div>
          </div>
        </section>

        <section class="piece-editor-section">
          <h3>Connections</h3>
          <div style="max-height: 25vh; overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px;">
            <table class="piece-editor-table">
              <thead>
                <tr><th>From Piece</th><th>From Edge</th><th>To Piece</th><th>To Edge</th><th></th></tr>
              </thead>
              <tbody id="pieceEditorConnectionBody"></tbody>
            </table>
          </div>
          <div class="piece-editor-actions">
            <button type="button" class="piece-editor-btn secondary" id="pieceEditorAddConnection">Add connection</button>
          </div>
        </section>
      </div>

      <div class="piece-editor-actions" style="margin-top:16px;">
        <button type="button" class="piece-editor-btn secondary" id="pieceEditorCancel">Cancel</button>
        <button type="button" class="piece-editor-btn primary" id="pieceEditorSave">Save piece data</button>
      </div>
    </div>
  `;

  const pieceBody = overlay.querySelector('#pieceEditorPieceBody');
  const connectionBody = overlay.querySelector('#pieceEditorConnectionBody');
  const countEl = overlay.querySelector('#pieceEditorPieceCount');

  const redraw = () => {
    countEl.textContent = String(pieces.length);
    renderPieceRows(
      pieceBody,
      pieces,
      (index, updated) => {
        pieces[index] = updated;
      },
      index => {
        const removedId = pieces[index]?.id;
        pieces = pieces.filter((_, i) => i !== index);
        if (removedId) {
          connections = connections.filter(
            connection => connection.fromPiece !== removedId && connection.toPiece !== removedId
          );
        }
        redraw();
      }
    );

    renderConnectionRows(
      connectionBody,
      connections,
      pieces,
      (index, updated) => {
        connections[index] = updated;
      },
      index => {
        connections = connections.filter((_, i) => i !== index);
        redraw();
      }
    );
  };

  overlay.querySelector('#pieceEditorAddPiece').addEventListener('click', () => {
    pieces = [...pieces, createPieceDefault(pieces)];
    redraw();
  });

  overlay.querySelector('#pieceEditorAddConnection').addEventListener('click', () => {
    const first = pieces[0]?.id || '';
    const second = pieces[1]?.id || first;
    connections = [
      ...connections,
      {
        fromPiece: first,
        fromEdge: 'right',
        toPiece: second,
        toEdge: 'left',
      },
    ];
    redraw();
  });

  const close = () => overlay.remove();
  overlay.querySelector('#pieceEditorCloseTop').addEventListener('click', close);
  overlay.querySelector('#pieceEditorCancel').addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });

  overlay.querySelector('#pieceEditorSave').addEventListener('click', () => {
    const cleanedPieces = pieces.filter(piece => piece.id && String(piece.id).trim().length > 0);
    const cleanedConnections = connections.filter(
      connection =>
        connection.fromPiece && connection.toPiece && connection.fromEdge && connection.toEdge
    );

    persistMetadata({
      pieces: cleanedPieces,
      pieceCount: cleanedPieces.length,
      connections: cleanedConnections,
    });

    if (window.app?.projectManager?.showStatusMessage) {
      window.app.projectManager.showStatusMessage('Piece and connection data saved.', 'success');
    } else if (window.showStatusMessage) {
      window.showStatusMessage('Piece and connection data saved.', 'success');
    }

    close();
  });

  redraw();
  document.body.appendChild(overlay);
}

function installLaunchButton() {
  if (document.getElementById('openPieceEditorBtn')) return;
  const controls = document.getElementById('elementsControls');
  if (!controls) return;

  const row = document.createElement('div');
  row.style.marginTop = '8px';
  row.innerHTML =
    '<button id="openPieceEditorBtn" type="button" class="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Edit Pieces + Connections</button>';
  controls.appendChild(row);

  const button = row.querySelector('#openPieceEditorBtn');
  button.addEventListener('click', openPieceConnectionEditor);
}

export function initPieceConnectionEditor() {
  window.openPieceConnectionEditor = openPieceConnectionEditor;
  installLaunchButton();
  const retry = setInterval(() => {
    if (document.getElementById('openPieceEditorBtn')) {
      clearInterval(retry);
      return;
    }
    installLaunchButton();
  }, 600);
  setTimeout(() => clearInterval(retry), 12000);
}
