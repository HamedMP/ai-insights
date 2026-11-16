"use client"

import * as React from "react"

import { prefersReducedMotion } from "@/hooks/use-in-view"
import demo from "@/lib/demo.json"

/** The sample report's top findings, one at a time. Holds still for people who asked for less motion. */
export function FindingTicker() {
  const [index, setIndex] = React.useState(0)
  React.useEffect(() => {
    if (prefersReducedMotion()) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % demo.findings.length), 3200)
    return () => window.clearInterval(timer)
  }, [])
  const finding = demo.findings[index]!
  return (
    <div className="flex min-w-0 items-center gap-3 text-sm" aria-live="off">
      <span className="glyph shrink-0 text-xs" aria-hidden />
      <span key={index} className="min-w-0 flex-1 truncate animate-in fade-in-0 slide-in-from-bottom-1 duration-500 motion-reduce:animate-none">
        <span className="text-foreground">{finding.title}</span>
        {finding.value !== null && (
          <span className="text-muted-foreground">
            {" "}
            · <b className="font-medium text-foreground tabular-nums">{finding.value}</b> {finding.label}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {index + 1}/{demo.findings.length}
      </span>
    </div>
  )
}
