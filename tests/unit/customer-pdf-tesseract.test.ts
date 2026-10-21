// @vitest-environment node
/**
 * The real Tesseract worker on the six scanned pages of a customer return.
 * The page images are customer files and never enter the repository: the test
 * reads them from /tmp/cw-mt/alana/pg when present and skips otherwise. It
 * reports per-value accuracy against what the customer wrote (read by eye) to
 * /tmp/cw-mt/alana/tesseract-accuracy.json.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readScannedPage } from '../../src/modules/cw-form-pdf/scan-reader';
import { createTesseractEngine } from '../../src/modules/cw-form-pdf/tesseract-engine';
import type { TemplateGeometryIndex } from '../../src/modules/cw-form-pdf/template-geometry';

const PAGES = '/tmp/cw-mt/alana/pg';
const present = existsSync(`${PAGES}/page-01.png`);
const ROOT = resolve(__dirname, '../..');

const EXPECTED: Record<number, Record<string, string>> = {
  1: {
    A1: '75.25',
    A2: '72.25',
    A3: '17.00',
    B1: '29.00',
    B2: '33.50',
    C1: '3.25',
    C2: '10.25',
    D1: '75.25',
    M1: '39.00',
    M2: '10.50',
  },
  2: {
    E1: '14.25',
    F1: '5.50',
    F2: '0.00',
    F3: 'N/A',
    F4: '0.00',
    G1: '39.25',
    G2: '39.00',
    H1: '24.75',
    H2: '24.50',
    H3: '1.50',
    J1: '24.50',
    L1: '71.25',
    L2: '75.00',
    L3: '75.00',
  },
  3: {
    'Box seat cushions, type 1|Qty': '1',
    'Box seat cushions, type 1|A': '69.25',
    'Box seat cushions, type 1|B': '69.25',
    'Box seat cushions, type 1|C': '29.00',
    'Box seat cushions, type 1|D': '4.25',
    'Box back cushions, type 1|Qty': '2',
    'Box back cushions, type 1|A': '34.00',
    'Box back cushions, type 1|B': '35.00',
    'Box back cushions, type 1|C': '17.50',
    'Box back cushions, type 1|D': '3.00',
  },
  4: {
    A1: '31.75',
    A2: '31.25',
    A3: '15.00',
    B1: '28.50',
    B2: '33.75',
    C1: '3.25',
    C3: '10.50',
    D1: '31.00',
    E1: '14.25',
    F1: '5.50',
    F2: '0.00',
    F3: 'N/A',
    F4: '0.00',
    G1: '39.00',
    G2: '39.00',
    H1: '24.50',
    H2: '24.50',
    H3: '1.50',
  },
  5: { J1: '24.50', L1: '31.75', L2: '34.75', L3: '34.50', M1: '54.25', M2: '25.50', M3: '65.00' },
  6: {
    'Box back cushions, type 1|Qty': '1',
    'Box back cushions, type 1|A': '30.00',
    'Box back cushions, type 1|B': '30.00',
    'Box back cushions, type 1|C': '17.25',
  },
};

describe('Tesseract on the scanned return', () => {
  it.skipIf(!present)(
    'identifies each form, reads the INCH ticks and reports value accuracy',
    async () => {
      const sharp = (await import('sharp')).default;
      const { createWorker } = await import('tesseract.js');
      const index: TemplateGeometryIndex = JSON.parse(
        readFileSync(resolve(ROOT, 'src/data/pdf-template-geometry.json'), 'utf8')
      );
      const worker = await createWorker('eng', 1, {
        langPath: resolve(ROOT, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int'),
        workerPath: resolve(ROOT, 'node_modules/tesseract.js/src/worker-script/node/index.js'),
        cacheMethod: 'none',
      });
      const engine = createTesseractEngine(worker as any);
      const report: Record<string, unknown> = {};
      let right = 0;
      let total = 0;
      try {
        for (const n of [1, 2, 3, 4, 5, 6]) {
          // pdf.js draws the page about 2000 px wide in the browser; do the same here.
          const { data, info } = await sharp(`${PAGES}/page-0${n}.png`)
            .resize({ width: 2000 })
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });
          const page = await readScannedPage(
            { width: info.width, height: info.height, data: new Uint8Array(data) },
            engine,
            index
          );
          expect(page.candidates.length, `page ${n} identified`).toBeGreaterThan(0);
          if (![3, 6].includes(n)) expect(page.unit, `page ${n} unit`).toBe('inch');
          const rows: Record<string, string> = {};
          for (const [key, text] of Object.entries(EXPECTED[n])) {
            const [section, label] = key.includes('|') ? key.split('|') : ['', key];
            const got = page.values.find(
              v => !v.stray && v.label === label && (v.section || '') === section
            );
            const ok =
              text === 'N/A'
                ? got?.text === 'N/A'
                : Boolean(got?.value) && Math.abs(got!.value!.values[0] - parseFloat(text)) < 0.001;
            total += 1;
            if (ok) right += 1;
            rows[key] =
              `${ok ? 'ok' : 'WRONG'} wrote ${text}, read ${got ? got.text : '(nothing)'}`;
          }
          report[`page ${n}`] = { unit: page.unit, values: rows };
        }
      } finally {
        await worker.terminate();
      }
      report.accuracy = `${right}/${total} (${Math.round((right / total) * 100)}%)`;
      writeFileSync('/tmp/cw-mt/alana/tesseract-accuracy.json', JSON.stringify(report, null, 2));
      // Handwriting is hard for Tesseract; every value is flagged for a person to check.
      expect(right / total).toBeGreaterThan(0.3);
    },
    600000
  );
});
