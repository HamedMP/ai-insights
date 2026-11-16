"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface Option<T extends string> {
  value: T
  label: React.ReactNode
  /** Accessible name when the label is visual only. */
  name?: string
}

/** A radio group of buttons: arrow keys move the choice, one tab stop for the group. */
export function Segmented<T extends string>({ label, options, value, onChange, className, itemClassName }: { label: string; options: Option<T>[]; value: T; onChange: (value: T) => void; className?: string; itemClassName?: string }) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const index = options.findIndex((option) => option.value === value)
  function onKeyDown(event: React.KeyboardEvent, at: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (at + step + options.length) % options.length
    onChange(options[next]!.value)
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-full border bg-secondary/60 p-0.5", className)}>
      {options.map((option, at) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current[at] = node
          }}
          type="button"
          role="radio"
          aria-checked={at === index}
          aria-label={option.name}
          tabIndex={at === index || (index < 0 && at === 0) ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, at)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:h-9",
            at === index && "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:bg-accent",
            itemClassName,
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
