"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

/** Colours cross-fade for a moment when the theme changes, unless the person asked for less motion. */
export function fadeTheme(apply: () => void) {
  const root = document.documentElement
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("theme-fade")
    window.setTimeout(() => root.classList.remove("theme-fade"), 380)
  }
  apply()
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
}

/** Press d to flip between light and dark. */
function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== "d" || isTypingTarget(event.target)) return
      fadeTheme(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [resolvedTheme, setTheme])
  return null
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}
