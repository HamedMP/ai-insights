/**
 * One account, several computers. Each computer publishes its own validated payload (lib/share.ts) and keeps its own
 * row; this module adds the rows up into the account total the leaderboard ranks and the profile leads with.
 * Pure TypeScript with relative imports only, so the package tests and scripts/check-devices.mjs run it directly.
 *
 * What adds up: sessions, tokens, spend (the known amounts) and each agent's estimated tokens. Active days and the
 * longest streak do not add up: two computers can be busy on the same day. When every computer sent its active days
 * (v3 `days`) and they cover all of its active days, the total is the exact union; otherwise it is the larger of the
 * union and any one computer's figure, a lower bound the profile labels "at least". Ratios are recombined from the
 * counts they are out of (v3 `n`); a ratio a computer sent without its count is shown per computer only. Earned
 * titles are re-earned from the combined ratios with the same rules. Two computers with the same period, sessions and
 * tokens are taken to be one history published twice (a synced home folder) and counted once.
 */
import { agentTokens, type EntryScores } from "./leaderboard.ts"
import {
  activeDayNumbers,
  CARD_KEYS,
  cleanText,
  dayString,
  EARNED_TITLES,
  formatCompact,
  formatInt,
  LIMITS,
  longestRun,
  RATIO_KEYS,
  type CardKey,
  type RatioKey,
  type SharedAgent,
  type SharedCard,
  type SharedRatio,
  type SharedStats,
  type SharedTitle,
  type TitleKey,
} from "./share.ts"

export const MAX_DEVICES = 10
/** The device an entry published before 0.5 (a v1 or v2 link, no device id) belongs to. */
export const LEGACY_DEVICE = "legacy"
export const DEVICE_KEY = /^(?:legacy|[0-9a-f]{32})$/

export interface DeviceRecord {
  /** The payload's device id, or LEGACY_DEVICE. Never shown publicly. */
  key: string
  /** What the owner called it; may be empty. */
  name: string
  /** The owner chose to show the name on the public profile. */
  namePublic: boolean
  stats: SharedStats
  createdAt: string
  updatedAt: string
}

export interface Highlight {
  card: SharedCard
  /** The device key the card came from, or null when it was rebuilt from the account total. */
  from: string | null
}

export interface AccountTotals {
  /** The account total in the v1/v2 shape the account row stores: no device, no days, ratios without counts. */
  stats: SharedStats
  scores: EntryScores
  /** Devices that count toward the total (duplicates excluded). */
  counted: number
  /** Active days and streak are exact; false means they are lower bounds. */
  exactDays: boolean
  /** The combined streak's dates, when they are known exactly. */
  streakRange: { start: string; end: string } | null
  /** A device whose numbers match another's exactly: counted once, as `of`. */
  duplicates: Array<{ key: string; of: string }>
  highlights: Highlight[]
  /** Ratios some device sent without the count behind them: shown per device, not combined. */
  perDeviceRatios: RatioKey[]
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const dshort = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`
const r4 = (n: number) => Math.round(n * 1e4) / 1e4

/** Public label: the name only if the owner chose to show it, otherwise "Device n". The owner always sees the name. */
export function deviceLabel(device: Pick<DeviceRecord, "name" | "namePublic">, index: number, audience: "public" | "owner"): string {
  const name = cleanText(device.name, LIMITS.deviceName)
  return name && (audience === "owner" || device.namePublic) ? name : `Device ${index + 1}`
}

/** Devices in a stable order: first published first. Labels ("Device 1") follow this order. */
export function ordered(devices: DeviceRecord[]): DeviceRecord[] {
  return [...devices].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * One device's stats as a visitor may receive them: its numbers and cards, never its device id, its private name or
 * its day bitmap. Everything a public page passes to the browser goes through this.
 */
export function publicDeviceStats(s: SharedStats): SharedStats {
  const { device: _device, days: _days, ...rest } = s
  return rest
}

/** The account-row shape of one device's stats: v1 or v2, ratios without their counts. */
function accountShape(s: SharedStats): SharedStats {
  const base: SharedStats = { v: 1, name: s.name, from: s.from, to: s.to, sessions: s.sessions, tokens: s.tokens, usd: s.usd, activeDays: s.activeDays, streak: s.streak, agents: s.agents, fact: s.fact }
  if (s.v === 1) return base
  return { ...base, v: 2, cards: s.cards ?? [], titles: s.titles ?? [], ratios: (s.ratios ?? []).map(({ k, v }) => ({ k, v })) }
}

const fingerprint = (s: SharedStats) => `${s.from}|${s.to}|${s.sessions}|${s.tokens}`

/** Split devices into the ones that count and exact duplicates of them (same period, sessions and tokens). */
function dedupe(devices: DeviceRecord[]): { counted: DeviceRecord[]; duplicates: Array<{ key: string; of: string }> } {
  const latest = new Map<string, DeviceRecord>()
  for (const d of devices) {
    if (d.stats.sessions <= 0) continue
    const fp = fingerprint(d.stats)
    const seen = latest.get(fp)
    if (!seen || d.updatedAt > seen.updatedAt) latest.set(fp, d)
  }
  const duplicates: Array<{ key: string; of: string }> = []
  const counted = devices.filter((d) => {
    const keep = d.stats.sessions <= 0 ? undefined : latest.get(fingerprint(d.stats))
    if (keep && keep !== d) {
      duplicates.push({ key: d.key, of: keep.key })
      return false
    }
    return true
  })
  return { counted, duplicates }
}

function combineAgents(devices: DeviceRecord[]): SharedAgent[] {
  const total = devices.reduce((sum, d) => sum + d.stats.sessions, 0)
  if (total <= 0) return []
  const weight = new Map<string, number>()
  for (const d of devices) for (const a of d.stats.agents) weight.set(a.k, (weight.get(a.k) ?? 0) + a.p * d.stats.sessions)
  return [...weight]
    .map(([k, w]) => ({ k, p: Math.round(w / total) }))
    .filter((a) => a.p > 0)
    .sort((a, b) => b.p - a.p || (a.k < b.k ? -1 : 1))
    .slice(0, LIMITS.agents)
}

function combineDays(devices: DeviceRecord[]): { activeDays: number; streak: number; exact: boolean; range: { start: string; end: string } | null } {
  const union = new Set<number>()
  let exact = true
  for (const d of devices) {
    const marked = d.stats.days ? activeDayNumbers(d.stats.days) : null
    if (!marked || marked.length !== d.stats.activeDays) exact = false
    for (const n of marked ?? []) union.add(n)
  }
  const sorted = [...union].sort((a, b) => a - b)
  const run = longestRun(sorted)
  const maxDays = Math.max(0, ...devices.map((d) => d.stats.activeDays))
  const maxStreak = Math.max(0, ...devices.map((d) => d.stats.streak))
  const activeDays = Math.min(LIMITS.days, exact ? sorted.length : Math.max(sorted.length, maxDays))
  const streak = Math.min(activeDays, exact ? run.days : Math.max(run.days, maxStreak))
  const range = run.end !== null && run.days === streak ? { start: dayString(run.end - run.days + 1), end: dayString(run.end) } : null
  return { activeDays, streak, exact, range }
}

function combineRatios(devices: DeviceRecord[]): { ratios: SharedRatio[]; perDevice: RatioKey[] } {
  const ratios: SharedRatio[] = []
  const perDevice: RatioKey[] = []
  for (const k of RATIO_KEYS) {
    const entries = devices.map((d) => d.stats.ratios?.find((r) => r.k === k)).filter((r): r is SharedRatio => Boolean(r))
    if (!entries.length) continue
    if (entries.some((r) => typeof r.n !== "number")) {
      perDevice.push(k)
      continue
    }
    const base = entries.reduce((sum, r) => sum + (r.n ?? 0), 0)
    if (base <= 0) continue
    const v = entries.reduce((sum, r) => sum + r.v * (r.n ?? 0), 0) / base
    ratios.push({ k, v: r4(Math.min(k === "parallelism" || k === "correctionsPerSession" ? LIMITS.ratio : 1, Math.max(0, v))) })
  }
  return { ratios, perDevice }
}

/** Titles re-earned from the combined ratios with the report's own rules, at most one per ratio and three in all. */
function earnTitles(ratios: SharedRatio[]): SharedTitle[] {
  const out: SharedTitle[] = []
  for (const r of ratios) {
    const key = (Object.keys(EARNED_TITLES) as TitleKey[]).find((t) => EARNED_TITLES[t].ratio === r.k && EARNED_TITLES[t].earns(r.v))
    if (key) out.push({ k: key, v: r.v })
    if (out.length >= LIMITS.titles) break
  }
  return out
}

function highlights(devices: DeviceRecord[], totals: { tokens: number; usd: number | null; streak: number; range: { start: string; end: string } | null }, count: number): Highlight[] {
  const out: Highlight[] = []
  const bySessions = [...devices].sort((a, b) => b.stats.sessions - a.stats.sessions)
  const clean = (k: CardKey, b: string, c: string): SharedCard => ({ k, b: cleanText(b, LIMITS.big), c: cleanText(c, LIMITS.caption) })
  for (const k of CARD_KEYS) {
    const holders = bySessions.filter((d) => d.stats.cards?.some((c) => c.k === k))
    if (!holders.length) continue
    if (k === "tokens" && totals.tokens > 0) {
      out.push({ card: clean(k, formatCompact(totals.tokens), totals.usd ? `tokens, about $${formatInt(totals.usd)} at API list prices` : `tokens across ${count} computers`), from: null })
      continue
    }
    if (k === "streak" && totals.range) {
      out.push({ card: clean(k, `${formatInt(totals.streak)} ${totals.streak === 1 ? "day" : "days"}`, `in a row, ${dshort(totals.range.start)} to ${dshort(totals.range.end)}`), from: null })
      continue
    }
    // Otherwise the card of the busiest computer that has one (for a streak: the computer with the longest).
    const pick = k === "streak" ? [...holders].sort((a, b) => b.stats.streak - a.stats.streak)[0]! : holders[0]!
    out.push({ card: pick.stats.cards!.find((c) => c.k === k)!, from: pick.key })
  }
  return out
}

const clampTo = (n: number, max: number) => Math.min(max, Math.max(0, n))

/** The account total from its devices. With no devices it returns an empty total; callers keep at least one. */
export function aggregate(input: DeviceRecord[]): AccountTotals {
  const devices = ordered(input)
  const { counted, duplicates } = dedupe(devices)
  if (counted.length <= 1) {
    const only = counted[0] ?? devices[0]
    const stats = only ? accountShape(only.stats) : accountShape({ v: 1, name: "", from: "1970-01-01", to: "1970-01-01", sessions: 0, tokens: 0, usd: null, activeDays: 0, streak: 0, agents: [], fact: "" })
    return {
      stats,
      scores: { tokens: stats.tokens, usd: stats.usd, claudeTokens: agentTokens(stats, "claude-code"), codexTokens: agentTokens(stats, "codex"), streak: stats.streak },
      counted: counted.length,
      exactDays: true,
      streakRange: null,
      duplicates,
      highlights: (stats.cards ?? []).map((card) => ({ card, from: only?.key ?? null })),
      perDeviceRatios: [],
    }
  }

  const latest = [...counted].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]!
  const busiest = [...counted].sort((a, b) => b.stats.sessions - a.stats.sessions)[0]!
  const sessions = clampTo(counted.reduce((s, d) => s + d.stats.sessions, 0), LIMITS.sessions)
  const tokens = clampTo(counted.reduce((s, d) => s + d.stats.tokens, 0), LIMITS.tokens)
  const priced = counted.filter((d) => d.stats.usd !== null)
  const usd = priced.length ? Math.round(clampTo(priced.reduce((s, d) => s + (d.stats.usd ?? 0), 0), LIMITS.usd) * 100) / 100 : null
  const days = combineDays(counted)
  const v2 = counted.some((d) => d.stats.v !== 1)
  const { ratios, perDevice } = combineRatios(counted)
  const stats: SharedStats = {
    v: v2 ? 2 : 1,
    name: latest.stats.name,
    from: counted.reduce((m, d) => (d.stats.from < m ? d.stats.from : m), counted[0]!.stats.from),
    to: counted.reduce((m, d) => (d.stats.to > m ? d.stats.to : m), counted[0]!.stats.to),
    sessions,
    tokens,
    usd,
    activeDays: days.activeDays,
    streak: days.streak,
    agents: combineAgents(counted),
    fact: busiest.stats.fact,
  }
  const picked = v2 ? highlights(counted, { tokens, usd, streak: days.streak, range: days.exact ? days.range : null }, counted.length) : []
  if (v2) {
    stats.cards = picked.map((h) => h.card)
    stats.ratios = ratios
    stats.titles = earnTitles(ratios)
  }
  return {
    stats,
    scores: {
      tokens,
      usd,
      claudeTokens: clampTo(counted.reduce((s, d) => s + agentTokens(d.stats, "claude-code"), 0), LIMITS.tokens),
      codexTokens: clampTo(counted.reduce((s, d) => s + agentTokens(d.stats, "codex"), 0), LIMITS.tokens),
      streak: days.streak,
    },
    counted: counted.length,
    exactDays: days.exact,
    streakRange: days.exact ? days.range : null,
    duplicates,
    highlights: picked,
    perDeviceRatios: perDevice,
  }
}
