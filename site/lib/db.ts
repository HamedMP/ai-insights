import "server-only"

import { attachDatabasePool } from "@vercel/functions"
import { Pool } from "pg"

import { ARENA_COLUMN, PAGE_SIZE, rankAndPercentile, type ArenaId } from "@/lib/leaderboard"
import type { EntryRow, SaveResult } from "@/lib/publish"
import type { SharedAgent, SharedStats } from "@/lib/share"

/**
 * Postgres access for the leaderboard (Neon, through node-postgres with a pool Vercel Fluid compute keeps warm, as
 * Neon recommends for Vercel). Every query is parameterized; the only interpolated SQL is an arena's column name,
 * which comes from the fixed ARENA_COLUMN table and never from input.
 */

let pool: Pool | null = null

export const databaseConfigured = () => Boolean(process.env.DATABASE_URL)

function db(): Pool {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is not set")
  pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000 })
  attachDatabasePool(pool)
  return pool
}

/**
 * Latest publish wins. A second publish from the same person within 30 seconds is refused inside the same statement
 * (the WHERE on DO UPDATE), so the limit holds across server instances without a read-then-write race.
 */
export async function saveEntry(row: EntryRow): Promise<SaveResult> {
  const s = row.stats
  try {
    const result = await db().query(
      `INSERT INTO leaderboard_entries AS e
         (user_id, handle, display_name, period_from, period_to, sessions, tokens, usd, active_days, streak, claude_tokens, codex_tokens, agents, fact)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
       ON CONFLICT (user_id) DO UPDATE SET
         handle = EXCLUDED.handle, display_name = EXCLUDED.display_name, period_from = EXCLUDED.period_from,
         period_to = EXCLUDED.period_to, sessions = EXCLUDED.sessions, tokens = EXCLUDED.tokens, usd = EXCLUDED.usd,
         active_days = EXCLUDED.active_days, streak = EXCLUDED.streak, claude_tokens = EXCLUDED.claude_tokens,
         codex_tokens = EXCLUDED.codex_tokens, agents = EXCLUDED.agents, fact = EXCLUDED.fact, updated_at = now()
       WHERE e.updated_at < now() - interval '30 seconds'
       RETURNING user_id`,
      [row.userId, row.handle, row.displayName, s.from, s.to, s.sessions, s.tokens, s.usd, s.activeDays, s.streak, row.claudeTokens, row.codexTokens, JSON.stringify(s.agents), s.fact],
    )
    return result.rowCount === 1 ? "saved" : "too_soon"
  } catch (error) {
    // 23505 on the handle index: someone else holds this handle.
    if (error && typeof error === "object" && (error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "leaderboard_entries_handle_key") return "handle_taken"
    throw error
  }
}

export async function removeEntry(userId: string): Promise<boolean> {
  const result = await db().query("DELETE FROM leaderboard_entries WHERE user_id = $1", [userId])
  return result.rowCount === 1
}

export interface PublicEntry {
  handle: string
  displayName: string
  stats: SharedStats
  updatedAt: string
}

interface EntryRecord {
  handle: string
  display_name: string
  period_from: string
  period_to: string
  sessions: string
  tokens: string
  usd: string | null
  active_days: number
  streak: number
  agents: SharedAgent[]
  fact: string
  updated_at: Date
}

const COLUMNS = "handle, display_name, to_char(period_from, 'YYYY-MM-DD') AS period_from, to_char(period_to, 'YYYY-MM-DD') AS period_to, sessions, tokens, usd, active_days, streak, agents, fact, updated_at"

function toEntry(r: EntryRecord): PublicEntry {
  const agents = Array.isArray(r.agents) ? r.agents.filter((a) => a && typeof a.k === "string" && typeof a.p === "number").slice(0, 8) : []
  return {
    handle: r.handle,
    displayName: r.display_name,
    updatedAt: r.updated_at.toISOString(),
    stats: { v: 1, name: r.display_name, from: r.period_from, to: r.period_to, sessions: Number(r.sessions), tokens: Number(r.tokens), usd: r.usd === null ? null : Number(r.usd), activeDays: r.active_days, streak: r.streak, agents, fact: r.fact },
  }
}

export async function entryByHandle(handle: string): Promise<PublicEntry | null> {
  const result = await db().query<EntryRecord>(`SELECT ${COLUMNS} FROM leaderboard_entries WHERE handle = $1`, [handle])
  const row = result.rows[0]
  return row ? toEntry(row) : null
}

export async function entryByUser(userId: string): Promise<PublicEntry | null> {
  const result = await db().query<EntryRecord>(`SELECT ${COLUMNS} FROM leaderboard_entries WHERE user_id = $1`, [userId])
  const row = result.rows[0]
  return row ? toEntry(row) : null
}

export interface ArenaPage {
  rows: Array<PublicEntry & { rank: number; score: number }>
  total: number
}

/** One page of an arena, best first. Ties share a rank (competition ranking) and are ordered by who got there first. */
export async function arenaPage(arena: ArenaId, page: number): Promise<ArenaPage> {
  const col = ARENA_COLUMN[arena]
  const offset = (page - 1) * PAGE_SIZE
  const [rows, count] = await Promise.all([
      db().query<EntryRecord & { score: string; rank: string }>(
        `SELECT ${COLUMNS}, ${col} AS score, rank() OVER (ORDER BY ${col} DESC) AS rank
           FROM leaderboard_entries WHERE ${col} > 0
          ORDER BY ${col} DESC, updated_at ASC, handle ASC LIMIT $1 OFFSET $2`,
        [PAGE_SIZE, offset],
      ),
      db().query<{ n: string }>(`SELECT count(*) AS n FROM leaderboard_entries WHERE ${col} > 0`),
    ])
  return { rows: rows.rows.map((r) => ({ ...toEntry(r), rank: Number(r.rank), score: Number(r.score) })), total: Number(count.rows[0]?.n ?? 0) }
}

/** A person's rank and "top X%" in every arena they score in. */
export async function ranksFor(userId: string): Promise<Partial<Record<ArenaId, { rank: number; total: number; topPercent: number }>>> {
  const out: Partial<Record<ArenaId, { rank: number; total: number; topPercent: number }>> = {}
  const parts = (Object.keys(ARENA_COLUMN) as ArenaId[]).map((arena) => {
    const col = ARENA_COLUMN[arena]
    return `(SELECT count(*) FROM leaderboard_entries o WHERE o.${col} > me.${col}) AS "${arena}_higher",
            (SELECT count(*) FROM leaderboard_entries o WHERE o.${col} > 0) AS "${arena}_total",
            (me.${col} > 0) AS "${arena}_ranked"`
  })
  const result = await db().query<Record<string, string | boolean>>(`SELECT ${parts.join(", ")} FROM leaderboard_entries me WHERE me.user_id = $1`, [userId])
  const row = result.rows[0]
  if (!row) return out
  for (const arena of Object.keys(ARENA_COLUMN) as ArenaId[]) {
    if (row[`${arena}_ranked`] !== true) continue
    const r = rankAndPercentile(Number(row[`${arena}_higher`]), Number(row[`${arena}_total`]))
    if (r) out[arena] = r
  }
  return out
}
