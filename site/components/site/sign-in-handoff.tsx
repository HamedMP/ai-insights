"use client"

import * as React from "react"
import { useAuth, useClerk } from "@clerk/nextjs"

import { clerkEnabled } from "@/lib/auth-config"
import { BASE } from "@/lib/site"

function ClerkHandoff({ to }: { to: string }) {
  const { isLoaded, isSignedIn } = useAuth()
  const clerk = useClerk()
  React.useEffect(() => {
    if (!isLoaded) return
    // `to` is already a same-site path (lib/session-hint.ts returnPath); BASE keeps it inside the site.
    if (isSignedIn) window.location.replace(`${BASE}${to}`)
    else window.location.assign(clerk.buildSignInUrl({ signInFallbackRedirectUrl: window.location.href }))
  }, [clerk, isLoaded, isSignedIn, to])
  return <p className="font-mono text-[12px] tracking-[0.08em] text-muted-foreground uppercase" role="status">Opening Matrix sign-in…</p>
}

/** Sends the visitor to the Matrix sign-in, or straight back when they are already signed in. */
export function SignInHandoff({ to }: { to: string }) {
  if (!clerkEnabled) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Sign-in is not available here yet.</h1>
        <a className="underline underline-offset-4" href={`${BASE}${to}`}>Go back</a>
      </>
    )
  }
  return <ClerkHandoff to={to} />
}
