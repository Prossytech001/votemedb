-- Migration: add fee-split tracking + failure reasons to an EXISTING database.
-- schema.sql uses CREATE TABLE IF NOT EXISTS, so it won't touch your live tables —
-- run this once against your real Supabase database to bring it up to date.
-- Safe to re-run: every statement is guarded.

ALTER TABLE votes ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS platform_fee_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS organizer_payout_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS confirmed_via TEXT;

INSERT INTO settings (key, value) VALUES ('platform_fee_percent', '30')
  ON CONFLICT (key) DO NOTHING;

-- Backfill: for any vote already marked 'success' before this migration ran,
-- calculate its split retroactively using the CURRENT platform_fee_percent
-- (only affects historical rows where platform_fee_kobo is still 0).
DO $$
DECLARE
  fee_percent NUMERIC;
BEGIN
  SELECT value::NUMERIC INTO fee_percent FROM settings WHERE key = 'platform_fee_percent';

  UPDATE votes
  SET platform_fee_kobo = ROUND(amount_paid * (fee_percent / 100)),
      organizer_payout_kobo = amount_paid - ROUND(amount_paid * (fee_percent / 100))
  WHERE status = 'success' AND platform_fee_kobo = 0 AND organizer_payout_kobo = 0;
END $$;
