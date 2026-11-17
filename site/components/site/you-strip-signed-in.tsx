"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"

import { NavLink } from "@/components/site/nav-link"
import { YouPanel, type YouEntry } from "@/components/site/you-panel"
import type { Ranks } from "@/lib/db"
import { ARENAS, boardHref, pageOfPosition, type SortId } from "@/lib/leaderboard"
import { BASE } from "@/lib/site"

const API = `${BASE}/api/leaderboard/you`
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e9 ? v : null)

type You = { entry: YouEntry; ranks: Ranks; position: { position: number; rank: number | null } | null }

/** Only the shape the route promises, every field checked; anything else shows nothing. */
function parse(data: unknown): You | null {
  const d = (data ?? {}) as Record<string, unknown>
  const e = (d.entry ?? {}) as Record<string, unknown>
  if (d.ok !== true || typeof e.handle !== "string" || !HANDLE.test(e.handle) || typeof e.displayName !== "string") return null
  const avatarUrl = typeof e.avatarUrl === "string" && e.avatarUrl.startsWith("https://img.clerk.com/") ? e.avatarUrl : null
  const ranks: Ranks = {}
  const rawRanks = (d.ranks ?? {}) as Record<string, unknown>
  for (const { id } of ARENAS) {
    const r = (rawRanks[id] ?? null) as Record<string, unknown> | null
    const [rank, total, topPercent] = [count(r?.rank), count(r?.total), count(r?.topPercent)]
    if (rank && total && topPercent && rank <= total && topPercent <= 100) ranks[id] = { rank, total, topPercent }
  }
  const p = (d.position ?? null) as Record<string, unknown> | null
  const position = p && count(p.position) ? { position: count(p.position)!, rank: count(p.rank) } : null
  return { entry: { handle: e.handle, displayName: e.displayName.slice(0, 40), avatarUrl }, ranks, position }
}

// One request per sort while the page is open, shared by the strip and the "Jump to me" button. At most one entry
// per sort, so it stays small; a photo change clears it.
const requests = new Map<SortId, Promise<You | null>>()
const listeners = new Set<() => void>()

function load(sort: SortId): Promise<You | null> {
  let pending = requests.get(sort)
  if (!pending) {
    pending = fetch(`${API}?sort=${encodeURIComponent(sort)}`, { credentials: "same-origin", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then(parse)
      .catch((error: unknown) => {
        // Offline, signed out after all, or a timeout: the strip stays hidden and the board is unaffected.
        if (!(error instanceof Error)) throw error
        requests.delete(sort)
        return null
      })
    requests.set(sort, pending)
  }
  return pending
}

function reload() {
  requests.clear()
  for (const listener of listeners) listener()
}

/** The caller's standing under `sort`, once Clerk says they are signed in. Signed-out visitors never call the route. */
function useYou(sort: SortId): You | null {
  const { isSignedIn } = useAuth()
  const [you, setYou] = React.useState<You | null>(null)
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    const listener = () => setVersion((v) => v + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  React.useEffect(() => {
    if (!isSignedIn) return
    let live = true
    void load(sort).then((value) => {
      if (live) setYou(value)
    })
    return () => {
      live = false
    }
  }, [isSignedIn, sort, version])
  return isSignedIn ? you : null
}

/** Marks the caller's rows in the server-rendered table and list (leaderboard-table.tsx styles data-mine). */
function useMarkRows(handle: string | null, sort: SortId, page: number) {
  React.useEffect(() => {
    if (!handle) return
    const rows = [document.getElementById(`u-${handle}`), document.getElementById(`m-${handle}`)].filter((el): el is HTMLElement => el !== null)
    for (const row of rows) row.dataset.mine = "true"
    return () => {
      for (const row of rows) delete row.dataset.mine
    }
  }, [handle, sort, page])
}

function jumpHref(you: You, sort: SortId): string | null {
  const page = you.position ? pageOfPosition(you.position.position) : null
  return page ? boardHref(BASE, sort, page) : null
}

export function SignedInStrip({ sort, page }: { sort: SortId; page: number }) {
  const you = useYou(sort)
  useMarkRows(you?.entry.handle ?? null, sort, page)
  if (!you) return null
  return <YouPanel entry={you.entry} ranks={you.ranks} jump={jumpHref(you, sort)} onPhotoChange={reload} />
}

export function SignedInJump({ sort }: { sort: SortId }) {
  const you = useYou(sort)
  const jump = you ? jumpHref(you, sort) : null
  if (!you || !jump || !you.position) return null
  return (
    <NavLink href={`${jump}#u-${you.entry.handle}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/[0.06] px-3 font-mono text-[11.5px] text-primary outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 max-lg:hidden">
      Jump to me{you.position.rank !== null && <span className="text-primary/80">· #{you.position.rank}</span>}
    </NavLink>
  )
}

