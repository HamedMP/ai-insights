import { Suspense } from "react"

import { BoardPageview } from "@/components/site/analytics"

/**
 * No Clerk provider here: the board is one cached page, and its signed-in parts (the header's account menu, the "you"
 * strip) mount Clerk on demand, only in a browser that has signed in here before (session-account.tsx,
 * clerk-island.tsx). proxy.ts still runs the satellite sync on the server when a browser needs it.
 */
export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <BoardPageview />
      </Suspense>
    </>
  )
}
