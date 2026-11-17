-- Additive only. v2 publishes also carry the earned titles and the five work ratios, as {k, v} pairs validated by
-- site/lib/share.ts (title wording and rules live in code, not here). A republish replaces both; v1 entries keep NULL.
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS titles jsonb CHECK (titles IS NULL OR (jsonb_typeof(titles) = 'array' AND jsonb_array_length(titles) <= 3));
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS ratios jsonb CHECK (ratios IS NULL OR (jsonb_typeof(ratios) = 'array' AND jsonb_array_length(ratios) <= 5));
