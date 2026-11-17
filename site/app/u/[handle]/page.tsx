import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Footer } from "@/components/site/footer"
import { AccountMenu } from "@/components/site/account-menu"
import { Header } from "@/components/site/header"
import { NavLink } from "@/components/site/nav-link"
import { OwnerReferrals } from "@/components/site/owner-referrals"
import { DeviceGallery } from "@/components/site/device-gallery"
import { OwnerDevices } from "@/components/site/owner-devices"
import { AgentsAndFact, BadgePill, DevicesStrip, EarnedTitles, joinedLabel, ProfileHeader, StatStrip, WorkRatios } from "@/components/site/profile"
import { FindOutYours } from "@/components/site/share-card"
import { ShareButtons } from "@/components/site/share-buttons"
import { profileBadges, profilePost } from "@/lib/arena-format"
import { referralLink } from "@/lib/referral"
import { BASE, SITE_URL } from "@/lib/site"

import { loadProfile, loadProfileExtras } from "./data"

// Rendered on a profile's first visit and then served from the cache; a publish or change expires it at once
// (lib/board-cache.ts). The number is the safety net, kept equal to BOARD_REVALIDATE_SECONDS (Next reads it statically).
export const revalidate = 3600

/** No profile is built ahead: each one is rendered when it is first opened. */
export function generateStaticParams(): Array<{ handle: string }> {
  return []
}

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
  const counted = entry.devices.filter((d) => !d.duplicate)

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
            devices={entry.deviceCount}
          />
          <StatStrip stats={entry.stats} atLeast={!entry.exactDays} />
          <DevicesStrip devices={entry.devices} />
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
          {entry.perDeviceRatios.length > 0 && counted.length > 1 && (
            <p className="-mt-3 text-[12.5px] text-muted-foreground">Some ratios are not combined across devices because an older report did not send the counts behind them. Pick a device under Recap cards to see its own.</p>
          )}
          <OwnerReferrals handle={entry.handle} hasCards={hasCards} />
          <OwnerDevices handle={entry.handle} />
          <DeviceGallery handle={entry.handle} highlights={entry.highlights} devices={counted.map((d) => ({ label: d.label, cards: d.stats.cards, stats: d.stats }))} />
          <p className="font-mono text-[11px] text-muted-foreground">
            Published by @{entry.handle} from their own AI Insights {entry.deviceCount > 1 ? `reports on ${entry.deviceCount} devices` : "report"}. Self-reported, not verified.{!entry.exactDays && " Active days and streak are lower bounds: not every device sent which days it was active."} ·{" "}
            <NavLink className="underline-offset-4 hover:underline" href={`${BASE}/leaderboard`}>see the leaderboard</NavLink>
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
