let browserPromise = null;

async function launchBrowser() {
  let puppeteerLib = null;
  let launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  try {
    const imported = await import('puppeteer');
    puppeteerLib = imported.default || imported;
  } catch (_) {
    try {
      const imported = await import('puppeteer-core');
      puppeteerLib = imported.default || imported;

      try {
        const chromiumImported = await import('@sparticuz/chromium');
        const chromium = chromiumImported.default || chromiumImported;
        const executablePath = await chromium.executablePath();
        launchOptions = {
          headless: chromium.headless,
          executablePath,
          args: [...chromium.args, '--disable-dev-shm-usage'],
        };
      } catch (_) {
        const executablePath =
          process.env.PUPPETEER_EXECUTABLE_PATH ||
          process.env.CHROMIUM_EXECUTABLE_PATH ||
          undefined;
        launchOptions = {
          ...launchOptions,
          executablePath,
        };
      }
    } catch (coreError) {
      const error = new Error('Missing puppeteer dependency for PDF rendering');
      error.code = 'PDF_RENDERER_MISSING_DEPENDENCY';
      error.cause = coreError;
      throw error;
    }
  }

  return puppeteerLib.launch(launchOptions);
}

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch(error => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  await browser.close();
  browserPromise = null;
}
