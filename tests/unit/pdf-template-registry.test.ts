import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  analyzeCwFormPage,
  detectDocumentUnit,
  detectWidgetUnit,
  extractCwPageData,
  type CwPageData,
} from '../../src/modules/cw-form-pdf/parse-cw-form';
import {
  extractModelCodes,
  fingerprintPage,
  viewFromLetters,
} from '../../src/modules/cw-form-pdf/pdf-fingerprint';
import { readCustomerPdfDocument } from '../../src/modules/cw-form-pdf/read-customer-pdf';
import {
  PDF_TEMPLATES,
  findCwSvg,
  identifyPdfDocument,
  identifyPdfTemplate,
} from '../../src/modules/ui/pdf-template-registry';

const FIXTURES = resolve(__dirname, '../fixtures/pdf-library');
const BEN = '/tmp/cw-mt/ben';
const NOMS_FIXTURES = resolve(__dirname, '../fixtures/noms-pdfs');
/** The returned PDF from /tmp when present, else the committed copy. */
const firstExisting = (...paths: string[]) => paths.find(p => existsSync(p)) || paths[0];
const RIA = firstExisting('/tmp/cw-mt/ria/ria-filled.pdf', join(NOMS_FIXTURES, 'ria-filled.pdf'));

let pdfjs: any;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

async function openPdf(path: string) {
  return pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
}

async function pagesOf(path: string): Promise<CwPageData[]> {
  const doc = await openPdf(path);
  const pages: CwPageData[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    pages.push(await extractCwPageData(await doc.getPage(n), pdfjs.OPS));
  }
  return pages;
}

/** What readCwFormPdfValues reports, without the browser loader. */
function currentReaderValues(pages: CwPageData[]) {
  const unit = detectDocumentUnit(pages);
  return pages.flatMap(data =>
    analyzeCwFormPage(data, unit).flatMap(view =>
      [...view.measurements, ...view.unplaced].map(m => ({
        page: view.pageNumber,
        label: m.label,
        value: m.value,
      }))
    )
  );
}

describe('PDF template library', () => {
  const pdfs = existsSync(FIXTURES) ? walk(FIXTURES).filter(f => /\.pdf$/i.test(f)) : [];

  it('has fixtures from every library folder', () => {
    expect(pdfs.length).toBeGreaterThanOrEqual(60);
    const kinds = new Set(PDF_TEMPLATES.map(t => t.kind));
    for (const kind of ['model', 'universal', 'super', 'cushion', 'ja'])
      expect(kinds).toContain(kind);
  });

  it('identifies every fixture PDF from its content alone', async () => {
    const problems: string[] = [];
    for (const path of pdfs) {
      const rel = relative(FIXTURES, path);
      const pages = await pagesOf(path);
      // Customers rename files, so the name is withheld.
      const doc = identifyPdfDocument(
        pages.map(p => fingerprintPage(p, { fileName: 'customer.pdf' }))
      );
      const templates = doc.pages.map(p => p.template);
      if (doc.source !== rel && doc.confidence >= 0.8) {
        // A confident match to another file must be the same form.
        const own = PDF_TEMPLATES.filter(t => t.source === rel);
        const same = own.every((t, i) => templates[i]?.letters.join() === t.letters.join());
        if (!same) problems.push(`${rel}: matched ${doc.source}`);
      }
      const first = PDF_TEMPLATES.find(t => t.source === rel && t.page === 1);
      if (!first) {
        problems.push(`${rel}: not in registry`);
        continue;
      }
      const own = PDF_TEMPLATES.filter(t => t.source === rel);
      if (first.kind === 'model') {
        if (!own.some(t => t.modelCodes.length)) problems.push(`${rel}: no model code`);
        if (!own.some(t => t.letters.length)) problems.push(`${rel}: no letters`);
      }
      if (first.kind === 'universal') {
        if (!own.some(t => t.letters.length)) problems.push(`${rel}: no letters`);
        // Blank trailing pages (no fields, no letters) have nothing to name.
        for (const t of own.filter(t => t.fieldCount || t.letters.length)) {
          if (!t.view) problems.push(`${rel} p${t.page}: no view`);
        }
      }
    }
    expect(problems.join('\n')).toBe('');
  }, 120000);

  it('tells mirrored L and R sectional forms apart', async () => {
    for (const hand of ['L', 'R']) {
      const rel = `Sectionals/CS5L-WA-HB-${hand}.pdf`;
      const pages = await pagesOf(join(FIXTURES, rel));
      const doc = identifyPdfDocument(pages.map(p => fingerprintPage(p)));
      expect(doc.source).toBe(rel);
      expect(doc.modelCodes).toEqual([`CS5L-WA-HB-${hand}`]);
    }
  });

  it('matches exact field-name sets on a single page', async () => {
    const [page] = await pagesOf(join(FIXTURES, 'Universal PDF/side SA SB L.pdf'));
    const match = identifyPdfTemplate(fingerprintPage(page));
    expect(match.exactFields).toBe(true);
    expect(match.template?.source).toBe('Universal PDF/side SA SB L.pdf');
    expect(match.template?.view).toBe('side');
    expect(match.template?.letters).toEqual(['F', 'G1', 'G2', 'G3', 'H1', 'H2', 'H3']);
    expect(Object.values(match.template?.fieldMap || {})).toContain('G1');
    expect(match.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('maps library SVG diagrams to model codes and views', () => {
    expect(findCwSvg('CSDC-SNUG', 'front')?.url).toBe('/cw-svgs/CSDC-SNUG/front.svg');
    expect(findCwSvg('CSDC-SNUG', 'back')?.url).toBe('/cw-svgs/CSDC-SNUG/back.svg');
    expect(findCwSvg('CS3X-RA-RB', 'back')?.letters).toContain('A1');
    expect(findCwSvg('CC-BOL', 'cushion')?.labelIds).toBe(true);
    // A model code falls back to its arm component.
    expect(findCwSvg('CS3B-WA-HB', 'arm')?.url).toBe('/cw-svgs/WA-HB/arm.svg');
    expect(findCwSvg('NOPE-XX')).toBeNull();
    const withSvg = PDF_TEMPLATES.filter(t => t.svgUrl);
    expect(withSvg.length).toBeGreaterThan(20);
    for (const t of withSvg)
      expect(existsSync(resolve(__dirname, '../../public', `.${t.svgUrl}`))).toBe(true);
  });
});

describe('Fingerprint rules', () => {
  it('reads model codes from file names', () => {
    expect(extractModelCodes('Sofas/Snug Fit/CS3B-RA-HB.pdf')).toEqual(['CS3B-RA-HB']);
    expect(extractModelCodes('CS3B-SA-HB-CW-093362.pdf')).toEqual(['CS3B-SA-HB']);
    expect(extractModelCodes('m36__CS5B-SA2-HB-L_1.pdf')).toEqual(['CS5B-SA2-HB-L']);
    expect(extractModelCodes('CS3-SRA-HB-R-BeckerSofa.pdf')).toEqual(['CS3-SRA-HB-R']);
    expect(extractModelCodes('Universal PDF/CC BOL.pdf')).toEqual(['CC-BOL']);
    expect(extractModelCodes('CC-BCH-W_REV001.pdf')).toEqual(['CC-BCH-W']);
    expect(extractModelCodes('Universal PDF/side SA SB L.pdf')).toEqual(['SA-SB-L']);
    expect(extractModelCodes('-SLA-B-1.pdf')).toEqual(['SLA-B']);
  });

  it('infers a view from CW letters', () => {
    expect(viewFromLetters(['J1', 'L1', 'L2'])).toBe('back');
    expect(viewFromLetters(['F', 'G1', 'H1'])).toBe('side');
    expect(viewFromLetters(['A1', 'A2', 'B', 'F1', 'F2', 'J1', 'J2'])).toBe('frame');
  });
});

/** A hand-built page: unit boxes, labelled rows and their fields. */
function fakePage(options: {
  annotations: any[];
  items: Array<{ str: string; x: number; y: number; w?: number }>;
}) {
  return {
    pageNumber: 1,
    view: [0, 0, 600, 800],
    getAnnotations: async () => options.annotations,
    getTextContent: async () => ({
      items: options.items.map(i => ({
        str: i.str,
        transform: [1, 0, 0, 10, i.x, i.y],
        width: i.w ?? 12,
        height: 10,
      })),
    }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
  };
}

const row = (name: string, value: string, y: number) => ({
  fieldType: 'Tx',
  fieldName: name,
  fieldValue: value,
  rect: [523, y, 559, y + 16],
});

describe('Customer values and units', () => {
  const items = [
    { str: 'A1', x: 500, y: 603 },
    { str: 'A2', x: 500, y: 583 },
    { str: 'A3', x: 500, y: 563 },
    { str: 'CM', x: 470, y: 680 },
    { str: 'INCH', x: 530, y: 680, w: 24 },
  ];
  const radios = (selected: string) => [
    {
      fieldType: 'Btn',
      fieldName: 'Radio Button 1',
      radioButton: true,
      buttonValue: 'Choice1',
      fieldValue: selected,
      rect: [500, 676, 512, 688],
    },
    {
      fieldType: 'Btn',
      fieldName: 'Radio Button 1',
      radioButton: true,
      buttonValue: 'Choice2',
      fieldValue: selected,
      rect: [558, 676, 570, 688],
    },
  ];

  it('reads the ticked INCH radio as the unit', async () => {
    const data = await extractCwPageData(
      fakePage({
        annotations: [...radios('Choice2'), row('Text Field 1', '41', 600)],
        items,
      }) as any,
      {} as any
    );
    expect(detectWidgetUnit(data)).toBe('inch');
    expect(analyzeCwFormPage(data)[0]).toMatchObject({ unit: 'inch', unitAssumed: false });
  });

  it('reads Universal check boxes and SofaPaint unit radios', async () => {
    const universal = await extractCwPageData(
      fakePage({
        annotations: [
          {
            fieldType: 'Btn',
            fieldName: 'checkbox_1lahn',
            checkBox: true,
            exportValue: 'Yes',
            fieldValue: 'Yes',
            rect: [440, 676, 456, 692],
          },
          {
            fieldType: 'Btn',
            fieldName: 'checkbox_2lukd',
            checkBox: true,
            exportValue: 'Yes',
            fieldValue: 'Off',
            rect: [560, 676, 576, 692],
          },
        ],
        items,
      }) as any,
      {} as any
    );
    expect(detectWidgetUnit(universal)).toBe('cm');
    const review = await extractCwPageData(
      fakePage({
        annotations: [
          {
            fieldType: 'Btn',
            fieldName: 'unit_measurement_1',
            radioButton: true,
            buttonValue: 'cm',
            fieldValue: 'inch',
            rect: [276, 674, 291, 689],
          },
          {
            fieldType: 'Btn',
            fieldName: 'unit_measurement_1',
            radioButton: true,
            buttonValue: 'inch',
            fieldValue: 'inch',
            rect: [497, 674, 512, 689],
          },
        ],
        items: [],
      }) as any,
      {} as any
    );
    expect(detectWidgetUnit(review)).toBe('inch');
  });

  it('keeps words without a number as flagged notes, and ranges whole', async () => {
    const page = fakePage({
      annotations: [
        ...radios('Off'),
        row('Text Field 1', '24.5 - 25', 600),
        row('Text Field 2', 'n/a', 580),
        row('Text Field 3', 'same as A1', 560),
      ],
      items,
    });
    const doc = { numPages: 1, getPage: async () => page, getMetadata: async () => ({ info: {} }) };
    const result = await readCustomerPdfDocument(doc as any, {} as any, 'x.pdf', PDF_TEMPLATES);
    const values = result.pages[0].values;
    expect(values.find(v => v.label === 'A1')?.value).toMatchObject({
      kind: 'range',
      values: [24.5, 25],
    });
    expect(values.find(v => v.label === 'A2')).toMatchObject({ value: null, text: 'n/a' });
    expect(values.find(v => v.label === 'A3')).toMatchObject({ value: null, text: 'same as A1' });
    expect(result.pages[0]).toMatchObject({ unit: 'cm', unitAssumed: true, unitSource: 'assumed' });
  });
});

describe('Returned customer PDFs', () => {
  it.skipIf(!existsSync(RIA))('detects a SofaPaint check-request sheet', async () => {
    const doc = await openPdf(RIA);
    const result = await readCustomerPdfDocument(doc, pdfjs.OPS, 'ria-filled.pdf');
    expect(result.kind).toBe('sofapaint-review');
  });

  // "R and L Sofa" is the CS5L-SA-HB-L form renamed: field names, letters and layout match exactly.
  const ben = [
    { file: 'm37__R and L Sofa.pdf', copy: 'ben-r-and-l-sofa.pdf', code: /^CS5L-SA-HB-L$/ },
    { file: 'm36__CS5B-SA2-HB-L_1.pdf', copy: '', code: /^CS5B-SA2-HB-L$/ },
    { file: 'm37__Middle Sofa Section.pdf', copy: 'ben-middle-sofa-section.pdf', code: /^CS3X/ },
  ];
  for (const { file, copy, code } of ben) {
    const path = firstExisting(join(BEN, file), copy ? join(NOMS_FIXTURES, copy) : join(BEN, file));
    it.skipIf(!existsSync(path))(`identifies ${file} and reads the same values`, async () => {
      const expected = currentReaderValues(await pagesOf(path));
      const result = await readCustomerPdfDocument(await openPdf(path), pdfjs.OPS, file);
      expect(result.modelCodes.some(c => code.test(c))).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      const read = result.pages.flatMap(p =>
        p.values
          .filter(v => v.from === 'row' && v.value)
          .map(v => ({
            page: p.pageNumber,
            label: v.label,
            value: v.value!.kind === 'range' ? Math.max(...v.value!.values) : v.value!.values[0],
          }))
      );
      expect(read).toEqual(expected);
      // The customer typed an "x" over the INCH box; the blank m36 form has no unit.
      if (expected.length)
        expect(result.pages[0]).toMatchObject({ unit: 'inch', unitSource: 'ticked' });
    });
  }
});
