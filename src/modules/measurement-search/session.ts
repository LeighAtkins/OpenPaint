import { getCwMeasurementIdentity, getCwRequestHeaders } from '../../services/auth/cwAccess';
/** Memory only, owned by one verified identity. Logout aborts requests and clears it. */
export class MeasurementSession {
  private generation = 0;
  private identity = '';
  private controllers = new Set<AbortController>();
  private cache = new Map<string, any>();
  private pending = new Map<string, Promise<any>>();
  setIdentity(identity: string): boolean {
    if (identity === this.identity) return false;
    this.clear();
    this.identity = identity;
    return true;
  }
  clear() {
    this.generation++;
    this.controllers.forEach(controller => controller.abort());
    this.controllers.clear();
    this.cache.clear();
    this.pending.clear();
    this.identity = '';
  }
  async request(key: string, body: unknown, endpoint = 'search'): Promise<any> {
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const generation = this.generation;
    const identity = this.identity;
    const controller = new AbortController();
    this.controllers.add(controller);
    const task = (async () => {
      if (!identity || getCwMeasurementIdentity() !== identity)
        throw new Error('Sign in to view measurements.');
      const headers = await getCwRequestHeaders();
      if (generation !== this.generation || getCwMeasurementIdentity() !== identity)
        throw new DOMException('Session changed', 'AbortError');
      const response = await fetch(`/api/integrations/cw/measurements/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      const data = await response.json();
      if (generation !== this.generation || getCwMeasurementIdentity() !== identity)
        throw new DOMException('Session changed', 'AbortError');
      if (!response.ok)
        throw new Error(data.message || 'Measurements could not load. Please try again.');
      // Bound the cache to one catalogue plus the most recent models/diagrams.
      if (this.cache.size >= 60) {
        const oldest = [...this.cache.keys()].find(key => key !== 'catalogue');
        if (oldest) this.cache.delete(oldest);
      }
      this.cache.set(key, data);
      return data;
    })().finally(() => {
      this.controllers.delete(controller);
      if (this.pending.get(key) === task) this.pending.delete(key);
    });
    this.pending.set(key, task);
    return task;
  }
}
