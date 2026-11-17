import { ARENA_SHORT, type ArenaId } from "./leaderboard.ts"
import { formatCompact, formatInt } from "./share.ts"
import { COMMAND, HASHTAG } from "./site.ts"

export function formatScore(arena: ArenaId, score: number): string {
  if (arena === "spend") return `$${formatInt(score)}`
  if (arena === "streak") return `${formatInt(score)} ${score === 1 ? "day" : "days"}`
  return formatCompact(score)
}

/** "Top 1% in Codex", or "#3 in Codex" when the rank reads better than a percentage (small boards). */
export function rankLabel(arena: ArenaId, rank: number, topPercent: number, total: number): string {
  return total < 20 ? `#${rank} of ${total} in ${ARENA_SHORT[arena]}` : `Top ${topPercent}% in ${ARENA_SHORT[arena]}`
}

export const rankPost = (label: string, profileUrl: string) => `${label} on the AI Insights leaderboard (self-reported). Find out yours: ${COMMAND}\n${profileUrl}\n${HASHTAG}`

/** The post a person's own profile share buttons prefill. */
export const profilePost = (profileUrl: string) => `My AI coding, recapped: sessions, tokens, streaks and my recap cards (self-reported). Find out yours: ${COMMAND}\n${profileUrl}\n${HASHTAG}`

export type BadgeTone = "gold" | "silver" | "bronze" | "hot" | "plain"
export interface Badge {
  arena: ArenaId
  label: string
  tone: BadgeTone
  rank: number
  topPercent: number
}

const ARENA_ORDER: ArenaId[] = ["tokens", "spend", "claude-code", "codex", "streak"]
const BADGE_TITLE: Record<ArenaId, string> = { tokens: "Most tokens", spend: "Most spent", "claude-code": "in Claude Code", codex: "in Codex", streak: "Longest streak" }

/**
 * Profile badges, best first: "#3 Most tokens" inside the top ten, "Top 4% in Codex" below it. Every arena the
 * person ranks in gets one; the first is the headline badge (also on the OG image).
 */
export function profileBadges(ranks: Partial<Record<ArenaId, { rank: number; total: number; topPercent: number }>>): Badge[] {
  const out: Badge[] = []
  for (const [arena, r] of Object.entries(ranks) as Array<[ArenaId, { rank: number; total: number; topPercent: number }]>) {
    if (!r) continue
    const label = r.rank <= 10 ? `#${r.rank} ${BADGE_TITLE[arena]}` : `Top ${r.topPercent}% in ${ARENA_SHORT[arena]}`
    const tone: BadgeTone = r.rank === 1 ? "gold" : r.rank === 2 ? "silver" : r.rank === 3 ? "bronze" : r.topPercent <= 10 ? "hot" : "plain"
    out.push({ arena, label, tone, rank: r.rank, topPercent: r.topPercent })
  }
  const weight = (b: Badge) => (b.rank <= 10 ? b.rank : 10 + b.topPercent)
  return out.sort((a, b) => weight(a) - weight(b) || ARENA_ORDER.indexOf(a.arena) - ARENA_ORDER.indexOf(b.arena))
}
