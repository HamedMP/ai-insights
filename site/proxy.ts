import { clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"

import { clerkHosts, contentSecurityPolicy, mountsClerk, needsAuthSync, satelliteOptions, serverAuthEnabled } from "@/lib/auth-config"
import { boardViewPath } from "@/lib/leaderboard"
import { REF_COOKIE, REF_MAX_AGE_SECONDS, referralToStore } from "@/lib/referral"
import { hasSessionHint } from "@/lib/session-hint"

// Clerk hosts are allowed on the pages that mount Clerk, and on any other page only for a browser that has signed in
// here before (it may load the account menu there; lib/session-hint.ts). Anonymous visitors get the same-origin-only
// policy on every page that does not mount Clerk.
const dev = process.env.NODE_ENV !== "production"
const cspWithClerk = contentSecurityPolicy(serverAuthEnabled() ? clerkHosts() : [], dev)
const cspPlain = contentSecurityPolicy([], dev)

function withHeaders(request: NextRequest, response: Response | NextResponse | undefined | null | void) {
  const res = response instanceof NextResponse ? response : response ? new NextResponse(response.body, response) : NextResponse.next()
  const pathname = request.nextUrl.pathname
  // Remember who sent this visitor (first touch wins; see lib/referral.ts). HttpOnly: page scripts and analytics never see it.
  const ref = referralToStore({
    pathname: request.nextUrl.pathname,
    ref: request.nextUrl.searchParams.get("ref"),
    existing: request.cookies.get(REF_COOKIE)?.value,
    fetchSite: request.headers.get("sec-fetch-site"),
  })
  if (ref) res.cookies.set(REF_COOKIE, ref, { maxAge: REF_MAX_AGE_SECONDS, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" })
  res.headers.set("Content-Security-Policy", cspFor(pathname, request.headers.get("cookie")))
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  res.headers.set("X-Content-Type-Options", "nosniff")
  return res
}

/** The public board URL is served from its cached view (lib/leaderboard.ts boardViewPath); the address bar keeps it. */
function pass(request: NextRequest) {
  if (request.nextUrl.pathname !== "/leaderboard") return NextResponse.next()
  const url = request.nextUrl.clone()
  url.pathname = boardViewPath(request.nextUrl.searchParams)
  url.search = ""
  return NextResponse.rewrite(url)
}

// Without Clerk keys the site runs signed-out only: no Clerk code runs and no Clerk host is allowed.
const clerk = serverAuthEnabled() ? clerkMiddleware((_auth, request) => pass(request), (request) => ({ ...satelliteOptions(), ...(needsAuthSync(request.nextUrl.pathname, request.headers.get("user-agent"), request.headers.get("sec-fetch-dest")) ? {} : { satelliteAutoSync: false }) })) : null

/** The policy for one request: the page itself is the same HTML for everyone; only this header differs. */
const cspFor = (pathname: string, cookies: string | null) => (mountsClerk(pathname) || (serverAuthEnabled() && hasSessionHint(cookies)) ? cspWithClerk : cspPlain)

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  // Pages that do not mount Clerk never run Clerk's middleware: no satellite sync and no handshake redirect, even for a
  // signed-in visitor whose session token has expired. Their account menu refreshes the session in the browser.
  if (!clerk || !(mountsClerk(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith("/__clerk/"))) return withHeaders(request, pass(request))
  return withHeaders(request, await clerk(request, event))
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|relay/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|txt)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
}
