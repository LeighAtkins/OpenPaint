import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { consumeDailyBudget } from '../../src/modules/measurement-assistant/mcp/usage-budget';
function counter() {
  const db = new DatabaseSync(':memory:');
  let alarm: number | null = null;
  return {
    sql: {
      exec(query: string, ...bindings: number[]) {
        if (query.startsWith('CREATE')) {
          db.exec(query);
          return { toArray: () => [] };
        }
        return { toArray: () => db.prepare(query).all(...bindings) };
      },
    },
    getAlarm: async () => alarm,
    setAlarm: async (time: number) => {
      alarm = time;
    },
    close: () => db.close(),
  };
}
describe('shared daily capacity', () => {
  it('admits exactly the limit when requests arrive together', async () => {
    const storage = counter();
    try {
      const admitted = await Promise.all(
        Array.from({ length: 30 }, () => consumeDailyBudget(storage, 1, 10))
      );
      expect(admitted.filter(Boolean)).toHaveLength(10);
      expect(await consumeDailyBudget(storage, 1, 10)).toBe(false);
      expect(await storage.getAlarm()).toBeGreaterThan(Date.now());
    } finally {
      storage.close();
    }
  });
  it('rejects invalid or oversized claims without charging the next valid one', async () => {
    const storage = counter();
    try {
      for (const amount of [-1, 0, 0.5, NaN, 101])
        expect(await consumeDailyBudget(storage, amount, 100)).toBe(false);
      expect(await consumeDailyBudget(storage, 80, 100)).toBe(true);
      expect(await consumeDailyBudget(storage, 21, 100)).toBe(false);
      expect(await consumeDailyBudget(storage, 20, 100)).toBe(true);
    } finally {
      storage.close();
    }
  });
});
