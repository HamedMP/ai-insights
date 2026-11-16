"use client"

import * as React from "react"

import { prefersReducedMotion, useInView } from "@/hooks/use-in-view"

const format = (value: number, decimals: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/** Counts up to `value` the first time it is seen. The server renders the final number, so it reads without script. */
export function CountUp({ value, decimals = 0, prefix = "", suffix = "", duration = 1400, delay = 0 }: { value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number; delay?: number }) {
  const [ref, inView] = useInView<HTMLSpanElement>("0px")
  const [shown, setShown] = React.useState(value)
  const started = React.useRef(false)

  React.useEffect(() => {
    if (!inView || started.current) return
    started.current = true
    if (prefersReducedMotion()) return
    let frame = 0
    let start = 0
    let finished = false
    setShown(0)
    const tick = (now: number) => {
      if (finished) return
      if (!start) start = now + delay
      const progress = Math.min(1, Math.max(0, (now - start) / duration))
      setShown(value * (1 - Math.pow(1 - progress, 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    // A hidden tab pauses animation frames; the real number must still arrive.
    const settle = window.setTimeout(() => {
      finished = true
      setShown(value)
    }, delay + duration + 150)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
    }
  }, [inView, value, duration, delay])

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {format(shown, decimals)}
      {suffix}
    </span>
  )
}
