-- Run this migration in the Supabase SQL Editor before configuring DATABASE_URL.
-- The application accesses these tables only from authenticated server routes.
CREATE TABLE IF NOT EXISTS public.journal_trades (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  instrument text NOT NULL CHECK (instrument IN ('MNQ', 'NQ', 'BTCUSDT')),
  side text NOT NULL CHECK (side IN ('long', 'short')),
  mode text NOT NULL CHECK (mode IN ('journal', 'paper')),
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  setup text NOT NULL DEFAULT '',
  market_condition text NOT NULL DEFAULT '',
  thesis text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  risk_amount double precision,
  funding double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS journal_trades_owner_updated
  ON public.journal_trades (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.journal_fills (
  id uuid PRIMARY KEY,
  trade_id uuid NOT NULL REFERENCES public.journal_trades(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('entry', 'exit')),
  quantity double precision NOT NULL CHECK (quantity > 0),
  price double precision NOT NULL CHECK (price > 0),
  fee double precision NOT NULL DEFAULT 0 CHECK (fee >= 0),
  risk_amount double precision,
  filled_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS journal_fills_owner_trade
  ON public.journal_fills (owner_id, trade_id, filled_at);

CREATE TABLE IF NOT EXISTS public.paper_settings (
  owner_id text PRIMARY KEY,
  starting_balance_usd double precision NOT NULL DEFAULT 0
    CHECK (starting_balance_usd >= 0),
  starting_balance_usdt double precision NOT NULL DEFAULT 0
    CHECK (starting_balance_usdt >= 0),
  risk_per_trade_percent double precision NOT NULL DEFAULT 1
    CHECK (risk_per_trade_percent > 0),
  daily_loss_limit_usd double precision NOT NULL DEFAULT 0
    CHECK (daily_loss_limit_usd >= 0),
  daily_loss_limit_usdt double precision NOT NULL DEFAULT 0
    CHECK (daily_loss_limit_usdt >= 0),
  max_open_positions integer NOT NULL DEFAULT 3
    CHECK (max_open_positions > 0),
  max_leverage double precision NOT NULL DEFAULT 2
    CHECK (max_leverage >= 1)
);

ALTER TABLE public.journal_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.journal_trades,
  public.journal_fills,
  public.paper_settings
FROM anon, authenticated, service_role;

-- No client API policies or grants are provided. Keep the database URL
-- server-side and access tables only through the authenticated app API.
