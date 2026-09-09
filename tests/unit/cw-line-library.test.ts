import { beforeEach, describe, expect, test } from 'vitest';
import {
  buildCwGeometryKey,
  buildReplayPlan,
  captureRecipeFromView,
  decodeCwImageUrl,
  findRecipeForImageUrl,
  hasRecipeForImageUrl,
} from '../../src/modules/ui/cw-line-library';

const FRAME_URL =
  'https://img.comfort-works.com/img/products/ikea/TD/IK-TD-2M/IK-TD-2M__L%28VELC_SP%29_FR_01.png';
const SEAT_URL =
  'https://img.comfort-works.com/img/products/ikea/TD/IK-TD-2M/IK-TD-2M__L%28VELC_SP%29_STCC_01.png';
const SEAT_OTHER_STYLE_URL =
  'https://img.comfort-works.com/img/products/ikea/TD/IK-TD-2M/IK-TD-2M__L%28SHRT_SP%29_STCC_01.png';
const LIFESTYLE_URL =
  'https://img.comfort-works.com/img/products/lifestyle/Lifestyle_179_IKEA_Tylosand_sofa_fb212d.jpg';

function makeMockLine(label: string, x1: number, y1: number, x2: number, y2: number) {
  return {
    type: 'line',
    isZipper: false,
    strokeMetadata: { strokeLabel: label, type: 'line', isVector: true },
    calcLinePoints: () => ({ x1, y1, x2, y2 }),
    calcTransformMatrix: () => [1, 0, 0, 1, 10, 20],
  };
}

function installMockApp() {
  const background = {
    width: 200,
    height: 100,
    calcTransformMatrix: () => [2, 0, 0, 2, 0, 0],
  };
  const strokes = {
    A: makeMockLine('A', 10, 20, 150, 20),
    B: makeMockLine('B', 60, 10, 60, 150),
  };
  (window as any).app = {
    metadataManager: {
      normalizeImageLabel: (label: string) => label,
      vectorStrokesByImage: { 'view-1': strokes },
      getMeasurement: () => ({ cm: 133, inchWhole: 52, inchFraction: 3 }),
      getImportedMeasurementSource: () => ({ sourceLabel: 'Width (A)' }),
    },
    canvasManager: {
      fabricCanvas: {
        backgroundImage: background,
      },
    },
  };
  return { strokes };
}

describe('CW line library geometry keys', () => {
  test('decodes encoded catalogue stems', () => {
    expect(decodeCwImageUrl(`${SEAT_URL}?Expires=123`)).toBe('IK-TD-2M__L(VELC_SP)_STCC_01');
  });

  test('extracts reference, style, component, and sequence', () => {
    const key = buildCwGeometryKey(SEAT_URL);
    expect(key).not.toBeNull();
    expect(key?.reference).toBe('IK-TD-2M');
    expect(key?.styleCode).toBe('VELC_SP');
    expect(key?.component).toBe('STCC');
    expect(key?.sequence).toBe('01');
    expect(key?.exactKey).toBe('IK-TD-2M|VELC_SP|STCC|01');
    expect(key?.looseKey).toBe('IK-TD-2M|STCC|01');
  });

  test('keys stay stable across fabric/colour URL variants', () => {
    const frame = buildCwGeometryKey(FRAME_URL);
    expect(frame?.looseKey).toBe('IK-TD-2M|FR|01');
  });

  test('dash-separated style tokens are stripped from the component', () => {
    const key = buildCwGeometryKey('https://img.comfort-works.com/IK-TD-2M__L_VELC_SP-CVC-01.jpg');
    expect(key?.component).toBe('CVC');
    expect(key?.sequence).toBe('01');
    expect(key?.looseKey).toBe('IK-TD-2M|CVC|01');
  });

  test('non-catalogue photos fall back to the full stem', () => {
    const key = buildCwGeometryKey(LIFESTYLE_URL);
    expect(key?.exactKey).toBe('stem:Lifestyle_179_IKEA_Tylosand_sofa_fb212d');
    expect(key?.reference).toBe('');
  });
});

describe('CW line library capture and replay', () => {
  beforeEach(() => {
    localStorage.clear();
    installMockApp();
  });

  test('captured strokes replay on the same photo geometry', () => {
    const recipe = captureRecipeFromView('view-1', SEAT_URL);
    expect(recipe).not.toBeNull();
    expect(recipe?.key).toBe('IK-TD-2M|VELC_SP|STCC|01');
    expect(recipe?.lines.map(line => line.label)).toEqual(['A', 'B']);
    expect(recipe?.lines[0].value).toBe('133');

    // Normalized endpoints round-trip back to canvas coordinates.
    const plans = buildReplayPlan(SEAT_URL, new Set());
    expect(plans).not.toBeNull();
    expect(plans?.[0].start).toEqual({ x: 20, y: 40 });
    expect(plans?.[0].end).toEqual({ x: 160, y: 40 });
  });

  test('a recipe captured for one style matches a different style of the same component', () => {
    captureRecipeFromView('view-1', SEAT_URL);
    expect(hasRecipeForImageUrl(SEAT_OTHER_STYLE_URL)).toBe(true);
    const recipe = findRecipeForImageUrl(SEAT_OTHER_STYLE_URL);
    expect(recipe?.component).toBe('STCC');
  });

  test('photos without a saved recipe return null', () => {
    captureRecipeFromView('view-1', SEAT_URL);
    expect(hasRecipeForImageUrl(LIFESTYLE_URL)).toBe(false);
    expect(findRecipeForImageUrl(LIFESTYLE_URL)).toBeNull();
    expect(buildReplayPlan(LIFESTYLE_URL, new Set())).toBeNull();
  });

  test('already-used labels are not replayed twice', () => {
    captureRecipeFromView('view-1', SEAT_URL);
    const plans = buildReplayPlan(SEAT_URL, new Set(['A']));
    expect(plans?.map(plan => plan.label)).toEqual(['B']);
  });
});
