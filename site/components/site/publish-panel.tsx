"use client"

import * as React from "react"
import { SignInButton, useAuth, useUser } from "@clerk/nextjs"

import { Button } from "@/components/ui/button"
import { checkHandle, displayNameFor, suggestHandle } from "@/lib/leaderboard"
import { rememberFragment } from "@/lib/pending-share"
import { track } from "@/lib/analytics"
import { EVENTS } from "@/lib/analytics-sanitize"
import { agentName, formatInt, formatPeriod, type SharedStats } from "@/lib/share"
import { BASE } from "@/lib/site"

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
])
const GENERIC = "Something went wrong. Try again later."

export async function callEntryApi(method: "POST" | "DELETE", body?: unknown): Promise<{ ok: true; handle?: string } | { ok: false; error: string }> {
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
    if (res.ok && record.ok === true) return { ok: true, handle: typeof record.handle === "string" ? record.handle : undefined }
    const error = typeof record.error === "string" && KNOWN_ERRORS.has(record.error) ? record.error : GENERIC
    return { ok: false, error }
  } catch (error) {
    if (error instanceof Error) return { ok: false, error: GENERIC }
    throw error
  }
}

/** Under a valid /share card: sign in, pick a handle, see exactly what becomes public, then publish or remove. */
export function PublishPanel({ stats }: { stats: SharedStats }) {
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const [handle, setHandle] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  const [state, setState] = React.useState<{ kind: "idle" | "busy" } | { kind: "done"; handle: string } | { kind: "removed" } | { kind: "error"; message: string }>({ kind: "idle" })

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
    const result = await callEntryApi("POST", { handle: checked.handle, stats })
    if (result.ok) track(EVENTS.publishCompleted)
    setState(result.ok ? { kind: "done", handle: result.handle ?? checked.handle } : { kind: "error", message: result.error })
  }

  async function remove() {
    setState({ kind: "busy" })
    const result = await callEntryApi("DELETE")
    setState(result.ok ? { kind: "removed" } : { kind: "error", message: result.error })
  }

  const rows: Array<[string, string]> = [
    ["Name", shownName],
    ["Profile", `ai-insights.app/u/${checked.ok ? checked.handle : "…"}`],
    ["Period", formatPeriod(stats.from, stats.to)],
    ["Sessions", formatInt(stats.sessions)],
    ["Tokens", formatInt(stats.tokens)],
    ["Estimated spend", stats.usd === null ? "not shown" : `$${formatInt(stats.usd)}`],
    ["Active days", formatInt(stats.activeDays)],
    ["Longest streak", `${formatInt(stats.streak)} days`],
    ["Agents", stats.agents.length ? stats.agents.map((a) => `${agentName(a.k)} ${a.p}%`).join(", ") : "none"],
    ["Fun fact", stats.fact || "none"],
  ]

  return (
    <section aria-labelledby="publish" className="flex w-full max-w-[34rem] flex-col gap-4 rounded-2xl border bg-card px-5 py-5">
      <h2 id="publish" className="text-lg font-semibold">Publish to the leaderboard</h2>
      {state.kind === "done" ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>Published. Your profile is public now.</p>
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
            <p className="text-muted-foreground">Nothing else is sent: no projects, prompts or history. The numbers are self-reported from your own report and are not verified. The latest publish replaces the previous one, and you can remove it any time.</p>
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
