import "server-only"

import { attachDatabasePool } from "@vercel/functions"
import { Pool } from "pg"

import { ARENA_COLUMN, PAGE_SIZE, rankAndPercentile, type ArenaId } from "@/lib/leaderboard"
import { safeAvatarUrl } from "@/lib/avatar"
import { ACCOUNT_COLUMNS, accountStats, devicesOf, publishDevice, removeDevice, renameDevice, type AccountRecord, type Db } from "@/lib/device-sql"
import { aggregate, deviceLabel, type DeviceRecord } from "@/lib/devices"
import type { EntryRow, SaveChoices, SaveOutcome } from "@/lib/publish"
import type { RatioKey, SharedCard, SharedStats } from "@/lib/share"

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

/** Run `work` in one transaction on one pooled connection; it commits only when `keep` says so. */
async function transaction<T>(work: (client: Db) => Promise<T>, keep: (result: T) => boolean): Promise<T> {
  const client = await db().connect()
  try {
    await client.query("BEGIN")
    const result = await work(client as unknown as Db)
    await client.query(keep(result) ? "COMMIT" : "ROLLBACK")
    return result
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError: unknown) => console.error("leaderboard rollback failed", rollbackError instanceof Error ? rollbackError.name : "unknown"))
    throw error
  } finally {
    client.release()
  }
}

/**
 * Save a publish: the account row (latest wins, 30-second limit, referrer set once; lib/entry-sql.ts) and this
 * computer's device row, then the account total over all devices, in one transaction (lib/device-sql.ts).
 */
export async function saveEntry(row: EntryRow, choices: SaveChoices): Promise<SaveOutcome> {
  try {
    const saved = await transaction((client) => publishDevice(client, row, choices), (r) => r.result === "saved")
    if (saved.result !== "saved") return saved.result
    return { result: "saved", credited: saved.inserted && saved.referred ? row.referrer : null, duplicate: saved.duplicate, devices: saved.devices }
  } catch (error) {
    // 23505 on the handle index: someone else holds this handle.
    if (error && typeof error === "object" && (error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "leaderboard_entries_handle_key") return "handle_taken"
    throw error
  }
}

/** Remove everything: the account row, and with it (ON DELETE CASCADE) every device row. */
export async function removeEntry(userId: string): Promise<boolean> {
  const result = await db().query("DELETE FROM leaderboard_entries WHERE user_id = $1", [userId])
  return result.rowCount === 1
}

export const removeOwnDevice = (userId: string, key: string) => transaction((client) => removeDevice(client, userId, key), (r) => r === "ok")
export const renameOwnDevice = (userId: string, key: string, name: string, namePublic: boolean) => transaction((client) => renameDevice(client, userId, key, name, namePublic), (r) => r === "ok")

/** The signed-in person's handle and devices, for their own devices panel. */
export async function ownDevices(userId: string): Promise<{ handle: string; devices: DeviceRecord[] } | null> {
  const result = await db().query<AccountRecord>(`SELECT ${ACCOUNT_COLUMNS} FROM leaderboard_entries WHERE user_id = $1`, [userId])
  const account = result.rows[0]
  return account ? { handle: account.handle, devices: await devicesOf(db() as unknown as Db, account) } : null
}

/** One computer as the public profile shows it: a label (its name only if the owner chose that) and its numbers. */
export interface PublicDevice {
  label: string
  stats: SharedStats
  updatedAt: string
  /** It duplicates another device exactly and is not counted. */
  duplicate: boolean
}

export interface PublicEntry {
  handle: string
  displayName: string
  /** The account total: what the leaderboard ranks and the profile leads with. */
  stats: SharedStats
  updatedAt: string
  /** When the entry was first published: the profile's "joined" date. */
  createdAt: string
  /** The Clerk photo the person chose to show, re-checked on read; null shows initials. */
  avatarUrl: string | null
  /** Computers the total counts. */
  deviceCount: number
}

export interface PublicProfile extends PublicEntry {
  devices: PublicDevice[]
  /** Active days and streak are exact; false: lower bounds ("at least"). */
  exactDays: boolean
  /** The "All devices" cards, each with the label of the computer it came from (null: rebuilt from the total). */
  highlights: Array<{ card: SharedCard; from: string | null }>
  /** Ratios shown per computer only, because one of them did not send the count behind it. */
  perDeviceRatios: RatioKey[]
}

function toEntry(r: AccountRecord): PublicEntry {
  return {
    handle: r.handle,
    displayName: r.display_name,
    updatedAt: r.updated_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    avatarUrl: safeAvatarUrl(r.avatar_url),
    stats: accountStats(r),
    deviceCount: Math.max(1, Number(r.device_count) || 1),
  }
}

/** A public profile: the account, its devices and the total recomputed from them (the same rules as on write). */
export async function entryByHandle(handle: string): Promise<PublicProfile | null> {
  const result = await db().query<AccountRecord>(`SELECT ${ACCOUNT_COLUMNS} FROM leaderboard_entries WHERE handle = $1`, [handle])
  const row = result.rows[0]
  if (!row) return null
  const devices = await devicesOf(db() as unknown as Db, row)
  const total = aggregate(devices)
  const labels = new Map(devices.map((d, i) => [d.key, deviceLabel(d, i, "public")]))
  const duplicates = new Set(total.duplicates.map((d) => d.key))
  const entry = toEntry(row)
  return {
    ...entry,
    stats: { ...total.stats, name: row.display_name },
    deviceCount: Math.max(1, total.counted),
    devices: devices.map((d) => ({ label: labels.get(d.key)!, stats: d.stats, updatedAt: d.updatedAt, duplicate: duplicates.has(d.key) })),
    exactDays: total.exactDays,
    highlights: total.highlights.map((h) => ({ card: h.card, from: h.from === null ? null : (labels.get(h.from) ?? null) })),
    perDeviceRatios: total.perDeviceRatios,
  }
}

export async function entryByUser(userId: string): Promise<PublicEntry | null> {
  const result = await db().query<AccountRecord>(`SELECT ${ACCOUNT_COLUMNS} FROM leaderboard_entries WHERE user_id = $1`, [userId])
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
      db().query<AccountRecord & { score: string; rank: string }>(
        `SELECT ${ACCOUNT_COLUMNS}, ${col} AS score, rank() OVER (ORDER BY ${col} DESC) AS rank
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
