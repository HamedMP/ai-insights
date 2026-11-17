"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * Light only for now: the dark theme is being redesigned. The `.dark` tokens and `dark:` classes stay in the CSS,
 * unused, so it can come back by restoring a switcher and `enableSystem` here.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" forcedTheme="light" defaultTheme="light" enableSystem={false}>
      {children}
    </NextThemesProvider>
  )
}
