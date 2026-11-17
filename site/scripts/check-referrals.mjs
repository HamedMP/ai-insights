// Runs the production publish statement (lib/entry-sql.ts) against the real database, inside one transaction that is
// always rolled back, with synthetic users only. It proves the rules that live in SQL: a referrer is credited on the
// first publish only, never changed by a republish, never an unknown handle; cards and the photo are stored and replaced.
// Run with: node --env-file-if-exists=.env.local scripts/check-referrals.mjs (needs migrations 002 and 003 applied).
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import pg from "pg"

import { SAVE_ENTRY_SQL, saveEntryParams } from "../lib/entry-sql.ts"

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error("check-referrals: DATABASE_URL is not set")
  process.exit(1)
}
const tag = randomBytes(3).toString("hex")
const id = (n) => `zz_synthetic_${tag}_${n}`
const handle = (n) => `zz-test-${tag}-${n}`
const stats = (over = {}) => ({ v: 2, name: "", from: "2026-01-01", to: "2026-01-31", sessions: 3, tokens: 1000, usd: null, activeDays: 2, streak: 1, agents: [{ k: "codex", p: 100 }], fact: "", cards: [{ k: "streak", b: "1 day", c: "in a row, Jan 2 to Jan 2" }], ...over })
const row = (n, referrer, over) => ({ userId: id(n), handle: handle(n), displayName: `Synthetic ${n}`, stats: stats(over), tokens: 1000, usd: null, claudeTokens: 0, codexTokens: 1000, streak: 1, referrer, avatarUrl: null })

const client = new pg.Client({ connectionString: url })
await client.connect()
const save = async (r) => (await client.query(SAVE_ENTRY_SQL, saveEntryParams(r))).rows[0] ?? null
const entry = async (n) => (await client.query("SELECT referred_by, referred_at, payload_version, cards, avatar_url FROM leaderboard_entries WHERE user_id = $1", [id(n)])).rows[0]
// Republishing within 30 seconds is refused by design; move the clock back for the synthetic row only.
const age = (n) => client.query("UPDATE leaderboard_entries SET updated_at = now() - interval '1 minute' WHERE user_id = $1", [id(n)])
let failed = false
try {
  await client.query("BEGIN")
  assert.deepEqual(await save(row("a", null)), { inserted: true, referred: false }, "a first publish without a referrer")

  assert.deepEqual(await save(row("b", handle("a"))), { inserted: true, referred: true }, "b is credited to a")
  assert.equal((await entry("b")).referred_by, id("a"))
  assert.ok((await entry("b")).referred_at instanceof Date)

  await client.query("INSERT INTO leaderboard_entries (user_id, handle, display_name, period_from, period_to, sessions, tokens, active_days, streak, claude_tokens, codex_tokens, agents, fact) VALUES ($1, $2, 'Synthetic c', '2026-01-01', '2026-01-02', 1, 1, 1, 1, 0, 0, '[]', '')", [id("c"), handle("c")])
  await age("b")
  assert.deepEqual(await save(row("b", handle("c"))), { inserted: false, referred: true }, "b republishes with another claim")
  assert.equal((await entry("b")).referred_by, id("a"), "a republish never changes the referrer")

  await age("a")
  assert.deepEqual(await save(row("a", handle("b"))), { inserted: false, referred: false }, "a republish never adds a referrer")

  assert.deepEqual(await save(row("d", handle("nobody"))), { inserted: true, referred: false }, "an unknown handle credits no one")
  assert.equal((await entry("d")).referred_by, null)

  assert.equal(await save(row("a", null)), null, "a second publish within 30 seconds is refused")

  assert.equal((await entry("b")).payload_version, 2)
  assert.deepEqual((await entry("b")).cards, [{ k: "streak", b: "1 day", c: "in a row, Jan 2 to Jan 2" }])
  await age("b")
  const { cards: _cards, ...v1 } = stats({ v: 1 })
  await save({ ...row("b", null), stats: v1 })
  assert.equal((await entry("b")).cards, null, "a v1 republish replaces the cards with none")
  assert.equal((await entry("b")).payload_version, 1)

  await age("b")
  await save({ ...row("b", null), avatarUrl: "https://img.clerk.com/synthetic" })
  assert.equal((await entry("b")).avatar_url, "https://img.clerk.com/synthetic", "a publish with the photo choice stores it")
  await age("b")
  await save(row("b", null))
  assert.equal((await entry("b")).avatar_url, null, "a republish without the choice clears it")
  await client.query("SAVEPOINT before_bad_avatar")
  await assert.rejects(save({ ...row("d", null), avatarUrl: "https://evil.example/p.png" }), /check constraint/, "the database refuses a photo off img.clerk.com")
  await client.query("ROLLBACK TO SAVEPOINT before_bad_avatar")

  const view = await client.query("SELECT referrer_handle, referred_handle, notified_at FROM referrals WHERE referrer_user_id = $1", [id("a")])
  assert.deepEqual(view.rows, [{ referrer_handle: handle("a"), referred_handle: handle("b"), notified_at: null }], "the referrals view lists the credit")

  await assert.rejects(client.query("UPDATE leaderboard_entries SET referred_by = user_id WHERE user_id = $1", [id("d")]), /check constraint/, "the database refuses a self-referral")
  console.log("check-referrals: all checks passed")
} catch (error) {
  failed = true
  console.error("check-referrals: FAILED", error instanceof Error ? error.message : error)
} finally {
  await client.query("ROLLBACK").catch((error) => console.error("check-referrals: rollback failed", error instanceof Error ? error.message : error))
  const left = await client.query("SELECT count(*)::int AS n FROM leaderboard_entries WHERE user_id LIKE $1", [`zz_synthetic_${tag}_%`])
  console.log(`check-referrals: synthetic rows left after rollback: ${left.rows[0].n}`)
  await client.end()
  if (failed || left.rows[0].n !== 0) process.exitCode = 1
}
