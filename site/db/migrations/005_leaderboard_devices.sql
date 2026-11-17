-- Additive only: one new table and one new column with a default. No existing row is changed, moved or deleted.
--
-- One row per (person, computer). A computer is told apart by the random device id its AI Insights store made
-- (v3 share links); links without one (v1, v2, and every entry published before this migration) belong to the
-- 'legacy' device. stats holds that computer's payload exactly as lib/share.ts validated it, and is re-validated on
-- every read. The account row in leaderboard_entries keeps the handle, display name, photo and referral credit, and
-- its number columns become the total over the account's devices (lib/devices.ts), written in the same transaction
-- as every device change, so the leaderboard queries and indexes stay as they are.
--
-- Existing entries get no device row here: the first time one is read, republished or changed after this migration,
-- the app treats its current numbers as its 'legacy' device (lib/device-sql.ts). That way an entry republished by the
-- previous deployment between this migration and the next deploy is never shadowed by an older copy.
CREATE TABLE IF NOT EXISTS leaderboard_devices (
  user_id     text NOT NULL REFERENCES leaderboard_entries (user_id) ON DELETE CASCADE,
  device_key  text NOT NULL CHECK (device_key = 'legacy' OR device_key ~ '^[0-9a-f]{32}$'),
  name        text NOT NULL DEFAULT '' CHECK (length(name) <= 32),
  name_public boolean NOT NULL DEFAULT false,
  stats       jsonb NOT NULL CHECK (jsonb_typeof(stats) = 'object' AND octet_length(stats::text) <= 8192),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_key)
);

-- How many computers the total counts (duplicates excluded): the leaderboard's "n devices" marker.
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS device_count smallint NOT NULL DEFAULT 1 CHECK (device_count BETWEEN 1 AND 10);
