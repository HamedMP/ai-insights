// Runs the leaderboard table's production SQL (lib/board-sql.ts) against a real database, inside one transaction that
// is always rolled back, with synthetic users only. It proves what lives in SQL: rank() gives ties one rank and agrees
// with competitionRanks for every sort, a missing or zero value is unranked and listed last, pages are capped and
// disjoint, "jump to me" finds the right position, and the photo switch stores and clears only the avatar.
// Run with: node --env-file-if-exists=.env.local scripts/check-board.mjs
// The checks only see synthetic rows: they run against an empty copy of the table inside the transaction.
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

import { pageParams, pageSql, positionSql, SET_AVATAR_SQL, summarySql } from "../lib/board-sql.ts"
import { competitionRanks, PAGE_SIZE, SORTS, sortOf } from "../lib/leaderboard.ts"

/** All checks, against `db` ({ query(text, params) }), inside a transaction the caller rolls back. */
export async function runBoardChecks(db) {
  // Hide every real row from these checks: a temporary table of the same shape shadows the real one for this
  // transaction only (pg_temp comes first on the search path), so nothing real is read, ranked or changed.
  await db.query("CREATE TEMP TABLE leaderboard_entries (LIKE public.leaderboard_entries INCLUDING ALL) ON COMMIT DROP")
  const tag = randomBytes(3).toString("hex")
  const people = [
    // handle, tokens, usd, claude, codex, streak, active, sessions, devices, minutes ago
    ["a", 900, 30, 600, 300, 5, 10, 40, 1, 50],
    ["b", 500, null, 500, 0, 9, 12, 41, 3, 40],
    ["c", 500, 30, 0, 500, 9, 12, 7, 1, 30],
    ["d", 100, 0, 100, 0, 0, 1, 2, 1, 20],
    ["e", 0, null, 0, 0, 0, 0, 0, 1, 10],
  ]
  for (const [h, tokens, usd, claude, codex, streak, active, sessions, devices, ago] of people) {
    await db.query(
      `INSERT INTO leaderboard_entries (user_id, handle, display_name, period_from, period_to, sessions, tokens, usd, active_days, streak,
         claude_tokens, codex_tokens, agents, fact, device_count, created_at, updated_at)
       VALUES ($1, $2, 'Synthetic', '2026-09-01', '2026-11-01', $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, '', $10, now(), now() - make_interval(mins => $11))`,
      [`zz_synthetic_${tag}_${h}`, `zz-${tag}-${h}`, sessions, tokens, usd, active, streak, claude, codex, devices, ago],
    )
  }
  const key = { tokens: 1, spend: 2, "claude-code": 3, codex: 4, streak: 5, active: 6, sessions: 7, devices: 8 }
  for (const sort of SORTS) {
    const rows = (await db.query(pageSql(sort.id), pageParams(1))).rows
    assert.equal(rows.length, people.length, `${sort.id}: everyone is on the board`)
    const values = rows.map((r) => {
      const person = people.find((p) => r.handle.endsWith(`-${p[0]}`))
      return person[key[sort.id]]
    })
    const ranks = rows.map((r) => (r.rank === null ? null : Number(r.rank)))
    assert.deepEqual(ranks, competitionRanks(values), `${sort.id}: SQL ranks match competition ranking`)
    // Ranked people come first, best first; the unranked are last.
    const firstUnranked = ranks.indexOf(null)
    if (firstUnranked >= 0) assert.ok(ranks.slice(firstUnranked).every((r) => r === null), `${sort.id}: unranked listed last`)
    const summary = (await db.query(summarySql(sort.id))).rows[0]
    assert.equal(Number(summary.n), people.length, `${sort.id}: total counts everyone`)
    assert.equal(Number(summary.ranked), values.filter((v) => v !== null && v > 0).length, `${sort.id}: ranked counts positives`)
    assert.equal(Number(summary.top), Math.max(...values.filter((v) => v !== null)), `${sort.id}: top is the best value`)
    for (const [i, r] of rows.entries()) {
      const pos = (await db.query(positionSql(sort.id), [r.user_id])).rows[0]
      assert.equal(Number(pos.pos), i + 1, `${sort.id}: position of ${r.handle}`)
      assert.equal(pos.rank === null ? null : Number(pos.rank), ranks[i], `${sort.id}: position rank of ${r.handle}`)
    }
  }
  // Ties: b and c both have 500 tokens; b published earlier (40 minutes ago), so b is listed first, both rank 2.
  const byTokens = (await db.query(pageSql("tokens"), pageParams(1))).rows.map((r) => [r.handle.slice(-1), r.rank === null ? null : Number(r.rank)])
  assert.deepEqual(byTokens, [["a", 1], ["b", 2], ["c", 2], ["d", 4], ["e", null]], "ties share a rank, earlier publish first")
  // A missing spend sorts after every real one even though Postgres puts NULLs first in DESC by default.
  const bySpend = (await db.query(pageSql("spend"), pageParams(1))).rows.map((r) => r.handle.slice(-1))
  assert.deepEqual(bySpend.slice(0, 2).sort(), ["a", "c"], "spend: real values first")
  assert.equal(sortOf("spend").column, "usd")

  // Pages: capped at PAGE_SIZE and disjoint.
  for (let i = 0; i < PAGE_SIZE + 3; i += 1) {
    await db.query(
      `INSERT INTO leaderboard_entries (user_id, handle, display_name, period_from, period_to, sessions, tokens, usd, active_days, streak, claude_tokens, codex_tokens, agents, fact)
       VALUES ($1, $2, 'Synthetic', '2026-09-01', '2026-11-01', 1, $3, NULL, 1, 1, 0, 0, '[]'::jsonb, '')`,
      [`zz_synthetic_${tag}_p${i}`, `zz-${tag}-p${i}`, 1000 + i],
    )
  }
  const one = (await db.query(pageSql("tokens"), pageParams(1))).rows.map((r) => r.handle)
  const two = (await db.query(pageSql("tokens"), pageParams(2))).rows.map((r) => r.handle)
  assert.equal(one.length, PAGE_SIZE, "page 1 is capped")
  assert.equal(two.length, people.length + 3, "page 2 holds the rest")
  assert.equal(one.filter((h) => two.includes(h)).length, 0, "pages do not overlap")

  // Photo switch: stores a Clerk URL, clears it, touches nothing else; a non-Clerk URL is refused by the column CHECK.
  const who = `zz_synthetic_${tag}_a`
  const before = (await db.query("SELECT updated_at, tokens FROM leaderboard_entries WHERE user_id = $1", [who])).rows[0]
  assert.equal((await db.query(SET_AVATAR_SQL, [who, "https://img.clerk.com/synthetic"])).rowCount, 1)
  const on = (await db.query("SELECT avatar_url, updated_at, tokens FROM leaderboard_entries WHERE user_id = $1", [who])).rows[0]
  assert.equal(on.avatar_url, "https://img.clerk.com/synthetic")
  assert.equal(new Date(on.updated_at).getTime(), new Date(before.updated_at).getTime(), "the switch leaves updated_at alone")
  assert.equal(String(on.tokens), String(before.tokens))
  await db.query(SET_AVATAR_SQL, [who, null])
  assert.equal((await db.query("SELECT avatar_url FROM leaderboard_entries WHERE user_id = $1", [who])).rows[0].avatar_url, null, "off clears it")
  assert.equal((await db.query(SET_AVATAR_SQL, ["zz_synthetic_nobody", null])).rowCount, 0, "no entry: nothing changes")
  await db.query("SAVEPOINT bad_url")
  await assert.rejects(db.query(SET_AVATAR_SQL, [who, "https://evil.example/x.png"]), "the column refuses other hosts")
  await db.query("ROLLBACK TO SAVEPOINT bad_url")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pg } = await import("pg")
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!url) {
    console.error("check-board: DATABASE_URL is not set")
    process.exit(1)
  }
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  let failed = false
  try {
    await client.query("BEGIN")
    await runBoardChecks(client)
    console.log("check-board: all checks passed")
  } catch (error) {
    failed = true
    console.error("check-board: FAILED", error instanceof Error ? error.message : error)
  } finally {
    await client.query("ROLLBACK").catch((error) => console.error("check-board: rollback failed", error instanceof Error ? error.message : error))
  }
  await client.end()
  if (failed) process.exit(1)
}
