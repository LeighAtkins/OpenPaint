import { describe, expect, test } from 'vitest';
import {
  buildSectionalMeasurementRules,
  evaluateSectionalMeasurementRules,
  countFilledMeasurements,
} from '../../src/modules/ui/sectional-measurement-rules';
import {
  applySectionalMeasurementEdit,
  createSectionalPreset,
  getPieceDimensions,
  serializeSectionalProductSvg,
} from '../../src/modules/ui/sectional-builder';

const pieces = createSectionalPreset('sofa');
const rules = buildSectionalMeasurementRules({ pieces });

describe('sectional measurement rules', () => {
  test('clean partition values produce no issues', () => {
    // A1 = A3+A4+A5+A6 (105+90+90+105 = 390), B1 = C1+C2 (matches cushion fit)
    const values = {
      A1: 390,
      A3: 105,
      A4: 90,
      A5: 90,
      A6: 105,
      B1: 150,
      C1: 75,
      C2: 75,
      D: 95,
      A2: 95,
      F2: 22,
    };
    const issues = evaluateSectionalMeasurementRules(rules, values).filter(
      issue => issue.ruleId === 'width-partition' || issue.ruleId === 'cushion-partition'
    );
    expect(issues).toHaveLength(0);
  });

  test('width partition mismatch raises an error with codes and values', () => {
    const values = { A1: 400, A3: 105, A4: 90, A5: 90, A6: 105 };
    const issues = evaluateSectionalMeasurementRules(rules, values);
    const widthIssue = issues.find(issue => issue.ruleId === 'width-partition');
    expect(widthIssue).toBeDefined();
    expect(widthIssue!.severity).toBe('error');
    expect(widthIssue!.message).toContain('A1=400');
    expect(widthIssue!.codes).toContain('A6');
  });

  test('cushion partition flags a seat span that cushions do not fill', () => {
    const values = { B1: 180, C1: 75, C2: 70 };
    const issues = evaluateSectionalMeasurementRules(rules, values);
    const cushionIssue = issues.find(issue => issue.ruleId === 'cushion-partition');
    expect(cushionIssue).toBeDefined();
    expect(cushionIssue!.severity).toBe('warn');
  });

  test('range check flags implausible values', () => {
    const values = { A1: 900 };
    const issues = evaluateSectionalMeasurementRules(rules, values);
    const rangeIssue = issues.find(
      issue => issue.ruleId.startsWith('range-') && issue.codes.includes('A1')
    );
    expect(rangeIssue).toBeDefined();
    expect(rangeIssue!.message).toContain('900');
  });

  test('partial fills do not produce false partition errors', () => {
    // Only one module width filled — not enough parts to judge a partition.
    const values = { A1: 195, A3: 105 };
    const issues = evaluateSectionalMeasurementRules(rules, values);
    expect(issues.find(issue => issue.ruleId === 'width-partition')).toBeUndefined();
  });

  test('counts filled vs expected codes for the submit hint', () => {
    const values = { A1: 390, D: 95 };
    const { filled, expected } = countFilledMeasurements(rules, values);
    expect(filled).toBe(2);
    expect(expected).toBeGreaterThan(filled);
  });
});

describe('editable 2.5D measurements', () => {
  test('applySectionalMeasurementEdit rescales overall width across all pieces', () => {
    const pieces = createSectionalPreset('sofa');
    const changed = applySectionalMeasurementEdit(pieces, 'A1', 468); // 390 × 1.2
    expect(changed).toBe(4);
    const total = pieces.reduce((sum, piece) => sum + getPieceDimensions(piece).width, 0);
    expect(Math.round(total)).toBe(468);
  });

  test('module width code rescales only that column', () => {
    const pieces = createSectionalPreset('sofa');
    const before = getPieceDimensions(pieces[0]).width; // left arm 105
    applySectionalMeasurementEdit(pieces, 'A3', 120); // column 0 → 120
    expect(getPieceDimensions(pieces[0]).width).toBe(120);
    expect(before).toBe(105);
    // Other columns untouched
    expect(getPieceDimensions(pieces[1]).width).toBe(90);
  });

  test('depth code rescales row depth and keeps plan footprint consistent', () => {
    const pieces = createSectionalPreset('sofa');
    applySectionalMeasurementEdit(pieces, 'A2', 120);
    pieces.forEach(piece => {
      expect(getPieceDimensions(piece).depth).toBe(120);
    });
  });

  test('product markup draws dimension annotations with codes', () => {
    const svg = serializeSectionalProductSvg(pieces, 'x', 'front-right');
    expect(svg).toContain('sb-product-dims');
    expect(svg).toContain('A1 · 390 cm');
    expect(svg).toContain('data-code="D"');
    expect(svg).toContain('G1');
    expect(svg).toContain('sb-dim-editable');
  });
});
