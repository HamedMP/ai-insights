/**
 * Analytics must never carry a URL fragment: /share#... holds a person's name and numbers. Nor a referrer's handle:
 * `?ref=<handle>` is reduced to a bare `ref` flag. This runs as PostHog's
 * before_send hook on every event and removes the "#..." part from every URL-like string it can find, at any depth
 * the event has ($current_url, $referrer, $pathname, $initial_*, $session_entry_*, $set, $set_once, ...).
 * Pure, with no imports, so the package tests cover it directly.
 */

const URLISH = /^(?:[a-z][a-z0-9+.-]*:|\/)/i
const MAX_DEPTH = 4

/** A `ref=<handle>` query parameter: who referred the visitor. Analytics may know that there was one, never whose. */
const REF_PARAM = /([?&])ref=[^&#]*(&?)/gi

/**
 * "https://x/share/#abc" -> "https://x/share/"; "/share#abc" -> "/share"; "/u/ada?ref=ada" -> "/u/ada?ref";
 * leaves other text alone.
 */
export function stripFragment(value: string): string {
  if (!URLISH.test(value)) return value
  const at = value.indexOf("#")
  const base = at === -1 ? value : value.slice(0, at)
  return base.replace(REF_PARAM, (_m, lead: string, tail: string) => `${lead}ref${tail}`)
}

function clean(value: unknown, depth: number): unknown {
  if (typeof value === "string") return stripFragment(value)
  if (depth >= MAX_DEPTH || !value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = clean(v, depth + 1)
  return out
}

/** Every event gets the site tag, and loses any fragment in any URL-like value. */
export function sanitizeEvent<T extends { properties?: Record<string, unknown> | null; $set?: unknown; $set_once?: unknown }>(event: T | null): T | null {
  if (!event) return event
  const next = { ...event }
  next.properties = { ...(clean(event.properties ?? {}, 0) as Record<string, unknown>), site: "ai-insights" }
  if (event.$set !== undefined) next.$set = clean(event.$set, 0)
  if (event.$set_once !== undefined) next.$set_once = clean(event.$set_once, 0)
  return next
}

/** The only events the site sends by name. Their properties never include payload values, names or handles. */
export const EVENTS = {
  shareCardViewed: "share_card_viewed",
  installCommandCopied: "install_command_copied",
  publishClicked: "publish_clicked",
  publishCompleted: "publish_completed",
  arenaViewed: "leaderboard_arena_viewed",
  /** Temporary (components/site/breakfast.tsx): a Luma registration click, with only its `placement`. */
  breakfastRegisterClicked: "breakfast_register_clicked",
} as const
export type EventName = (typeof EVENTS)[keyof typeof EVENTS]
