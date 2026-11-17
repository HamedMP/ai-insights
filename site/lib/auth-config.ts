import { hasSessionHint } from "./session-hint.ts"

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
 * Pages that mount Clerk (sign-in, the account menu, owner views, /account/sign-in). Only these run Clerk's middleware
 * and the satellite sync. The landing page and the docs stay free of Clerk code and of the round trip for anonymous
 * visitors; a browser that has signed in here before loads the account menu there on demand (lib/session-hint.ts).
 */
export const mountsClerk = (pathname: string) => /^\/(?:share|leaderboard|u|account|api)(?:\/|$)/.test(pathname)

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
 * The leaderboard, profiles and /share are one cached page for everyone: their server render reads no session, and the
 * signed-in pieces (the "you" strip, owner panels, the account menu) load in the browser. So Clerk's middleware has one
 * job there: the satellite sync that recognises someone already signed in on Matrix OS. That sync is four cross-domain
 * redirects, and for a signed-out browser Clerk repeats it on every visit (it leaves `__client_uat=0`, which it reads
 * as "never synced"). This cookie remembers that a signed-out browser went through it recently, so later visits come
 * straight from the cache. Someone who signs in on Matrix OS in the meantime is recognised when it expires, or at once
 * through the Sign in link, which goes to /account/sign-in, where the sync always runs. A browser that has signed in
 * here (lib/session-hint.ts) keeps the check on every page load: it refreshes the short-lived session cookie the owner
 * panels' and the "you" strip's requests are authorised by.
 */
export const AUTH_CHECKED_COOKIE = "aii_auth_checked"
export const AUTH_CHECKED_MAX_AGE = 24 * 60 * 60

/**
 * Pages served from the cache whose server render reads no session (see AUTH_CHECKED_COOKIE): the board, profiles and
 * /share, whose numbers live in the URL fragment and whose publish panel reads Clerk in the browser.
 */
export const cachedClerkPage = (pathname: string) => /^\/(?:leaderboard|u|share)(?:\/|$)/.test(pathname)

/** A Clerk sync or handshake in progress: its query parameter or cookie must reach Clerk's middleware. */
const CLERK_FLOW_COOKIE = /(?:^|;\s*)(?:__clerk_handshake(?:_nonce)?|__clerk_db_jwt)(?:_[A-Za-z0-9_-]{1,64})?=/
const CHECKED_COOKIE = new RegExp(`(?:^|;\\s*)${AUTH_CHECKED_COOKIE}=1(?:;|$)`)

export type ClerkRun = "skip" | "sync" | "no-sync"

/**
 * Whether one request runs Clerk's middleware, with the satellite sync or without it. "skip": not at all (the landing
 * page and the docs; on the cached Clerk pages, a signed-out browser checked recently, crawlers, prefetches and
 * client navigations). Route handlers, /share and /account keep the rule needsAuthSync gives them, so `auth()` works there.
 */
export function clerkRun(request: { pathname: string; search: string; userAgent: string | null; fetchDest: string | null; cookies: string | null }): ClerkRun {
  const { pathname } = request
  if (pathname.startsWith("/__clerk/")) return "no-sync"
  if (!mountsClerk(pathname)) return "skip"
  const sync = needsAuthSync(pathname, request.userAgent, request.fetchDest)
  if (!cachedClerkPage(pathname)) return sync ? "sync" : "no-sync"
  const cookies = request.cookies && request.cookies.length <= 16_384 ? request.cookies : ""
  if (/[?&]__clerk_/.test(request.search) || CLERK_FLOW_COOKIE.test(cookies)) return sync ? "sync" : "no-sync"
  if (!sync) return "skip"
  if (hasSessionHint(cookies)) return "sync"
  return CHECKED_COOKIE.test(cookies) ? "skip" : "sync"
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
