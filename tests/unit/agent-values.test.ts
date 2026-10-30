import { describe, expect, it } from 'vitest';
import { readProjectLines } from '../../src/modules/agent/agent-geometry';
import { placeLabels } from '../../src/modules/agent/agent-labels';
import {
  setMeasurementValue,
  showAllLines,
  valueScopes,
} from '../../src/modules/agent/agent-values';

const clone = (o: unknown) => JSON.parse(JSON.stringify(o ?? {}));
const FRAME = 'front::tab:tab-2';

/**
 * A fake SofaPaint that switches views the way the real one does: the open
 * view's live values are saved into its view state, then the target view's
 * saved state replaces whatever the live maps held for it.
 */
function fakeApp() {
  const views: Record<string, any> = {
    front: {
      metadata: {
        strokeMeasurements: {
          front: { A1: { inch: 61.5 }, C4: { inch: 8.5 } },
          [FRAME]: { C4: { inch: 8.5 } },
        },
        vectorStrokesByImage: { [FRAME]: { C4: {} } },
        strokeVisibilityByImage: { front: { A1: false, C4: true } },
      },
    },
    back: {
      metadata: {
        strokeMeasurements: { back: { J1: { inch: 27.75 } } },
        strokeVisibilityByImage: { back: { J1: false } },
      },
    },
  };
  const live: Record<string, any> = {
    strokeMeasurements: clone(views.back.metadata.strokeMeasurements),
    vectorStrokesByImage: {},
    strokeVisibilityByImage: clone(views.back.metadata.strokeVisibilityByImage),
  };
  const ownScopes = (viewId: string) =>
    Object.keys(live.strokeMeasurements).filter(s => s === viewId || s.startsWith(`${viewId}::`));
  const projectManager = {
    views,
    currentViewId: 'back',
    isSwitchingView: false,
    async switchView(target: string) {
      const current = projectManager.currentViewId;
      views[current].metadata.strokeMeasurements = Object.fromEntries(
        ownScopes(current).map(s => [s, clone(live.strokeMeasurements[s])])
      );
      for (const [scope, bucket] of Object.entries(views[target].metadata.strokeMeasurements)) {
        live.strokeMeasurements[scope] = clone(bucket);
      }
      Object.assign(live.vectorStrokesByImage, clone(views[target].metadata.vectorStrokesByImage));
      projectManager.currentViewId = target;
    },
  };
  const metadataManager = {
    ...live,
    parseAndSaveMeasurement(scope: string, label: string, text: string) {
      const inch = parseFloat(text);
      live.strokeMeasurements[scope] ||= {};
      live.strokeMeasurements[scope][label] = { inch, cm: inch * 2.54 };
      return true;
    },
  };
  metadataManager.strokeMeasurements = live.strokeMeasurements;
  metadataManager.vectorStrokesByImage = live.vectorStrokesByImage;
  metadataManager.strokeVisibilityByImage = live.strokeVisibilityByImage;
  return { projectManager, metadataManager, live, views };
}

describe('agent setValue', () => {
  it('keeps a value set on a view that was not open', async () => {
    const app = fakeApp();
    await setMeasurementValue(app, 'front', 'A1', 62);
    await app.projectManager.switchView('back');
    await app.projectManager.switchView('front');
    expect(app.live.strokeMeasurements.front.A1.inch).toBe(62);
    expect(app.live.strokeMeasurements.front.C4.inch).toBe(8.5);
  });

  it('writes the frame copy of a hand-drawn line too', async () => {
    const app = fakeApp();
    expect(valueScopes(clone(app.views.front.metadata), 'front', 'C4')).toEqual(['front', FRAME]);
    await setMeasurementValue(app, 'front', 'C4', 8);
    await app.projectManager.switchView('back');
    await app.projectManager.switchView('front');
    expect(app.live.strokeMeasurements.front.C4.inch).toBe(8);
    expect(app.live.strokeMeasurements[FRAME].C4.inch).toBe(8);
  });

  it('reports the exported value and flags copies that disagree', () => {
    const app = fakeApp();
    const project = {
      viewOrder: ['front'],
      views: {
        front: {
          canvasJSON: {
            backgroundImage: {
              left: 50,
              top: 50,
              width: 100,
              height: 100,
              originX: 'center',
              originY: 'center',
            },
          },
          metadata: {
            ...app.views.front.metadata,
            strokeMeasurements: {
              front: { C4: { inch: 8 } },
              [FRAME]: { C4: { inch: 8.5 } },
            },
            vectorStrokesByImage: {
              [FRAME]: { C4: { type: 'line', left: 50, top: 50, x1: 0, y1: -10, x2: 0, y2: 10 } },
            },
          },
        },
      },
    };
    const [c4] = readProjectLines(project)[0].lines;
    expect(c4.inch).toBe(8.5);
    expect(c4.valueConflict).toEqual([
      { scope: 'front', inch: 8 },
      { scope: FRAME, inch: 8.5 },
    ]);
  });
});

describe('agent showLines', () => {
  it('shows hidden lines in the live maps and saved views', () => {
    const app = fakeApp();
    expect(showAllLines(app)).toEqual(['back:J1', 'front:A1']);
    expect(app.live.strokeVisibilityByImage.back.J1).toBe(true);
    expect(app.views.front.metadata.strokeVisibilityByImage.front.A1).toBe(true);
  });
});

describe('agent label placement', () => {
  const onLine = (r: any, a: any, b: any) => {
    const cx = r.x0 + r.w / 2;
    const cy = r.y0 + r.h / 2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.abs((b.x - a.x) * (a.y - cy) - (a.x - cx) * (b.y - a.y)) / len;
  };

  it('keeps each label on its own line without overlaps', () => {
    // Close parallel lines crossed by a vertical one, like a sofa back view.
    const lines = [
      { a: { x: 50, y: 300 }, b: { x: 850, y: 296 } },
      { a: { x: 20, y: 360 }, b: { x: 860, y: 352 } },
      { a: { x: 60, y: 430 }, b: { x: 850, y: 420 } },
      { a: { x: 450, y: 260 }, b: { x: 450, y: 640 } },
    ];
    const rects = placeLabels(
      lines.map(l => ({ ...l, w: 170, h: 44 })),
      { width: 900, height: 700 }
    );
    rects.forEach((r, i) => expect(onLine(r, lines[i].a, lines[i].b)).toBeLessThan(2));
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const apart =
          a.x0 + a.w <= b.x0 || b.x0 + b.w <= a.x0 || a.y0 + a.h <= b.y0 || b.y0 + b.h <= a.y0;
        expect(apart).toBe(true);
      }
    }
  });

  it('keeps labels apart on short crowded lines', () => {
    // Four short edges around one corner, like the back-top depths F1 to F4.
    const lines = [
      { a: { x: 400, y: 180 }, b: { x: 470, y: 190 } },
      { a: { x: 470, y: 60 }, b: { x: 470, y: 190 } },
      { a: { x: 430, y: 55 }, b: { x: 470, y: 60 } },
      { a: { x: 430, y: 55 }, b: { x: 400, y: 180 } },
    ];
    const rects = placeLabels(
      lines.map(l => ({ ...l, w: 240, h: 40 })),
      { width: 900, height: 420 }
    );
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const apart =
          a.x0 + a.w <= b.x0 || b.x0 + b.w <= a.x0 || a.y0 + a.h <= b.y0 || b.y0 + b.h <= a.y0;
        expect(apart).toBe(true);
      }
    }
  });
});
