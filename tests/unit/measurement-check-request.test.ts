import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { parseSofaPaintReviewPdf } from '../../src/modules/ui/measurement-review';
import {
  buildCheckReviewManifest,
  checkRequestSchema,
  formatCheckValue,
  mergePdfValuesIntoContext,
  normalizeCheckRequest,
  planPdfValueSaves,
  resolveCheckRequest,
  withOnlyLabelsVisible,
  type CheckContext,
} from '../../src/modules/ui/measurement-check-request';

function parseRequest(raw: unknown) {
  return normalizeCheckRequest(checkRequestSchema.parse(raw));
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
    const result = checkRequestSchema.safeParse({ pages: [{ view: 'side', codes: [] }] });
    expect(result.success).toBe(false);
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
