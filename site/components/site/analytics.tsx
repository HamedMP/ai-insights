"use client"

import * as React from "react"

import { startAnalytics, track } from "@/lib/analytics"
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
