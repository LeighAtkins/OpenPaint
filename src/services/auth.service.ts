// Authentication service with comprehensive user management
import { SupabaseClient, User, Session, AuthError } from '@supabase/supabase-js';
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
   * Set up auth state change listener
   */
  private setupAuthListener(): void {
    if (!this.client) return;

    this.client.auth.onAuthStateChange(async (event, session) => {
      switch (event) {
        case 'SIGNED_IN':
          if (session?.user) {
            const userResult = await this.enrichUserWithProfile(session.user);
            if (userResult.success) {
              this.currentUser = userResult.data;
              this.notifySessionListeners(this.currentUser);
            }
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
   * Subscribe to auth state changes
   */
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
    this.sessionListeners.push(callback);

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
        lastSignInAt: user.last_sign_in_at || undefined,
        createdAt: user.created_at,
        profile: profile || undefined,
      };

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
      const { data, error } = await clientResult.data.auth.signUp({
        email: credentials.email,
        password: credentials.password,
        options: {
          emailRedirectTo: credentials.redirectUrl,
          data: {
            display_name: credentials.displayName,
          },
        },
      });

      if (error) {
        return Result.err(this.mapAuthError(error));
      }

      if (!data.user) {
        return Result.err(new AppError(ErrorCode.AUTH_ERROR, 'Sign up failed - no user returned'));
      }

      // Create user profile
      const profileResult = await this.createUserProfile(data.user.id, {
        email: credentials.email,
        display_name: credentials.displayName,
        preferences: DEFAULT_USER_PREFERENCES,
      });

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

      const { error } = await clientResult.data.auth.resetPasswordForEmail(credentials.email, {
        redirectTo: credentials.redirectUrl,
      });

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
        .update(updateData)
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
        .insert(profileData)
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
        .update({ last_login_at: new Date().toISOString() })
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
