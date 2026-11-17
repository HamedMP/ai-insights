/**
 * Publishing, renaming and removing devices, as SQL run inside one transaction the caller opens (lib/db.ts) or rolls
 * back (scripts/check-devices.mjs, which runs this exact code against a real database with synthetic users).
 *
 * Every change locks the person's account row first (SELECT ... FOR UPDATE), so two computers publishing at once
 * are serialised: the device cap and the recomputed total are never raced. The account row's number columns are
 * rewritten from all of the person's devices (lib/devices.ts) before the transaction commits.
 *
 * An entry published before devices existed has no device rows. The first change after the migration turns its
 * current numbers into the 'legacy' device (materialiseLegacy); reads do the same in memory without writing.
 */
import { SAVE_ENTRY_SQL, saveEntryParams } from "./entry-sql.ts"
import { aggregate, LEGACY_DEVICE, MAX_DEVICES, ordered, type AccountTotals, type DeviceRecord } from "./devices.ts"
import type { DeviceChange } from "./device-routes.ts"
import type { EntryRow } from "./publish.ts"
import { cleanText, LIMITS, storedCards, storedRatios, storedTitles, validateStats, type SharedAgent, type SharedStats } from "./share.ts"

export interface Db {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>
}

/** An account row as the readers select it (ACCOUNT_COLUMNS). */
export interface AccountRecord {
  user_id: string
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
  device_count: number
  updated_at: Date
  created_at: Date
}

export const ACCOUNT_COLUMNS =
  "user_id, handle, display_name, to_char(period_from, 'YYYY-MM-DD') AS period_from, to_char(period_to, 'YYYY-MM-DD') AS period_to, sessions, tokens, usd, active_days, streak, agents, fact, payload_version, cards, avatar_url, titles, ratios, device_count, updated_at, created_at"

/** The numbers an account row holds, as stats. Stored extras are re-validated and dropped rather than failing. */
export function accountStats(r: AccountRecord): SharedStats {
  const agents = Array.isArray(r.agents) ? r.agents.filter((a) => a && typeof a.k === "string" && typeof a.p === "number").slice(0, LIMITS.agents) : []
  const stats: SharedStats = {
    v: r.payload_version === 2 ? 2 : 1,
    name: r.display_name, from: r.period_from, to: r.period_to, sessions: Number(r.sessions), tokens: Number(r.tokens), usd: r.usd === null ? null : Number(r.usd), activeDays: r.active_days, streak: r.streak, agents, fact: r.fact,
  }
  if (r.payload_version === 2) {
    const ratios = storedRatios(r.ratios)
    stats.cards = storedCards(r.cards)
    stats.ratios = ratios
    stats.titles = storedTitles(r.titles, ratios)
  }
  return stats
}

interface DeviceRow {
  device_key: string
  name: string
  name_public: boolean
  stats: unknown
  created_at: Date
  updated_at: Date
}

const DEVICE_COLUMNS = "device_key, name, name_public, stats, created_at, updated_at"

/** A stored device, re-validated; a row whose stats no longer validate is left out rather than failing the page. */
function toDevice(r: DeviceRow): DeviceRecord | null {
  const stats = validateStats(r.stats)
  if (!stats) return null
  return { key: r.device_key, name: cleanText(r.name, LIMITS.deviceName), namePublic: r.name_public === true, stats, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() }
}

const legacyFrom = (account: AccountRecord): DeviceRecord => ({ key: LEGACY_DEVICE, name: "", namePublic: false, stats: accountStats(account), createdAt: account.created_at.toISOString(), updatedAt: account.updated_at.toISOString() })

/** A person's devices, first published first. An entry from before devices reads as its one legacy device. */
export async function devicesOf(db: Db, account: AccountRecord): Promise<DeviceRecord[]> {
  const result = await db.query<DeviceRow>(`SELECT ${DEVICE_COLUMNS} FROM leaderboard_devices WHERE user_id = $1 ORDER BY created_at, device_key`, [account.user_id])
  if (result.rows.length === 0) return [legacyFrom(account)]
  return ordered(result.rows.map(toDevice).filter((d): d is DeviceRecord => d !== null))
}

async function lockAccount(db: Db, userId: string): Promise<AccountRecord | null> {
  const result = await db.query<AccountRecord>(`SELECT ${ACCOUNT_COLUMNS} FROM leaderboard_entries WHERE user_id = $1 FOR UPDATE`, [userId])
  return result.rows[0] ?? null
}

/** Turn a pre-device entry's current numbers into its 'legacy' device row, once. Caller holds the account lock. */
async function materialiseLegacy(db: Db, account: AccountRecord): Promise<void> {
  await db.query(
    `INSERT INTO leaderboard_devices (user_id, device_key, name, name_public, stats, created_at, updated_at)
     SELECT $1, $2, '', false, $3::jsonb, $4, $5
      WHERE NOT EXISTS (SELECT 1 FROM leaderboard_devices WHERE user_id = $1)`,
    [account.user_id, LEGACY_DEVICE, JSON.stringify(accountStats(account)), account.created_at, account.updated_at],
  )
}

const UPDATE_TOTAL_SQL = `UPDATE leaderboard_entries SET
  period_from = $2, period_to = $3, sessions = $4, tokens = $5, usd = $6, active_days = $7, streak = $8,
  claude_tokens = $9, codex_tokens = $10, agents = $11::jsonb, fact = $12, payload_version = $13,
  cards = $14::jsonb, titles = $15::jsonb, ratios = $16::jsonb, device_count = $17
WHERE user_id = $1`

/** Recompute the account total from its device rows and write it to the account row. Caller holds the lock. */
async function writeTotal(db: Db, userId: string): Promise<AccountTotals> {
  const rows = await db.query<DeviceRow>(`SELECT ${DEVICE_COLUMNS} FROM leaderboard_devices WHERE user_id = $1`, [userId])
  const total = aggregate(rows.rows.map(toDevice).filter((d): d is DeviceRecord => d !== null))
  const s = total.stats
  await db.query(UPDATE_TOTAL_SQL, [
    userId, s.from, s.to, s.sessions, s.tokens, s.usd, s.activeDays, s.streak, total.scores.claudeTokens, total.scores.codexTokens,
    JSON.stringify(s.agents), s.fact, s.v === 1 ? 1 : 2, s.cards ? JSON.stringify(s.cards) : null, s.titles ? JSON.stringify(s.titles) : null,
    s.ratios ? JSON.stringify(s.ratios) : null, Math.min(MAX_DEVICES, Math.max(1, total.counted)),
  ])
  return total
}

export interface PublishChoices {
  /** Show this device's name on the public profile. */
  showDeviceName: boolean
  /** This v3 publish supersedes the account's pre-device ('legacy') entry: it is the same computer. */
  replaceLegacy: boolean
}

export type DevicePublish =
  | { result: "too_soon" }
  | { result: "device_cap" }
  | { result: "saved"; inserted: boolean; referred: boolean; duplicate: boolean; devices: number }

/**
 * Publish one device's payload. The caller runs this inside BEGIN and must ROLLBACK unless the result is "saved"
 * (a refused publish must leave nothing behind, including a legacy row made on the way).
 */
export async function publishDevice(db: Db, row: EntryRow, choices: PublishChoices): Promise<DevicePublish> {
  const account = await lockAccount(db, row.userId)
  if (account) await materialiseLegacy(db, account)
  // The account upsert: handle, display name, photo, referral credit and the 30-second limit (lib/entry-sql.ts).
  const saved = (await db.query<{ inserted: boolean; referred: boolean }>(SAVE_ENTRY_SQL, saveEntryParams(row))).rows[0]
  if (!saved) return { result: "too_soon" }

  const key = row.stats.device?.id ?? LEGACY_DEVICE
  if (choices.replaceLegacy && key !== LEGACY_DEVICE) await db.query("DELETE FROM leaderboard_devices WHERE user_id = $1 AND device_key = $2", [row.userId, LEGACY_DEVICE])
  const others = await db.query<{ n: string; mine: boolean }>(
    "SELECT count(*) FILTER (WHERE device_key <> $2) AS n, bool_or(device_key = $2) AS mine FROM leaderboard_devices WHERE user_id = $1",
    [row.userId, key],
  )
  const known = others.rows[0]?.mine === true
  if (!known && Number(others.rows[0]?.n ?? 0) >= MAX_DEVICES) return { result: "device_cap" }

  // A republish from the same computer replaces only its own row. An empty name keeps the one already stored, so a
  // rename on the site survives a later publish that typed no name.
  const name = row.stats.device?.name ?? ""
  await db.query(
    `INSERT INTO leaderboard_devices AS d (user_id, device_key, name, name_public, stats)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (user_id, device_key) DO UPDATE SET
       name = CASE WHEN EXCLUDED.name = '' THEN d.name ELSE EXCLUDED.name END,
       name_public = EXCLUDED.name_public, stats = EXCLUDED.stats, updated_at = now()`,
    [row.userId, key, name, choices.showDeviceName, JSON.stringify(row.stats)],
  )
  const total = await writeTotal(db, row.userId)
  const duplicate = total.duplicates.some((d) => d.key === key || d.of === key)
  return { result: "saved", inserted: saved.inserted, referred: saved.referred, duplicate, devices: total.counted }
}


/** Remove one device and recompute the total. The last device cannot be removed: "remove everything" does that. */
export async function removeDevice(db: Db, userId: string, key: string): Promise<DeviceChange> {
  const account = await lockAccount(db, userId)
  if (!account) return "no_entry"
  await materialiseLegacy(db, account)
  const rows = await db.query<{ device_key: string }>("SELECT device_key FROM leaderboard_devices WHERE user_id = $1", [userId])
  if (!rows.rows.some((r) => r.device_key === key)) return "not_found"
  if (rows.rows.length <= 1) return "last_device"
  await db.query("DELETE FROM leaderboard_devices WHERE user_id = $1 AND device_key = $2", [userId, key])
  await writeTotal(db, userId)
  return "ok"
}

/** Rename a device and choose whether its name is public. Names do not change the total. */
export async function renameDevice(db: Db, userId: string, key: string, name: string, namePublic: boolean): Promise<DeviceChange> {
  const account = await lockAccount(db, userId)
  if (!account) return "no_entry"
  await materialiseLegacy(db, account)
  const result = await db.query("UPDATE leaderboard_devices SET name = $3, name_public = $4 WHERE user_id = $1 AND device_key = $2", [userId, key, cleanText(name, LIMITS.deviceName), namePublic])
  return result.rowCount === 1 ? "ok" : "not_found"
}

