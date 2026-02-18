// Cloud UI - Cloud Save button + My Projects modal
import { authService, type AuthUser } from '@/services/auth/authService';
import { cloudSaveService, type CloudProjectSummary } from '@/services/cloud/cloudSaveService';
import { isAuthEnabled, isSupabaseConfigured } from '@/utils/env';

const CLOUD_UI_STYLES = /* css */ `
  .cloud-toolbar-group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
  }

  .cloud-save-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .cloud-projects-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
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
let cloudToolbarGroup: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

function showCloudFeatures(show: boolean): void {
  if (!cloudToolbarGroup) return;
  const btns = cloudToolbarGroup.querySelectorAll<HTMLElement>(
    '.cloud-save-btn, .cloud-projects-btn'
  );
  btns.forEach(btn => {
    btn.style.display = show ? 'inline-flex' : 'none';
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function loadProjectsList(search?: string): Promise<void> {
  const listEl = document.getElementById('cloudProjectsList');
  const loadingEl = document.getElementById('cloudLoadingState');
  const emptyEl = document.getElementById('cloudEmptyState');

  if (!listEl || !loadingEl || !emptyEl) return;

  loadingEl.style.display = 'block';
  listEl.innerHTML = '';
  emptyEl.style.display = 'none';

  const result = await cloudSaveService.listProjects(search);

  loadingEl.style.display = 'none';

  if (!result.success) {
    listEl.innerHTML = `<div class="cloud-error">Failed to load projects: ${result.error.message}</div>`;
    return;
  }

  const projects = result.data;

  if (projects.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  for (const project of projects) {
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
    loadBtn.className = 'cloud-load-btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => void handleLoadProject(project.id));

    const deleteBtn = document.createElement('button');
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
      await loadProjectsList();
      return;
    }

    if (typeof (window as any).showStatusMessage === 'function') {
      (window as any).showStatusMessage('Project deleted', 'success');
    }
  } catch (error) {
    console.error('[Cloud] Delete error:', error);
    await loadProjectsList();
  }
}

function resetSaveBtn(): void {
  const saveBtn = document.getElementById('authCloudSaveBtn') as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg><span class="label-long">Cloud Save</span>`;
  }
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

  const projectNameInput = document.getElementById('projectName') as HTMLInputElement | null;
  const projectName = projectNameInput?.value?.trim() || 'Untitled Project';

  const saveBtn = document.getElementById('authCloudSaveBtn') as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    console.warn('[Cloud] Getting project data with embedded images...');
    const useR2Storage =
      String(import.meta.env.VITE_STORAGE_PROVIDER || 'supabase').toLowerCase() === 'r2';

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
    console.warn(
      '[Cloud] Got project data, views:',
      Object.keys((projectData as any).views || {}).length,
      'payload:',
      (payloadSize / (1024 * 1024)).toFixed(1),
      'MB'
    );

    const currentId = cloudSaveService.getCurrentProjectId();
    console.warn('[Cloud] Saving to Supabase...', currentId ? `(updating ${currentId})` : '(new)');

    const result = await cloudSaveService.saveProject({
      name: projectName,
      projectData: projectData as Record<string, unknown>,
      currentProjectId: currentId,
    });

    if (!result.success) {
      console.error('[Cloud] Save failed:', result.error);
      if (typeof (window as any).showStatusMessage === 'function') {
        (window as any).showStatusMessage('Cloud save failed: ' + result.error.message, 'error');
      }
      return;
    }

    console.warn('[Cloud] Save succeeded, id:', result.data.id);
    cloudSaveService.setCurrentProjectId(result.data.id);

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

  loadProjectsList();
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
  listContainer.id = 'cloudProjectsList';

  card.appendChild(closeBtn);
  card.appendChild(heading);
  card.appendChild(searchInput);
  card.appendChild(listContainer);
  overlay.appendChild(card);

  return overlay;
}

function createCloudToolbarGroup(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'cloud-toolbar-group';
  group.id = 'cloudToolbarGroup';

  const cloudSaveBtn = document.createElement('button');
  cloudSaveBtn.className = 'tbtn cloud-save-btn';
  cloudSaveBtn.id = 'authCloudSaveBtn';
  cloudSaveBtn.title = 'Save to cloud';
  cloudSaveBtn.setAttribute('aria-label', 'Cloud save');
  cloudSaveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg><span class="label-long">Cloud Save</span>`;
  cloudSaveBtn.addEventListener('click', handleCloudSave);
  cloudSaveBtn.style.display = 'none';

  const myProjectsBtn = document.createElement('button');
  myProjectsBtn.className = 'tbtn cloud-projects-btn';
  myProjectsBtn.id = 'authMyProjectsBtn';
  myProjectsBtn.title = 'My Projects';
  myProjectsBtn.setAttribute('aria-label', 'My Projects');
  myProjectsBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span class="label-long">My Projects</span>`;
  myProjectsBtn.addEventListener('click', openCloudModal);
  myProjectsBtn.style.display = 'none';

  group.appendChild(cloudSaveBtn);
  group.appendChild(myProjectsBtn);

  return group;
}

function updateCloudUI(user: AuthUser | null): void {
  const hasUser = user !== null;
  showCloudFeatures(hasUser);
}

export function initCloudUI(): void {
  if (!isAuthEnabled() || !isSupabaseConfigured()) return;

  const style = document.createElement('style');
  style.textContent = CLOUD_UI_STYLES;
  document.head.appendChild(style);

  const authToolbarGroup = document.getElementById('authToolbarGroup');
  if (authToolbarGroup) {
    cloudToolbarGroup = createCloudToolbarGroup();
    authToolbarGroup.appendChild(cloudToolbarGroup);
  }

  cloudModalOverlay = createCloudModal();
  document.body.appendChild(cloudModalOverlay);

  unsubscribe = authService.onAuthStateChange(updateCloudUI);

  const currentUser = authService.getCurrentUser();
  updateCloudUI(currentUser);
}

export function destroyCloudUI(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (cloudToolbarGroup) {
    cloudToolbarGroup.remove();
    cloudToolbarGroup = null;
  }
  if (cloudModalOverlay) {
    cloudModalOverlay.remove();
    cloudModalOverlay = null;
  }
}
