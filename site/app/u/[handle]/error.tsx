"use client"

import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { BASE } from "@/lib/site"

/** A profile read failed and there was no cached copy to fall back on. Nothing about the failure is shown. */
export default function ProfileError({ reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <Header />
      <main id="top" className="mx-auto flex max-w-4xl flex-col px-4 pt-12 pb-20 md:px-8">
        <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center">
          <h1 className="text-xl font-semibold">This profile could not be loaded just now.</h1>
          <p className="max-w-md text-muted-foreground">Try again in a minute.</p>
          <div className="flex gap-4 text-sm">
            <button type="button" onClick={reset} className="underline underline-offset-4">Try again</button>
            <a className="underline underline-offset-4" href={`${BASE}/leaderboard`}>See the leaderboard</a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
