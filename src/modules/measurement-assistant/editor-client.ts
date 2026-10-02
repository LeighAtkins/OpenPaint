import { z } from 'zod';
import type { ProjectManager } from '../ProjectManager';
import type { MeasurementOverlayManager } from '../measurement-mos/MeasurementOverlayManager';
import { measurementPlacementSchema } from './placement-model';
import { readBoundedBody } from './mcp/image-input';

const draftResponse = z.object({
  projectId: z.string().uuid(),
  images: z
    .array(
      z.object({
        id: z.string().uuid(),
        view: z.string(),
        src: z.string().url(),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      })
    )
    .min(1)
    .max(10),
  placement: measurementPlacementSchema.nullable(),
});
interface EditorApp {
  projectManager: ProjectManager;
  measurementOverlayManager: MeasurementOverlayManager;
  historyManager: { saveState(): void };
}
export async function importMeasurementDraft(
  app: EditorApp,
  draftUrl: string,
  token: string
): Promise<void> {
  const url = new URL(draftUrl);
  const configuredOrigin = String(import.meta.env['VITE_MEASUREMENT_MCP_ORIGIN'] || '');
  const local =
    ['localhost', '127.0.0.1'].includes(location.hostname) &&
    ['http://localhost:8789', 'http://127.0.0.1:8789'].includes(url.origin);
  if (
    (!local && (!configuredOrigin || url.origin !== new URL(configuredOrigin).origin)) ||
    !/^\/projects\/[a-f0-9-]{36}$/.test(url.pathname) ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new Error('This measurement draft service is not configured in the editor.');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('The measurement draft has expired or is unavailable.');
  const data = draftResponse.parse(
    JSON.parse(new TextDecoder().decode(await readBoundedBody(response.body, 1024 * 1024)))
  );
  if (!url.pathname.endsWith(data.projectId))
    throw new Error('Draft identity does not match the editor link.');
  // Fetch every photo before mutating the editor, so failed handoff leaves its existing work intact.
  const photos: Array<{ image: (typeof data.images)[number]; file: File; source: string }> = [];
  for (const image of data.images) {
    const sourceUrl = new URL(image.src);
    if (
      sourceUrl.origin !== url.origin ||
      sourceUrl.pathname !== `${url.pathname}/images/${image.id}`
    )
      throw new Error('Unexpected draft image source.');
    const imageResponse = await fetch(sourceUrl, { credentials: 'omit', redirect: 'error' });
    if (!imageResponse.ok) throw new Error('A draft photo is unavailable.');
    const bytes = await readBoundedBody(imageResponse.body, 20 * 1024 * 1024);
    const file = new File(
      [new Uint8Array(bytes).buffer],
      `${image.view}-${image.id}.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'}`,
      { type: image.mimeType }
    );
    photos.push({ image, file, source: URL.createObjectURL(file) });
  }
  const manager = app.projectManager;
  for (const { image, file, source } of photos) {
    const viewId = `mcp_${image.id}`;
    manager.registerViewImageFile(viewId, file);
    await manager.addImage(viewId, source, { refreshBackground: false });
    const legacyWindow = window as Window & {
      addImageToSidebar?: (source: string, viewId: string, name: string) => void;
    };
    legacyWindow.addImageToSidebar?.(source, viewId, image.view);
  }
  const firstView = `mcp_${photos[0].image.id}`;
  await manager.switchView(firstView);
  if (data.placement) {
    // Store all views; only the current photo is mounted on the live canvas.
    for (const { image } of photos)
      await app.measurementOverlayManager.importPlacement(
        data.placement,
        image.id,
        `mcp_${image.id}`
      );
    await app.measurementOverlayManager.mountView(firstView);
  }
  app.historyManager.saveState();
}
export async function importDraftFromLocation(app: EditorApp): Promise<void> {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const url = parameters.get('measurementDraft');
  const token = parameters.get('key');
  if (!url || !token) return;
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.textContent = 'Opening your measurement drawing…';
  Object.assign(status.style, {
    position: 'fixed',
    bottom: '18px',
    left: '18px',
    zIndex: '10000',
    padding: '12px 18px',
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    color: '#111827',
  });
  document.body.appendChild(status);
  try {
    await importMeasurementDraft(app, url, token);
    parameters.delete('measurementDraft');
    parameters.delete('key');
    history.replaceState(
      null,
      '',
      `${location.pathname}${location.search}${parameters.size ? `#${parameters}` : ''}`
    );
    status.textContent = 'Measurement drawing ready. Lines and labels are editable.';
    window.setTimeout(() => status.remove(), 4000);
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : 'Could not open the measurement drawing.';
  }
}
