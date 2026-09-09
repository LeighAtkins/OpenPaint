import { describe, expect, test } from 'vitest';
import {
  filterCwWorkspaceRows,
  findNextCwWorkspaceRow,
  hasCwWorkspaceSeedChanged,
  resolveCwWorkspaceDrawRow,
  resolveCwWorkspaceQueueRow,
  resolveCwScopedArmedRowKey,
  resolveCwWorkspaceNextTag,
  seedCwMeasurementEntry,
  isCwOverallDimensionRow,
  resolveNextAvailableCwLabel,
  extractRows,
  isCwConfigurationSelectionReady,
} from '../../src/modules/ui/cw-import-ui';

describe('CW import measurement draw queue', () => {
  test('product variants remain blocked until configuration and style are explicitly selected', () => {
    const result = {
      versionOptions: [{ code: 'L' }, { code: 'R' }],
      styleOptions: [{ style: 'Signature' }],
      selectedVersionCode: '',
      selectedStyleKey: '',
    };

    expect(isCwConfigurationSelectionReady(result)).toBe(false);
    result.selectedVersionCode = 'L';
    expect(isCwConfigurationSelectionReady(result)).toBe(false);
    result.selectedStyleKey = 'IK-X||Signature||VELC_SP';
    expect(isCwConfigurationSelectionReady(result)).toBe(true);
  });

  test('a base product with no variants can load without invented selections', () => {
    expect(
      isCwConfigurationSelectionReady({
        versionOptions: [],
        styleOptions: [],
        selectedVersionCode: '',
        selectedStyleKey: '',
      })
    ).toBe(true);
  });

  test('extracts CW40 component measurement arrays into visible rows', () => {
    const rows = extractRows({
      qcMeasurements: {
        data: {
          product_components: [
            {
              name: 'Frame Cover',
              measurements: [
                {
                  name: 'Front panel width',
                  translations: { en: 'Front panel width' },
                  value: 180.5,
                  unit: 'cm',
                },
                {
                  name: 'Front panel height',
                  translations: { en: 'Front panel height' },
                  value: 32.5,
                  unit: 'cm',
                },
              ],
            },
          ],
        },
      },
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: 'Front panel width',
          value: '180.5',
          sectionName: 'Frame Cover',
        }),
        expect.objectContaining({
          sourceLabel: 'Front panel height',
          value: '32.5',
          sectionName: 'Frame Cover',
        }),
      ])
    );
  });
  test('the bound row label wins over stale visible and calculated tags', () => {
    expect(
      resolveCwWorkspaceNextTag({
        scopeKeys: ['front::tab:frame-1', 'front'],
        guideTags: { 'front::tab:frame-1': 'A4' },
        labelTags: { front: 'A4' },
        displayTag: 'A1',
        calculatedTag: 'A1',
      })
    ).toBe('A4');
  });

  test('a manual row edit remains authoritative over an imported guide seed', () => {
    expect(
      resolveCwWorkspaceNextTag({
        scopeKeys: ['front'],
        manualTags: { front: 'Z9' },
        guideTags: { front: 'A4' },
        displayTag: 'A1',
      })
    ).toBe('Z9');
  });

  test('a later duplicate label cannot overwrite the ready row measurement', () => {
    const store: Record<string, any> = {};
    expect(seedCwMeasurementEntry(store, 'A4', { value: '180.5' })).toBe(true);
    expect(seedCwMeasurementEntry(store, 'A4', { value: '103.5' })).toBe(false);
    expect(store.A4.value).toBe('180.5');
  });

  test('an imported photo only exposes rows from its exact CW item and section', () => {
    const rows = [
      {
        rowKey: 'chair::front-width',
        itemKey: 'chair',
        sectionName: 'Frame Cover',
        value: '180.5',
      },
      {
        rowKey: 'cushion::front-width',
        itemKey: 'cushion',
        sectionName: 'Seat Cushion Cover',
        value: '103.5',
      },
      { rowKey: 'chair::depth', itemKey: 'chair', sectionName: 'Frame Cover', value: '88' },
    ];

    expect(
      filterCwWorkspaceRows(rows, {
        itemKey: 'chair',
        sectionName: 'Frame Cover',
      }).map(row => row.rowKey)
    ).toEqual(['chair::front-width', 'chair::depth']);
  });

  test('the exact ready row wins when duplicate labels carry different values', () => {
    const rows = [
      { rowKey: 'frame::a4', targetLabel: 'A4', value: '180.5' },
      { rowKey: 'cushion::a4', targetLabel: 'A4', value: '103.5' },
    ];

    expect(
      resolveCwWorkspaceDrawRow({ rows, readyRowKey: 'frame::a4', strokeLabel: 'A4' })
    ).toMatchObject({ rowKey: 'frame::a4', value: '180.5' });
  });

  test('an ambiguous label is never guessed when no exact row is ready', () => {
    const rows = [
      { rowKey: 'frame::a4', targetLabel: 'A4', value: '180.5' },
      { rowKey: 'cushion::a4', targetLabel: 'A4', value: '103.5' },
    ];

    expect(resolveCwWorkspaceDrawRow({ rows, strokeLabel: 'A4' })).toBeNull();
  });

  test('cushion progression skips duplicate mapped labels instead of inventing C', () => {
    const rows = [
      { rowKey: 'width-top', targetLabel: 'A' },
      { rowKey: 'width-bottom', targetLabel: 'B' },
      { rowKey: 'height', targetLabel: 'B' },
      { rowKey: 'thickness', targetLabel: 'D' },
    ];

    expect(findNextCwWorkspaceRow(rows, new Set(['A', 'B']), 'width-bottom')).toMatchObject({
      rowKey: 'thickness',
      targetLabel: 'D',
    });
  });

  test('cushion width, depth, and height stay in the cushion queue', () => {
    expect(
      isCwOverallDimensionRow({ sourceLabel: 'Width', sectionName: 'Seat Cushion Cover' })
    ).toBe(false);
    expect(
      isCwOverallDimensionRow({ sourceLabel: 'Height', sectionName: 'Back Cushion Cover' })
    ).toBe(false);
    expect(isCwOverallDimensionRow({ sourceLabel: 'Depth', sectionName: 'Frame Cover' })).toBe(
      true
    );
  });

  test('a scoped explicit L3 wins over an A4 suggestion', () => {
    const rows = [
      { rowKey: 'front-panel', targetLabel: 'A4' },
      { rowKey: 'back-bottom', targetLabel: 'L3' },
    ];

    expect(resolveCwWorkspaceQueueRow(rows, new Set(), 'back-bottom')).toEqual({
      row: rows[1],
      armed: true,
    });
  });

  test('switching sibling images cannot carry an L3 draw intent into the A4 image', () => {
    const armedRowsByScope = {
      'back::tab:frame-2': 'back-bottom',
      back: 'back-bottom',
    };

    expect(resolveCwScopedArmedRowKey(armedRowsByScope, ['back::tab:frame-2', 'back'])).toBe(
      'back-bottom'
    );
    expect(resolveCwScopedArmedRowKey(armedRowsByScope, ['front::tab:frame-1', 'front'])).toBe('');
  });

  test('rerendering an unchanged ready row does not emit another guide update', () => {
    const state = {
      scopeKeys: ['front::tab:frame-1', 'front'],
      targetLabel: 'A4',
      rowKey: 'frame-cover::front-width',
      displayTag: 'A4',
      guideTags: { 'front::tab:frame-1': 'A4', front: 'A4' },
      labelTags: { 'front::tab:frame-1': 'A4', front: 'A4' },
      readyRows: {
        'front::tab:frame-1': 'frame-cover::front-width',
        front: 'frame-cover::front-width',
      },
    };

    expect(hasCwWorkspaceSeedChanged(state)).toBe(false);
    expect(hasCwWorkspaceSeedChanged({ ...state, displayTag: 'A1' })).toBe(true);
  });

  test('explicitly drawing the same semantic label creates a readable numbered duplicate', () => {
    expect(resolveNextAvailableCwLabel('A', new Set(['A', 'A(1)']))).toBe('A(2)');
    expect(resolveNextAvailableCwLabel('C1', new Set(['C1']))).toBe('C1(1)');
    expect(resolveNextAvailableCwLabel('D', new Set())).toBe('D');
  });
});
