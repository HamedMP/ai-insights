import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { FindOutYours, StatsCard } from "@/components/site/share-card"
import { BASE, SITE_URL } from "@/lib/site"

import { loadProfile } from "./data"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ handle: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const entry = await loadProfile(handle)
  if (!entry || entry === "error") return { title: "AI Insights", robots: { index: false } }
  const title = `${entry.displayName}'s AI Insights: find out yours`
  const url = new URL(`u/${entry.handle}/`, SITE_URL).toString()
  const description = `${entry.displayName}'s AI coding recap (self-reported). Find out yours with npx ai-insights.`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "AI Insights", type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  }
}

/** A published entry, rendered from the database as text with the same card as /share. */
export default async function ProfilePage({ params }: Props) {
  const { handle } = await params
  const entry = await loadProfile(handle)
  if (entry === "error") throw new Error("profile unavailable")
  if (!entry) notFound()
  return (
    <>
      <Header />
      <main id="top" className="relative overflow-hidden">
        <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[40rem]" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-10 px-4 pt-8 pb-20 md:px-8 md:pt-14">
          <StatsCard stats={entry.stats} />
          <p className="-mt-6 font-mono text-[11px] text-muted-foreground">
            @{entry.handle} · self-reported · <a className="underline-offset-4 hover:underline" href={`${BASE}/leaderboard/`}>see the leaderboard</a>
          </p>
          <FindOutYours note="Published by its owner from their own AI Insights report. The numbers are self-reported." />
        </div>
      </main>
      <Footer />
    </>
  )
}
