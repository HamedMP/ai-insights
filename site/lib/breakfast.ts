/**
 * Temporary: the Slush AI Breakfast Club (Thu 19 Nov 2026, 08:00 to 10:00, Helsinki). Shared by the proxy, which
 * flags landing-page visits from Finland, and components/site/breakfast.tsx, which shows the prompts. Pure TypeScript
 * with no imports, so the package tests cover it directly. Delete with breakfast.tsx once the breakfast has started.
 */

/** 08:00 Helsinki (EET, UTC+2) on Thursday 19 November 2026, when the breakfast starts. The only copy on the site. */
export const BREAKFAST_UNTIL = Date.UTC(2026, 10, 19, 6, 0, 0)
export const BREAKFAST_REGISTER_URL = "https://luma.com/4yb5xhzs"

/**
 * A flag, not an identifier: "1" when the landing page was requested from Finland. Readable by the page, which
 * decides in the browser whether to show the section, so the cached landing HTML stays the same for everyone.
 */
export const BREAKFAST_COUNTRY_COOKIE = "aii_fi"
export const BREAKFAST_COUNTRY_MAX_AGE = 6 * 60 * 60

export interface CountryRequest {
  pathname: string
  /** Vercel's `x-vercel-ip-country` header: a two-letter country code. Nothing else about the visitor is read. */
  country: string | null
  /** Sec-Fetch-Dest: only a page load sets the flag, not a prefetch or an asset. */
  fetchDest: string | null
  existing: string | null | undefined
  now: number
}

/** Whether the proxy should set the Finland flag on this response. */
export function countryCookieFor({ pathname, country, fetchDest, existing, now }: CountryRequest): boolean {
  if (pathname !== "/" || country !== "FI" || now >= BREAKFAST_UNTIL || existing === "1") return false
  return fetchDest === null || fetchDest === "document"
}

const FLAG = new RegExp(`(?:^|;\\s*)${BREAKFAST_COUNTRY_COOKIE}=1(?:;|$)`)

/** The landing section shows before the breakfast for the Finland flag, or for the `?breakfast=1` preview. */
export function showLandingBreakfast({ now, cookies, search }: { now: number; cookies: string; search: string }): boolean {
  if (now >= BREAKFAST_UNTIL) return false
  return FLAG.test(cookies) || new URLSearchParams(search).get("breakfast") === "1"
}
