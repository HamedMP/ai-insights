"use client"

import * as React from "react"

import { clerkEnabled } from "@/lib/auth-config"
import { hasSessionHint } from "@/lib/session-hint"

// Loaded only when the session hint is present: anonymous visitors download no Clerk code and contact no Clerk host.
const Provider = React.lazy(() => import("@/components/site/clerk-island-provider"))

const noSubscribe = () => () => {}
const readHint = () => hasSessionHint(document.cookie)

/** Whether this browser has signed in here before. False on the server and during hydration, then the cookie's answer. */
export const useSessionHint = () => React.useSyncExternalStore(noSubscribe, readHint, () => false)

/**
 * A signed-in-only part of a cached page (the leaderboard's "you" strip, "Jump to me"), mounted with its own Clerk
 * provider and only in a browser that has signed in here before, like the header's account menu (session-account.tsx).
 * Several of these share one Clerk instance (Clerk keeps a single instance per publishable key; only nesting providers
 * is an error). The server render and anonymous visitors get nothing here.
 */
export function ClerkIsland({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const hint = useSessionHint()
  if (!clerkEnabled || !hint) return null
  return (
    <React.Suspense fallback={fallback}>
      <Provider>{children}</Provider>
    </React.Suspense>
  )
}
