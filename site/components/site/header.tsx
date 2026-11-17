"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, GithubIcon, Menu01Icon } from "@hugeicons/core-free-icons"

import { Wordmark } from "@/components/site/rabbit"
import { Button } from "@/components/ui/button"
import { BASE, REPO } from "@/lib/site"
import { cn } from "@/lib/utils"

const LINKS = [
  { id: "cards", label: "Cards" },
  { id: "video", label: "Video" },
  { id: "privacy", label: "Privacy" },
  { id: "agents", label: "Agents" },
  { id: "install", label: "Install" },
  { id: "faq", label: "FAQ" },
]

/** The section crossing the middle band of the viewport, or null above the first one. */
function useActiveSection() {
  const [active, setActive] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        setActive(LINKS.find((link) => visible.has(link.id))?.id ?? null)
      },
      { rootMargin: "-40% 0px -55% 0px" },
    )
    for (const link of LINKS) {
      const section = document.getElementById(link.id)
      if (section) observer.observe(section)
    }
    return () => observer.disconnect()
  }, [])
  return active
}

/** A bar under the active link that slides between links; it moves with transform only. */
function Indicator({ nav, active }: { nav: React.RefObject<HTMLElement | null>; active: string | null }) {
  const [box, setBox] = React.useState<{ x: number; w: number } | null>(null)
  React.useLayoutEffect(() => {
    const measure = () => {
      const link = active ? nav.current?.querySelector<HTMLElement>(`[data-link="${active}"]`) : null
      setBox(link ? { x: link.offsetLeft + 12, w: link.offsetWidth - 24 } : null)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [active, nav])
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute bottom-[13px] left-0 h-0.5 w-[100px] origin-left rounded-full bg-primary transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
        !box && "opacity-0",
      )}
      style={{ transform: box ? `translateX(${box.x}px) scaleX(${box.w / 100})` : "translateX(12px) scaleX(0.2)" }}
    />
  )
}

/**
 * `account` is the header's account slot: pages that mount Clerk pass <AccountMenu /> (components/site/account-menu.tsx).
 * Without it (the landing page) the slot is a plain leaderboard link, so this module never imports Clerk.
 */
export function Header({ account }: { account?: React.ReactNode } = {}) {
  const [scrolled, setScrolled] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const active = useActiveSection()
  const pathname = usePathname() ?? ""
  const inDocs = pathname.startsWith("/docs")
  const inLeaderboard = pathname.startsWith("/leaderboard")
  const nav = React.useRef<HTMLElement>(null)
  const panel = React.useRef<HTMLDivElement>(null)
  const toggle = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setOpen(false)
      toggle.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !toggle.current?.contains(target)) setOpen(false)
    }
    const onResize = () => {
      if (window.innerWidth >= 1024) setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
      window.removeEventListener("resize", onResize)
    }
  }, [open])

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-transparent transition-[background-color,border-color] duration-300",
        (scrolled || open) && "border-border bg-background/80 backdrop-blur-md backdrop-saturate-150",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
        <a href="#top" aria-label="AI Insights by Matrix OS, back to the top" className="-m-1 rounded-md p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Wordmark />
        </a>
        <nav ref={nav} aria-label="Sections" className="relative hidden h-16 items-center lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.id}
              data-link={link.id}
              href={`${BASE}/#${link.id}`}
              aria-current={active === link.id ? "location" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                active === link.id && "text-foreground",
              )}
            >
              {link.label}
            </a>
          ))}
          <a
            href={`${BASE}/leaderboard`}
            aria-current={inLeaderboard ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              inLeaderboard && "text-foreground",
            )}
          >
            Leaderboard
          </a>
          <a
            href={`${BASE}/docs`}
            aria-current={inDocs ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              inDocs && "text-foreground",
            )}
          >
            Docs
          </a>
          <Indicator nav={nav} active={active} />
        </nav>
        <div className="flex items-center gap-2">
          {account}
          <Button
            variant="secondary"
            size="lg"
            className="size-10 rounded-full bg-secondary/70 backdrop-blur max-sm:hidden sm:h-9 sm:w-auto sm:gap-2 sm:px-3.5"
            nativeButton={false}
            render={<a href={REPO} aria-label="AI Insights on GitHub" />}
          >
            <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />
            <span className="max-sm:hidden" aria-hidden>
              GitHub
            </span>
          </Button>
          <Button size="lg" className="h-10 rounded-full px-4 sm:h-9" nativeButton={false} render={<a href={`${BASE}/#get`} />}>
            Get yours
          </Button>
          <button
            ref={toggle}
            type="button"
            data-menu-button=""
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
            className="grid size-10 place-items-center rounded-full border bg-secondary/70 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
          >
            <HugeiconsIcon icon={open ? Cancel01Icon : Menu01Icon} strokeWidth={2} className="size-[18px]" />
          </button>
        </div>
      </div>
      <div ref={panel} id="mobile-menu" hidden={!open} className="border-t lg:hidden">
        <nav aria-label="Sections, menu" className="mx-auto flex max-w-6xl flex-col px-4 pt-1 pb-5 animate-in fade-in-0 slide-in-from-top-2 duration-300 motion-reduce:animate-none">
          {LINKS.map((link, index) => (
            <a
              key={link.id}
              href={`${BASE}/#${link.id}`}
              onClick={() => setOpen(false)}
              aria-current={active === link.id ? "location" : undefined}
              className="flex h-13 items-center justify-between border-b text-lg font-medium tracking-tight outline-none focus-visible:text-primary"
            >
              {link.label}
              <span className={cn("font-mono text-xs text-muted-foreground", active === link.id && "text-primary")}>{String(index + 1).padStart(2, "0")}</span>
            </a>
          ))}
          <a href={`${BASE}/docs`} aria-current={inDocs ? "page" : undefined} className="flex h-13 items-center justify-between border-b text-lg font-medium tracking-tight outline-none focus-visible:text-primary">
            Docs
          </a>
          <a href={`${BASE}/leaderboard`} className="flex h-13 items-center justify-between border-b text-lg font-medium tracking-tight outline-none focus-visible:text-primary">
            Leaderboard
          </a>
          <a href={REPO} className="flex h-13 items-center justify-between border-b text-lg font-medium tracking-tight outline-none focus-visible:text-primary sm:hidden">
            GitHub
            <HugeiconsIcon icon={GithubIcon} strokeWidth={2} className="size-4 text-muted-foreground" />
          </a>
        </nav>
      </div>
    </header>
  )
}
