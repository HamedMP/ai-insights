"use client"

import * as React from "react"

import { useInView } from "@/hooks/use-in-view"
import { cn } from "@/lib/utils"

/** Slides its content up as it scrolls into view. The resting state is readable; motion only adds the entrance. */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div
      ref={ref}
      data-reveal=""
      data-shown={inView ? "" : undefined}
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
      className={cn(className)}
    >
      {children}
    </div>
  )
}
