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

  const optionsButton = document.getElementById('workspaceExportOptions');
  let returnFocus: HTMLElement = button;
  let hideTimer: number | undefined;
  menu.querySelectorAll('[data-action]').forEach(item => item.setAttribute('role', 'menuitem'));

  const hideMenu = (): void => {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
    menu.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
    optionsButton?.setAttribute('aria-expanded', 'false');
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
    optionsButton?.setAttribute('aria-expanded', 'true');
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
    hideMenu();
  });
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      returnFocus = button;
      showMenu();
      (menu.querySelector('[data-action]') as HTMLElement | null)?.focus();
    } else if (event.key === 'Escape') {
      hideMenu();
    }
  });

  optionsButton?.addEventListener('click', event => {
    event.preventDefault();
    returnFocus = optionsButton;
    showMenu();
    menu.querySelector<HTMLElement>('[data-action]')?.focus();
  });
  optionsButton?.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    returnFocus = optionsButton;
    showMenu();
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[data-action]'));
    (event.key === 'ArrowUp' ? items.at(-1) : items[0])?.focus();
  });
  document.addEventListener('pointerdown', event => {
    if (
      event.target instanceof Node &&
      !root.contains(event.target) &&
      !menu.contains(event.target)
    )
      hideMenu();
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      returnFocus.focus();
      hideMenu();
      return;
    }
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[data-action]'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
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
