"use client"

/**
 * Temporary: the Slush AI Breakfast Club prompts on /share (before and after publishing), /leaderboard and the
 * landing page (visitors in Finland). Delete this file, lib/breakfast.ts, their uses (publish-form.tsx,
 * board-view.tsx, app/page.tsx, proxy.ts), the event and preview-parameter lines in lib/analytics-sanitize.ts,
 * tests/site/breakfast.test.ts and tests/site-render/breakfast.test.ts once the breakfast has started.
 *
 * Those pages are cached, the same HTML for everyone, so the time (and, on the landing page, the Finland flag) is
 * checked in the browser: the server renders nothing, and the prompt appears after hydration only while the
 * breakfast is still ahead. After the cutoff nothing appears and nothing moves.
 */

import * as React from "react"

import { CopyButton } from "@/components/site/copy-button"
import { Button } from "@/components/ui/button"
import { track } from "@/lib/analytics"
import { EVENTS } from "@/lib/analytics-sanitize"
import { BREAKFAST_REGISTER_URL as REGISTER, BREAKFAST_UNTIL, showLandingBreakfast } from "@/lib/breakfast"
import { COMMAND } from "@/lib/site"

export { BREAKFAST_UNTIL }

type Placement = "share_before" | "share_after_publish" | "leaderboard" | "landing"

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
export function BreakfastNote({ now, className = "" }: { now?: number; className?: string }) {
  if (!useBeforeBreakfast(now)) return null
  return (
    <div role="note" className={`${className} flex flex-col gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-[13px] leading-snug sm:flex-row sm:items-center sm:justify-between sm:gap-4`}>
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

const landingInBrowser = () => showLandingBreakfast({ now: Date.now(), cookies: document.cookie, search: window.location.search })

/**
 * On the landing page, under the hero: shown for the Finland flag the proxy sets (lib/breakfast.ts) or the
 * `?breakfast=1` preview. The props are for tests; without them the server says no and the browser decides.
 */
export function BreakfastLanding({ now, cookies = "", search = "" }: { now?: number; cookies?: string; search?: string }) {
  const browser = React.useSyncExternalStore(noSubscribe, landingInBrowser, () => false)
  if (!(now === undefined ? browser : showLandingBreakfast({ now, cookies, search }))) return null
  return (
    <section aria-labelledby="breakfast" className="relative mx-auto -mt-6 max-w-6xl px-4 pb-14 md:-mt-10 md:px-8 lg:-mt-14 lg:pb-20">
      <div className="flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/10 px-5 py-5 md:flex-row md:items-center md:justify-between md:gap-8 md:px-7">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <span className="font-mono text-xs tracking-wide text-primary">In Helsinki for Slush?</span>
          <h2 id="breakfast" className="text-[1.35rem] leading-tight font-semibold tracking-[-0.02em] md:text-[1.6rem]">Slush AI Breakfast Club · Thu 19 Nov, 8:00–10:00</h2>
          <p className="text-[15px] leading-relaxed text-ink-soft">Matrix OS is hosting a breakfast on AI insights, real usage and upskilling. Run your report, publish to the leaderboard and register: we&rsquo;re sending invites to people on the leaderboard.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <Button size="lg" className="h-11 rounded-full px-5 text-[15px]" nativeButton={false} render={<RegisterLink placement="landing" />}>Register for the breakfast</Button>
          <span className="inline-flex h-11 items-center gap-2 rounded-full border bg-background/70 pr-1.5 pl-4 font-mono text-[13px]">
            {COMMAND}
            <CopyButton text={COMMAND} trackAs="breakfast" ariaLabel={`Copy: ${COMMAND}`} className="h-8 rounded-full" />
          </span>
        </div>
      </div>
    </section>
  )
}
