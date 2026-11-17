-- One row per signed-in person: their latest publish replaces the previous one.
-- The numbers are self-reported from a v1 share payload, validated and clamped by site/lib/share.ts before insert.
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  user_id        text PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 64),
  handle         text NOT NULL CHECK (handle ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$' AND position('--' in handle) = 0),
  display_name   text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  period_from    date NOT NULL,
  period_to      date NOT NULL CHECK (period_to >= period_from),
  sessions       bigint NOT NULL CHECK (sessions BETWEEN 0 AND 10000000),
  tokens         bigint NOT NULL CHECK (tokens BETWEEN 0 AND 10000000000000),
  usd            numeric(12, 2) CHECK (usd IS NULL OR usd BETWEEN 0 AND 10000000),
  active_days    integer NOT NULL CHECK (active_days BETWEEN 0 AND 3660),
  streak         integer NOT NULL CHECK (streak BETWEEN 0 AND 3660),
  claude_tokens  bigint NOT NULL CHECK (claude_tokens >= 0),
  codex_tokens   bigint NOT NULL CHECK (codex_tokens >= 0),
  agents         jsonb NOT NULL CHECK (jsonb_typeof(agents) = 'array' AND jsonb_array_length(agents) <= 8),
  fact           text NOT NULL CHECK (length(fact) <= 120),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_entries_handle_key ON leaderboard_entries (handle);
CREATE INDEX IF NOT EXISTS leaderboard_entries_tokens_idx ON leaderboard_entries (tokens DESC, updated_at);
CREATE INDEX IF NOT EXISTS leaderboard_entries_usd_idx ON leaderboard_entries (usd DESC NULLS LAST, updated_at);
CREATE INDEX IF NOT EXISTS leaderboard_entries_claude_idx ON leaderboard_entries (claude_tokens DESC, updated_at);
CREATE INDEX IF NOT EXISTS leaderboard_entries_codex_idx ON leaderboard_entries (codex_tokens DESC, updated_at);
CREATE INDEX IF NOT EXISTS leaderboard_entries_streak_idx ON leaderboard_entries (streak DESC, updated_at);
