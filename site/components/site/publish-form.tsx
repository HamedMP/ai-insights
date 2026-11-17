"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { BreakfastNextStep, BreakfastNote } from "@/components/site/breakfast"
import { PublishPreview } from "@/components/site/publish-preview"
import { ShareButtons } from "@/components/site/share-buttons"
import { profilePost } from "@/lib/arena-format"
import { callEntryApi } from "@/lib/entry-api"
import { checkHandle, displayNameFor, suggestHandle } from "@/lib/leaderboard"
import { rememberFragment } from "@/lib/pending-share"
import { publishedLines, storedNotes } from "@/lib/publish-lines"
import { referralLink } from "@/lib/referral"
import { track } from "@/lib/analytics"
import { EVENTS } from "@/lib/analytics-sanitize"
import { type SharedStats } from "@/lib/share"
import { BASE, SITE_URL } from "@/lib/site"

/**
 * What the signed-in person already has: their computers' keys, to tell a new computer from a republish, and whether
 * their photo is showing now, so a republish keeps a photo they switched on instead of silently clearing it.
 */
export type Account = { devices: Array<{ key: string; legacy: boolean }>; photo: boolean } | null

export interface PublishUser {
  /** A Clerk username or first name, only to suggest a handle. */
  handleSource: string
  hasImage: boolean
  imageUrl: string
}

const SHORT = "Only what is shown below is published. The numbers are self-reported, not verified, and you can remove them any time."
const CHECK = "size-4 shrink-0 accent-primary"
const OPTION = "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[13px] leading-snug"

/**
 * The publish panel without Clerk: the auth state, the user and the account come in as props (publish-panel.tsx
 * reads them from Clerk), so it renders the same in a test. Publish sits at the top; the preview and the complete
 * disclosure follow it. `signedIn: null` means Clerk has not loaded yet.
 */
export function PublishPanelView({ stats, signedIn, user, account, signInButton }: { stats: SharedStats; signedIn: boolean | null; user: PublishUser | null; account: Account | "loading"; signInButton: (button: React.ReactElement) => React.ReactNode }) {
  const [handle, setHandle] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  // Off by default: the photo becomes public only when the person ticks the box, or already shows it (photo switch).
  const [avatarChoice, setShowAvatar] = React.useState<boolean | null>(null)
  // Off by default: a computer's name becomes public only when the person ticks the box on this publish.
  const [showDeviceName, setShowDeviceName] = React.useState(false)
  const [replaceLegacy, setReplaceLegacy] = React.useState<boolean | null>(null)
  const [state, setState] = React.useState<{ kind: "idle" | "busy" } | { kind: "done"; handle: string; duplicate: boolean; devices: number | undefined } | { kind: "removed" } | { kind: "error"; message: string }>({ kind: "idle" })
  const device = stats.device
  const known = account && account !== "loading" ? account.devices : []
  const showAvatar = avatarChoice ?? (account && account !== "loading" ? account.photo : false)
  const isKnownDevice = Boolean(device && known.some((d) => d.key === device.id))
  const hasLegacy = known.some((d) => d.legacy)
  // A first publish from 0.5 on the computer that published before: offer to replace that earlier entry, ticked when
  // it is the only one, since that is almost always the same computer.
  const offerReplace = Boolean(device && !isKnownDevice && hasLegacy)
  const replace = offerReplace && (replaceLegacy ?? known.length === 1)

  const suggested = suggestHandle(user?.handleSource ?? "")
  const value = touched ? handle : handle || suggested
  const checked = checkHandle(value)
  const shownName = displayNameFor(stats, checked.ok ? checked.handle : value || "you")

  if (signedIn === null) {
    return (
      <section aria-labelledby="publish" aria-busy="true" className="flex w-full flex-col gap-2 rounded-2xl border bg-card px-5 py-5">
        <h2 id="publish" className="text-lg font-semibold">Publish to the leaderboard</h2>
        <p className="text-sm text-muted-foreground">Checking whether you are signed in…</p>
      </section>
    )
  }

  if (!signedIn) {
    return (
      <section aria-labelledby="publish" className="flex w-full flex-col gap-3 rounded-2xl border bg-card px-5 py-5">
        <div className="flex flex-col gap-1">
          <h2 id="publish" className="text-lg font-semibold">Publish to the leaderboard</h2>
          <p className="text-sm text-muted-foreground">Put these numbers on the public AI Insights leaderboard. Sign in with your Matrix account first; you will see exactly what becomes public before anything is sent. Self-reported, not verified, and removable any time.</p>
        </div>
        <div>
          {signInButton(
            <Button size="lg" className="px-4" onClick={() => {
              track(EVENTS.publishClicked, { signedIn: false })
              rememberFragment()
            }}>Sign in to publish</Button>,
          )}
        </div>
        <BreakfastNote />
      </section>
    )
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault()
    if (!checked.ok) return
    track(EVENTS.publishClicked)
    setState({ kind: "busy" })
    const result = await callEntryApi("POST", device ? { handle: checked.handle, stats, showAvatar, showDeviceName: showDeviceName && Boolean(device.name), replaceLegacy: replace } : { handle: checked.handle, stats, showAvatar })
    // Whether a referrer was credited, as a boolean only: never whose.
    if (result.ok) track(EVENTS.publishCompleted, { referred: result.referred === true })
    setState(result.ok ? { kind: "done", handle: result.handle ?? checked.handle, duplicate: result.duplicate === true, devices: result.devices } : { kind: "error", message: result.error })
  }

  async function remove() {
    setState({ kind: "busy" })
    const result = await callEntryApi("DELETE")
    setState(result.ok ? { kind: "removed" } : { kind: "error", message: result.error })
  }

  if (state.kind === "done") {
    return (
      <section aria-labelledby="publish" className="flex w-full flex-col gap-3 rounded-2xl border bg-card px-5 py-5 text-sm">
        <h2 id="publish" className="text-lg font-semibold">Published</h2>
        <BreakfastNextStep />
        <p>Your profile is public now{state.devices && state.devices > 1 ? `, adding up ${state.devices} computers` : ""}. Share it: anyone who publishes after arriving through your link counts as referred by you.</p>
        {state.duplicate && (
          <p role="note" className="rounded-xl bg-[#ffe14a]/40 px-3 py-2">
            This computer published exactly the same period, sessions and tokens as another computer on your profile. That usually means both read one synced history folder. It is counted once, not twice; you can remove one of them on your profile.
          </p>
        )}
        <ShareButtons post={profilePost(referralLink(SITE_URL, state.handle))} url={referralLink(SITE_URL, state.handle)} />
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<a href={`${BASE}/u/${state.handle}`} />}>View your profile</Button>
          <Button variant="outline" nativeButton={false} render={<a href={`${BASE}/leaderboard`} />}>See the leaderboard</Button>
          <Button variant="destructive" onClick={remove}>Remove my entry</Button>
        </div>
      </section>
    )
  }

  if (state.kind === "removed") {
    return (
      <section aria-labelledby="publish" className="flex w-full flex-col gap-2 rounded-2xl border bg-card px-5 py-5">
        <h2 id="publish" className="text-lg font-semibold">Publish to the leaderboard</h2>
        <p className="text-sm">Your entry is removed from the leaderboard.</p>
      </section>
    )
  }

  const busy = state.kind === "busy"
  const lines = publishedLines(stats, { name: shownName, handle: checked.ok ? checked.handle : null, showAvatar, showDeviceName })
  const notes = storedNotes(stats, isKnownDevice)
  return (
    <section aria-labelledby="publish" className="flex w-full flex-col rounded-2xl border bg-card">
      <form onSubmit={publish} className="flex flex-col gap-3 border-b px-5 pt-5 pb-4 text-sm">
        <div className="flex flex-col gap-1">
          <h2 id="publish" className="text-lg font-semibold">Publish to the leaderboard</h2>
          <p className="text-muted-foreground">{SHORT}</p>
        </div>
        {/* DOM order is handle, options, Publish; from `sm` the button moves up beside the handle. */}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <label className="flex min-w-0 flex-col gap-1 sm:col-start-1 sm:row-start-1">
            <span className="sr-only">Public handle</span>
            <span className="flex h-9 items-center rounded-lg border bg-background focus-within:ring-3 focus-within:ring-ring/50">
              <span aria-hidden className="pl-3 font-mono text-[12px] text-muted-foreground select-none">ai-insights.app/u/</span>
              <input
                className="h-full min-w-0 flex-1 rounded-r-lg bg-transparent pr-3 font-mono outline-none"
                value={value}
                onChange={(e) => {
                  setTouched(true)
                  setHandle(e.target.value.toLowerCase())
                }}
                maxLength={30}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!checked.ok}
                aria-describedby="handle-help"
              />
            </span>
            <span id="handle-help" className={checked.ok ? "text-[12px] text-muted-foreground" : "text-[12px] text-destructive"}>
              {checked.ok ? "Your public handle: 3 to 30 lowercase letters, digits or hyphens." : checked.problem === "reserved" ? "That handle is reserved. Pick another." : "3 to 30 lowercase letters, digits or single hyphens."}
            </span>
          </label>
        {user?.hasImage || device?.name || offerReplace ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            {user?.hasImage ? (
              <label className={OPTION}>
                <input type="checkbox" className={CHECK} checked={showAvatar} onChange={(e) => setShowAvatar(e.target.checked)} />
                {/* eslint-disable-next-line @next/next/no-img-element -- the person's own Clerk photo, shown only to them here */}
                <img src={user.imageUrl} alt="" referrerPolicy="no-referrer" className="size-6 rounded-md object-cover" />
                <span>Show my Matrix account photo on my public profile and the leaderboard</span>
              </label>
            ) : null}
            {device?.name ? (
              <label className={OPTION}>
                <input type="checkbox" className={CHECK} checked={showDeviceName} onChange={(e) => setShowDeviceName(e.target.checked)} />
                <span>Show this computer&rsquo;s name, &ldquo;{device.name}&rdquo;, on my public profile</span>
              </label>
            ) : null}
            {offerReplace ? (
              <label className={`${OPTION} items-start`}>
                <input type="checkbox" className={`${CHECK} mt-0.5`} checked={replace} onChange={(e) => setReplaceLegacy(e.target.checked)} />
                <span>This is the computer I published from before. Replace that earlier publish instead of adding this as another computer (otherwise the same history would count twice).</span>
              </label>
            ) : null}
          </div>
        ) : null}
        {state.kind === "error" && <p role="alert" className="text-destructive sm:col-span-2">{state.message}</p>}
          <Button type="submit" size="lg" className="px-5 max-sm:w-full sm:col-start-2 sm:row-start-1" disabled={!checked.ok || busy}>{busy ? "Publishing…" : "Publish"}</Button>
        </div>
      </form>
      <BreakfastNote />

      <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
        <h3 className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">Your public profile will show</h3>
        <PublishPreview stats={stats} name={shownName} handle={checked.ok ? checked.handle : null} avatarUrl={showAvatar && user?.hasImage ? user.imageUrl : null} />

        <details className="group rounded-xl border bg-muted/30 text-sm" data-testid="publish-disclosure">
          <summary className="cursor-pointer list-none rounded-xl px-4 py-3 font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="mr-2 inline-block text-muted-foreground transition-transform group-open:rotate-90">›</span>
            See every line that will be published
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-card px-3 py-2.5 text-[13px]">
              {lines.map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
          <span>Published before and want it gone?</span>
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>Remove my entry</Button>
        </div>
      </div>
    </section>
  )
}
