// Authentication service with comprehensive user management
import { SupabaseClient, User, Session, AuthError, AuthChangeEvent } from '@supabase/supabase-js';
import { getSupabaseClient, DATABASE_TABLES, type Database } from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type {
  UserProfileRow,
  UserProfileInsert,
  UserProfileUpdate,
  UserPreferences,
} from '@/types/supabase.types';

// Authentication types
export interface AuthUser {
  id: string;
  email: string;
  emailConfirmed: boolean;
  lastSignInAt?: string;
  createdAt: string;
  profile?: UserProfileRow;
}

export interface SignUpCredentials {
  email: string;
  password: string;
  displayName?: string;
  redirectUrl?: string;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface ResetPasswordCredentials {
  email: string;
  redirectUrl?: string;
}

export interface UpdateProfileData {
  displayName?: string;
  avatarUrl?: string;
  preferences?: Partial<UserPreferences>;
}

// Default user preferences
const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'auto',
  defaultUnits: 'px',
  autoSave: true,
  showTooltips: true,
  maxRecentProjects: 10,
  storageQuotaWarning: true,
};

/**
 * Authentication service with full user lifecycle management
 */
export class AuthService {
  private client: SupabaseClient<Database> | null = null;
  private currentUser: AuthUser | null = null;
  private sessionListeners: Array<(user: AuthUser | null) => void> = [];
  private initialized = false;

  /**
   * Build a basic AuthUser from a Supabase User (no profile query needed)
   */
  private buildBasicUser(user: User): AuthUser {
    const meta = user.user_metadata || {};
    return {
      id: user.id,
      email: user.email || '',
      emailConfirmed: user.email_confirmed_at !== null,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at || undefined,
      // Synthesize a minimal profile from Google metadata so the UI has a name/avatar
      profile: {
        id: user.id,
        email: user.email || '',
        display_name: (meta['full_name'] as string) || user.email?.split('@')[0] || null,
        avatar_url: (meta['avatar_url'] as string) || null,
        preferences: DEFAULT_USER_PREFERENCES,
        created_at: user.created_at,
        updated_at: user.created_at,
        last_login_at: null,
        storage_used: 0,
      } as UserProfileRow,
    };
  }

  /**
   * Set currentUser from a Supabase User and notify listeners.
   * Tries to load the DB profile; falls back to metadata-based profile.
   */
  private async setCurrentUser(user: User): Promise<void> {
    // Start with basic user from metadata (always works, no API calls)
    this.currentUser = this.buildBasicUser(user);
    // Notify listeners immediately so UI updates right away
    this.notifySessionListeners(this.currentUser);

    // Then try to enrich with DB profile in the background (non-blocking)
    try {
      const enriched = await this.enrichUserWithProfile(user);
      if (enriched.success) {
        this.currentUser = enriched.data;
        this.notifySessionListeners(this.currentUser);
      }
    } catch {
      // Profile enrichment is optional — basic user data is sufficient
    }

    // Best-effort: ensure a profile row exists for future use
    this.ensureProfile(user).catch(() => {});
  }

  private getClientSync(): SupabaseClient<Database> | null {
    if (!this.client) {
      const result = getSupabaseClient();
      if (!result.success) return null;
      this.client = result.data;
    }
    return this.client;
  }

  /**
   * Initialize the auth service on app boot.
   * Restores session from localStorage and processes OAuth callback codes.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const client = this.getClientSync();
    if (!client) {
      console.warn('[Auth] Supabase client not available');
      return;
    }

    // Set up the auth state listener FIRST so we catch all events
    this.setupAuthListener(client);

    // Check for OAuth callback code in URL
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        console.log('[Auth] Processing OAuth callback code...');
        try {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) {
            console.warn('[Auth] Code exchange failed:', error.message);
          }
        } catch (err) {
          console.warn('[Auth] Code exchange error:', err);
        }

        // Clean callback params from URL
        params.delete('code');
        params.delete('state');
        params.delete('error');
        params.delete('error_description');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
        window.history.replaceState({}, document.title, nextUrl);
      }
    }

    // Restore session from localStorage
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (session?.user && !this.currentUser) {
        await this.setCurrentUser(session.user);
      }
    } catch (err) {
      console.warn('[Auth] Session restore error:', err);
    }
  }

  /**
   * Sign in with Google OAuth.
   * Redirects the browser to Google consent screen.
   */
  async signInWithGoogle(): Promise<Result<{ url: string }, AppError>> {
    try {
      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      if (!data.url) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'No redirect URL returned from OAuth')
        );
      }

      return Result.ok({ url: data.url });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Google sign-in failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Ensure a user_profiles row exists for an OAuth user.
   */
  private async ensureProfile(user: User): Promise<void> {
    const client = this.getClientSync();
    if (!client) return;

    try {
      const { data: existing } = await client
        .from(DATABASE_TABLES.USER_PROFILES)
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      if (existing) return;

      const meta = user.user_metadata || {};
      const profileData: UserProfileInsert = {
        id: user.id,
        email: user.email || '',
        display_name:
          (meta['full_name'] as string) || (user.email ? user.email.split('@')[0] : undefined),
        avatar_url: meta['avatar_url'] as string | undefined,
        preferences: DEFAULT_USER_PREFERENCES,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await client.from(DATABASE_TABLES.USER_PROFILES).insert(profileData as any);
    } catch {
      // Non-critical — profile will be created on next sign-in
    }
  }

  /**
   * Set up auth state change listener
   */
  private setupAuthListener(client: SupabaseClient<Database>): void {
    client.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      // Keep callback synchronous; Supabase can deadlock if heavy async work
      // is awaited directly in this listener.
      void this.handleAuthStateChange(event, session);
    });
  }

  private async handleAuthStateChange(
    event: AuthChangeEvent,
    session: Session | null
  ): Promise<void> {
    try {
      switch (event) {
        case 'INITIAL_SESSION':
        case 'SIGNED_IN':
          if (session?.user) {
            await this.setCurrentUser(session.user);
          }
          break;

        case 'SIGNED_OUT':
          this.currentUser = null;
          this.notifySessionListeners(null);
          break;

        case 'TOKEN_REFRESHED':
          break;

        case 'USER_UPDATED':
          if (session?.user) {
            await this.setCurrentUser(session.user);
          }
          break;
      }
    } catch (error) {
      console.error('[Auth] Auth state listener error:', error);
      // Last resort: if we have a session user, set basic data
      if (
        (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') &&
        session?.user &&
        !this.currentUser
      ) {
        this.currentUser = this.buildBasicUser(session.user);
        this.notifySessionListeners(this.currentUser);
      }
    }
  }

  /**
   * Notify session listeners of auth state changes
   */
  private notifySessionListeners(user: AuthUser | null): void {
    this.sessionListeners.forEach(listener => {
      try {
        listener(user);
      } catch (error) {
        console.error('Session listener error:', error);
      }
    });
  }

  /**
   * Subscribe to auth state changes.
   * If already authenticated, the callback is invoked immediately.
   */
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
    this.sessionListeners.push(callback);

    // If already authenticated, immediately notify the new listener
    if (this.currentUser) {
      try {
        callback(this.currentUser);
      } catch (error) {
        console.error('Session listener error:', error);
      }
    }

    return () => {
      const index = this.sessionListeners.indexOf(callback);
      if (index > -1) {
        this.sessionListeners.splice(index, 1);
      }
    };
  }

  /**
   * Enrich Supabase user with profile data from DB
   */
  private async enrichUserWithProfile(user: User): Promise<Result<AuthUser, AppError>> {
    const client = this.getClientSync();
    if (!client) {
      return Result.err(
        new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
      );
    }

    try {
      const { data: profile, error } = await client
        .from(DATABASE_TABLES.USER_PROFILES)
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `Failed to load user profile: ${error.message}`, {
            userId: user.id,
            postgresError: error,
          })
        );
      }

      const authUser: AuthUser = {
        id: user.id,
        email: user.email || '',
        emailConfirmed: user.email_confirmed_at !== null,
        createdAt: user.created_at,
      };
      if (user.last_sign_in_at) {
        authUser.lastSignInAt = user.last_sign_in_at;
      }
      if (profile) {
        authUser.profile = profile;
      }

      return Result.ok(authUser);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Failed to enrich user data: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { userId: user.id }
        )
      );
    }
  }

  /**
   * Sign up a new user
   */
  async signUp(
    credentials: SignUpCredentials
  ): Promise<Result<{ user: AuthUser; needsVerification: boolean }, AppError>> {
    try {
      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      const validationResult = this.validateCredentials(credentials);
      if (!validationResult.success) {
        return Result.err(validationResult.error);
      }

      const signUpOptions: { emailRedirectTo?: string; data?: object } = {};
      if (credentials.redirectUrl) {
        signUpOptions.emailRedirectTo = credentials.redirectUrl;
      }
      if (credentials.displayName) {
        signUpOptions.data = { display_name: credentials.displayName };
      }

      const { data, error } = await client.auth.signUp({
        email: credentials.email,
        password: credentials.password,
        ...(Object.keys(signUpOptions).length > 0 ? { options: signUpOptions } : {}),
      });

      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      if (!data.user) {
        return Result.err(new AppError(ErrorCode.AUTH_ERROR, 'Sign up failed - no user returned'));
      }

      const profileData: UserProfileInsert = {
        id: data.user.id,
        email: credentials.email,
        preferences: DEFAULT_USER_PREFERENCES,
      };
      if (credentials.displayName) {
        profileData.display_name = credentials.displayName;
      }
      const profileResult = await this.createUserProfile(data.user.id, profileData);
      if (!profileResult.success) {
        console.error('Failed to create user profile:', profileResult.error);
      }

      const userResult = await this.enrichUserWithProfile(data.user);
      if (!userResult.success) {
        return Result.err(userResult.error);
      }

      return Result.ok({
        user: userResult.data,
        needsVerification: !data.user.email_confirmed_at,
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Sign up failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { email: credentials.email }
        )
      );
    }
  }

  /**
   * Sign in an existing user
   */
  async signIn(credentials: SignInCredentials): Promise<Result<AuthUser, AppError>> {
    try {
      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      const { data, error } = await client.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      if (!data.user) {
        return Result.err(new AppError(ErrorCode.AUTH_ERROR, 'Sign in failed - no user returned'));
      }

      await this.updateLastLogin(data.user.id);

      const userResult = await this.enrichUserWithProfile(data.user);
      if (!userResult.success) {
        return Result.err(userResult.error);
      }

      this.currentUser = userResult.data;
      return Result.ok(userResult.data);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Sign in failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { email: credentials.email }
        )
      );
    }
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<Result<boolean, AppError>> {
    try {
      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      // Local scope sign-out clears browser session immediately and avoids
      // network-dependent failures from blocking the UI.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error && error.message !== 'Auth session missing!') {
        return Result.err(this.mapAuthError(error));
      }

      this.currentUser = null;
      this.notifySessionListeners(null);

      // Best-effort global revoke; does not block local sign-out success.
      void client.auth.signOut({ scope: 'global' }).catch(globalSignOutError => {
        console.warn('[Auth] Global sign-out revoke failed:', globalSignOutError);
      });

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Sign out failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Request password reset
   */
  async resetPassword(credentials: ResetPasswordCredentials): Promise<Result<boolean, AppError>> {
    try {
      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      const resetOptions: { redirectTo?: string } = {};
      if (credentials.redirectUrl) {
        resetOptions.redirectTo = credentials.redirectUrl;
      }

      const { error } = await client.auth.resetPasswordForEmail(
        credentials.email,
        Object.keys(resetOptions).length > 0 ? resetOptions : undefined
      );

      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Password reset failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { email: credentials.email }
        )
      );
    }
  }

  /**
   * Update user password
   */
  async updatePassword(newPassword: string): Promise<Result<boolean, AppError>> {
    try {
      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Password update failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  async getCurrentSession(): Promise<Result<Session | null, AppError>> {
    try {
      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      const {
        data: { session },
        error,
      } = await client.auth.getSession();

      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      return Result.ok(session);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Get session failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(data: UpdateProfileData): Promise<Result<UserProfileRow, AppError>> {
    try {
      if (!this.currentUser) {
        return Result.err(new AppError(ErrorCode.AUTH_ERROR, 'No authenticated user'));
      }

      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      const updateData: UserProfileUpdate = {
        updated_at: new Date().toISOString(),
      };

      if (data.displayName !== undefined) {
        updateData.display_name = data.displayName;
      }

      if (data.avatarUrl !== undefined) {
        updateData.avatar_url = data.avatarUrl;
      }

      if (data.preferences) {
        updateData.preferences = {
          ...(this.currentUser.profile?.preferences || DEFAULT_USER_PREFERENCES),
          ...data.preferences,
        };
      }

      const { data: profile, error } = await client
        .from(DATABASE_TABLES.USER_PROFILES)
        .update(updateData as unknown as never)
        .eq('id', this.currentUser.id)
        .select()
        .single();

      if (error) {
        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `Profile update failed: ${error.message}`, {
            userId: this.currentUser.id,
            postgresError: error,
          })
        );
      }

      if (this.currentUser.profile) {
        this.currentUser.profile = profile;
      }

      return Result.ok(profile);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Profile update failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Create user profile record
   */
  private async createUserProfile(
    userId: string,
    data: Omit<UserProfileInsert, 'id' | 'created_at' | 'updated_at'>
  ): Promise<Result<UserProfileRow, AppError>> {
    const client = this.getClientSync();
    if (!client) {
      return Result.err(
        new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
      );
    }

    try {
      const profileData: UserProfileInsert = {
        id: userId,
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: profile, error } = await client
        .from(DATABASE_TABLES.USER_PROFILES)
        .insert(profileData as any)
        .select()
        .single();

      if (error) {
        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `Profile creation failed: ${error.message}`, {
            userId,
            postgresError: error,
          })
        );
      }

      return Result.ok(profile);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Profile creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { userId }
        )
      );
    }
  }

  /**
   * Update last login timestamp
   */
  private async updateLastLogin(userId: string): Promise<void> {
    const client = this.getClientSync();
    if (!client) return;

    try {
      await client
        .from(DATABASE_TABLES.USER_PROFILES)
        .update({ last_login_at: new Date().toISOString() } as unknown as never)
        .eq('id', userId);
    } catch {
      // Non-critical
    }
  }

  private validateCredentials(
    credentials: SignUpCredentials | SignInCredentials
  ): Result<true, AppError> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(credentials.email)) {
      return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid email format'));
    }

    if (credentials.password.length < 6) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Password must be at least 6 characters')
      );
    }

    if ('displayName' in credentials && credentials.displayName) {
      if (credentials.displayName.length > 50) {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Display name must be 50 characters or less')
        );
      }
    }

    return Result.ok(true);
  }

  private mapAuthError(authError: AuthError): AppError {
    switch (authError.message) {
      case 'Invalid login credentials':
        return new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
      case 'Email not confirmed':
        return new AppError(
          ErrorCode.EMAIL_NOT_CONFIRMED,
          'Please confirm your email before signing in'
        );
      case 'User already registered':
        return new AppError(
          ErrorCode.EMAIL_ALREADY_EXISTS,
          'An account with this email already exists'
        );
      case 'Password should be at least 6 characters':
        return new AppError(ErrorCode.VALIDATION_ERROR, 'Password must be at least 6 characters');
      case 'Signup is disabled':
        return new AppError(ErrorCode.AUTH_ERROR, 'Registration is currently disabled');
      default:
        return new AppError(ErrorCode.AUTH_ERROR, authError.message || 'Authentication failed', {
          authError,
        });
    }
  }

  async deleteAccount(): Promise<Result<boolean, AppError>> {
    try {
      if (!this.currentUser) {
        return Result.err(new AppError(ErrorCode.AUTH_ERROR, 'No authenticated user'));
      }

      const client = this.getClientSync();
      if (!client) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Supabase client not available')
        );
      }

      const { error: profileError } = await client
        .from(DATABASE_TABLES.USER_PROFILES)
        .delete()
        .eq('id', this.currentUser.id);

      if (profileError) {
        console.error('Failed to delete user profile:', profileError);
      }

      const { error: authError } = await client.auth.admin.deleteUser(this.currentUser.id);

      if (authError) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, `Account deletion failed: ${authError.message}`, {
            userId: this.currentUser.id,
            authError,
          })
        );
      }

      this.currentUser = null;
      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.AUTH_ERROR,
          `Account deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }
}

// Export service instance
export const authService = new AuthService();
