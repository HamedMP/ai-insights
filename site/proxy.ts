import { clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server"

import { clerkHosts, contentSecurityPolicy, satelliteOptions, serverAuthEnabled } from "@/lib/auth-config"

const csp = contentSecurityPolicy(serverAuthEnabled() ? clerkHosts() : [], process.env.NODE_ENV !== "production")

function withHeaders(response: Response | NextResponse | undefined | null | void) {
  const res = response instanceof NextResponse ? response : response ? new NextResponse(response.body, response) : NextResponse.next()
  res.headers.set("Content-Security-Policy", csp)
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  res.headers.set("X-Content-Type-Options", "nosniff")
  return res
}

// Without Clerk keys the site runs signed-out only: no Clerk code runs and no Clerk host is allowed.
const clerk = serverAuthEnabled() ? clerkMiddleware(satelliteOptions()) : null

/** Page URLs end in "/" (trailingSlash), redirected here because next.config skips it for the /relay rewrite. */
function slashRedirect(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl
  if (pathname.endsWith("/") || /^\/(?:relay|api|__clerk|_next)(?:\/|$)/.test(pathname)) return null
  const last = pathname.slice(pathname.lastIndexOf("/") + 1)
  if (last.includes(".") || last === "opengraph-image") return null
  // Built from the raw URL: NextURL normalises the trailing slash away again when serialised.
  const url = new URL(request.url)
  url.pathname = `${pathname}/`
  return NextResponse.redirect(url, 308)
}

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const redirect = slashRedirect(request)
  if (redirect) return withHeaders(redirect)
  if (!clerk) return withHeaders(NextResponse.next())
  return withHeaders(await clerk(request, event))
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|relay/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|txt)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
}
