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
   * Initialize the service with a Supabase client
   */
  private async getClient(): Promise<Result<SupabaseClient<Database>, AppError>> {
    if (!this.client) {
      const result = getSupabaseClient();
      if (!result.success) {
        return result;
      }
      this.client = result.data;
      this.setupAuthListener();
    }
    return Result.ok(this.client);
  }

  /**
   * Initialize the auth service on app boot.
   * Restores session from localStorage and processes OAuth hash tokens.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        console.warn('[Auth] Could not initialize:', clientResult.error.message);
        return;
      }

      // getSession() restores from localStorage and processes OAuth hash tokens
      const {
        data: { session },
        error,
      } = await clientResult.data.auth.getSession();
      if (error) {
        console.warn('[Auth] Session restore failed:', error.message);
        return;
      }

      if (session?.user) {
        await this.ensureProfile(session.user);
        const userResult = await this.enrichUserWithProfile(session.user);
        if (userResult.success) {
          this.currentUser = userResult.data;
        } else {
          console.warn(
            '[Auth] Profile enrichment failed, using basic data:',
            userResult.error.message
          );
          this.currentUser = {
            id: session.user.id,
            email: session.user.email || '',
            emailConfirmed: session.user.email_confirmed_at !== null,
            createdAt: session.user.created_at,
          };
        }
        this.notifySessionListeners(this.currentUser);
      }
    } catch (err) {
      // AbortError from Web Locks API is non-fatal — session may still be restored
      // via onAuthStateChange listener
      console.warn('[Auth] Initialize error (non-fatal):', err);
    }
  }

  /**
   * Sign in with Google OAuth.
   * Redirects the browser to Google consent screen.
   */
  async signInWithGoogle(): Promise<Result<{ url: string }, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const { data, error } = await clientResult.data.auth.signInWithOAuth({
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
   * Fallback in case the DB trigger isn't set up.
   */
  private async ensureProfile(user: User): Promise<void> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) return;

      const { data: existing } = await clientResult.data
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

      await clientResult.data.from(DATABASE_TABLES.USER_PROFILES).insert(profileData as any);
    } catch (error) {
      console.error('[Auth] Failed to ensure profile:', error);
    }
  }

  /**
   * Set up auth state change listener
   */
  private setupAuthListener(): void {
    if (!this.client) return;

    this.client.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      try {
        switch (event) {
          case 'INITIAL_SESSION':
          case 'SIGNED_IN':
            if (session?.user) {
              await this.ensureProfile(session.user);
              const userResult = await this.enrichUserWithProfile(session.user);
              if (userResult.success) {
                this.currentUser = userResult.data;
              } else {
                // Profile enrichment failed — still sign in with basic user data
                console.warn(
                  '[Auth] Profile enrichment failed, using basic data:',
                  userResult.error.message
                );
                this.currentUser = {
                  id: session.user.id,
                  email: session.user.email || '',
                  emailConfirmed: session.user.email_confirmed_at !== null,
                  createdAt: session.user.created_at,
                };
              }
              this.notifySessionListeners(this.currentUser);
            }
            break;

          case 'SIGNED_OUT':
            this.currentUser = null;
            this.notifySessionListeners(null);
            break;

          case 'TOKEN_REFRESHED':
            // User session refreshed, no action needed
            break;

          case 'USER_UPDATED':
            if (session?.user && this.currentUser) {
              // Re-enrich user data
              const userResult = await this.enrichUserWithProfile(session.user);
              if (userResult.success) {
                this.currentUser = userResult.data;
                this.notifySessionListeners(this.currentUser);
              }
            }
            break;
        }
      } catch (error) {
        console.error('[Auth] Auth state change handler error:', error);
        // Still try to set basic user data if we have a session
        if (
          (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') &&
          session?.user &&
          !this.currentUser
        ) {
          this.currentUser = {
            id: session.user.id,
            email: session.user.email || '',
            emailConfirmed: session.user.email_confirmed_at !== null,
            createdAt: session.user.created_at,
          };
          this.notifySessionListeners(this.currentUser);
        }
      }
    });
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
   * If already authenticated, the callback is invoked immediately with the current user.
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

    // Return unsubscribe function
    return () => {
      const index = this.sessionListeners.indexOf(callback);
      if (index > -1) {
        this.sessionListeners.splice(index, 1);
      }
    };
  }

  /**
   * Enrich Supabase user with profile data
   */
  private async enrichUserWithProfile(user: User): Promise<Result<AuthUser, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      // Get user profile
      const { data: profile, error } = await clientResult.data
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
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      // Validate credentials
      const validationResult = this.validateCredentials(credentials);
      if (!validationResult.success) {
        return Result.err(validationResult.error);
      }

      // Sign up with Supabase Auth
      const signUpOptions: { emailRedirectTo?: string; data?: object } = {};
      if (credentials.redirectUrl) {
        signUpOptions.emailRedirectTo = credentials.redirectUrl;
      }
      if (credentials.displayName) {
        signUpOptions.data = { display_name: credentials.displayName };
      }

      const { data, error } = await clientResult.data.auth.signUp({
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

      // Create user profile
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
        // Log error but don't fail signup
        console.error('Failed to create user profile:', profileResult.error);
      }

      // Enrich user data
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
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const { data, error } = await clientResult.data.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      if (!data.user) {
        return Result.err(new AppError(ErrorCode.AUTH_ERROR, 'Sign in failed - no user returned'));
      }

      // Update last login time
      await this.updateLastLogin(data.user.id);

      // Enrich user data
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
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const { error } = await clientResult.data.auth.signOut();

      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      this.currentUser = null;
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
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const resetOptions: { redirectTo?: string } = {};
      if (credentials.redirectUrl) {
        resetOptions.redirectTo = credentials.redirectUrl;
      }

      const { error } = await clientResult.data.auth.resetPasswordForEmail(
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
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const { error } = await clientResult.data.auth.updateUser({
        password: newPassword,
      });

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

  /**
   * Get current authenticated user
   */
  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Get current session
   */
  async getCurrentSession(): Promise<Result<Session | null, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const {
        data: { session },
        error,
      } = await clientResult.data.auth.getSession();

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

      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
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

      const { data: profile, error } = await clientResult.data
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

      // Update current user
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
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const profileData: UserProfileInsert = {
        id: userId,
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: profile, error } = await clientResult.data
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
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) return;

      await clientResult.data
        .from(DATABASE_TABLES.USER_PROFILES)
        .update({ last_login_at: new Date().toISOString() } as unknown as never)
        .eq('id', userId);
    } catch (error) {
      // Log but don't fail authentication
      console.error('Failed to update last login:', error);
    }
  }

  /**
   * Validate sign up credentials
   */
  private validateCredentials(
    credentials: SignUpCredentials | SignInCredentials
  ): Result<true, AppError> {
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(credentials.email)) {
      return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid email format'));
    }

    // Password validation
    if (credentials.password.length < 6) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Password must be at least 6 characters')
      );
    }

    // Display name validation (for sign up)
    if ('displayName' in credentials && credentials.displayName) {
      if (credentials.displayName.length > 50) {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Display name must be 50 characters or less')
        );
      }
    }

    return Result.ok(true);
  }

  /**
   * Map Supabase auth errors to AppError
   */
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

  /**
   * Delete user account (requires re-authentication)
   */
  async deleteAccount(): Promise<Result<boolean, AppError>> {
    try {
      if (!this.currentUser) {
        return Result.err(new AppError(ErrorCode.AUTH_ERROR, 'No authenticated user'));
      }

      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      // Delete user profile first
      const { error: profileError } = await clientResult.data
        .from(DATABASE_TABLES.USER_PROFILES)
        .delete()
        .eq('id', this.currentUser.id);

      if (profileError) {
        console.error('Failed to delete user profile:', profileError);
      }

      // Delete auth user
      const { error: authError } = await clientResult.data.auth.admin.deleteUser(
        this.currentUser.id
      );

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
