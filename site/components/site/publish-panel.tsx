"use client"

import * as React from "react"
import { useAuth, useUser } from "@clerk/nextjs"

import { PublishPanelView, type Account } from "@/components/site/publish-form"
import { signInHandoff } from "@/components/site/sign-in-link"
import { BASE } from "@/lib/site"
import { type SharedStats } from "@/lib/share"

function useAccount(signedIn: boolean | undefined): Account | "loading" {
  const [account, setAccount] = React.useState<Account | "loading">("loading")
  React.useEffect(() => {
    if (!signedIn) return
    let live = true
    fetch(`${BASE}/api/leaderboard/devices`, { credentials: "same-origin", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        const d = (data ?? {}) as Record<string, unknown>
        const devices = Array.isArray(d.devices)
          ? d.devices.slice(0, 10).map((x) => (x ?? {}) as Record<string, unknown>).filter((x) => typeof x.key === "string").map((x) => ({ key: x.key as string, legacy: x.legacy === true }))
          : []
        if (live) setAccount(d.ok === true ? { devices, photo: d.photo === true } : null)
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error)) throw error
        if (live) setAccount(null)
      })
    return () => {
      live = false
    }
  }, [signedIn])
  return account
}

/**
 * Under a valid /share card, in a browser that has signed in here (publish-slot.tsx): Clerk's sign-in state, handed to
 * the Clerk-free panel (publish-form.tsx). A signed-out answer (an expired session) signs in through /account/sign-in.
 */
export function PublishPanel({ stats }: { stats: SharedStats }) {
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const account = useAccount(isSignedIn)

  React.useEffect(() => {
    if (!isSignedIn) return
    // Lets the server record, once, that this Matrix account has used AI Insights (see lib/signup-source.ts).
    void fetch(`${BASE}/api/leaderboard/seen`, { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(10_000) }).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error
    })
  }, [isSignedIn])

  return (
    <PublishPanelView
      stats={stats}
      signedIn={isLoaded ? Boolean(isSignedIn) : null}
      user={user ? { handleSource: user.username ?? user.firstName ?? "", hasImage: user.hasImage, imageUrl: user.imageUrl } : null}
      account={account}
      signInButton={signInHandoff}
    />
  )
}
