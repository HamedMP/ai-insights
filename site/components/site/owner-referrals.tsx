"use client"

import * as React from "react"

import { RemoveEntry } from "@/components/site/rank-share"
import { hasSessionHint } from "@/lib/session-hint"
import { BASE, COMMAND } from "@/lib/site"

const API = `${BASE}/api/leaderboard/referrals`
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const MAX_SHOWN = 100

interface Referred {
  handle: string
  displayName: string
  referredAt: string
}
type Mine = { count: number; referrals: Referred[] }

/** Only the shape the route promises, with every string checked; anything else means "show nothing". */
function parse(data: unknown, handle: string): Mine | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (d.ok !== true || d.handle !== handle || typeof d.count !== "number" || !Array.isArray(d.referrals)) return null
  const referrals: Referred[] = []
  for (const entry of d.referrals.slice(0, MAX_SHOWN)) {
    const r = (entry ?? {}) as Record<string, unknown>
    if (typeof r.handle !== "string" || !HANDLE.test(r.handle) || typeof r.displayName !== "string" || typeof r.referredAt !== "string" || Number.isNaN(Date.parse(r.referredAt))) continue
    referrals.push({ handle: r.handle, displayName: r.displayName.slice(0, 40), referredAt: r.referredAt })
  }
  return { count: Math.max(0, Math.round(d.count)), referrals }
}

/**
 * Shown only to the profile's owner: asks the authenticated referrals route, which answers about the caller alone,
 * and renders only when the answer is for this profile's handle. Visitors (and signed-out owners) see nothing here.
 */
export function OwnerReferrals({ handle, hasCards }: { handle: string; hasCards: boolean }) {
  const [mine, setMine] = React.useState<Mine | null>(null)
  React.useEffect(() => {
    // Only a browser that has signed in here can be the owner: everyone else skips the request (lib/session-hint.ts).
    if (!hasSessionHint(document.cookie)) return
    let live = true
    fetch(API, { credentials: "same-origin", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (live) setMine(parse(data, handle))
      })
      .catch((error: unknown) => {
        // Signed out, offline or a redirect: the panel simply stays hidden.
        if (!(error instanceof Error)) throw error
      })
    return () => {
      live = false
    }
  }, [handle])

  if (!mine) return null
  return (
    <section aria-labelledby="referred" className="flex flex-col gap-4 rounded-2xl border-2 border-dashed border-primary/40 bg-card px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <p className="text-[14px]">
          <span className="font-semibold">This is your profile.</span>{" "}
          <span className="text-muted-foreground">To update it, run <code className="font-mono">{COMMAND}</code> and publish from the new report&rsquo;s share link.</span>
        </p>
        <RemoveEntry />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="referred" className="scroll-mt-24 text-lg font-semibold">People you referred</h2>
        <span className="font-mono text-[11px] text-muted-foreground">only you see this list</span>
      </div>
      {!hasCards && (
        <p className="rounded-xl bg-primary/10 px-4 py-3 text-[14px]">
          Your profile has no recap cards yet. Run <code className="font-mono">{COMMAND}</code>, open the share link from the new report and press Publish: the cards replace this notice.
        </p>
      )}
      <p className="flex items-baseline gap-2">
        <span className="text-[2.2rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">{mine.count}</span>
        <span className="text-muted-foreground">{mine.count === 1 ? "person published after arriving through your link" : "people published after arriving through your links"}</span>
      </p>
      {mine.referrals.length > 0 ? (
        <ol className="flex flex-col divide-y rounded-xl border">
          {mine.referrals.map((r) => (
            <li key={r.handle} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <a href={`${BASE}/u/${r.handle}`} className="flex min-w-0 flex-col underline-offset-4 hover:underline">
                <span className="truncate font-medium">{r.displayName}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">@{r.handle}</span>
              </a>
              <time dateTime={r.referredAt} className="shrink-0 font-mono text-[11px] text-muted-foreground">{DATE.format(new Date(r.referredAt))}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[14px] text-muted-foreground">No one yet. Share your profile with the buttons above: anyone who publishes after arriving through your link shows up here.</p>
      )}
    </section>
  )
}
