"use client"

import * as React from "react"
import Link, { useLinkStatus } from "next/link"

/** A thin bar at the top of the window while the clicked link's page loads, so a click never looks ignored. */
function Pending() {
  const { pending } = useLinkStatus()
  return pending ? <span aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary" /> : null
}

/**
 * A link between the leaderboard and profiles that navigates without reloading the page: they share one content
 * security policy and Clerk stays loaded, so only the new content is fetched (from the cache). Never use it for a link
 * to the landing page or the docs: they get a different policy, which only a full page load applies (proxy.ts).
 * It prefetches on hover, focus or touch, not on sight, so a board of fifty rows does not fetch fifty profiles.
 */
export function NavLink({ href, children, ...rest }: Omit<React.ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string }) {
  // The full page, not only the route tree: these routes sit behind a proxy rewrite, so the router cannot tell they
  // are static and would otherwise fetch the content again on click.
  const [intent, setIntent] = React.useState(false)
  const warm = () => setIntent(true)
  return (
    <Link href={href} prefetch={intent} onMouseEnter={warm} onFocus={warm} onTouchStart={warm} {...rest}>
      {children}
      <Pending />
    </Link>
  )
}
