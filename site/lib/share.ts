/**
 * Share links: the report puts a small versioned payload in the /share page's URL fragment
 * (src/render/client/sharelink.js builds it). The fragment is untrusted input: anyone can type one. This module
 * decodes it and accepts only the exact v1 or v2 shape, with every number clamped and every string capped and cleaned.
 * v2 adds the recap cards as data (a fixed key, a headline and a caption); v1 links from older reports keep working.
 * Pure TypeScript with no imports, so the package tests can prove it agrees with the report-side encoder, and the
 * signed-in leaderboard validates the same payload on the server.
 */

export const SHARE_VERSION = 2
export const LIMITS = { name: 40, fact: 120, agents: 8, sessions: 1e7, tokens: 1e13, usd: 1e7, days: 3660, cards: 16, big: 32, caption: 80, titles: 3, ratio: 1000, fragment: 4096 } as const

export interface SharedAgent {
  /** Harness key, e.g. "claude-code". */
  k: string
  /** Share of sessions, whole percent 0-100. */
  p: number
}

/** The card titles, keyed by the only card keys a payload may carry. Same table as sharelink.js TITLES. */
export const CARD_TITLES = {
  persona: "Persona",
  parallel: "Most agents at once",
  tokens: "Tokens processed",
  streak: "Longest streak",
  marathon: "Longest session",
  clock: "When they prompt",
  manners: "Manners check",
  danger: "Danger zone",
  hours: "Time with agents",
  model: "Top model",
  weekday: "Favourite day",
  tests: "Test runs",
  shell: "Bash hall of fame",
  failures: "Where things broke",
  words: "Words typed",
  slash: "Slash commands",
  thinking: "Deep thoughts",
  approvals: "Rubber stamp",
  history: "History kept",
} as const
export type CardKey = keyof typeof CARD_TITLES
export const CARD_KEYS = Object.keys(CARD_TITLES) as CardKey[]
const isCardKey = (value: unknown): value is CardKey => typeof value === "string" && Object.prototype.hasOwnProperty.call(CARD_TITLES, value)

export interface SharedCard {
  k: CardKey
  /** The headline: a number with its unit, or a fixed label ("Night owl"). */
  b: string
  /** One short line under it, made from numbers and fixed words. May be empty. */
  c: string
}

/**
 * The five work ratios (src/analysis/ratios.ts). Labels and number formats are fixed here; only the value travels.
 * Shares are 0..1; corrections are per session; parallelism is a multiple.
 */
export const RATIOS = {
  correctionsPerSession: { label: "Mid-run corrections", unit: "per_session" },
  contextResetShare: { label: "Sessions with a context reset", unit: "share" },
  toolErrorRate: { label: "Tool-call error rate", unit: "share" },
  planFirstShare: { label: "Started with a plan", unit: "share" },
  parallelism: { label: "Sessions at once", unit: "times" },
} as const
export type RatioKey = keyof typeof RATIOS
export const RATIO_KEYS = Object.keys(RATIOS) as RatioKey[]
const isRatioKey = (value: unknown): value is RatioKey => typeof value === "string" && Object.prototype.hasOwnProperty.call(RATIOS, value)

/** Same format as the report's ratio tiles (src/render/view.ts ratioText). */
export function ratioText(key: RatioKey, value: number): string {
  const unit = RATIOS[key].unit
  if (unit === "share") return `${value > 0 && value < 0.01 ? "<1" : Math.round(value * 100)}%`
  if (unit === "times") return `${value.toFixed(1)}×`
  return value.toFixed(2)
}

const pctText = (v: number) => `${Math.round(v * 100)}%`
const twoText = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const oneText = (v: number) => (Math.round(v * 10) / 10).toFixed(1)

/**
 * Earned titles: the same fixed wording and rules as src/analysis/recap/titles.ts TITLE_RULES (a test keeps them
 * equal). A payload carries only the key and the ratio's value; the title and the rule sentence are made here, and
 * a title whose value does not meet its own rule is rejected.
 */
export const EARNED_TITLES = {
  clear_briefer: { title: "The Clear Briefer", ratio: "correctionsPerSession", earns: (v: number) => v <= 0.1, rule: (v: number) => `${twoText(v)} mid-run corrections per session (0.10 or fewer earns it)` },
  hands_on_pilot: { title: "The Hands-On Pilot", ratio: "correctionsPerSession", earns: (v: number) => v >= 1, rule: (v: number) => `${twoText(v)} mid-run corrections per session (1 or more earns it)` },
  architect: { title: "The Architect", ratio: "planFirstShare", earns: (v: number) => v >= 0.5, rule: (v: number) => `${pctText(v)} of sessions that edited files started with a plan (half or more earns it)` },
  improviser: { title: "The Improviser", ratio: "planFirstShare", earns: (v: number) => v <= 0.1, rule: (v: number) => `${pctText(v)} of sessions that edited files started with a plan (10% or fewer earns it)` },
  conductor: { title: "The Conductor", ratio: "parallelism", earns: (v: number) => v >= 2, rule: (v: number) => `${oneText(v)} sessions running at once on average (2 or more earns it)` },
  deep_focuser: { title: "The Deep Focuser", ratio: "parallelism", earns: (v: number) => v <= 1.1, rule: (v: number) => `${oneText(v)} sessions running at once on average (1.1 or fewer earns it)` },
  context_keeper: { title: "The Context Keeper", ratio: "contextResetShare", earns: (v: number) => v <= 0.05, rule: (v: number) => `${pctText(v)} of sessions hit a context reset (5% or fewer earns it)` },
  deep_diver: { title: "The Deep Diver", ratio: "contextResetShare", earns: (v: number) => v >= 0.3, rule: (v: number) => `${pctText(v)} of sessions hit a context reset (30% or more earns it)` },
  smooth_operator: { title: "The Smooth Operator", ratio: "toolErrorRate", earns: (v: number) => v <= 0.03, rule: (v: number) => `${pctText(v)} of tool calls failed (3% or fewer earns it)` },
  stress_tester: { title: "The Stress Tester", ratio: "toolErrorRate", earns: (v: number) => v >= 0.15, rule: (v: number) => `${pctText(v)} of tool calls failed (15% or more earns it)` },
} as const satisfies Record<string, { title: string; ratio: RatioKey; earns: (v: number) => boolean; rule: (v: number) => string }>
export type TitleKey = keyof typeof EARNED_TITLES
const isTitleKey = (value: unknown): value is TitleKey => typeof value === "string" && Object.prototype.hasOwnProperty.call(EARNED_TITLES, value)

export interface SharedRatio {
  k: RatioKey
  v: number
}
export interface SharedTitle {
  k: TitleKey
  /** The value of the title's ratio that earned it. */
  v: number
}

export interface SharedStats {
  v: 1 | 2
  name: string
  from: string
  to: string
  sessions: number
  tokens: number
  usd: number | null
  activeDays: number
  streak: number
  agents: SharedAgent[]
  fact: string
  /** v2 only: the recap cards, at most LIMITS.cards, each key at most once. */
  cards?: SharedCard[]
  /** v2 only: titles earned from the ratios, at most LIMITS.titles. */
  titles?: SharedTitle[]
  /** v2 only: the work ratios that had a value. */
  ratios?: SharedRatio[]
}

const KEYS_V1 = ["v", "name", "from", "to", "sessions", "tokens", "usd", "activeDays", "streak", "agents", "fact"]
const KEYS_V2 = [...KEYS_V1, "cards", "titles", "ratios"]
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g
const AGENT_KEY = /^[a-z0-9-]{1,20}$/

export const AGENT_NAMES: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", pi: "Pi", opencode: "OpenCode", gemini: "Gemini CLI" }
export const agentName = (key: string) => AGENT_NAMES[key] ?? "Other agent"

/** Strip control and bidi characters, collapse whitespace, cap by code point. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return Array.from(value.slice(0, max * 4).replace(/\s+/g, " ").replace(UNSAFE, "").trim()).slice(0, max).join("")
}

const clampNum = (value: unknown, max: number): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : null)

function validDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

/** v2 cards: an array of exact {k, b, c} objects with known, unique keys. Anything else rejects the whole payload. */
function validateCards(input: unknown): SharedCard[] | null {
  if (!Array.isArray(input) || input.length > LIMITS.cards) return null
  const seen = new Set<string>()
  const out: SharedCard[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
    const card = entry as Record<string, unknown>
    const keys = Object.keys(card)
    if (keys.length !== 3 || !keys.includes("k") || !keys.includes("b") || !keys.includes("c")) return null
    if (!isCardKey(card.k) || seen.has(card.k) || typeof card.b !== "string" || typeof card.c !== "string") return null
    seen.add(card.k)
    const b = cleanText(card.b, LIMITS.big)
    if (!b) return null
    out.push({ k: card.k, b, c: cleanText(card.c, LIMITS.caption) })
  }
  return out
}

/** Clamp a ratio into its range: shares are 0..1, the others 0..LIMITS.ratio. Four decimals are plenty. */
function ratioValue(key: RatioKey, value: unknown): number | null {
  const max = RATIOS[key].unit === "share" ? 1 : LIMITS.ratio
  const v = clampNum(value, max)
  return v === null ? null : Math.round(v * 1e4) / 1e4
}

function exactPair(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
  const keys = Object.keys(entry)
  return keys.length === 2 && keys.includes("k") && keys.includes("v") ? (entry as Record<string, unknown>) : null
}

/** v2 ratios: exact {k, v} pairs, known unique keys, numbers clamped into range. */
function validateRatios(input: unknown): SharedRatio[] | null {
  if (!Array.isArray(input) || input.length > RATIO_KEYS.length) return null
  const out: SharedRatio[] = []
  for (const entry of input) {
    const pair = exactPair(entry)
    if (!pair || !isRatioKey(pair.k) || out.some((r) => r.k === pair.k)) return null
    const v = ratioValue(pair.k, pair.v)
    if (v === null) return null
    out.push({ k: pair.k, v })
  }
  return out
}

/**
 * v2 titles: known unique keys, at most one per ratio, each value equal to that ratio's published value and meeting
 * the title's own rule. A title is never shown without the number that earned it.
 */
function validateTitles(input: unknown, ratios: SharedRatio[]): SharedTitle[] | null {
  if (!Array.isArray(input) || input.length > LIMITS.titles) return null
  const out: SharedTitle[] = []
  for (const entry of input) {
    const pair = exactPair(entry)
    if (!pair || !isTitleKey(pair.k) || out.some((t) => t.k === pair.k)) return null
    const def = EARNED_TITLES[pair.k]
    if (out.some((t) => EARNED_TITLES[t.k].ratio === def.ratio)) return null
    const v = ratioValue(def.ratio, pair.v)
    const published = ratios.find((r) => r.k === def.ratio)
    if (v === null || !published || published.v !== v || !def.earns(v)) return null
    out.push({ k: pair.k, v })
  }
  return out
}

/** Titles and ratios read back from the database: re-validated, and dropped rather than failing the page. */
export function storedRatios(input: unknown): SharedRatio[] {
  return Array.isArray(input) ? (validateRatios(input.slice(0, RATIO_KEYS.length)) ?? []) : []
}
export function storedTitles(input: unknown, ratios: SharedRatio[]): SharedTitle[] {
  return Array.isArray(input) ? (validateTitles(input.slice(0, LIMITS.titles), ratios) ?? []) : []
}

/** Cards read back from the database: already validated on publish, so anything odd is dropped rather than failing the page. */
export function storedCards(input: unknown): SharedCard[] {
  if (!Array.isArray(input)) return []
  const out: SharedCard[] = []
  for (const entry of input.slice(0, LIMITS.cards)) {
    const one = validateCards([entry])
    if (one && one[0] && !out.some((c) => c.k === one[0]!.k)) out.push(one[0])
  }
  return out
}

/** The strict v1 and v2 schemas. Anything else (wrong version, extra keys, wrong types) is rejected, not repaired. */
export function validateStats(input: unknown): SharedStats | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  if (raw.v !== 1 && raw.v !== 2) return null
  const expected = raw.v === 1 ? KEYS_V1 : KEYS_V2
  const keys = Object.keys(raw)
  if (keys.length !== expected.length || !keys.every((k) => expected.includes(k))) return null
  if (typeof raw.name !== "string" || typeof raw.fact !== "string") return null
  const from = validDay(raw.from)
  const to = validDay(raw.to)
  if (!from || !to || from > to) return null
  const sessions = clampNum(raw.sessions, LIMITS.sessions)
  const tokens = clampNum(raw.tokens, LIMITS.tokens)
  const activeDays = clampNum(raw.activeDays, LIMITS.days)
  const streak = clampNum(raw.streak, LIMITS.days)
  if (sessions === null || tokens === null || activeDays === null || streak === null) return null
  let usd: number | null = null
  if (raw.usd !== null) {
    usd = clampNum(raw.usd, LIMITS.usd)
    if (usd === null) return null
  }
  if (!Array.isArray(raw.agents) || raw.agents.length > LIMITS.agents) return null
  const agents: SharedAgent[] = []
  for (const entry of raw.agents) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
    const a = entry as Record<string, unknown>
    if (Object.keys(a).length !== 2 || typeof a.k !== "string" || !AGENT_KEY.test(a.k)) return null
    const p = clampNum(a.p, 100)
    if (p === null) return null
    agents.push({ k: a.k, p: Math.round(p) })
  }
  let cards: SharedCard[] | null = null
  let ratios: SharedRatio[] | null = null
  let titles: SharedTitle[] | null = null
  if (raw.v === 2) {
    cards = validateCards(raw.cards)
    ratios = validateRatios(raw.ratios)
    titles = ratios && validateTitles(raw.titles, ratios)
    if (!cards || !ratios || !titles) return null
  }
  const out: SharedStats = {
    v: raw.v,
    name: cleanText(raw.name, LIMITS.name),
    from,
    to,
    sessions: Math.round(sessions),
    tokens: Math.round(tokens),
    usd: usd === null ? null : Math.round(usd * 100) / 100,
    activeDays: Math.round(activeDays),
    streak: Math.min(Math.round(streak), Math.round(activeDays)),
    agents,
    fact: cleanText(raw.fact, LIMITS.fact),
  }
  if (cards && titles && ratios) {
    out.cards = cards
    out.titles = titles
    out.ratios = ratios
  }
  return out
}

/** Decode a fragment (with or without the leading "#"). Returns null for anything that is not a valid v1 or v2 payload. */
export function decodeStats(fragment: string): SharedStats | null {
  const data = fragment.replace(/^#/, "")
  if (!data || data.length > LIMITS.fragment || !/^[A-Za-z0-9_-]+$/.test(data)) return null
  try {
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    return validateStats(json)
  } catch (error) {
    // A malformed link is expected input, not a fault: the page falls back to the generic card.
    if (error instanceof SyntaxError || error instanceof TypeError || (error instanceof Error && error.name === "InvalidCharacterError")) return null
    throw error
  }
}

export const formatInt = (n: number) => Math.round(n).toLocaleString("en-US")
export function formatCompact(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return formatInt(n)
}
export function formatPeriod(from: string, to: string): string {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  return `${f(from)} – ${f(to)}`
}
