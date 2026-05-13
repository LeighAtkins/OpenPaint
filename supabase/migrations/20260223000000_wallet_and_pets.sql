-- Wallet & Pets system tables
-- Adds coin balance tracking, transaction ledger, and pet inventory

-- ── wallets ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  equipped_pet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own wallet"
  ON wallets FOR SELECT
  USING (auth.uid() = user_id);

-- All mutations go through service-role key (server endpoints)

-- ── coin_transactions (ledger) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coin_transactions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          integer NOT NULL,
  reason          text NOT NULL,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coin_transactions_user_created
  ON coin_transactions (user_id, created_at DESC);

ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions"
  ON coin_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- ── pet_inventory ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pet_inventory (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pet_id)
);

ALTER TABLE pet_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own pets"
  ON pet_inventory FOR SELECT
  USING (auth.uid() = user_id);

-- ── RPC: atomic balance increment ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_wallet_balance(p_user_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE wallets
    SET balance = balance + p_amount,
        updated_at = now()
    WHERE user_id = p_user_id;
END;
$$;

-- ── RPC: atomic balance decrement (returns false if insufficient) ────────────
CREATE OR REPLACE FUNCTION decrement_wallet_balance(p_user_id uuid, p_amount integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rows_affected integer;
BEGIN
  UPDATE wallets
    SET balance = balance - p_amount,
        updated_at = now()
    WHERE user_id = p_user_id
      AND balance >= p_amount;
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$;
