"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { startAnalytics, track, trackPageview } from "@/lib/analytics"
import { boardViewPath } from "@/lib/leaderboard"
import type { EventName } from "@/lib/analytics-sanitize"

/** Mounted in the root layout only when NEXT_PUBLIC_POSTHOG_KEY is set at build time. */
export function Analytics() {
  React.useEffect(() => {
    void startAnalytics()
  }, [])
  return null
}

/** Fires one event when a server-rendered page mounts (for example, which leaderboard arena was viewed). */
export function TrackOnMount({ event, properties }: { event: EventName; properties?: Record<string, string | number | boolean> }) {
  const key = JSON.stringify(properties ?? {})
  React.useEffect(() => {
    track(event, JSON.parse(key) as Record<string, string | number | boolean>)
  }, [event, key])
  return null
}

/**
 * One pageview per board view. PostHog counts a pageview when the path changes; moving between sorts or pages of the
 * leaderboard changes only the query string, and since those are client navigations now, nothing else would count
 * them. Only the sort and page count, so Clerk tidying its own parameter out of the URL is not a new view.
 */
export function BoardPageview() {
  const params = useSearchParams()
  const view = boardViewPath(new URLSearchParams(params?.toString() ?? ""))
  const last = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (last.current !== null && last.current !== view) trackPageview()
    last.current = view
  }, [view])
  return null
}
