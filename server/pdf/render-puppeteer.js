import { closeBrowser, getBrowser } from './browser-pool.js';

const PAGE_FORMATS = {
  a4: 'A4',
  letter: 'Letter',
};

const PAGE_POINTS = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

export async function renderPdfWithPuppeteer({ html, options }) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const browser = await getBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    try {
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = request.url();
        const allowed =
          url.startsWith('data:') ||
          url.startsWith('blob:') ||
          url.startsWith('about:') ||
          url.startsWith('file:');

        if (allowed) {
          request.continue();
        } else {
          request.abort();
        }
      });

      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.emulateMediaType('print');

      const normalizedSize = String(options.pageSize || 'letter').toLowerCase();
      const pagePoints = PAGE_POINTS[normalizedSize] || PAGE_POINTS.letter;
      const marginPoints = (14 / 25.4) * 72;
      const contentWidthPoints = pagePoints.width - marginPoints * 2;
      const contentHeightPoints = pagePoints.height - marginPoints * 2;

      const anchors = await page.evaluate(
        ({
          marginPointsValue,
          contentWidthPointsValue,
          contentHeightPointsValue,
          pageHeightPointsValue,
        }) => {
          const pageElements = Array.from(document.querySelectorAll('[data-page-index]'));
          const pageRects = pageElements.map(element => ({
            index: Number(element.getAttribute('data-page-index') || 0),
            rect: element.getBoundingClientRect(),
          }));

          return Array.from(document.querySelectorAll('.pdf-field-anchor')).map((el, idx) => {
            const rect = el.getBoundingClientRect();
            const pageInfo =
              pageRects.find(candidate => {
                return (
                  rect.top >= candidate.rect.top - 0.5 && rect.bottom <= candidate.rect.bottom + 0.5
                );
              }) || pageRects[0];

            const pageRect = pageInfo?.rect;
            const relX = pageRect?.width
              ? Math.max(0, Math.min(1, (rect.left - pageRect.left) / pageRect.width))
              : 0;
            const relYTop = pageRect?.height
              ? Math.max(0, Math.min(1, (rect.top - pageRect.top) / pageRect.height))
              : 0;
            const relW = pageRect?.width
              ? Math.max(0, Math.min(1, rect.width / pageRect.width))
              : 0;
            const relH = pageRect?.height
              ? Math.max(0, Math.min(1, rect.height / pageRect.height))
              : 0;

            const width = relW * contentWidthPointsValue;
            const height = relH * contentHeightPointsValue;
            const x = marginPointsValue + relX * contentWidthPointsValue;
            const yTop = marginPointsValue + relYTop * contentHeightPointsValue;
            const y = pageHeightPointsValue - yTop - height;

            return {
              pageIndex: Math.max(0, Number(pageInfo?.index || 0)),
              fieldName: el.getAttribute('data-field-name') || `field_${idx + 1}`,
              value: el.getAttribute('data-field-value') || '',
              x,
              y,
              width,
              height,
            };
          });
        },
        {
          marginPointsValue: marginPoints,
          contentWidthPointsValue: contentWidthPoints,
          contentHeightPointsValue: contentHeightPoints,
          pageHeightPointsValue: pagePoints.height,
        }
      );

      const pdfBuffer = await page.pdf({
        format: PAGE_FORMATS[options.pageSize] || PAGE_FORMATS.letter,
        landscape: Boolean(options.landscape),
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });

      return {
        pdfBuffer: Buffer.from(pdfBuffer),
        anchors,
      };
    } catch (error) {
      lastError = error;
      const text = String(error?.message || error || '');
      const disconnected = text.includes('Connection closed') || text.includes('Target closed');
      if (disconnected && attempt === 1) {
        await closeBrowser().catch(() => {});
      } else {
        throw error;
      }
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  throw lastError || new Error('Failed to render PDF with puppeteer');
}
