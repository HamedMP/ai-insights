/**
 * Leaderboard rules shared by the route handlers, the pages and the package tests: public handle rules, the arenas
 * and how each scores an entry, and rank/percentile math. Pure TypeScript with relative imports only, so the root
 * Vitest suite can test it without the site's dependencies installed.
 */
import { cleanText, LIMITS, type SharedStats } from "./share.ts"

export const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

/** Handles that would read as the site speaking, or collide with routes people might expect to exist. */
export const RESERVED_HANDLES = new Set([
  "admin", "administrator", "api", "app", "about", "account", "auth", "blog", "clerk", "contact", "dashboard", "docs",
  "help", "home", "info", "leaderboard", "login", "logout", "me", "matrix", "matrix-os", "matrixos", "mod", "moderator",
  "new", "null", "official", "owner", "privacy", "root", "security", "settings", "share", "sign-in", "sign-out",
  "sign-up", "signin", "signup", "staff", "static", "support", "system", "team", "terms", "test", "u", "undefined",
  "user", "users", "www", "ai-insights", "aiinsights", "anthropic", "openai", "claude", "codex",
])

export type HandleProblem = "format" | "reserved"

/** Normalise and check a public handle. Lowercase only; no leading, trailing or doubled hyphens. */
export function checkHandle(input: unknown): { ok: true; handle: string } | { ok: false; problem: HandleProblem } {
  if (typeof input !== "string") return { ok: false, problem: "format" }
  const handle = input.trim().toLowerCase()
  if (!HANDLE.test(handle) || handle.includes("--")) return { ok: false, problem: "format" }
  if (RESERVED_HANDLES.has(handle)) return { ok: false, problem: "reserved" }
  return { ok: true, handle }
}

/** A best-effort handle suggestion from a Clerk username or name; the person can change it before publishing. */
export function suggestHandle(source: string | null | undefined): string {
  const base = (source ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "")
  const checked = checkHandle(base)
  return checked.ok ? checked.handle : ""
}

export const ARENAS = [
  { id: "tokens", title: "Most tokens", unit: "tokens" },
  { id: "spend", title: "Most spent", unit: "estimated spend" },
  { id: "claude-code", title: "Top Claude Code user", unit: "Claude Code tokens" },
  { id: "codex", title: "Top Codex user", unit: "Codex tokens" },
  { id: "streak", title: "Longest streak", unit: "days" },
] as const

export type ArenaId = (typeof ARENAS)[number]["id"]
export const isArena = (value: unknown): value is ArenaId => typeof value === "string" && ARENAS.some((a) => a.id === value)
export const arenaTitle = (id: ArenaId) => ARENAS.find((a) => a.id === id)!.title
/** Short label for share copy: "Top 1% in Codex". */
export const ARENA_SHORT: Record<ArenaId, string> = { tokens: "tokens", spend: "spend", "claude-code": "Claude Code", codex: "Codex", streak: "streaks" }

/** The row stored for a person: the validated payload's numbers plus the per-arena scores derived from them. */
export interface EntryScores {
  tokens: number
  usd: number | null
  claudeTokens: number
  codexTokens: number
  streak: number
}

/**
 * An agent's tokens are estimated as total tokens times that agent's share of sessions: the payload carries no
 * per-agent token split, so this is an approximation the leaderboard says out loud.
 */
export function agentTokens(stats: SharedStats, key: string): number {
  const share = stats.agents.filter((a) => a.k === key).reduce((sum, a) => sum + a.p, 0)
  return Math.round((stats.tokens * Math.min(100, share)) / 100)
}

export function scoresFor(stats: SharedStats): EntryScores {
  return { tokens: stats.tokens, usd: stats.usd, claudeTokens: agentTokens(stats, "claude-code"), codexTokens: agentTokens(stats, "codex"), streak: stats.streak }
}

/** Column holding each arena's score. Fixed strings, never built from input, so they are safe in SQL text. */
export const ARENA_COLUMN: Record<ArenaId, string> = { tokens: "tokens", spend: "usd", "claude-code": "claude_tokens", codex: "codex_tokens", streak: "streak" }

/** A person ranks in an arena only with a positive score there (no Codex use, no Codex rank). */
export function scoreIn(arena: ArenaId, s: EntryScores): number | null {
  const value = arena === "tokens" ? s.tokens : arena === "spend" ? s.usd : arena === "claude-code" ? s.claudeTokens : arena === "codex" ? s.codexTokens : s.streak
  return value !== null && value > 0 ? value : null
}

/**
 * Standard competition ranking: rank is 1 + the number of entries with a strictly higher score, so ties share a rank.
 * Percentile is the "top X%" figure: the share of ranked entries at or above this rank, rounded up, at least 1.
 */
export function rankAndPercentile(higher: number, total: number): { rank: number; total: number; topPercent: number } | null {
  if (!Number.isInteger(higher) || !Number.isInteger(total) || total < 1 || higher < 0 || higher >= total) return null
  const rank = higher + 1
  return { rank, total, topPercent: Math.max(1, Math.min(100, Math.ceil((rank / total) * 100))) }
}

export const PAGE_SIZE = 50
export const MAX_PAGE = 200

/** Page numbers come from the query string: anything odd falls back to page 1, and the page is capped. */
export function parsePage(value: unknown): number {
  const n = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 1
  return Math.min(MAX_PAGE, Math.max(1, n))
}

/** Display name shown publicly: the payload's own name if it has one, otherwise the handle. */
export const displayNameFor = (stats: SharedStats, handle: string) => cleanText(stats.name, LIMITS.name) || handle

/**
 * The table's sortable columns. Sorting by a column is choosing an arena: the five arenas above are presets over
 * the first five. Rank is computed for the active sort (competition ranking over people with a positive value), so
 * a person with no Codex use has no Codex rank and sits below everyone who has one.
 */
export const SORTS = [
  { id: "tokens", column: "tokens", label: "Tokens", short: "tokens", arena: "tokens" },
  { id: "spend", column: "usd", label: "Est. spend", short: "spend", arena: "spend" },
  { id: "claude-code", column: "claude_tokens", label: "Claude Code", short: "Claude Code", arena: "claude-code" },
  { id: "codex", column: "codex_tokens", label: "Codex", short: "Codex", arena: "codex" },
  { id: "streak", column: "streak", label: "Streak", short: "streak", arena: "streak" },
  { id: "active", column: "active_days", label: "Active days", short: "active days", arena: null },
  { id: "sessions", column: "sessions", label: "Sessions", short: "sessions", arena: null },
  { id: "devices", column: "device_count", label: "Devices", short: "devices", arena: null },
] as const satisfies ReadonlyArray<{ id: string; column: string; label: string; short: string; arena: ArenaId | null }>

export type SortId = (typeof SORTS)[number]["id"]
export const DEFAULT_SORT: SortId = "tokens"
export const isSort = (value: unknown): value is SortId => typeof value === "string" && SORTS.some((s) => s.id === value)
export const sortOf = (id: SortId) => SORTS.find((s) => s.id === id)!

type Query = Record<string, string | string[] | undefined>
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/**
 * The active sort from the query string: `?sort=` first, then the older `?arena=` links (profiles, posts and
 * bookmarks made before the table), then tokens. Anything unknown falls back rather than failing.
 */
export function parseSort(params: Query): SortId {
  const sort = first(params.sort)
  if (isSort(sort)) return sort
  const arena = first(params.arena)
  if (isArena(arena)) return arena
  return DEFAULT_SORT
}

/** A board URL: tokens on page 1 is the bare path, so the canonical link stays short. */
export function boardHref(base: string, sort: SortId, page = 1, hash = ""): string {
  const query = new URLSearchParams()
  if (sort !== DEFAULT_SORT) query.set("sort", sort)
  if (page > 1) query.set("page", String(Math.min(MAX_PAGE, Math.floor(page))))
  const qs = query.toString()
  return `${base}/leaderboard${qs ? `?${qs}` : ""}${hash}`
}

/** Pages a board of `rows` people spans, at least one and never past MAX_PAGE. */
export const pageCount = (rows: number) => Math.min(MAX_PAGE, Math.max(1, Math.ceil(Math.max(0, rows) / PAGE_SIZE)))

/** The page a 1-based position falls on, or null when it lies past the last page a visitor can open. */
export function pageOfPosition(position: number): number | null {
  if (!Number.isInteger(position) || position < 1) return null
  const page = Math.ceil(position / PAGE_SIZE)
  return page <= MAX_PAGE ? page : null
}

/**
 * Reference implementation of the table's rank column, which SQL computes with rank() (lib/board-sql.ts): values
 * in board order, best first; ties share a rank, and a missing or non-positive value has no rank.
 * scripts/check-board.mjs runs the real SQL and compares it to this.
 */
export function competitionRanks(values: Array<number | null>): Array<number | null> {
  return values.map((v) => (v !== null && v > 0 ? 1 + values.filter((o) => o !== null && o > v).length : null))
}

/** Width of an inline bar as a percentage of the top value: 0 for nothing, at least 2 so a small value still shows. */
export function barPercent(value: number | null, top: number | null): number {
  if (value === null || top === null || !(value > 0) || !(top > 0)) return 0
  return Math.max(2, Math.min(100, Math.round((value / top) * 1000) / 10))
}
