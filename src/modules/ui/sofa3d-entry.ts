import type { StudioOpenRequest } from '../sofa3d/adapters';
export function initSofa3dStudio(): void {
  if (document.getElementById('sofa3dStudioBtn')) return;
  const host = document.getElementById('tbRight');
  if (!host) return;
  const button = document.createElement('button');
  button.id = 'sofa3dStudioBtn';
  button.type = 'button';
  button.title = 'Open Sofa Studio — editable 3D sofas';
  button.textContent = '3D Studio';
  button.style.cssText =
    'font-size:12px;font-weight:600;padding:6px 10px;border:1px solid #bec6b8;border-radius:7px;background:#edf1e7;color:#36462e;white-space:nowrap';
  host.prepend(button);
  const open = async (request?: StudioOpenRequest) => {
    button.disabled = true;
    try {
      const { openSofaStudio } = await import('../sofa3d/studio');
      await openSofaStudio(request);
    } catch (error) {
      console.error('[Sofa Studio]', error);
      (window as any).showStatusMessage?.('Could not open 3D Studio. Please try again.', 'error');
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener('click', () => void open());
  window.addEventListener(
    'openpaint:sofa3d-open',
    event => void open((event as CustomEvent<StudioOpenRequest>).detail)
  );
  if (new URLSearchParams(location.search).get('studio') === '3d')
    void open({
      benchmark: new URLSearchParams(location.search).get('benchmark') || undefined,
      model: new URLSearchParams(location.search).get('model') || undefined,
    });
}
