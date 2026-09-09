/**
 * Sectional Builder measurement rules.
 *
 * Encodes the Comfort Works measuring-diagram conventions (codes per the
 * frame PDFs: A=widths, B=inner seat spans, C=cushion widths, D=depths,
 * E/F=arm dims, G=back heights, H=seat heights, J/L=legs & skirt) as a
 * machine-checkable catalog so the builder can validate entered values the
 * way the paper PDF forms expect.
 *
 * Rule families:
 *  - sum:      a code must equal the sum of parts (partition chain)
 *  - equality: codes that describe the same physical dimension must agree
 *  - range:    plausibility window for a code
 *  - derived:  a code auto-computes from others (shown as info)
 */

import type { SectionalPiece } from './sectional-builder';

export type MeasurementSeverity = 'error' | 'warn' | 'info';

export interface MeasurementRuleIssue {
  ruleId: string;
  severity: MeasurementSeverity;
  /** Short title, e.g. "Arm-to-arm width mismatch". */
  title: string;
  /** Human explanation including the codes and values involved. */
  message: string;
  /** Codes participating — UI can highlight/scroll to them. */
  codes: string[];
}

export type MeasurementValueMap = Record<string, number | undefined>;

interface SumRule {
  ruleId: string;
  target: string;
  parts: string[];
  toleranceCm: number;
  title: string;
  severity: MeasurementSeverity;
}

interface RangeRule {
  ruleId: string;
  code: string;
  min: number;
  max: number;
  title: string;
  severity: MeasurementSeverity;
}

interface EqualityRule {
  ruleId: string;
  codeGroups: string[][];
  toleranceCm: number;
  title: string;
  severity: MeasurementSeverity;
}

const fmt = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value * 10) / 10} cm`;

const isFilled = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Partition: target must equal the sum of parts (only checks filled parts). */
function checkSum(rule: SumRule, values: MeasurementValueMap): MeasurementRuleIssue | null {
  const target = values[rule.target];
  if (!isFilled(target)) return null;
  const parts = rule.parts.map(code => ({ code, value: values[code] }));
  const filledParts = parts.filter(part => isFilled(part.value));
  // Need at least two filled parts for a meaningful partition check.
  if (filledParts.length < 2) return null;
  const sum = filledParts.reduce((total, part) => total + (part.value as number), 0);
  const drift = Math.abs(sum - target);
  if (drift <= rule.toleranceCm) return null;
  const missing = parts.filter(part => !isFilled(part.value)).map(part => part.code);
  const detail =
    `${rule.target}=${fmt(target)} but ${filledParts.map(part => `${part.code}=${fmt(part.value)}`).join(' + ')}` +
    ` = ${fmt(sum)} (off by ${Math.round(drift * 10) / 10} cm)`;
  return {
    ruleId: rule.ruleId,
    severity: rule.severity,
    title: rule.title,
    message: missing.length ? `${detail}. Missing values: ${missing.join(', ')}.` : `${detail}.`,
    codes: [rule.target, ...rule.parts],
  };
}

/** Equality: every filled code in a group must agree within tolerance. */
function checkEquality(
  rule: EqualityRule,
  values: MeasurementValueMap
): MeasurementRuleIssue | null {
  for (const group of rule.codeGroups) {
    const filled = group.filter(code => isFilled(values[code]));
    if (filled.length < 2) continue;
    const first = values[filled[0]] as number;
    const drift = filled.reduce(
      (worst, code) => Math.max(worst, Math.abs((values[code] as number) - first)),
      0
    );
    if (drift <= rule.toleranceCm) continue;
    return {
      ruleId: rule.ruleId,
      severity: rule.severity,
      title: rule.title,
      message: `${filled.map(code => `${code}=${fmt(values[code])}`).join(', ')} disagree by ${Math.round(drift * 10) / 10} cm — these describe the same physical dimension and should match.`,
      codes: [...filled],
    };
  }
  return null;
}

/** Range: a filled code must sit inside a plausible physical window. */
function checkRange(rule: RangeRule, values: MeasurementValueMap): MeasurementRuleIssue | null {
  const value = values[rule.code];
  if (!isFilled(value)) return null;
  if (value >= rule.min && value <= rule.max) return null;
  return {
    ruleId: rule.ruleId,
    severity: rule.severity,
    title: rule.title,
    message: `${rule.code}=${fmt(value)} is outside the usual ${rule.min}–${rule.max} cm range. Double-check it.`,
    codes: [rule.code],
  };
}

export interface SectionalRuleContext {
  pieces: SectionalPiece[];
  /** Stroke-measurement values keyed by code (A1, F2, D, …). */
  values: MeasurementValueMap;
}

export interface SectionalMeasurementRuleSet {
  sums: SumRule[];
  equalities: EqualityRule[];
  ranges: RangeRule[];
}

function hasArmOnSide(pieces: SectionalPiece[], side: 'left' | 'right'): boolean {
  return pieces.some(piece => piece.kind === (side === 'left' ? 'left-arm' : 'right-arm'));
}

/**
 * Build the full rule catalog for an assembly. The catalog adapts to the
 * pieces present (arm rules only when arm modules exist, cushion-partition
 * granularity follows the number of seat modules, etc.).
 */
export function buildSectionalMeasurementRules(
  context: SectionalRuleContext
): SectionalMeasurementRuleSet {
  const { pieces, values } = context;
  const seatModules = pieces.filter(piece => piece.kind === 'seat').length;
  const seatCount = Math.max(1, seatModules);
  const hasLeftArm = hasArmOnSide(pieces, 'left');
  const hasRightArm = hasArmOnSide(pieces, 'right');
  const bothArms = hasLeftArm && hasRightArm;
  const anyArm = hasLeftArm || hasRightArm;

  // Cushion width codes C1..C4 — one per seat module (CW convention:
  // C-codes partition the inner seat span).
  const cushionCodes = Array.from({ length: Math.min(4, seatCount) }, (_, i) => `C${i + 1}`);

  // Per-module width codes A3, A4, A5… (A1 = overall, A2 = overall depth;
  // A3+ are the module widths seeded by the builder).
  const moduleWidthCount = Math.min(6, new Set(pieces.map(piece => piece.col)).size);
  const moduleWidthCodes = Array.from({ length: moduleWidthCount }, (_, i) => `A${i + 3}`);

  const sums: SumRule[] = [];
  const equalities: EqualityRule[] = [];
  const ranges: RangeRule[] = [];

  // Overall width = sum of module widths (A1 = A3 + A4 + …). Only when the
  // plan actually has side-by-side modules.
  if (moduleWidthCodes.length >= 2) {
    sums.push({
      ruleId: 'width-partition',
      target: 'A1',
      parts: moduleWidthCodes,
      toleranceCm: 2,
      title: 'Arm-to-arm width vs module widths',
      severity: 'error',
    });
  }

  // Arm-to-arm = inner seat span + arm widths (the B1+F2=G1 family). The
  // exact F/G code depends on the arm style; cover the common mappings.
  if (anyArm) {
    const armWidthCodes = ['F2', 'F4', 'SLA'];
    const innerWidthCodes = ['B1', 'B2'];
    sums.push({
      ruleId: 'arm-compose',
      target: 'A1',
      parts: [...innerWidthCodes, ...(bothArms ? ['F2', 'F2R'] : ['F2'])],
      toleranceCm: 3,
      title: 'Arm-to-arm width vs inner span + arms',
      severity: 'warn',
    });
    void armWidthCodes;
  }

  // Cushion partition: inner seat span B1 = sum of seat cushion widths.
  // (User's "A2 + A4 = total width of the cushions" family: the cushions
  // must fill the seat between the arms.)
  if (cushionCodes.length >= 1) {
    sums.push({
      ruleId: 'cushion-partition',
      target: 'B1',
      parts: cushionCodes,
      toleranceCm: 3,
      title: 'Inner seat span vs cushion widths',
      severity: 'warn',
    });
  }

  // Symmetry: mirrored modules on a symmetric assembly must match.
  const leftArms = pieces.filter(piece => piece.kind === 'left-arm');
  const rightArms = pieces.filter(piece => piece.kind === 'right-arm');
  if (leftArms.length && rightArms.length) {
    equalities.push({
      ruleId: 'arm-symmetry',
      codeGroups: [
        ['F2', 'F2R'],
        ['SLAL', 'SLAR'],
      ],
      toleranceCm: 1,
      title: 'Left/right arm symmetry',
      severity: 'warn',
    });
  }

  // Front vs rear consistency: total width must agree across views.
  equalities.push({
    ruleId: 'front-rear-width',
    codeGroups: [['A1', 'L1']],
    toleranceCm: 2,
    title: 'Front vs rear total width',
    severity: 'warn',
  });

  // Depth consistency: overall depth vs frame depth + back thickness.
  equalities.push({
    ruleId: 'depth-consistency',
    codeGroups: [['A2', 'D']],
    toleranceCm: 3,
    title: 'Overall depth vs frame depth',
    severity: 'info',
  });

  // Plausibility ranges (cm).
  ranges.push(
    {
      ruleId: 'range-A1',
      code: 'A1',
      min: 60,
      max: 500,
      title: 'Overall width plausibility',
      severity: 'warn',
    },
    {
      ruleId: 'range-A2',
      code: 'A2',
      min: 50,
      max: 200,
      title: 'Overall depth plausibility',
      severity: 'warn',
    },
    {
      ruleId: 'range-D',
      code: 'D',
      min: 50,
      max: 130,
      title: 'Frame depth plausibility',
      severity: 'warn',
    },
    {
      ruleId: 'range-B1',
      code: 'B1',
      min: 40,
      max: 300,
      title: 'Inner seat span plausibility',
      severity: 'warn',
    }
  );
  for (const code of cushionCodes) {
    ranges.push({
      ruleId: `range-${code}`,
      code,
      min: 30,
      max: 160,
      title: 'Cushion width plausibility',
      severity: 'warn',
    });
  }
  if (anyArm) {
    ranges.push(
      {
        ruleId: 'range-F2',
        code: 'F2',
        min: 8,
        max: 45,
        title: 'Arm width plausibility',
        severity: 'warn',
      },
      {
        ruleId: 'range-G1',
        code: 'G1',
        min: 50,
        max: 130,
        title: 'Back height plausibility',
        severity: 'warn',
      },
      {
        ruleId: 'range-H1',
        code: 'H1',
        min: 25,
        max: 60,
        title: 'Seat height plausibility',
        severity: 'warn',
      }
    );
  }

  return { sums, equalities, ranges };
}

/**
 * Evaluate the catalog against the entered values. Returns issues sorted
 * error → warn → info, with OK rules omitted.
 */
export function evaluateSectionalMeasurementRules(
  ruleSet: SectionalMeasurementRuleSet,
  values: MeasurementValueMap
): MeasurementRuleIssue[] {
  const severityRank: Record<MeasurementSeverity, number> = { error: 0, warn: 1, info: 2 };
  const issues: MeasurementRuleIssue[] = [];
  ruleSet.sums.forEach(rule => {
    const issue = checkSum(rule, values);
    if (issue) issues.push(issue);
  });
  ruleSet.equalities.forEach(rule => {
    const issue = checkEquality(rule, values);
    if (issue) issues.push(issue);
  });
  ruleSet.ranges.forEach(rule => {
    const issue = checkRange(rule, values);
    if (issue) issues.push(issue);
  });
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return issues;
}

/** Count of filled measurement codes — drives the "ready to submit" hint. */
export function countFilledMeasurements(
  ruleSet: SectionalMeasurementRuleSet,
  values: MeasurementValueMap
): { filled: number; expected: number } {
  const codes = new Set<string>();
  ruleSet.sums.forEach(rule => {
    codes.add(rule.target);
    rule.parts.forEach(code => codes.add(code));
  });
  ruleSet.equalities.forEach(rule =>
    rule.codeGroups.forEach(group => group.forEach(code => codes.add(code)))
  );
  ruleSet.ranges.forEach(rule => codes.add(rule.code));
  const filled = Array.from(codes).filter(code => isFilled(values[code])).length;
  return { filled, expected: codes.size };
}
