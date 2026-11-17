"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Cancel01Icon, GithubIcon, Menu01Icon } from "@hugeicons/core-free-icons"

import { Rabbit } from "@/components/site/rabbit"
import { SessionAccount } from "@/components/site/session-account"
import { BASE, REPO } from "@/lib/site"
import { cn } from "@/lib/utils"

/** The landing page's sections, grouped under "Tour": one top-level link instead of six. */
const SECTIONS = [
  { id: "cards", label: "Cards" },
  { id: "video", label: "Video" },
  { id: "privacy", label: "Privacy" },
  { id: "agents", label: "Agents" },
  { id: "install", label: "Install" },
  { id: "faq", label: "FAQ" },
]

const LINK = "relative inline-flex h-12 items-center px-2.5 font-mono text-[11.5px] tracking-[0.1em] uppercase text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
/** The current page: ink text and a primary rule sitting on the header's hairline. */
const CURRENT = "text-foreground after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:bg-primary"

/**
 * Close the header's <details> menus on Escape, on a click outside them, and after a link inside is followed, and keep
 * at most one open. They open and close without this (plain <details>), so the menus work without JavaScript.
 */
function useDetailsMenus(root: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const el = root.current
    if (!el) return
    const menus = () => Array.from(el.querySelectorAll<HTMLDetailsElement>("details[data-menu]"))
    const closeAll = (except?: Element) => {
      for (const d of menus()) if (d !== except && d.open) d.open = false
    }
    const onToggle = (event: Event) => {
      const d = event.target as HTMLDetailsElement
      if (d.open) closeAll(d)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const open = menus().find((d) => d.open)
      if (!open) return
      open.open = false
      open.querySelector<HTMLElement>("summary")?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      if (!menus().some((d) => d.open && d.contains(event.target as Node))) closeAll()
    }
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element).closest?.("details[data-menu] a")) closeAll()
    }
    el.addEventListener("toggle", onToggle, true)
    el.addEventListener("click", onClick)
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    return () => {
      el.removeEventListener("toggle", onToggle, true)
      el.removeEventListener("click", onClick)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
    }
  }, [root])
}

/**
 * One slim header on every page: the mark and name, Tour (the landing page's sections), Leaderboard and Docs, then the
 * account slot, GitHub and the one primary action.
 *
 * `account` is the slot on pages that mount Clerk (<AccountMenu />). Everywhere else it is <SessionAccount />, which
 * imports no Clerk code: a quiet "Sign in" link, or the account menu loaded on demand for a browser that has signed in
 * here before.
 *
 * `docsLink` renders the "Docs" links; only the docs pass next/link (components/docs/docs-header.tsx), so next/link
 * stays out of the landing page's bundle and links from Clerk pages to the docs stay full loads (lib/navigation.ts).
 */
export function Header({ account, docsLink }: { account?: React.ReactNode; docsLink?: React.ElementType } = {}) {
  const pathname = usePathname() ?? ""
  const inDocs = pathname.startsWith("/docs")
  const inLeaderboard = pathname.startsWith("/leaderboard")
  const DocsAnchor = docsLink ?? "a"
  const root = React.useRef<HTMLElement>(null)
  useDetailsMenus(root)

  return (
    <header ref={root} className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 md:gap-5 md:px-8">
        <a href={`${BASE}/`} aria-label="AI Insights by Matrix OS, home" className="-ml-1 flex shrink-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Rabbit className="h-[18px] text-primary" />
          <span className="font-mono text-[13px] font-semibold tracking-[0.12em] uppercase">AI Insights</span>
          <span aria-hidden className="font-mono text-[10.5px] tracking-[0.1em] text-muted-foreground uppercase max-lg:hidden">by Matrix OS</span>
        </a>

        <nav aria-label="Site" className="flex items-center max-md:hidden">
          <details data-menu className="group relative">
            <summary className={cn(LINK, "cursor-pointer list-none gap-1 [&::-webkit-details-marker]:hidden")}>
              Tour
              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <ul aria-label="Sections of the home page" className="absolute top-[calc(100%-4px)] left-0 z-50 flex w-52 flex-col rounded-lg border bg-popover p-1 shadow-lg">
              {SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <a href={`${BASE}/#${s.id}`} className="flex h-9 items-center justify-between rounded-md px-3 text-[14px] outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
                    {s.label}
                    <span className="font-mono text-[10.5px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <a href={`${BASE}/leaderboard`} aria-current={inLeaderboard ? "page" : undefined} className={cn(LINK, inLeaderboard && CURRENT)}>
            Leaderboard
          </a>
          <DocsAnchor href={`${BASE}/docs`} aria-current={inDocs ? "page" : undefined} className={cn(LINK, inDocs && CURRENT)}>
            Docs
          </DocsAnchor>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          {account ?? <SessionAccount />}
          <a href={REPO} aria-label="AI Insights on GitHub" className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:hidden">
            <HugeiconsIcon icon={GithubIcon} strokeWidth={2} className="size-[17px]" />
          </a>
          <a href={`${BASE}/#get`} className="ml-1 inline-flex h-8 items-center rounded-md bg-primary px-3 font-mono text-[11.5px] font-semibold tracking-[0.08em] text-primary-foreground uppercase outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50">
            Get yours
          </a>
          <details data-menu className="group md:hidden">
            <summary aria-label="Menu" className="grid size-8 cursor-pointer list-none place-items-center rounded-md border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} className="size-4 group-open:hidden" />
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="hidden size-4 group-open:block" />
            </summary>
            <nav aria-label="Site, menu" className="absolute inset-x-0 top-full border-b bg-background px-4 pt-1 pb-5 shadow-sm">
              <p className="pt-3 pb-1 font-mono text-[10.5px] tracking-[0.12em] text-muted-foreground uppercase">Tour</p>
              {SECTIONS.map((s, i) => (
                <a key={s.id} href={`${BASE}/#${s.id}`} className="flex h-11 items-center justify-between border-b text-[17px] font-medium tracking-tight outline-none focus-visible:text-primary">
                  {s.label}
                  <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                </a>
              ))}
              <a href={`${BASE}/leaderboard`} aria-current={inLeaderboard ? "page" : undefined} className="flex h-11 items-center border-b text-[17px] font-medium tracking-tight outline-none focus-visible:text-primary aria-[current=page]:text-primary">
                Leaderboard
              </a>
              <DocsAnchor href={`${BASE}/docs`} aria-current={inDocs ? "page" : undefined} className="flex h-11 items-center border-b text-[17px] font-medium tracking-tight outline-none focus-visible:text-primary aria-[current=page]:text-primary">
                Docs
              </DocsAnchor>
              <a href={REPO} className="flex h-11 items-center justify-between border-b text-[17px] font-medium tracking-tight outline-none focus-visible:text-primary">
                GitHub
                <HugeiconsIcon icon={GithubIcon} strokeWidth={2} className="size-4 text-muted-foreground" />
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  )
}
