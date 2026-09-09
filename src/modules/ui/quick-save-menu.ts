type QuickSaveElement = HTMLElement & { __quickSaveBound?: boolean };

export function initQuickSaveMenu(): void {
  const root = document.getElementById('quickSave') as QuickSaveElement | null;
  const button = document.getElementById('quickSaveBtn') as HTMLButtonElement | null;
  const menu = document.getElementById('quickSaveMenu') as HTMLElement | null;

  if (!root || !button || !menu || root.__quickSaveBound) return;

  root.__quickSaveBound = true;
  root.dataset.quickSaveBound = 'true';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-controls', menu.id);
  button.setAttribute('aria-expanded', 'false');

  let hideTimer: number | undefined;

  const hideMenu = (): void => {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
    menu.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
  };

  const positionMenu = (): void => {
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    const buttonRect = button.getBoundingClientRect();
    const menuWidth = Math.max(160, menu.offsetWidth || 0);
    const left = Math.min(
      Math.max(8, buttonRect.left),
      Math.max(8, window.innerWidth - menuWidth - 8)
    );
    menu.style.position = 'fixed';
    menu.style.left = `${left}px`;
    menu.style.right = 'auto';
    menu.style.top = 'auto';
    menu.style.bottom = `${Math.max(8, window.innerHeight - buttonRect.top + 6)}px`;
    menu.style.zIndex = '15000';
  };

  const showMenu = (): void => {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
    menu.classList.remove('hidden');
    positionMenu();
    button.setAttribute('aria-expanded', 'true');
  };

  const scheduleHide = (): void => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideMenu, 220);
  };

  root.addEventListener('mouseenter', showMenu);
  root.addEventListener('mouseleave', scheduleHide);
  menu.addEventListener('mouseenter', showMenu);
  menu.addEventListener('mouseleave', scheduleHide);
  menu.addEventListener('focusin', showMenu);
  menu.addEventListener('focusout', event => {
    if (!menu.contains(event.relatedTarget as Node | null)) scheduleHide();
  });

  button.addEventListener('focus', showMenu);
  button.addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('save')?.click();
  });
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      showMenu();
      (menu.querySelector('[data-action]') as HTMLElement | null)?.focus();
    } else if (event.key === 'Escape') {
      hideMenu();
    }
  });

  menu.addEventListener('click', event => {
    const item = (event.target as Element | null)?.closest<HTMLElement>('[data-action]');
    if (!item) return;

    const projectName =
      (document.getElementById('projectName') as HTMLInputElement | null)?.value || 'OpenPaint';

    if (item.dataset.action === 'pdf') {
      window.showPDFExportDialog?.(projectName);
    } else if (item.dataset.action === 'multiple') {
      window.saveAllImages?.();
    } else if (item.dataset.action === 'multiple-no-tags') {
      window.saveAllImagesNoTags?.();
    }

    hideMenu();
  });

  window.addEventListener('resize', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });

  window.addEventListener(
    'scroll',
    () => {
      if (!menu.classList.contains('hidden')) positionMenu();
    },
    true
  );
}
