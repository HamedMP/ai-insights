import { clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"

import { clerkHosts, contentSecurityPolicy, needsAuthSync, satelliteOptions, serverAuthEnabled } from "@/lib/auth-config"
import { REF_COOKIE, REF_MAX_AGE_SECONDS, referralToStore } from "@/lib/referral"

const csp = contentSecurityPolicy(serverAuthEnabled() ? clerkHosts() : [], process.env.NODE_ENV !== "production")

function withHeaders(request: NextRequest, response: Response | NextResponse | undefined | null | void) {
  const res = response instanceof NextResponse ? response : response ? new NextResponse(response.body, response) : NextResponse.next()
  // Remember who sent this visitor (first touch wins; see lib/referral.ts). HttpOnly: page scripts and analytics never see it.
  const ref = referralToStore({
    pathname: request.nextUrl.pathname,
    ref: request.nextUrl.searchParams.get("ref"),
    existing: request.cookies.get(REF_COOKIE)?.value,
    fetchSite: request.headers.get("sec-fetch-site"),
  })
  if (ref) res.cookies.set(REF_COOKIE, ref, { maxAge: REF_MAX_AGE_SECONDS, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" })
  res.headers.set("Content-Security-Policy", csp)
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  res.headers.set("X-Content-Type-Options", "nosniff")
  return res
}

// Without Clerk keys the site runs signed-out only: no Clerk code runs and no Clerk host is allowed.
const clerk = serverAuthEnabled() ? clerkMiddleware(() => {}, (request) => ({ ...satelliteOptions(), ...(needsAuthSync(request.nextUrl.pathname) ? {} : { satelliteAutoSync: false }) })) : null

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!clerk) return withHeaders(request, NextResponse.next())
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
