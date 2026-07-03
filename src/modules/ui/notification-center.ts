type NotificationKind = 'info' | 'success' | 'warning' | 'error' | 'loading' | 'reward' | 'lock';

type NotifyPayload =
  | string
  | {
      message: string;
      kind?: NotificationKind | string;
      title?: string;
      icon?: string;
      durationMs?: number;
      replace?: boolean;
    };

type NotificationElement = HTMLDivElement & { timer?: ReturnType<typeof setTimeout> | null };

let stylesInjected = false;

const KIND_ICON: Record<string, string> = {
  success: 'OK',
  error: '!',
  warning: '!',
  loading: '',
  reward: '*',
  lock: '~',
  info: 'i',
};

function ensureNotificationStyles(): void {
  if (stylesInjected) return;

  const style = document.createElement('style');
  style.id = 'openpaint-notification-center-style';
  style.textContent = `
    #openpaintNotificationCenter {
      position: fixed;
      top: max(50px, env(safe-area-inset-top, 0px) + 10px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483000;
      width: min(520px, calc(100vw - 28px));
      pointer-events: none;
      display: flex;
      justify-content: center;
    }

    .openpaint-toast {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      max-width: 100%;
      min-height: 32px;
      padding: 6px 11px;
      border-radius: 999px;
      border: 1px solid rgba(226, 232, 240, 0.34);
      background: rgba(15, 23, 42, 0.9);
      color: #f8fafc;
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.18);
      backdrop-filter: blur(16px) saturate(1.15);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: 0;
      transform: translate3d(0, -8px, 0) scale(0.98);
      transition:
        opacity 180ms ease,
        transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
        background-color 180ms ease,
        border-color 180ms ease;
      pointer-events: none;
    }

    .openpaint-toast.visible {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
    }

    .openpaint-toast-icon {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
      flex: 0 0 auto;
    }

    .openpaint-toast-spinner {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
      animation: openpaint-toast-spin 780ms linear infinite;
    }

    .openpaint-toast-text {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .openpaint-toast-title {
      margin: 0;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: none;
      opacity: 0.9;
      white-space: nowrap;
    }

    .openpaint-toast-title::after {
      content: ':';
      opacity: 0.65;
    }

    .openpaint-toast-message {
      margin: 0;
      font-size: 12.5px;
      font-weight: 650;
      line-height: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      overflow-wrap: anywhere;
    }

    .openpaint-toast.success {
      background: rgba(22, 101, 52, 0.92);
      border-color: rgba(134, 239, 172, 0.42);
    }

    .openpaint-toast.error {
      background: rgba(153, 27, 27, 0.94);
      border-color: rgba(252, 165, 165, 0.5);
    }

    .openpaint-toast.warning {
      background: rgba(146, 64, 14, 0.93);
      border-color: rgba(253, 186, 116, 0.5);
    }

    .openpaint-toast.reward {
      background: linear-gradient(135deg, rgba(124, 45, 18, 0.93), rgba(217, 119, 6, 0.9));
      border-color: rgba(252, 211, 77, 0.66);
    }

    .openpaint-toast.lock {
      background: rgba(30, 41, 59, 0.92);
      border-color: rgba(203, 213, 225, 0.4);
    }

    @keyframes openpaint-toast-spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 700px) {
      #openpaintNotificationCenter {
        top: max(48px, env(safe-area-inset-top, 0px) + 8px);
        width: calc(100vw - 20px);
      }

      .openpaint-toast {
        padding: 6px 10px;
      }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function getHost(): HTMLDivElement {
  ensureNotificationStyles();
  let host = document.getElementById('openpaintNotificationCenter') as HTMLDivElement | null;
  if (!host) {
    host = document.createElement('div');
    host.id = 'openpaintNotificationCenter';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'true');
    document.body.appendChild(host);
  }
  return host;
}

function normalizePayload(payload: NotifyPayload, fallbackKind: string = 'info') {
  if (typeof payload === 'string') {
    return { message: payload, kind: fallbackKind as NotificationKind };
  }
  return {
    ...payload,
    kind: (payload.kind || fallbackKind || 'info') as NotificationKind,
  };
}

function makeToastIcon(kind: string, icon?: string): HTMLElement {
  const iconEl = document.createElement('div');
  iconEl.className = 'openpaint-toast-icon';
  if (kind === 'loading') {
    const spinner = document.createElement('span');
    spinner.className = 'openpaint-toast-spinner';
    iconEl.appendChild(spinner);
  } else {
    iconEl.textContent = icon || KIND_ICON[kind] || KIND_ICON.info;
  }
  return iconEl;
}

function getDefaultTitle(kind: string): string {
  switch (kind) {
    case 'success':
      return 'Done';
    case 'error':
      return 'Needs Attention';
    case 'warning':
      return 'Heads Up';
    case 'loading':
      return 'Working';
    case 'reward':
      return 'Reward';
    case 'lock':
      return 'Frame';
    default:
      return '';
  }
}

export function notifyOpenPaint(payload: NotifyPayload, fallbackKind = 'info'): void {
  if (typeof document === 'undefined') return;

  const normalized = normalizePayload(payload, fallbackKind);
  const message = String(normalized.message || '').trim();
  if (!message) return;

  const kind = String(normalized.kind || 'info');
  const host = getHost();
  const existing = host.querySelector('.openpaint-toast') as NotificationElement | null;
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  existing?.remove();

  const toast = document.createElement('div') as NotificationElement;
  toast.className = `openpaint-toast ${kind}`;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

  toast.appendChild(makeToastIcon(kind, normalized.icon));

  const text = document.createElement('div');
  text.className = 'openpaint-toast-text';
  const titleText = normalized.title ?? getDefaultTitle(kind);
  if (titleText) {
    const title = document.createElement('p');
    title.className = 'openpaint-toast-title';
    title.textContent = titleText;
    text.appendChild(title);
  }
  const body = document.createElement('p');
  body.className = 'openpaint-toast-message';
  body.textContent = message;
  text.appendChild(body);
  toast.appendChild(text);

  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  if (kind !== 'loading') {
    const duration = Number(normalized.durationMs);
    toast.timer = setTimeout(
      () => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 240);
      },
      Number.isFinite(duration) && duration > 0 ? duration : kind === 'reward' ? 3200 : 3600
    );
  }
}

export function hideOpenPaintNotification(): void {
  const toast = document.querySelector('.openpaint-toast') as NotificationElement | null;
  if (!toast) return;
  if (toast.timer) clearTimeout(toast.timer);
  toast.classList.remove('visible');
  setTimeout(() => toast.remove(), 240);
}

export function initNotificationCenter(): void {
  ensureNotificationStyles();
  const win = window as Window & {
    notifyOpenPaint?: (payload: NotifyPayload, fallbackKind?: string) => void;
    showStatusMessage?: (message: string, type?: string) => void;
    hideStatusMessage?: () => void;
  };
  win.notifyOpenPaint = notifyOpenPaint;
  win.showStatusMessage = (message: string, type = 'info') => {
    notifyOpenPaint({ message, kind: type });
  };
  win.hideStatusMessage = hideOpenPaintNotification;
}
