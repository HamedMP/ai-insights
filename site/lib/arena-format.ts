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
