const DEFAULT_TARGET = 'https://sofapaint.vercel.app/';
const BLOCKED_ATTACHMENT_HOSTS =
  /(?:^|\.)(?:adroll\.com|eyeota\.net|outbrain\.com|doubleclick\.net|google-analytics\.com|facebook\.com)$/i;
const MAX_PARALLEL_DOWNLOADS = 4;
const attachmentCache = new Map();
const pendingAttachmentRedirects = new Map();
const recentAttachmentRedirects = new Map();
const attachmentRedirectOrigins = new Map();

function originalAttachmentIdentity(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/\/api\/attachment\/download\//i.test(url.pathname)) return '';
    if (
      [...url.searchParams.keys()].some(key =>
        /^(?:format|width|height|w|h|size|sz|resize)$/i.test(key)
      )
    ) {
      return '';
    }
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function cachedAttachmentRedirect(rawUrl) {
  const identity = originalAttachmentIdentity(rawUrl);
  const cached = identity ? recentAttachmentRedirects.get(identity) : null;
  if (!cached || cached.expiresAt <= Date.now()) {
    if (identity) recentAttachmentRedirects.delete(identity);
    return '';
  }
  return cached.url;
}

chrome.webRequest?.onBeforeRedirect?.addListener?.(
  details => {
    const originalIdentity =
      attachmentRedirectOrigins.get(details.url) || originalAttachmentIdentity(details.url);
    const pending = pendingAttachmentRedirects.get(details.url);
    if (pending?.tabId === details.tabId) pendingAttachmentRedirects.delete(details.url);
    try {
      if (new URL(details.redirectUrl).hostname === 'comfort-works.gorgias.com') {
        if (originalIdentity) attachmentRedirectOrigins.set(details.redirectUrl, originalIdentity);
        if (pending?.tabId === details.tabId)
          pendingAttachmentRedirects.set(details.redirectUrl, pending);
        return;
      }
    } catch {
      // Resolve below and let the signed URL fetch report a useful failure.
    }
    attachmentRedirectOrigins.delete(details.url);
    if (originalIdentity) {
      recentAttachmentRedirects.set(originalIdentity, {
        url: details.redirectUrl,
        expiresAt: Date.now() + 10 * 60_000,
      });
    }
    if (pending?.tabId === details.tabId) {
      clearTimeout(pending.timeout);
      pending.resolve(details.redirectUrl);
    }
  },
  { urls: ['https://comfort-works.gorgias.com/api/attachment/download/*'] }
);

function assertSafeAttachmentUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (BLOCKED_ATTACHMENT_HOSTS.test(url.hostname))
    throw new Error('Blocked a non-attachment tracking URL');
  return url.href;
}

function googleDriveFileId(rawUrl) {
  try {
    return (
      new URL(rawUrl).href.match(/^https:\/\/drive\.google\.com\/file\/d\/([^/?#]+)/i)?.[1] || ''
    );
  } catch {
    return '';
  }
}

function originalGorgiasAttachmentUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (
      url.hostname === 'comfort-works.gorgias.com' &&
      /\/api\/attachment\/download\//i.test(url.pathname)
    ) {
      [
        'format',
        'width',
        'height',
        'w',
        'h',
        'size',
        'sz',
        'quality',
        'resize',
        'crop',
        'fit',
        'dpr',
      ].forEach(key => url.searchParams.delete(key));
      url.hash = '';
    }
    return url.href;
  } catch {
    return String(rawUrl || '');
  }
}

function attachmentDownloadCandidates(attachment) {
  const detectedUrl = String(attachment?.url || '');
  const originalUrl = originalGorgiasAttachmentUrl(detectedUrl);
  const previewUrl = String(attachment?.previewUrl || '');
  const driveId = googleDriveFileId(originalUrl) || googleDriveFileId(previewUrl);
  const candidates = driveId
    ? [
        `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w4096`,
        `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`,
        originalUrl,
      ]
    : [originalUrl, detectedUrl, previewUrl];
  return [...new Set(candidates.filter(Boolean))];
}

function cleanFilename(value) {
  return String(value || '')
    .split(/[\\/]/)
    .pop()
    ?.split(/[?#]/)[0]
    ?.trim();
}

function normalizePartLabel(value) {
  const match = String(value || '')
    .trim()
    .toLowerCase()
    .match(/^(front|side|back|cushion)$/);
  return match?.[1] || '';
}

function labeledFilename(partLabel, originalName, mime) {
  const label = normalizePartLabel(partLabel);
  if (!label) return originalName;
  const extension = String(originalName || '').match(
    /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i
  )?.[0];
  const mimeExtension = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'image/heic': '.heic',
    'image/heif': '.heif',
  }[String(mime || '').toLowerCase()];
  return `${label}${extension || mimeExtension || '.jpg'}`;
}

function mimeFromFilename(name) {
  const extension = String(name || '')
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1];
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
      heic: 'image/heic',
      heif: 'image/heif',
    }[extension] || ''
  );
}

function sniffImageMime(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) return 'image/gif';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
  if (brand === 'avif' || brand === 'avis') return 'image/avif';
  if (/^(?:heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'image/heic';
  return '';
}

function filenameFromResponse(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename=["']?([^"';]+)["']?/i)?.[1];
  try {
    return cleanFilename(decodeURIComponent(encoded || plain || '')) || fallback;
  } catch {
    return cleanFilename(plain) || fallback;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function fetchAttachmentFallback(attachment) {
  let lastError = null;
  for (const candidate of attachmentDownloadCandidates(attachment)) {
    try {
      const safeUrl = assertSafeAttachmentUrl(candidate);
      const response = await fetch(safeUrl, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`${attachment.name} returned ${response.status}`);
      const blob = await response.blob();
      if (blob.size > 30 * 1024 * 1024) throw new Error(`${attachment.name} is larger than 30 MB`);
      const buffer = await blob.arrayBuffer();
      const name = filenameFromResponse(response, attachment.name);
      const declaredMime = String(blob.type || response.headers.get('content-type') || '').split(
        ';'
      )[0];
      const mime = declaredMime.startsWith('image/')
        ? declaredMime
        : mimeFromFilename(name) || sniffImageMime(buffer);
      if (!mime.startsWith('image/'))
        throw new Error(`${name} is not a supported image attachment`);
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hash = [...new Uint8Array(digest)]
        .map(value => value.toString(16).padStart(2, '0'))
        .join('');
      return {
        name,
        mime,
        size: blob.size,
        hash,
        dataUrl: `data:${mime};base64,${arrayBufferToBase64(buffer)}`,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Could not download ${attachment.name || 'Google Drive photo'}`);
}

async function waitForTab(tabId) {
  try {
    const current = await chrome.tabs.get?.(tabId);
    if (current?.status === 'complete') return;
  } catch {
    // The update listener below remains the source of truth.
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('SofaPaint took too long to open'));
    }, 20_000);
    const listener = (updatedId, info) => {
      if (updatedId !== tabId || info.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureSofaPaintBridge(tabId) {
  if (!chrome.scripting?.executeScript) return false;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-sofapaint.js'],
  });
  return true;
}

async function sendToSofaPaintBridge(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (initialError) {
    const injected = await ensureSofaPaintBridge(tabId).catch(() => false);
    if (!injected) throw initialError;
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function waitForSofaPaintReady(tabId, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let lastMessage = '';
  while (Date.now() < deadline) {
    try {
      const response = await sendToSofaPaintBridge(tabId, { type: 'SOFAPAINT_IMPORT_READY' });
      if (response?.ready) return;
      lastMessage = response?.message || 'SofaPaint is still starting';
    } catch (error) {
      lastMessage = error?.message || 'Waiting for the SofaPaint extension bridge';
    }
    await delay(150);
  }
  throw new Error(lastMessage || 'SofaPaint took too long to become ready');
}

async function getTargetTab() {
  const { sofapaintTarget = DEFAULT_TARGET } = await chrome.storage.sync.get('sofapaintTarget');
  let targetUrl;
  try {
    targetUrl = new URL(sofapaintTarget).href;
  } catch {
    targetUrl = DEFAULT_TARGET;
  }
  const openTabs = await chrome.tabs.query({});
  const matching = openTabs.find(tab => {
    try {
      return new URL(tab.url).origin === new URL(targetUrl).origin;
    } catch {
      return false;
    }
  });
  if (matching?.id) return matching;
  const created = await chrome.tabs.create({ url: targetUrl, active: true });
  if (!created.id) throw new Error('Could not open SofaPaint');
  await waitForTab(created.id);
  return created;
}

async function getOpenTargetTab() {
  const { sofapaintTarget = DEFAULT_TARGET } = await chrome.storage.sync.get('sofapaintTarget');
  let targetUrl;
  try {
    targetUrl = new URL(sofapaintTarget).href;
  } catch {
    targetUrl = DEFAULT_TARGET;
  }
  const openTabs = await chrome.tabs.query({});
  return (
    openTabs.find(tab => {
      try {
        return new URL(tab.url).origin === new URL(targetUrl).origin;
      } catch {
        return false;
      }
    }) || null
  );
}

async function getSofaPaintProjectStatus(message) {
  const target = await getOpenTargetTab();
  if (!target?.id) return { open: false };
  try {
    const status = await sendToSofaPaintBridge(target.id, {
      type: 'SOFAPAINT_PROJECT_STATUS',
      ticketId: String(message.ticketId || ''),
    });
    return { open: true, ...(status || {}) };
  } catch {
    return { open: true, ok: false, message: 'Reload SofaPaint to inspect the open project' };
  }
}

async function openSofaPaintProject(message) {
  const projectId = String(message.projectId || '').trim();
  if (!projectId) throw new Error('No saved SofaPaint project was supplied');
  const target = await getTargetTab();
  await waitForSofaPaintReady(target.id);
  const response = await sendToSofaPaintBridge(target.id, {
    type: 'SOFAPAINT_OPEN_PROJECT',
    projectId,
  });
  if (!response?.ok) throw new Error(response?.message || 'Could not open the SofaPaint project');
  await chrome.tabs.update(target.id, { active: true });
  return { opened: true };
}

async function sendToSofaPaint(tabId, message) {
  try {
    const response = await sendToSofaPaintBridge(tabId, message);
    if (!response?.ok) throw new Error(response?.message || 'SofaPaint did not accept the image');
  } catch (error) {
    throw new Error('Open or reload SofaPaint, then try again');
  }
}

function createConcurrencyLimiter(limit) {
  const queue = [];
  let active = 0;

  const runNext = () => {
    while (active < limit && queue.length) {
      const entry = queue.shift();
      active += 1;
      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  };

  return task =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
}

function reportImportProgress(detail) {
  chrome.runtime.sendMessage({ type: 'IMPORT_PROGRESS', ...detail }).catch(() => {});
}

async function readAttachment(sourceTabId, attachment) {
  const cacheKey = originalGorgiasAttachmentUrl(String(attachment?.url || ''));
  const cached = attachmentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.imagePromise;
  const imagePromise = readAttachmentUncached(sourceTabId, attachment);
  if (cacheKey) attachmentCache.set(cacheKey, { imagePromise, expiresAt: Date.now() + 5 * 60_000 });
  try {
    return await imagePromise;
  } catch (error) {
    if (cacheKey) attachmentCache.delete(cacheKey);
    throw error;
  }
}

function resolveAuthenticatedAttachmentRedirect(sourceTabId, rawUrl) {
  if (
    !chrome.webRequest?.onBeforeRedirect ||
    !chrome.scripting?.executeScript ||
    !/\/api\/attachment\/download\//i.test(rawUrl)
  ) {
    return Promise.resolve('');
  }
  const recent = cachedAttachmentRedirect(rawUrl);
  if (recent) return Promise.resolve(recent);
  const probeUrl = new URL(rawUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAttachmentRedirects.delete(probeUrl.href);
      reject(new Error('Original attachment redirect timed out'));
    }, 8_000);
    pendingAttachmentRedirects.set(probeUrl.href, { tabId: sourceTabId, resolve, timeout });
    chrome.scripting
      .executeScript({
        target: { tabId: sourceTabId },
        args: [probeUrl.href],
        func: url => {
          const image = document.createElement('img');
          image.hidden = true;
          image.alt = '';
          const cleanup = () => image.remove();
          image.addEventListener('load', cleanup, { once: true });
          image.addEventListener('error', cleanup, { once: true });
          document.body.appendChild(image);
          image.src = url;
          setTimeout(cleanup, 10_000);
        },
      })
      .catch(error => {
        const pending = pendingAttachmentRedirects.get(probeUrl.href);
        if (!pending) return;
        pendingAttachmentRedirects.delete(probeUrl.href);
        clearTimeout(timeout);
        reject(error);
      });
  });
}

async function readAttachmentUncached(sourceTabId, attachment) {
  const url = originalGorgiasAttachmentUrl(String(attachment?.url || ''));
  const normalizedAttachment = { ...attachment, url };
  if (/\/api\/attachment\/download\//i.test(url)) {
    // The signed-in Gorgias page is the most reliable authority for original
    // attachments. Its attachment cards use transformed thumbnail responses,
    // while the same query-free URL resolves to the full file in page context.
    // Ask the page first so a previously observed thumbnail redirect can never
    // satisfy an original-image import.
    try {
      const response = await chrome.tabs.sendMessage(sourceTabId, {
        type: 'FETCH_ATTACHMENT',
        attachment: normalizedAttachment,
      });
      if (response?.ok && response.image) {
        const quietImage = response.image;
        const quietDetails = await fingerprintImage(quietImage, attachment);
        const quietArea = quietDetails.width * quietDetails.height;
        const scannerLooksLikeThumbnail =
          Math.max(Number(attachment?.width) || 0, Number(attachment?.height) || 0) <= 320;
        const downloadLooksLikePreview =
          Math.max(quietDetails.width, quietDetails.height) < 1600 || quietArea < 1_500_000;
        if (scannerLooksLikeThumbnail && downloadLooksLikePreview) {
          try {
            const revealed = await chrome.tabs.sendMessage(sourceTabId, {
              type: 'FETCH_ATTACHMENT_ORIGINAL',
              attachment: normalizedAttachment,
            });
            if (revealed?.ok && revealed.image) {
              const revealedDetails = await fingerprintImage(revealed.image, {
                ...attachment,
                width: revealed.image.width,
                height: revealed.image.height,
              });
              const revealedArea = revealedDetails.width * revealedDetails.height;
              if (
                revealedArea > quietArea ||
                (revealedArea === quietArea &&
                  Number(revealed.image.size || 0) > Number(quietImage.size || 0))
              )
                return revealed.image;
            }
          } catch {
            // The quiet image remains a usable fallback if Gorgias cannot open
            // the attachment viewer in the current ticket render.
          }
        }
        return quietImage;
      }
    } catch {
      // Continue through the redirect resolver below.
    }
    try {
      const signedUrl = await resolveAuthenticatedAttachmentRedirect(sourceTabId, url);
      if (signedUrl) {
        return await fetchAttachmentFallback({
          ...attachment,
          url: signedUrl,
          previewUrl: '',
        });
      }
    } catch {
      // Fall through to the authenticated page bridge and preview fallback.
    }
  }
  if (googleDriveFileId(url) || /^https:\/\/images-signed\.gorgias\.io\//i.test(url)) {
    return fetchAttachmentFallback(normalizedAttachment);
  }
  try {
    const response = await chrome.tabs.sendMessage(sourceTabId, {
      type: 'FETCH_ATTACHMENT',
      attachment: normalizedAttachment,
    });
    if (!response?.ok || !response.image) {
      throw new Error(response?.message || 'Could not read photo');
    }
    return response.image;
  } catch {
    return fetchAttachmentFallback(normalizedAttachment);
  }
}

async function fingerprintImage(image, attachment) {
  const result = {
    width: Number(attachment?.width) || 0,
    height: Number(attachment?.height) || 0,
    byteSize: Number(image?.size) || 0,
    contentHash: String(image?.hash || ''),
    visualHash: '',
  };
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function')
    return result;

  let bitmap;
  try {
    const blob = await (await fetch(image.dataUrl)).blob();
    bitmap = await createImageBitmap(blob);
    result.width = bitmap.width;
    result.height = bitmap.height;
    const canvas = new OffscreenCanvas(9, 8);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 9, 8);
    const pixels = context.getImageData(0, 0, 9, 8).data;
    let visualHash = '';
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const offset = (y * 9 + x) * 4;
        const nextOffset = offset + 4;
        const luminance =
          pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
        const nextLuminance =
          pixels[nextOffset] * 0.299 +
          pixels[nextOffset + 1] * 0.587 +
          pixels[nextOffset + 2] * 0.114;
        visualHash += luminance > nextLuminance ? '1' : '0';
      }
    }
    result.visualHash = visualHash;
  } catch {
    // Some browser-native formats cannot be decoded in the service worker.
    // Their scanner dimensions still remain useful in the preview.
  } finally {
    bitmap?.close?.();
  }
  return result;
}

async function analyzeAttachments(message) {
  const sourceTabId = Number(message.sourceTabId);
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!sourceTabId || !attachments.length) return { analyses: [] };
  const limit = createConcurrencyLimiter(MAX_PARALLEL_DOWNLOADS);
  const analyses = await Promise.all(
    attachments.map((attachment, index) =>
      limit(async () => {
        try {
          const image = await readAttachment(sourceTabId, attachment);
          return { index, ok: true, ...(await fingerprintImage(image, attachment)) };
        } catch (error) {
          return { index, ok: false, message: error?.message || 'Could not inspect image' };
        }
      })
    )
  );
  return { analyses };
}

async function importAttachments(message) {
  const sourceTabId = Number(message.sourceTabId);
  if (!sourceTabId || !Array.isArray(message.attachments) || !message.attachments.length) {
    throw new Error('Select at least one ticket photo');
  }
  const target = await getTargetTab();
  await waitForSofaPaintReady(target.id);
  const batchId = `gorgias-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const total = message.attachments.length;
  const startedAt = Date.now();
  const ticketContext =
    message.ticketContext && typeof message.ticketContext === 'object' ? message.ticketContext : {};
  await sendToSofaPaint(target.id, { type: 'IMPORT_BEGIN', batchId, total, ticketContext });
  reportImportProgress({ batchId, stage: 'downloading', completed: 0, total });

  const hashes = new Set();
  let importedCount = 0;
  let duplicateCount = 0;
  let downloadedCount = 0;
  const errors = [];

  const limitDownload = createConcurrencyLimiter(MAX_PARALLEL_DOWNLOADS);
  const downloadTasks = message.attachments.map((attachment, sourceIndex) =>
    limitDownload(async () => {
      try {
        const image = await readAttachment(sourceTabId, attachment);
        return { attachment, image, sourceIndex };
      } catch (error) {
        return { attachment, error, sourceIndex };
      } finally {
        downloadedCount += 1;
        reportImportProgress({
          batchId,
          stage: 'downloading',
          completed: downloadedCount,
          total,
        });
      }
    })
  );

  for (const task of downloadTasks) {
    const result = await task;
    const { attachment, image, error } = result;
    try {
      if (error) throw error;
      if (hashes.has(image.hash)) {
        duplicateCount += 1;
        continue;
      }
      hashes.add(image.hash);
      await sendToSofaPaint(target.id, {
        type: 'IMPORT_IMAGE',
        batchId,
        index: importedCount,
        total,
        name: labeledFilename(attachment.partLabel, image.name, image.mime),
        mime: image.mime,
        hash: image.hash,
        dataUrl: image.dataUrl,
        partLabel: normalizePartLabel(attachment.partLabel),
      });
      importedCount += 1;
      reportImportProgress({
        batchId,
        stage: 'sending',
        completed: importedCount,
        total,
      });
    } catch (error) {
      errors.push(error?.message || `Could not import ${attachment.name}`);
    }
  }
  await sendToSofaPaint(target.id, {
    type: 'IMPORT_COMPLETE',
    batchId,
    importedCount,
    duplicateCount,
    errorCount: errors.length,
    total,
    ticketContext,
  });
  const elapsedMs = Date.now() - startedAt;
  reportImportProgress({
    batchId,
    stage: 'sent',
    completed: importedCount,
    total: importedCount,
    elapsedMs,
  });
  console.info('[Gorgias Import] Transfer complete', {
    total,
    importedCount,
    duplicateCount,
    errorCount: errors.length,
    elapsedMs,
  });
  return { importedCount, duplicateCount, errors, elapsedMs, targetTabId: target.id };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OPEN_SOFAPAINT_PROJECT') {
    openSofaPaintProject(message)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error =>
        sendResponse({ ok: false, message: error?.message || 'Could not open project' })
      );
    return true;
  }
  if (message?.type === 'GET_SOFAPAINT_PROJECT_STATUS') {
    getSofaPaintProjectStatus(message)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error =>
        sendResponse({ ok: false, message: error?.message || 'Could not inspect SofaPaint' })
      );
    return true;
  }
  if (message?.type === 'ANALYZE_ATTACHMENTS') {
    analyzeAttachments(message)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error =>
        sendResponse({ ok: false, message: error?.message || 'Image analysis failed' })
      );
    return true;
  }
  if (message?.type !== 'IMPORT_ATTACHMENTS') return false;
  importAttachments(message)
    .then(result => {
      const { targetTabId, ...response } = result;
      sendResponse({ ok: true, ...response });
      if (targetTabId) setTimeout(() => chrome.tabs.update(targetTabId, { active: true }), 50);
    })
    .catch(error => sendResponse({ ok: false, message: error?.message || 'Import failed' }));
  return true;
});
