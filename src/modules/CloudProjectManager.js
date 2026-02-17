export class CloudProjectManager {
  constructor(app) {
    this.app = app;
    this.supabase = app.authManager.supabase;
    this.setupUI();
  }

  async saveProject(projectData) {
    const user = this.app.authManager.getUser();
    if (!user) return { error: 'User not logged in' };

    try {
      // 1. Create or update project record
      const { data: project, error: projectError } = await this.supabase
        .from('projects')
        .upsert({
          created_by: user.id,
          project_name: projectData.name || 'Untitled Project',
          data: projectData, // Store full JSON for now
          updated_at: new Date(),
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // 2. Upload images (if needed)
      // For now, we are storing data URLs in the JSON, which is not ideal for large projects
      // but simplifies the initial implementation.
      // TODO: Upload Blob/File objects to Storage and store URLs in JSON

      return { data: project };
    } catch (error) {
      console.error('[Cloud] Save error:', error);
      return { error };
    }
  }

  async listProjects() {
    const user = this.app.authManager.getUser();
    if (!user) return { error: 'User not logged in' };

    const { data, error } = await this.supabase
      .from('projects')
      .select('*')
      .eq('created_by', user.id)
      .order('updated_at', { ascending: false });

    return { data, error };
  }

  async loadProject(projectId) {
    const { data, error } = await this.supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (error) return { error };

    // Restore project state
    if (data.data) {
      await this.app.projectManager.loadProjectData(data.data);

      // Close modal
      const projectsModal = document.getElementById('projectsModal');
      if (projectsModal) projectsModal.classList.add('hidden');

      // Update project name
      const nameInput = document.getElementById('projectName');
      if (nameInput) nameInput.value = data.name;
    }

    return { data };
  }

  setupUI() {
    const saveCloudBtn = document.getElementById('saveCloudBtn');
    const myProjectsBtn = document.getElementById('myProjectsBtn');
    const projectsModal = document.getElementById('projectsModal');
    const closeProjectsModal = document.getElementById('closeProjectsModal');

    // Show buttons if user is logged in
    if (this.app.authManager.supabase) {
      this.app.authManager.supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          if (saveCloudBtn) saveCloudBtn.classList.remove('hidden');
          if (myProjectsBtn) myProjectsBtn.classList.remove('hidden');
        } else {
          if (saveCloudBtn) saveCloudBtn.classList.add('hidden');
          if (myProjectsBtn) myProjectsBtn.classList.add('hidden');
        }
      });
    } else {
      console.warn('[Cloud] Supabase not initialized, cloud features disabled');
      if (saveCloudBtn) saveCloudBtn.classList.add('hidden');
      if (myProjectsBtn) myProjectsBtn.classList.add('hidden');
    }

    if (saveCloudBtn) {
      saveCloudBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('projectName');
        const name = nameInput ? nameInput.value : 'Untitled Project';

        // Get current project data
        const projectData = await this.app.projectManager.getProjectData();
        projectData.name = name; // Ensure name is in data

        const result = await this.saveProject(projectData);
        if (result.error) {
          alert('Error saving project: ' + result.error.message);
        } else {
          alert('Project saved successfully!');
        }
      });
    }

    if (myProjectsBtn) {
      myProjectsBtn.addEventListener('click', async () => {
        if (projectsModal) {
          projectsModal.classList.remove('hidden');
          await this.renderProjectsList();
        }
      });
    }

    if (closeProjectsModal) {
      closeProjectsModal.addEventListener('click', () => {
        if (projectsModal) projectsModal.classList.add('hidden');
      });
    }
  }

  async renderProjectsList() {
    const listContainer = document.getElementById('projectsList');
    if (!listContainer) return;

    listContainer.innerHTML =
      '<div class="text-center py-8 text-gray-500 col-span-full">Loading projects...</div>';

    const { data: projects, error } = await this.listProjects();

    if (error) {
      listContainer.innerHTML = `<div class="text-center py-8 text-red-500 col-span-full">Error loading projects: ${error.message}</div>`;
      return;
    }

    if (!projects || projects.length === 0) {
      listContainer.innerHTML =
        '<div class="text-center py-8 text-gray-500 col-span-full">No projects found. Save one to get started!</div>';
      return;
    }

    listContainer.innerHTML = '';
    projects.forEach(project => {
      const card = document.createElement('div');
      card.className =
        'bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col gap-2';

      const date = new Date(project.updated_at).toLocaleDateString();

      card.innerHTML = `
                <h4 class="font-semibold text-gray-800 truncate" title="${project.name}">${project.name}</h4>
                <p class="text-xs text-gray-500">Last updated: ${date}</p>
                <div class="mt-auto pt-2 flex gap-2">
                    <button class="load-project-btn flex-1 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded text-sm font-medium transition-colors" data-id="${project.id}">Load</button>
                    <!-- <button class="delete-project-btn bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded text-sm font-medium transition-colors" data-id="${project.id}">Delete</button> -->
                </div>
            `;

      const loadBtn = card.querySelector('.load-project-btn');
      loadBtn.addEventListener('click', () => this.loadProject(project.id));

      listContainer.appendChild(card);
    });
  }
}
