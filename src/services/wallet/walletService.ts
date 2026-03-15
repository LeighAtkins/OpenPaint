// Wallet Service — manages coin balance, pet purchases, and equipped pet state
// Uses the same localStorage token pattern as cloudSaveService
import { authService } from '@/services/auth/authService';

export interface WalletState {
  balance: number;
  equippedPet: string | null;
  unlockedPets: string[];
  catalog: PetCatalogEntry[];
}

export interface PetCatalogEntry {
  id: string;
  name: string;
  type: 'cat' | 'dog';
  cost: number;
}

export interface EarnResult {
  success: boolean;
  earned: number;
  balance: number;
  reason?: string;
  rewardType?: 'cloud_save' | 'pdf_export';
}

type WalletListener = (state: WalletState) => void;
type WalletApiError = Error & { status?: number; code?: string };

class WalletService {
  private state: WalletState = {
    balance: 0,
    equippedPet: null,
    unlockedPets: [],
    catalog: [],
  };
  private listeners: WalletListener[] = [];
  private loaded = false;
  private loadPromise: Promise<WalletState> | null = null;
  private loadRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastLoadErrorSignature = '';
  private lastLoadErrorLoggedAt = 0;

  /** Read the stored auth session from localStorage (same as cloudSaveService) */
  private getStoredAuth(): { accessToken: string; userId: string } | null {
    try {
      const storageKey = Object.keys(localStorage).find(
        k => k.startsWith('sb-') && k.endsWith('-auth-token')
      );
      if (!storageKey) return null;
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const accessToken = parsed?.access_token;
      const userId = parsed?.user?.id;
      if (accessToken && userId) {
        return { accessToken, userId };
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async apiFetch<T>(
    path: string,
    options?: { method?: string; body?: unknown }
  ): Promise<{ success: boolean; data: T }> {
    const auth = this.getStoredAuth();
    if (!auth) {
      const error = new Error('Not authenticated') as WalletApiError;
      error.code = 'not_authenticated';
      throw error;
    }

    const resp = await fetch(path, {
      method: options?.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json.success) {
      const error = new Error(json?.message || `API error ${resp.status}`) as WalletApiError;
      error.status = resp.status;
      error.code = json?.error?.code;
      throw error;
    }
    return { success: true, data: json };
  }

  private logLoadError(error: unknown): void {
    const walletError = error as WalletApiError;
    const signature = `${walletError?.status || 0}:${walletError?.code || ''}:${walletError?.message || 'unknown'}`;
    const now = Date.now();
    if (signature === this.lastLoadErrorSignature && now - this.lastLoadErrorLoggedAt < 10_000) {
      return;
    }
    this.lastLoadErrorSignature = signature;
    this.lastLoadErrorLoggedAt = now;
    console.warn('[Wallet] Load failed:', error);
  }

  private scheduleLoadRetry(delayMs = 1200): void {
    if (this.loadRetryTimeout || !authService.isAuthenticated()) return;
    this.loadRetryTimeout = setTimeout(() => {
      this.loadRetryTimeout = null;
      void this.loadWallet();
    }, delayMs);
  }

  /** Load wallet state from server */
  async loadWallet(): Promise<WalletState> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    if (!this.getStoredAuth()) {
      if (authService.isAuthenticated()) {
        this.scheduleLoadRetry(400);
      }
      return this.state;
    }

    this.loadPromise = (async () => {
      try {
        const { data } = await this.apiFetch<any>('/api/wallet');
        this.state = {
          balance: data.balance ?? 0,
          equippedPet: data.equippedPet ?? null,
          unlockedPets: data.unlockedPets ?? [],
          catalog: data.catalog ?? [],
        };
        this.loaded = true;
        if (this.loadRetryTimeout) {
          clearTimeout(this.loadRetryTimeout);
          this.loadRetryTimeout = null;
        }
        this.notify();
      } catch (err) {
        const walletError = err as WalletApiError;
        this.loaded = false;
        if (walletError?.code === 'not_authenticated' || walletError?.status === 401) {
          this.scheduleLoadRetry(500);
        } else {
          this.scheduleLoadRetry(1500);
          this.logLoadError(err);
        }
      } finally {
        this.loadPromise = null;
      }
      return this.state;
    })();

    return this.loadPromise;
  }

  /** Earn coins from a qualifying cloud save */
  async earnCoins(
    projectId: string,
    saveTimestamp: string,
    projectData?: unknown,
    rewardType: 'cloud_save' | 'pdf_export' = 'cloud_save'
  ): Promise<{ success: boolean; data: EarnResult }> {
    try {
      const { data } = await this.apiFetch<EarnResult>('/api/wallet/earn', {
        method: 'POST',
        body: { projectId, saveTimestamp, projectData, rewardType },
      });
      this.state.balance = data.balance ?? this.state.balance;
      this.notify();
      return { success: true, data };
    } catch (err) {
      console.warn('[Wallet] Earn failed:', err);
      return { success: false, data: { success: false, earned: 0, balance: this.state.balance } };
    }
  }

  /** Purchase a pet */
  async purchasePet(petId: string): Promise<boolean> {
    try {
      const { data } = await this.apiFetch<any>('/api/wallet/spend', {
        method: 'POST',
        body: { petId },
      });
      this.state.balance = data.balance ?? this.state.balance;
      if (!this.state.unlockedPets.includes(petId)) {
        this.state.unlockedPets.push(petId);
      }
      this.notify();
      return true;
    } catch (err) {
      console.warn('[Wallet] Purchase failed:', err);
      return false;
    }
  }

  /** Equip or unequip a pet */
  async equipPet(petId: string | null): Promise<boolean> {
    try {
      await this.apiFetch<any>('/api/pets/equip', {
        method: 'POST',
        body: { petId },
      });
      this.state.equippedPet = petId;
      this.notify();
      return true;
    } catch (err) {
      console.warn('[Wallet] Equip failed:', err);
      return false;
    }
  }

  /** Clear local state on logout */
  clear(): void {
    this.state = { balance: 0, equippedPet: null, unlockedPets: [], catalog: [] };
    this.loaded = false;
    if (this.loadRetryTimeout) {
      clearTimeout(this.loadRetryTimeout);
      this.loadRetryTimeout = null;
    }
    this.loadPromise = null;
    this.notify();
  }

  /** Subscribe to wallet state changes */
  onChange(listener: WalletListener): () => void {
    this.listeners.push(listener);
    if (this.loaded) {
      try {
        listener(this.state);
      } catch {
        /* ignore */
      }
    }
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx > -1) this.listeners.splice(idx, 1);
    };
  }

  getState(): WalletState {
    return this.state;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch {
        /* ignore */
      }
    }
  }
}

export const walletService = new WalletService();
