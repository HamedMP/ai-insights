"use client"

/**
 * Temporary: the Slush AI Breakfast Club prompts on /share (before and after publishing) and /leaderboard.
 * Delete this file, its three uses (publish-form.tsx, board-view.tsx), its event in lib/analytics-sanitize.ts and
 * tests/site-render/breakfast.test.ts once the breakfast has started.
 *
 * Those pages are cached, the same HTML for everyone, so the time is checked in the browser: the server renders
 * nothing, and the prompt appears after hydration only while the breakfast is still ahead. After the cutoff nothing
 * appears and nothing moves.
 */

import * as React from "react"

import { Button } from "@/components/ui/button"
import { track } from "@/lib/analytics"
import { EVENTS } from "@/lib/analytics-sanitize"

/** 08:00 Helsinki (EET, UTC+2) on Thursday 19 November 2026, when the breakfast starts. The only copy on the site. */
export const BREAKFAST_UNTIL = Date.UTC(2026, 10, 19, 6, 0, 0)
const REGISTER = "https://luma.com/4yb5xhzs"

type Placement = "share_before" | "share_after_publish" | "leaderboard"

const noSubscribe = () => () => {}

/** `now` is for tests; without it the server says no and the browser reads its own clock. */
function useBeforeBreakfast(now?: number): boolean {
  const browser = React.useSyncExternalStore(noSubscribe, () => Date.now() < BREAKFAST_UNTIL, () => false)
  return now === undefined ? browser : now < BREAKFAST_UNTIL
}

/** The Luma link, counted on click. Other props (a Button's classes and attributes) pass through. */
function RegisterLink({ placement, onClick, ...rest }: { placement: Placement } & React.ComponentProps<"a">) {
  return (
    <a
      href={REGISTER}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
      onClick={(event) => {
        track(EVENTS.breakfastRegisterClicked, { placement })
        onClick?.(event)
      }}
    />
  )
}

const LINK = "font-medium text-foreground underline underline-offset-4 decoration-primary hover:decoration-foreground"

/** On /share under the Publish (or sign-in) button. */
export function BreakfastNote({ now }: { now?: number }) {
  if (!useBeforeBreakfast(now)) return null
  return (
    <div role="note" className="mx-5 mb-4 flex flex-col gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-[13px] leading-snug sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p>
        <span className="font-medium">Slush AI Breakfast Club · Thu 19 Nov, 8:00–10:00, Helsinki.</span> Publish, then register: we&rsquo;re sending breakfast invites to people on the leaderboard.
      </p>
      <RegisterLink placement="share_before" className={`${LINK} shrink-0 whitespace-nowrap`}>Register for the breakfast</RegisterLink>
    </div>
  )
}

/** On /share in the Published state: the step that is still left. */
export function BreakfastNextStep({ now }: { now?: number }) {
  if (!useBeforeBreakfast(now)) return null
  return (
    <div role="note" className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[15px] font-medium">You&rsquo;re on the leaderboard. One more step: register for the breakfast.</p>
      <Button size="lg" className="px-4" nativeButton={false} render={<RegisterLink placement="share_after_publish" />}>Register for the breakfast</Button>
    </div>
  )
}

/** On /leaderboard, above the board. */
export function BreakfastStrip({ now }: { now?: number }) {
  if (!useBeforeBreakfast(now)) return null
  return (
    <p role="note" className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-[13.5px] leading-snug">
      <span className="font-medium">Slush AI Breakfast Club · Thu 19 Nov, Helsinki.</span> On the leaderboard? <RegisterLink placement="leaderboard" className={LINK}>Register for the breakfast</RegisterLink>.
    </p>
  )
}
