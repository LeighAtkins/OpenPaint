// Wallet Service — manages coin balance, pet purchases, and equipped pet state
// Uses the same localStorage token pattern as cloudSaveService

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
}

type WalletListener = (state: WalletState) => void;

class WalletService {
  private state: WalletState = {
    balance: 0,
    equippedPet: null,
    unlockedPets: [],
    catalog: [],
  };
  private listeners: WalletListener[] = [];
  private loaded = false;

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
      throw new Error('Not authenticated');
    }

    const resp = await fetch(path, {
      method: options?.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const json = await resp.json();
    if (!resp.ok || !json.success) {
      throw new Error(json.message || `API error ${resp.status}`);
    }
    return { success: true, data: json };
  }

  /** Load wallet state from server */
  async loadWallet(): Promise<WalletState> {
    try {
      const { data } = await this.apiFetch<any>('/api/wallet');
      this.state = {
        balance: data.balance ?? 0,
        equippedPet: data.equippedPet ?? null,
        unlockedPets: data.unlockedPets ?? [],
        catalog: data.catalog ?? [],
      };
      this.loaded = true;
      this.notify();
    } catch (err) {
      console.warn('[Wallet] Load failed:', err);
    }
    return this.state;
  }

  /** Earn coins from a qualifying cloud save */
  async earnCoins(
    projectId: string,
    saveTimestamp: string,
    projectData?: unknown
  ): Promise<{ success: boolean; data: EarnResult }> {
    try {
      const { data } = await this.apiFetch<EarnResult>('/api/wallet/earn', {
        method: 'POST',
        body: { projectId, saveTimestamp, projectData },
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
