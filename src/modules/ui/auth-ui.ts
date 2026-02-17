/**
 * Auth UI — toolbar button, modal, and state management
 *
 * Creates the "Sign in" button in #tbRight, a Google OAuth modal,
 * and toggles cloud features based on auth state.
 */

import { authService, type AuthUser } from '@/services/auth/authService';
import { isAuthEnabled, isSupabaseConfigured } from '@/utils/env';

// ── Styles (injected once) ───────────────────────────────────────────────

const AUTH_STYLES = /* css */ `
  /* Auth toolbar area */
  .auth-toolbar-group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
  }

  .auth-sign-in-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .auth-user-area {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .auth-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid var(--ob-border-color, #d1d5db);
  }

  .auth-display-name {
    font-size: var(--ob-text-meta, 12px);
    color: var(--ob-text-primary, #1f2937);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .auth-sign-out-btn {
    font-size: 11px;
    padding: 2px 8px;
    background: none;
    border: 1px solid var(--ob-border-color, #d1d5db);
    border-radius: 4px;
    color: var(--ob-text-primary, #6b7280);
    cursor: pointer;
  }
  .auth-sign-out-btn:hover {
    background: var(--ob-bg-surface, #f3f4f6);
  }

  /* Modal overlay */
  .auth-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .auth-modal-overlay.visible {
    opacity: 1;
  }

  /* Modal card */
  .auth-modal-card {
    background: #fff;
    border-radius: 12px;
    padding: 32px;
    width: 380px;
    max-width: 90vw;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    position: relative;
    transform: scale(0.95);
    transition: transform 0.15s ease;
  }
  .auth-modal-overlay.visible .auth-modal-card {
    transform: scale(1);
  }

  .auth-modal-close {
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
  .auth-modal-close:hover {
    color: #374151;
  }

  .auth-modal-heading {
    font-size: 20px;
    font-weight: 600;
    color: #111827;
    margin: 0 0 8px;
    text-align: center;
  }

  .auth-modal-subtext {
    font-size: 13px;
    color: #6b7280;
    text-align: center;
    margin: 0 0 24px;
  }

  /* Google sign-in button (matches Google's brand guidelines) */
  .auth-google-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    background: #fff;
    border: 1px solid #dadce0;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: #3c4043;
    cursor: pointer;
    transition: background 0.15s ease, box-shadow 0.15s ease;
  }
  .auth-google-btn:hover {
    background: #f8f9fa;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
  .auth-google-btn:active {
    background: #e8eaed;
  }
  .auth-google-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .auth-google-logo {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .auth-error {
    margin-top: 16px;
    padding: 10px 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    font-size: 13px;
    color: #991b1b;
    display: none;
  }
  .auth-error.visible {
    display: block;
  }

  .auth-guest-note {
    margin-top: 20px;
    font-size: 12px;
    color: #9ca3af;
    text-align: center;
  }

  /* Cloud feature buttons (hidden when logged out) */
  .auth-cloud-btn {
    display: none;
  }
  .auth-cloud-btn.visible {
    display: inline-flex;
  }
`;

// ── Google logo SVG (inline to avoid external requests) ──────────────────

const GOOGLE_LOGO_SVG = `<svg viewBox="0 0 24 24" class="auth-google-logo"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

// ── DOM references ───────────────────────────────────────────────────────

let toolbarGroup: HTMLElement | null = null;
let modalOverlay: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;
let signInInProgress = false;
let callbackSettling = new URLSearchParams(window.location.search).has('code');

function setSignInButtonPending(pending: boolean): void {
  const signInBtn = document.getElementById('authSignInBtn') as HTMLButtonElement | null;
  if (!signInBtn) return;
  signInBtn.disabled = pending;
  signInBtn.style.opacity = pending ? '0.7' : '1';
  signInBtn.style.pointerEvents = pending ? 'none' : 'auto';
  signInBtn.innerHTML = pending
    ? '<span class="label-long">Signing in...</span>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="label-long">Sign in</span>';
}

// ── Toolbar button creation ──────────────────────────────────────────────

function createToolbarGroup(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'auth-toolbar-group';
  group.id = 'authToolbarGroup';

  // Sign-in button (shown when logged out)
  const signInBtn = document.createElement('button');
  signInBtn.className = 'tbtn auth-sign-in-btn';
  signInBtn.id = 'authSignInBtn';
  signInBtn.title = 'Sign in for cloud features';
  signInBtn.setAttribute('aria-label', 'Sign in');
  signInBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="label-long">Sign in</span>`;
  signInBtn.addEventListener('click', openModal);

  // User area (shown when logged in)
  const userArea = document.createElement('div');
  userArea.className = 'auth-user-area';
  userArea.id = 'authUserArea';
  userArea.style.display = 'none';

  const avatar = document.createElement('img');
  avatar.className = 'auth-avatar';
  avatar.id = 'authAvatar';
  avatar.alt = 'User avatar';
  avatar.src = '';

  const displayName = document.createElement('span');
  displayName.className = 'auth-display-name';
  displayName.id = 'authDisplayName';

  const signOutBtn = document.createElement('button');
  signOutBtn.className = 'auth-sign-out-btn';
  signOutBtn.textContent = 'Sign out';
  signOutBtn.addEventListener('click', handleSignOut);

  userArea.appendChild(avatar);
  userArea.appendChild(displayName);
  userArea.appendChild(signOutBtn);

  // Cloud buttons (hidden until logged in)
  const cloudSaveBtn = document.createElement('button');
  cloudSaveBtn.className = 'tbtn auth-cloud-btn';
  cloudSaveBtn.id = 'authCloudSaveBtn';
  cloudSaveBtn.title = 'Save to cloud';
  cloudSaveBtn.setAttribute('aria-label', 'Cloud save');
  cloudSaveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span class="label-long">Cloud Save</span>`;

  const myProjectsBtn = document.createElement('button');
  myProjectsBtn.className = 'tbtn auth-cloud-btn';
  myProjectsBtn.id = 'authMyProjectsBtn';
  myProjectsBtn.title = 'My Projects';
  myProjectsBtn.setAttribute('aria-label', 'My Projects');
  myProjectsBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span class="label-long">My Projects</span>`;

  group.appendChild(signInBtn);
  group.appendChild(userArea);
  group.appendChild(cloudSaveBtn);
  group.appendChild(myProjectsBtn);

  return group;
}

// ── Modal creation ───────────────────────────────────────────────────────

function createModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'auth-modal-overlay';
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });

  const card = document.createElement('div');
  card.className = 'auth-modal-card';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'auth-modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', closeModal);

  const heading = document.createElement('h2');
  heading.className = 'auth-modal-heading';
  heading.textContent = 'Sign in to OpenPaint';

  const subtext = document.createElement('p');
  subtext.className = 'auth-modal-subtext';
  subtext.textContent = 'Save projects to the cloud and access them from anywhere.';

  const googleBtn = document.createElement('button');
  googleBtn.className = 'auth-google-btn';
  googleBtn.id = 'authGoogleBtn';
  googleBtn.innerHTML = `${GOOGLE_LOGO_SVG} Continue with Google`;
  googleBtn.addEventListener('click', handleGoogleSignIn);

  const errorEl = document.createElement('div');
  errorEl.className = 'auth-error';
  errorEl.id = 'authError';

  const guestNote = document.createElement('p');
  guestNote.className = 'auth-guest-note';
  guestNote.textContent = 'Guest mode is always available — no sign-in required to draw.';

  card.appendChild(closeBtn);
  card.appendChild(heading);
  card.appendChild(subtext);
  card.appendChild(googleBtn);
  card.appendChild(errorEl);
  card.appendChild(guestNote);
  overlay.appendChild(card);

  return overlay;
}

// ── Modal open / close ───────────────────────────────────────────────────

function openModal(): void {
  if (!modalOverlay) return;
  modalOverlay.style.display = 'flex';
  // Allow reflow before adding visible class for transition
  requestAnimationFrame(() => {
    modalOverlay!.classList.add('visible');
  });
  // Hide error on open
  const errorEl = document.getElementById('authError');
  if (errorEl) {
    errorEl.classList.remove('visible');
    errorEl.textContent = '';
  }
}

function closeModal(): void {
  if (!modalOverlay) return;
  modalOverlay.classList.remove('visible');
  setTimeout(() => {
    if (modalOverlay) modalOverlay.style.display = 'none';
  }, 150);
}

// ── Auth handlers ────────────────────────────────────────────────────────

async function handleGoogleSignIn(): Promise<void> {
  const btn = document.getElementById('authGoogleBtn') as HTMLButtonElement | null;
  const errorEl = document.getElementById('authError');

  if (signInInProgress) return;

  if (!isSupabaseConfigured()) {
    if (errorEl) {
      errorEl.textContent =
        'Cloud services are not configured. Please set up Supabase credentials.';
      errorEl.classList.add('visible');
    }
    return;
  }

  if (btn) btn.disabled = true;
  signInInProgress = true;
  if (errorEl) {
    errorEl.classList.remove('visible');
    errorEl.textContent = '';
  }

  const result = await authService.signInWithGoogle();

  if (!result.success) {
    if (btn) btn.disabled = false;
    signInInProgress = false;
    if (errorEl) {
      errorEl.textContent = result.error.message || 'Sign-in failed. Please try again.';
      errorEl.classList.add('visible');
    }
    return;
  }

  // Browser will navigate to Google consent — no need to re-enable button
}

async function handleSignOut(): Promise<void> {
  await authService.signOut();
}

// ── UI state updates ─────────────────────────────────────────────────────

function updateAuthUI(user: AuthUser | null): void {
  const signInBtn = document.getElementById('authSignInBtn');
  const userArea = document.getElementById('authUserArea');
  const avatar = document.getElementById('authAvatar') as HTMLImageElement | null;
  const displayName = document.getElementById('authDisplayName');

  if (user) {
    signInInProgress = false;
    callbackSettling = false;
    // Logged in
    if (signInBtn) signInBtn.style.display = 'none';
    if (userArea) userArea.style.display = 'flex';

    const name = user.profile?.display_name || user.email.split('@')[0];
    if (displayName) displayName.textContent = name;

    if (avatar) {
      if (user.profile?.avatar_url) {
        avatar.src = user.profile.avatar_url;
        avatar.style.display = 'block';
      } else {
        avatar.style.display = 'none';
      }
    }

    showCloudFeatures(true);
    closeModal();
  } else {
    // Logged out
    if (callbackSettling) {
      setSignInButtonPending(true);
      showCloudFeatures(false);
      return;
    }
    if (signInBtn) signInBtn.style.display = 'inline-flex';
    setSignInButtonPending(false);
    if (userArea) userArea.style.display = 'none';
    showCloudFeatures(false);
  }
}

function showCloudFeatures(show: boolean): void {
  const cloudBtns = document.querySelectorAll<HTMLElement>('.auth-cloud-btn');
  cloudBtns.forEach(btn => {
    btn.classList.toggle('visible', show);
  });
}

// ── Initialization ───────────────────────────────────────────────────────

export function initAuthUI(): void {
  if (!isAuthEnabled()) return;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = AUTH_STYLES;
  document.head.appendChild(style);

  // Create and append toolbar group
  const tbRight = document.getElementById('tbRight');
  if (tbRight) {
    toolbarGroup = createToolbarGroup();
    tbRight.appendChild(toolbarGroup);
  }

  // Create and append modal
  modalOverlay = createModal();
  document.body.appendChild(modalOverlay);

  // Listen for auth state changes
  unsubscribe = authService.onAuthStateChange(updateAuthUI);

  // Set initial state from current user (may already be signed in from initialize())
  updateAuthUI(authService.getCurrentUser());

  // Reconcile auth state after UI mount in case callback/session hydration
  // completed slightly before/after UI initialization.
  const reconcileAuthState = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await authService.refreshCurrentUserFromClient();
      const user = authService.getCurrentUser();
      if (user) {
        updateAuthUI(user);
        callbackSettling = false;
        return;
      }

      await new Promise(resolve => {
        setTimeout(resolve, 200 * (attempt + 1));
      });
    }

    callbackSettling = false;
    updateAuthUI(authService.getCurrentUser());
  };

  void reconcileAuthState();

  if (callbackSettling) {
    setTimeout(() => {
      callbackSettling = false;
      updateAuthUI(authService.getCurrentUser());
    }, 4500);
  }
}

// ── Cleanup (for testing) ────────────────────────────────────────────────

export function destroyAuthUI(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (toolbarGroup) {
    toolbarGroup.remove();
    toolbarGroup = null;
  }
  if (modalOverlay) {
    modalOverlay.remove();
    modalOverlay = null;
  }
}
