"use client"

import * as React from "react"

import { useInView } from "@/hooks/use-in-view"
import { cn } from "@/lib/utils"

/**
 * Brings its content in as it scrolls into view: `up` for text, `left` for rows read in order, `rise` for
 * large product frames. The resting state is readable; motion only adds the entrance.
 */
export function Reveal({ children, delay = 0, variant = "up", className }: { children: React.ReactNode; delay?: number; variant?: "up" | "left" | "rise"; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div
      ref={ref}
      data-reveal={variant}
      data-shown={inView ? "" : undefined}
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
      className={cn(className)}
    >
      {children}
    </div>
  )
}
