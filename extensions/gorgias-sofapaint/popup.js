const list = document.getElementById('attachmentList');
const status = document.getElementById('status');
const actions = document.getElementById('actions');
const importButton = document.getElementById('importBtn');
const targetInput = document.getElementById('targetInput');
const ticketMeta = document.getElementById('ticketMeta');
const progress = document.getElementById('importProgress');
const progressBar = document.getElementById('importProgressBar');
const progressText = document.getElementById('importProgressText');
const projectStatus = document.getElementById('projectStatus');
let sourceTabId = null;
let attachments = [];
let ticketContext = {};
let analysisRun = 0;
let existingProjectStatus = null;
let currentScanCache = null;
const selectionOverrides = new Map();
const SCAN_CACHE_TTL_MS = 15 * 60_000;
const SCAN_CACHE_PREFIX = 'gorgiasSofaPaintScan:v11:';

function ticketIdFromUrl(url) {
  try {
    return new URL(url).pathname.match(/\/(\d+)\/?$/)?.[1] || '';
  } catch {
    return '';
  }
}

async function readCachedScan(tab) {
  const ticketId = ticketIdFromUrl(tab?.url || '');
  if (!ticketId || !chrome.storage?.session) return null;
  const key = `${SCAN_CACHE_PREFIX}${ticketId}`;
  const stored = await chrome.storage.session.get(key).catch(() => ({}));
  const cached = stored?.[key];
  if (!cached || Date.now() - Number(cached.savedAt || 0) > SCAN_CACHE_TTL_MS) return null;
  return cached;
}

async function writeCachedScan(analyzed = false) {
  const ticketId = String(ticketContext.ticketId || '').trim();
  if (!ticketId || !chrome.storage?.session) return;
  const key = `${SCAN_CACHE_PREFIX}${ticketId}`;
  currentScanCache = {
    savedAt: Date.now(),
    analyzed,
    attachments,
    ticketContext,
  };
  await chrome.storage.session.set({ [key]: currentScanCache }).catch(() => {});
}

async function sendToGorgiasTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (initialError) {
    if (!chrome.scripting?.executeScript) throw initialError;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['page-gorgias.js'],
      world: 'MAIN',
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-gorgias.js'],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function setStatus(message, kind = '') {
  status.textContent = message;
  status.dataset.kind = kind;
}

function setProgress(stage, completed, total) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCompleted = Math.max(0, Math.min(safeTotal, Number(completed) || 0));
  const percent = Math.round((safeCompleted / safeTotal) * 100);
  const labels = {
    downloading: 'Downloading',
    sending: 'Sending',
    sent: 'Opening in SofaPaint',
  };
  progress.hidden = false;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${labels[stage] || 'Importing'} ${safeCompleted} of ${safeTotal}`;
}

function selectedAttachments() {
  const selected = new Set(
    [...document.querySelectorAll('[data-attachment-index]:checked')].map(input =>
      Number(input.dataset.attachmentIndex)
    )
  );
  return attachments.filter((_item, index) => selected.has(index));
}

function attachmentSelectionKey(attachment) {
  return String(
    attachment.contentHash || attachment.url || attachment.previewUrl || attachment.name || ''
  );
}

async function ensureAttachmentHostAccess(selected) {
  const origins = [
    ...new Set(
      selected
        .map(attachment => {
          try {
            return `${new URL(attachment.url).origin}/*`;
          } catch {
            return '';
          }
        })
        .filter(Boolean)
    ),
  ];
  if (!origins.length) return true;
  const existing = await chrome.permissions.contains({ origins });
  return existing || chrome.permissions.request({ origins });
}

function updateSelection() {
  const count = selectedAttachments().length;
  importButton.disabled = count === 0;
  importButton.textContent = count
    ? `Send ${count} photo${count === 1 ? '' : 's'} to SofaPaint`
    : 'Send selected to SofaPaint';
}

function attachmentQualityText(attachment) {
  const resolution = GorgiasAttachmentQuality.formatResolution(attachment);
  if (attachment.alreadyImported) return `${resolution} · Already in open project`;
  if (attachment.excludedAsLowQuality) return `${resolution} · Lower-quality duplicate`;
  if (attachment.visualHash || attachment.contentHash) return `${resolution} · Best available`;
  return attachment.width && attachment.height ? resolution : 'Checking resolution…';
}

function renderAttachments() {
  list.replaceChildren();
  attachments.forEach((attachment, index) => {
    const label = document.createElement('label');
    label.className = 'attachment';
    const image = document.createElement('img');
    image.src = attachment.previewUrl;
    image.alt = '';
    image.addEventListener('error', () => {
      image.removeAttribute('src');
      image.dataset.unavailable = 'true';
    });
    const copy = document.createElement('span');
    copy.className = 'attachment-copy';
    const name = document.createElement('strong');
    name.textContent = attachment.partLabel
      ? `${attachment.partLabel[0].toUpperCase()}${attachment.partLabel.slice(1)} · ${attachment.name}`
      : attachment.name;
    const dimensions = document.createElement('span');
    dimensions.textContent = attachmentQualityText(attachment);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const selectionKey = attachmentSelectionKey(attachment);
    const defaultChecked = !attachment.excludedAsLowQuality && !attachment.alreadyImported;
    checkbox.checked = selectionOverrides.has(selectionKey)
      ? Boolean(selectionOverrides.get(selectionKey)) && !attachment.alreadyImported
      : defaultChecked;
    checkbox.disabled = Boolean(attachment.alreadyImported);
    checkbox.dataset.attachmentIndex = String(index);
    checkbox.addEventListener('change', () => {
      selectionOverrides.set(selectionKey, checkbox.checked);
      updateSelection();
    });
    copy.append(name, dimensions);
    label.append(image, copy, checkbox);
    if (attachment.excludedAsLowQuality) {
      label.classList.add('attachment-low-quality');
      label.title = 'A larger version of this same photo is selected instead.';
    }
    if (attachment.alreadyImported) {
      label.classList.add('attachment-imported');
      label.title = 'This exact photo is already recorded in the open SofaPaint project.';
    }
    list.appendChild(label);
  });
  actions.hidden = attachments.length === 0;
  status.hidden = attachments.length > 0;
  updateSelection();
}

function applyExistingProjectFlags() {
  const hashes = new Set(
    existingProjectStatus?.sameTicket && Array.isArray(existingProjectStatus.importedImageHashes)
      ? existingProjectStatus.importedImageHashes.map(hash => String(hash || '').toLowerCase())
      : []
  );
  attachments = attachments.map(attachment => ({
    ...attachment,
    alreadyImported: Boolean(
      attachment.contentHash && hashes.has(String(attachment.contentHash).toLowerCase())
    ),
  }));
}

function renderExistingProjectStatus() {
  if (!existingProjectStatus?.open || !existingProjectStatus?.ok) {
    projectStatus.hidden = true;
    projectStatus.replaceChildren();
    return;
  }
  const projectName = existingProjectStatus.projectName || 'Open SofaPaint project';
  projectStatus.replaceChildren();
  const summary = document.createElement('span');
  if (existingProjectStatus.sameTicket) {
    const count = attachments.filter(item => item.alreadyImported).length;
    summary.textContent = `${projectName} · ${count} existing · ${Math.max(0, attachments.length - count)} new`;
    projectStatus.dataset.match = 'true';
  } else {
    summary.textContent = `${projectName} is open · SofaPaint will ask where to add these photos`;
    projectStatus.dataset.match = 'false';
  }
  projectStatus.appendChild(summary);
  if (existingProjectStatus.sameTicket && existingProjectStatus.projectId) {
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Open project';
    link.addEventListener('click', async event => {
      event.preventDefault();
      link.textContent = 'Opening…';
      const result = await chrome.runtime
        .sendMessage({
          type: 'OPEN_SOFAPAINT_PROJECT',
          projectId: existingProjectStatus.projectId,
        })
        .catch(error => ({ ok: false, message: error?.message }));
      if (result?.ok) {
        window.close();
        return;
      }
      link.textContent = 'Open project';
      setStatus(result?.message || 'Could not open the SofaPaint project.', 'error');
      status.hidden = false;
    });
    projectStatus.appendChild(link);
  }
  projectStatus.hidden = false;
}

async function loadExistingProjectStatus() {
  try {
    existingProjectStatus = await chrome.runtime.sendMessage({
      type: 'GET_SOFAPAINT_PROJECT_STATUS',
      ticketId: ticketContext.ticketId || '',
    });
  } catch {
    existingProjectStatus = null;
  }
  applyExistingProjectFlags();
  renderExistingProjectStatus();
}

async function analyzeAttachmentQuality() {
  const run = ++analysisRun;
  if (!sourceTabId || !attachments.length) return;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ANALYZE_ATTACHMENTS',
      sourceTabId,
      attachments,
    });
    if (run !== analysisRun || !result?.ok) return;
    const analysisByIndex = new Map(
      (result.analyses || []).map(item => [Number(item.index), item])
    );
    attachments = GorgiasAttachmentQuality.classifyAttachmentVariants(
      attachments.map((attachment, index) => ({
        ...attachment,
        ...(analysisByIndex.get(index) || {}),
      }))
    );
    await writeCachedScan(true);
    applyExistingProjectFlags();
    renderAttachments();
    renderExistingProjectStatus();
    const excludedCount = attachments.filter(item => item.excludedAsLowQuality).length;
    if (excludedCount) {
      setStatus(
        `${excludedCount} lower-quality duplicate${excludedCount === 1 ? '' : 's'} excluded automatically.`
      );
      status.hidden = false;
    }
  } catch {
    // The scanner-provided dimensions remain visible if analysis is unavailable.
  }
}

async function scan(force = false) {
  setStatus('Scanning the full Gorgias ticket…');
  status.hidden = false;
  actions.hidden = true;
  list.replaceChildren();
  progress.hidden = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  sourceTabId = tab?.id || null;
  if (!sourceTabId || !/^https:\/\/comfort-works\.gorgias\.com\/app\//i.test(tab.url || '')) {
    setStatus('Open a Comfort Works Gorgias ticket, then click the extension again.', 'error');
    return;
  }
  try {
    if (!force) {
      const cached = await readCachedScan(tab);
      if (cached) {
        currentScanCache = cached;
        attachments = Array.isArray(cached.attachments) ? cached.attachments : [];
        ticketContext =
          cached.ticketContext && typeof cached.ticketContext === 'object'
            ? cached.ticketContext
            : {};
        ticketMeta.textContent = ticketContext.ticketId
          ? `Ticket ${ticketContext.ticketId}`
          : 'Current Gorgias ticket';
        await loadExistingProjectStatus();
        renderAttachments();
        setStatus('Cached ticket photos · Refresh to check for new replies.');
        status.hidden = false;
        if (!cached.analyzed) analyzeAttachmentQuality();
        return;
      }
    }
    const result = await sendToGorgiasTab(sourceTabId, { type: 'SCAN_TICKET' });
    if (!result?.ok) throw new Error(result?.message || 'Could not scan ticket');
    attachments = result.attachments || [];
    ticketContext = {
      ticketId: result.ticketId || '',
      ticketUrl: result.ticketUrl || '',
      customerName: result.customerName || '',
      productName: result.productName || '',
      productSku: result.productSku || '',
      guideCode: result.guideCode || '',
    };
    ticketMeta.textContent = result.ticketId
      ? `Ticket ${result.ticketId}`
      : 'Current Gorgias ticket';
    if (!attachments.length) {
      setStatus('No image attachments were found in this ticket conversation.');
      return;
    }
    await writeCachedScan(false);
    await loadExistingProjectStatus();
    renderAttachments();
    analyzeAttachmentQuality();
  } catch {
    setStatus('Reload the Gorgias ticket and try again.', 'error');
  }
}

document.getElementById('refreshBtn').addEventListener('click', () => scan(true));
document.getElementById('selectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('[data-attachment-index]').forEach(input => {
    input.checked = !input.disabled;
    const attachment = attachments[Number(input.dataset.attachmentIndex)];
    if (attachment) selectionOverrides.set(attachmentSelectionKey(attachment), input.checked);
  });
  updateSelection();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  document.querySelectorAll('[data-attachment-index]').forEach(input => {
    input.checked = false;
    const attachment = attachments[Number(input.dataset.attachmentIndex)];
    if (attachment) selectionOverrides.set(attachmentSelectionKey(attachment), false);
  });
  updateSelection();
});
targetInput.addEventListener('change', () =>
  chrome.storage.sync.set({ sofapaintTarget: targetInput.value.trim() })
);
importButton.addEventListener('click', async () => {
  const selected = selectedAttachments();
  if (!sourceTabId || !selected.length) return;
  importButton.disabled = true;
  const hostAccess = await ensureAttachmentHostAccess(selected);
  if (!hostAccess) {
    setStatus(
      'Allow access to the attachment host so Chrome can download the selected photos.',
      'error'
    );
    updateSelection();
    return;
  }
  setStatus('Sending photos to SofaPaint…');
  status.hidden = false;
  setProgress('downloading', 0, selected.length);
  const result = await chrome.runtime.sendMessage({
    type: 'IMPORT_ATTACHMENTS',
    sourceTabId,
    attachments: selected,
    ticketContext,
  });
  if (!result?.ok) {
    setStatus(result?.message || 'Import failed.', 'error');
    updateSelection();
    return;
  }
  const summary = [`${result.importedCount} imported`];
  if (result.duplicateCount)
    summary.push(
      `${result.duplicateCount} duplicate${result.duplicateCount === 1 ? '' : 's'} skipped`
    );
  if (result.errors?.length) summary.push(`${result.errors.length} failed: ${result.errors[0]}`);
  setStatus(summary.join(' · '), result.errors?.length ? 'error' : '');
  setProgress('sent', result.importedCount, result.importedCount || 1);
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'IMPORT_PROGRESS') return false;
  setProgress(message.stage, message.completed, message.total);
  return false;
});

chrome.storage.sync.get({ sofapaintTarget: 'https://sofapaint.vercel.app/' }).then(values => {
  targetInput.value = values.sofapaintTarget;
});
scan();
