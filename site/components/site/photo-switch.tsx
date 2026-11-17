"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { BASE } from "@/lib/site"
import { cn } from "@/lib/utils"

const API = `${BASE}/api/leaderboard/photo`
const GENERIC = "Something went wrong. Try again later."
const KNOWN_ERRORS = new Set([
  "Your Matrix account has no uploaded photo. Add one to your account first.",
  "Too many changes in a short time. Try again in a minute.",
  "You have not published yet.",
])

/**
 * "Show my photo": the owner's public photo on or off, without republishing. The server reads the photo from the
 * person's Matrix (Clerk) account; this sends only the choice. The page's avatars are server-rendered, so a change
 * refreshes them (the route expires the cached pages first), and `onChange` lets a browser-rendered strip refetch.
 */
export function PhotoSwitch({ initial, className, onChange }: { initial: boolean; className?: string; onChange?: () => void }) {
  const router = useRouter()
  const [shown, setShown] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()

  async function toggle() {
    const next = !shown
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(API, { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ show: next }) })
      const data: unknown = await res.json().catch((parseError: unknown) => {
        if (parseError instanceof SyntaxError) return null
        throw parseError
      })
      const record = (data ?? {}) as Record<string, unknown>
      if (res.ok && record.ok === true && typeof record.shown === "boolean") {
        setShown(record.shown)
        onChange?.()
        router.refresh()
      } else {
        setError(typeof record.error === "string" && KNOWN_ERRORS.has(record.error) ? record.error : GENERIC)
      }
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure
      setError(GENERIC)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          id={id}
          role="switch"
          aria-checked={shown}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={busy}
          onClick={toggle}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
            shown ? "border-primary bg-primary" : "border-input bg-muted",
          )}
        >
          <span aria-hidden className={cn("size-3.5 rounded-full bg-card shadow-sm ring-1 ring-black/10 transition-transform", shown ? "translate-x-[1.05rem]" : "translate-x-[0.15rem]")} />
        </button>
        <label htmlFor={id} className="cursor-pointer text-[13px] font-medium select-none">Show my photo</label>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="max-w-xs text-[12px] text-destructive">{error}</p>}
    </div>
  )
}
