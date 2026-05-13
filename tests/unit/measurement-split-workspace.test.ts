import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { StrokeMetadataManager } from '../../src/modules/StrokeMetadataManager.ts';
import {
  initMeasurementSplitWorkspace,
  mountMeasurementSplitStrokePanel,
  openMeasurementSplitWorkspace,
  resetMeasurementSplitWorkspace,
  restoreMeasurementSplitStrokePanel,
  shouldAllowMeasurementSplitEdit,
} from '../../src/modules/ui/measurement-split-workspace';

describe('measurement split workspace', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="main-canvas-wrapper" class="guide-split-active">
        <div id="guideSplitMeasurementEditorHost"></div>
      </div>
      <div id="panelDock">
        <div
          id="strokePanel"
          class="floating-panel collapsed"
          style="position:fixed;left:0;top:48px;height:calc(100% - 128px);"
          aria-expanded="false"
        >
          <div id="elementsBody" class="hidden" style="display:none"></div>
        </div>
      </div>
    `;

    (window as any).app = {
      metadataManager: {
        normalizeImageLabel: (scopeLabel: string) => scopeLabel,
        updateStrokeVisibilityControls: vi.fn(),
      },
      projectManager: {
        currentViewId: 'cw-view',
      },
    };
    window.getGuideSplitStateForView = vi.fn(() => ({ enabled: true }));
    window.setGuideSplitEnabled = vi.fn(() => true);

    initMeasurementSplitWorkspace();
    resetMeasurementSplitWorkspace();
  });

  afterEach(() => {
    resetMeasurementSplitWorkspace();
    document.body.innerHTML = '';
    delete (window as any).app;
    delete window.getGuideSplitStateForView;
    delete window.setGuideSplitEnabled;
  });

  test('allows CW edits only while the measurement workspace is active for the opened view', () => {
    expect(shouldAllowMeasurementSplitEdit('cw-view')).toBe(false);

    openMeasurementSplitWorkspace('cw-view');

    expect(shouldAllowMeasurementSplitEdit('cw-view')).toBe(true);
    expect(shouldAllowMeasurementSplitEdit('other-view')).toBe(false);

    resetMeasurementSplitWorkspace();

    expect(shouldAllowMeasurementSplitEdit('cw-view')).toBe(false);
  });

  test('mounts and restores the stroke panel cleanly', () => {
    const originalParent = document.getElementById('panelDock');
    const host = document.getElementById('guideSplitMeasurementEditorHost');
    const strokePanel = document.getElementById('strokePanel');
    const elementsBody = document.getElementById('elementsBody');

    openMeasurementSplitWorkspace('cw-view');

    expect(mountMeasurementSplitStrokePanel()).toBe(true);
    expect(strokePanel?.parentElement).toBe(host);
    expect(strokePanel?.classList.contains('collapsed')).toBe(false);
    expect(strokePanel?.getAttribute('aria-expanded')).toBe('true');
    expect(elementsBody?.classList.contains('hidden')).toBe(false);

    expect(restoreMeasurementSplitStrokePanel()).toBe(true);
    expect(strokePanel?.parentElement).toBe(originalParent);
    expect(strokePanel?.classList.contains('collapsed')).toBe(true);
    expect(strokePanel?.getAttribute('aria-expanded')).toBe('false');
    expect(strokePanel?.getAttribute('style')).toContain('position:fixed');
    expect(elementsBody?.classList.contains('hidden')).toBe(true);
  });

  test('normalizes invalid live text baselines while mounting the workspace', () => {
    const textObject = {
      textBaseline: 'alphabetical',
      set: vi.fn((key: string, value: string) => {
        if (key === 'textBaseline') {
          textObject.textBaseline = value;
        }
      }),
      setCoords: vi.fn(),
    };
    const requestRenderAll = vi.fn();
    (window as any).app.canvasManager = {
      fabricCanvas: {
        getObjects: () => [textObject],
        requestRenderAll,
      },
    };

    openMeasurementSplitWorkspace('cw-view');
    mountMeasurementSplitStrokePanel();

    expect(textObject.textBaseline).toBe('middle');
    expect(textObject.set).toHaveBeenCalledWith('textBaseline', 'middle');
    expect(requestRenderAll).toHaveBeenCalled();
  });
});

describe('measurement edit cm preservation', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="unitSelector">
        <option value="inch">Inches</option>
        <option value="cm" selected>Centimeters</option>
      </select>
      <div id="strokePanel" aria-expanded="true"></div>
      <div id="elementsBody"></div>
      <div id="strokeVisibilityControls"></div>
    `;

    (window as any).app = {
      projectManager: {
        currentViewId: 'front',
      },
      measurementSystem: {
        parseMeasurementInput: vi.fn(() => ({
          totalInches: 129 / 2.54,
          cm: 129,
        })),
      },
      tagManager: {
        updateTagText: vi.fn(),
      },
      canvasManager: {
        fabricCanvas: null,
      },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as any).app;
  });

  test('keeps the entered cm value instead of recalculating from rounded inches', () => {
    const metadataManager = new StrokeMetadataManager();

    const saved = metadataManager.parseAndSaveMeasurement('front', 'A1', '129');

    expect(saved).toBe(true);
    expect(metadataManager.strokeMeasurements.front.A1.cm).toBe(129);
  });
});
