"use client"

import * as React from "react"
import Link from "next/link"

import { DOCS, docHref } from "@/lib/docs"
import { cn } from "@/lib/utils"

interface Hit {
  href: string
  title: string
  page: string
}

/** Every page title and section heading, from the same table the sidebar uses. Small enough to filter in place. */
const INDEX: Hit[] = DOCS.flatMap((doc) => [
  { href: docHref(doc.slug), title: doc.title, page: doc.group },
  ...doc.sections.map((section) => ({ href: `${docHref(doc.slug)}#${section.id}`, title: section.title, page: doc.title })),
])

const MAX_HITS = 8

function search(query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return INDEX.filter((hit) => {
    const text = `${hit.title} ${hit.page}`.toLowerCase()
    return words.every((word) => text.includes(word))
  }).slice(0, MAX_HITS)
}

/** A filter over page titles and headings. Rendered only when script runs; the sidebar works without it. */
export function DocsSearch({ className }: { className?: string }) {
  const [query, setQuery] = React.useState("")
  const id = React.useId()
  const hits = React.useMemo(() => search(query), [query])
  const listId = `${id}-results`

  return (
    <div className={cn("js-only relative", className)} role="search">
      <label htmlFor={id} className="sr-only">
        Search the docs
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("")
        }}
        placeholder="Search the docs"
        autoComplete="off"
        spellCheck={false}
        aria-controls={listId}
        className="h-9 w-full rounded-lg border border-input bg-background/70 px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div id={listId} aria-live="polite">
        {query.trim() !== "" && (
          <ul className="mt-2 flex flex-col gap-0.5 rounded-lg border bg-card p-1 text-sm shadow-sm">
            {hits.length === 0 ? (
              <li className="px-2.5 py-2 text-muted-foreground">Nothing matches “{query.trim()}”.</li>
            ) : (
              hits.map((hit) => (
                <li key={hit.href}>
                  <Link
                    href={hit.href}
                    onClick={() => setQuery("")}
                    className="flex flex-col rounded-md px-2.5 py-1.5 outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="font-medium">{hit.title}</span>
                    <span className="text-xs text-muted-foreground">{hit.page}</span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
