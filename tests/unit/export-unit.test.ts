import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTemporaryDisplayUnit,
  buildPdfExportFilename,
  defaultExportUnit,
  formatCmForExport,
  orderByViewOrder,
  orderViewIdsForExport,
  roundHalfUp,
} from '../../src/modules/ui/export-utils';
import { getGroupedPdfPageTargets } from '../../src/modules/ui/pdf-export-inline';
import { MeasurementSystem } from '../../src/modules/MeasurementSystem.js';
import {
  HAND_EDIT_EVENT,
  clearMeasurementNote,
  formatCheckValue,
  installHandEditNoteClearing,
  parseValueText,
} from '../../src/modules/ui/measurement-check-request';

const nomsMetadata = {
  naming: { customerName: 'Ria Ganary' },
  externalSources: {
    nomsOrders: { '125964': { orderNumber: '125964', customerName: 'Ria Ganary' } },
  },
};

describe('cm rounding (half up on the exact value)', () => {
  it('prints 6.35 cm as 6.4, not 6.3', () => {
    expect((6.35).toFixed(1)).toBe('6.3'); // the float trap this guards against
    expect(roundHalfUp(6.35, 1)).toBe(6.4);
    expect(roundHalfUp(2.5 * 2.54, 1)).toBe(6.4);
    expect(roundHalfUp(6.34, 1)).toBe(6.3);
    expect(roundHalfUp(-6.35, 1)).toBe(-6.4);
    expect(formatCmForExport(6.35)).toBe('6.4 cm');
    expect(formatCmForExport(50)).toBe('50 cm');
    expect(formatCmForExport(0)).toBe('');
  });

  it('uses the same helper for canvas labels, the export table and check values', () => {
    const system = new MeasurementSystem(null);
    expect(system.formatCentimeterValue(6.35, { decimalPlaces: 1 })).toBe('6.4 cm');
    expect(system.formatCentimeterValue(50, { decimalPlaces: 0 })).toBe('50 cm');
    expect(system.formatDecimalInches(2.125, true, 2)).toBe('2.13"');
    expect(formatCheckValue({ cm: 6.35, inch: 2.5, inputUnit: 'inches' }, 'cm')).toBe('6.4 cm');
  });
});

describe('export unit default', () => {
  it('defaults to cm for NOMS projects or after a cm export, else the project unit', () => {
    expect(defaultExportUnit({ metadata: nomsMetadata, projectUnit: 'inch' })).toBe('cm');
    expect(defaultExportUnit({ metadata: {}, lastUnit: 'cm', projectUnit: 'inch' })).toBe('cm');
    expect(defaultExportUnit({ metadata: {}, lastUnit: 'inch', projectUnit: 'inch' })).toBe('inch');
    expect(defaultExportUnit({ metadata: {}, projectUnit: 'cm' })).toBe('cm');
    expect(defaultExportUnit({})).toBe('inch');
  });
});

describe('export file name', () => {
  it('leads with the NOMS order and customer and ends with the unit', () => {
    expect(
      buildPdfExportFilename({
        projectName: 'Ethan Allen Thomas Dining Chair',
        unit: 'cm',
        metadata: nomsMetadata,
      })
    ).toBe('125964 - Ria Ganary - Ethan Allen Thomas Dining Chair - cm.pdf');
  });

  it('does not repeat a customer already in the project name', () => {
    expect(
      buildPdfExportFilename({
        projectName: 'Ria Ganary - Ethan Allen Thomas Dining Chair',
        unit: 'inch',
        metadata: nomsMetadata,
      })
    ).toBe('125964 - Ria Ganary - Ethan Allen Thomas Dining Chair - inches.pdf');
  });

  it('is project name and unit when not linked to NOMS', () => {
    expect(buildPdfExportFilename({ projectName: 'Keeley: armchair', unit: 'cm' })).toBe(
      'Keeley- armchair - cm.pdf'
    );
  });
});

describe('page order', () => {
  const listOrder = ['front', 'side-a3', 'back', 'under', 'side', 'top-down'];

  it('follows the image list, with unlisted views last and ties stable', () => {
    expect(
      orderViewIdsForExport(
        ['front', 'side-a3', 'side', 'back', 'extra', 'under', 'top-down'],
        listOrder
      )
    ).toEqual(['front', 'side-a3', 'back', 'under', 'side', 'top-down', 'extra']);

    const pages = [
      { viewId: 'side', id: 1 },
      { viewId: 'front', id: 2 },
      { viewId: 'side', id: 3 },
    ];
    expect(orderByViewOrder(pages, page => page.viewId, listOrder).map(page => page.id)).toEqual([
      2, 1, 3,
    ]);
  });

  it('keeps a grouped page where its first view sits instead of moving groups first', () => {
    const targets = listOrder.map((viewId, viewIndex) => ({
      viewId,
      viewIndex,
      tabId: null,
      scopeKey: viewId,
    }));
    const grouped = getGroupedPdfPageTargets(
      targets,
      [{ mainViewId: 'under', relatedViewIds: ['top-down'] }],
      {}
    );
    expect(
      grouped.map((entry: any) =>
        entry.type === 'grouped' ? `group:${entry.mainTarget.viewId}` : entry.target.viewId
      )
    ).toEqual(['front', 'side-a3', 'back', 'group:under', 'side']);
  });
});

describe('check-request values and notes', () => {
  afterEach(() => {
    delete (window as any).app;
  });

  it('keeps both numbers of a range from the PDF (parseCustomerValue)', () => {
    expect(parseValueText('approx 24.5 - 25"').range).toEqual([24.5, 25]);
    expect(parseValueText('approx 21.5- 21.75"').range).toEqual([21.5, 21.75]);
    expect(parseValueText('16.25-16.5').range).toEqual([16.25, 16.5]);
    expect(parseValueText('5-5.25"').range).toEqual([5, 5.25]);
  });

  it('clears a stale PDF note when the value is typed by hand later', () => {
    let metadata: any = {
      measurementNotes: { 'side|G2': 'customer wrote 16.25 - 16.5', 'side|H1': '5.25"' },
    };
    (window as any).app = {
      projectManager: {
        getProjectMetadata: () => metadata,
        setProjectMetadata: (patch: any) => {
          metadata = { ...metadata, ...patch };
        },
      },
    };
    installHandEditNoteClearing();
    window.dispatchEvent(
      new CustomEvent(HAND_EDIT_EVENT, { detail: { imageLabel: 'side', strokeLabel: 'G2' } })
    );
    expect(metadata.measurementNotes).toEqual({ 'side|H1': '5.25"' });
    expect(clearMeasurementNote('side', 'H1')).toBe(true);
    expect(metadata.measurementNotes).toEqual({});
    expect(clearMeasurementNote('side', 'H1')).toBe(false);
  });
});

describe('PDF export dialog', () => {
  afterEach(() => {
    delete (window as any).app;
    delete (window as any).orderedImageLabels;
    document.body.innerHTML = '';
    window.localStorage.removeItem('sofapaint:pdf-export-unit');
  });

  it('asks for the unit, defaulting to cm for a NOMS project, and shows the file name', async () => {
    const { initPdfExport } = await import('../../src/modules/ui/pdf-export-inline');
    document.body.innerHTML =
      '<input id="projectName" value="Ethan Allen Thomas Dining Chair"><select id="unitSelector"><option value="inch" selected>in</option><option value="cm">cm</option></select>';
    (window as any).app = {
      projectManager: {
        views: { front: { image: 'a.jpg' }, side: { image: 'b.jpg' } },
        getProjectMetadata: () => nomsMetadata,
      },
    };
    initPdfExport();
    await (window as any).showPDFExportDialog();
    const checked = document.querySelector<HTMLInputElement>('input[name="pdfExportUnit"]:checked');
    expect(checked?.value).toBe('cm');
    expect(document.querySelector('[data-pdf-export-filename]')?.textContent).toBe(
      'File: 125964 - Ria Ganary - Ethan Allen Thomas Dining Chair - cm.pdf'
    );
    const inch = document.querySelector<HTMLInputElement>('input[data-pdf-export-unit="inch"]')!;
    inch.checked = true;
    inch.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector('[data-pdf-export-filename]')?.textContent).toContain(
      'Dining Chair - inches.pdf'
    );
    // The project display unit is untouched by the choice.
    expect(document.querySelector<HTMLSelectElement>('#unitSelector')!.value).toBe('inch');
  });
});

describe('temporary export unit', () => {
  it('shows the export unit while exporting and puts the project unit back', () => {
    document.body.innerHTML =
      '<select id="unitSelector"><option value="inch" selected>in</option><option value="cm">cm</option></select>';
    const selector = document.querySelector<HTMLSelectElement>('#unitSelector')!;
    const seen: string[] = [];
    selector.addEventListener('change', () => seen.push(selector.value));
    const restore = applyTemporaryDisplayUnit('cm');
    expect(selector.value).toBe('cm');
    restore();
    restore();
    expect(selector.value).toBe('inch');
    expect(seen).toEqual(['cm', 'inch']);
    expect(applyTemporaryDisplayUnit('inch')).toBeTypeOf('function');
    expect(seen).toEqual(['cm', 'inch']);
    document.body.innerHTML = '';
  });
});
