-- Additive only. The person's Clerk photo URL, stored only when they chose "show my photo" on their latest publish.
-- A republish without that choice sets it back to NULL. The CHECK keeps any stored URL on Clerk's image host.
ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS avatar_url text CHECK (avatar_url IS NULL OR (length(avatar_url) <= 1024 AND avatar_url LIKE 'https://img.clerk.com/%'));
