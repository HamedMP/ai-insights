/**
 * The publish statement, in its own import-free module so scripts/check-referrals.mjs can run the exact production SQL
 * against a database inside a rolled-back transaction. lib/db.ts is the only runtime caller.
 *
 * Latest publish wins. A second publish from the same person within 30 seconds is refused inside the same statement
 * (the WHERE on DO UPDATE), so the limit holds across server instances without a read-then-write race.
 * The referrer is resolved in the same statement: the claimed handle must belong to another person's entry. It is
 * written only by the INSERT branch, so a republish never sets or changes it. The cards, titles, ratios and the
 * avatar choice are replaced as a whole by every publish.
 * RETURNING: no row means "too soon"; `inserted` is true for a first publish; `referred` says the row has a referrer.
 */
import type { EntryRow } from "./publish.ts"

export const SAVE_ENTRY_SQL = `WITH ref AS (SELECT user_id FROM leaderboard_entries WHERE handle = $17 AND user_id <> $1)
INSERT INTO leaderboard_entries AS e
  (user_id, handle, display_name, period_from, period_to, sessions, tokens, usd, active_days, streak, claude_tokens, codex_tokens, agents, fact,
   payload_version, cards, referred_by, referred_at, avatar_url, titles, ratios)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16::jsonb,
        (SELECT user_id FROM ref), CASE WHEN EXISTS (SELECT 1 FROM ref) THEN now() END, $18, $19::jsonb, $20::jsonb)
ON CONFLICT (user_id) DO UPDATE SET
  handle = EXCLUDED.handle, display_name = EXCLUDED.display_name, period_from = EXCLUDED.period_from,
  period_to = EXCLUDED.period_to, sessions = EXCLUDED.sessions, tokens = EXCLUDED.tokens, usd = EXCLUDED.usd,
  active_days = EXCLUDED.active_days, streak = EXCLUDED.streak, claude_tokens = EXCLUDED.claude_tokens,
  codex_tokens = EXCLUDED.codex_tokens, agents = EXCLUDED.agents, fact = EXCLUDED.fact,
  payload_version = EXCLUDED.payload_version, cards = EXCLUDED.cards, avatar_url = EXCLUDED.avatar_url, titles = EXCLUDED.titles, ratios = EXCLUDED.ratios, updated_at = now()
WHERE e.updated_at < now() - interval '30 seconds'
RETURNING (e.xmax = 0) AS inserted, (e.referred_by IS NOT NULL) AS referred`

export function saveEntryParams(row: EntryRow): unknown[] {
  const s = row.stats
  return [
    row.userId, row.handle, row.displayName, s.from, s.to, s.sessions, s.tokens, s.usd, s.activeDays, s.streak, row.claudeTokens, row.codexTokens,
    JSON.stringify(s.agents), s.fact, s.v, s.cards ? JSON.stringify(s.cards) : null, row.referrer, row.avatarUrl,
    s.titles ? JSON.stringify(s.titles) : null, s.ratios ? JSON.stringify(s.ratios) : null,
  ]
}
