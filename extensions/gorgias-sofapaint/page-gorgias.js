(() => {
  if (window.__gorgiasSofaPaintAttachmentBridge) return;
  window.__gorgiasSofaPaintAttachmentBridge = true;

  const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|heic|heif|avif)(?:$|[?#])/i;
  const IMAGE_MIME = /^image\//i;
  const URL_KEYS =
    /^(?:url|src|href|download_?url|attachment_?url|media_?url|source_?url|original_?url)$/i;
  const NAME_KEYS = /^(?:name|filename|file_?name|original_?name|display_?name)$/i;
  const MIME_KEYS = /^(?:mime|mime_?type|content_?type)$/i;
  const ATTACHMENT_URL_HINT = /(?:attachment|upload|download|media|file|storage|cdn)/i;
  const BLOCKED_HOSTS =
    /(?:^|\.)(?:adroll\.com|eyeota\.net|outbrain\.com|doubleclick\.net|google-analytics\.com|facebook\.com)$/i;
  const MESSAGE_BUBBLE_SELECTOR = '[class*="MessageBubble--messageBubble"]';

  function isUsefulUrl(value) {
    if (!/^(?:https?:\/\/|\/)/i.test(value) || /avatar|profile|emoji|logo/i.test(value))
      return false;
    try {
      return !BLOCKED_HOSTS.test(new URL(value, window.location.href).hostname);
    } catch {
      return false;
    }
  }

  function cleanName(value) {
    return String(value || '')
      .split(/[\\/]/)
      .pop()
      .split(/[?#]/)[0]
      .trim();
  }

  function attachmentUrlQuality(url, key = '') {
    let score = 0;
    if (/original|download|attachment|source/i.test(key)) score += 40;
    if (/original|download|attachment/i.test(url)) score += 25;
    if (/^(?:url|href)$/i.test(key)) score += 10;
    if (/thumbnail|thumb|preview|small|resize|width=|height=/i.test(`${key} ${url}`)) score -= 50;
    return score;
  }

  function inspectValue(value, results, seen, depth = 0) {
    if (value == null || depth > 7) return;
    if (typeof value !== 'object' || value instanceof Node || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 80).forEach(item => inspectValue(item, results, seen, depth + 1));
      return;
    }
    const entries = Object.entries(value).slice(0, 100);
    const names = entries
      .filter(
        ([key, child]) =>
          NAME_KEYS.test(key) && typeof child === 'string' && IMAGE_EXTENSION.test(child)
      )
      .map(([, child]) => cleanName(child));
    const mimes = entries
      .filter(
        ([key, child]) => MIME_KEYS.test(key) && typeof child === 'string' && IMAGE_MIME.test(child)
      )
      .map(([, child]) => child.split(';')[0]);
    const urls = entries
      .filter(
        ([key, child]) => URL_KEYS.test(key) && typeof child === 'string' && isUsefulUrl(child)
      )
      .map(([key, child]) => ({ key, url: child, quality: attachmentUrlQuality(child, key) }))
      .sort((left, right) => right.quality - left.quality);

    const preferred = urls[0];
    if (preferred && (names.length || IMAGE_EXTENSION.test(preferred.url))) {
      results.push({
        url: preferred.url,
        name: names[0] || '',
        mime: mimes[0] || '',
        quality: preferred.quality,
      });
    }
    entries.forEach(([, child]) => {
      inspectValue(child, results, seen, depth + 1);
    });
  }

  function attachmentMetadataFromPage() {
    const results = new Map();
    const ticketThread = document.querySelector('[aria-label="Ticket thread"]');
    const scanRoot = ticketThread || document;
    const selector = [
      '[data-testid*="attachment" i]',
      '[data-testid*="file" i]',
      '[class*="attachment" i]',
      '[class*="file-preview" i]',
      '[aria-label*="attachment" i]',
      'a',
      'button',
      '[role="button"]',
    ].join(',');
    const messageBubbles = [...scanRoot.querySelectorAll(MESSAGE_BUBBLE_SELECTOR)];
    const scopes = messageBubbles.length ? messageBubbles : [scanRoot];
    const candidates = [...new Set(scopes.flatMap(scope => [...scope.querySelectorAll(selector)]))];

    candidates.forEach(element => {
      const descriptor = `${element.getAttribute('data-testid') || ''} ${element.className || ''} ${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`;
      const looksLikeAttachment =
        /attachment|upload|download|file|\.(?:jpe?g|png|webp|gif|heic|heif|avif)\b/i.test(
          descriptor
        );
      const reactKeys = Object.keys(element).filter(key =>
        /^__(?:reactProps|reactFiber|reactInternalInstance)\$/i.test(key)
      );
      if (!looksLikeAttachment) return;

      const extracted = [];
      const visited = new WeakSet();
      reactKeys.forEach(key => inspectValue(element[key], extracted, visited));
      extracted.forEach(({ url, name, mime }) => {
        const identity = name ? `name:${name.toLowerCase()}` : `url:${url}`;
        const quality = attachmentUrlQuality(url);
        const existing = results.get(identity);
        if (existing && existing.quality >= quality) return;
        results.set(identity, { url, name, mime, quality });
      });
    });
    return [...results.values()].slice(0, 100);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read attachment'));
      reader.readAsDataURL(blob);
    });
  }

  function filenameFromResponse(response, fallback) {
    const disposition = response.headers.get('content-disposition') || '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename=["']?([^"';]+)["']?/i)?.[1];
    try {
      return cleanName(decodeURIComponent(encoded || plain || '')) || cleanName(fallback);
    } catch {
      return cleanName(plain) || cleanName(fallback);
    }
  }

  async function fetchAttachmentWithPageSession(attachment) {
    const rawUrl = String(attachment?.url || '');
    const url = new URL(rawUrl, window.location.href);
    if (!/^https?:$/.test(url.protocol) || BLOCKED_HOSTS.test(url.hostname)) {
      throw new Error('Blocked a non-attachment URL');
    }
    // Authenticate the same-origin Gorgias download endpoint, but do not carry
    // credentials onto its signed uploads.gorgias.io redirect. Signed storage
    // responses allow `*` CORS and browsers reject that combination when the
    // request remains in `include` mode after redirecting.
    const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`${attachment?.name || 'Photo'} returned ${response.status}`);
    const blob = await response.blob();
    if (blob.size > 30 * 1024 * 1024) throw new Error('Photo is larger than 30 MB');
    const mime = String(blob.type || response.headers.get('content-type') || '').split(';')[0];
    if (!mime.startsWith('image/')) throw new Error('The protected file is not an image');
    return {
      name: filenameFromResponse(response, attachment?.name),
      mime,
      size: blob.size,
      dataUrl: await blobToDataUrl(blob),
    };
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.type === 'GORGIAS_SOFAPAINT_SCAN_PAGE') {
      window.postMessage(
        {
          type: 'GORGIAS_SOFAPAINT_SCAN_PAGE_RESULT',
          requestId: event.data.requestId,
          attachments: attachmentMetadataFromPage(),
        },
        '*'
      );
      return;
    }
    if (event.data?.type !== 'GORGIAS_SOFAPAINT_FETCH_PAGE') return;
    fetchAttachmentWithPageSession(event.data.attachment)
      .then(image =>
        window.postMessage(
          {
            type: 'GORGIAS_SOFAPAINT_FETCH_PAGE_RESULT',
            requestId: event.data.requestId,
            ok: true,
            image,
          },
          '*'
        )
      )
      .catch(error =>
        window.postMessage(
          {
            type: 'GORGIAS_SOFAPAINT_FETCH_PAGE_RESULT',
            requestId: event.data.requestId,
            ok: false,
            message: error?.message || 'Could not read protected photo',
          },
          '*'
        )
      );
  });
})();
