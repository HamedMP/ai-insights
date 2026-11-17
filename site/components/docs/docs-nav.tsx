"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"

import { DocsSearch } from "@/components/docs/docs-search"
import { DOC_GROUPS, DOCS, docHref, docSlugFromPath } from "@/lib/docs"
import { cn } from "@/lib/utils"

function DocNav({ current, label }: { current: string | null; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-6 text-[14px]">
      {DOC_GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-1">
          <p className="mb-1 px-3 font-mono text-[11px] tracking-wide text-primary uppercase">{group}</p>
          <ul className="flex flex-col gap-0.5">
            {DOCS.filter((doc) => doc.group === group).map((doc) => {
              const active = doc.slug === current
              return (
                <li key={doc.slug}>
                  <Link
                    href={docHref(doc.slug)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 items-center rounded-md border-l-2 border-transparent px-3 py-1.5 text-muted-foreground transition-colors outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                      active && "border-primary bg-brand-soft font-medium text-foreground hover:bg-brand-soft",
                    )}
                  >
                    {doc.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/**
 * After an in-place switch to another docs page, start at the top of the new article (or at the heading a "#..." link
 * names, which Next scrolls to) and move focus to it, as a full page load would. The first render is left alone.
 */
function useArticleStart(pathname: string) {
  const previous = React.useRef(pathname)
  React.useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    // "instant": the page scrolls smoothly for in-page links (globals.css), which would sweep through the old article.
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: "instant" })
    document.getElementById("content")?.focus({ preventScroll: true })
  }, [pathname])
}

/**
 * The docs sidebar (a disclosure on phones, so it opens without script) and its search. It lives in the docs layout,
 * so it stays mounted from page to page: its scroll position and the search box survive, and the current page follows
 * the address.
 */
export function DocsNavigation() {
  const pathname = usePathname() ?? ""
  const current = docSlugFromPath(pathname)
  const title = DOCS.find((doc) => doc.slug === current)?.title
  const menu = React.useRef<HTMLDetailsElement>(null)
  useArticleStart(pathname)

  // A full load used to close the phone menu; an in-place switch has to.
  React.useEffect(() => {
    if (menu.current) menu.current.open = false
  }, [pathname])

  return (
    <>
      <aside className="max-lg:hidden">
        <div className="sticky top-16 flex max-h-[calc(100dvh-5rem)] flex-col gap-5 overflow-y-auto pr-1 pb-6">
          <DocsSearch />
          <DocNav current={current} label="Docs" />
        </div>
      </aside>

      <details ref={menu} className="docs-menu group/menu mb-8 rounded-xl border bg-card lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-[11px] tracking-wide text-primary uppercase">Docs</span>
            {title && <span className="truncate">{title}</span>}
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground transition-transform group-open/menu:rotate-180" />
        </summary>
        <div className="flex flex-col gap-5 border-t px-1 pt-4 pb-5">
          <DocsSearch className="px-2" />
          <DocNav current={current} label="Docs, menu" />
        </div>
      </details>
    </>
  )
}
