/**
 * Sign-in is optional at build and run time: with no Clerk keys the site still builds and serves every public page,
 * and the publish controls stay hidden. With keys it runs as a Clerk satellite of the Matrix OS application, so a
 * leaderboard account is a Matrix account. Everything comes from env vars; no key is ever committed.
 *
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   Matrix OS app publishable key (production instance)
 *   CLERK_SECRET_KEY                    Matrix OS app secret key (server only)
 *   NEXT_PUBLIC_CLERK_IS_SATELLITE      "true" on ai-insights.app
 *   NEXT_PUBLIC_CLERK_DOMAIN            "ai-insights.app"
 *   NEXT_PUBLIC_CLERK_SIGN_IN_URL       the primary's sign-in page, e.g. https://app.matrix-os.com/sign-in
 *   NEXT_PUBLIC_CLERK_SIGN_UP_URL       the primary's sign-up page (optional; defaults to the sign-in URL)
 */

export const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ""
export const isSatellite = process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "true"
export const clerkDomain = process.env.NEXT_PUBLIC_CLERK_DOMAIN ?? ""
export const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? ""
export const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || signInUrl

/** Publishable key present, and if this is a satellite, its domain and the primary sign-in URL too. Client-safe. */
export const clerkEnabled = Boolean(/^pk_(?:test|live)_[A-Za-z0-9+/=_-]+$/.test(clerkPublishableKey) && (!isSatellite || (clerkDomain && signInUrl)))

/** Server side also needs the secret key; without it, auth is treated as off rather than half-on. */
export const serverAuthEnabled = () => clerkEnabled && Boolean(process.env.CLERK_SECRET_KEY)

/**
 * The satellite options, shared by ClerkProvider and clerkMiddleware. Auto-sync makes a satellite recognise someone
 * who is already signed in on the primary domain; without it they are sent to the primary sign-in page, which has
 * nothing to do and does not send them back.
 */
export const satelliteOptions = () => (isSatellite ? { isSatellite: true as const, domain: clerkDomain, signInUrl, signUpUrl, satelliteAutoSync: true as const } : {})

/**
 * Pages that mount Clerk (sign-in, the account menu, owner views). Only these get Clerk hosts in their CSP and may run
 * the satellite sync; the landing page stays free of Clerk code and of the round trip.
 */
export const mountsClerk = (pathname: string) => /^\/(?:share|leaderboard|u|api)(?:\/|$)/.test(pathname)

/** Link-preview crawlers and fetch tools: they must get the page itself, not a redirect to the primary domain. */
const CRAWLER = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|slack|linkedin|skype|vkshare|pinterest|quora|outbrain|redditbot|curl|wget|python-requests|go-http-client|node-fetch|headless/i

/**
 * Whether this request may take the satellite sync round trip: a Clerk page, opened as a document by a browser. OG
 * images, API fetches (Clerk only syncs documents anyway) and crawlers fetching a shared profile are served directly.
 */
export function needsAuthSync(pathname: string, userAgent: string | null = null, fetchDest: string | null = null): boolean {
  if (!mountsClerk(pathname)) return false
  if (/\/opengraph-image(?:\/|$)/.test(pathname)) return false
  if (userAgent !== null && (userAgent === "" || CRAWLER.test(userAgent))) return false
  if (fetchDest !== null && fetchDest !== "document") return /^\/api(?:\/|$)/.test(pathname)
  return true
}

/**
 * The Clerk Frontend API host(s) the browser loads clerk-js from and talks to. A publishable key is
 * "pk_<env>_" + base64("<frontend-api-host>$"); a satellite also serves Clerk from clerk.<its domain>.
 */
export function clerkHosts(key = clerkPublishableKey, satelliteDomain = isSatellite ? clerkDomain : ""): string[] {
  const hosts = new Set<string>()
  const encoded = /^pk_(?:test|live)_(.+)$/.exec(key)?.[1]
  if (encoded) {
    try {
      const decoded = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))
      const host = decoded.replace(/\$$/, "")
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) hosts.add(host.toLowerCase())
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  if (satelliteDomain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(satelliteDomain)) hosts.add(`clerk.${satelliteDomain.toLowerCase()}`)
  return [...hosts]
}

/**
 * The site's Content-Security-Policy. Same-origin only, plus exactly what Clerk needs when sign-in is configured:
 * its Frontend API host(s) for clerk-js and session calls, img.clerk.com for avatars, and blob: workers for clerk-js's
 * timers. No telemetry, analytics or other third-party host is allowed.
 */
export function contentSecurityPolicy(hosts: string[], dev = false): string {
  const clerk = hosts.map((h) => `https://${h}`)
  // img.clerk.com serves Clerk's own avatars (the account menu, and profile photos people chose to show).
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...clerk],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", ...(hosts.length ? ["https://img.clerk.com"] : [])],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...clerk, ...(dev ? ["ws:"] : [])],
    "frame-src": ["'self'", ...clerk],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
  }
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ")
}
