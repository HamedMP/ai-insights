-- Additive only: new nullable or defaulted columns, one partial index and one view. Existing rows keep their data.

-- v2 publishes carry the recap cards as data (validated by site/lib/share.ts). v1 entries keep cards NULL and their
-- profile renders without a gallery. A republish replaces the cards with whatever the new payload carries.
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS payload_version smallint NOT NULL DEFAULT 1 CHECK (payload_version IN (1, 2));
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS cards jsonb CHECK (cards IS NULL OR (jsonb_typeof(cards) = 'array' AND jsonb_array_length(cards) <= 16));

-- Referrals. referred_by is the referrer's user_id (stable across handle changes), set on the first publish only and
-- never changed by a republish. No foreign key: when a referrer removes their entry the credit is hidden by the
-- join below, and it comes back if they publish again. referral_notified_at is for a later "X joined from your
-- link" notification; nothing writes it yet.
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS referred_by text CHECK (referred_by IS NULL OR (length(referred_by) BETWEEN 1 AND 64 AND referred_by <> user_id));
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS referred_at timestamptz;
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS referral_notified_at timestamptz;
CREATE INDEX IF NOT EXISTS leaderboard_entries_referred_by_idx ON leaderboard_entries (referred_by, referred_at DESC) WHERE referred_by IS NOT NULL;

-- One row per credited referral, with both sides' current handles. A notifier can select WHERE notified_at IS NULL
-- and then set leaderboard_entries.referral_notified_at for referred_user_id.
CREATE OR REPLACE VIEW referrals AS
  SELECT r.user_id AS referrer_user_id,
         r.handle AS referrer_handle,
         e.user_id AS referred_user_id,
         e.handle AS referred_handle,
         e.display_name AS referred_display_name,
         e.referred_at,
         e.referral_notified_at AS notified_at
    FROM leaderboard_entries e
    JOIN leaderboard_entries r ON r.user_id = e.referred_by;
