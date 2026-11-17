"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { clerkEnabled } from "@/lib/auth-config"
import { rememberFragment } from "@/lib/pending-share"
import { hasSessionHint } from "@/lib/session-hint"
import { BASE } from "@/lib/site"
import { cn } from "@/lib/utils"

// Loaded only when the session hint is present; this file itself imports no Clerk code (tests/site/account.test.ts).
const ClerkSlot = React.lazy(() => import("@/components/site/clerk-slot"))

const SIGN_IN = "inline-flex h-8 items-center rounded-md px-2 font-mono text-[11.5px] tracking-[0.08em] text-ink-soft uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"

const noSubscribe = () => () => {}
const readHint = () => hasSessionHint(document.cookie)

/**
 * The header's account slot on pages that do not mount Clerk. Anonymous visitors (and the server render, which is the
 * same cached HTML for everyone) get a quiet "Sign in" link to /account/sign-in, where Clerk runs. A browser that has
 * signed in here before loads the real account menu on demand instead.
 */
export function SessionAccount({ className }: { className?: string }) {
  const pathname = usePathname() || "/"
  const hint = React.useSyncExternalStore(noSubscribe, readHint, () => false)
  if (!clerkEnabled) return null
  const link = (
    // On /share the numbers live in the fragment, which must never go into `to`: keep it in the tab for the way back.
    <a className={cn(SIGN_IN, className)} href={`${BASE}/account/sign-in?to=${encodeURIComponent(pathname)}`} onClick={() => pathname.startsWith("/share") && rememberFragment()}>
      Sign in
    </a>
  )
  if (!hint) return link
  return (
    <React.Suspense fallback={<span aria-hidden className="block size-7 rounded-full bg-muted" />}>
      <ClerkSlot signIn={link} />
    </React.Suspense>
  )
}
