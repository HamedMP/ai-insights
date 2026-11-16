"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { GithubIcon } from "@hugeicons/core-free-icons"

import { Logo } from "@/components/site/logo"
import { ThemeSwitcher } from "@/components/site/theme-switcher"
import { Button } from "@/components/ui/button"
import { REPO } from "@/lib/site"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "#report", label: "Report" },
  { href: "#how", label: "How it works" },
  { href: "#install", label: "Install" },
  { href: "#faq", label: "FAQ" },
]

export function Header() {
  const [scrolled, setScrolled] = React.useState(false)
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-transparent transition-[background-color,border-color] duration-300",
        scrolled && "border-border bg-background/75 backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
        <a href="#top" aria-label="Hindsight, back to the top" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Logo />
        </a>
        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="lg" className="gap-2 rounded-full bg-secondary/70 px-3.5 backdrop-blur" nativeButton={false} render={<a href={REPO} />}>
            <HugeiconsIcon icon={GithubIcon} strokeWidth={2} data-icon="inline-start" />
            <span className="max-sm:sr-only">GitHub</span>
          </Button>
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  )
}
