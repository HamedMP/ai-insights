"use client"

import * as React from "react"
import { UserButton, useAuth, useClerk } from "@clerk/nextjs"

import { Button } from "@/components/ui/button"
import { clerkEnabled } from "@/lib/auth-config"
import { rememberFragment } from "@/lib/pending-share"
import { BASE, MATRIX_APP } from "@/lib/site"

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

/** A small dot for Clerk's menu items, which require an icon; the label carries the meaning. */
const Dot = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
    <circle cx="8" cy="8" r="3.5" />
  </svg>
)

/** The signed-in person's handle, from the authenticated route; null until known or when they have not published. */
function useOwnHandle(enabled: boolean): string | null | undefined {
  const [handle, setHandle] = React.useState<string | null | undefined>(undefined)
  React.useEffect(() => {
    if (!enabled) return
    let live = true
    fetch(`${BASE}/api/leaderboard/me`, { credentials: "same-origin", signal: AbortSignal.timeout(10_000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        const value = data && typeof data === "object" ? (data as Record<string, unknown>).handle : null
        if (live) setHandle(typeof value === "string" && HANDLE.test(value) ? value : null)
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error)) throw error
        if (live) setHandle(null)
      })
    return () => {
      live = false
    }
  }, [enabled])
  return handle
}

/** Signed in: Clerk's avatar menu with the site's own links. Signed out: a small "Sign in" link that keeps the satellite sync. */
function ClerkAccount() {
  const { isLoaded, isSignedIn } = useAuth()
  const clerk = useClerk()
  const handle = useOwnHandle(Boolean(isSignedIn))
  const [signInUrl, setSignInUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isLoaded || isSignedIn) return
    // buildSignInUrl adds the satellite's return URL and sync parameter, so the primary sends the person back here.
    setSignInUrl(clerk.buildSignInUrl({ signInFallbackRedirectUrl: window.location.href }))
  }, [clerk, isLoaded, isSignedIn])

  if (!isLoaded) return <span aria-hidden className="size-9" />
  if (!isSignedIn) {
    return (
      // Hidden on phones, where the header has room for one button; the publish panel has its own sign-in there.
      <Button variant="outline" size="lg" className="h-10 rounded-full px-4 max-sm:hidden sm:h-9" nativeButton={false} render={<a href={signInUrl ?? `${BASE}/leaderboard`} onClick={() => rememberFragment()} />}>
        Sign in
      </Button>
    )
  }
  const profile = handle ? `${BASE}/u/${handle}` : `${BASE}/#get`
  return (
    <UserButton appearance={{ elements: { avatarBox: "size-9" } }}>
      <UserButton.MenuItems>
        <UserButton.Link label={handle ? "My profile" : "My profile: how to publish"} labelIcon={<Dot />} href={profile} />
        <UserButton.Link label="Leaderboard" labelIcon={<Dot />} href={`${BASE}/leaderboard`} />
        <UserButton.Link label="People I referred" labelIcon={<Dot />} href={handle ? `${BASE}/u/${handle}#referred` : `${BASE}/#get`} />
        <UserButton.Link label="Open Matrix OS" labelIcon={<Dot />} href={MATRIX_APP} />
        <UserButton.Action label="manageAccount" />
        <UserButton.Action label="signOut" />
      </UserButton.MenuItems>
    </UserButton>
  )
}

/**
 * The header's account slot on pages that mount Clerk (/share, /leaderboard, /u). Without Clerk configured it falls back
 * to the leaderboard link the landing page uses, so it never calls a Clerk hook outside a ClerkProvider.
 */
export function AccountMenu() {
  if (!clerkEnabled) {
    return (
      <Button variant="outline" size="lg" className="h-10 rounded-full px-4 max-sm:hidden sm:h-9" nativeButton={false} render={<a href={`${BASE}/leaderboard`} />}>
        Leaderboard
      </Button>
    )
  }
  return <ClerkAccount />
}
