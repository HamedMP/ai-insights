import type { Metadata } from "next"
import { after } from "next/server"

import { TrackOnMount } from "@/components/site/analytics"
import { Footer } from "@/components/site/footer"
import { AccountMenu } from "@/components/site/account-menu"
import { Header } from "@/components/site/header"
import { BoardList, BoardTable } from "@/components/site/leaderboard-table"
import { YouPanel } from "@/components/site/you-panel"
import { clerkEnabled } from "@/lib/auth-config"
import { EVENTS } from "@/lib/analytics-sanitize"
import { boardPage, boardPosition, databaseConfigured, entryByUser, ranksFor, type BoardPage, type PublicEntry, type Ranks } from "@/lib/db"
import { ARENAS, boardHref, MAX_PAGE, PAGE_SIZE, pageCount, pageOfPosition, parsePage, parseSort, SORTS, sortOf, type SortId } from "@/lib/leaderboard"
import { formatInt } from "@/lib/share"
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

/** Quick presets above the table: the five arenas, plus (on narrow screens, which have no header row) the other sorts. */
const PRESET_LABEL: Record<SortId, string> = { tokens: "Most tokens", spend: "Most spent", "claude-code": "Claude Code", codex: "Codex", streak: "Longest streak", active: "Active days", sessions: "Sessions", devices: "Devices" }

function Presets({ sort }: { sort: SortId }) {
  return (
    <nav aria-label="Sort the leaderboard" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0 lg:pb-0">
      {SORTS.map((s) => {
        const arena = ARENAS.some((a) => a.id === s.id)
        return (
          <a
            key={s.id}
            href={boardHref(BASE, s.id)}
            aria-current={s.id === sort ? "page" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-md border px-3 font-mono text-[11.5px] tracking-[0.02em] whitespace-nowrap transition-colors outline-none hover:border-foreground/30 hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50",
              s.id === sort ? "border-foreground bg-foreground text-background hover:border-foreground hover:bg-foreground" : "border-border bg-background text-ink-soft",
              !arena && "lg:hidden",
            )}
          >
            {PRESET_LABEL[s.id]}
          </a>
        )
      })}
    </nav>
  )
}

function Pager({ sort, page, pages }: { sort: SortId; page: number; pages: number }) {
  if (pages <= 1) return null
  const link = "inline-flex h-8 items-center rounded-md border bg-background px-3 font-mono text-[12px] outline-none hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50"
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      {page > 1 ? <a className={link} href={boardHref(BASE, sort, page - 1)} rel="prev">← Previous</a> : <span />}
      <span className="font-mono text-[12px] text-muted-foreground">Page {page} of {pages}</span>
      {page < pages ? <a className={link} href={boardHref(BASE, sort, page + 1)} rel="next">Next →</a> : <span />}
    </nav>
  )
}

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const sort = parseSort(params)
  // Analytics keep the "arena" property name: a fixed sort id, never input.
  const arena = sort
  const page = parsePage(Array.isArray(params.page) ? params.page[0] : params.page)
  const userId = await currentUserId()
  if (userId) after(() => recordSignupSource(userId))

  let board: BoardPage | null = null
  let mine: PublicEntry | null = null
  let ranks: Ranks = {}
  let position: { position: number; rank: number | null } | null = null
  if (databaseConfigured()) {
    try {
      ;[board, mine, ranks, position] = await Promise.all([
        boardPage(sort, page),
        userId ? entryByUser(userId) : null,
        userId ? ranksFor(userId) : {},
        userId ? boardPosition(userId, sort) : null,
      ])
    } catch (error) {
      logError("leaderboard read failed", error)
      board = null
    }
  }
  const pages = board ? pageCount(board.total) : 1
  const myPage = position ? pageOfPosition(position.position) : null
  const jump = mine && myPage ? boardHref(BASE, sort, myPage) : null
  const active = sortOf(sort)
  const firstShown = (page - 1) * PAGE_SIZE + 1

  return (
    <>
      <Header account={<AccountMenu />} />
      <TrackOnMount event={EVENTS.arenaViewed} properties={{ arena, page }} />
      <main id="top" className="relative overflow-x-clip">
        <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[28rem] opacity-70" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-5 px-4 pt-8 pb-20 md:px-8 md:pt-12">
          <div className="flex flex-col gap-3">
            <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">AI Insights · Leaderboard</p>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
              <h1 className="text-[2.2rem] leading-[1] font-semibold tracking-[-0.04em] sm:text-[2.75rem]">
                Who codes with AI <span className="text-primary">the most.</span>
              </h1>
              {board && board.total > 0 && (
                <p className="font-mono text-[12px] text-muted-foreground tabular-nums">
                  <span className="text-foreground">{formatInt(board.total)}</span> {board.total === 1 ? "person" : "people"} · sorted by <span className="text-foreground">{active.label.toLowerCase()}</span>
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1 text-[14px] text-muted-foreground">
              <p>Totals people published from their own AI Insights recaps. Self-reported, not verified; the Claude Code and Codex columns are estimates.</p>
              <details className="group w-fit">
                <summary className="cursor-pointer list-none font-mono text-[11.5px] text-ink-soft underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>How this is counted
                </summary>
                <ul className="mt-2 flex max-w-2xl list-disc flex-col gap-1 pl-5 text-[13px]">
                  <li>Every number comes from a person&rsquo;s own report and is published only when they press Publish. The site checks the format, not the truth.</li>
                  <li>Claude Code and Codex tokens are estimated as total tokens times that agent&rsquo;s share of sessions; reports carry no per-agent token split.</li>
                  <li>Someone who publishes from several computers is counted on the total across them. Rank is for the column you sort by; ties share a rank, and a blank value has none.</li>
                  <li>
                    More in the <a className="text-foreground underline underline-offset-4" href={`${BASE}/docs/sharing#arenas`}>docs</a>.
                  </li>
                </ul>
              </details>
            </div>
          </div>

          {mine && <YouPanel entry={mine} ranks={ranks} jump={jump} />}

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Presets sort={sort} />
            {jump && position && (
              <a href={`${jump}#u-${mine!.handle}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/[0.06] px-3 font-mono text-[11.5px] text-primary outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 max-lg:hidden">
                Jump to me{position.rank !== null && <span className="text-primary/80">· #{position.rank}</span>}
              </a>
            )}
          </div>

          {!board || board.rows.length === 0 ? (
            <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center">
              <h2 className="text-xl font-semibold">{board ? (page > 1 ? "No one this far down yet." : "No one here yet. Be first.") : "The leaderboard is resting."}</h2>
              <p className="max-w-md text-muted-foreground">
                {board ? "Run the command, make a share link from your report, and press Publish on it." : "It could not be loaded just now. Try again in a minute."}
              </p>
              <code className="rounded-lg border bg-background px-3 py-2 font-mono text-[14px]">{COMMAND}</code>
              {board && page > 1 && <a className="text-sm underline underline-offset-4" href={boardHref(BASE, sort)}>Back to the top</a>}
            </section>
          ) : (
            <section aria-label={`Leaderboard, sorted by ${active.label.toLowerCase()}`} className="flex flex-col gap-4">
              <div className="overflow-clip rounded-xl border bg-card shadow-[0_1px_0_rgb(0_0_0/0.03)]">
                <BoardTable rows={board.rows} sort={sort} top={board.top} me={mine?.handle ?? null} />
                <BoardList rows={board.rows} sort={sort} top={board.top} me={mine?.handle ?? null} />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
                  {formatInt(firstShown)}–{formatInt(firstShown + board.rows.length - 1)} of {formatInt(board.total)}
                  {board.ranked < board.total && ` · ${formatInt(board.total - board.ranked)} with no ${active.short} value listed last`}
                  {pages >= MAX_PAGE && ` · the first ${formatInt(MAX_PAGE * PAGE_SIZE)} are listed`}
                </p>
                <Pager sort={sort} page={page} pages={pages} />
              </div>
            </section>
          )}

          {board && board.total > 0 && board.total < 10 && (
            <p className="rounded-xl border border-dashed px-4 py-3 text-[14px] text-muted-foreground">
              Early days: the board is small. Add yourself with <code className="font-mono text-foreground">{COMMAND}</code>, then publish from your report&rsquo;s share link.
            </p>
          )}

          <p className="text-[13px] text-muted-foreground">
            {clerkEnabled ? "To join, open the share link from your report and press Publish. Publishing needs a Matrix account and sends only the numbers on the card." : "Publishing opens soon. Your report's share link already works."}
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
