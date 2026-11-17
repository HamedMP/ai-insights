/**
 * The "Show my photo" switch: turn the signed-in owner's public photo on or off without republishing. Written against
 * injected dependencies like lib/publish.ts, so the package tests drive every path.
 *
 * The request carries only {show: boolean}. The photo URL is never taken from the request: turning it on reads the
 * person's own uploaded photo from Clerk on the server (avatarFromClerkUser: uploaded photos only, Clerk's image host
 * only), and an account without one is refused rather than given a placeholder. Turning it off stores null.
 */
import { safeAvatarUrl } from "./avatar.ts"
import { ERRORS, fail, gate, isReply, readJsonObject, type HandlerDeps, type Reply } from "./publish.ts"

/** {"show":false} is 14 bytes; anything near this is not a switch request. */
export const MAX_PHOTO_BODY_BYTES = 256

export const PHOTO_ERRORS = {
  noPhoto: "Your Matrix account has no uploaded photo. Add one to your account first.",
} as const

export interface PhotoDeps extends HandlerDeps {
  /** The caller's uploaded Clerk photo, read on the server; null when they have none or Clerk could not be read. */
  avatarFor: (userId: string) => Promise<string | null>
  /** Store or clear the caller's photo; false when they have not published. */
  setAvatar: (userId: string, url: string | null) => Promise<boolean>
}

export type PhotoReply = Reply | { status: 200; body: { ok: true; shown: boolean } }

export async function handlePhoto(deps: PhotoDeps): Promise<PhotoReply> {
  const gated = gate(deps)
  if (typeof gated !== "string") return gated
  const raw = await readJsonObject(deps, MAX_PHOTO_BODY_BYTES)
  if (isReply(raw)) return raw
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== "show" || typeof raw.show !== "boolean") return fail(400, ERRORS.body)
  try {
    let url: string | null = null
    if (raw.show) {
      url = safeAvatarUrl(await deps.avatarFor(gated))
      if (!url) return fail(409, PHOTO_ERRORS.noPhoto)
    }
    if (!(await deps.setAvatar(gated, url))) return fail(404, ERRORS.noEntry)
    return { status: 200, body: { ok: true, shown: url !== null } }
  } catch (error) {
    deps.log("photo switch failed", error)
    return fail(500, ERRORS.server)
  }
}
