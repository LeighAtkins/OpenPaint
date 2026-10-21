// The NOMS panel end to end in happy-dom: a SofaPaint review PDF dropped on
// the panel fills the letters its lines feed and flags the rest, and Send to
// NOMS saves through a fake OMNOMS bridge, makes the cm PDF and shows the
// summary. Network, Chrome and CW40 are not involved.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

vi.mock('../../src/services/auth/authService', () => ({
  authService: {
    getCurrentUser: () => ({ email: 'leigh@comfort-works.com', emailConfirmed: true }),
    onAuthStateChange: () => () => {},
  },
}));
vi.mock('../../src/modules/ImageRegistry.js', () => ({
  imageRegistry: { isEnabled: () => false },
}));
vi.mock('../../src/modules/ui/notification-center', () => ({ notifyOpenPaint: vi.fn() }));
vi.mock('../../src/modules/ui/next-tag-control', () => ({ setNextTagValue: vi.fn() }));
vi.mock('../../src/modules/ui/measurement-guide-flash.js', () => ({
  importSvgMeasurements: vi.fn(),
  stripSvgLabels: (s: string) => s,
  waitForGuideImportReady: vi.fn(),
}));
vi.mock('../../src/modules/ui/cw-form-pdf-import', async importActual => ({
  ...(await importActual<any>()),
  loadPdfjs: async () => pdfjs,
  importCwFormPdf: vi.fn(),
}));

import {
  dropNomsPdfs,
  initNomsMeasureLink,
  sendNomsOrder,
} from '../../src/modules/ui/noms-measure-link';

const FORM_ID = '987654';
const ORDER = '125964';
const form = {
  form_ID: FORM_ID,
  unit: 'cm',
  confirmed: false,
  products: [
    {
      reference: 'CSDC-SA-SNUG',
      model_list: [
        {
          name: 'CSDC-SA-SNUG',
          label: 'Chair',
          files: [
            { name: 'Front_CSDC', field_data: { A1: '', A2: '', C2: '', D: '', Q9: '' } },
            { name: 'Side_CSDC', field_data: { A3: '', H1: '' } },
          ],
          rules: {},
        },
      ],
    },
  ],
};
let metadata: any;
const requests: any[] = [];
let nomsValues: Record<string, Record<string, string>> | null = null;

function reply(request: any) {
  requests.push(request);
  let data: any = {};
  if (request.action === 'load') {
    const content = JSON.parse(JSON.stringify(form));
    if (nomsValues)
      content.products[0].model_list[0].files.forEach((file: any, f: number) => {
        Object.assign(file.field_data, nomsValues![`0:0:${f}`] || {});
      });
    data = { content };
  }
  if (request.action === 'save') {
    nomsValues = request.values;
    data = { saved: true };
  }
  const event = new MessageEvent('message', {
    data: {
      source: 'omnoms-noms',
      type: 'NOMS_RESPONSE',
      requestId: request.requestId,
      ok: true,
      data,
    },
    origin: window.location.origin,
  });
  Object.defineProperty(event, 'source', { value: window });
  window.dispatchEvent(event);
}

const until = async (check: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 20));
  }
};
const panel = () => document.getElementById('nomsMeasureLinkPanel') as HTMLElement;

describe.skipIf(!existsSync(resolve(__dirname, '../fixtures/private/ria-filled.pdf')))(
  'NOMS panel: drop a review PDF and send',
  () => {
    const downloads: string[] = [];
    beforeAll(async () => {
      localStorage.setItem('nomsLinkDevStaff', '1');
      document.documentElement.dataset.omnomsNomsBridge = '1';
      metadata = {
        externalSources: {
          nomsOrders: {
            [ORDER]: {
              orderNumber: ORDER,
              formId: FORM_ID,
              lang: 'en',
              customerName: 'Ria Ganary',
              unit: 'cm',
              confirmed: false,
              values: {},
              // The front photo feeds the front file; the side photo the side file.
              viewBindings: { front: '0:0:0', side: '0:0:1' },
              diagramViews: {},
              // Leigh's H1 on the side photo is drawn as G2 in her letters.
              lineLinks: { '0:0:1:H1': { viewId: 'side-1', label: 'G2' } },
            },
          },
        },
      };
      (window as any).app = {
        projectManager: {
          views: { front: {}, side: {}, 'side-1': {} },
          currentViewId: 'front',
          getProjectMetadata: () => metadata,
          setProjectMetadata: (patch: any) => {
            metadata = { ...metadata, ...patch };
          },
        },
        metadataManager: { vectorStrokesByImage: {}, getMeasurement: () => null },
      };
      const post = window.postMessage.bind(window);
      (window as any).postMessage = (message: any, origin: any) => {
        if (message?.source === 'sofapaint-noms') setTimeout(() => reply(message), 0);
        else post(message, origin);
      };
      URL.createObjectURL = () => 'blob:x';
      URL.revokeObjectURL = () => {};
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement
      ) {
        if (this.download) downloads.push(this.download);
      });
      initNomsMeasureLink();
      window.dispatchEvent(new CustomEvent('openpaint:project-loaded'));
      await until(() => Boolean(panel()?.textContent?.includes('Send to NOMS')));
    });
    afterAll(() => vi.restoreAllMocks());

    it('fills letters from the PDF, flags the rest and lists extras', async () => {
      const bytes = readFileSync(resolve(__dirname, '../fixtures/private/ria-filled.pdf'));
      await dropNomsPdfs([new File([bytes], 'ria-filled.pdf', { type: 'application/pdf' })]);
      const values = metadata.externalSources.nomsOrders[ORDER].values;
      // 23 in, 19 in, 7 in (see photos), 24 in on the front photo, in the form's cm.
      expect(values['0:0:0']).toMatchObject({ A1: '58.42', A2: '48.26', C2: '17.78', D: '60.96' });
      // H1 follows Leigh's G2 line (16.25 - 16.5 in, the larger end by default).
      expect(values['0:0:1'].H1).toBe('41.91');
      const text = panel().textContent || '';
      expect(text).toMatch(/\d+ values filled, \d+ to check/);
      expect(text).toContain('Customer wrote 16.25-16.5; used 16.5 in');
      expect(text).toContain('Not in the PDF and empty on the form');
      expect(text).toContain('From the PDF, not on the form:');
      // Every PDF value is somewhere: placed, or listed as an extra.
      const review = metadata.externalSources.nomsOrders[ORDER].dropReview;
      expect(review.values.length).toBeGreaterThan(20);
    });

    it('sends: saves unconfirmed, asks about flags once, makes the cm PDF and shows the summary', async () => {
      const run = sendNomsOrder();
      await until(() => Boolean(document.querySelector('.nml-ask')));
      expect(document.querySelector('.nml-ask h2')?.textContent).toMatch(
        /^Save with \d+ flagged values\?$/
      );
      (document.querySelector('.nml-ask input[type=checkbox]') as HTMLInputElement).checked = true;
      (document.querySelector('.nml-ask button.primary') as HTMLButtonElement).click();
      await run;
      const save = requests.find(r => r.action === 'save');
      expect(save).toMatchObject({ confirm: false, unit: 'cm', formId: FORM_ID });
      expect(save.values['0:0:0'].A1).toBe('58.42');
      expect(downloads).toEqual(['125964 - Ria Ganary - measurements cm.pdf']);
      const summary = (document.querySelector('.nml-summary') as HTMLTextAreaElement).value;
      expect(summary).toContain('NOMS #125964 - Ria Ganary');
      expect(summary).toContain('A1: 58.4');
      expect(summary).toContain('H1: 41.9');
      expect(summary).toMatch(/To check \(\d+\):/);
      expect(metadata.externalSources.nomsOrders[ORDER].skipFlagConfirm).toBe(true);
      expect(panel().textContent).toContain('Saved to NOMS.');
      document.querySelector('.nml-map')?.remove();
    });

    it('asks before overwriting a letter NOMS changed meanwhile', async () => {
      nomsValues = { ...nomsValues!, '0:0:0': { ...nomsValues!['0:0:0'], A2: '50' } };
      const run = sendNomsOrder();
      await until(() => Boolean(document.querySelector('.nml-ask')));
      expect(document.querySelector('.nml-ask')?.textContent).toContain(
        'NOMS has newer values for A2'
      );
      const useNoms = Array.from(document.querySelectorAll('.nml-ask button')).find(
        b => b.textContent === 'Use NOMS for these'
      ) as HTMLButtonElement;
      useNoms.click();
      await run;
      const saves = requests.filter(r => r.action === 'save');
      expect(saves[saves.length - 1].values['0:0:0'].A2).toBe('50');
      document.querySelector('.nml-map')?.remove();
    });

    it('on reopen, asks when NOMS and the panel both changed a letter, and takes untouched NOMS changes', async () => {
      const orders = metadata.externalSources.nomsOrders;
      const mine = orders[ORDER].values;
      // Here: A1 typed as 60. On NOMS meanwhile: A1 59 and D 61.
      orders[ORDER] = {
        ...orders[ORDER],
        values: { ...mine, '0:0:0': { ...mine['0:0:0'], A1: '60' } },
      };
      nomsValues = { ...nomsValues!, '0:0:0': { ...nomsValues!['0:0:0'], A1: '59', D: '61' } };
      window.dispatchEvent(new CustomEvent('openpaint:project-loaded'));
      await until(() => Boolean(panel()?.querySelector('.nml-drift')));
      expect(panel().querySelector('.nml-drift')?.textContent).toContain(
        'NOMS has newer values for A1'
      );
      expect(panel().textContent).toContain('Took 1 newer NOMS value (D)');
      const values = () => metadata.externalSources.nomsOrders[ORDER].values['0:0:0'];
      expect(values()).toMatchObject({ A1: '60', D: '61' });
      const use = Array.from(panel().querySelectorAll('.nml-drift button')).find(
        b => b.textContent === 'Use NOMS'
      ) as HTMLButtonElement;
      use.click();
      await until(() => !panel().querySelector('.nml-drift'));
      expect(values().A1).toBe('59');
    });
  }
);
