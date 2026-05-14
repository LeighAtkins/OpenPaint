import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudSaveService } from '../../src/services/cloud/cloudSaveService';

const authKey = 'sb-test-auth-token';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('cloudSaveService', () => {
  beforeEach(() => {
    localStorage.setItem(
      authKey,
      JSON.stringify({
        access_token: 'token-123',
        user: { id: 'user-123' },
      })
    );
    cloudSaveService.clearCurrentProject();
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    cloudSaveService.clearCurrentProject();
  });

  it('verifies the persisted project data before reporting save success', async () => {
    let savedProof = '';
    fetch.mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        savedProof = body.data._meta.cloudSaveProof;
        return jsonResponse([
          {
            id: 'project-1',
            project_name: 'Chair',
            created_by: 'user-123',
            created_at: '2026-05-14T00:00:00.000Z',
            updated_at: '2026-05-14T00:00:00.000Z',
          },
        ]);
      }

      return jsonResponse([
        {
          id: 'project-1',
          project_name: 'Chair',
          created_by: 'user-123',
          created_at: '2026-05-14T00:00:00.000Z',
          updated_at: '2026-05-14T00:00:01.000Z',
          data: { views: {}, _meta: { cloudSaveProof: savedProof } },
        },
      ]);
    });

    const result = await cloudSaveService.saveProject({
      name: 'Chair',
      projectData: { views: {} },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.id).toBe('project-1');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cloudSaveService.getCurrentProjectId()).toBe('project-1');
  });

  it('fails when the read-after-write proof does not match', async () => {
    fetch.mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        return jsonResponse([
          {
            id: 'project-2',
            project_name: 'Sofa',
            created_by: 'user-123',
            created_at: '2026-05-14T00:00:00.000Z',
            updated_at: '2026-05-14T00:00:00.000Z',
          },
        ]);
      }

      return jsonResponse([
        {
          id: 'project-2',
          project_name: 'Sofa',
          created_by: 'user-123',
          created_at: '2026-05-14T00:00:00.000Z',
          updated_at: '2026-05-14T00:00:01.000Z',
          data: { views: {}, _meta: { cloudSaveProof: 'old-save' } },
        },
      ]);
    });

    const result = await cloudSaveService.saveProject({
      name: 'Sofa',
      projectData: { views: {} },
    });

    expect(result.success).toBe(false);
    expect(result.success || result.error.message).toContain('Cloud save did not verify');
  });
});
