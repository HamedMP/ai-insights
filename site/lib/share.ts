/**
 * Share links: the report puts a small versioned payload in the /share page's URL fragment
 * (src/render/client/sharelink.js builds it). The fragment is untrusted input: anyone can type one. This module
 * decodes it and accepts only the exact v1 or v2 shape, with every number clamped and every string capped and cleaned.
 * v2 adds the recap cards as data (a fixed key, a headline and a caption); v1 links from older reports keep working.
 * Pure TypeScript with no imports, so the package tests can prove it agrees with the report-side encoder, and the
 * signed-in leaderboard validates the same payload on the server.
 */

export const SHARE_VERSION = 2
export const LIMITS = { name: 40, fact: 120, agents: 8, sessions: 1e7, tokens: 1e13, usd: 1e7, days: 3660, cards: 16, big: 32, caption: 80, fragment: 4096 } as const

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
}

const KEYS_V1 = ["v", "name", "from", "to", "sessions", "tokens", "usd", "activeDays", "streak", "agents", "fact"]
const KEYS_V2 = [...KEYS_V1, "cards"]
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
  if (raw.v === 2) {
    cards = validateCards(raw.cards)
    if (!cards) return null
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
  if (cards) out.cards = cards
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
