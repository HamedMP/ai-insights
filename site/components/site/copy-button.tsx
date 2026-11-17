"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { track } from "@/lib/analytics"
import { EVENTS } from "@/lib/analytics-sanitize"
import { cn } from "@/lib/utils"

/** Copies `text`; the icon turns into a tick and the label into "Copied" for a moment. */
/** `trackAs` names where an install command was copied from, for the site's analytics (no-op without a key). */
export function CopyButton({ text, label = "Copy", className, ariaLabel, trackAs }: { text: string; label?: string; className?: string; ariaLabel?: string; trackAs?: string }) {
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle")
  const timer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState("copied")
      if (trackAs) track(EVENTS.installCommandCopied, { location: trackAs })
    } catch {
      setState("failed")
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState("idle"), 1800)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={ariaLabel}
      className={cn(
        "group/copy relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background/80 px-2 font-mono text-[11px] text-muted-foreground transition-[color,border-color,background-color] outline-none hover:border-input hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 before:absolute before:-inset-1.5 before:content-[''] active:translate-y-px",
        state === "copied" && "border-primary/40 text-primary hover:text-primary",
        className,
      )}
    >
      <span className="relative grid size-3.5 place-items-center">
        <HugeiconsIcon
          icon={Copy01Icon}
          strokeWidth={2}
          className={cn("absolute size-3.5 transition-[transform,opacity] duration-200", state === "copied" && "scale-50 opacity-0")}
        />
        <HugeiconsIcon
          icon={Tick02Icon}
          strokeWidth={2.4}
          className={cn("absolute size-3.5 scale-50 opacity-0 transition-[transform,opacity] duration-200", state === "copied" && "scale-100 opacity-100")}
        />
      </span>
      <span aria-live="polite" aria-atomic>{state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}</span>
    </button>
  )
}

/** A command block: a comment line saying where to run it, the lines, and a copy button for all of them. */
export function CommandBlock({ where, lines, className }: { where: string; lines: string[]; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-background/60", className)}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <span className="mono-comment truncate text-xs">{where}</span>
        <CopyButton text={lines.join("\n")} />
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-7">
        {lines.map((line) => (
          <div key={line} className="whitespace-pre">
            <span aria-hidden className="mr-3 select-none text-primary">
              ›
            </span>
            {line}
          </div>
        ))}
      </pre>
    </div>
  )
}
