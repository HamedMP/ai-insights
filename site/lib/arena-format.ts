import { ARENA_SHORT, type ArenaId, type SortId } from "./leaderboard.ts"
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

export interface Standing {
  arena: ArenaId
  /** The compact chip: "#2 tokens" near the top or on a small board, "top 34% Codex" further down. */
  chip: string
  /** The sentence a share prefills: rankLabel's wording. */
  label: string
  rank: number
  topPercent: number
}

/** The signed-in person's rank in every arena they score in, best standing first (the order profile badges use). */
export function standings(ranks: Partial<Record<ArenaId, { rank: number; total: number; topPercent: number }>>): Standing[] {
  const out: Standing[] = []
  for (const arena of ARENA_ORDER) {
    const r = ranks[arena]
    if (!r) continue
    const chip = r.rank <= 10 || r.total < 20 ? `#${r.rank} ${ARENA_SHORT[arena]}` : `top ${r.topPercent}% ${ARENA_SHORT[arena]}`
    out.push({ arena, chip, label: rankLabel(arena, r.rank, r.topPercent, r.total), rank: r.rank, topPercent: r.topPercent })
  }
  const weight = (s: Standing) => (s.rank <= 10 ? s.rank : 10 + s.topPercent)
  return out.sort((a, b) => weight(a) - weight(b) || ARENA_ORDER.indexOf(a.arena) - ARENA_ORDER.indexOf(b.arena))
}

const SHORT_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

/** A period for a narrow column: "Sep 1 – Nov 10" within one year, "Dec 3 ’25 – Jan 9 ’26" across years. */
export function shortPeriod(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00Z`)
  const t = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return ""
  if (f.getUTCFullYear() === t.getUTCFullYear()) return `${SHORT_DAY.format(f)} – ${SHORT_DAY.format(t)}`
  const withYear = (d: Date) => `${SHORT_DAY.format(d)} ’${String(d.getUTCFullYear() % 100).padStart(2, "0")}`
  return `${withYear(f)} – ${withYear(t)}`
}

/** What a table row holds for each column. */
export interface MetricSource {
  tokens: number
  usd: number | null
  claudeTokens: number
  codexTokens: number
  streak: number
  activeDays: number
  sessions: number
  deviceCount: number
}

/** A row's value under a sort; null when there is nothing to show (no spend estimate, an agent never used). */
export function metricValue(sort: SortId, m: MetricSource): number | null {
  const v = sort === "tokens" ? m.tokens : sort === "spend" ? m.usd : sort === "claude-code" ? m.claudeTokens : sort === "codex" ? m.codexTokens : sort === "streak" ? m.streak : sort === "active" ? m.activeDays : sort === "sessions" ? m.sessions : m.deviceCount
  if (v === null || !Number.isFinite(v)) return null
  if ((sort === "spend" || sort === "claude-code" || sort === "codex") && v <= 0) return null
  return v
}

/** A table cell: compact tokens, whole dollars, "12d" streaks, plain counts; an em dash for nothing. */
export function formatMetric(sort: SortId, value: number | null): string {
  if (value === null) return "—"
  if (sort === "tokens" || sort === "claude-code" || sort === "codex") return formatCompact(value)
  if (sort === "spend") return `$${formatInt(value)}`
  if (sort === "streak") return `${formatInt(value)}d`
  return formatInt(value)
}
