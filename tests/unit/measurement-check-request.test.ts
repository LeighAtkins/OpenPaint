import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRadioGroup } from 'pdf-lib';
import { parseSofaPaintReviewPdf } from '../../src/modules/ui/measurement-review';
import {
  buildCheckReviewManifest,
  buildDraftingBundleFiles,
  buildReplyBundleFiles,
  formatCheckValue,
  mergePdfValuesIntoContext,
  parseCheckRequest,
  parseReplyDraft,
  parseValueText,
  planPdfValueSaves,
  resolveCheckRequest,
  resolveValueUnit,
  validateReplyDraft,
  withOnlyLabelsVisible,
  type CheckContext,
  type NormalizedCheckRequest,
} from '../../src/modules/ui/measurement-check-request';

function parseRequest(raw: unknown): NormalizedCheckRequest {
  const result = parseCheckRequest(raw);
  if (!result.ok) throw new Error(result.error);
  return result.request;
}

const baseContext: CheckContext = {
  projectName: 'Keeley armchair',
  views: [
    {
      viewId: 'front',
      title: 'Front without cushions',
      hasImage: true,
      scopes: [
        {
          scopeKey: 'front',
          tabId: null,
          codes: ['A1', 'A2'],
          measurements: {
            A1: { cm: 91.44, inch: 36 },
            A2: { cm: 58.42, inch: 23 },
          },
        },
        {
          scopeKey: 'front::tab:tab-1',
          tabId: 'tab-1',
          codes: ['A4'],
          measurements: { A4: { cm: 78.74, inch: 31 } },
        },
      ],
    },
    {
      viewId: 'cs1l-sa-hb-side',
      title: 'Side',
      hasImage: true,
      scopes: [
        {
          scopeKey: 'cs1l-sa-hb-side',
          tabId: null,
          codes: ['H1', 'H2', 'H3'],
          measurements: {
            H1: { cm: 58.42, inch: 23 },
            H2: { cm: 91.44, inch: 36 },
            H3: {},
          },
        },
      ],
    },
    {
      viewId: 'front_frame',
      title: 'Front frame',
      hasImage: false,
      scopes: [
        {
          scopeKey: 'front_frame',
          tabId: null,
          codes: ['B1'],
          measurements: { B1: { cm: 71.12, inch: 28 } },
        },
      ],
    },
    {
      viewId: 'back',
      title: 'Back',
      hasImage: true,
      scopes: [
        {
          scopeKey: 'back',
          tabId: null,
          codes: ['J1', 'J2', 'L1'],
          measurements: {
            J1: { cm: 68.58, inch: 27 },
            J2: { cm: 68.58, inch: 27 },
          },
        },
      ],
    },
  ],
};

describe('check request schema', () => {
  it('accepts a minimal request', () => {
    const normalized = parseRequest({ pages: [{ view: 'side', codes: ['H1'] }] });
    expect(normalized.unit).toBe('as-entered');
    expect(normalized.output).toEqual({ png: true, pdf: true, zip: false, scale: 2 });
    expect(normalized.pages[0].codes).toEqual(['H1']);
  });

  it('rejects pages without codes', () => {
    const result = parseCheckRequest({ pages: [{ view: 'side', codes: [] }] });
    expect(result.ok).toBe(false);
  });

  it('fails explicitly on unsupported future versions', () => {
    const result = parseCheckRequest({ specVersion: 3, pages: [{ view: 'side', codes: ['H1'] }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('specVersion 3');
  });

  it('requires specVersion 2 for v2-only fields', () => {
    const result = parseCheckRequest({
      pages: [{ view: 'side', codes: ['H1'], questionIds: ['Q1'] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('"specVersion": 2');

    const v2 = parseCheckRequest({
      specVersion: 2,
      pages: [{ view: 'side', codes: ['H1'], questionIds: ['Q1'] }],
    });
    expect(v2.ok).toBe(true);
  });
});

describe('formatCheckValue', () => {
  it('converts stored centimetres to exact inches', () => {
    expect(formatCheckValue({ cm: 29.21, inch: 11.5 }, 'inch')).toBe('11.5"');
    expect(formatCheckValue({ cm: 31.75, inch: 12.5 }, 'inch')).toBe('12.5"');
    expect(formatCheckValue({ cm: 58.42, inch: 23 }, 'inch')).toBe('23"');
    expect(formatCheckValue({ cm: 78.74, inch: 31 }, 'inch')).toBe('31"');
  });

  it('displays centimetres with one decimal', () => {
    expect(formatCheckValue({ cm: 58.42, inch: 23 }, 'cm')).toBe('58.4 cm');
  });

  it('keeps the entered text as-entered and falls back by input unit', () => {
    expect(
      formatCheckValue(
        { cm: 132.08, inch: 52, inputUnit: 'inches', inputValue: '52' },
        'as-entered'
      )
    ).toBe('52');
    expect(formatCheckValue({ cm: 10, inch: 3.937 }, 'as-entered')).toBe('10 cm');
    expect(formatCheckValue({ cm: 10, inch: 3.937, inputUnit: 'inches' }, 'as-entered')).toBe(
      '3.94"'
    );
  });

  it('returns empty for measurements without the target unit', () => {
    expect(formatCheckValue({ cm: 10 }, 'inch')).toBe('');
    expect(formatCheckValue({ inch: 10 }, 'cm')).toBe('');
  });
});

describe('resolveCheckRequest', () => {
  it('matches views by exact id, sanitized id, and title', () => {
    const exact = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'front', codes: ['A1'] }] }),
      baseContext
    );
    expect(exact.pages[0].viewId).toBe('front');

    const sanitized = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'front frame', codes: ['B1'] }] }),
      baseContext
    );
    expect(sanitized.pages[0].viewId).toBe('front_frame');

    const titled = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'side', codes: ['H1'] }] }),
      baseContext
    );
    expect(titled.pages[0].viewId).toBe('cs1l-sa-hb-side');
  });

  it('reports unknown views with the available titles', () => {
    const resolved = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'left', codes: ['H1'] }] }),
      baseContext
    );
    expect(resolved.pages).toHaveLength(0);
    expect(resolved.issues[0].kind).toBe('unknown-view');
    expect(resolved.issues[0].message).toContain('Side');
  });

  it('formats values in the requested unit and builds form field names', () => {
    const resolved = resolveCheckRequest(
      parseRequest({ unit: 'inch', pages: [{ view: 'side', codes: ['H1', 'H2'] }] }),
      baseContext
    );
    expect(resolved.pages[0].rows).toEqual([
      { label: 'H1', value: '23"', fieldName: 'm_cs1l-sa-hb-side_H1' },
      { label: 'H2', value: '36"', fieldName: 'm_cs1l-sa-hb-side_H2' },
    ]);
  });

  it('flags missing codes and codes without a value', () => {
    const resolved = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'side', codes: ['H3', 'X9'] }] }),
      baseContext
    );
    expect(resolved.pages[0].noValueCodes).toEqual(['H3']);
    expect(resolved.pages[0].missingCodes).toEqual(['X9']);
    expect(resolved.issues.map(issue => issue.kind)).toEqual(['no-value', 'missing-code']);
  });

  it('prefers the requested tab and reports unknown tabs', () => {
    const byId = resolveCheckRequest(
      parseRequest({ unit: 'inch', pages: [{ view: 'front', tab: 'tab-1', codes: ['A4'] }] }),
      baseContext
    );
    expect(byId.pages[0].tabId).toBe('tab-1');
    expect(byId.pages[0].rows[0].value).toBe('31"');

    const byIndex = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'front', tab: 0, codes: ['A4'] }] }),
      baseContext
    );
    expect(byIndex.pages[0].tabId).toBe('tab-1');

    const unknown = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'front', tab: 'tab-9', codes: ['A1'] }] }),
      baseContext
    );
    expect(unknown.issues[0].kind).toBe('unknown-tab');
  });

  it('captures on a tab scope when codes only exist there', () => {
    const resolved = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'front', codes: ['A4'] }] }),
      baseContext
    );
    expect(resolved.pages[0].tabId).toBe('tab-1');
  });

  it('keeps the base view as capture target when codes live on the base scope', () => {
    const resolved = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'front', codes: ['A1'] }] }),
      baseContext
    );
    expect(resolved.pages[0].tabId).toBeNull();
  });

  it('reports ambiguous values across scopes and uses the first', () => {
    const context: CheckContext = {
      projectName: 'test',
      views: [
        {
          viewId: 'front',
          title: 'Front',
          hasImage: true,
          scopes: [
            {
              scopeKey: 'front',
              tabId: null,
              codes: ['A4'],
              measurements: { A4: { cm: 80.01, inch: 31.5 } },
            },
            {
              scopeKey: 'front::tab:tab-1',
              tabId: 'tab-1',
              codes: ['A4'],
              measurements: { A4: { cm: 78.74, inch: 31 } },
            },
          ],
        },
      ],
    };
    const resolved = resolveCheckRequest(
      parseRequest({ unit: 'inch', pages: [{ view: 'front', codes: ['A4'] }] }),
      context
    );
    expect(resolved.issues.some(issue => issue.kind === 'ambiguous-value')).toBe(true);
    expect(resolved.pages[0].rows[0].value).toBe('31.5"');
  });
});

describe('mergePdfValuesIntoContext', () => {
  it('overrides entered values from a SofaPaint PDF manifest', () => {
    const merged = mergePdfValuesIntoContext(baseContext, {
      views: [{ viewId: 'side', title: 'Side', measurements: [{ label: 'H1', value: '92 cm' }] }],
    });
    const resolved = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'side', codes: ['H1'] }] }),
      merged
    );
    expect(resolved.pages[0].rows[0].value).toBe('92 cm');
  });

  it('creates parseable synthetic measurements for codes without strokes', () => {
    const merged = mergePdfValuesIntoContext(baseContext, {
      views: [{ viewId: 'side', title: 'Side', measurements: [{ label: 'H9', value: '38 in' }] }],
    });
    const asEntered = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'side', codes: ['H9'] }] }),
      merged
    );
    expect(asEntered.pages[0].rows[0].value).toBe('38 in');

    const inches = resolveCheckRequest(
      parseRequest({ unit: 'inch', pages: [{ view: 'side', codes: ['H9'] }] }),
      merged
    );
    expect(inches.pages[0].rows[0].value).toBe('38"');
  });
});

describe('withOnlyLabelsVisible', () => {
  it('shows only the requested measurement groups and restores everything', async () => {
    const objects = [
      { testId: 'line-A1', strokeMetadata: { strokeLabel: 'A1' }, visible: true },
      { testId: 'tag-A1', isTagGroup: true, strokeMetadata: { strokeLabel: 'A1' }, visible: true },
      { testId: 'line-H3', strokeMetadata: { strokeLabel: 'H3' }, visible: true },
      {
        testId: 'connector-H3',
        isConnectorLine: true,
        strokeMetadata: { strokeLabel: 'H3' },
        visible: true,
      },
      { testId: 'free-text', text: 'sticky note', visible: true },
    ];
    let renders = 0;
    const canvas = {
      getObjects: () => objects,
      requestRenderAll: () => {
        renders += 1;
      },
    };

    let during: Record<string, boolean> = {};
    await withOnlyLabelsVisible(canvas, ['A1'], () => {
      during = Object.fromEntries(objects.map(obj => [obj.testId, obj.visible !== false]));
      return 'captured';
    });

    expect(during).toEqual({
      'line-A1': true,
      'tag-A1': true,
      'line-H3': false,
      'connector-H3': false,
      'free-text': true,
    });
    expect(renders).toBeGreaterThan(0);

    expect(objects.map(obj => obj.visible)).toEqual([true, true, true, true, true]);
    expect(objects[4].text).toBe('sticky note');
  });

  it('runs the callback unchanged for an empty label set', async () => {
    const canvas = { getObjects: () => [] };
    await expect(withOnlyLabelsVisible(canvas, [], () => 'done')).resolves.toBe('done');
  });
});

describe('planPdfValueSaves', () => {
  it('writes each value to the scope that knows the label, base scope preferred', () => {
    const plan = planPdfValueSaves(baseContext, {
      views: [
        {
          viewId: 'front',
          title: 'Front without cushions',
          measurements: [
            { label: 'A1', value: '91.44 cm' },
            { label: 'A4', value: '31 in' },
            { label: 'Z9', value: '10 cm' },
          ],
        },
      ],
    });

    expect(plan.unmatchedPdfViews).toHaveLength(0);
    const byLabel = Object.fromEntries(plan.entries.map(entry => [entry.label, entry]));
    expect(byLabel.A1.scopeKey).toBe('front');
    expect(byLabel.A4.scopeKey).toBe('front::tab:tab-1');
    expect(byLabel.Z9.scopeKey).toBe('front');
    expect(byLabel.A1.valueText).toBe('91.44 cm');
    expect(plan.matchedViews).toEqual([
      { viewId: 'front', title: 'Front without cushions', count: 3 },
    ]);
  });

  it('flags overwrites and skips empty values', () => {
    const plan = planPdfValueSaves(baseContext, {
      views: [
        {
          viewId: 'side',
          title: 'Side',
          measurements: [
            { label: 'H1', value: '60 cm' },
            { label: 'H3', value: '31 in' },
            { label: 'H2', value: '   ' },
          ],
        },
      ],
    });
    expect(plan.entries).toHaveLength(2);
    const byLabel = Object.fromEntries(plan.entries.map(entry => [entry.label, entry]));
    expect(byLabel.H1.hadValue).toBe(true);
    expect(byLabel.H3.hadValue).toBe(false);
  });

  it('reports PDF views with no matching project view', () => {
    const plan = planPdfValueSaves(baseContext, {
      views: [{ viewId: 'arm', title: 'Arm', measurements: [{ label: 'E1', value: '29.21 cm' }] }],
    });
    expect(plan.entries).toHaveLength(0);
    expect(plan.matchedViews).toHaveLength(0);
    expect(plan.unmatchedPdfViews).toEqual([{ viewId: 'arm', title: 'Arm', count: 1 }]);
  });

  it('targets the view id itself when the project view has no scopes yet', () => {
    const context: CheckContext = {
      projectName: 'empty',
      views: [{ viewId: 'back', title: 'Back', hasImage: true, scopes: [] }],
    };
    const plan = planPdfValueSaves(context, {
      views: [{ viewId: 'back', title: 'Back', measurements: [{ label: 'G1', value: '45 cm' }] }],
    });
    expect(plan.entries[0].scopeKey).toBe('back');
    expect(plan.entries[0].hadValue).toBe(false);
  });
});

describe('resolveValueUnit', () => {
  it('lets an explicit suffix win over the detected PDF unit', () => {
    expect(resolveValueUnit('52 cm', 'inch')).toBe('cm');
    expect(resolveValueUnit('38 in', 'cm')).toBe('inches');
    expect(resolveValueUnit('24"', 'cm')).toBe('inches');
  });

  it('falls back to the detected PDF unit for bare numbers', () => {
    expect(resolveValueUnit('83.75', 'inch')).toBe('inches');
    expect(resolveValueUnit('83.75', 'cm')).toBe('cm');
    expect(resolveValueUnit('83.75', null)).toBe('cm');
  });
});

describe('PDF unit detection', () => {
  it('reads the unit radio toggles from a SofaPaint PDF', async () => {
    const buildPdf = async (selections: Array<'inch' | 'cm' | null>) => {
      const pdf = await PDFDocument.create();
      const form = pdf.getForm();
      const manifest = {
        version: 1,
        projectName: 'Unit test',
        views: [{ viewId: 'front', title: 'Front', measurements: [{ label: 'A1', value: '' }] }],
      };
      for (const [index, selection] of selections.entries()) {
        const page = pdf.addPage([200, 200]);
        const radio = form.createRadioGroup(`unit_measurement_${index + 1}`);
        radio.addOptionToPage('inch', page, { x: 10, y: 10, width: 40, height: 20 });
        radio.addOptionToPage('cm', page, { x: 60, y: 10, width: 40, height: 20 });
        if (selection) radio.select(selection);
      }
      pdf.setSubject(`SOFAPAINT_REVIEW_V1:${JSON.stringify(manifest)}`);
      return parseSofaPaintReviewPdf(await pdf.save());
    };

    const inches = await buildPdf(['inch', 'inch']);
    expect(inches.unit).toBe('inch');

    const cm = await buildPdf(['cm']);
    expect(cm.unit).toBe('cm');

    const ambiguous = await buildPdf(['inch', 'cm']);
    expect(ambiguous.unit).toBeNull();

    const none = await buildPdf([null]);
    expect(none.unit).toBeNull();
  });
});

describe('mergePdfValuesIntoContext with detected unit', () => {
  it('treats bare PDF values as inches when the PDF says inch', () => {
    const merged = mergePdfValuesIntoContext(baseContext, {
      unit: 'inch',
      views: [{ viewId: 'side', title: 'Side', measurements: [{ label: 'H1', value: '23' }] }],
    });
    const asEntered = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'side', codes: ['H1'] }] }),
      merged
    );
    expect(asEntered.pages[0].rows[0].value).toBe('23');

    const cmDisplay = resolveCheckRequest(
      parseRequest({ unit: 'cm', pages: [{ view: 'side', codes: ['H1'] }] }),
      merged
    );
    expect(cmDisplay.pages[0].rows[0].value).toBe('58.4 cm');
  });
});

describe('parseValueText (customer notation)', () => {
  it('normalizes curly quotes and keeps fractional inches intact', () => {
    expect(parseValueText('21 1/2”')).toEqual({ numericText: '21 1/2"', unit: 'inches', note: '' });
    expect(parseValueText('89 1/4”')).toEqual({ numericText: '89 1/4"', unit: 'inches', note: '' });
  });

  it('keeps trailing customer notes separate from the value', () => {
    expect(parseValueText('14”  (13” to floor)')).toEqual({
      numericText: '14"',
      unit: 'inches',
      note: '(13" to floor)',
    });
    expect(parseValueText('27” (26” to floor)').note).toBe('(26" to floor)');
  });

  it('treats bare numbers as unitless and plain suffixes as before', () => {
    expect(parseValueText('83.75')).toEqual({ numericText: '83.75', unit: null, note: '' });
    expect(parseValueText('52 cm')).toEqual({ numericText: '52 cm', unit: 'cm', note: '' });
  });

  it('resolves fractional bare numbers against the PDF unit', () => {
    expect(resolveValueUnit('21 1/2”', 'inch')).toBe('inches');
    expect(resolveValueUnit('21 1/2”', null)).toBe('inches');
  });
});

describe('multiple frames in one PDF', () => {
  const frameManifest = {
    unit: 'inch',
    views: [
      {
        viewId: 'img-5816',
        title: 'Cushions Only - Frame 1',
        measurements: [
          { label: 'A', value: '81 1/2”' },
          { label: 'C', value: '32”' },
        ],
      },
      {
        viewId: 'img-5816',
        title: 'Cushions Only - Frame 2',
        measurements: [
          { label: 'A', value: '34 1/2”' },
          { label: 'C', value: '25”' },
        ],
      },
    ],
  };

  it('routes frame 2 values to the second scope instead of overwriting frame 1', () => {
    const context: CheckContext = {
      projectName: 'frames',
      views: [
        {
          viewId: 'img-5816',
          title: 'Cushions Only',
          hasImage: true,
          scopes: [
            { scopeKey: 'img-5816', tabId: null, codes: ['A', 'C'], measurements: {} },
            {
              scopeKey: 'img-5816::tab:tab-2',
              tabId: 'tab-2',
              codes: ['A', 'C'],
              measurements: {},
            },
          ],
        },
      ],
    };
    const plan = planPdfValueSaves(context, frameManifest);
    const byScopeLabel = Object.fromEntries(
      plan.entries.map(entry => [`${entry.scopeKey}|${entry.label}`, entry.valueText])
    );
    expect(byScopeLabel['img-5816|A']).toBe('81 1/2”');
    expect(byScopeLabel['img-5816|C']).toBe('32”');
    expect(byScopeLabel['img-5816::tab:tab-2|A']).toBe('34 1/2”');
    expect(byScopeLabel['img-5816::tab:tab-2|C']).toBe('25”');
    expect(plan.warnings).toHaveLength(0);
  });

  it('warns instead of overwriting when the project has fewer frames than the PDF', () => {
    const context: CheckContext = {
      projectName: 'frames',
      views: [
        {
          viewId: 'img-5816',
          title: 'Cushions Only',
          hasImage: true,
          scopes: [{ scopeKey: 'img-5816', tabId: null, codes: ['A', 'C'], measurements: {} }],
        },
      ],
    };
    const plan = planPdfValueSaves(context, frameManifest);
    expect(plan.entries.map(entry => entry.scopeKey)).toEqual(['img-5816', 'img-5816']);
    expect(plan.entries.map(entry => entry.valueText)).toEqual(['81 1/2”', '32”']);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('Frame 2');
  });

  it('merges frame-aware values for validation previews', () => {
    const merged = mergePdfValuesIntoContext(baseContext, {
      unit: 'inch',
      views: [
        {
          viewId: 'front',
          title: 'Front',
          measurements: [{ label: 'A1', value: '36”' }],
        },
        {
          viewId: 'front',
          title: 'Front — Frame 2',
          measurements: [{ label: 'A1', value: '40 1/2”' }],
        },
      ],
    });
    const front = merged.views.find(view => view.viewId === 'front');
    const baseMeasurement = front.scopes.find(scope => scope.scopeKey === 'front').measurements.A1;
    const tabScope = front.scopes.find(scope => scope.scopeKey === 'front::tab:tab-1');
    expect(baseMeasurement.inch).toBe(36);
    expect(tabScope.measurements.A1.inch).toBe(40.5);
  });
});

describe('v2 frames', () => {
  it('selects a frame by index and by tab id', () => {
    const byIndex = resolveCheckRequest(
      parseRequest({
        specVersion: 2,
        pages: [{ view: 'front', frame: 1, codes: ['A4'] }],
      }),
      baseContext
    );
    expect(byIndex.pages[0].tabId).toBe('tab-1');
    expect(byIndex.pages[0].frameLabel).toBe('f2');
    expect(byIndex.pages[0].scopeKey).toBe('front::tab:tab-1');

    const byId = resolveCheckRequest(
      parseRequest({
        specVersion: 2,
        pages: [{ view: 'front', frame: 'tab-1', codes: ['A4'] }],
      }),
      baseContext
    );
    expect(byId.pages[0].tabId).toBe('tab-1');
  });

  it('reports unknown frames', () => {
    const resolved = resolveCheckRequest(
      parseRequest({
        specVersion: 2,
        pages: [{ view: 'front', frame: 5, codes: ['A1'] }],
      }),
      baseContext
    );
    expect(resolved.issues[0].kind).toBe('unknown-frame');
  });

  it('warns for v1 requests whose codes span multiple frames, and is fatal for v2', () => {
    const v1 = resolveCheckRequest(
      parseRequest({ pages: [{ view: 'front', codes: ['A1', 'A4'] }] }),
      baseContext
    );
    const v1Issue = v1.issues.find(issue => issue.kind === 'ambiguous-frame');
    expect(v1Issue).toBeTruthy();
    expect(v1.pages[0].frameLabel).toBe('f1');

    const v2 = resolveCheckRequest(
      parseRequest({
        specVersion: 2,
        pages: [{ view: 'front', codes: ['A1', 'A4'] }],
      }),
      baseContext
    );
    expect(v2.issues.some(issue => issue.kind === 'ambiguous-frame')).toBe(true);
  });

  it('carries questionIds and questions through resolution', () => {
    const resolved = resolveCheckRequest(
      parseRequest({
        specVersion: 2,
        questions: [{ id: 'Q3', text: 'Which height should we use?' }],
        pages: [{ view: 'back', codes: ['J1'], questionIds: ['Q3'] }],
      }),
      baseContext
    );
    expect(resolved.questions).toEqual([{ id: 'Q3', text: 'Which height should we use?' }]);
    expect(resolved.pages[0].questionIds).toEqual(['Q3']);
  });
});

describe('drafting + reply bundles', () => {
  const resolved = resolveCheckRequest(
    parseRequest({
      specVersion: 2,
      title: 'Bradford checks',
      questions: [{ id: 'Q1', text: 'Could you recheck J1 and J2?' }],
      pages: [{ view: 'back', codes: ['J1', 'J2'], questionIds: ['Q1'] }],
    }),
    baseContext
  );
  const request = parseRequest({
    specVersion: 2,
    title: 'Bradford checks',
    questions: [{ id: 'Q1', text: 'Could you recheck J1 and J2?' }],
    pages: [{ view: 'back', codes: ['J1', 'J2'], questionIds: ['Q1'] }],
  });
  const captures = [
    {
      pageIndex: 0,
      viewId: 'back',
      viewTitle: 'Back',
      scopeKey: 'back',
      tabId: null,
      frameLabel: 'f1',
      codes: ['J1', 'J2'],
      questionIds: ['Q1'],
      pngName: 'qQ1-back.png',
      pngBlob: new Blob(['png-bytes'], { type: 'image/png' }),
    },
  ];

  it('builds a complete drafting bundle with notes and a GPT skeleton', () => {
    const files = buildDraftingBundleFiles({
      resolved,
      request,
      captures,
      productionNotes: 'Ivy: check J1/J2 heights',
      catalogue: { views: [] },
      notes: { 'back|J1': 'cover 27", floor 26"' },
      createdIso: '2026-09-15T00:00:00.000Z',
    });
    const paths = files.map(file => file.path);
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('context/catalogue.json');
    expect(paths).toContain('context/production.json');
    expect(paths).toContain('context/measurements.json');
    expect(paths).toContain('selection/request.json');
    expect(paths).toContain('selection/questions.json');
    expect(paths).toContain('reply/skeleton.txt');
    expect(paths).toContain('images/qQ1-back.png');

    const manifest = JSON.parse(files.find(file => file.path === 'manifest.json').text!);
    expect(manifest.bundleType).toBe('sofapaint-drafting');
    expect(manifest.completeness).toBe('complete');
    expect(manifest.case).toBeNull();

    const measurements = JSON.parse(
      files.find(file => file.path === 'context/measurements.json').text!
    );
    expect(measurements.pages[0].rows[0].note).toBe('cover 27", floor 26"');

    const skeleton = files.find(file => file.path === 'reply/skeleton.txt').text!;
    expect(skeleton).toContain('1. Could you recheck J1 and J2?');
    expect(skeleton).toContain('images/qQ1-back.png');
  });

  it('validates reply drafts against the request questions', () => {
    const good = parseReplyDraft('1. Could you please recheck J1 and J2?\n\nThanks!');
    expect(validateReplyDraft(good, resolved, captures).ok).toBe(true);

    const empty = validateReplyDraft([], resolved, captures);
    expect(empty.ok).toBe(false);

    const mismatch = validateReplyDraft(
      parseReplyDraft('1. One point\n2. Two points'),
      resolved,
      captures
    );
    expect(mismatch.ok).toBe(false);
  });

  it('builds a reply bundle with real image bytes and a question→image manifest', () => {
    const points = parseReplyDraft('1. Could you please recheck J1 and J2 against the arrows?');
    const files = buildReplyBundleFiles({
      resolved,
      request,
      captures,
      points,
      internalNotes: 'Production wants the cover-vs-floor decision.',
      createdIso: '2026-09-15T00:00:00.000Z',
    });
    const paths = files.map(file => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'reply/email.txt',
        'reply/email.html',
        'reply/manifest.json',
        'images/qQ1-back.png',
      ])
    );

    const manifest = JSON.parse(files.find(file => file.path === 'reply/manifest.json').text!);
    expect(manifest.bundleType).toBe('sofapaint-reply');
    expect(manifest.points[0].questionIds).toEqual(['Q1']);
    expect(manifest.points[0].images).toEqual(['images/qQ1-back.png']);

    const html = files.find(file => file.path === 'reply/email.html').text!;
    expect(html).toContain('<img src="images/qQ1-back.png"');
    expect(html).toContain('Could you please recheck J1 and J2 against the arrows?');
  });
});

describe('check PDF manifest round-trip', () => {
  it('produces a manifest that parseSofaPaintReviewPdf reads back', async () => {
    const resolved = resolveCheckRequest(
      parseRequest({ unit: 'inch', pages: [{ view: 'side', codes: ['H1', 'H2'] }] }),
      baseContext
    );
    const manifest = buildCheckReviewManifest(resolved);

    const pdf = await PDFDocument.create();
    pdf.addPage([400, 400]);
    pdf.setSubject(`SOFAPAINT_REVIEW_V1:${JSON.stringify(manifest)}`);

    const parsed = await parseSofaPaintReviewPdf(await pdf.save());
    expect(parsed.projectName).toBe('Keeley armchair');
    expect(parsed.views).toHaveLength(1);
    expect(parsed.views[0].viewId).toBe('cs1l-sa-hb-side');
    expect(parsed.views[0].measurements).toEqual([
      { label: 'H1', value: '23"' },
      { label: 'H2', value: '36"' },
    ]);
  });
});
