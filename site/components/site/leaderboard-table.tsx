import { NavLink } from "@/components/site/nav-link"
import { Avatar } from "@/components/site/profile"
import { formatMetric, metricValue, shortPeriod, type MetricSource } from "@/lib/arena-format"
import type { BoardRow } from "@/lib/db"
import { barPercent, boardHref, SORTS, sortOf, type SortId } from "@/lib/leaderboard"
import { EARNED_TITLES, formatPeriod } from "@/lib/share"
import { BASE } from "@/lib/site"
import { cn } from "@/lib/utils"

/**
 * The leaderboard as one dense table (wide screens) and as a two-line list (phones and tablets). Server-rendered:
 * every sort is a link, so sorting works without JavaScript and every view has a shareable URL; with JavaScript the
 * links navigate without a reload (nav-link.tsx). Every string shown comes from validated database columns and is
 * rendered as React text. The page is cached for everyone, so the signed-in person's own rows are marked in the
 * browser (you-strip.tsx sets data-mine); `me` does the same from the server where a caller knows it.
 */

/** Columns that drop out on narrower wide screens, so the table never needs a horizontal scroll. */
const HIDE: Partial<Record<SortId, string>> = { devices: "hidden xl:table-cell" }

const sourceOf = (row: BoardRow): MetricSource => ({
  tokens: row.stats.tokens,
  usd: row.stats.usd,
  claudeTokens: row.claudeTokens,
  codexTokens: row.codexTokens,
  streak: row.stats.streak,
  activeDays: row.stats.activeDays,
  sessions: row.stats.sessions,
  deviceCount: row.deviceCount,
})

const titleOf = (row: BoardRow) => {
  const first = row.stats.titles?.[0]
  // "The Smooth Operator" reads as "Smooth Operator" in a narrow cell; the profile keeps the full wording.
  return first ? EARNED_TITLES[first.k]?.title.replace(/^The /, "") ?? null : null
}

/** Rank as a fixed-width mark. The top three get a filled or outlined square, nothing louder. */
function RankMark({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-muted-foreground" aria-label="unranked">–</span>
  return (
    <span
      className={cn(
        "inline-grid h-6 min-w-6 place-items-center rounded-[5px] px-1 font-mono text-[12px] tabular-nums",
        rank === 1 ? "bg-foreground font-semibold text-background" : rank <= 3 ? "font-semibold ring-1 ring-foreground/70 ring-inset" : "text-muted-foreground",
      )}
    >
      {rank}
    </span>
  )
}

/** The active metric's inline bar, scaled to the board's top value. Decorative: the number beside it is the value. */
function Bar({ percent, className }: { percent: number; className?: string }) {
  return (
    <span aria-hidden className={cn("relative block h-1.5 overflow-hidden rounded-full bg-[#e5dfd2]", className)}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </span>
  )
}

function Person({ row }: { row: BoardRow }) {
  const title = titleOf(row)
  return (
    <NavLink href={`${BASE}/u/${row.handle}`} className="group/person flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Avatar url={row.avatarUrl} name={row.displayName} handle={row.handle} className="size-8 rounded-[9px] text-[12.5px]" />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium underline-offset-4 group-hover/person:underline">{row.displayName}</span>
          <span className="hidden shrink-0 rounded-[4px] bg-primary px-1.5 py-px font-mono text-[9.5px] font-semibold tracking-[0.08em] text-primary-foreground uppercase group-data-[mine=true]/mine:inline">you</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="truncate">@{row.handle}</span>
          {title && (
            <>
              <span aria-hidden className="shrink-0">·</span>
              <span className="min-w-0 shrink-[4] truncate text-ink-soft" title={`Earned title: ${title}`}>{title}</span>
            </>
          )}
        </span>
      </span>
    </NavLink>
  )
}

function SortHeader({ id, sort }: { id: SortId; sort: SortId }) {
  const def = sortOf(id)
  const active = id === sort
  return (
    <th
      scope="col"
      aria-sort={active ? "descending" : undefined}
      title={def.label}
      className={cn("h-10 px-2.5 text-right align-middle text-[10.5px] font-normal", active && "bg-primary/[0.06]", HIDE[id])}
    >
      <NavLink
        href={boardHref(BASE, id)}
        aria-label={active ? `${def.label}, sorted highest first` : `Sort by ${def.label.toLowerCase()}`}
        className={cn(
          "group/sort inline-flex items-center gap-0.5 rounded-sm font-mono text-[10.5px] tracking-[0.06em] whitespace-nowrap uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          active ? "font-semibold text-primary" : "text-muted-foreground",
        )}
      >
        <span aria-hidden className={cn("inline-block w-2.5 text-center", active ? "" : "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60")}>↓</span>
        {def.head}
      </NavLink>
    </th>
  )
}

export interface BoardTableProps {
  rows: BoardRow[]
  sort: SortId
  top: number | null
  /** The signed-in person's handle, to highlight their row. */
  me: string | null
}

/** Wide screens: rank, person, eight sortable numbers and the period, with the active column tinted and barred. */
export function BoardTable({ rows, sort, top, me }: BoardTableProps) {
  return (
    <table className="w-full border-separate border-spacing-0 text-[13.5px] max-lg:hidden">
      <caption className="sr-only">Leaderboard, sorted by {sortOf(sort).label.toLowerCase()}, highest first. Self-reported.</caption>
      <thead className="sticky top-12 z-10 bg-card">
        <tr className="[&>th]:border-b [&>th]:border-foreground/15 [&>th]:leading-none">
          <th scope="col" className="h-10 w-14 pl-4 text-left align-middle font-mono text-[10.5px] font-normal tracking-[0.08em] text-muted-foreground uppercase"><span className="inline-flex items-center">#</span></th>
          <th scope="col" className="h-10 px-3 text-left align-middle font-mono text-[10.5px] font-normal tracking-[0.08em] text-muted-foreground uppercase"><span className="inline-flex items-center">Person</span></th>
          {SORTS.map((s) => (
            <SortHeader key={s.id} id={s.id} sort={sort} />
          ))}
          <th scope="col" className="hidden h-10 pr-4 pl-3 text-right align-middle font-mono text-[10.5px] font-normal tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase xl:table-cell"><span className="inline-flex items-center">Period</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const mine = row.handle === me
          const source = sourceOf(row)
          return (
            <tr
              key={row.handle}
              id={`u-${row.handle}`}
              data-mine={mine ? "true" : undefined}
              className="group/row group/mine scroll-mt-32 transition-colors hover:bg-muted/60 data-[mine=true]:bg-primary/[0.07] data-[mine=true]:hover:bg-primary/[0.1] [&>td]:border-b [&>td]:border-border/80 last:[&>td]:border-b-0"
            >
              <td className="h-12 pl-4 align-middle group-data-[mine=true]/mine:shadow-[inset_3px_0_0_var(--primary)]">
                <RankMark rank={row.rank} />
              </td>
              <td className="w-full max-w-0 min-w-52 px-3 align-middle">
                <Person row={row} />
              </td>
              {SORTS.map((s) => {
                const value = metricValue(s.id, source)
                const active = s.id === sort
                return (
                  <td key={s.id} className={cn("px-2.5 text-right align-middle font-mono tabular-nums whitespace-nowrap", active ? "bg-primary/[0.06] font-semibold text-foreground" : "text-ink-soft", value === null && "text-muted-foreground/70", HIDE[s.id])}>
                    {active ? (
                      <span className="flex items-center justify-end gap-3">
                        <Bar percent={barPercent(value, top)} className="w-16 shrink-0" />
                        <span className="min-w-[6ch]">{formatMetric(s.id, value)}</span>
                      </span>
                    ) : (
                      formatMetric(s.id, value)
                    )}
                  </td>
                )
              })}
              <td className="hidden pr-4 pl-3 text-right align-middle font-mono text-[12px] whitespace-nowrap text-muted-foreground xl:table-cell" title={formatPeriod(row.stats.from, row.stats.to)}>
                {shortPeriod(row.stats.from, row.stats.to)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Short labels for the second line of a phone row. */
const LINE_LABEL: Record<SortId, string> = { tokens: "tok", spend: "spend", "claude-code": "CC", codex: "Codex", streak: "streak", active: "active", sessions: "sess", devices: "dev" }

/**
 * Phones and tablets: one row per person with the active metric and its bar, and the other numbers on a wrapping
 * second line. No horizontal scroll at any width.
 */
export function BoardList({ rows, sort, top, me }: BoardTableProps) {
  const active = sortOf(sort)
  return (
    <ol aria-label={`Leaderboard, sorted by ${active.label.toLowerCase()}`} className="flex flex-col lg:hidden">
      {rows.map((row) => {
        const mine = row.handle === me
        const source = sourceOf(row)
        const value = metricValue(sort, source)
        return (
          <li
            key={row.handle}
            id={`m-${row.handle}`}
            data-mine={mine ? "true" : undefined}
            className="group/mine scroll-mt-24 border-b border-border/80 px-3 py-3 last:border-b-0 data-[mine=true]:bg-primary/[0.07] data-[mine=true]:shadow-[inset_3px_0_0_var(--primary)] sm:px-4"
          >
            <div className="flex items-center gap-3">
              <span className="w-7 shrink-0 text-center">
                <RankMark rank={row.rank} />
              </span>
              <span className="min-w-0 flex-1">
                <Person row={row} />
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className={cn("font-mono text-[15px] font-semibold tabular-nums", value === null && "text-muted-foreground")}>{formatMetric(sort, value)}</span>
                <span className="font-mono text-[9.5px] tracking-[0.08em] text-muted-foreground uppercase">{active.label}</span>
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-1.5 pl-10">
              <Bar percent={barPercent(value, top)} className="w-full" />
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                {SORTS.filter((s) => s.id !== sort).map((s) => {
                  const v = metricValue(s.id, source)
                  if (v === null || (s.id === "devices" && v <= 1)) return null
                  return (
                    <span key={s.id} className="whitespace-nowrap">
                      <span className="text-ink-soft">{formatMetric(s.id, v)}</span> {LINE_LABEL[s.id]}
                    </span>
                  )
                })}
                <span className="whitespace-nowrap" title={formatPeriod(row.stats.from, row.stats.to)}>{shortPeriod(row.stats.from, row.stats.to)}</span>
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
