import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Footer } from "@/components/site/footer"
import { AccountMenu } from "@/components/site/account-menu"
import { Header } from "@/components/site/header"
import { OwnerReferrals } from "@/components/site/owner-referrals"
import { AgentsAndFact, BadgePill, CardGallery, EarnedTitles, joinedLabel, ProfileHeader, StatStrip, WorkRatios } from "@/components/site/profile"
import { FindOutYours } from "@/components/site/share-card"
import { ShareButtons } from "@/components/site/share-buttons"
import { profileBadges, profilePost } from "@/lib/arena-format"
import { referralLink } from "@/lib/referral"
import { BASE, SITE_URL } from "@/lib/site"

import { loadProfile, loadProfileExtras } from "./data"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ handle: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const entry = await loadProfile(handle)
  if (!entry || entry === "error") return { title: "AI Insights", robots: { index: false } }
  const title = `${entry.displayName}'s AI Insights: find out yours`
  const url = new URL(`u/${entry.handle}`, SITE_URL).toString()
  const description = `${entry.displayName}'s AI coding recap (self-reported). Find out yours with npx ai-insights.`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "AI Insights", type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  }
}

/** A published entry, rendered from the database as text: who, how they rank, their numbers and their recap cards. */
export default async function ProfilePage({ params }: Props) {
  const { handle } = await params
  const entry = await loadProfile(handle)
  if (entry === "error") throw new Error("profile unavailable")
  if (!entry) notFound()
  const { ranks, referrals } = await loadProfileExtras(entry.handle)
  const badges = profileBadges(ranks)
  const shareUrl = referralLink(SITE_URL, entry.handle)
  const hasCards = Boolean(entry.stats.cards && entry.stats.cards.length > 0)

  return (
    <>
      <Header account={<AccountMenu />} />
      <main id="top" className="relative overflow-hidden">
        <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[40rem]" />
        <div className="relative mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-6 pb-20 sm:gap-8 md:px-8 md:pt-12">
          <ProfileHeader
            name={entry.displayName}
            handle={entry.handle}
            avatarUrl={entry.avatarUrl}
            joined={joinedLabel(entry.createdAt)}
            stats={entry.stats}
            badge={badges[0] ?? null}
            referrals={referrals}
            share={<ShareButtons post={profilePost(shareUrl)} url={shareUrl} />}
          />
          <StatStrip stats={entry.stats} />
          {badges.length > 1 && (
            <section aria-labelledby="ranks" className="flex flex-col gap-3">
              <h2 id="ranks" className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">leaderboard ranks</h2>
              <div className="flex flex-wrap gap-2">
                {badges.map((b) => (
                  <BadgePill key={b.arena} badge={b} />
                ))}
              </div>
            </section>
          )}
          <EarnedTitles stats={entry.stats} />
          <AgentsAndFact stats={entry.stats} />
          <WorkRatios stats={entry.stats} />
          <OwnerReferrals handle={entry.handle} hasCards={hasCards} />
          <CardGallery cards={entry.stats.cards} handle={entry.handle} />
          <p className="font-mono text-[11px] text-muted-foreground">
            Published by @{entry.handle} from their own AI Insights report. Self-reported, not verified. ·{" "}
            <a className="underline-offset-4 hover:underline" href={`${BASE}/leaderboard`}>see the leaderboard</a>
          </p>
          <div className="flex justify-center pt-6">
            <FindOutYours note="Your report stays on your machine. Publishing a profile like this one is optional and sends only the lines you see." />
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
