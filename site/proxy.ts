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

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
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
