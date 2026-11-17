import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft02Icon, ArrowRight02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"

import { DocsSearch } from "@/components/docs/docs-search"
import { DOC_GROUPS, DOCS, docBySlug, docHref, docSource, neighbours, type DocPage } from "@/lib/docs"
import { REPO } from "@/lib/site"
import { cn } from "@/lib/utils"

function DocNav({ current, label }: { current: string; label: string }) {
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
                  <a
                    href={docHref(doc.slug)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 items-center rounded-md border-l-2 border-transparent px-3 py-1.5 text-muted-foreground transition-colors outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                      active && "border-primary bg-brand-soft font-medium text-foreground hover:bg-brand-soft",
                    )}
                  >
                    {doc.title}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Toc({ page, className }: { page: DocPage; className?: string }) {
  if (page.sections.length < 2) return null
  return (
    <nav aria-label="On this page" className={cn("flex flex-col gap-2 text-[13px]", className)}>
      <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">On this page</p>
      <ul className="flex flex-col gap-0.5 border-l">
        {page.sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="-ml-px block border-l border-transparent py-1 pl-3 text-muted-foreground transition-colors outline-none hover:border-foreground/40 hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function PrevNext({ slug }: { slug: string }) {
  const { prev, next } = neighbours(slug)
  return (
    <nav aria-label="Previous and next page" className="mt-14 grid gap-3 border-t pt-8 sm:grid-cols-2">
      {prev ? (
        <a href={docHref(prev.slug)} className="docs-pager group">
          <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} className="size-3.5 transition-transform group-hover:-translate-x-0.5" /> Previous
          </span>
          <span className="font-semibold">{prev.title}</span>
        </a>
      ) : (
        <span className="max-sm:hidden" />
      )}
      {next && (
        <a href={docHref(next.slug)} className="docs-pager group sm:items-end sm:text-right">
          <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            Next <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="font-semibold">{next.title}</span>
        </a>
      )}
    </nav>
  )
}

/**
 * One docs page: the sidebar (a disclosure on phones, so it opens without script), the article with its title and
 * lede, the "On this page" list, and previous/next links. Everything is server-rendered.
 */
export function DocShell({ slug, children }: { slug: string; children: React.ReactNode }) {
  const page = docBySlug(slug)
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-20 md:px-8 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10 lg:pt-10 xl:grid-cols-[13.5rem_minmax(0,1fr)_12rem]">
      <aside className="max-lg:hidden">
        <div className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col gap-5 overflow-y-auto pr-1 pb-6">
          <DocsSearch />
          <DocNav current={slug} label="Docs" />
        </div>
      </aside>

      <details className="docs-menu group/menu mb-8 rounded-xl border bg-card lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-[11px] tracking-wide text-primary uppercase">Docs</span>
            <span className="truncate">{page.title}</span>
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground transition-transform group-open/menu:rotate-180" />
        </summary>
        <div className="flex flex-col gap-5 border-t px-1 pt-4 pb-5">
          <DocsSearch className="px-2" />
          <DocNav current={slug} label="Docs, menu" />
        </div>
      </details>

      <main id="content" className="min-w-0">
        <article className="docs-prose">
          <header className="mb-10 flex flex-col gap-3">
            <p className="font-mono text-xs tracking-wide text-primary">{page.group}</p>
            <h1 className="text-[2.2rem] leading-[1.05] font-semibold tracking-[-0.035em] md:text-[2.8rem]">{slug ? page.title : "AI Insights docs"}</h1>
            <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">{page.description}</p>
            {page.sections.length >= 2 && (
              <details className="group/toc mt-3 rounded-xl border bg-card/60 xl:hidden">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  On this page
                  <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4 text-muted-foreground transition-transform group-open/toc:rotate-180" />
                </summary>
                <div className="border-t px-4 pt-3 pb-4">
                  <Toc page={page} className="[&>p]:hidden" />
                </div>
              </details>
            )}
          </header>
          {children}
        </article>
        <p className="mt-12 text-sm text-muted-foreground">
          Something wrong or missing?{" "}
          <a className="link-underline text-foreground" href={`${REPO}/blob/main/${docSource(slug)}`}>
            Edit this page on GitHub
          </a>{" "}
          or{" "}
          <a className="link-underline text-foreground" href={`${REPO}/issues`}>
            open an issue
          </a>
          .
        </p>
        <PrevNext slug={slug} />
      </main>

      <aside className="max-xl:hidden">
        <div className="sticky top-20">
          <Toc page={page} />
        </div>
      </aside>
    </div>
  )
}
