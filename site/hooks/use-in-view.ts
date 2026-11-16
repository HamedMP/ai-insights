"use client"

import * as React from "react"

/** True once the element has scrolled into view; stays true. No observer means it counts as seen. */
export function useInView<T extends Element>(rootMargin = "0px 0px -12% 0px") {
  const ref = React.useRef<T>(null)
  const [inView, setInView] = React.useState(false)
  React.useEffect(() => {
    const element = ref.current
    if (!element || inView) return
    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin, threshold: 0.12 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [inView, rootMargin])
  return [ref, inView] as const
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
