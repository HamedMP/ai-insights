"use client"

import * as React from "react"
import { UserButton, useAuth, useClerk } from "@clerk/nextjs"
import { usePathname } from "next/navigation"

import { cachedClerkPage, clerkEnabled } from "@/lib/auth-config"
import { rememberFragment } from "@/lib/pending-share"
import { BASE, MATRIX_APP } from "@/lib/site"
import { cn } from "@/lib/utils"

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
/** The header's quiet text link style, shared with the landing page's signed-out slot (session-account.tsx). */
export const SIGN_IN_CLASS = "inline-flex h-8 items-center rounded-md px-2 font-mono text-[11.5px] tracking-[0.08em] text-ink-soft uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"

function ClerkAccount({ signIn }: { signIn?: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth()
  const clerk = useClerk()
  const handle = useOwnHandle(Boolean(isSignedIn))
  const pathname = usePathname() || "/"
  const [signInUrl, setSignInUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isLoaded || isSignedIn) return
    // The cached leaderboard and profiles skip the satellite sync for a browser checked recently (lib/auth-config.ts
    // clerkRun), so someone who has since signed in on Matrix OS is not recognised yet, and the primary's sign-in page
    // would not send them back. /account/sign-in always runs the sync first. The fragment is never put in the query:
    // rememberFragment keeps it in the tab.
    if (cachedClerkPage(pathname)) setSignInUrl(`${BASE}/account/sign-in?to=${encodeURIComponent(pathname + window.location.search)}`)
    // buildSignInUrl adds the satellite's return URL and sync parameter, so the primary sends the person back here.
    else setSignInUrl(clerk.buildSignInUrl({ signInFallbackRedirectUrl: window.location.href }))
  }, [clerk, isLoaded, isSignedIn, pathname])

  if (!isLoaded) return <span aria-hidden className="block size-7 rounded-full bg-muted" />
  if (!isSignedIn) {
    if (signIn) return <>{signIn}</>
    return (
      // Hidden on phones, where the header has room for one button; the publish panel has its own sign-in there.
      <a
        className={cn(SIGN_IN_CLASS, "max-sm:hidden")}
        href={signInUrl ?? `${BASE}/leaderboard`}
        onClick={(event) => {
          rememberFragment()
          // A client navigation between sorts may have changed the query since the link was built.
          if (cachedClerkPage(window.location.pathname)) event.currentTarget.href = `${BASE}/account/sign-in?to=${encodeURIComponent(window.location.pathname + window.location.search)}`
        }}
      >
        Sign in
      </a>
    )
  }
  const profile = handle ? `${BASE}/u/${handle}` : `${BASE}/#get`
  return (
    <UserButton appearance={{ elements: { avatarBox: "size-7" } }}>
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
 * The header's account slot where Clerk is mounted: the pages that mount it, and the on-demand slot other pages load for
 * a browser that has signed in here before (clerk-slot.tsx, which passes its own `signIn` link). Without Clerk
 * configured there is nothing to show, so it never calls a Clerk hook outside a ClerkProvider.
 */
export function AccountMenu({ signIn }: { signIn?: React.ReactNode } = {}) {
  if (!clerkEnabled) return null
  return <ClerkAccount signIn={signIn} />
}
