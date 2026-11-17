import type { PostHog } from "posthog-js"

import { sanitizeEvent, type EventName } from "@/lib/analytics-sanitize"

/** Set at build time. Without it nothing below loads: posthog-js is only imported when a key exists. */
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ""
/** PostHog's UI host (EU), used only for links inside PostHog; events go through the same-origin /relay rewrite. */
const UI_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.posthog.com"

let client: Promise<PostHog | null> | null = null

/** Starts PostHog once, in the browser, when a key is configured. */
export function startAnalytics(): Promise<PostHog | null> {
  if (client) return client
  if (!POSTHOG_KEY || typeof window === "undefined") return (client = Promise.resolve(null))
  client = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(POSTHOG_KEY, {
      api_host: "/relay",
      ui_host: UI_HOST,
      capture_pageview: "history_change",
      capture_pageleave: true,
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      respect_dnt: true,
      person_profiles: "identified_only",
      persistence: "localStorage",
      before_send: (event) => sanitizeEvent(event),
    })
    return posthog
  })
  return client
}

/** Capture a named event; a no-op without a key. Callers pass only coarse, non-identifying properties. */
export function track(event: EventName, properties?: Record<string, string | number | boolean>) {
  if (!POSTHOG_KEY) return
  void startAnalytics().then((posthog) => posthog?.capture(event, properties))
}

/** A pageview PostHog does not see on its own (a client navigation that changes only the query string). */
export function trackPageview() {
  if (!POSTHOG_KEY) return
  void startAnalytics().then((posthog) => posthog?.capture("$pageview"))
}
