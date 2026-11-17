/**
 * The leaderboard table's queries, in a module with only relative imports so scripts/check-board.mjs can run the exact
 * production SQL against a database and compare its ranks with competitionRanks (lib/leaderboard.ts).
 *
 * Board order for a sort column: people with a positive value first, best first (NULLS LAST keeps a missing spend
 * at the bottom), ties by who published first, then handle. rank() runs over that same order, so ties share a rank;
 * a missing or zero value has no rank. The column name comes from the fixed SORTS table, never from input.
 */
import { ACCOUNT_COLUMNS } from "./device-sql.ts"
import { PAGE_SIZE, sortOf, type SortId } from "./leaderboard.ts"

const order = (col: string) => `${col} DESC NULLS LAST, updated_at ASC, handle ASC`
const rankExpr = (col: string) => `CASE WHEN ${col} > 0 THEN rank() OVER (ORDER BY ${col} DESC NULLS LAST) END`

/** One page of the board ($1 limit, $2 offset), with the agent columns the account readers do not select. */
export function pageSql(sort: SortId): string {
  const col = sortOf(sort).column
  return `SELECT ${ACCOUNT_COLUMNS}, claude_tokens, codex_tokens, ${rankExpr(col)} AS rank
            FROM leaderboard_entries ORDER BY ${order(col)} LIMIT $1 OFFSET $2`
}

/** Everyone on the board, how many rank under this sort, and the top value the inline bars scale to. */
export function summarySql(sort: SortId): string {
  const col = sortOf(sort).column
  return `SELECT count(*) AS n, count(*) FILTER (WHERE ${col} > 0) AS ranked, max(${col}) AS top FROM leaderboard_entries`
}

/** One person's 1-based position in board order and their rank under this sort ($1: user id), for "jump to me". */
export function positionSql(sort: SortId): string {
  const col = sortOf(sort).column
  return `SELECT pos, rank FROM (
            SELECT user_id, row_number() OVER (ORDER BY ${order(col)}) AS pos, ${rankExpr(col)} AS rank FROM leaderboard_entries
          ) board WHERE user_id = $1`
}

export const pageParams = (page: number) => [PAGE_SIZE, (page - 1) * PAGE_SIZE]

/**
 * The photo switch: store or clear the account's photo without republishing. It leaves updated_at alone, so it
 * neither moves the person among ties nor trips the 30-second publish limit. The column's CHECK (migration 003)
 * still holds any stored URL to Clerk's image host.
 */
export const SET_AVATAR_SQL = "UPDATE leaderboard_entries SET avatar_url = $2 WHERE user_id = $1"
