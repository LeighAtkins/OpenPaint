let browserPromise = null;

const LOCAL_CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROMIUM_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  `${process.env.HOME || ''}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
].filter(Boolean);

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    const fs = await import('node:fs');
    return fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

async function resolveLocalExecutablePath() {
  for (const candidate of LOCAL_CHROME_CANDIDATES) {
    if (await fileExists(candidate)) return candidate;
  }
  return undefined;
}

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

      if (isServerlessRuntime()) {
        const chromiumImported = await import('@sparticuz/chromium');
        const chromium = chromiumImported.default || chromiumImported;
        const executablePath = await chromium.executablePath();
        launchOptions = {
          headless: chromium.headless,
          executablePath,
          args: [...chromium.args, '--disable-dev-shm-usage'],
        };
      } else {
        const executablePath = await resolveLocalExecutablePath();
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

  try {
    return await puppeteerLib.launch(launchOptions);
  } catch (launchError) {
    const message = String(launchError?.message || launchError || 'Unknown browser launch error');
    const missingLibHint =
      message.includes('error while loading shared libraries') ||
      message.includes('libnss3.so') ||
      message.includes('libnspr4.so') ||
      message.includes('Failed to launch') ||
      message.includes('Could not find Chrome');
    const error = new Error('Failed to launch browser for PDF rendering');
    error.code = missingLibHint ? 'PDF_RENDERER_MISSING_DEPENDENCY' : 'PDF_RENDER_FAILED';
    error.details = message;
    error.cause = launchError;
    throw error;
  }
}

export async function getBrowser() {
  if (isServerlessRuntime()) {
    return launchBrowser();
  }

  if (!browserPromise) {
    browserPromise = launchBrowser().catch(error => {
      browserPromise = null;
      throw error;
    });
  }

  const browser = await browserPromise;
  const connected = typeof browser?.isConnected === 'function' ? browser.isConnected() : true;
  if (!connected) {
    browserPromise = launchBrowser().catch(error => {
      browserPromise = null;
      throw error;
    });
    return browserPromise;
  }

  return browser;
}

export async function closeBrowser() {
  if (isServerlessRuntime()) return;
  if (!browserPromise) return;
  const browser = await browserPromise;
  await browser.close();
  browserPromise = null;
}

export { isServerlessRuntime };
