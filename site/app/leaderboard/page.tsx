import type { Metadata } from "next"
import { after } from "next/server"

import { TrackOnMount } from "@/components/site/analytics"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { RankShare, RemoveEntry } from "@/components/site/rank-share"
import { formatScore, rankLabel, rankPost } from "@/lib/arena-format"
import { clerkEnabled } from "@/lib/auth-config"
import { EVENTS } from "@/lib/analytics-sanitize"
import { arenaPage, databaseConfigured, entryByUser, ranksFor, type ArenaPage } from "@/lib/db"
import { ARENAS, isArena, PAGE_SIZE, parsePage, type ArenaId } from "@/lib/leaderboard"
import { formatPeriod } from "@/lib/share"
import { BASE, COMMAND, SITE_URL } from "@/lib/site"
import { currentUserId, logError, recordSignupSource } from "@/lib/server-auth"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

const title = "AI Insights leaderboard"
const description = "Who uses AI coding agents the most: tokens, spend, Claude Code, Codex and streaks, self-reported from AI Insights recaps. Find out yours with npx ai-insights."

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: new URL("leaderboard", SITE_URL).toString() },
  openGraph: { title, description, url: new URL("leaderboard", SITE_URL).toString(), siteName: "AI Insights", type: "website", images: [{ url: "og.png", width: 1200, height: 630, alt: "AI Insights by Matrix OS" }] },
  twitter: { card: "summary_large_image", title, description, images: ["og.png"] },
}

const profileUrl = (handle: string) => new URL(`u/${handle}`, SITE_URL).toString()

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const arena: ArenaId = isArena(params.arena) ? params.arena : "tokens"
  const page = parsePage(params.page)
  const userId = await currentUserId()
  if (userId) after(() => recordSignupSource(userId))

  let board: ArenaPage | null = null
  let mine: Awaited<ReturnType<typeof entryByUser>> = null
  let ranks: Awaited<ReturnType<typeof ranksFor>> = {}
  if (databaseConfigured()) {
    try {
      ;[board, mine, ranks] = await Promise.all([arenaPage(arena, page), userId ? entryByUser(userId) : null, userId ? ranksFor(userId) : {}])
    } catch (error) {
      logError("leaderboard read failed", error)
      board = null
    }
  }
  const pages = board ? Math.max(1, Math.ceil(board.total / PAGE_SIZE)) : 1
  const href = (a: ArenaId, p = 1) => `${BASE}/leaderboard?arena=${a}${p > 1 ? `&page=${p}` : ""}`

  return (
    <>
      <Header />
      <TrackOnMount event={EVENTS.arenaViewed} properties={{ arena, page }} />
      <main id="top" className="relative overflow-hidden">
        <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[40rem]" />
        <div className="relative mx-auto flex max-w-4xl flex-col gap-8 px-4 pt-8 pb-20 md:px-8 md:pt-14">
          <div className="flex flex-col gap-3">
            <h1 className="text-[2.4rem] leading-[1] font-semibold tracking-[-0.04em] sm:text-[3rem]">
              The <span className="text-primary">leaderboard.</span>
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Numbers people published from their own AI Insights recaps. They are self-reported and not verified. Agent arenas estimate each agent&rsquo;s tokens as total tokens times its share of sessions.
            </p>
          </div>

          {mine && (
            <section aria-labelledby="you" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="you" className="text-lg font-semibold">You, as <a className="underline-offset-4 hover:underline" href={`${BASE}/u/${mine.handle}`}>{mine.displayName}</a></h2>
                <RemoveEntry />
              </div>
              <ul className="flex flex-col divide-y">
                {ARENAS.map((a) => {
                  const r = ranks[a.id]
                  if (!r) return null
                  const label = rankLabel(a.id, r.rank, r.topPercent, r.total)
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="font-medium">{label}</span>
                      <RankShare post={rankPost(label, profileUrl(mine.handle))} url={profileUrl(mine.handle)} />
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <nav aria-label="Arenas" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {ARENAS.map((a) => (
              <a
                key={a.id}
                href={href(a.id)}
                aria-current={a.id === arena ? "page" : undefined}
                className={cn("rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-muted", a.id === arena && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                {a.title}
              </a>
            ))}
          </nav>

          {!board || board.rows.length === 0 ? (
            <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
              <h2 className="text-xl font-semibold">{board ? (page > 1 ? "No one this far down yet." : "No one here yet.") : "The leaderboard is resting."}</h2>
              <p className="max-w-md text-muted-foreground">
                {board ? "Run the command, make a share link from your report, and press Publish on it to be first." : "It could not be loaded just now. Try again in a minute."}
              </p>
              <code className="rounded-lg border bg-card px-3 py-2 font-mono">{COMMAND}</code>
            </section>
          ) : (
            <section aria-label={ARENAS.find((a) => a.id === arena)!.title}>
              <ol className="flex flex-col divide-y rounded-2xl border bg-card">
                {board.rows.map((row) => (
                  <li key={row.handle} className="flex items-center gap-4 px-4 py-3">
                    <span className="w-10 shrink-0 font-mono text-sm text-muted-foreground tabular-nums">#{row.rank}</span>
                    <a href={`${BASE}/u/${row.handle}`} className="flex min-w-0 flex-1 flex-col underline-offset-4 hover:underline">
                      <span className="truncate font-medium">{row.displayName}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">@{row.handle} · {formatPeriod(row.stats.from, row.stats.to)}</span>
                    </a>
                    <span className="shrink-0 text-right font-semibold tabular-nums">{formatScore(arena, row.score)}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-center justify-between text-sm">
                {page > 1 ? <a className="underline-offset-4 hover:underline" href={href(arena, page - 1)}>Previous</a> : <span />}
                <span className="text-muted-foreground">Page {page} of {pages}</span>
                {page < pages && page < 200 ? <a className="underline-offset-4 hover:underline" href={href(arena, page + 1)}>Next</a> : <span />}
              </div>
            </section>
          )}

          <p className="text-sm text-muted-foreground">
            {clerkEnabled ? "To join, open the share link from your report and press Publish. Publishing needs a Matrix account and sends only the numbers on the card." : "Publishing opens soon. Your report's share link already works."}
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
