import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft02Icon, ArrowRight02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"

import { docBySlug, docHref, docSource, neighbours, type DocPage } from "@/lib/docs"
import { REPO } from "@/lib/site"
import { cn } from "@/lib/utils"

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
        <Link href={docHref(prev.slug)} className="docs-pager group">
          <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} className="size-3.5 transition-transform group-hover:-translate-x-0.5" /> Previous
          </span>
          <span className="font-semibold">{prev.title}</span>
        </Link>
      ) : (
        <span className="max-sm:hidden" />
      )}
      {next && (
        <Link href={docHref(next.slug)} className="docs-pager group sm:items-end sm:text-right">
          <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            Next <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="font-semibold">{next.title}</span>
        </Link>
      )}
    </nav>
  )
}

/**
 * One docs page: the article with its title and lede, the "On this page" list, and previous/next links. The sidebar
 * is in the docs layout (components/docs/docs-nav.tsx), so it stays put while pages switch; these fill the layout's
 * second and third grid columns.
 */
export function DocShell({ slug, children }: { slug: string; children: React.ReactNode }) {
  const page = docBySlug(slug)
  return (
    <>
      <main id="content" tabIndex={-1} className="min-w-0 outline-none">
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
        <div className="sticky top-16">
          <Toc page={page} />
        </div>
      </aside>
    </>
  )
}
