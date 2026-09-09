import { notifyOpenPaint } from './notification-center';
import { cloudSaveService, type CloudProjectSummary } from '@/services/cloud/cloudSaveService';
import {
  detachCloudProjectForImport,
  getCloudImportState,
  loadCloudProjectForImport,
  saveCurrentProjectForImport,
} from './cloud-ui';

interface ExtensionUploadManager {
  handleFiles(
    files: File[],
    options?: { suppressStatus?: boolean }
  ): Promise<Array<{ success?: boolean; viewId?: string }> | unknown>;
  showStatus?(message: string, kind?: string): void;
}

interface ExtensionImagePayload {
  source: 'sofapaint-gorgias-extension';
  type: 'IMPORT_BEGIN' | 'IMPORT_IMAGE' | 'IMPORT_COMPLETE';
  batchId: string;
  index?: number;
  name?: string;
  mime?: string;
  hash?: string;
  dataUrl?: string;
  partLabel?: string;
  total?: number;
  importedCount?: number;
  duplicateCount?: number;
  errorCount?: number;
  ticketContext?: GorgiasTicketContext;
}

interface ExtensionStatusRequest {
  source: 'sofapaint-gorgias-extension';
  type: 'PROJECT_STATUS_REQUEST' | 'OPEN_PROJECT_REQUEST';
  requestId: string;
  ticketId?: string;
  projectId?: string;
}

interface GorgiasTicketContext {
  ticketId?: string;
  ticketUrl?: string;
  customerName?: string;
  productName?: string;
  productSku?: string;
  guideCode?: string;
}

type CloudSaveStatus = 'not-saved' | 'saving' | 'saved' | 'dirty' | 'error';

interface CloudSaveStatusDetail {
  status?: CloudSaveStatus;
  savedAt?: string;
  message?: string;
}

interface ImportBatch {
  files: Map<number, File>;
  rejected: Set<number>;
  skipped: Set<number>;
  hashesByIndex: Map<number, string>;
  partLabelsByIndex: Map<number, string>;
  knownHashes: Set<string>;
  pending: Set<Promise<void>>;
  complete: boolean;
  expectedCount: number | null;
  total: number;
  nextIndex: number;
  processedCount: number;
  rejectedCount: number;
  draining: boolean;
  startedAt: number;
  duplicateCount: number;
  sourceErrorCount: number;
  skippedCount: number;
  ticketContext: GorgiasTicketContext;
  destinationReady: Promise<boolean>;
  canceled: boolean;
}

interface ImportDestinationChoice {
  action: 'current' | 'new' | 'existing' | 'cancel';
  projectId?: string;
  saveCurrentFirst?: boolean;
}

const MAX_DATA_URL_LENGTH = 42 * 1024 * 1024;
const batches = new Map<string, ImportBatch>();
let initialized = false;

const IMPORT_DESTINATION_STYLES = /* css */ `
  .gorgias-import-destination {
    position: fixed; inset: 0; z-index: 12050; display: flex; align-items: center;
    justify-content: center; padding: 20px; background: rgba(15, 23, 42, .44);
    backdrop-filter: blur(3px);
  }
  .gorgias-import-destination-card {
    width: min(560px, 100%); max-height: min(680px, calc(100vh - 40px)); overflow: auto;
    padding: 20px; border: 1px solid #dbe1ea; border-radius: 8px; background: #fff;
    box-shadow: 0 24px 64px rgba(15, 23, 42, .24); color: #0f172a;
  }
  .gorgias-import-destination h2 { margin: 0; font-size: 18px; }
  .gorgias-import-destination p { margin: 5px 0 0; color: #64748b; font-size: 12px; line-height: 1.45; }
  .gorgias-import-ticket { margin: 14px 0; padding: 10px 12px; border: 1px solid #e2e8f0;
    border-radius: 7px; background: #f8fafc; }
  .gorgias-import-ticket strong, .gorgias-import-ticket span { display: block; }
  .gorgias-import-ticket span { margin-top: 3px; color: #64748b; font-size: 11px; }
  .gorgias-import-save-first { display: flex; gap: 8px; align-items: flex-start; margin: 12px 0;
    padding: 9px 10px; border-radius: 7px; background: #fff7ed; color: #9a3412; font-size: 12px; }
  .gorgias-import-save-first input { margin-top: 1px; accent-color: #2563eb; }
  .gorgias-import-options { display: grid; gap: 8px; }
  .gorgias-import-option { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px;
    align-items: center; padding: 11px; border: 1px solid #dbe1ea; border-radius: 7px; }
  .gorgias-import-option strong, .gorgias-import-option small { display: block; }
  .gorgias-import-option small { margin-top: 3px; color: #64748b; }
  .gorgias-import-option button, .gorgias-import-footer button { height: 32px; padding: 0 11px;
    border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a;
    font: inherit; font-weight: 650; cursor: pointer; }
  .gorgias-import-option button.primary { border-color: #1d4ed8; background: #2563eb; color: #fff; }
  .gorgias-import-project-picker { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
  .gorgias-import-project-picker input { width: 100%; height: 34px; padding: 0 9px;
    border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; }
  .gorgias-import-project-list { display: grid; gap: 5px; max-height: 190px; margin-top: 7px; overflow: auto; }
  .gorgias-import-project { display: flex; gap: 8px; align-items: center; padding: 8px;
    border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; }
  .gorgias-import-project:has(input:checked) { border-color: #60a5fa; background: #eff6ff; }
  .gorgias-import-project input { width: 15px; height: 15px; margin: 0; accent-color: #2563eb; }
  .gorgias-import-project-copy { min-width: 0; }
  .gorgias-import-project-copy strong, .gorgias-import-project-copy small { display: block;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gorgias-import-project-copy small { color: #64748b; }
  .gorgias-import-match { margin-left: 6px; color: #1d4ed8; font-size: 10px; }
  .gorgias-import-footer { display: flex; justify-content: flex-end; gap: 7px; margin-top: 14px; }
  .gorgias-import-error { min-height: 16px; margin-top: 8px; color: #b91c1c; font-size: 11px; }
`;

function normalizedContext(value: GorgiasTicketContext | undefined): GorgiasTicketContext {
  const context = value && typeof value === 'object' ? value : {};
  const productSku = String(context.productSku || '').trim();
  return {
    ticketId: String(context.ticketId || '').trim(),
    ticketUrl: String(context.ticketUrl || '').trim(),
    customerName: String(context.customerName || '').trim(),
    productName: String(context.productName || '').trim(),
    productSku,
    guideCode: String(context.guideCode || productSku.split('__')[0] || '')
      .trim()
      .toUpperCase(),
  };
}

function presentContextFields(context: GorgiasTicketContext): GorgiasTicketContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => String(value || '').trim())
  ) as GorgiasTicketContext;
}

function expectedProjectName(context: GorgiasTicketContext): string {
  return [context.customerName, context.productName]
    .map(value => (value || '').trim())
    .filter(Boolean)
    .join(' - ');
}

function normalizedProjectName(value: unknown): string {
  return (typeof value === 'string' ? value : '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function projectMatchesContext(
  project: CloudProjectSummary,
  context: GorgiasTicketContext
): boolean {
  const projectName = normalizedProjectName(project.name);
  const expectedName = normalizedProjectName(expectedProjectName(context));
  const customer = normalizedProjectName(context.customerName);
  const product = normalizedProjectName(context.productName);
  const guide = normalizedProjectName(context.guideCode);
  if (expectedName && projectName === expectedName) return true;
  if (customer && product && projectName.includes(customer) && projectName.includes(product))
    return true;
  return Boolean(
    customer && guide && projectName.includes(customer) && projectName.includes(guide)
  );
}

function currentProjectHasContent(): boolean {
  const manager = getProjectManager();
  const views = Object.values(manager?.views || {}) as Array<Record<string, unknown>>;
  const hasImageOrCanvas = views.some(view => {
    if (view?.image || view?.imageAssetHash || view?.imageR2Key) return true;
    const objects = (view?.canvasData as { objects?: unknown[] } | null)?.objects;
    return Array.isArray(objects) && objects.length > 0;
  });
  if (hasImageOrCanvas) return true;
  const metadata = manager?.getProjectMetadata?.() || {};
  if (Object.keys(metadata.externalSources?.gorgiasTickets || {}).length > 0) return true;
  const projectName = (document.getElementById('projectName') as HTMLInputElement | null)?.value;
  const normalizedName = normalizedProjectName(projectName);
  return Boolean(normalizedName && normalizedName !== 'openpaint project');
}

function currentProjectHasTicket(ticketId: string): boolean {
  if (!ticketId) return false;
  const metadata = getProjectManager()?.getProjectMetadata?.() || {};
  return Boolean(metadata.externalSources?.gorgiasTickets?.[ticketId]);
}

function extensionProjectStatus(ticketId: string): Record<string, unknown> {
  const manager = getProjectManager();
  const metadata = manager?.getProjectMetadata?.() || {};
  const ticket = metadata.externalSources?.gorgiasTickets?.[ticketId] || null;
  const projectNameInput = document.getElementById('projectName') as HTMLInputElement | null;
  const projectName =
    projectNameInput?.value?.trim() || manager?.projectName || 'OpenPaint Project';
  const views = Object.values(manager?.views || {}) as Array<Record<string, unknown>>;
  const imageCount = views.filter(view =>
    Boolean(view?.image || view?.imageAssetHash || view?.imageAssetPath || view?.imageR2Key)
  ).length;
  return {
    projectName,
    projectId: getCloudImportState().projectId,
    hasContent: currentProjectHasContent(),
    imageCount,
    sameTicket: Boolean(ticket),
    importedImageHashes: Array.isArray(ticket?.importedImageHashes)
      ? ticket.importedImageHashes
          .map((hash: unknown) =>
            String(hash || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      : [],
  };
}

function createEmptyViewState(): Record<string, unknown> {
  return {
    canvasJSON: null,
    imageDataURL: null,
    imageUrl: null,
    imageAssetHash: null,
    imageAssetPath: null,
    imageContentType: null,
    metadata: {},
    tabs: null,
    viewport: null,
    rotation: 0,
    backgroundRotation: 0,
    fitMode: 'scale-page-size',
  };
}

async function startBlankImportProject(context: GorgiasTicketContext): Promise<void> {
  const manager = getProjectManager();
  const name = expectedProjectName(context) || 'OpenPaint Project';
  if (typeof manager?.loadProjectFromData === 'function') {
    const viewOrder = ['front', 'side', 'back', 'cushion'];
    await manager.loadProjectFromData({
      version: '2.0-fabric',
      projectName: name,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentViewId: 'front',
      viewOrder,
      metadata: {},
      views: Object.fromEntries(viewOrder.map(viewId => [viewId, createEmptyViewState()])),
    });
  }
  const input = document.getElementById('projectName') as HTMLInputElement | null;
  if (input) input.value = name;
  detachCloudProjectForImport();
}

function ensureImportDestinationStyles(): void {
  if (document.getElementById('gorgiasImportDestinationStyles')) return;
  const style = document.createElement('style');
  style.id = 'gorgiasImportDestinationStyles';
  style.textContent = IMPORT_DESTINATION_STYLES;
  document.head.appendChild(style);
}

function formatProjectDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function chooseImportDestination(
  context: GorgiasTicketContext,
  projects: CloudProjectSummary[],
  options: { hasCurrentProject: boolean; currentDirty: boolean }
): Promise<ImportDestinationChoice> {
  ensureImportDestinationStyles();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'gorgias-import-destination';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Choose project for imported ticket photos');

    const card = document.createElement('section');
    card.className = 'gorgias-import-destination-card';
    const title = document.createElement('h2');
    title.textContent = 'Where should these photos go?';
    const intro = document.createElement('p');
    intro.textContent = 'Choose a project before SofaPaint changes the open workspace.';
    const ticket = document.createElement('div');
    ticket.className = 'gorgias-import-ticket';
    const ticketTitle = document.createElement('strong');
    ticketTitle.textContent =
      expectedProjectName(context) || `Gorgias ticket ${context.ticketId || ''}`;
    const ticketMeta = document.createElement('span');
    ticketMeta.textContent = [
      context.ticketId ? `Ticket ${context.ticketId}` : '',
      context.guideCode || '',
    ]
      .filter(Boolean)
      .join(' · ');
    ticket.append(ticketTitle, ticketMeta);

    let saveFirst: HTMLInputElement | null = null;
    if (options.hasCurrentProject) {
      const saveLabel = document.createElement('label');
      saveLabel.className = 'gorgias-import-save-first';
      saveFirst = document.createElement('input');
      saveFirst.type = 'checkbox';
      saveFirst.checked = options.currentDirty;
      const saveCopy = document.createElement('span');
      saveCopy.textContent = options.currentDirty
        ? 'Save the current project before switching'
        : 'Save the current project again before switching';
      saveLabel.append(saveFirst, saveCopy);
      card.append(title, intro, ticket, saveLabel);
    } else {
      card.append(title, intro, ticket);
    }

    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'gorgias-import-options';
    const finish = (choice: ImportDestinationChoice): void => {
      overlay.remove();
      resolve({ ...choice, saveCurrentFirst: saveFirst?.checked === true });
    };

    if (options.hasCurrentProject) {
      const current = document.createElement('div');
      current.className = 'gorgias-import-option';
      current.innerHTML =
        '<div><strong>Current project</strong><small>Add these photos without switching</small></div>';
      const currentButton = document.createElement('button');
      currentButton.type = 'button';
      currentButton.textContent = 'Add here';
      currentButton.dataset.importDestination = 'current';
      currentButton.addEventListener('click', () => finish({ action: 'current' }));
      current.appendChild(currentButton);
      optionsWrap.appendChild(current);
    }

    const fresh = document.createElement('div');
    fresh.className = 'gorgias-import-option';
    fresh.innerHTML =
      '<div><strong>New project</strong><small>Close the current workspace and start clean</small></div>';
    const freshButton = document.createElement('button');
    freshButton.type = 'button';
    freshButton.className = 'primary';
    freshButton.textContent = 'Start new';
    freshButton.dataset.importDestination = 'new';
    freshButton.addEventListener('click', () => finish({ action: 'new' }));
    fresh.appendChild(freshButton);
    optionsWrap.appendChild(fresh);
    card.appendChild(optionsWrap);

    if (projects.length > 0) {
      const picker = document.createElement('div');
      picker.className = 'gorgias-import-project-picker';
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = 'Search existing cloud projects';
      search.setAttribute('aria-label', 'Search existing cloud projects');
      const list = document.createElement('div');
      list.className = 'gorgias-import-project-list';
      const matchingIds = new Set(
        projects
          .filter(project => projectMatchesContext(project, context))
          .map(project => project.id)
      );
      const ordered = [...projects].sort(
        (left, right) => Number(matchingIds.has(right.id)) - Number(matchingIds.has(left.id))
      );
      let selectedId = ordered.find(project => matchingIds.has(project.id))?.id || '';

      const render = (): void => {
        const query = normalizedProjectName(search.value);
        list.replaceChildren();
        ordered
          .filter(project => !query || normalizedProjectName(project.name).includes(query))
          .forEach(project => {
            const label = document.createElement('label');
            label.className = 'gorgias-import-project';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'gorgias-import-cloud-project';
            radio.value = project.id;
            radio.checked = project.id === selectedId;
            radio.addEventListener('change', () => {
              selectedId = project.id;
            });
            const copy = document.createElement('span');
            copy.className = 'gorgias-import-project-copy';
            const name = document.createElement('strong');
            name.textContent = project.name || 'Untitled project';
            if (matchingIds.has(project.id)) {
              const match = document.createElement('span');
              match.className = 'gorgias-import-match';
              match.textContent = 'Likely match';
              name.appendChild(match);
            }
            const date = document.createElement('small');
            date.textContent = `Updated ${formatProjectDate(project.updated_at)}`;
            copy.append(name, date);
            label.append(radio, copy);
            list.appendChild(label);
          });
      };
      search.addEventListener('input', render);
      render();
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.textContent = 'Open selected and add photos';
      openButton.dataset.importDestination = 'existing';
      openButton.addEventListener('click', () => {
        if (selectedId) finish({ action: 'existing', projectId: selectedId });
      });
      picker.append(search, list, openButton);
      card.appendChild(picker);
    }

    const error = document.createElement('div');
    error.className = 'gorgias-import-error';
    const footer = document.createElement('div');
    footer.className = 'gorgias-import-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel import';
    cancel.dataset.importDestination = 'cancel';
    cancel.addEventListener('click', () => finish({ action: 'cancel' }));
    footer.appendChild(cancel);
    card.append(error, footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    freshButton.focus();
  });
}

async function prepareImportDestination(context: GorgiasTicketContext): Promise<boolean> {
  const ticketId = (context.ticketId || '').trim();
  if (ticketId && currentProjectHasTicket(ticketId)) return true;

  const hasCurrentProject = currentProjectHasContent();
  let projects: CloudProjectSummary[] = [];
  const projectResult = await cloudSaveService.listProjects();
  if (projectResult.success) projects = projectResult.data;
  const matchingProjects = projects.filter(project => projectMatchesContext(project, context));

  if (!hasCurrentProject && matchingProjects.length === 0) {
    detachCloudProjectForImport();
    return true;
  }

  const cloudState = getCloudImportState();
  const choice = await chooseImportDestination(context, projects, {
    hasCurrentProject,
    currentDirty: cloudState.status === 'dirty' || !cloudState.projectId,
  });
  if (choice.action === 'cancel') return false;

  if (choice.saveCurrentFirst && hasCurrentProject && choice.action !== 'current') {
    const saved = await saveCurrentProjectForImport();
    if (!saved) {
      notifyOpenPaint({
        kind: 'error',
        title: 'Gorgias import paused',
        message: 'The current project could not be saved. Nothing was imported.',
      });
      return false;
    }
  }

  if (choice.action === 'existing' && choice.projectId) {
    const loaded = await loadCloudProjectForImport(choice.projectId);
    if (!loaded) {
      notifyOpenPaint({
        kind: 'error',
        title: 'Gorgias import paused',
        message: 'The selected cloud project could not be opened.',
      });
      return false;
    }
  } else if (choice.action === 'new') {
    await startBlankImportProject(context);
  }
  return true;
}

function getProjectManager(): any {
  return (window as any).app?.projectManager;
}

function renderCloudSaveStatus(detail: CloudSaveStatusDetail = { status: 'not-saved' }): void {
  const link = document.getElementById('gorgiasTicketSourceLink');
  if (!link?.parentElement) return;
  let status = document.getElementById('gorgiasCloudSaveStatus');
  if (!status) {
    status = document.createElement('span');
    status.id = 'gorgiasCloudSaveStatus';
    status.className = 'gorgias-cloud-save-status';
    link.insertAdjacentElement('afterend', status);
  }
  const state: CloudSaveStatus = detail.status || 'not-saved';
  const labels: Record<CloudSaveStatus, string> = {
    'not-saved': 'Not saved',
    saving: 'Saving...',
    saved: 'Cloud saved',
    dirty: 'Changes not saved',
    error: 'Save failed',
  };
  status.dataset.state = state;
  status.textContent = labels[state];
  const savedAt = detail.savedAt ? new Date(detail.savedAt) : null;
  status.title =
    state === 'saved' && savedAt && !Number.isNaN(savedAt.getTime())
      ? `Saved ${savedAt.toLocaleString()}`
      : detail.message || labels[state];
}

function renderTicketSourceLink(context?: GorgiasTicketContext): void {
  const subtitle = document.querySelector('.images-panel-subtitle');
  if (!subtitle?.parentElement) return;
  let link = document.getElementById('gorgiasTicketSourceLink') as HTMLAnchorElement | null;
  const ticketId = String(context?.ticketId || '').trim();
  const ticketUrl = String(context?.ticketUrl || '').trim();
  let safeUrl = '';
  try {
    const parsed = new URL(ticketUrl);
    if (parsed.protocol === 'https:' && parsed.hostname === 'comfort-works.gorgias.com') {
      safeUrl = parsed.href;
    }
  } catch {
    safeUrl = '';
  }
  if (!ticketId || !safeUrl) {
    link?.remove();
    document.getElementById('gorgiasCloudSaveStatus')?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('a');
    link.id = 'gorgiasTicketSourceLink';
    link.className = 'gorgias-ticket-source-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    subtitle.insertAdjacentElement('afterend', link);
  }
  link.href = safeUrl;
  link.textContent = `Gorgias #${ticketId}`;
  link.title = 'Open source ticket';
  renderCloudSaveStatus();
}

function renderStoredTicketSource(): void {
  const metadata = getProjectManager()?.getProjectMetadata?.() || {};
  const tickets = Object.values(metadata.externalSources?.gorgiasTickets || {}) as Array<
    GorgiasTicketContext & { lastImportedAt?: string }
  >;
  const latest = tickets.sort((left, right) =>
    String(right.lastImportedAt || '').localeCompare(String(left.lastImportedAt || ''))
  )[0];
  renderTicketSourceLink(latest);
}

function applyTicketContext(context: GorgiasTicketContext): Set<string> {
  const manager = getProjectManager();
  if (!manager?.getProjectMetadata || !manager?.setProjectMetadata) return new Set();
  const metadata = manager.getProjectMetadata() || {};
  const ticketId = String(context.ticketId || '').trim();
  const existingTickets = metadata.externalSources?.gorgiasTickets || {};
  const existing = ticketId ? existingTickets[ticketId] || {} : {};
  const guideCode = String(context.guideCode || '')
    .trim()
    .toUpperCase();
  const customerName = String(context.customerName || '').trim();
  const productName = String(context.productName || '').trim();
  const contextFields = presentContextFields(context);
  const naming = {
    ...(metadata.naming || {}),
    customerName: customerName || metadata.naming?.customerName || '',
    sofaTypeLabel: productName || metadata.naming?.sofaTypeLabel || '',
  };
  const patch: Record<string, unknown> = { naming };

  if (ticketId) {
    patch.externalSources = {
      ...(metadata.externalSources || {}),
      gorgiasTickets: {
        ...existingTickets,
        [ticketId]: {
          ...existing,
          ...contextFields,
          ticketId,
          importedImageHashes: Array.isArray(existing.importedImageHashes)
            ? existing.importedImageHashes
            : [],
        },
      },
    };
  }
  if (guideCode) {
    const library = Array.from(
      new Set([...(metadata.measurementGuideLibraryCodes || []), guideCode])
    );
    patch.measurementGuideCode = metadata.measurementGuideCode || guideCode;
    patch.measurementGuideCodes = metadata.measurementGuideCodes?.length
      ? metadata.measurementGuideCodes
      : [guideCode];
    patch.measurementGuideLibraryCodes = library;
    patch.measurementGuideProjectDefaults = {
      codes: library,
      activeCode: metadata.measurementGuideProjectDefaults?.activeCode || guideCode,
    };
  }
  manager.setProjectMetadata(patch);
  renderTicketSourceLink(context);

  const projectNameInput = document.getElementById('projectName') as HTMLInputElement | null;
  const titleCustomerName = customerName || String(existing.customerName || '').trim();
  const titleProductName = productName || String(existing.productName || '').trim();
  const nextName = [titleCustomerName, titleProductName].filter(Boolean).join(' - ');
  if (projectNameInput && nextName) {
    const previousAuto = String(metadata.naming?.autoProjectTitle || '');
    const currentName = projectNameInput.value.trim();
    if (!currentName || currentName === 'OpenPaint Project' || currentName === previousAuto) {
      projectNameInput.value = nextName;
      manager.setProjectMetadata({ naming: { ...naming, autoProjectTitle: nextName } });
    }
  }

  document.querySelectorAll<HTMLInputElement>('#projectNamingCustomer').forEach(input => {
    if (!input.value && customerName) input.value = customerName;
  });
  document.querySelectorAll<HTMLInputElement>('#projectNamingSofaType').forEach(input => {
    if (!input.value && productName) input.value = productName;
  });
  document.querySelectorAll<HTMLInputElement>('#projectNamingGuideCodes').forEach(input => {
    if (!input.value && guideCode) input.value = guideCode;
  });

  return new Set(
    (Array.isArray(existing.importedImageHashes) ? existing.importedImageHashes : [])
      .map((hash: unknown) =>
        String(hash || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
}

function persistImportedHash(context: GorgiasTicketContext, hash: string): void {
  const ticketId = String(context.ticketId || '').trim();
  const normalizedHash = String(hash || '')
    .trim()
    .toLowerCase();
  const manager = getProjectManager();
  if (!ticketId || !normalizedHash || !manager?.getProjectMetadata || !manager?.setProjectMetadata)
    return;
  const metadata = manager.getProjectMetadata() || {};
  const tickets = metadata.externalSources?.gorgiasTickets || {};
  const existing = tickets[ticketId] || {};
  const contextFields = presentContextFields(context);
  manager.setProjectMetadata({
    externalSources: {
      ...(metadata.externalSources || {}),
      gorgiasTickets: {
        ...tickets,
        [ticketId]: {
          ...existing,
          ...contextFields,
          ticketId,
          importedImageHashes: Array.from(
            new Set([...(existing.importedImageHashes || []), normalizedHash])
          ),
          lastImportedAt: new Date().toISOString(),
        },
      },
    },
  });
}

function sanitizeFilename(value: string, fallbackIndex: number): string {
  const filename = String(value || '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f<>:"|?*]/g, '-')
    .trim();
  return filename || `gorgias-image-${fallbackIndex + 1}.jpg`;
}

function normalizeImagePartLabel(value: unknown): string {
  const match = String(value || '')
    .trim()
    .toLowerCase()
    .match(/^(front|side|back|cushion)$/);
  return match?.[1] || '';
}

function inferImagePartLabel(payload: Pick<ExtensionImagePayload, 'partLabel' | 'name'>): string {
  const explicit = normalizeImagePartLabel(payload.partLabel);
  if (explicit) return explicit;
  const basename = String(payload.name || '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .toLowerCase();
  return basename?.match(/(?:^|[-_\s])(front|side|back|cushion)(?:$|[-_\s])/i)?.[1] || '';
}

function filenameForPartLabel(payload: ExtensionImagePayload): string {
  const originalName = sanitizeFilename(payload.name || '', payload.index || 0);
  const partLabel = inferImagePartLabel(payload);
  if (!partLabel) return originalName;
  const extension = originalName.match(/\.(jpe?g|png|webp|gif|heic|heif|avif)$/i)?.[0];
  return `${partLabel}${extension || '.jpg'}`;
}

function setImportedImagePartLabel(viewId: string, partLabel: string): void {
  const manager = getProjectManager();
  if (!viewId || !partLabel || !manager?.getProjectMetadata || !manager?.setProjectMetadata) return;
  const metadata = manager.getProjectMetadata() || {};
  manager.setProjectMetadata({
    imagePartLabels: {
      ...(metadata.imagePartLabels || {}),
      [viewId]: partLabel,
    },
  });
  if (manager.currentViewId === viewId) {
    const input = document.getElementById('currentImageNameBox') as HTMLInputElement | null;
    if (input) {
      input.value = partLabel;
      input.dataset.activeViewId = viewId;
    }
  }
  window.dispatchEvent(
    new CustomEvent('openpaint:image-part-label-changed', { detail: { viewId, partLabel } })
  );
}

async function dataUrlToFile(payload: ExtensionImagePayload): Promise<File> {
  const dataUrl = String(payload.dataUrl || '');
  const mime = String(payload.mime || '').toLowerCase();
  if (!/^image\/[a-z0-9.+-]+$/i.test(mime) || !dataUrl.startsWith(`data:${mime};base64,`)) {
    throw new Error('The browser extension sent an invalid image');
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error(`${payload.name || 'An image'} is too large to import`);
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error(`${payload.name || 'The image'} is empty`);
  }

  // Chrome can receive a data URL with an image MIME type even when the bytes
  // are truncated or otherwise undecodable. Reject it before UploadManager
  // creates a view, otherwise an empty "front view" shell is left behind.
  const browserDecoder = globalThis.createImageBitmap;
  const shouldDecode =
    typeof browserDecoder === 'function' && !/^image\/(?:hei[cf]|svg\+xml)$/i.test(mime);
  if (shouldDecode) {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await browserDecoder(blob);
      if (!(bitmap.width > 0 && bitmap.height > 0)) {
        throw new Error('The decoded image has no visible dimensions');
      }
    } catch {
      throw new Error(`${payload.name || 'The image'} could not be decoded`);
    } finally {
      bitmap?.close?.();
    }
  }
  return new File([blob], filenameForPartLabel(payload), {
    type: mime,
    lastModified: Date.now(),
  });
}

function showBatchProgress(batch: ImportBatch, message: string): void {
  const total = Math.max(1, batch.expectedCount ?? batch.total);
  notifyOpenPaint({
    kind: 'loading',
    title: 'Gorgias',
    message,
    progress: Math.min(1, batch.processedCount / total),
  });
}

function finishBatch(batchId: string, batch: ImportBatch): void {
  batches.delete(batchId);
  const totalErrors = batch.rejectedCount + batch.sourceErrorCount;
  const elapsedSeconds = Math.max(0.1, (Date.now() - batch.startedAt) / 1000);
  const detail = [
    `${batch.processedCount} photo${batch.processedCount === 1 ? '' : 's'} added`,
    `${elapsedSeconds.toFixed(1)}s`,
  ];
  const duplicateCount = batch.duplicateCount + batch.skippedCount;
  if (duplicateCount) detail.push(`${duplicateCount} duplicate skipped`);
  if (totalErrors) detail.push(`${totalErrors} failed`);
  notifyOpenPaint({
    kind: totalErrors ? 'warning' : 'success',
    title: 'Gorgias',
    message: detail.join(' · '),
    progress: 1,
    durationMs: totalErrors ? 5200 : 3600,
  });
  if (batch.processedCount > 0 || Boolean(batch.ticketContext.guideCode)) {
    window.setTimeout(() => {
      renderCloudSaveStatus({ status: 'saving' });
      notifyOpenPaint({
        kind: 'loading',
        title: 'Cloud save',
        message: 'Saving imported ticket',
      });
      window.dispatchEvent(
        new CustomEvent('openpaint:request-cloud-save', {
          detail: { allowPartialDetails: true, source: 'gorgias-extension' },
        })
      );
    }, 650);
  }
}

async function drainBatch(batchId: string, uploadManager: ExtensionUploadManager): Promise<void> {
  const batch = batches.get(batchId);
  if (!batch || batch.draining) return;
  batch.draining = true;

  try {
    const destinationReady = await batch.destinationReady;
    if (!destinationReady || batch.canceled) {
      batch.canceled = true;
      batches.delete(batchId);
      notifyOpenPaint({
        kind: 'info',
        title: 'Gorgias',
        message: 'Import cancelled. The open project was not changed.',
      });
      return;
    }
    while (
      batch.files.has(batch.nextIndex) ||
      batch.rejected.has(batch.nextIndex) ||
      batch.skipped.has(batch.nextIndex)
    ) {
      if (batch.skipped.delete(batch.nextIndex)) {
        batch.skippedCount += 1;
        batch.nextIndex += 1;
        continue;
      }
      if (batch.rejected.delete(batch.nextIndex)) {
        batch.rejectedCount += 1;
        batch.nextIndex += 1;
        continue;
      }

      const queuedHash = batch.hashesByIndex.get(batch.nextIndex) || '';
      if (queuedHash && batch.knownHashes.has(queuedHash)) {
        batch.files.delete(batch.nextIndex);
        batch.skippedCount += 1;
        batch.nextIndex += 1;
        continue;
      }

      const file = batch.files.get(batch.nextIndex);
      if (!file) break;
      batch.files.delete(batch.nextIndex);
      showBatchProgress(
        batch,
        `Adding ${batch.processedCount + 1} of ${Math.max(1, batch.expectedCount ?? batch.total)} · ${file.name}`
      );
      const uploadResults = await uploadManager.handleFiles([file], { suppressStatus: true });
      const uploaded = Array.isArray(uploadResults)
        ? uploadResults.find(result => result?.success && result?.viewId)
        : null;
      if (!uploaded?.viewId) {
        batch.rejectedCount += 1;
        batch.nextIndex += 1;
        console.warn('[Extension Import] Upload did not create an image view', {
          file: file.name,
          uploadResults,
        });
        showBatchProgress(batch, `Skipped ${file.name} because it could not be loaded`);
        continue;
      }
      const partLabel = batch.partLabelsByIndex.get(batch.nextIndex) || '';
      if (uploaded?.viewId && partLabel) setImportedImagePartLabel(uploaded.viewId, partLabel);
      const hash = batch.hashesByIndex.get(batch.nextIndex) || '';
      if (hash) {
        batch.knownHashes.add(hash);
        persistImportedHash(batch.ticketContext, hash);
      }
      batch.processedCount += 1;
      batch.nextIndex += 1;
      showBatchProgress(
        batch,
        `Added ${batch.processedCount} of ${Math.max(1, batch.expectedCount ?? batch.total)}`
      );
    }
  } finally {
    batch.draining = false;
  }

  const expected = batch.expectedCount;
  if (
    batch.complete &&
    batch.pending.size === 0 &&
    expected !== null &&
    batch.nextIndex >= expected
  ) {
    finishBatch(batchId, batch);
  }
}

export function initExtensionImageImport(uploadManager: ExtensionUploadManager): void {
  document.documentElement.dataset.openpaintExtensionImportReady = 'true';
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  renderStoredTicketSource();
  window.addEventListener('openpaint:project-loaded', renderStoredTicketSource);
  window.addEventListener('openpaint:cloud-save-status', event => {
    renderCloudSaveStatus((event as CustomEvent<CloudSaveStatusDetail>).detail);
  });

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const statusRequest = event.data as ExtensionStatusRequest;
    if (
      statusRequest?.source === 'sofapaint-gorgias-extension' &&
      statusRequest.type === 'OPEN_PROJECT_REQUEST' &&
      statusRequest.requestId
    ) {
      const projectId = String(statusRequest.projectId || '').trim();
      void (projectId ? loadCloudProjectForImport(projectId) : Promise.resolve(false)).then(
        opened => {
          if (!opened) {
            notifyOpenPaint({
              kind: 'error',
              title: 'Project could not be opened',
              message: 'Open My Projects and try loading it again.',
            });
          }
        }
      );
      return;
    }
    if (
      statusRequest?.source === 'sofapaint-gorgias-extension' &&
      statusRequest.type === 'PROJECT_STATUS_REQUEST' &&
      statusRequest.requestId
    ) {
      window.postMessage(
        {
          source: 'sofapaint-gorgias-project-status',
          requestId: statusRequest.requestId,
          status: extensionProjectStatus(String(statusRequest.ticketId || '').trim()),
        },
        window.location.origin
      );
      return;
    }
    const payload = event.data as ExtensionImagePayload;
    if (
      !payload ||
      payload.source !== 'sofapaint-gorgias-extension' ||
      !payload.batchId ||
      !['IMPORT_BEGIN', 'IMPORT_IMAGE', 'IMPORT_COMPLETE'].includes(payload.type)
    ) {
      return;
    }

    if (payload.type === 'IMPORT_BEGIN') {
      const ticketContext = normalizedContext(payload.ticketContext);
      const batch: ImportBatch = {
        files: new Map(),
        rejected: new Set(),
        skipped: new Set(),
        hashesByIndex: new Map(),
        partLabelsByIndex: new Map(),
        knownHashes: new Set(),
        pending: new Set(),
        complete: false,
        expectedCount: null,
        total: Math.max(0, Number(payload.total) || 0),
        nextIndex: 0,
        processedCount: 0,
        rejectedCount: 0,
        draining: false,
        startedAt: Date.now(),
        duplicateCount: 0,
        sourceErrorCount: 0,
        skippedCount: 0,
        ticketContext,
        destinationReady: Promise.resolve(true),
        canceled: false,
      };
      batch.destinationReady = prepareImportDestination(ticketContext)
        .then(ready => {
          if (ready) batch.knownHashes = applyTicketContext(ticketContext);
          return ready;
        })
        .catch(error => {
          console.error('[Extension Import] Destination selection failed:', error);
          return false;
        });
      batches.set(payload.batchId, batch);
      notifyOpenPaint({
        kind: 'loading',
        title: 'Gorgias',
        message: `Preparing ${Math.max(0, Number(payload.total) || 0)} photos`,
        progress: 0,
      });
      return;
    }

    const batch = batches.get(payload.batchId);
    if (!batch) return;

    if (payload.type === 'IMPORT_IMAGE') {
      const index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || batch.files.has(index)) return;
      const hash = String(payload.hash || '')
        .trim()
        .toLowerCase();
      if (hash && batch.knownHashes.has(hash)) {
        batch.skipped.add(index);
        void drainBatch(payload.batchId, uploadManager);
        return;
      }
      if (hash) batch.hashesByIndex.set(index, hash);
      const partLabel = inferImagePartLabel(payload);
      if (partLabel) batch.partLabelsByIndex.set(index, partLabel);
      let task: Promise<void>;
      task = dataUrlToFile(payload)
        .then(file => {
          batch.files.set(index, file);
        })
        .catch(error => {
          console.warn('[Extension Import] Image rejected:', error);
          batch.rejected.add(index);
        })
        .finally(() => {
          batch.pending.delete(task);
          void drainBatch(payload.batchId, uploadManager);
        });
      batch.pending.add(task);
      return;
    }

    batch.complete = true;
    batch.expectedCount = Number.isFinite(payload.importedCount)
      ? Number(payload.importedCount)
      : null;
    batch.duplicateCount = Math.max(0, Number(payload.duplicateCount) || 0);
    batch.sourceErrorCount = Math.max(0, Number(payload.errorCount) || 0);
    void drainBatch(payload.batchId, uploadManager);
  });
}
