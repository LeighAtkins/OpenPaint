import { createClient } from 'https://esm.sh/@supabase/supabase-js';

export class AuthManager {
  constructor() {
    this.supabase = null;
    this.user = null;
    this.init();
  }

  init() {
    const env = window.__ENV || {};
    console.log('[Auth] Initializing with env:', env);
    const supabaseUrl = env.VITE_SUPABASE_URL;
    const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);

      // Listen for auth changes
      this.supabase.auth.onAuthStateChange((event, session) => {
        this.user = session?.user || null;
        this.updateUI();
        console.log('[Auth] State change:', event, this.user?.email);
      });

      this.setupUI();
    } else {
      console.warn('[Auth] Supabase credentials missing');
    }
  }

  setupUI() {
    const authButton = document.getElementById('authButton');
    const authModal = document.getElementById('authModal');
    const closeAuthModal = document.getElementById('closeAuthModal');
    const authForm = document.getElementById('authForm');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginSubmitBtn = document.getElementById('loginSubmitBtn');
    const signupSubmitBtn = document.getElementById('signupSubmitBtn');
    const authError = document.getElementById('authError');

    if (authButton) {
      authButton.addEventListener('click', () => {
        if (authModal) authModal.classList.remove('hidden');
      });
    }

    if (closeAuthModal) {
      closeAuthModal.addEventListener('click', () => {
        if (authModal) authModal.classList.add('hidden');
        if (authError) authError.classList.add('hidden');
        if (authForm) authForm.reset();
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await this.logout();
      });
    }

    if (authForm) {
      authForm.addEventListener('submit', async e => {
        e.preventDefault();
        // Default to login if enter pressed
        await this.handleAuth('login');
      });
    }

    if (loginSubmitBtn) {
      loginSubmitBtn.addEventListener('click', async e => {
        e.preventDefault();
        await this.handleAuth('login');
      });
    }

    if (signupSubmitBtn) {
      signupSubmitBtn.addEventListener('click', async e => {
        e.preventDefault();
        await this.handleAuth('signup');
      });
    }
  }

  async handleAuth(mode) {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const authError = document.getElementById('authError');
    const authModal = document.getElementById('authModal');

    if (!emailInput || !passwordInput) return;

    const email = emailInput.value;
    const password = passwordInput.value;

    if (!email || !password) {
      if (authError) {
        authError.textContent = 'Please enter both email and password';
        authError.classList.remove('hidden');
      }
      return;
    }

    let result;
    if (mode === 'login') {
      result = await this.login(email, password);
    } else {
      result = await this.signup(email, password);
    }

    if (result.error) {
      if (authError) {
        authError.textContent = result.error.message;
        authError.classList.remove('hidden');
      }
    } else {
      // Success
      if (authModal) authModal.classList.add('hidden');
      if (authError) authError.classList.add('hidden');
      emailInput.value = '';
      passwordInput.value = '';

      // If signup, show message
      if (mode === 'signup' && !result.data.session) {
        alert('Please check your email to confirm your account.');
      }
    }
  }

  async login(email, password) {
    if (!this.supabase) return { error: 'Supabase not initialized' };
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  }

  async signup(email, password) {
    if (!this.supabase) return { error: 'Supabase not initialized' };
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
    });
    return { data, error };
  }

  async logout() {
    if (!this.supabase) return { error: 'Supabase not initialized' };
    const { error } = await this.supabase.auth.signOut();
    return { error };
  }

  getUser() {
    return this.user;
  }

  updateUI() {
    const authButton = document.getElementById('authButton');
    const userProfile = document.getElementById('userProfile');
    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');

    if (this.user) {
      if (authButton) authButton.classList.add('hidden');
      if (userProfile) {
        userProfile.classList.remove('hidden');
        if (userName) userName.textContent = this.user.email.split('@')[0];
        // Optional: Set avatar if available
      }
    } else {
      if (authButton) authButton.classList.remove('hidden');
      if (userProfile) userProfile.classList.add('hidden');
    }
  }
}
