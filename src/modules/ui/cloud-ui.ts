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
    display: flex;
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
    btn.classList.toggle('visible', show);
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
    card.innerHTML = `
      <div class="cloud-project-info">
        <div class="cloud-project-name">${project.name}</div>
        <div class="cloud-project-date">${formatDate(project.updated_at)}</div>
      </div>
      <div class="cloud-project-actions">
        <button class="cloud-load-btn" data-project-id="${project.id}">Load</button>
        <button class="cloud-delete-btn" data-project-id="${project.id}">Delete</button>
      </div>
    `;
    listEl.appendChild(card);
  }

  listEl.querySelectorAll('.cloud-load-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const projectId = (e.target as HTMLElement).dataset.projectId;
      if (projectId) {
        await handleLoadProject(projectId);
      }
    });
  });

  listEl.querySelectorAll('.cloud-delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const projectId = (e.target as HTMLElement).dataset.projectId;
      if (projectId && confirm('Are you sure you want to delete this project?')) {
        await handleDeleteProject(projectId);
      }
    });
  });
}

async function handleLoadProject(projectId: string): Promise<void> {
  const projectManager = window.app?.projectManager;
  if (!projectManager) {
    alert('Project manager not available');
    return;
  }

  const loadBtn = document.querySelector(
    `[data-project-id="${projectId}"].cloud-load-btn`
  ) as HTMLButtonElement;
  if (loadBtn) {
    loadBtn.textContent = 'Loading...';
    loadBtn.disabled = true;
  }

  const result = await cloudSaveService.loadProject(projectId);

  if (!result.success) {
    alert('Failed to load project: ' + result.error.message);
    if (loadBtn) {
      loadBtn.textContent = 'Load';
      loadBtn.disabled = false;
    }
    return;
  }

  const projectData = result.data.data as Record<string, unknown>;

  if (typeof (projectManager as any).loadProjectFromData === 'function') {
    await (projectManager as any).loadProjectFromData(projectData);
  } else {
    alert('Cloud load not supported yet');
    if (loadBtn) {
      loadBtn.textContent = 'Load';
      loadBtn.disabled = false;
    }
    return;
  }

  cloudSaveService.setCurrentProjectId(projectId);

  closeCloudModal();

  if (window.app?.showStatusMessage) {
    window.app.showStatusMessage('Project loaded from cloud', 'success');
  }
}

async function handleDeleteProject(projectId: string): Promise<void> {
  const result = await cloudSaveService.deleteProject(projectId);

  if (!result.success) {
    alert('Failed to delete project: ' + result.error.message);
    return;
  }

  await loadProjectsList();

  if (window.app?.showStatusMessage) {
    window.app.showStatusMessage('Project deleted', 'success');
  }
}

async function handleCloudSave(): Promise<void> {
  const projectManager = window.app?.projectManager;
  if (!projectManager) {
    alert('Project manager not available');
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
    const projectData = await projectManager.getProjectData({ embedImages: true });
    const currentId = cloudSaveService.getCurrentProjectId();

    const result = await cloudSaveService.saveProject({
      name: projectName,
      projectData,
      currentProjectId: currentId,
    });

    if (!result.success) {
      alert('Failed to save: ' + result.error.message);
      return;
    }

    cloudSaveService.setCurrentProjectId(result.data.id);

    if (window.app?.showStatusMessage) {
      window.app.showStatusMessage('Project saved to cloud', 'success');
    }
  } catch (error) {
    alert('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error'));
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg><span class="label-long">Cloud Save</span>`;
    }
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
