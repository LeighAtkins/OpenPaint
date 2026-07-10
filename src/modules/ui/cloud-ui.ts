// Cloud UI - Cloud Save button + My Projects modal
import { authService, type AuthUser } from '@/services/auth/authService';
import { cloudSaveService } from '@/services/cloud/cloudSaveService';
import { isAuthEnabled, isSupabaseConfigured } from '@/utils/env';
import { getNoRewardMessage, showRewardAchievement } from './reward-achievement';
import { ensureCloudSaveDetails } from './project-naming.js';

const CLOUD_UI_STYLES = /* css */ `
  .cloud-save-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .cloud-save-menu {
    position: relative;
    flex: 0 0 auto;
  }

  .cloud-save-menu-panel {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 7px);
    min-width: 142px;
    padding: 5px;
    border: 1px solid rgba(15, 23, 42, 0.14);
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translate(-50%, 4px);
    transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
    z-index: 5200;
  }

  .cloud-save-menu-panel::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    height: 8px;
  }

  .cloud-save-menu:hover .cloud-save-menu-panel,
  .cloud-save-menu:focus-within .cloud-save-menu-panel {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translate(-50%, 0);
  }

  .cloud-save-menu-panel button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 9px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #0f172a;
    font-size: 12px;
    font-weight: 650;
    text-align: left;
    cursor: pointer;
  }

  .cloud-save-menu-panel button:hover,
  .cloud-save-menu-panel button:focus-visible {
    background: #f1f5f9;
    outline: none;
  }

  /* Cloud modal */
  .cloud-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 10001;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .cloud-modal-overlay.visible {
    opacity: 1;
  }

  .cloud-modal-card {
    background: #fff;
    border-radius: 12px;
    padding: 24px;
    width: 520px;
    max-width: 90vw;
    max-height: 80vh;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    position: relative;
    transform: scale(0.95);
    transition: transform 0.15s ease;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .cloud-modal-overlay.visible .cloud-modal-card {
    transform: scale(1);
  }

  .cloud-modal-close {
    position: absolute;
    top: 12px;
    right: 12px;
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: #9ca3af;
    line-height: 1;
    padding: 4px;
  }
  .cloud-modal-close:hover {
    color: #374151;
  }

  .cloud-modal-heading {
    font-size: 18px;
    font-weight: 600;
    color: #111827;
    margin: 0 0 16px;
  }

  .cloud-search-input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 14px;
    margin-bottom: 16px;
    box-sizing: border-box;
  }
  .cloud-search-input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .cloud-projects-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 200px;
    max-height: 400px;
  }

  .cloud-project-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    transition: border-color 0.15s ease;
  }
  .cloud-project-card:hover {
    border-color: #3b82f6;
  }

  .cloud-project-info {
    flex: 1;
    min-width: 0;
  }

  .cloud-project-name {
    font-weight: 500;
    color: #111827;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cloud-project-date {
    font-size: 12px;
    color: #6b7280;
    margin-top: 2px;
  }

  .cloud-project-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .cloud-load-btn {
    padding: 6px 12px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .cloud-load-btn:hover {
    background: #2563eb;
  }

  .cloud-delete-btn {
    padding: 6px 12px;
    background: white;
    color: #ef4444;
    border: 1px solid #ef4444;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .cloud-delete-btn:hover {
    background: #fef2f2;
  }

  .cloud-empty-state {
    text-align: center;
    padding: 32px;
    color: #6b7280;
  }

  .cloud-loading {
    text-align: center;
    padding: 32px;
    color: #6b7280;
  }

  .cloud-error {
    padding: 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #991b1b;
    font-size: 13px;
    margin-bottom: 16px;
  }

  .cloud-success {
    padding: 12px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    color: #166534;
    font-size: 13px;
    margin-bottom: 16px;
  }

`;

let cloudModalOverlay: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let cloudProjectsCache: Array<{ id: string; name: string; updated_at: string }> = [];
let cloudMenuEmptyProjectMode = false;

const cloudSaveButtonMarkup = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg><span class="label-long">Cloud Save</span>`;
const myProjectsButtonMarkup = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span class="label-long">My Projects</span>`;

function hasLoadedProjectImages(): boolean {
  const win = window as Window & {
    originalImages?: Record<string, unknown>;
    imageGalleryData?: Array<unknown>;
    app?: { projectManager?: { views?: Record<string, { image?: unknown; imageUrl?: unknown }> } };
    projectManager?: { views?: Record<string, { image?: unknown; imageUrl?: unknown }> };
  };

  const originalImages = win.originalImages || {};
  if (Object.values(originalImages).some(Boolean)) return true;

  const galleryData = Array.isArray(win.imageGalleryData) ? win.imageGalleryData : [];
  if (
    galleryData.some(item => {
      const entry = item as { src?: unknown; image?: unknown; original?: { src?: unknown } };
      return Boolean(entry?.src || entry?.image || entry?.original?.src);
    })
  ) {
    return true;
  }

  const views: Record<string, { image?: unknown; imageUrl?: unknown }> =
    win.app?.projectManager?.views || win.projectManager?.views || {};
  return Object.values(views).some(view => Boolean(view?.image || view?.imageUrl));
}

function getCloudSaveButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[data-cloud-save-trigger]'));
}

function bindCloudSaveTriggers(): void {
  getCloudSaveButtons().forEach(button => {
    if (button.dataset.cloudSaveBound === 'true') return;
    button.dataset.cloudSaveBound = 'true';
    button.addEventListener('click', () => {
      if (cloudMenuEmptyProjectMode) {
        openCloudModal();
        return;
      }
      void handleCloudSave();
    });
  });
}

function syncCloudPrimaryAction(): void {
  const emptyProjectMode = !hasLoadedProjectImages();
  cloudMenuEmptyProjectMode = emptyProjectMode;

  const primaryButton = document.getElementById('canvasCloudSaveBtn') as HTMLButtonElement | null;
  const secondaryButton = document.getElementById(
    'canvasMyProjectsBtn'
  ) as HTMLButtonElement | null;

  if (primaryButton) {
    primaryButton.innerHTML = emptyProjectMode ? myProjectsButtonMarkup : cloudSaveButtonMarkup;
    primaryButton.title = emptyProjectMode ? 'Open my projects' : 'Save to cloud';
    primaryButton.setAttribute('aria-label', emptyProjectMode ? 'My Projects' : 'Cloud save');
  }

  if (secondaryButton) {
    secondaryButton.innerHTML = emptyProjectMode ? cloudSaveButtonMarkup : myProjectsButtonMarkup;
    secondaryButton.title = emptyProjectMode ? 'Save to cloud' : 'My Projects';
    secondaryButton.setAttribute('aria-label', emptyProjectMode ? 'Cloud save' : 'My Projects');
  }
}

function scheduleCloudPrimaryActionSync(): void {
  requestAnimationFrame(() => syncCloudPrimaryAction());
}

function refreshToolbarLayout(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      (window as Window & { calculateToolbarMode?: () => void }).calculateToolbarMode?.();
      window.dispatchEvent(new Event('resize'));
    });
  });
}

function showCloudFeatures(show: boolean): void {
  const cloudMenu = document.getElementById('canvasCloudMenu');
  if (cloudMenu) cloudMenu.style.display = show ? 'block' : 'none';
  refreshToolbarLayout();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function clearRenderedProjectCards(listEl: HTMLElement): void {
  listEl
    .querySelectorAll('.cloud-project-card, .cloud-error')
    .forEach(node => node.parentElement?.removeChild(node));
}

function filterProjectsBySearch(
  projects: Array<{ id: string; name: string; updated_at: string }>,
  search?: string
): Array<{ id: string; name: string; updated_at: string }> {
  const query = (search || '').trim().toLowerCase();
  if (!query) return projects.slice();

  return projects.filter(project => (project.name || '').toLowerCase().includes(query));
}

async function loadProjectsList(
  search?: string,
  options: { forceRefresh?: boolean } = {}
): Promise<void> {
  const listEl = document.getElementById('cloudProjectsList');
  const loadingEl = document.getElementById('cloudLoadingState');
  const emptyEl = document.getElementById('cloudEmptyState');

  if (!listEl || !loadingEl || !emptyEl) return;

  const shouldRefresh = options.forceRefresh === true || cloudProjectsCache.length === 0;

  loadingEl.style.display = 'block';
  clearRenderedProjectCards(listEl);
  emptyEl.style.display = 'none';

  let projects = cloudProjectsCache;
  if (shouldRefresh) {
    const result = await cloudSaveService.listProjects();

    loadingEl.style.display = 'none';

    if (!result.success) {
      listEl.insertAdjacentHTML(
        'beforeend',
        `<div class="cloud-error">Failed to load projects: ${result.error.message}</div>`
      );
      return;
    }

    cloudProjectsCache = result.data;
    projects = cloudProjectsCache;
  } else {
    loadingEl.style.display = 'none';
  }

  const filteredProjects = filterProjectsBySearch(projects, search);

  if (filteredProjects.length === 0) {
    emptyEl.style.display = 'block';
    emptyEl.textContent = (search || '').trim()
      ? 'No projects match your search.'
      : 'No projects found. Save a project to get started!';
    return;
  }

  for (const project of filteredProjects) {
    const card = document.createElement('div');
    card.className = 'cloud-project-card';

    const info = document.createElement('div');
    info.className = 'cloud-project-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'cloud-project-name';
    nameEl.textContent = project.name;

    const dateEl = document.createElement('div');
    dateEl.className = 'cloud-project-date';
    dateEl.textContent = formatDate(project.updated_at);

    info.appendChild(nameEl);
    info.appendChild(dateEl);

    const actions = document.createElement('div');
    actions.className = 'cloud-project-actions';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'cloud-load-btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => void handleLoadProject(project.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'cloud-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Delete "${project.name}"? This cannot be undone.`)) {
        // Optimistically remove the card immediately so the user gets instant feedback
        // and can't accidentally trigger multiple deletes.
        card.remove();
        const listEl = document.getElementById('cloudProjectsList');
        const emptyEl = document.getElementById('cloudEmptyState');
        if (listEl && emptyEl && listEl.children.length === 0) {
          emptyEl.style.display = 'block';
        }
        void handleDeleteProject(project.id);
      }
    });

    actions.appendChild(loadBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(info);
    card.appendChild(actions);
    listEl.appendChild(card);
  }
}

async function handleLoadProject(projectId: string): Promise<void> {
  const projectManager = (window as any).app?.projectManager;
  if (!projectManager) {
    console.error('[Cloud] Project manager not available');
    return;
  }

  try {
    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage('Loading project from cloud...', 'info');
    }

    const result = await cloudSaveService.loadProject(projectId);

    if (!result.success) {
      console.error('[Cloud] Load failed:', result.error);
      if (typeof (window as any).showStatusMessage === 'function') {
        (window as any).showStatusMessage('Failed to load: ' + result.error.message, 'error');
      }
      return;
    }

    const projectData = result.data.data as Record<string, unknown>;

    if (typeof projectManager.loadProjectFromData === 'function') {
      await projectManager.loadProjectFromData(projectData);
    } else {
      console.error('[Cloud] loadProjectFromData not available');
      if (typeof (window as any).showStatusMessage === 'function') {
        (window as any).showStatusMessage('Cloud load not supported in this version', 'error');
      }
      return;
    }

    cloudSaveService.setCurrentProjectId(projectId);
    closeCloudModal();

    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage('Project loaded from cloud', 'success');
    }
  } catch (error) {
    console.error('[Cloud] Load error:', error);
    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage(
        'Failed to load: ' + (error instanceof Error ? error.message : 'Unknown error'),
        'error'
      );
    }
  }
}

async function handleDeleteProject(projectId: string): Promise<void> {
  try {
    const result = await cloudSaveService.deleteProject(projectId);

    if (!result.success) {
      console.error('[Cloud] Delete failed:', result.error);
      if (typeof (window as any).showStatusMessage === 'function') {
        (window as any).showStatusMessage('Failed to delete: ' + result.error.message, 'error');
      }
      // Card was already removed optimistically — reload list to restore it
      await loadProjectsList(undefined, { forceRefresh: true });
      return;
    }

    cloudProjectsCache = cloudProjectsCache.filter(project => project.id !== projectId);

    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage('Project deleted', 'success');
    }
  } catch (error) {
    console.error('[Cloud] Delete error:', error);
    await loadProjectsList(undefined, { forceRefresh: true });
  }
}

function resetSaveBtn(): void {
  getCloudSaveButtons().forEach(saveBtn => {
    saveBtn.disabled = false;
    saveBtn.innerHTML = cloudSaveButtonMarkup;
  });
}

async function handleCloudSave(): Promise<void> {
  const projectManager = (window as any).app?.projectManager;
  if (!projectManager) {
    console.error('[Cloud] Project manager not available');
    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage('Project manager not available', 'error');
    }
    return;
  }

  const DEFAULT_PROJECT_NAME = 'OpenPaint Project';

  const canProceed = await ensureCloudSaveDetails();
  if (!canProceed) {
    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage(
        'Cloud save cancelled: missing required project details',
        'warning'
      );
    }
    return;
  }

  getCloudSaveButtons().forEach(saveBtn => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  });

  try {
    console.warn('[Cloud] Preparing project data for cloud save...');
    await projectManager.whenIdle?.({ timeoutMs: 5000 });
    const useR2Storage =
      (import.meta.env.VITE_STORAGE_PROVIDER || 'supabase').toLowerCase() === 'r2';

    // Wrap getProjectData in a 60-second timeout to prevent infinite hangs
    const projectData = await Promise.race([
      projectManager.getProjectData({
        embedImages: !useR2Storage,
        uploadImagesToR2: useR2Storage,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('getProjectData timed out after 60s')), 60000)
      ),
    ]);
    const payloadSize = JSON.stringify(projectData).length;
    const projectNameInput = document.getElementById('projectName') as HTMLInputElement | null;
    const projectNameFromInput = projectNameInput?.value?.trim() || '';
    const projectNameFromData =
      (((projectData as Record<string, unknown>)?.projectName as string) || '').trim() ||
      (((projectData as Record<string, unknown>)?.name as string) || '').trim() ||
      '';
    const projectName = projectNameFromInput || projectNameFromData || DEFAULT_PROJECT_NAME;
    if (projectNameInput && projectNameInput.value.trim() !== projectName) {
      projectNameInput.value = projectName;
    }

    console.warn(
      '[Cloud] Got project data, views:',
      Object.keys((projectData as any).views || {}).length,
      'payload:',
      (payloadSize / (1024 * 1024)).toFixed(1),
      'name:',
      projectName,
      'MB'
    );

    const currentId = cloudSaveService.getCurrentProjectId();
    console.warn('[Cloud] Saving to Supabase...', currentId ? `(updating ${currentId})` : '(new)');

    const result = await Promise.race([
      cloudSaveService.saveProject({
        name: projectName,
        projectData: projectData as Record<string, unknown>,
        currentProjectId: currentId,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Cloud save timed out after 45s')), 45000)
      ),
    ]);

    if (!result.success) {
      console.error('[Cloud] Save failed:', result.error);
      if (typeof (window as any).showStatusMessage === 'function') {
        (window as any).showStatusMessage('Cloud save failed: ' + result.error.message, 'error');
      }
      return;
    }

    console.warn('[Cloud] Save succeeded, id:', result.data.id);
    cloudSaveService.setCurrentProjectId(result.data.id);

    // Earn coins on successful qualifying cloud save
    if (isAuthEnabled()) {
      try {
        const [{ walletService }, { playCoinFlyAnimation }] = await Promise.all([
          import('@/services/wallet/walletService'),
          import('./coin-animation'),
        ]);
        const earnResult = await walletService.earnCoins(
          result.data.id,
          result.data.updated_at || new Date().toISOString(),
          projectData
        );
        if (earnResult.success && earnResult.data.earned > 0) {
          playCoinFlyAnimation();
          showRewardAchievement(`Save completed. ${earnResult.data.earned} gems awarded.`);
        } else {
          showRewardAchievement(getNoRewardMessage(earnResult.data.reason));
        }
      } catch {
        showRewardAchievement('Save completed. Gems status unavailable right now.');
      }
    }

    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage('Project saved to cloud', 'success');
    }
  } catch (error) {
    console.error('[Cloud] Save error:', error);
    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage(
        'Cloud save failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
        'error'
      );
    }
  } finally {
    resetSaveBtn();
  }
}

function openCloudModal(): void {
  if (!cloudModalOverlay) return;
  cloudModalOverlay.style.display = 'flex';
  requestAnimationFrame(() => {
    cloudModalOverlay!.classList.add('visible');
  });

  const searchInput = document.getElementById('cloudSearchInput') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = '';
  }

  void loadProjectsList('', { forceRefresh: true });
}

function closeCloudModal(): void {
  if (!cloudModalOverlay) return;
  cloudModalOverlay.classList.remove('visible');
  setTimeout(() => {
    if (cloudModalOverlay) cloudModalOverlay.style.display = 'none';
  }, 150);
}

function createCloudModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'cloud-modal-overlay';
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeCloudModal();
  });

  const card = document.createElement('div');
  card.className = 'cloud-modal-card';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cloud-modal-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', closeCloudModal);

  const heading = document.createElement('h2');
  heading.className = 'cloud-modal-heading';
  heading.textContent = 'My Cloud Projects';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'cloudSearchInput';
  searchInput.className = 'cloud-search-input';
  searchInput.placeholder = 'Search projects...';
  searchInput.addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadProjectsList(searchInput.value);
    }, 300);
  });

  const listContainer = document.createElement('div');
  listContainer.className = 'cloud-projects-list';
  listContainer.id = 'cloudProjectsList';

  const loadingEl = document.createElement('div');
  loadingEl.id = 'cloudLoadingState';
  loadingEl.className = 'cloud-loading';
  loadingEl.textContent = 'Loading projects...';
  loadingEl.style.display = 'none';

  const emptyEl = document.createElement('div');
  emptyEl.id = 'cloudEmptyState';
  emptyEl.className = 'cloud-empty-state';
  emptyEl.textContent = 'No projects found. Save a project to get started!';
  emptyEl.style.display = 'none';

  listContainer.appendChild(loadingEl);
  listContainer.appendChild(emptyEl);

  card.appendChild(closeBtn);
  card.appendChild(heading);
  card.appendChild(searchInput);
  card.appendChild(listContainer);
  overlay.appendChild(card);

  return overlay;
}

function updateCloudUI(user: AuthUser | null): void {
  const hasUser = user !== null;
  showCloudFeatures(hasUser);
  syncCloudPrimaryAction();
}

export function initCloudUI(): void {
  if (!isAuthEnabled() || !isSupabaseConfigured()) return;

  bindCloudSaveTriggers();

  const style = document.createElement('style');
  style.textContent = CLOUD_UI_STYLES;
  document.head.appendChild(style);

  document.getElementById('canvasMyProjectsBtn')?.addEventListener('click', () => {
    if (cloudMenuEmptyProjectMode) {
      void handleCloudSave();
      return;
    }
    openCloudModal();
  });

  cloudModalOverlay = createCloudModal();
  document.body.appendChild(cloudModalOverlay);

  unsubscribe = authService.onAuthStateChange(updateCloudUI);

  const currentUser = authService.getCurrentUser();
  updateCloudUI(currentUser);

  (window as Window & { syncCloudPrimaryAction?: () => void }).syncCloudPrimaryAction =
    syncCloudPrimaryAction;
  [
    'openpaint:view-switched',
    'openpaint:frame-tabs-updated',
    'openpaint:image-gallery-changed',
  ].forEach(eventName => window.addEventListener(eventName, scheduleCloudPrimaryActionSync));
  const imageList = document.getElementById('imageList');
  if (imageList) {
    new MutationObserver(scheduleCloudPrimaryActionSync).observe(imageList, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-label', 'src', 'style'],
    });
  }
  scheduleCloudPrimaryActionSync();
}

export function destroyCloudUI(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (cloudModalOverlay) {
    cloudModalOverlay.remove();
    cloudModalOverlay = null;
  }
}
