export const DEFAULT_RULE_PARAMS = {
  tolSeatSum: 2,
  tolJoinHeight: 1,
  tolOverallWidth: 3,
  armTaperThreshold: 2,
};

export function getProjectMetadata() {
  const metadata = window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata;
  return metadata && typeof metadata === 'object' ? metadata : {};
}

export function mergeRuleParams(metadata) {
  const custom =
    metadata?.ruleParams && typeof metadata.ruleParams === 'object' ? metadata.ruleParams : {};
  return {
    ...DEFAULT_RULE_PARAMS,
    ...custom,
  };
}

export function persistRuleParams(params) {
  if (window.app?.projectManager?.setProjectMetadata) {
    window.app.projectManager.setProjectMetadata({ ruleParams: params });
  } else {
    window.projectMetadata = { ...(window.projectMetadata || {}), ruleParams: params };
  }
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

export function evaluateSofaRules(
  metadata = getProjectMetadata(),
  params = mergeRuleParams(metadata)
) {
  const pieces = Array.isArray(metadata.pieces) ? metadata.pieces : [];
  const cushions = Array.isArray(metadata.cushions) ? metadata.cushions : [];
  const connections = Array.isArray(metadata.connections) ? metadata.connections : [];
  const pieceMap = getPieceMap(pieces);

  const checks = [];

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
