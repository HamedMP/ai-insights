"use client"

import * as React from "react"
import { SignInButton, useAuth, useUser } from "@clerk/nextjs"

import { Button } from "@/components/ui/button"
import { checkHandle, displayNameFor, suggestHandle } from "@/lib/leaderboard"
import { rememberFragment } from "@/lib/pending-share"
import { track } from "@/lib/analytics"
import { EVENTS } from "@/lib/analytics-sanitize"
import { ShareButtons } from "@/components/site/share-buttons"
import { profilePost } from "@/lib/arena-format"
import { referralLink } from "@/lib/referral"
import { agentName, CARD_TITLES, EARNED_TITLES, formatInt, formatPeriod, RATIOS, ratioText, type SharedStats } from "@/lib/share"
import { BASE, SITE_URL } from "@/lib/site"

const ENTRY_API = `${BASE}/api/leaderboard/entry`

/** Client-side messages are shown only from this list; anything else from the server becomes the generic one. */
const KNOWN_ERRORS = new Set([
  "This request did not come from the AI Insights site.",
  "Sign in to publish to the leaderboard.",
  "That is not a valid AI Insights stats payload.",
  "Handles are 3 to 30 lowercase letters, digits or single hyphens, starting and ending with a letter or digit.",
  "That handle is reserved. Pick another.",
  "That handle is taken. Pick another.",
  "Too many changes in a short time. Try again in a minute.",
  "Your account already has 10 computers, the most it can hold. Remove one on your profile, then publish again.",
])
const GENERIC = "Something went wrong. Try again later."

export async function callEntryApi(method: "POST" | "DELETE", body?: unknown): Promise<{ ok: true; handle?: string; referred?: boolean; duplicate?: boolean; devices?: number } | { ok: false; error: string }> {
  try {
    const res = await fetch(ENTRY_API, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal: AbortSignal.timeout(10_000),
    })
    const data: unknown = await res.json().catch((error: unknown) => {
      if (error instanceof SyntaxError) return null
      throw error
    })
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {}
    if (res.ok && record.ok === true) return { ok: true, handle: typeof record.handle === "string" ? record.handle : undefined, referred: record.referred === true, duplicate: record.duplicate === true, devices: typeof record.devices === "number" && record.devices >= 1 && record.devices <= 10 ? Math.round(record.devices) : undefined }
    const error = typeof record.error === "string" && KNOWN_ERRORS.has(record.error) ? record.error : GENERIC
    return { ok: false, error }
  } catch (error) {
    if (error instanceof Error) return { ok: false, error: GENERIC }
    throw error
  }
}

/** What the signed-in person already has: their computers' keys, to tell a new computer from a republish. */
type Account = { devices: Array<{ key: string; legacy: boolean }> } | null

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
        if (live) setAccount(d.ok === true ? { devices } : null)
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

/** Under a valid /share card: sign in, pick a handle, see exactly what becomes public, then publish or remove. */
export function PublishPanel({ stats }: { stats: SharedStats }) {
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const [handle, setHandle] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  // Off by default: the photo becomes public only when the person ticks the box on this publish.
  const [showAvatar, setShowAvatar] = React.useState(false)
  // Off by default: a computer's name becomes public only when the person ticks the box on this publish.
  const [showDeviceName, setShowDeviceName] = React.useState(false)
  const [replaceLegacy, setReplaceLegacy] = React.useState<boolean | null>(null)
  const [state, setState] = React.useState<{ kind: "idle" | "busy" } | { kind: "done"; handle: string; duplicate: boolean; devices: number | undefined } | { kind: "removed" } | { kind: "error"; message: string }>({ kind: "idle" })
  const account = useAccount(isSignedIn)
  const device = stats.device
  const known = account && account !== "loading" ? account.devices : []
  const isKnownDevice = Boolean(device && known.some((d) => d.key === device.id))
  const hasLegacy = known.some((d) => d.legacy)
  // A first publish from 0.5 on the computer that published before: offer to replace that earlier entry, ticked when
  // it is the only one, since that is almost always the same computer.
  const offerReplace = Boolean(device && !isKnownDevice && hasLegacy)
  const replace = offerReplace && (replaceLegacy ?? known.length === 1)

  const suggested = suggestHandle(user?.username ?? user?.firstName ?? "")
  const value = touched ? handle : handle || suggested
  const checked = checkHandle(value)
  const shownName = displayNameFor(stats, checked.ok ? checked.handle : value || "you")

  React.useEffect(() => {
    if (!isSignedIn) return
    // Lets the server record, once, that this Matrix account has used AI Insights (see lib/signup-source.ts).
    void fetch(`${BASE}/api/leaderboard/seen`, { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(10_000) }).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error
    })
  }, [isSignedIn])

  if (!isLoaded) return null

  if (!isSignedIn) {
    return (
      <section aria-labelledby="publish" className="flex w-full max-w-[34rem] flex-col items-center gap-3 rounded-2xl border bg-card px-5 py-5 text-center">
        <h2 id="publish" className="text-lg font-semibold">Publish to the leaderboard</h2>
        <p className="text-sm text-muted-foreground">Put these numbers on the public AI Insights leaderboard. Sign in with your Matrix account first; you will see exactly what becomes public before anything is sent.</p>
        <SignInButton mode="redirect">
          <Button onClick={() => {
            track(EVENTS.publishClicked, { signedIn: false })
            rememberFragment()
          }}>Sign in to publish</Button>
        </SignInButton>
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

  const rows: Array<[string, string]> = [
    ["Name", shownName],
    ...(device ? [["This computer", device.name && showDeviceName ? device.name : `shown as “Device 1”, “Device 2”…${device.name ? " (its name stays private)" : ""}`] as [string, string]] : []),
    ["Photo", showAvatar ? "your Matrix account photo, if you uploaded one" : "not shown (initials instead)"],
    ["Profile", `ai-insights.app/u/${checked.ok ? checked.handle : "…"}`],
    ["Period", formatPeriod(stats.from, stats.to)],
    ["Sessions", formatInt(stats.sessions)],
    ["Tokens", formatInt(stats.tokens)],
    ["Estimated spend", stats.usd === null ? "not shown" : `$${formatInt(stats.usd)}`],
    ["Active days", formatInt(stats.activeDays)],
    ["Longest streak", `${formatInt(stats.streak)} days`],
    ["Agents", stats.agents.length ? stats.agents.map((a) => `${agentName(a.k)} ${a.p}%`).join(", ") : "none"],
    ["Fun fact", stats.fact || "none"],
    ...(stats.titles ?? []).map((t): [string, string] => [`Title: ${EARNED_TITLES[t.k].title}`, EARNED_TITLES[t.k].rule(t.v)]),
    ...(stats.ratios?.length ? [["Ratios", stats.ratios.map((r) => `${RATIOS[r.k].label} ${ratioText(r.k, r.v)}`).join(", ")] as [string, string]] : []),
    ...(stats.cards ?? []).map((c): [string, string] => [`Card: ${CARD_TITLES[c.k]}`, c.c ? `${c.b}, ${c.c}` : c.b]),
  ]

  return (
    <section aria-labelledby="publish" className="flex w-full max-w-[34rem] flex-col gap-4 rounded-2xl border bg-card px-5 py-5">
      <h2 id="publish" className="text-lg font-semibold">Publish to the leaderboard</h2>
      {state.kind === "done" ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>Published. Your profile is public now{state.devices && state.devices > 1 ? `, adding up ${state.devices} computers` : ""}. Share it: anyone who publishes after arriving through your link counts as referred by you.</p>
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
        </div>
      ) : state.kind === "removed" ? (
        <p className="text-sm">Your entry is removed from the leaderboard.</p>
      ) : (
        <form onSubmit={publish} className="flex flex-col gap-4 text-sm">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Public handle</span>
            <input
              className="h-9 rounded-lg border bg-background px-3 font-mono outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
            <span id="handle-help" className="text-muted-foreground">
              {checked.ok ? "3 to 30 lowercase letters, digits or hyphens." : checked.problem === "reserved" ? "That handle is reserved. Pick another." : "3 to 30 lowercase letters, digits or single hyphens."}
            </span>
          </label>
          {user?.hasImage ? (
            <label className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
              <input type="checkbox" className="size-4 accent-primary" checked={showAvatar} onChange={(e) => setShowAvatar(e.target.checked)} />
              {/* eslint-disable-next-line @next/next/no-img-element -- the person's own Clerk photo, shown only to them here */}
              <img src={user.imageUrl} alt="" referrerPolicy="no-referrer" className="size-8 rounded-lg object-cover" />
              <span>Show my Matrix account photo on my public profile and the leaderboard</span>
            </label>
          ) : null}
          {device?.name ? (
            <label className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
              <input type="checkbox" className="size-4 accent-primary" checked={showDeviceName} onChange={(e) => setShowDeviceName(e.target.checked)} />
              <span>Show this computer&rsquo;s name, &ldquo;{device.name}&rdquo;, on my public profile</span>
            </label>
          ) : null}
          {offerReplace ? (
            <label className="flex items-start gap-3 rounded-xl border px-3 py-2.5">
              <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={replace} onChange={(e) => setReplaceLegacy(e.target.checked)} />
              <span>This is the computer I published from before. Replace that earlier publish instead of adding this as another computer (otherwise the same history would count twice).</span>
            </label>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="font-medium">This becomes public, exactly as shown:</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-muted/50 px-4 py-3">
              {rows.map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p className="text-muted-foreground">
              {stats.cards ? null : "This link is from an older report, so your profile will show these numbers without recap cards. Run the command again for a link with cards. "}
              Nothing else is sent: no projects, prompts or history. The numbers are self-reported from your own report and are not verified.{" "}
              {device
                ? `Also stored, never shown: this computer's random id (made by AI Insights, not from its name or hardware), so publishing again from it replaces only its numbers${stats.days ? ", and which days it was active (dates only), so streaks can be combined across computers" : ""}. ${isKnownDevice ? "This computer is already on your profile: this publish replaces its numbers." : "Your profile adds up every computer you publish from."} You can remove a computer, or everything, any time.`
                : "This link has no device id (an older report), so it replaces your earlier publish from an older report. You can remove it any time."}
            </p>
          </div>
          {state.kind === "error" && <p role="alert" className="text-destructive">{state.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!checked.ok || state.kind === "busy"}>{state.kind === "busy" ? "Publishing…" : "Publish"}</Button>
            <Button type="button" variant="ghost" onClick={remove} disabled={state.kind === "busy"}>Remove my entry</Button>
          </div>
        </form>
      )}
    </section>
  )
}
