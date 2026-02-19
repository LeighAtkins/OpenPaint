import { normalizeCloudError } from './cloud/error-normalizer.js';
import { CLOUD_COPY } from './cloud/messages.js';
import { makeCloudFailure, makeCloudSuccess } from './cloud/result-factory.js';
import { cloudAssetCache } from './cloud/asset-cache.js';
import JSZip from 'jszip';

export class CloudProjectManager {
  constructor(app) {
    this.app = app;
    this.supabase = app.authManager.supabase;
    this.cloudStatusEl = null;
    this.syncOverlayEl = null;
    this.currentProjectId = null;
    this.manifestVersion = 0;
    this.viewVersions = {};
    this.assetBlobCache = new Map();
    this.assetObjectUrlCache = new Map();
    this.setupUI();
  }

  getStoredProjectId() {
    try {
      return localStorage.getItem('openpaint:cloudProjectId');
    } catch {
      return null;
    }
  }

  setStoredProjectId(projectId) {
    this.currentProjectId = projectId || null;
    try {
      if (projectId) {
        localStorage.setItem('openpaint:cloudProjectId', projectId);
      } else {
        localStorage.removeItem('openpaint:cloudProjectId');
      }
    } catch {
      // no-op
    }
  }

  getActiveProjectId() {
    return this.currentProjectId || this.getStoredProjectId();
  }

  async hashBlob(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const bytes = Array.from(new Uint8Array(digest));
    const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  }

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const str = String(reader.result || '');
        const comma = str.indexOf(',');
        resolve(comma >= 0 ? str.slice(comma + 1) : str);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  base64ToBlob(base64, contentType = 'application/octet-stream') {
    const binary = atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: contentType });
  }

  inferExtension(contentType, fallback = 'png') {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('png')) return 'png';
    if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
    if (type.includes('webp')) return 'webp';
    if (type.includes('gif')) return 'gif';
    if (type.includes('bmp')) return 'bmp';
    if (type.includes('svg')) return 'svg';
    return fallback;
  }

  sanitizeFilenamePart(value, fallback = 'image') {
    return (
      String(value || fallback)
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || fallback
    );
  }

  revokeAssetObjectUrls() {
    for (const url of this.assetObjectUrlCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // no-op
      }
    }
    this.assetObjectUrlCache.clear();
  }

  ensureSyncOverlay() {
    if (this.syncOverlayEl && document.body.contains(this.syncOverlayEl)) {
      return this.syncOverlayEl;
    }
    let overlay = document.getElementById('cloudSyncOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'cloudSyncOverlay';
      overlay.style.cssText =
        'position: fixed; inset: 0; z-index: 12000; background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(2px); display: none; align-items: center; justify-content: center;';
      overlay.innerHTML =
        '<div style="background:#ffffff; border-radius:12px; padding:18px 20px; min-width:320px; max-width:420px; box-shadow:0 10px 30px rgba(0,0,0,0.25); font-family: system-ui, -apple-system, sans-serif;"><div id="cloudSyncOverlayTitle" style="font-size:14px; font-weight:700; color:#0f172a; margin-bottom:8px;">Cloud Sync</div><div id="cloudSyncOverlayPhase" style="font-size:13px; color:#334155; margin-bottom:8px;">Starting...</div><div style="height:8px; background:#e2e8f0; border-radius:999px; overflow:hidden;"><div id="cloudSyncOverlayBar" style="height:100%; width:0%; background:#2563eb; transition:width 120ms ease;"></div></div><div id="cloudSyncOverlayDetail" style="font-size:12px; color:#64748b; margin-top:8px;">Preparing...</div></div>';
      document.body.appendChild(overlay);
    }
    this.syncOverlayEl = overlay;
    return overlay;
  }

  showSyncOverlay(title, phase) {
    const overlay = this.ensureSyncOverlay();
    const titleEl = overlay.querySelector('#cloudSyncOverlayTitle');
    const phaseEl = overlay.querySelector('#cloudSyncOverlayPhase');
    const detailEl = overlay.querySelector('#cloudSyncOverlayDetail');
    const barEl = overlay.querySelector('#cloudSyncOverlayBar');
    if (titleEl) titleEl.textContent = title || 'Cloud Sync';
    if (phaseEl) phaseEl.textContent = phase || 'Working...';
    if (detailEl) detailEl.textContent = 'Starting...';
    if (barEl) barEl.style.width = '0%';
    overlay.style.display = 'flex';
  }

  updateSyncOverlay(phase, detail = '', current = null, total = null) {
    const overlay = this.ensureSyncOverlay();
    const phaseEl = overlay.querySelector('#cloudSyncOverlayPhase');
    const detailEl = overlay.querySelector('#cloudSyncOverlayDetail');
    const barEl = overlay.querySelector('#cloudSyncOverlayBar');
    if (phaseEl) phaseEl.textContent = phase || 'Working...';
    if (detailEl) {
      if (typeof current === 'number' && typeof total === 'number' && total > 0) {
        detailEl.textContent = `${detail || ''} ${current}/${total}`.trim();
      } else {
        detailEl.textContent = detail || 'Working...';
      }
    }
    if (barEl && typeof current === 'number' && typeof total === 'number' && total > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
      barEl.style.width = `${pct}%`;
    }
  }

  hideSyncOverlay() {
    if (!this.syncOverlayEl) return;
    this.syncOverlayEl.style.display = 'none';
  }

  formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exp = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const n = value / 1024 ** exp;
    return `${n.toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
  }

  createTelemetry(kind) {
    return {
      kind,
      startedAt: Date.now(),
      uploadedBytes: 0,
      downloadedBytes: 0,
      uploadedAssets: 0,
      downloadedAssets: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  emitTelemetry(telemetry, extra = {}) {
    const payload = {
      ...telemetry,
      durationMs: Date.now() - telemetry.startedAt,
      ...extra,
    };
    console.log('[CloudTelemetry]', payload);
    window.dispatchEvent(new CustomEvent('openpaint:cloud-telemetry', { detail: payload }));
  }

  async apiRequest(operation, url, options = {}) {
    const sessionResult = await this.ensureActiveSession(operation);
    if (sessionResult.status === 'error') {
      return sessionResult;
    }

    const token = sessionResult?.data?.session?.access_token;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        return makeCloudFailure(
          operation,
          normalizeCloudError({
            statusCode: response.status,
            code: payload?.error?.code || payload?.code,
            message: payload?.error?.message || payload?.message || 'Cloud request failed',
            details: payload,
          }),
          { statusCode: response.status }
        );
      }

      if (payload?.status === 'error') {
        return makeCloudFailure(
          operation,
          normalizeCloudError({
            statusCode: payload?.statusCode || response.status,
            code: payload?.error?.code,
            message: payload?.error?.message || payload?.message || 'Cloud request failed',
            details: payload,
          }),
          { statusCode: payload?.statusCode || response.status }
        );
      }

      if (payload?.status === 'ok') {
        return payload;
      }

      return makeCloudSuccess(operation, payload || {}, { statusCode: response.status });
    } catch (error) {
      return makeCloudFailure(
        operation,
        normalizeCloudError({
          message: error?.message || 'Cloud request failed',
          name: error?.name,
        })
      );
    }
  }

  async cacheAsset(hash, blob, contentType) {
    if (!hash || !blob) return;
    this.assetBlobCache.set(hash, blob);
    await cloudAssetCache.put(hash, blob, contentType || blob.type || 'application/octet-stream');
  }

  async getCachedAsset(hash) {
    if (!hash) return null;
    const mem = this.assetBlobCache.get(hash);
    if (mem) return mem;
    const record = await cloudAssetCache.get(hash);
    if (record?.blob) {
      this.assetBlobCache.set(hash, record.blob);
      return record.blob;
    }
    return null;
  }

  applyBootstrapVersions(bootstrapData) {
    this.manifestVersion = Number(bootstrapData?.manifestVersion || 1);
    this.viewVersions = {};
    Object.entries(bootstrapData?.viewStates || {}).forEach(([viewId, entry]) => {
      this.viewVersions[viewId] = Number(entry?.version || 0);
    });
  }

  async refreshBootstrap(projectId) {
    const bootstrapResult = await this.apiRequest(
      'bootstrap',
      `/api/cloud-projects/${projectId}/bootstrap`
    );
    if (bootstrapResult.status === 'error') return bootstrapResult;
    this.applyBootstrapVersions(bootstrapResult.data || {});
    return bootstrapResult;
  }

  async patchViewWithRetry(projectId, viewId, viewState, maxAttempts = 2) {
    let attempt = 0;
    while (attempt < maxAttempts) {
      const baseVersion = Number(this.viewVersions?.[viewId] || 0);
      const viewResult = await this.apiRequest(
        'view_patch',
        `/api/cloud-projects/${projectId}/views/${encodeURIComponent(viewId)}`,
        {
          method: 'PATCH',
          body: {
            baseVersion,
            viewState,
          },
        }
      );

      if (viewResult.status !== 'error') {
        this.viewVersions[viewId] = Number(viewResult?.data?.viewVersion || baseVersion + 1);
        return viewResult;
      }

      if (viewResult?.error?.category !== 'conflict' || attempt + 1 >= maxAttempts) {
        return viewResult;
      }

      const refreshed = await this.refreshBootstrap(projectId);
      if (refreshed.status === 'error') return refreshed;
      attempt += 1;
    }

    return makeCloudFailure(
      'view_patch',
      normalizeCloudError({
        code: 'conflict',
        message: 'View patch conflict retry exhausted',
        statusCode: 409,
      }),
      { statusCode: 409 }
    );
  }

  async patchManifestWithRetry(projectId, patch, maxAttempts = 2) {
    let attempt = 0;
    while (attempt < maxAttempts) {
      const result = await this.apiRequest(
        'manifest_patch',
        `/api/cloud-projects/${projectId}/manifest`,
        {
          method: 'PATCH',
          body: {
            baseManifestVersion: this.manifestVersion || 1,
            patch,
          },
        }
      );

      if (result.status !== 'error') {
        this.manifestVersion = Number(result?.data?.manifestVersion || this.manifestVersion + 1);
        return result;
      }

      if (result?.error?.category !== 'conflict' || attempt + 1 >= maxAttempts) {
        return result;
      }

      const refreshed = await this.refreshBootstrap(projectId);
      if (refreshed.status === 'error') return refreshed;
      attempt += 1;
    }

    return makeCloudFailure(
      'manifest_patch',
      normalizeCloudError({
        code: 'conflict',
        message: 'Manifest patch conflict retry exhausted',
        statusCode: 409,
      }),
      { statusCode: 409 }
    );
  }

  ensureCloudStatusBadge() {
    if (this.cloudStatusEl && document.body.contains(this.cloudStatusEl)) {
      return this.cloudStatusEl;
    }

    let badge = document.getElementById('cloudSyncStatus');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'cloudSyncStatus';
      badge.style.cssText =
        'position: fixed; bottom: 16px; right: 16px; z-index: 9999; font-size: 12px; font-weight: 600; padding: 8px 10px; border-radius: 999px; background: #e5e7eb; color: #374151; box-shadow: 0 2px 10px rgba(0,0,0,0.08);';
      document.body.appendChild(badge);
    }
    this.cloudStatusEl = badge;
    return badge;
  }

  setCloudStatus(state, customText) {
    const badge = this.ensureCloudStatusBadge();
    let text = customText;
    let style = { background: '#e5e7eb', color: '#374151' };

    if (!text) {
      if (state === 'ready') {
        text = CLOUD_COPY.cloudBadge.ready;
        style = { background: '#dcfce7', color: '#166534' };
      } else if (state === 'syncing') {
        text = CLOUD_COPY.cloudBadge.syncing;
        style = { background: '#dbeafe', color: '#1d4ed8' };
      } else if (state === 'error') {
        text = CLOUD_COPY.cloudBadge.error;
        style = { background: '#fee2e2', color: '#991b1b' };
      } else {
        text = CLOUD_COPY.cloudBadge.offline;
      }
    }

    badge.textContent = text;
    badge.style.background = style.background;
    badge.style.color = style.color;
  }

  async ensureActiveSession(operation = 'save') {
    if (!this.supabase?.auth?.getSession) {
      return makeCloudFailure(
        operation,
        normalizeCloudError({ code: 'supabase_unavailable', message: 'Supabase not initialized' }),
        { statusCode: 503 }
      );
    }

    try {
      const { data, error } = await this.supabase.auth.getSession();
      if (error) {
        return makeCloudFailure(operation, normalizeCloudError(error), {
          statusCode: error?.status,
        });
      }

      if (!data?.session?.access_token || !data?.session?.user) {
        return makeCloudFailure(
          operation,
          normalizeCloudError({
            code: 'jwt_expired',
            message: 'No active session',
            statusCode: 401,
          }),
          { statusCode: 401 }
        );
      }

      return makeCloudSuccess(operation, {
        session: data.session,
        user: data.session.user,
      });
    } catch (error) {
      return makeCloudFailure(
        operation,
        normalizeCloudError({
          message: error?.message || 'Failed to validate session',
          name: error?.name,
        })
      );
    }
  }

  mapSupabaseError(operation, error) {
    const normalized = normalizeCloudError({
      statusCode: error?.status,
      code: error?.code,
      message: error?.message,
      details: error,
    });
    return makeCloudFailure(operation, normalized, { statusCode: error?.status });
  }

  async saveProject(projectData) {
    this.showSyncOverlay('Cloud Save', 'Preparing project sync...');
    const telemetry = this.createTelemetry('save');
    let telemetryEmitted = false;
    const sessionResult = await this.ensureActiveSession('save');
    if (sessionResult.status === 'error') {
      this.emitTelemetry(telemetry, { status: 'error', reason: 'session' });
      telemetryEmitted = true;
      this.hideSyncOverlay();
      return sessionResult;
    }

    try {
      const user = sessionResult.data.user;
      let projectId = this.getActiveProjectId();

      if (!projectId) {
        this.updateSyncOverlay('Creating cloud project...', 'Creating record');
        const createResult = await this.apiRequest('save', '/api/cloud-projects', {
          method: 'POST',
          body: {
            userId: user.id,
            title: projectData?.projectName || projectData?.name || 'Untitled Project',
            projectData: {
              manifest: {
                manifestVersion: 1,
                updatedAt: new Date().toISOString(),
                viewOrder: [],
                views: {},
                metadata: {},
                projectName: projectData?.projectName || projectData?.name || 'Untitled Project',
              },
              viewStates: {},
              assets: {},
              _meta: { ownerId: user.id },
            },
          },
        });
        if (createResult.status === 'error') return createResult;
        projectId = createResult?.projectId || createResult?.data?.projectId;
        if (!projectId) {
          return makeCloudFailure(
            'save',
            normalizeCloudError({
              code: 'invalid_response',
              message: 'Missing projectId from create',
            })
          );
        }
        this.setStoredProjectId(projectId);
      }

      this.updateSyncOverlay('Loading cloud manifest...', 'Reading current versions');
      const bootstrapResult = await this.apiRequest(
        'bootstrap',
        `/api/cloud-projects/${projectId}/bootstrap`
      );
      if (bootstrapResult.status === 'error')
        return makeCloudFailure('save', bootstrapResult.error);

      const bootstrapData = bootstrapResult.data || {};
      this.applyBootstrapVersions(bootstrapData);

      const liveViews = this.app?.projectManager?.views || {};
      const viewIds = Object.keys(projectData?.views || {});
      const viewAssetInfo = {};
      const assetBlobByHash = new Map();

      for (const viewId of viewIds) {
        const liveUrl = liveViews?.[viewId]?.image || projectData.views?.[viewId]?.imageUrl || null;
        if (!liveUrl) continue;
        try {
          const response = await fetch(liveUrl);
          const blob = await response.blob();
          const hash = await this.hashBlob(blob);
          viewAssetInfo[viewId] = {
            hash,
            contentType: blob.type || 'application/octet-stream',
          };
          assetBlobByHash.set(hash, blob);
          await this.cacheAsset(hash, blob, blob.type || 'application/octet-stream');
        } catch (error) {
          console.warn('[Cloud Save] Failed to hash image for view', viewId, error);
        }
      }

      const allHashes = Array.from(assetBlobByHash.keys());
      let missingHashes = allHashes;
      if (allHashes.length > 0) {
        this.updateSyncOverlay(
          'Checking image assets...',
          'Hash inventory',
          allHashes.length,
          allHashes.length
        );
        const existsResult = await this.apiRequest('assets_exists', '/api/cloud-assets/exists', {
          method: 'POST',
          body: {
            projectId,
            hashes: allHashes,
          },
        });
        if (existsResult.status === 'error') return makeCloudFailure('save', existsResult.error);
        missingHashes = existsResult?.data?.missing || [];
      }

      const uploadedAssetHashes = [];
      if (missingHashes.length > 0) {
        this.updateSyncOverlay('Uploading new image assets...', 'Assets', 0, missingHashes.length);
      }
      for (let uploadIndex = 0; uploadIndex < missingHashes.length; uploadIndex += 1) {
        const hash = missingHashes[uploadIndex];
        const blob = assetBlobByHash.get(hash);
        if (!blob) continue;
        this.updateSyncOverlay(
          'Uploading new image assets...',
          `${this.formatBytes(telemetry.uploadedBytes)} uploaded`,
          uploadIndex,
          missingHashes.length
        );
        const dataBase64 = await this.blobToBase64(blob);
        const uploadResult = await this.apiRequest(
          'asset_upload',
          `/api/cloud-assets/${encodeURIComponent(hash)}`,
          {
            method: 'PUT',
            body: {
              projectId,
              dataBase64,
              contentType: blob.type || 'application/octet-stream',
              sizeBytes: blob.size,
            },
          }
        );
        if (uploadResult.status === 'error') return makeCloudFailure('save', uploadResult.error);
        uploadedAssetHashes.push(hash);
        await this.cacheAsset(hash, blob, blob.type || 'application/octet-stream');
        telemetry.uploadedAssets += 1;
        telemetry.uploadedBytes += Number(blob.size || 0);
        this.updateSyncOverlay(
          'Uploading new image assets...',
          `${this.formatBytes(telemetry.uploadedBytes)} uploaded`,
          uploadIndex + 1,
          missingHashes.length
        );
      }

      const syncedViewIds = [];
      this.updateSyncOverlay('Syncing view states...', 'Views', 0, viewIds.length || 1);
      for (let viewIndex = 0; viewIndex < viewIds.length; viewIndex += 1) {
        const viewId = viewIds[viewIndex];
        const originalViewState = projectData.views?.[viewId] || {};
        const assetHash = viewAssetInfo?.[viewId]?.hash || null;
        const fallbackImageUrl =
          originalViewState.imageUrl || this.app?.projectManager?.views?.[viewId]?.image || null;
        const patchedViewState = {
          ...originalViewState,
          imageDataURL: null,
          imageUrl: assetHash ? null : fallbackImageUrl,
          imageAssetHash: assetHash,
        };
        const viewResult = await this.patchViewWithRetry(projectId, viewId, patchedViewState, 2);
        if (viewResult.status === 'error') return makeCloudFailure('save', viewResult.error);
        syncedViewIds.push(viewId);
        this.updateSyncOverlay(
          'Syncing view states...',
          'Views',
          viewIndex + 1,
          viewIds.length || 1
        );
      }

      const manifestViews = {};
      viewIds.forEach(viewId => {
        const info = viewAssetInfo?.[viewId] || null;
        manifestViews[viewId] = {
          assetHash: info?.hash || null,
          contentType: info?.contentType || null,
          externalImageUrl: info?.hash ? null : projectData?.views?.[viewId]?.imageUrl || null,
          latestViewVersion: Number(this.viewVersions?.[viewId] || 0),
          updatedAt: new Date().toISOString(),
        };
      });

      const manifestPatch = {
        projectName: projectData?.projectName || projectData?.name || 'Untitled Project',
        currentViewId: projectData?.currentViewId || viewIds[0] || 'front',
        viewOrder: Array.isArray(projectData?.viewOrder) ? projectData.viewOrder : viewIds,
        views: manifestViews,
        metadata: projectData?.metadata || {},
        _meta: {
          ownerId: user.id,
        },
      };

      const manifestResult = await this.patchManifestWithRetry(projectId, manifestPatch, 2);
      if (manifestResult.status === 'error') return makeCloudFailure('save', manifestResult.error);
      this.updateSyncOverlay(
        'Finalizing cloud save...',
        `Uploaded ${telemetry.uploadedAssets} assets (${this.formatBytes(telemetry.uploadedBytes)})`
      );

      this.setStoredProjectId(projectId);

      this.emitTelemetry(telemetry, {
        status: 'ok',
        projectId,
        syncedViews: syncedViewIds.length,
      });
      telemetryEmitted = true;

      return makeCloudSuccess('save', {
        projectId,
        manifestVersion: this.manifestVersion,
        syncedViewIds,
        uploadedAssetHashes,
        telemetry: {
          uploadedAssets: telemetry.uploadedAssets,
          uploadedBytes: telemetry.uploadedBytes,
        },
        message: CLOUD_COPY.save.cloudSuccess,
      });
    } finally {
      if (!telemetryEmitted) {
        this.emitTelemetry(telemetry, { status: 'error', reason: 'save_failed' });
      }
      setTimeout(() => this.hideSyncOverlay(), 250);
    }
  }

  async listProjects() {
    const user = this.app.authManager.getUser();
    if (!user) {
      return makeCloudFailure(
        'list',
        normalizeCloudError({
          code: 'auth_required',
          message: 'User not logged in',
          statusCode: 401,
        }),
        { statusCode: 401 }
      );
    }

    const result = await this.apiRequest(
      'list',
      `/api/cloud-projects/list/${encodeURIComponent(user.id)}`
    );
    if (result.status === 'error') return result;
    return makeCloudSuccess(
      'list',
      { projects: result?.data?.projects || [] },
      { statusCode: 200 }
    );
  }

  async loadProject(projectId) {
    this.showSyncOverlay('Cloud Load', 'Loading cloud project...');
    const telemetry = this.createTelemetry('load');
    let telemetryEmitted = false;
    const targetProjectId = projectId || this.getActiveProjectId();
    if (!targetProjectId) {
      this.emitTelemetry(telemetry, { status: 'error', reason: 'missing_project' });
      telemetryEmitted = true;
      this.hideSyncOverlay();
      return makeCloudFailure(
        'load',
        normalizeCloudError({
          code: 'not_found',
          message: 'No cloud project selected',
          statusCode: 404,
        }),
        { statusCode: 404 }
      );
    }

    try {
      this.setStoredProjectId(targetProjectId);
      const bootstrapResult = await this.apiRequest(
        'bootstrap',
        `/api/cloud-projects/${targetProjectId}/bootstrap`
      );
      if (bootstrapResult.status === 'error')
        return makeCloudFailure('load', bootstrapResult.error);
      this.updateSyncOverlay('Preparing project package...', 'Reading manifest');

      const bootstrapData = bootstrapResult.data || {};
      const manifest = bootstrapData.manifest || {};
      const viewStates = bootstrapData.viewStates || {};
      const viewOrder = Array.isArray(manifest.viewOrder)
        ? manifest.viewOrder
        : Object.keys(viewStates || {});

      const projectData = {
        version: '2.0-fabric',
        projectName: manifest.projectName || 'OpenPaint Project',
        name: manifest.projectName || 'OpenPaint Project',
        createdAt: new Date().toISOString(),
        updatedAt: manifest.updatedAt || new Date().toISOString(),
        currentViewId: manifest.currentViewId || viewOrder[0] || 'front',
        metadata: manifest.metadata || {},
        viewOrder,
        views: {},
      };

      const zip = new JSZip();

      for (let viewIndex = 0; viewIndex < viewOrder.length; viewIndex += 1) {
        const viewId = viewOrder[viewIndex];
        const stateWrapper = viewStates?.[viewId];
        const state = stateWrapper?.state || {};
        const viewManifest = manifest?.views?.[viewId] || {};
        const assetHash = viewManifest.assetHash || state.imageAssetHash || null;

        const entry = {
          canvasJSON: state.canvasJSON || null,
          imageDataURL: null,
          imageUrl: null,
          imageAssetPath: null,
          metadata: state.metadata || {},
          tabs: state.tabs || null,
        };

        if (assetHash) {
          let blob = await this.getCachedAsset(assetHash);
          let contentType = viewManifest.contentType || 'application/octet-stream';

          if (!blob) {
            telemetry.cacheMisses += 1;
            this.updateSyncOverlay(
              'Downloading cloud images...',
              `${this.formatBytes(telemetry.downloadedBytes)} downloaded`,
              viewIndex,
              viewOrder.length || 1
            );
            const assetResult = await this.apiRequest(
              'asset_upload',
              `/api/cloud-assets/${encodeURIComponent(assetHash)}?projectId=${encodeURIComponent(targetProjectId)}`
            );
            if (assetResult.status === 'error') return makeCloudFailure('load', assetResult.error);

            const assetData = assetResult.data || {};
            contentType = assetData.contentType || contentType;
            blob = this.base64ToBlob(assetData.dataBase64 || '', contentType);
            await this.cacheAsset(assetHash, blob, contentType);
            telemetry.downloadedAssets += 1;
            telemetry.downloadedBytes += Number(assetData.sizeBytes || blob.size || 0);
          } else {
            telemetry.cacheHits += 1;
          }

          const extension = this.inferExtension(contentType, 'png');
          const imagePath = `images/${this.sanitizeFilenamePart(viewId, 'view')}.${extension}`;
          zip.file(imagePath, blob);
          entry.imageAssetPath = imagePath;
          entry.imageUrl = imagePath;
        } else {
          entry.imageUrl = state.imageUrl || viewManifest.externalImageUrl || null;
        }

        projectData.views[viewId] = entry;
        this.updateSyncOverlay(
          'Preparing project package...',
          `Views ${viewIndex + 1}/${viewOrder.length || 1} | cache hits ${telemetry.cacheHits}`,
          viewIndex + 1,
          viewOrder.length || 1
        );
      }

      zip.file('project.json', JSON.stringify(projectData, null, 2));
      this.updateSyncOverlay(
        'Opening project in editor...',
        `Downloaded ${telemetry.downloadedAssets} assets (${this.formatBytes(telemetry.downloadedBytes)})`
      );
      const archiveBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const fileName = `${this.sanitizeFilenamePart(projectData.projectName, 'OpenPaint Project')}.opaint`;
      const file = new File([archiveBlob], fileName, { type: 'application/octet-stream' });
      await this.app.projectManager.loadProject(file);

      const projectsModal = document.getElementById('projectsModal');
      if (projectsModal) projectsModal.classList.add('hidden');

      const nameInput = document.getElementById('projectName');
      if (nameInput) nameInput.value = projectData.projectName;

      this.applyBootstrapVersions(bootstrapData);

      this.emitTelemetry(telemetry, {
        status: 'ok',
        projectId: targetProjectId,
        viewCount: viewOrder.length,
      });
      telemetryEmitted = true;

      return makeCloudSuccess('load', {
        projectId: targetProjectId,
        manifestVersion: this.manifestVersion,
        requiredAssetHashes: bootstrapData.requiredAssetHashes || [],
        telemetry: {
          downloadedAssets: telemetry.downloadedAssets,
          downloadedBytes: telemetry.downloadedBytes,
          cacheHits: telemetry.cacheHits,
          cacheMisses: telemetry.cacheMisses,
        },
      });
    } finally {
      if (!telemetryEmitted) {
        this.emitTelemetry(telemetry, { status: 'error', reason: 'load_failed' });
      }
      setTimeout(() => this.hideSyncOverlay(), 250);
    }
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
          this.setCloudStatus('ready');
        } else {
          if (saveCloudBtn) saveCloudBtn.classList.add('hidden');
          if (myProjectsBtn) myProjectsBtn.classList.add('hidden');
          this.setCloudStatus('offline');
        }
      });
    } else {
      console.warn('[Cloud] Supabase not initialized, cloud features disabled');
      if (saveCloudBtn) saveCloudBtn.classList.add('hidden');
      if (myProjectsBtn) myProjectsBtn.classList.add('hidden');
      this.setCloudStatus('offline');
    }

    window.addEventListener('openpaint:auth-state', event => {
      const state = event?.detail?.state;
      if (state === 'logged_in') {
        this.setCloudStatus('ready');
      } else if (state === 'expired') {
        this.setCloudStatus('error', CLOUD_COPY.auth.expired);
      } else {
        this.setCloudStatus('offline');
      }
    });

    if (saveCloudBtn) {
      saveCloudBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('projectName');
        const name = nameInput ? nameInput.value : 'Untitled Project';

        // Get current project data
        const projectData = await this.app.projectManager.getProjectData();
        projectData.name = name; // Ensure name is in data

        this.setCloudStatus('syncing');
        const result = await this.saveProject(projectData);
        if (result.status === 'error') {
          this.setCloudStatus('error', result.error.userMessage);
          alert(result.error.userMessage);
        } else {
          this.setCloudStatus('ready');
          alert(CLOUD_COPY.save.cloudSuccess);
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

    const result = await this.listProjects();

    if (result.status === 'error') {
      listContainer.innerHTML = `<div class="text-center py-8 text-red-500 col-span-full">Error loading projects: ${result.error.userMessage}</div>`;
      return;
    }

    const projects = result.data.projects;

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
