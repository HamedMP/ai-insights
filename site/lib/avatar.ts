/**
 * Profile photos. A person may choose at publish time to show their Matrix (Clerk) account photo publicly; it is off by
 * default. The URL is always read on the server from the Clerk user, never taken from the request, and only Clerk's
 * image host is accepted, so a stored avatar can never point anywhere else. Pure, for the package tests.
 */

export const AVATAR_HOST = "img.clerk.com"
const MAX_URL = 1024

/** The URL if it is a plain https URL on img.clerk.com, else null. */
export function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_URL) return null
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
  if (url.protocol !== "https:" || url.hostname !== AVATAR_HOST || url.port || url.username || url.password || url.hash) return null
  return url.toString()
}

/** From the Clerk user: their uploaded photo only. Clerk's generated placeholder (hasImage false) is not a photo. */
export function avatarFromClerkUser(user: { imageUrl?: unknown; hasImage?: unknown } | null | undefined): string | null {
  if (!user || user.hasImage !== true) return null
  return safeAvatarUrl(user.imageUrl)
}

/** Initials for when there is no photo: first letters of up to two words, or the handle's first letter. */
export function initials(name: string, handle: string): string {
  const words = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w))
  const letters = words.slice(0, 2).map((w) => (Array.from(w)[0] ?? "").toUpperCase()).join("")
  return letters || handle.slice(0, 1).toUpperCase()
}
