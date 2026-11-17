import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"

/** Docs pages are static and mount no Clerk: the header's account slot stays the plain leaderboard link. */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="top" className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Header />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  )
}
