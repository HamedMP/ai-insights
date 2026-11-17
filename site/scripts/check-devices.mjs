// Runs the production device statements (lib/device-sql.ts) against a real database, inside one transaction that is
// always rolled back, with synthetic users only. It proves what lives in SQL: same-device republish replaces only
// that device, a new device adds one, the cap, the duplicate warning, the legacy entry, remove and rename, and that
// the account row's totals follow the devices.
// Run with: node --env-file-if-exists=.env.local scripts/check-devices.mjs
// If migration 005 is not applied yet, it is applied inside the same transaction and rolled back with everything else.
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { SAVE_ENTRY_SQL, saveEntryParams } from "../lib/entry-sql.ts"
import { devicesOf, publishDevice, removeDevice, renameDevice } from "../lib/device-sql.ts"
import { aggregate } from "../lib/devices.ts"
import { scoresFor } from "../lib/leaderboard.ts"

const MIGRATION = readFileSync(new URL("../db/migrations/005_leaderboard_devices.sql", import.meta.url), "utf8")

/** All checks, against `db` ({ query(text, params) } returning { rows, rowCount }), inside a transaction the caller rolls back. */
export async function runDeviceChecks(db) {
  const tag = randomBytes(3).toString("hex")
  const user = (n) => `zz_synthetic_${tag}_${n}`
  const handle = (n) => `zz-dev-${tag}-${n}`
  const hex = (c) => c.repeat(32)
  const bits = (offsets) => { const b = new Uint8Array(Math.ceil((Math.max(...offsets) + 1) / 8)); for (const d of offsets) b[d >> 3] |= 1 << (d & 7); return Buffer.from(b).toString("base64url") }
  const v3 = (id, over = {}, offsets = [0, 1, 2], from = "2026-03-01") => ({
    v: 3, name: "Synthetic", from, to: "2026-03-31", sessions: 100, tokens: 1000, usd: 10, activeDays: offsets.length, streak: offsets.length, agents: [{ k: "codex", p: 100 }], fact: "",
    cards: [{ k: "streak", b: `${offsets.length} days`, c: "in a row" }], titles: [], ratios: [{ k: "toolErrorRate", v: 0.1, n: 100 }],
    device: { id, name: "" }, days: { from, bits: bits(offsets) }, ...over,
  })
  const row = (n, stats) => ({ userId: user(n), handle: handle(n), displayName: "Synthetic", stats, ...scoresFor(stats), referrer: null, avatarUrl: null })
  const choices = { showDeviceName: false, replaceLegacy: false }
  const account = async (n) => (await db.query("SELECT sessions, tokens, active_days, streak, device_count, codex_tokens, payload_version FROM leaderboard_entries WHERE user_id = $1", [user(n)])).rows[0]
  const devices = async (n) => (await db.query("SELECT device_key, name, name_public, stats FROM leaderboard_devices WHERE user_id = $1 ORDER BY created_at, device_key", [user(n)])).rows
  const age = (n) => db.query("UPDATE leaderboard_entries SET updated_at = now() - interval '1 minute' WHERE user_id = $1", [user(n)])
  const savepoint = async (name, fn) => {
    await db.query(`SAVEPOINT ${name}`)
    const out = await fn()
    if (out.result !== "saved") await db.query(`ROLLBACK TO SAVEPOINT ${name}`)
    return out
  }

  const exists = (await db.query("SELECT to_regclass('leaderboard_devices') IS NOT NULL AS ok")).rows[0].ok
  if (!exists) await db.query(MIGRATION)

  // A first publish from a computer creates the account and its device.
  let out = await publishDevice(db, row("a", v3(hex("a"))), choices)
  assert.equal(out.result, "saved")
  assert.equal(out.inserted, true)
  assert.equal((await devices("a")).length, 1)
  assert.equal(Number((await account("a")).sessions), 100)

  // A second computer adds a device; the account row holds the sum and the union of active days.
  await age("a")
  out = await publishDevice(db, row("a", v3(hex("b"), { sessions: 50, tokens: 3000 }, [0, 1, 2, 3], "2026-03-03")), { ...choices, showDeviceName: true })
  assert.equal(out.devices, 2)
  let acc = await account("a")
  assert.deepEqual([Number(acc.sessions), Number(acc.tokens), acc.active_days, acc.streak, acc.device_count, Number(acc.codex_tokens), acc.payload_version], [150, 4000, 6, 6, 2, 4000, 2])

  // Republishing from the same computer replaces only that computer's row.
  await age("a")
  await publishDevice(db, row("a", v3(hex("b"), { sessions: 70, tokens: 3000, device: { id: hex("b"), name: "Home desktop" } }, [0, 1, 2, 3], "2026-03-03")), choices)
  const rows = await devices("a")
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.device_key === hex("b")).stats.sessions, 70)
  assert.equal(rows.find((r) => r.device_key === hex("b")).name, "Home desktop")
  assert.equal(rows.find((r) => r.device_key === hex("a")).stats.sessions, 100)
  assert.equal(Number((await account("a")).sessions), 170)

  // A republish with no typed name keeps the stored name.
  await age("a")
  await publishDevice(db, row("a", v3(hex("b"), { sessions: 70, tokens: 3000 }, [0, 1, 2, 3], "2026-03-03")), choices)
  assert.equal((await devices("a")).find((r) => r.device_key === hex("b")).name, "Home desktop")

  // The 30-second limit still holds per account, across computers.
  assert.equal((await savepoint("soon", () => publishDevice(db, row("a", v3(hex("c"))), choices))).result, "too_soon")

  // The same history from two computers (a synced home folder) is counted once and reported.
  await age("a")
  out = await publishDevice(db, row("a", v3(hex("c"), { sessions: 100, tokens: 1000 })), choices)
  assert.equal(out.duplicate, true)
  assert.equal(out.devices, 2)
  assert.equal(Number((await account("a")).sessions), 170, "a duplicate does not double the total")

  // Cap: ten devices, then an eleventh is refused and leaves nothing behind.
  for (let i = 3; i < 10; i += 1) {
    await age("a")
    assert.equal((await publishDevice(db, row("a", v3(hex(i.toString(16)), { sessions: 10 + i })), choices)).result, "saved")
  }
  assert.equal((await devices("a")).length, 10)
  await age("a")
  assert.equal((await savepoint("cap", () => publishDevice(db, row("a", v3(hex("e"), { sessions: 999 })), choices))).result, "device_cap")
  assert.equal((await devices("a")).length, 10)
  await age("a")
  assert.equal((await publishDevice(db, row("a", v3(hex("b"), { sessions: 71, tokens: 3000 }, [0, 1, 2, 3], "2026-03-03")), choices)).result, "saved", "a known device still republishes at the cap")

  // Remove one device: the total follows. Rename: the name and its public choice change, the total does not.
  assert.equal(await removeDevice(db, user("a"), hex("3")), "ok")
  assert.equal((await devices("a")).length, 9)
  assert.equal(await renameDevice(db, user("a"), hex("a"), "Work laptop", true), "ok")
  assert.deepEqual((await devices("a")).filter((r) => r.device_key === hex("a")).map((r) => [r.name, r.name_public]), [["Work laptop", true]])
  assert.equal(await renameDevice(db, user("a"), hex("f"), "x", false), "not_found")

  // A pre-device entry (inserted the way 0.4 did) keeps working: it reads as one legacy device without a write, and
  // becomes a legacy row on its first change. A v3 publish then adds a device beside it, or replaces it when asked.
  const legacy = { v: 2, name: "Old", from: "2026-01-01", to: "2026-01-31", sessions: 40, tokens: 500, usd: null, activeDays: 4, streak: 2, agents: [{ k: "codex", p: 100 }], fact: "", cards: [], titles: [], ratios: [{ k: "toolErrorRate", v: 0.2 }] }
  await db.query(SAVE_ENTRY_SQL, saveEntryParams(row("b", legacy)))
  const before = (await db.query("SELECT * FROM leaderboard_entries WHERE user_id = $1", [user("b")])).rows[0]
  assert.equal((await devices("b")).length, 0, "the migration adds no rows for existing entries")
  const accountRow = (await db.query("SELECT user_id, handle, display_name, to_char(period_from, 'YYYY-MM-DD') AS period_from, to_char(period_to, 'YYYY-MM-DD') AS period_to, sessions, tokens, usd, active_days, streak, agents, fact, payload_version, cards, avatar_url, titles, ratios, device_count, updated_at, created_at FROM leaderboard_entries WHERE user_id = $1", [user("b")])).rows[0]
  const read = await devicesOf(db, accountRow)
  assert.deepEqual(read.map((d) => d.key), ["legacy"])
  assert.equal(aggregate(read).stats.sessions, 40)
  assert.equal((await removeDevice(db, user("b"), "legacy")), "last_device")
  assert.equal((await devices("b")).length, 1, "the first change turns the entry into its legacy device")
  const after = (await db.query("SELECT * FROM leaderboard_entries WHERE user_id = $1", [user("b")])).rows[0]
  assert.deepEqual({ ...after }, { ...before }, "turning an entry into a legacy device does not change the entry")
  await age("b")
  out = await publishDevice(db, row("b", v3(hex("1"), { sessions: 60, tokens: 700 })), choices)
  assert.equal(out.devices, 2)
  assert.equal(Number((await account("b")).sessions), 100)
  await age("b")
  out = await publishDevice(db, row("b", v3(hex("1"), { sessions: 61, tokens: 700 })), { ...choices, replaceLegacy: true })
  assert.deepEqual((await devices("b")).map((r) => r.device_key), [hex("1")])
  assert.equal(Number((await account("b")).sessions), 61)

  // An old v1 link from another person still publishes, into their legacy device.
  const { cards: _c, titles: _t, ratios: _r, ...v1 } = legacy
  assert.equal((await publishDevice(db, row("c", { ...v1, v: 1 }), choices)).result, "saved")
  assert.deepEqual((await devices("c")).map((r) => r.device_key), ["legacy"])

  // The database refuses a hostile device key even if the app were bypassed. Removing everything cascades.
  await db.query("SAVEPOINT bad_key")
  await assert.rejects(db.query("INSERT INTO leaderboard_devices (user_id, device_key, stats) VALUES ($1, 'my-laptop.local', '{}')", [user("c")]), /check constraint/)
  await db.query("ROLLBACK TO SAVEPOINT bad_key")
  await db.query("DELETE FROM leaderboard_entries WHERE user_id = $1", [user("a")])
  assert.equal((await devices("a")).length, 0, "remove everything removes every device")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pg } = await import("pg")
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!url) {
    console.error("check-devices: DATABASE_URL is not set")
    process.exit(1)
  }
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  let failed = false
  try {
    await client.query("BEGIN")
    await runDeviceChecks(client)
    console.log("check-devices: all checks passed")
  } catch (error) {
    failed = true
    console.error("check-devices: FAILED", error instanceof Error ? error.message : error)
  } finally {
    await client.query("ROLLBACK").catch((error) => console.error("check-devices: rollback failed", error instanceof Error ? error.message : error))
  }
  const left = await client.query("SELECT count(*)::int AS n FROM leaderboard_entries WHERE user_id LIKE 'zz\\_synthetic\\_%'")
  const table = (await client.query("SELECT to_regclass('leaderboard_devices') IS NOT NULL AS ok")).rows[0].ok
  console.log(`check-devices: synthetic rows left after rollback: ${left.rows[0].n}; leaderboard_devices table present: ${table}`)
  await client.end()
  if (failed || left.rows[0].n !== 0) process.exit(1)
}
