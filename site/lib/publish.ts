/**
 * The publish and remove handlers, written against small injected dependencies so the package tests can drive every
 * rejection path without Clerk, Next or a database. app/api/leaderboard/entry/route.ts wires the real ones in.
 */
import { checkHandle, displayNameFor, scoresFor, type EntryScores } from "./leaderboard.ts"
import { safeAvatarUrl } from "./avatar.ts"
import { referralClaim } from "./referral.ts"
import { validateStats, type SharedStats } from "./share.ts"

/** A publish body is a handle, a few choices and one v1, v2 or v3 payload: under 4 KB. Anything bigger is refused unread. */
export const MAX_BODY_BYTES = 8 * 1024

export interface EntryRow extends EntryScores {
  userId: string
  handle: string
  displayName: string
  stats: SharedStats
  /**
   * The handle that referred this person, already checked to be a valid handle other than their own. The save
   * credits it only when this publish creates the entry and the handle belongs to another published person.
   */
  referrer: string | null
  /** The person's Clerk photo, only when they chose to show it on this publish; null clears a stored one. */
  avatarUrl: string | null
}

export type SaveResult = "saved" | "handle_taken" | "too_soon" | "device_cap"
/**
 * `credited` is the referrer handle the save actually recorded, if any (first publish only). `duplicate` says this
 * device published exactly the numbers another of the person's devices did; `devices` is how many the total counts.
 */
export type SaveOutcome = SaveResult | { result: "saved"; credited: string | null; duplicate?: boolean; devices?: number }

/** Per-publish choices besides the photo (lib/device-sql.ts PublishChoices). Both default to false. */
export interface SaveChoices {
  showDeviceName: boolean
  replaceLegacy: boolean
}

export interface HandlerDeps {
  userId: string | null
  /** The request's Origin header; browsers always send it on a cross-origin or same-origin POST/DELETE fetch. */
  origin: string | null
  allowedOrigins: readonly string[]
  contentType: string | null
  body: ReadableStream<Uint8Array> | null
  allow: (userId: string) => boolean
  log: (message: string, error?: unknown) => void
}

export interface PublishDeps extends HandlerDeps {
  /** The referral cookie's raw value: an untrusted claim. */
  referrer: string | null
  save: (row: EntryRow, choices: SaveChoices) => Promise<SaveOutcome>
  /** Reads the signed-in person's photo from Clerk on the server. Called only when they chose to show it. */
  avatarFor?: (userId: string) => Promise<string | null>
  /** Called after a save that credited a referrer, to mirror it into the publisher's Clerk metadata. */
  onCredited?: (userId: string, referrer: string) => void
}

export interface RemoveDeps extends HandlerDeps {
  remove: (userId: string) => Promise<boolean>
}

export interface Reply {
  status: number
  body: { ok: true; handle?: string; removed?: boolean; referred?: true; duplicate?: true; devices?: number } | { ok: false; error: string }
}

/** Messages a client may see. Fixed strings only: no driver, Clerk or validation detail ever reaches the response. */
export const ERRORS = {
  origin: "This request did not come from the AI Insights site.",
  auth: "Sign in to publish to the leaderboard.",
  type: "Send JSON.",
  size: "That request is too large.",
  body: "That is not a valid AI Insights stats payload.",
  handle: "Handles are 3 to 30 lowercase letters, digits or single hyphens, starting and ending with a letter or digit.",
  reserved: "That handle is reserved. Pick another.",
  taken: "That handle is taken. Pick another.",
  rate: "Too many changes in a short time. Try again in a minute.",
  devices: "Your account already has 10 computers, the most it can hold. Remove one on your profile, then publish again.",
  device: "That computer is not on your profile.",
  lastDevice: "That is the only computer on your profile. To leave the leaderboard, remove your entry instead.",
  noEntry: "You have not published yet.",
  server: "Something went wrong on our side. Try again later.",
} as const

const fail = (status: number, error: string): Reply => ({ status, body: { ok: false, error } })

/** Read a request body up to max bytes. Returns null as soon as the stream passes the limit, without buffering more. */
export async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<string | null> {
  if (!body) return ""
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(all)
}

/** The checks every mutating request passes before it touches anything: same origin, signed in, rate limit. */
export function gate(deps: HandlerDeps): Reply | string {
  if (!deps.origin || !deps.allowedOrigins.includes(deps.origin)) return fail(403, ERRORS.origin)
  if (!deps.userId) return fail(401, ERRORS.auth)
  if (!deps.allow(deps.userId)) return fail(429, ERRORS.rate)
  return deps.userId
}

/** Read a JSON object body under `max` bytes, or the Reply that refuses it. */
export async function readJsonObject(deps: Pick<HandlerDeps, "contentType" | "body">, max: number): Promise<Record<string, unknown> | Reply> {
  // A JSON content type also means a cross-site form cannot send this request without a CORS preflight, which fails.
  if (!deps.contentType || !/^application\/json(?:\s*;|$)/i.test(deps.contentType)) return fail(415, ERRORS.type)
  let text: string | null
  try {
    text = await readLimited(deps.body, max)
  } catch (error) {
    if (error instanceof TypeError) return fail(400, ERRORS.body)
    throw error
  }
  if (text === null) return fail(413, ERRORS.size)
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return fail(400, ERRORS.body)
    throw error
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail(400, ERRORS.body)
  return input as Record<string, unknown>
}

export const isReply = (value: unknown): value is Reply => Boolean(value && typeof value === "object" && "status" in value && "body" in value && typeof (value as Reply).status === "number")
export { fail }

const OPTIONAL_CHOICES = ["showAvatar", "showDeviceName", "replaceLegacy"]

export async function handlePublish(deps: PublishDeps): Promise<Reply> {
  const gated = gate(deps)
  if (typeof gated !== "string") return gated
  const userId = gated
  const raw = await readJsonObject(deps, MAX_BODY_BYTES)
  if (isReply(raw)) return raw
  // {handle, stats} from older pages, plus any of the optional boolean choices.
  const keys = Object.keys(raw)
  const shape = keys.includes("handle") && keys.includes("stats") && keys.every((k) => k === "handle" || k === "stats" || (OPTIONAL_CHOICES.includes(k) && typeof raw[k] === "boolean"))
  if (!shape) return fail(400, ERRORS.body)

  const handle = checkHandle(raw.handle)
  if (!handle.ok) return fail(400, handle.problem === "reserved" ? ERRORS.reserved : ERRORS.handle)
  const stats = validateStats(raw.stats)
  if (!stats) return fail(400, ERRORS.body)

  const row: EntryRow = { userId, handle: handle.handle, displayName: displayNameFor(stats, handle.handle), stats, ...scoresFor(stats), referrer: referralClaim(deps.referrer, handle.handle), avatarUrl: null }
  try {
    if (raw.showAvatar === true && deps.avatarFor) row.avatarUrl = safeAvatarUrl(await deps.avatarFor(userId))
    const outcome = await deps.save(row, { showDeviceName: raw.showDeviceName === true, replaceLegacy: raw.replaceLegacy === true })
    const result = typeof outcome === "string" ? outcome : outcome.result
    if (result === "handle_taken") return fail(409, ERRORS.taken)
    if (result === "too_soon") return fail(429, ERRORS.rate)
    if (result === "device_cap") return fail(409, ERRORS.devices)
    const credited = typeof outcome === "string" ? null : outcome.credited
    if (credited) deps.onCredited?.(userId, credited)
    const body: Reply["body"] = { ok: true, handle: row.handle }
    if (credited) body.referred = true
    if (typeof outcome !== "string" && outcome.duplicate) body.duplicate = true
    if (typeof outcome !== "string" && typeof outcome.devices === "number") body.devices = outcome.devices
    return { status: 200, body }
  } catch (error) {
    deps.log("leaderboard publish failed", error)
    return fail(500, ERRORS.server)
  }
}

export async function handleRemove(deps: RemoveDeps): Promise<Reply> {
  const gated = gate(deps)
  if (typeof gated !== "string") return gated
  // DELETE takes no body; refuse one rather than buffer it.
  const text = await readLimited(deps.body, 0)
  if (text === null) return fail(413, ERRORS.size)
  try {
    const removed = await deps.remove(gated)
    return { status: 200, body: { ok: true, removed } }
  } catch (error) {
    deps.log("leaderboard remove failed", error)
    return fail(500, ERRORS.server)
  }
}

/**
 * A small fixed-window limiter per user, capped so it cannot grow without bound. It is per server instance, so it is a
 * first line only; the database also refuses a second publish from the same person within 30 seconds.
 */
export function createLimiter({ limit, windowMs, maxKeys, now = Date.now }: { limit: number; windowMs: number; maxKeys: number; now?: () => number }) {
  const hits = new Map<string, { start: number; count: number }>()
  return (key: string): boolean => {
    const t = now()
    const seen = hits.get(key)
    if (seen && t - seen.start < windowMs) {
      seen.count += 1
      return seen.count <= limit
    }
    if (seen) hits.delete(key)
    if (hits.size >= maxKeys) {
      for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k)
      // Still full of live windows: drop the oldest insertion (Map keeps insertion order).
      while (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string)
    }
    hits.set(key, { start: t, count: 1 })
    return true
  }
}
