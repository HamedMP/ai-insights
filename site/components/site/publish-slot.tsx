"use client"

import * as React from "react"

import { ClerkIsland, useSessionHint } from "@/components/site/clerk-island"
import { PublishPanelView } from "@/components/site/publish-form"
import { signInHandoff } from "@/components/site/sign-in-link"
import type { SharedStats } from "@/lib/share"

// Clerk and the signed-in panel load on demand (clerk-island.tsx): this module imports no Clerk code.
const Panel = React.lazy(() => import("@/components/site/publish-panel").then((m) => ({ default: m.PublishPanel })))

/**
 * The publish panel under a valid /share card. A browser that has signed in here loads Clerk and gets the Publish form
 * (after "Checking whether you are signed in…" while Clerk loads); anyone else gets the sign-in button at once,
 * without Clerk. Someone signed in on Matrix OS who arrives for the first time is signed in by the server's sync before
 * the page loads, so they carry the hint too.
 */
export function PublishSlot({ stats }: { stats: SharedStats }) {
  const hint = useSessionHint()
  if (!hint) return <PublishPanelView stats={stats} signedIn={false} user={null} account={null} signInButton={signInHandoff} />
  return (
    <ClerkIsland fallback={<PublishPanelView stats={stats} signedIn={null} user={null} account="loading" signInButton={signInHandoff} />}>
      <Panel stats={stats} />
    </ClerkIsland>
  )
}
