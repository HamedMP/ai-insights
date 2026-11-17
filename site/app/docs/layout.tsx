import { DocsHeader } from "@/components/docs/docs-header"
import { DocsNavigation } from "@/components/docs/docs-nav"
import { Footer } from "@/components/site/footer"

/**
 * Docs pages are static and mount no Clerk: the header's account slot stays the plain leaderboard link. The header and
 * the sidebar live here rather than in each page, so moving between docs pages swaps only the article.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="top" className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <DocsHeader />
      <div className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-20 md:px-8 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10 lg:pt-10 xl:grid-cols-[13.5rem_minmax(0,1fr)_12rem]">
          <DocsNavigation />
          {children}
        </div>
      </div>
      <Footer />
    </div>
  )
}
