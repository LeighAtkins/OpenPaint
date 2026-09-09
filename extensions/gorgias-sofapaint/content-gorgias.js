const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|heic|heif|avif)(?:$|[?#])/i;
const IMAGE_FILENAME = /([^\\/\s?&#=]+\.(?:jpe?g|png|webp|gif|heic|heif|avif))(?=$|[\s?&#])/i;
const ATTACHMENT_HINT = /(?:attachment|upload|media|file)/i;
const GOOGLE_DRIVE_FILE = /^https:\/\/drive\.google\.com\/file\/d\/([^/?#]+)/i;
const ATTACHMENT_SELECTOR = [
  '[data-testid*="attachment" i]',
  '[data-testid*="file" i]',
  '[class*="attachment" i]',
  '[class*="file-preview" i]',
  '[aria-label*="attachment" i]',
].join(',');
const URL_ATTRIBUTES = [
  'data-download-url',
  'data-attachment-url',
  'data-file-url',
  'data-media-url',
  'data-url',
  'data-href',
];
const BLOCKED_ATTACHMENT_HOSTS =
  /(?:^|\.)(?:adroll\.com|eyeota\.net|outbrain\.com|doubleclick\.net|google-analytics\.com|facebook\.com)$/i;
const TICKET_THREAD_SELECTOR = '[aria-label="Ticket thread"]';
const MESSAGE_BUBBLE_SELECTOR = '[class*="MessageBubble--messageBubble"]';
const MAX_LAZY_SCAN_STEPS = 80;
const MAX_ATTACHMENT_REVEALS = 80;
const LIGHTBOX_SLIDE_SELECTOR = 'img.yarl__slide_image[src]';
const ATTACHMENT_REVEAL_SELECTOR = [
  'a[href*="/api/attachment/download/"]',
  '[data-testid*="attachment" i]',
  '[class*="Attachment--preview" i]',
  '[class*="Attachment--attachment" i]',
  '[aria-label*="attachment" i]',
].join(',');
const IMAGE_PART_LABEL_PATTERNS = [
  {
    label: 'front',
    pattern:
      /\b(?:front(?:\s+(?:view|photo|image))?|vista\s+(?:frontal|de\s+frente)|frontal|vue\s+(?:de\s+face|avant)|vorderseite|ansicht\s+vorne|vista\s+frontale|voorkant|vista\s+frontal)\b|(?:正面|前面)/i,
  },
  {
    label: 'side',
    pattern:
      /\b(?:side(?:\s+(?:view|photo|image))?|vista\s+lateral|lateral|vue\s+laterale|seitenansicht|seite|vista\s+laterale|zijkant)\b|(?:側面|横面)/i,
  },
  {
    label: 'back',
    pattern:
      /\b(?:back(?:\s+(?:view|photo|image))?|rear(?:\s+view)?|vista\s+(?:trasera|traseira|posterior)|trasera|traseira|vue\s+arriere|ruckseite|vista\s+posteriore|achterkant)\b|(?:背面|後面)/i,
  },
  {
    label: 'cushion',
    pattern:
      /\b(?:cushions?(?:\s+(?:view|photo|image))?|vista\s+de\s+los\s+cojines|cojines|almohadones|almofadas|vue\s+des\s+coussins|coussins|kissen|cuscini|kussens)\b|(?:クッション|座面)/i,
  },
];

function assertSafeAttachmentUrl(rawUrl) {
  const url = new URL(rawUrl, window.location.href);
  if (BLOCKED_ATTACHMENT_HOSTS.test(url.hostname))
    throw new Error('Blocked a non-attachment tracking URL');
  return url.href;
}

function googleDriveFileId(rawUrl) {
  try {
    return new URL(rawUrl, window.location.href).href.match(GOOGLE_DRIVE_FILE)?.[1] || '';
  } catch {
    return '';
  }
}

function googleDrivePreviewUrl(rawUrl) {
  const id = googleDriveFileId(rawUrl);
  return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w4096` : '';
}

function ticketIdFromLocation() {
  return window.location.pathname.match(/\/(\d+)(?:\/)?$/)?.[1] || '';
}

function textFromFirst(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = (
      element?.textContent ||
      element?.getAttribute?.('alt') ||
      element?.getAttribute?.('value') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (value) return value;
  }
  return '';
}

function extractTicketContext() {
  const customerName = textFromFirst([
    '[aria-label="Breadcrumbs"] a[href*="/customer/"]',
    '[aria-label="Breadcrumbs"] a:last-of-type',
    'a[href*="/app/customer/"]',
    '[data-testid*="customer-name" i]',
  ]);
  const ticketText = ticketThreadRoot().textContent?.replace(/\s+/g, ' ').trim() || '';
  const skuText = textFromFirst([
    'button[aria-label="Copy SKU"]',
    '[class*="CopyableField" i]:has(button[aria-label="Copy SKU"]) [data-name="text"]',
    '[data-name="text"][class*="OrderSidePanelPreview" i]',
  ]);
  const productName = (
    textFromFirst([
      '[class*="CopyableField" i]:has(button[aria-label="Copy product title"]) > [data-name="text"]',
      '[class*="CopyableField" i]:has(button[aria-label="Copy product title"]) [data-name="text"]',
      'img[alt*="Slipcover" i]',
      'img[alt*="Cover" i]',
    ]) ||
    ticketText.match(/\bCS[A-Z0-9-]+\s+(.{1,140}?Slipcover)\b/i)?.[1] ||
    ''
  )
    .replace(/\s+-\s+Estimated delivery.*$/i, '')
    .replace(/\s+-\s*$/, '')
    .trim();
  const productSku = (
    skuText.match(/SKU:\s*([^\s]+)/i)?.[1] ||
    ticketText.match(/SKU:\s*([^\s]+)/i)?.[1] ||
    ticketText.match(/\b(CS[A-Z0-9]+(?:-[A-Z0-9]+){1,5})\b/i)?.[1] ||
    ''
  ).trim();
  const guideCode = productSku.split('__')[0]?.trim().toUpperCase() || '';
  return {
    ticketId: ticketIdFromLocation(),
    ticketUrl: window.location.href,
    customerName,
    productName,
    productSku,
    guideCode,
  };
}

function mergeTicketContext(target, candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const preferLonger = field => {
    const current = String(target[field] || '').trim();
    const next = String(source[field] || '').trim();
    if (next && (!current || next.length > current.length)) target[field] = next;
  };

  preferLonger('ticketId');
  preferLonger('ticketUrl');
  preferLonger('customerName');
  preferLonger('productName');
  preferLonger('productSku');

  const productSku = String(target.productSku || '').trim();
  const derivedGuide = productSku.split('__')[0]?.trim().toUpperCase() || '';
  const candidateGuide = String(source.guideCode || '')
    .trim()
    .toUpperCase();
  target.guideCode = derivedGuide || candidateGuide || String(target.guideCode || '');
  return target;
}

function cleanFilename(value) {
  return String(value || '')
    .split(/[\\/]/)
    .pop()
    ?.split(/[?#]/)[0]
    ?.trim();
}

function imagePartLabelFor(element) {
  const candidates = [
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.textContent,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const match = IMAGE_PART_LABEL_PATTERNS.find(entry => entry.pattern.test(normalized));
    if (match) return match.label;
  }
  return '';
}

function filenameFor(element, url, index) {
  const anchor = element.closest?.('a');
  const card = element.closest?.(ATTACHMENT_SELECTOR);
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url, window.location.href);
  } catch {
    // The scanner already validates the URL before this point.
  }
  const candidates = [
    anchor?.getAttribute('download'),
    element.getAttribute?.('download'),
    element.getAttribute?.('data-filename'),
    element.getAttribute?.('data-file-name'),
    card?.getAttribute?.('data-filename'),
    card?.getAttribute?.('data-file-name'),
    anchor?.getAttribute('title'),
    anchor?.getAttribute('aria-label'),
    element.getAttribute?.('title'),
    element.getAttribute?.('aria-label'),
    element.getAttribute?.('alt'),
    anchor?.textContent?.match(IMAGE_FILENAME)?.[1],
    card?.textContent?.match(IMAGE_FILENAME)?.[1],
    parsedUrl?.searchParams.get('filename'),
    parsedUrl?.searchParams.get('file_name'),
    parsedUrl?.searchParams.get('name'),
    parsedUrl && IMAGE_EXTENSION.test(parsedUrl.pathname)
      ? decodeURIComponent(parsedUrl.pathname)
      : '',
  ];
  for (const candidate of candidates) {
    const name = cleanFilename(candidate);
    if (name && name.length <= 180 && IMAGE_EXTENSION.test(name)) return name;
  }
  const driveId = googleDriveFileId(url);
  if (driveId) return `drive-${driveId}.jpg`;
  return `ticket-${ticketIdFromLocation() || 'photo'}-${index + 1}.jpg`;
}

function attachmentUrlFor(element) {
  if (element.matches?.('a[href]')) return element.getAttribute('href');
  for (const attribute of URL_ATTRIBUTES) {
    const value = element.getAttribute?.(attribute);
    if (value) return value;
  }
  const link = element.querySelector?.('a[href]');
  if (link) return link.getAttribute('href');
  for (const attribute of URL_ATTRIBUTES) {
    const nested = element.querySelector?.(`[${attribute}]`);
    const value = nested?.getAttribute(attribute);
    if (value) return value;
  }
  return '';
}

function previewUrlFor(element, downloadUrl) {
  const image = element.tagName === 'IMG' ? element : element.querySelector?.('img');
  if (image) return image.currentSrc || image.src || downloadUrl;
  const background = getComputedStyle(element).backgroundImage || '';
  const match = background.match(/url\(["']?(.+?)["']?\)/i);
  return match?.[1] || googleDrivePreviewUrl(downloadUrl) || downloadUrl;
}

function attachmentQuality(attachment) {
  let score = Number(attachment.quality || 0);
  score += Math.min((Number(attachment.width || 0) * Number(attachment.height || 0)) / 100000, 50);
  if (/original|download|attachment/i.test(attachment.url || '')) score += 20;
  if (/thumbnail|thumb|preview|small|resize|width=|height=/i.test(attachment.url || ''))
    score -= 40;
  return score;
}

function canonicalAttachmentUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''), window.location.href);
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
    return url.href;
  } catch {
    return String(rawUrl || '');
  }
}

function originalGorgiasAttachmentUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''), window.location.href);
    if (
      url.hostname === 'comfort-works.gorgias.com' &&
      /\/api\/attachment\/download\//i.test(url.pathname)
    )
      return canonicalAttachmentUrl(url.href);
    return url.href;
  } catch {
    return String(rawUrl || '');
  }
}

function dedupeAttachmentVariants(attachments) {
  const output = [];
  const indexByIdentity = new Map();
  attachments.forEach(attachment => {
    // Keep separately hosted files even when their names match. Gorgias often
    // exposes a preview and an original under the same filename, and the popup
    // needs both candidates to compare their decoded resolution and visual hash.
    const identity = `url:${canonicalAttachmentUrl(attachment.url)}`;
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex == null) {
      indexByIdentity.set(identity, output.length);
      output.push(attachment);
      return;
    }
    if (attachmentQuality(attachment) > attachmentQuality(output[existingIndex])) {
      output[existingIndex] = attachment;
    }
  });
  return output;
}

function isExcludedImage(image) {
  const label = `${image.alt || ''} ${image.getAttribute('aria-label') || ''}`.toLowerCase();
  if (/avatar|profile|logo|emoji|icon/.test(label)) return true;
  if (image.closest('header, nav, [role="navigation"], [class*="avatar" i]')) return true;
  const rect = image.getBoundingClientRect();
  const width = image.naturalWidth || rect.width;
  const height = image.naturalHeight || rect.height;
  return width > 0 && height > 0 && (width < 100 || height < 100);
}

function ticketThreadRoot() {
  const labelledThread = document.querySelector(TICKET_THREAD_SELECTOR);
  if (labelledThread) return labelledThread;
  const visibleMessage = [...document.querySelectorAll(MESSAGE_BUBBLE_SELECTOR)].find(
    element => element.getClientRects().length > 0
  );
  return scrollContainerFor(visibleMessage) || visibleMessage?.parentElement || document;
}

function queryTicketContent(root, selector) {
  const bubbles = [...root.querySelectorAll(MESSAGE_BUBBLE_SELECTOR)];
  const scopes = bubbles.length ? bubbles : [root];
  const results = [];
  const seen = new Set();
  scopes.forEach(scope => {
    if (scope.matches?.(selector) && !seen.has(scope)) {
      seen.add(scope);
      results.push(scope);
    }
    scope.querySelectorAll(selector).forEach(element => {
      if (seen.has(element)) return;
      seen.add(element);
      results.push(element);
    });
  });
  return results;
}

function scrollContainerFor(element) {
  let current = element?.parentElement || null;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if (
      current.scrollHeight > current.clientHeight + 1 &&
      /auto|scroll|overlay/i.test(style.overflowY || '')
    )
      return current;
    current = current.parentElement;
  }
  return null;
}

function waitForLazyRender() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 35)));
  });
}

function waitForElement(selector, timeoutMs = 450) {
  const current = document.querySelector(selector);
  if (current) return Promise.resolve(current);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) finish(element);
    });
    const timeout = setTimeout(() => finish(null), timeoutMs);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
  });
}

function revealKeyFor(element, index) {
  const anchor = element.matches?.('a[href]') ? element : element.closest?.('a[href]');
  const image = element.matches?.('img') ? element : element.querySelector?.('img');
  const rawUrl =
    anchor?.getAttribute('href') || image?.getAttribute('src') || attachmentUrlFor(element);
  const name = String(
    cleanFilename(
      anchor?.getAttribute('aria-label') ||
        image?.getAttribute('alt') ||
        element.getAttribute?.('aria-label') ||
        ''
    ) || ''
  ).toLowerCase();
  const identity = `${canonicalAttachmentUrl(rawUrl)}|${name}`;
  return identity === '|' ? `attachment-${index}` : identity;
}

function attachmentRevealTargets(root, { includeDirectDownloads = false } = {}) {
  const targets = [];
  const seen = new Set();
  queryTicketContent(root, ATTACHMENT_REVEAL_SELECTOR).forEach(element => {
    if (element.closest?.('.yarl__root')) return;
    const anchor = element.matches?.('a[href]') ? element : element.closest?.('a[href]');
    const target = element.querySelector?.('img') || element;
    const identityElement = anchor || element;
    if (seen.has(identityElement)) return;
    const descriptor = `${identityElement.getAttribute?.('href') || ''} ${identityElement.getAttribute?.('aria-label') || ''} ${identityElement.getAttribute?.('data-testid') || ''} ${identityElement.className || ''}`;
    if (!IMAGE_EXTENSION.test(descriptor) && !ATTACHMENT_HINT.test(descriptor)) return;
    const directUrl = anchor?.getAttribute('href') || attachmentUrlFor(identityElement);
    try {
      const parsed = new URL(String(directUrl || ''), window.location.href);
      // Gorgias attachment cards already expose the original download route.
      // Opening their full-screen viewer only causes black flashes; dimensions
      // are measured later when the popup downloads this query-free URL.
      if (!includeDirectDownloads && /\/api\/attachment\/download\//i.test(parsed.pathname)) return;
    } catch {
      // Cards without a usable URL still need the lightbox fallback.
    }
    seen.add(identityElement);
    targets.push(target);
  });
  return targets;
}

function revealTargetUrl(target) {
  const anchor = target.matches?.('a[href]') ? target : target.closest?.('a[href]');
  return canonicalAttachmentUrl(anchor?.getAttribute('href') || attachmentUrlFor(anchor || target));
}

function revealTargetName(target) {
  const anchor = target.matches?.('a[href]') ? target : target.closest?.('a[href]');
  const image = target.matches?.('img') ? target : target.querySelector?.('img');
  return String(
    cleanFilename(anchor?.getAttribute('aria-label') || image?.getAttribute('alt') || '') || ''
  ).toLowerCase();
}

function matchingAttachmentRevealTarget(root, attachment) {
  const expectedUrl = canonicalAttachmentUrl(attachment?.url);
  const expectedName = String(cleanFilename(attachment?.name) || '').toLowerCase();
  const targets = attachmentRevealTargets(root, { includeDirectDownloads: true });
  return (
    targets.find(candidate => revealTargetUrl(candidate) === expectedUrl) ||
    targets.find(candidate => expectedName && revealTargetName(candidate) === expectedName) ||
    null
  );
}

async function findVirtualizedAttachmentTarget(root, attachment, scrollContainer) {
  let target = matchingAttachmentRevealTarget(root, attachment);
  if (target || !scrollContainer) return target;

  const viewport = Math.max(1, scrollContainer.clientHeight);
  const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - viewport);
  const rememberedTop = Number(attachment?.ticketScrollTop);
  const positions = [];
  if (Number.isFinite(rememberedTop))
    positions.push(Math.max(0, Math.min(maxScrollTop, rememberedTop)));
  const stride = Math.max(240, Math.floor(viewport * 0.8));
  for (let position = 0; position < maxScrollTop; position += stride) positions.push(position);
  positions.push(maxScrollTop);

  for (const position of [...new Set(positions)].slice(0, MAX_LAZY_SCAN_STEPS)) {
    scrollContainer.scrollTop = position;
    scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    await waitForLazyRender();
    target = matchingAttachmentRevealTarget(root, attachment);
    if (target) return target;
  }
  return null;
}

function waitForImagePixels(image, timeoutMs = 2500) {
  if (image?.complete && image.naturalWidth > 0) return Promise.resolve(image);
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image?.removeEventListener?.('load', finish);
      image?.removeEventListener?.('error', finish);
      resolve(image);
    };
    const timeout = setTimeout(finish, timeoutMs);
    image?.addEventListener?.('load', finish, { once: true });
    image?.addEventListener?.('error', finish, { once: true });
  });
}

async function revealAndFetchOriginalAttachment(attachment) {
  const root = ticketThreadRoot();
  const scrollContainer = scrollContainerFor(root);
  const originalScrollTop = scrollContainer?.scrollTop || 0;

  // Keep Gorgias's full-screen black viewer out of sight while still allowing
  // it to load and authorize the original attachment in the signed-in page.
  const veil = document.createElement('style');
  veil.dataset.sofapaintAttachmentReveal = 'true';
  veil.textContent = '.yarl__root{opacity:0!important;pointer-events:none!important}';
  document.documentElement.appendChild(veil);
  try {
    await closeAttachmentLightbox();
    const target = await findVirtualizedAttachmentTarget(root, attachment, scrollContainer);
    if (!target) throw new Error('Could not find the attachment card to request its original file');
    dispatchRevealClick(target);
    const slide = await waitForElement(LIGHTBOX_SLIDE_SELECTOR, 2500);
    if (!slide) throw new Error('Gorgias did not open the original attachment');
    await waitForImagePixels(slide);
    const slideUrl = canonicalAttachmentUrl(slide.currentSrc || slide.src || expectedUrl);
    const image = await fetchAttachmentWithSession({
      ...attachment,
      url: slideUrl || expectedUrl,
      previewUrl: '',
    });
    return {
      ...image,
      width: Number(slide.naturalWidth) || 0,
      height: Number(slide.naturalHeight) || 0,
    };
  } finally {
    await closeAttachmentLightbox();
    veil.remove();
    if (scrollContainer) {
      scrollContainer.scrollTop = originalScrollTop;
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }
}

function dispatchRevealClick(target) {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  });
  // Gorgias attachment cards also contain target=_blank links. Cancelling the
  // native navigation still lets React's card handler reveal the lightbox.
  event.preventDefault();
  target.dispatchEvent(event);
}

async function closeAttachmentLightbox() {
  const root = document.querySelector('.yarl__root');
  if (!root) return;
  const closeButton = root.querySelector(
    [
      'button[aria-label="Close"]',
      'button[aria-label="Close image"]',
      'button.yarl__button_close',
      '.yarl__button_close',
    ].join(',')
  );
  if (closeButton) {
    dispatchRevealClick(closeButton);
  } else {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
  }
  if (!document.querySelector('.yarl__root')) return;
  await Promise.race([
    new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.yarl__root')) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 300);
    }),
    new Promise(resolve => setTimeout(resolve, 300)),
  ]);
}

async function revealCurrentAttachmentSlides(
  root,
  revealState,
  onReveal,
  { includeDirectDownloads = false } = {}
) {
  while (revealState.keys.size < MAX_ATTACHMENT_REVEALS) {
    // Closing Gorgias's YARL viewer can rerender the message bubble and replace
    // every attachment-card node. Rediscover the cards before each click rather
    // than retaining detached references from the first render.
    const targets = attachmentRevealTargets(root, { includeDirectDownloads });
    let target = null;
    let key = '';
    for (let index = 0; index < targets.length; index += 1) {
      const candidateKey = revealKeyFor(targets[index], index);
      if (revealState.keys.has(candidateKey)) continue;
      target = targets[index];
      key = candidateKey;
      break;
    }
    if (!target) break;
    revealState.keys.add(key);
    dispatchRevealClick(target);
    const slide = await waitForElement(LIGHTBOX_SLIDE_SELECTOR);
    if (!slide) {
      revealState.failedAttempts += 1;
      continue;
    }
    await waitForLazyRender();
    await onReveal();
    await closeAttachmentLightbox();
    await waitForLazyRender();
  }
}

function mergeScannedAttachments(target, scan) {
  for (const attachment of scan.attachments || []) target.push(attachment);
}

function requestPageAttachmentMetadata() {
  return new Promise(resolve => {
    const requestId = `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve([]);
    }, 800);
    const onMessage = event => {
      if (
        event.source !== window ||
        event.data?.type !== 'GORGIAS_SOFAPAINT_SCAN_PAGE_RESULT' ||
        event.data.requestId !== requestId
      )
        return;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(Array.isArray(event.data.attachments) ? event.data.attachments : []);
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'GORGIAS_SOFAPAINT_SCAN_PAGE', requestId }, '*');
  });
}

function scanTicketImages(pageAttachments = [], root = ticketThreadRoot()) {
  const found = [];
  const seenUrls = new Set();
  const namedPageAttachments = new Map(
    pageAttachments
      .filter(attachment => IMAGE_EXTENSION.test(String(attachment?.name || '')))
      .map(attachment => [String(attachment.name).trim().toLowerCase(), attachment])
  );
  const hasNamedPageAttachments = pageAttachments.some(attachment =>
    IMAGE_EXTENSION.test(String(attachment?.name || ''))
  );
  const add = (element, rawUrl) => {
    if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return;
    let detectedUrl;
    try {
      detectedUrl = new URL(rawUrl, window.location.href).href;
    } catch {
      return;
    }
    const url = originalGorgiasAttachmentUrl(detectedUrl);
    if (seenUrls.has(url)) return;
    const image = element.tagName === 'IMG' ? element : element.querySelector?.('img');
    const card = element.closest?.(ATTACHMENT_SELECTOR) || element.matches?.(ATTACHMENT_SELECTOR);
    const partLabel = imagePartLabelFor(element);
    const rawCandidateName = filenameFor(image || element, url, found.length);
    const anonymousPreview = /^ticket-(?:\d+|photo)-\d+\.jpg$/i.test(rawCandidateName);
    const candidateName = partLabel && anonymousPreview ? `${partLabel}.jpg` : rawCandidateName;
    const pageOriginal = namedPageAttachments.get(String(candidateName).trim().toLowerCase());
    if (
      image &&
      pageOriginal?.url &&
      canonicalAttachmentUrl(pageOriginal.url) !== canonicalAttachmentUrl(url) &&
      attachmentQuality(pageOriginal) >
        attachmentQuality({ url, width: image.naturalWidth, height: image.naturalHeight })
    )
      return;
    const explicitAttachment =
      Boolean(card) ||
      Boolean(partLabel) ||
      Boolean(googleDriveFileId(url)) ||
      element.hasAttribute?.('download') ||
      URL_ATTRIBUTES.some(attribute => element.hasAttribute?.(attribute)) ||
      ATTACHMENT_HINT.test(url) ||
      IMAGE_EXTENSION.test(url) ||
      IMAGE_EXTENSION.test(candidateName);
    const trustedSmallAttachment =
      Boolean(card) ||
      Boolean(partLabel) ||
      Boolean(googleDriveFileId(url)) ||
      element.hasAttribute?.('download') ||
      Boolean(element.closest?.('a[download]')) ||
      URL_ATTRIBUTES.some(attribute => element.hasAttribute?.(attribute)) ||
      ATTACHMENT_HINT.test(url);
    if (image && isExcludedImage(image) && !trustedSmallAttachment) return;
    if (!image && !explicitAttachment) return;
    // Gorgias renders anonymous thumbnail URLs alongside named attachment
    // records in React props. Importing both creates a broken blank view plus a
    // second, lower-resolution copy of the real image.
    if (anonymousPreview && hasNamedPageAttachments) return;
    seenUrls.add(url);
    found.push({
      url,
      name: candidateName,
      previewUrl: previewUrlFor(element, detectedUrl),
      width: image?.naturalWidth || 0,
      height: image?.naturalHeight || 0,
      quality: anonymousPreview ? -60 : 0,
      partLabel,
      sourceType:
        Boolean(card) || /\/api\/attachment\/download\//i.test(url)
          ? 'attachment'
          : Boolean(partLabel) || Boolean(googleDriveFileId(url))
            ? 'linked-photo'
            : 'inline',
    });
  };

  queryTicketContent(root, 'a[href]').forEach(anchor => {
    const image = anchor.querySelector('img');
    if (
      image ||
      anchor.hasAttribute('download') ||
      ATTACHMENT_HINT.test(anchor.href) ||
      googleDriveFileId(anchor.href) ||
      imagePartLabelFor(anchor)
    ) {
      add(anchor, anchor.href);
    }
  });
  queryTicketContent(root, 'img[src]').forEach(image => {
    const anchor = image.closest('a[href]');
    add(image, anchor?.href || image.currentSrc || image.src);
  });
  document.querySelectorAll('img.yarl__slide_image[src]').forEach(image => {
    let slideUrl;
    try {
      slideUrl = new URL(image.currentSrc || image.src, window.location.href).href;
    } catch {
      return;
    }
    const canonical = canonicalAttachmentUrl(slideUrl);
    const existing = found.find(attachment => canonicalAttachmentUrl(attachment.url) === canonical);
    if (existing) {
      existing.url = slideUrl;
      existing.width = Math.max(Number(existing.width) || 0, image.naturalWidth || 0);
      existing.height = Math.max(Number(existing.height) || 0, image.naturalHeight || 0);
      existing.previewUrl = slideUrl;
      existing.quality = Math.max(Number(existing.quality) || 0, 100);
      return;
    }
    add(image, slideUrl);
  });
  queryTicketContent(root, ATTACHMENT_SELECTOR).forEach(card => {
    add(card, attachmentUrlFor(card));
  });
  queryTicketContent(root, URL_ATTRIBUTES.map(attribute => `[${attribute}]`).join(',')).forEach(
    element => {
      add(element, attachmentUrlFor(element));
    }
  );
  pageAttachments.forEach(attachment => {
    if (!attachment?.url) return;
    let detectedUrl;
    try {
      detectedUrl = new URL(attachment.url, window.location.href).href;
    } catch {
      return;
    }
    const url = originalGorgiasAttachmentUrl(detectedUrl);
    if (seenUrls.has(url)) return;
    seenUrls.add(url);
    const name = cleanFilename(attachment.name) || filenameFor(document.body, url, found.length);
    found.push({
      url,
      name,
      previewUrl: detectedUrl,
      width: 0,
      height: 0,
      quality: Number(attachment.quality || 0),
      partLabel: String(attachment.partLabel || '')
        .trim()
        .toLowerCase(),
      sourceType: 'attachment',
    });
  });

  return {
    ...extractTicketContext(),
    attachments: dedupeAttachmentVariants(found),
  };
}

function isUtilityAttachment(attachment) {
  const name = String(attachment?.name || '').toLowerCase();
  if (/^(?:simpleline|spacer|divider|tracking[-_]?pixel)/i.test(name)) return true;
  const width = Number(attachment?.width) || 0;
  const height = Number(attachment?.height) || 0;
  if (!width || !height) return false;
  const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  return Math.min(width, height) <= 16 || ratio >= 12;
}

function selectTicketPhotoCandidates(attachments) {
  const deduped = dedupeAttachmentVariants(attachments).filter(item => !isUtilityAttachment(item));
  const hasRealAttachments = deduped.some(item => item.sourceType === 'attachment');
  if (!hasRealAttachments) return deduped;
  return deduped.filter(item => item.sourceType !== 'inline');
}

async function scanEntireTicket() {
  const root = ticketThreadRoot();
  const scrollContainer = scrollContainerFor(root);
  const originalScrollTop = scrollContainer?.scrollTop || 0;
  const collected = [];
  const collectedContext = {};
  const revealState = { keys: new Set(), failedAttempts: 0 };
  const scanVeil = document.createElement('style');
  scanVeil.dataset.sofapaintAttachmentScan = 'true';
  scanVeil.textContent = '.yarl__root{opacity:0!important;pointer-events:none!important}';
  document.documentElement.appendChild(scanVeil);

  const scanCurrentRender = async () => {
    const pageAttachments = await requestPageAttachmentMetadata();
    const scan = scanTicketImages(pageAttachments, root);
    if (scrollContainer) {
      scan.attachments = (scan.attachments || []).map(attachment => ({
        ...attachment,
        ticketScrollTop: scrollContainer.scrollTop,
      }));
    }
    mergeScannedAttachments(collected, scan);
    mergeTicketContext(collectedContext, scan);
  };

  try {
    if (!scrollContainer) {
      await scanCurrentRender();
      await revealCurrentAttachmentSlides(root, revealState, scanCurrentRender, {
        includeDirectDownloads: true,
      });
    } else {
      const viewport = Math.max(1, scrollContainer.clientHeight);
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - viewport);
      const stride = Math.max(240, Math.floor(viewport * 0.8));
      const positions = [];
      for (let position = 0; position < maxScrollTop; position += stride) positions.push(position);
      positions.push(maxScrollTop);

      const boundedPositions =
        positions.length <= MAX_LAZY_SCAN_STEPS
          ? positions
          : Array.from({ length: MAX_LAZY_SCAN_STEPS }, (_value, index) =>
              Math.round((maxScrollTop * index) / (MAX_LAZY_SCAN_STEPS - 1))
            );

      for (const position of [...new Set(boundedPositions)]) {
        scrollContainer.scrollTop = position;
        scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
        await waitForLazyRender();
        await scanCurrentRender();
        await revealCurrentAttachmentSlides(root, revealState, scanCurrentRender, {
          includeDirectDownloads: true,
        });
      }
    }
  } finally {
    await closeAttachmentLightbox();
    scanVeil.remove();
    if (scrollContainer) {
      scrollContainer.scrollTop = originalScrollTop;
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }

  mergeTicketContext(collectedContext, extractTicketContext());

  return {
    ...collectedContext,
    attachments: selectTicketPhotoCandidates(collected),
  };
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

async function fetchAttachment(attachment) {
  const safeUrl = assertSafeAttachmentUrl(attachment.url);
  // The Gorgias endpoint needs the page session, while its signed storage
  // redirect must be fetched without cross-origin credentials.
  const response = await fetch(safeUrl, { credentials: 'same-origin', cache: 'no-store' });
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
  if (!mime.startsWith('image/')) throw new Error(`${name} is not a supported image attachment`);
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
}

function requestPageAttachment(attachment) {
  return new Promise((resolve, reject) => {
    const requestId = `fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Protected photo request timed out'));
    }, 20_000);
    const onMessage = event => {
      if (
        event.source !== window ||
        event.data?.type !== 'GORGIAS_SOFAPAINT_FETCH_PAGE_RESULT' ||
        event.data.requestId !== requestId
      )
        return;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (!event.data.ok || !event.data.image) {
        reject(new Error(event.data.message || 'Could not read protected photo'));
        return;
      }
      resolve(event.data.image);
    };
    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        type: 'GORGIAS_SOFAPAINT_FETCH_PAGE',
        requestId,
        attachment,
      },
      '*'
    );
  });
}

async function finalizeFetchedImage(image, attachment) {
  const dataUrl = String(image?.dataUrl || '');
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match || !match[1].startsWith('image/')) throw new Error('Protected file is not an image');
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
  return {
    name: cleanFilename(image.name) || cleanFilename(attachment?.name) || 'photo.jpg',
    mime: match[1],
    size: Number(image.size) || bytes.byteLength,
    hash,
    dataUrl,
  };
}

async function fetchAttachmentWithSession(attachment) {
  const candidates = [...new Set([attachment?.url, attachment?.previewUrl].filter(Boolean))];
  let lastError = null;
  for (const url of candidates) {
    const candidate = { ...attachment, url };
    try {
      const image = await requestPageAttachment(candidate);
      return await finalizeFetchedImage(image, candidate);
    } catch (error) {
      lastError = error;
    }
    try {
      return await fetchAttachment(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not read image');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PROBE_ATTACHMENT_REDIRECT') {
    let image = null;
    try {
      const url = assertSafeAttachmentUrl(message.url);
      image = document.createElement('img');
      image.hidden = true;
      image.alt = '';
      const cleanup = () => image?.remove();
      image.addEventListener('load', cleanup, { once: true });
      image.addEventListener('error', cleanup, { once: true });
      document.body.appendChild(image);
      image.src = url;
      setTimeout(cleanup, 10_000);
      sendResponse({ ok: true });
    } catch (error) {
      image?.remove();
      sendResponse({ ok: false, message: error?.message || 'Could not request original photo' });
    }
    return false;
  }
  if (message?.type === 'SCAN_TICKET') {
    scanEntireTicket()
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error =>
        sendResponse({ ok: false, message: error?.message || 'Could not scan ticket' })
      );
    return true;
  }
  if (message?.type === 'FETCH_ATTACHMENT') {
    fetchAttachmentWithSession(message.attachment)
      .then(result => sendResponse({ ok: true, image: result }))
      .catch(error =>
        sendResponse({ ok: false, message: error?.message || 'Could not read image' })
      );
    return true;
  }
  if (message?.type === 'FETCH_ATTACHMENT_ORIGINAL') {
    revealAndFetchOriginalAttachment(message.attachment)
      .then(result => sendResponse({ ok: true, image: result }))
      .catch(error =>
        sendResponse({
          ok: false,
          message: error?.message || 'Could not reveal the original image',
        })
      );
    return true;
  }
  return false;
});
