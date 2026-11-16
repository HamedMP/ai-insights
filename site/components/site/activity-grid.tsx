"use client"

import * as React from "react"

import { useInView } from "@/hooks/use-in-view"
import demo from "@/lib/demo.json"
import { cn } from "@/lib/utils"

const LEVELS = ["bg-cell-0", "bg-cell-1", "bg-cell-2", "bg-cell-3", "bg-cell-4"]

/** The sample's sessions per day as a calendar (a column per week, Monday on top); cells light up in a wave when seen. */
export function ActivityGrid({ className }: { className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const days = demo.daily
  const max = Math.max(...days.map((day) => day.sessions))
  const first = new Date(`${days[0]!.day}T00:00:00Z`)
  const lead = (first.getUTCDay() + 6) % 7
  const byDay = new Map(days.map((day) => [day.day, day.sessions]))
  const cells: Array<{ day: string; sessions: number } | null> = Array.from({ length: lead }, () => null)
  const last = new Date(`${days[days.length - 1]!.day}T00:00:00Z`)
  for (let at = first.getTime(); at <= last.getTime(); at += 86_400_000) {
    const day = new Date(at).toISOString().slice(0, 10)
    cells.push({ day, sessions: byDay.get(day) ?? 0 })
  }
  const weeks = Math.ceil(cells.length / 7)
  const active = days.filter((day) => day.sessions > 0).length

  return (
    <div ref={ref} className={cn("flex items-end gap-5", inView ? "grid-run" : "grid-idle", className)}>
      <div
        className="grid w-fit grid-flow-col gap-[3px]"
        style={{ gridTemplateRows: "repeat(7, 0.95rem)", gridTemplateColumns: `repeat(${weeks}, 0.95rem)` }}
        role="img"
        aria-label={`${active} active days out of ${days.length}, up to ${max} sessions a day.`}
      >
        {cells.map((cell, index) => {
          const level = !cell || cell.sessions === 0 ? 0 : Math.min(4, Math.ceil((cell.sessions / max) * 4))
          const column = Math.floor(index / 7)
          return (
            <span
              key={index}
              title={cell ? `${cell.day}: ${cell.sessions} sessions` : undefined}
              className={cn("cell rounded-[2.5px]", cell ? LEVELS[level] : "bg-transparent")}
              style={{ "--d": `${column * 45 + (index % 7) * 18}ms` } as React.CSSProperties}
            />
          )
        })}
      </div>
      <dl className="flex flex-col gap-2 font-mono text-[11px] text-muted-foreground">
        <div><dt className="sr-only">Days</dt><dd><b className="font-medium text-foreground">{days.length}</b> days</dd></div>
        <div><dt className="sr-only">Active days</dt><dd><b className="font-medium text-foreground">{active}</b> active</dd></div>
        <div><dt className="sr-only">Busiest day</dt><dd><b className="font-medium text-foreground">{max}</b> on the busiest day</dd></div>
        <div aria-hidden className="mt-1 flex items-center gap-[3px]">
          {LEVELS.map((level) => <span key={level} className={cn("size-2 rounded-[2px]", level)} />)}
        </div>
      </dl>
    </div>
  )
}
