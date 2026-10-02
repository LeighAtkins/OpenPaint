interface BudgetStorage {
  sql: { exec(query: string, ...bindings: number[]): { toArray(): unknown[] } };
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
}
/** The conditional SQLite write is atomic; rejected requests cannot increase usage. */
export async function consumeDailyBudget(
  storage: BudgetStorage,
  amount: number,
  limit: number
): Promise<boolean> {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > limit) return false;
  storage.sql.exec(
    'CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY, used INTEGER NOT NULL)'
  );
  const rows = storage.sql
    .exec(
      'INSERT INTO budget (id, used) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET used = used + excluded.used WHERE used + excluded.used <= ? RETURNING used',
      amount,
      limit
    )
    .toArray();
  if (!(await storage.getAlarm())) await storage.setAlarm(Date.now() + 2 * 86400000);
  return rows.length > 0;
}
