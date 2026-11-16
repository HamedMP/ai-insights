import * as React from "react"

import demo from "@/lib/demo.json"
import { cn } from "@/lib/utils"

const LANE = 15
const TICKS = [0, 2, 4, 6, 8, 10]

const clock = (minutes: number) => {
  const total = demo.window.startHour * 60 + minutes
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}
const pct = (minutes: number) => `${(minutes / demo.window.minutes) * 100}%`

/**
 * The sample report's busiest afternoon: one bar per session, one lane per session open at the same time.
 * Bars grow in start order, then a cursor sweeps to the moment the most sessions were open.
 */
export function Timeline({ className }: { className?: string }) {
  const peakPct = (demo.peak.at / demo.window.minutes) * 100
  return (
    <figure className={cn("tl-run", className)} aria-label={`Timeline of the busiest afternoon in the sample report: ${demo.bars.length} sessions, at most ${demo.peak.open} open at once at ${clock(demo.peak.at)}.`}>
      <div className="relative pt-8">
        <div className="relative" style={{ height: demo.lanes * LANE }}>
          {TICKS.map((hours) => (
            <span key={hours} aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: pct(hours * 60) }} />
          ))}
          {demo.bars.map((bar, index) => (
            <span
              key={index}
              aria-hidden
              className={cn(
                "tl-bar absolute rounded-[3px]",
                bar.agent
                  ? bar.harness === "codex"
                    ? "border border-dashed border-series-codex/80 bg-series-codex/10"
                    : "border border-dashed border-primary bg-brand-soft"
                  : bar.harness === "codex"
                    ? "bg-series-codex"
                    : "bg-primary",
              )}
              style={
                {
                  left: pct(bar.from),
                  width: pct(Math.max(4, bar.to - bar.from)),
                  top: bar.lane * LANE + 3,
                  height: LANE - 6,
                  "--d": `${200 + Math.round((bar.from / demo.window.minutes) * 1300) + bar.lane * 35}ms`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
        {/* the cursor travels across the whole plot, so it is drawn in a full-width layer that slides */}
        <div aria-hidden className="tl-cursor pointer-events-none absolute inset-0" style={{ "--sweep-from": `-${peakPct}%` } as React.CSSProperties}>
          <span className="absolute top-6 bottom-0 w-px bg-foreground/80" style={{ left: `${peakPct}%` }} />
          <span className="tl-pulse absolute top-[1.35rem] size-2 -translate-x-[3.5px] rounded-full bg-foreground" style={{ left: `${peakPct}%` }} />
        </div>
        <div aria-hidden className="tl-peak absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 font-mono text-[11px] text-background" style={{ left: `${peakPct}%` }}>
          <b className="font-semibold">{demo.peak.open}</b> open · {clock(demo.peak.at)}
        </div>
      </div>
      <div aria-hidden className="relative mt-2 h-4 border-t pt-1 font-mono text-[10.5px] text-muted-foreground">
        {TICKS.map((hours, index) => (
          <span
            key={hours}
            className={cn("absolute", index === 0 ? "" : index === TICKS.length - 1 ? "-translate-x-full" : "-translate-x-1/2", index % 2 === 1 && "max-sm:hidden")}
            style={{ left: pct(hours * 60) }}
          >
            {clock(hours * 60)}
          </span>
        ))}
      </div>
    </figure>
  )
}

export function TimelineLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground uppercase tracking-wider", className)}>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-primary" />Claude Code</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-series-codex" />Codex</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] border border-dashed border-primary" />Driven by another agent</span>
    </div>
  )
}
