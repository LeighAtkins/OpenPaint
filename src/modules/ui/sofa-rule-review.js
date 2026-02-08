const DEFAULT_PARAMS = {
  tolSeatSum: 2,
  tolJoinHeight: 1,
  tolOverallWidth: 3,
  armTaperThreshold: 2,
};

function getProjectMetadata() {
  const metadata = window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata;
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function toNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPieceMap(pieces) {
  return Object.fromEntries((pieces || []).map(piece => [piece.id, piece]));
}

function statusRank(status) {
  if (status === 'fail') return 3;
  if (status === 'warn') return 2;
  return 1;
}

function evaluateSofaRules(metadata, params = DEFAULT_PARAMS) {
  const pieces = Array.isArray(metadata.pieces) ? metadata.pieces : [];
  const cushions = Array.isArray(metadata.cushions) ? metadata.cushions : [];
  const connections = Array.isArray(metadata.connections) ? metadata.connections : [];
  const pieceMap = getPieceMap(pieces);

  const checks = [];

  // E5: Per-piece cushion count sum vs totals
  const totalSeatByPiece = pieces.reduce(
    (sum, piece) => sum + (Number(piece.seatCushionCount) || 0),
    0
  );
  const totalBackByPiece = pieces.reduce(
    (sum, piece) => sum + (Number(piece.backCushionCount) || 0),
    0
  );
  const totalSeatEntered = toNumber(metadata.totalSeatCushions);
  const totalBackEntered = toNumber(metadata.totalBackCushions);

  if (totalSeatEntered === null && totalBackEntered === null) {
    checks.push({
      id: 'E5',
      label: 'Per-piece cushion counts sum to total',
      status: 'warn',
      severity: 'high',
      message: 'Overall seat/back cushion totals are missing; enter totals to validate counts.',
      actions: [{ type: 'ask', prompt: 'Enter total seat and back cushions for the whole sofa.' }],
    });
  } else {
    const seatMismatch = totalSeatEntered !== null && totalSeatEntered !== totalSeatByPiece;
    const backMismatch = totalBackEntered !== null && totalBackEntered !== totalBackByPiece;
    checks.push({
      id: 'E5',
      label: 'Per-piece cushion counts sum to total',
      status: seatMismatch || backMismatch ? 'fail' : 'pass',
      severity: 'high',
      message:
        seatMismatch || backMismatch
          ? `Totals mismatch (entered seat/back: ${totalSeatEntered === null ? '-' : totalSeatEntered} / ${totalBackEntered === null ? '-' : totalBackEntered}, by piece: ${totalSeatByPiece} / ${totalBackByPiece}).`
          : 'Per-piece cushion counts match overall totals.',
      actions:
        seatMismatch || backMismatch
          ? [
              {
                type: 'ask',
                prompt: 'Confirm whole-sofa cushion totals and per-piece cushion counts.',
              },
            ]
          : [],
    });
  }

  // E2: seat platform width vs summed seat cushion widths per piece
  const e2Failures = [];
  pieces.forEach(piece => {
    const platformWidth = toNumber(piece.seatPlatformWidth);
    if (platformWidth === null) return;

    const seatCushions = cushions.filter(
      cushion => cushion.pieceRef === piece.id && cushion.cushionType === 'seat'
    );
    if (!seatCushions.length) return;

    const sumWidths = seatCushions.reduce(
      (sum, cushion) => sum + (toNumber(cushion.width) || 0),
      0
    );
    if (Math.abs(sumWidths - platformWidth) > params.tolSeatSum) {
      e2Failures.push({ pieceId: piece.id, platformWidth, sumWidths });
    }
  });

  checks.push({
    id: 'E2',
    label: 'Seat width should match cushion widths',
    status: e2Failures.length ? 'fail' : pieces.length ? 'pass' : 'warn',
    severity: 'high',
    message: e2Failures.length
      ? `Seat/platform mismatch on ${e2Failures.map(item => item.pieceId).join(', ')}.`
      : 'Seat/platform width checks passed for available cushion data.',
    actions: e2Failures.length
      ? [
          { type: 'request_photo', slot: 'seat_platform' },
          { type: 'request_photo_proof', method: 'tape_proof' },
        ]
      : [],
  });

  // E3: connection side heights consistency
  const e3Failures = [];
  connections.forEach(connection => {
    const fromPiece = pieceMap[connection.fromPiece];
    const toPiece = pieceMap[connection.toPiece];
    if (!fromPiece || !toPiece) return;

    const fromHeight =
      toNumber(
        fromPiece[
          `edgeHeight${String(connection.fromEdge || '').replace(/^./, c => c.toUpperCase())}`
        ]
      ) || toNumber(fromPiece.height);
    const toHeight =
      toNumber(
        toPiece[`edgeHeight${String(connection.toEdge || '').replace(/^./, c => c.toUpperCase())}`]
      ) || toNumber(toPiece.height);
    if (fromHeight === null || toHeight === null) return;

    if (Math.abs(fromHeight - toHeight) > params.tolJoinHeight) {
      e3Failures.push(
        `${connection.fromPiece}:${connection.fromEdge} -> ${connection.toPiece}:${connection.toEdge}`
      );
    }
  });

  checks.push({
    id: 'E3',
    label: 'Connecting sides should match height',
    status: e3Failures.length ? 'fail' : connections.length ? 'pass' : 'warn',
    severity: 'high',
    message: e3Failures.length
      ? `Height mismatch at ${e3Failures.join(', ')}.`
      : 'Connection edge height checks passed for available data.',
    actions: e3Failures.length
      ? [
          { type: 'request_photo', slot: 'join_edge_closeup' },
          { type: 'request_photo_proof', method: 'tape_proof' },
        ]
      : [],
  });

  // R_ARM_TAPER: compare width top vs base
  const taperPieces = pieces
    .filter(piece => piece.hasLeftArm || piece.hasRightArm)
    .filter(piece => {
      const top = toNumber(piece.widthTop);
      const base = toNumber(piece.widthBase);
      return top !== null && base !== null && Math.abs(top - base) > params.armTaperThreshold;
    })
    .map(piece => piece.id);

  checks.push({
    id: 'R_ARM_TAPER',
    label: 'Arm taper suspected',
    status: taperPieces.length ? 'warn' : pieces.length ? 'pass' : 'warn',
    severity: 'medium',
    message: taperPieces.length
      ? `Arm taper detected on ${taperPieces.join(', ')}.`
      : 'No arm taper flags detected with current dimensions.',
    actions: taperPieces.length
      ? [
          { type: 'request_photo', slot: 'arm_45_left' },
          { type: 'request_photo', slot: 'arm_45_right' },
          { type: 'request_photo_proof', method: 'tape_proof' },
        ]
      : [],
  });

  // R_WIDTH_RECON: reconcile overall width vs sum of piece widths
  const overallWidth = toNumber(metadata.overallWidth);
  const sumPieceWidths = pieces.reduce((sum, piece) => {
    const width = toNumber(piece.widthTop) ?? toNumber(piece.widthBase) ?? 0;
    return sum + width;
  }, 0);
  const widthMismatch =
    overallWidth !== null &&
    pieces.length > 0 &&
    Math.abs(overallWidth - sumPieceWidths) > params.tolOverallWidth;

  checks.push({
    id: 'R_WIDTH_RECON',
    label: 'Overall width mismatch',
    status: widthMismatch ? 'fail' : overallWidth !== null ? 'pass' : 'warn',
    severity: 'high',
    message: widthMismatch
      ? `Overall width ${overallWidth}cm does not match piece-sum ${sumPieceWidths.toFixed(1)}cm.`
      : overallWidth === null
        ? 'Overall width is missing; cannot reconcile layout width.'
        : 'Overall width reconciles with piece widths.',
    actions: widthMismatch
      ? [
          { type: 'ask', prompt: 'Confirm left-to-right layout path and piece widths.' },
          { type: 'request_photo', slot: 'layout_topdown' },
          { type: 'request_photo_proof', method: 'tape_proof' },
        ]
      : [],
  });

  const overallStatus = checks.reduce(
    (maxStatus, check) =>
      statusRank(check.status) > statusRank(maxStatus) ? check.status : maxStatus,
    'pass'
  );
  const generatedActions = checks.flatMap(check =>
    (check.actions || []).map(action => ({
      ...action,
      checkId: check.id,
      severity: check.severity,
    }))
  );

  return {
    overallStatus,
    checks,
    generatedActions,
    computed: {
      totalSeatByPiece,
      totalBackByPiece,
      sumPieceWidths,
      overallWidth,
    },
  };
}

function ensureStyles() {
  if (document.getElementById('sofaRuleReviewStyles')) return;
  const style = document.createElement('style');
  style.id = 'sofaRuleReviewStyles';
  style.textContent = `
    .sofa-rule-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.58); z-index: 12600; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .sofa-rule-card { width: min(900px, 100%); max-height: 88vh; overflow: auto; background: #fff; border-radius: 16px; box-shadow: 0 24px 45px rgba(15,23,42,.25); padding: 20px; }
    .sofa-rule-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .sofa-rule-title { margin: 0; color: #0f172a; font-size: 22px; }
    .sofa-rule-sub { margin: 4px 0 0; color: #475569; font-size: 13px; }
    .sofa-rule-badge { font-size: 11px; font-weight: 700; letter-spacing: .03em; border-radius: 999px; padding: 3px 8px; text-transform: uppercase; }
    .sofa-rule-badge.pass { background: #dcfce7; color: #166534; }
    .sofa-rule-badge.warn { background: #fef3c7; color: #92400e; }
    .sofa-rule-badge.fail { background: #fee2e2; color: #991b1b; }
    .sofa-rule-item { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; margin-bottom: 8px; }
    .sofa-rule-item h4 { margin: 0; font-size: 14px; color: #0f172a; display: flex; justify-content: space-between; }
    .sofa-rule-item p { margin: 8px 0 0; font-size: 12px; color: #334155; }
    .sofa-rule-actions { margin-top: 8px; padding-left: 16px; color: #475569; font-size: 12px; }
    .sofa-rule-footer { margin-top: 14px; display: flex; justify-content: flex-end; }
    .sofa-rule-btn { border-radius: 9px; border: 1px solid #cbd5e1; background: #fff; color: #334155; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
  `;
  document.head.appendChild(style);
}

function openSofaRuleReview() {
  const metadata = getProjectMetadata();
  const result = evaluateSofaRules(metadata, DEFAULT_PARAMS);

  ensureStyles();
  const overlay = document.createElement('div');
  overlay.className = 'sofa-rule-overlay';

  const checksHtml = result.checks
    .map(
      check => `
      <article class="sofa-rule-item">
        <h4>
          <span>${check.id} - ${check.label}</span>
          <span class="sofa-rule-badge ${check.status}">${check.status}</span>
        </h4>
        <p>${check.message}</p>
        ${check.actions?.length ? `<ul class="sofa-rule-actions">${check.actions.map(action => `<li>${action.type}${action.slot ? `: ${action.slot}` : ''}${action.prompt ? ` — ${action.prompt}` : ''}</li>`).join('')}</ul>` : ''}
      </article>
    `
    )
    .join('');

  overlay.innerHTML = `
    <section class="sofa-rule-card" role="dialog" aria-modal="true" aria-label="Sofa relationship checks">
      <div class="sofa-rule-top">
        <div>
          <h2 class="sofa-rule-title">Sofa Relationship Checks</h2>
          <p class="sofa-rule-sub">Run validation and follow-up request generation from current project metadata.</p>
        </div>
        <span class="sofa-rule-badge ${result.overallStatus}">${result.overallStatus}</span>
      </div>

      ${checksHtml}

      <div class="sofa-rule-footer">
        <button class="sofa-rule-btn" id="closeSofaRuleReview" type="button">Close</button>
      </div>
    </section>
  `;

  const close = () => overlay.remove();
  overlay.querySelector('#closeSofaRuleReview')?.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });

  document.body.appendChild(overlay);
  return result;
}

function installLauncher() {
  if (document.getElementById('openSofaRuleReviewBtn')) return;
  const controls = document.getElementById('elementsControls');
  if (!controls) return;

  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.innerHTML =
    '<button id="openSofaRuleReviewBtn" type="button" class="w-full px-2 py-1 text-xs bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors">Run Sofa Checks</button>';
  controls.appendChild(wrap);
  wrap
    .querySelector('#openSofaRuleReviewBtn')
    ?.addEventListener('click', () => window.openSofaRuleReview?.());
}

export function initSofaRuleReview() {
  window.evaluateSofaRules = input =>
    evaluateSofaRules(input || getProjectMetadata(), DEFAULT_PARAMS);
  window.openSofaRuleReview = openSofaRuleReview;
  installLauncher();

  const retry = setInterval(() => {
    if (document.getElementById('openSofaRuleReviewBtn')) {
      clearInterval(retry);
      return;
    }
    installLauncher();
  }, 600);
  setTimeout(() => clearInterval(retry), 12000);
}
