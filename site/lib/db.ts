import "server-only"

import { attachDatabasePool } from "@vercel/functions"
import { Pool } from "pg"

import { ARENA_COLUMN, PAGE_SIZE, rankAndPercentile, type ArenaId } from "@/lib/leaderboard"
import { safeAvatarUrl } from "@/lib/avatar"
import { SAVE_ENTRY_SQL, saveEntryParams } from "@/lib/entry-sql"
import type { EntryRow, SaveOutcome } from "@/lib/publish"
import { storedCards, storedRatios, storedTitles, type SharedAgent, type SharedStats } from "@/lib/share"

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

/** Save a publish. The statement and its rules (latest wins, 30-second limit, referrer set once) are in lib/entry-sql.ts. */
export async function saveEntry(row: EntryRow): Promise<SaveOutcome> {
  try {
    const result = await db().query<{ inserted: boolean; referred: boolean }>(SAVE_ENTRY_SQL, saveEntryParams(row))
    const saved = result.rows[0]
    if (!saved) return "too_soon"
    return { result: "saved", credited: saved.inserted && saved.referred ? row.referrer : null }
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
  /** When the entry was first published: the profile's "joined" date. */
  createdAt: string
  /** The Clerk photo the person chose to show, re-checked on read; null shows initials. */
  avatarUrl: string | null
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
  payload_version: number
  cards: unknown
  avatar_url: string | null
  titles: unknown
  ratios: unknown
  updated_at: Date
  created_at: Date
}

const COLUMNS = "handle, display_name, to_char(period_from, 'YYYY-MM-DD') AS period_from, to_char(period_to, 'YYYY-MM-DD') AS period_to, sessions, tokens, usd, active_days, streak, agents, fact, payload_version, cards, avatar_url, titles, ratios, updated_at, created_at"

function v2Extras(r: EntryRecord): Pick<SharedStats, "cards" | "titles" | "ratios"> {
  const ratios = storedRatios(r.ratios)
  return { cards: storedCards(r.cards), ratios, titles: storedTitles(r.titles, ratios) }
}

function toEntry(r: EntryRecord): PublicEntry {
  const agents = Array.isArray(r.agents) ? r.agents.filter((a) => a && typeof a.k === "string" && typeof a.p === "number").slice(0, 8) : []
  return {
    handle: r.handle,
    displayName: r.display_name,
    updatedAt: r.updated_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    avatarUrl: safeAvatarUrl(r.avatar_url),
    stats: {
      v: r.payload_version === 2 ? 2 : 1,
      name: r.display_name, from: r.period_from, to: r.period_to, sessions: Number(r.sessions), tokens: Number(r.tokens), usd: r.usd === null ? null : Number(r.usd), activeDays: r.active_days, streak: r.streak, agents, fact: r.fact,
      ...(r.payload_version === 2 ? v2Extras(r) : {}),
    },
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

export type Ranks = Partial<Record<ArenaId, { rank: number; total: number; topPercent: number }>>

/** A person's rank and "top X%" in every arena they score in, by their user id (their own view). */
export const ranksFor = (userId: string) => ranksWhere("user_id", userId)
/** The same, by public handle, for a profile page. */
export const ranksForHandle = (handle: string) => ranksWhere("handle", handle)

async function ranksWhere(column: "user_id" | "handle", value: string): Promise<Ranks> {
  const out: Ranks = {}
  const parts = (Object.keys(ARENA_COLUMN) as ArenaId[]).map((arena) => {
    const col = ARENA_COLUMN[arena]
    return `(SELECT count(*) FROM leaderboard_entries o WHERE o.${col} > me.${col}) AS "${arena}_higher",
            (SELECT count(*) FROM leaderboard_entries o WHERE o.${col} > 0) AS "${arena}_total",
            (me.${col} > 0) AS "${arena}_ranked"`
  })
  // `column` is one of two fixed names chosen by the callers above, never input.
  const result = await db().query<Record<string, string | boolean>>(`SELECT ${parts.join(", ")} FROM leaderboard_entries me WHERE me.${column} = $1`, [value])
  const row = result.rows[0]
  if (!row) return out
  for (const arena of Object.keys(ARENA_COLUMN) as ArenaId[]) {
    if (row[`${arena}_ranked`] !== true) continue
    const r = rankAndPercentile(Number(row[`${arena}_higher`]), Number(row[`${arena}_total`]))
    if (r) out[arena] = r
  }
  return out
}

export interface Referral {
  handle: string
  displayName: string
  referredAt: string
}

export const MAX_REFERRALS_LISTED = 100

/** The signed-in person's own referrals, newest first: their handle, how many, and the latest MAX_REFERRALS_LISTED. */
export async function referralsFor(userId: string): Promise<{ handle: string; count: number; referrals: Referral[] } | null> {
  const me = await db().query<{ handle: string; n: string }>(
    "SELECT handle, (SELECT count(*) FROM leaderboard_entries o WHERE o.referred_by = me.user_id) AS n FROM leaderboard_entries me WHERE me.user_id = $1",
    [userId],
  )
  const row = me.rows[0]
  if (!row) return null
  const list = await db().query<{ handle: string; display_name: string; referred_at: Date }>(
    "SELECT handle, display_name, referred_at FROM leaderboard_entries WHERE referred_by = $1 ORDER BY referred_at DESC, handle ASC LIMIT $2",
    [userId, MAX_REFERRALS_LISTED],
  )
  return { handle: row.handle, count: Number(row.n), referrals: list.rows.map((r) => ({ handle: r.handle, displayName: r.display_name, referredAt: r.referred_at.toISOString() })) }
}

/** How many published people a handle brought in: the only referral figure visitors see. */
export async function referralCount(handle: string): Promise<number> {
  const result = await db().query<{ n: string }>(
    "SELECT count(*) AS n FROM leaderboard_entries o JOIN leaderboard_entries me ON o.referred_by = me.user_id WHERE me.handle = $1",
    [handle],
  )
  return Number(result.rows[0]?.n ?? 0)
}
