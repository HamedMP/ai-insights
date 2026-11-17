"use client"

import { AccountMenu } from "@/components/site/account-menu"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { COMMAND } from "@/lib/site"

/** A board read failed and there was no cached view to fall back on. Nothing about the failure is shown. */
export default function LeaderboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <Header account={<AccountMenu />} />
      <main id="top" className="mx-auto flex max-w-6xl flex-col px-4 pt-12 pb-20 md:px-8">
      <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center">
        <h1 className="text-xl font-semibold">The leaderboard is resting.</h1>
        <p className="max-w-md text-muted-foreground">It could not be loaded just now. Try again in a minute.</p>
        <code className="rounded-lg border bg-background px-3 py-2 font-mono text-[14px]">{COMMAND}</code>
        <button type="button" onClick={reset} className="text-sm underline underline-offset-4">Try again</button>
      </section>
    </main>
      <Footer />
    </>
  )
}
