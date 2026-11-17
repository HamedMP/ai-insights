"use client"

import * as React from "react"

import { PhotoSwitch } from "@/components/site/photo-switch"
import { callEntryApi } from "@/components/site/publish-panel"
import { Button } from "@/components/ui/button"
import { formatInt, formatPeriod, tokensText } from "@/lib/share"
import { BASE, COMMAND } from "@/lib/site"

const API = `${BASE}/api/leaderboard/devices`
const KEY = /^(?:legacy|[0-9a-f]{32})$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
const GENERIC = "Something went wrong. Try again later."
const KNOWN_ERRORS = new Set([
  "That computer is not on your profile.",
  "That is the only computer on your profile. To leave the leaderboard, remove your entry instead.",
  "Too many changes in a short time. Try again in a minute.",
  "That is not a valid AI Insights stats payload.",
])

interface Device {
  key: string
  label: string
  name: string
  public: boolean
  legacy: boolean
  updatedAt: string
  duplicateOf: string | null
  stats: { from: string; to: string; sessions: number; tokens: number; usd: number | null; activeDays: number; streak: number; cards: number; days: boolean }
}
type Mine = { devices: Device[]; max: number; exactDays: boolean; photo: boolean }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)

/** Only the shape the route promises, every field checked; anything else hides the panel. */
function parse(data: unknown, handle: string): Mine | null {
  const d = (data ?? {}) as Record<string, unknown>
  if (d.ok !== true || d.handle !== handle || !Array.isArray(d.devices)) return null
  const devices: Device[] = []
  for (const entry of d.devices.slice(0, 10)) {
    const r = (entry ?? {}) as Record<string, unknown>
    const s = (r.stats ?? {}) as Record<string, unknown>
    if (typeof r.key !== "string" || !KEY.test(r.key) || typeof r.label !== "string" || typeof r.name !== "string" || typeof r.updatedAt !== "string" || Number.isNaN(Date.parse(r.updatedAt))) continue
    if (typeof s.from !== "string" || !DAY.test(s.from) || typeof s.to !== "string" || !DAY.test(s.to)) continue
    const [sessions, tokens, activeDays, streak, cards] = [num(s.sessions), num(s.tokens), num(s.activeDays), num(s.streak), num(s.cards)]
    if (sessions === null || tokens === null || activeDays === null || streak === null || cards === null) continue
    devices.push({
      key: r.key, label: r.label.slice(0, 40), name: r.name.slice(0, 32), public: r.public === true, legacy: r.legacy === true, updatedAt: r.updatedAt,
      duplicateOf: typeof r.duplicateOf === "string" ? r.duplicateOf.slice(0, 40) : null,
      stats: { from: s.from, to: s.to, sessions, tokens, usd: num(s.usd), activeDays, streak, cards, days: s.days === true },
    })
  }
  return { devices, max: num(d.max) ?? 10, exactDays: d.exactDays === true, photo: d.photo === true }
}

async function call(method: "PATCH" | "DELETE", url: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, credentials: "same-origin", signal: AbortSignal.timeout(10_000), headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const data: unknown = await res.json().catch((error: unknown) => {
      if (error instanceof SyntaxError) return null
      throw error
    })
    const record = (data ?? {}) as Record<string, unknown>
    if (res.ok && record.ok === true) return null
    return typeof record.error === "string" && KNOWN_ERRORS.has(record.error) ? record.error : GENERIC
  } catch (error) {
    if (error instanceof Error) return GENERIC
    throw error
  }
}

function DeviceRow({ device, onChanged }: { device: Device; onChanged: () => void }) {
  const [name, setName] = React.useState(device.name)
  const [shown, setShown] = React.useState(device.public)
  const [confirm, setConfirm] = React.useState(false)
  const [state, setState] = React.useState<{ kind: "idle" | "busy" | "saved" } | { kind: "error"; message: string }>({ kind: "idle" })
  const dirty = name.trim() !== device.name || shown !== device.public
  const s = device.stats

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setState({ kind: "busy" })
    const error = await call("PATCH", API, { device: device.key, name, public: shown })
    setState(error ? { kind: "error", message: error } : { kind: "saved" })
    if (!error) onChanged()
  }
  async function remove() {
    if (!confirm) return setConfirm(true)
    setState({ kind: "busy" })
    const error = await call("DELETE", `${API}?device=${encodeURIComponent(device.key)}`)
    setState(error ? { kind: "error", message: error } : { kind: "idle" })
    setConfirm(false)
    if (!error) onChanged()
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">
          {device.label}
          {device.legacy && <span className="ml-2 font-mono text-[10.5px] font-normal text-muted-foreground uppercase">published before devices</span>}
        </p>
        <time dateTime={device.updatedAt} className="font-mono text-[11px] text-muted-foreground">last published {DATE.format(new Date(device.updatedAt))}</time>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums text-muted-foreground">
        <span>{formatPeriod(s.from, s.to)}</span>
        <span><b className="font-semibold text-foreground">{formatInt(s.sessions)}</b> sessions</span>
        <span><b className="font-semibold text-foreground">{tokensText(s)}</b> tokens</span>
        {s.usd !== null && <span><b className="font-semibold text-foreground">${formatInt(s.usd)}</b> est.</span>}
        <span><b className="font-semibold text-foreground">{formatInt(s.activeDays)}</b> active days</span>
        <span><b className="font-semibold text-foreground">{formatInt(s.streak)}</b>-day streak</span>
        <span>{s.cards} cards</span>
        <span>{s.days ? "active days sent" : "active days not sent"}</span>
      </p>
      {device.duplicateOf && (
        <p role="note" className="rounded-xl bg-[#ffe14a]/40 px-3 py-2 text-[13px]">
          This published exactly the same period, sessions and tokens as <b>{device.duplicateOf}</b>. That usually means both computers read one synced history folder. It is counted once; remove one of them to tidy up.
        </p>
      )}
      <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-sm">
        <input
          className="h-9 min-w-0 flex-1 basis-48 rounded-lg border bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          placeholder="Name this computer"
          aria-label={`Name for ${device.label}`}
          autoComplete="off"
          spellCheck={false}
        />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="size-4 accent-primary" checked={shown} onChange={(e) => setShown(e.target.checked)} />
          Show the name publicly
        </label>
        <span className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="outline" disabled={!dirty || state.kind === "busy"}>Save</Button>
          <Button type="button" size="sm" variant={confirm ? "destructive" : "ghost"} onClick={remove} disabled={state.kind === "busy"}>{confirm ? "Remove its numbers?" : "Remove device"}</Button>
          {confirm && <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>}
        </span>
      </form>
      {state.kind === "error" && <p role="alert" className="text-[13px] text-destructive">{state.message}</p>}
      {state.kind === "saved" && <p role="status" className="text-[13px] text-muted-foreground">Saved.</p>}
    </li>
  )
}

/**
 * Shown only to the profile's owner: their computers, each with its own numbers, rename, remove, and remove-everything.
 * It asks the authenticated devices route, which answers about the caller alone, and renders only when the answer is
 * for this profile's handle.
 */
export function OwnerDevices({ handle }: { handle: string }) {
  const [mine, setMine] = React.useState<Mine | null>(null)
  const [gone, setGone] = React.useState<"idle" | "confirm" | "busy" | "removed" | string>("idle")
  const load = React.useCallback(() => {
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
  React.useEffect(() => load(), [load])

  if (!mine) return null
  if (gone === "removed") return <p className="rounded-2xl border px-5 py-4 text-sm">Your entry and all its devices are removed. Reload to see the page without it.</p>
  // The totals on the page are rendered on the server: reload to show them after a change.
  const refresh = () => window.location.reload()
  return (
    <section aria-labelledby="my-devices" className="flex flex-col gap-4 rounded-2xl border-2 border-dashed border-primary/40 bg-card px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="my-devices" className="scroll-mt-24 text-lg font-semibold">Your devices</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{mine.devices.length} of {mine.max} · only you see this panel</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3">
        <p className="text-[13.5px] text-muted-foreground">Your Matrix account photo on your profile and the leaderboard, instead of initials. Off unless you turn it on.</p>
        <PhotoSwitch initial={mine.photo} />
      </div>
      <p className="text-[14px] text-muted-foreground">
        Each computer you publish from keeps its own numbers, and your profile adds them up. To add one, run <code className="font-mono">{COMMAND}@latest</code> there and publish from its report while signed in to this account. Publishing again from a computer replaces only that computer&rsquo;s numbers. Names stay private unless you tick &ldquo;Show the name publicly&rdquo;; otherwise visitors see &ldquo;Device 1&rdquo;, &ldquo;Device 2&rdquo;.
      </p>
      {!mine.exactDays && mine.devices.length > 1 && (
        <p className="rounded-xl bg-primary/10 px-4 py-3 text-[14px]">Your active days and streak are shown as &ldquo;at least&rdquo;: not every device sent which days it was active. Publish again from AI Insights 0.5 or newer, with &ldquo;Include which days I was active&rdquo; ticked, for exact figures.</p>
      )}
      <ol className="flex flex-col divide-y rounded-xl border">
        {mine.devices.map((d) => (
          <DeviceRow key={`${d.key}-${d.updatedAt}`} device={d} onChanged={refresh} />
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button
          size="sm"
          variant="destructive"
          disabled={gone === "busy"}
          onClick={async () => {
            if (gone !== "confirm") return setGone("confirm")
            setGone("busy")
            const result = await callEntryApi("DELETE")
            setGone(result.ok ? "removed" : result.error)
          }}
        >
          {gone === "confirm" ? "Remove everything: profile and all devices?" : "Remove everything"}
        </Button>
        {gone === "confirm" && <Button size="sm" variant="ghost" onClick={() => setGone("idle")}>Keep</Button>}
        {gone !== "idle" && gone !== "confirm" && gone !== "busy" && <span role="alert" className="text-sm text-destructive">{gone}</span>}
      </div>
    </section>
  )
}
