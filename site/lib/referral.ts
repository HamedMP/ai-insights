/**
 * Referral rules, shared by the proxy (which remembers who sent a visitor), the publish handler (which credits them)
 * and the package tests. Pure TypeScript with relative imports only.
 *
 * A visitor's referrer is a public handle kept in a first-party, HttpOnly cookie on ai-insights.app for 30 days. The
 * first referrer wins: a later link never replaces it. It comes from `?ref=<handle>` on any page, or from arriving
 * at a profile `/u/<handle>` from outside the site (a click inside the site, such as down the leaderboard, is not an
 * arrival). The cookie is only a claim: the server checks on publish that the handle exists and is not the publisher.
 */
import { checkHandle } from "./leaderboard.ts"

export const REF_COOKIE = "aii_ref"
export const REF_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const PROFILE_PATH = /^\/u\/([^/]{1,90})\/?$/

/** A stored or claimed referrer handle, normalised, or null when it is not a valid public handle. */
export function referrerHandle(value: unknown): string | null {
  const checked = checkHandle(value)
  return checked.ok ? checked.handle : null
}

export interface ArrivalInput {
  pathname: string
  /** The `ref` query parameter, if any. */
  ref: string | null
  /** The current value of the referral cookie, if any. */
  existing: string | null | undefined
  /** The Sec-Fetch-Site request header: "same-origin" means a click inside the site. */
  fetchSite: string | null
}

/** The handle to remember for this request, or null to leave the cookie alone. */
export function referralToStore({ pathname, ref, existing, fetchSite }: ArrivalInput): string | null {
  if (referrerHandle(existing)) return null
  if (ref !== null) {
    const fromParam = referrerHandle(ref)
    if (fromParam) return fromParam
  }
  if (fetchSite === "same-origin") return null
  const match = PROFILE_PATH.exec(pathname)
  if (!match) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(match[1] ?? "")
  } catch (error) {
    if (error instanceof URIError) return null
    throw error
  }
  return referrerHandle(decoded)
}

/** A link to a person's profile that credits them when someone arrives through it. */
export function referralLink(siteUrl: string, handle: string, path = `u/${handle}`): string {
  const url = new URL(path, siteUrl)
  url.searchParams.set("ref", handle)
  return url.toString()
}

/**
 * The referral to record on a publish: the claimed handle if it is valid and not the publisher's own. Whether the
 * handle belongs to a published person, and is not the publisher's user, is checked inside the save statement.
 */
export function referralClaim(cookie: string | null | undefined, publishingHandle: string): string | null {
  const handle = referrerHandle(cookie)
  return handle && handle !== publishingHandle ? handle : null
}
