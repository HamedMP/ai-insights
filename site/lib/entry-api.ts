import { BASE } from "@/lib/site"

const ENTRY_API = `${BASE}/api/leaderboard/entry`

/** Client-side messages are shown only from this list; anything else from the server becomes the generic one. */
const KNOWN_ERRORS = new Set([
  "This request did not come from the AI Insights site.",
  "Sign in to publish to the leaderboard.",
  "That is not a valid AI Insights stats payload.",
  "Handles are 3 to 30 lowercase letters, digits or single hyphens, starting and ending with a letter or digit.",
  "That handle is reserved. Pick another.",
  "That handle is taken. Pick another.",
  "Too many changes in a short time. Try again in a minute.",
  "Your account already has 10 computers, the most it can hold. Remove one on your profile, then publish again.",
])
const GENERIC = "Something went wrong. Try again later."

/** The one client for the publish/remove API. Shared by the publish panel, the owner's devices list and the rank share. */
export async function callEntryApi(method: "POST" | "DELETE", body?: unknown): Promise<{ ok: true; handle?: string; referred?: boolean; duplicate?: boolean; devices?: number } | { ok: false; error: string }> {
  try {
    const res = await fetch(ENTRY_API, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal: AbortSignal.timeout(10_000),
    })
    const data: unknown = await res.json().catch((error: unknown) => {
      if (error instanceof SyntaxError) return null
      throw error
    })
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {}
    if (res.ok && record.ok === true) return { ok: true, handle: typeof record.handle === "string" ? record.handle : undefined, referred: record.referred === true, duplicate: record.duplicate === true, devices: typeof record.devices === "number" && record.devices >= 1 && record.devices <= 10 ? Math.round(record.devices) : undefined }
    const error = typeof record.error === "string" && KNOWN_ERRORS.has(record.error) ? record.error : GENERIC
    return { ok: false, error }
  } catch (error) {
    if (error instanceof Error) return { ok: false, error: GENERIC }
    throw error
  }
}
