"use client"

import * as React from "react"

import { ClerkIsland } from "@/components/site/clerk-island"
import type { SortId } from "@/lib/leaderboard"

// The signed-in parts load with Clerk, on demand (clerk-island.tsx): this module imports no Clerk code.
const Strip = React.lazy(() => import("@/components/site/you-strip-signed-in").then((m) => ({ default: m.SignedInStrip })))
const Jump = React.lazy(() => import("@/components/site/you-strip-signed-in").then((m) => ({ default: m.SignedInJump })))

/**
 * The signed-in person's strip above the board. The board is one cached page for everyone, so this part is fetched by
 * the browser after the table is already on screen and never holds it back; anonymous visitors load none of it.
 */
export function YouStrip({ sort, page }: { sort: SortId; page: number }) {
  return (
    <ClerkIsland>
      <Strip sort={sort} page={page} />
    </ClerkIsland>
  )
}

/** "Jump to me" beside the sort presets on wide screens; phones have it in the strip. */
export function JumpToMe({ sort }: { sort: SortId }) {
  return (
    <ClerkIsland>
      <Jump sort={sort} />
    </ClerkIsland>
  )
}
