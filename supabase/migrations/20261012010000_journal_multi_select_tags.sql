ALTER TABLE public.journal_trades
  ADD COLUMN IF NOT EXISTS setups text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS confluences text NOT NULL DEFAULT '[]';

UPDATE public.journal_trades
   SET setups = json_build_array(setup)::text
 WHERE setup <> '' AND setups = '[]';
