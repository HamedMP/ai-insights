/**
 * Share links: the report puts a small versioned payload in the /share page's URL fragment
 * (src/render/client/sharelink.js builds it). The fragment is untrusted input: anyone can type one. This module
 * decodes it and accepts only the exact v1 shape, with every number clamped and every string capped and cleaned.
 * Pure TypeScript with no imports, so the package tests can prove it agrees with the report-side encoder, and a
 * later signed-in leaderboard can validate the same payload on a server.
 */

export const SHARE_VERSION = 1
export const LIMITS = { name: 40, fact: 120, agents: 8, sessions: 1e7, tokens: 1e13, usd: 1e7, days: 3660, fragment: 4096 } as const

export interface SharedAgent {
  /** Harness key, e.g. "claude-code". */
  k: string
  /** Share of sessions, whole percent 0-100. */
  p: number
}

export interface SharedStats {
  v: 1
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
}

const KEYS = ["v", "name", "from", "to", "sessions", "tokens", "usd", "activeDays", "streak", "agents", "fact"]
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

/** The strict v1 schema. Anything else (wrong version, extra keys, wrong types) is rejected, not repaired. */
export function validateStats(input: unknown): SharedStats | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const keys = Object.keys(raw)
  if (keys.length !== KEYS.length || !keys.every((k) => KEYS.includes(k))) return null
  if (raw.v !== SHARE_VERSION) return null
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
  return {
    v: 1,
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
}

/** Decode a fragment (with or without the leading "#"). Returns null for anything that is not a valid v1 payload. */
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
