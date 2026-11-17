"use client"

import * as React from "react"

import { FindOutYours } from "@/components/site/find-out-yours"
import { PublishSlot } from "@/components/site/publish-slot"
import { restoreFragment } from "@/lib/pending-share"
import { track } from "@/lib/analytics"
import { EVENTS } from "@/lib/analytics-sanitize"
import { Wordmark } from "@/components/site/rabbit"
import { decodeStats, formatCompact, formatInt, formatPeriod, agentName, tokensMeasured, type SharedStats } from "@/lib/share"
import { HASHTAG } from "@/lib/site"
import { cn } from "@/lib/utils"

const AGENT_COLORS = ["#ff6a1a", "#f3f0e8", "#bed77b", "#8ab4ff", "#f7c948", "#d08cff", "#7ce0c3", "#ff9db0"]

function readFragment(): SharedStats | null | undefined {
  if (typeof window === "undefined") return undefined
  return decodeStats(window.location.hash)
}

/**
 * The shared stats card on /share. Everything it shows comes from the URL fragment, validated by decodeStats and
 * rendered as React text (never as HTML). With no or a bad fragment it shows the same call to action without numbers.
 * `publish` renders the leaderboard controls under a valid card (only when sign-in is configured).
 */
export function ShareCard({ publish = false }: { publish?: boolean }) {
  // undefined: not read yet (static HTML before hydration); null: no valid payload.
  const [stats, setStats] = React.useState<SharedStats | null | undefined>(undefined)
  React.useEffect(() => {
    restoreFragment()
    const read = () => setStats(readFragment() ?? null)
    read()
    // Only whether the link was valid: never the payload, name or numbers.
    track(EVENTS.shareCardViewed, { valid: readFragment() != null })
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [])

  return <ShareLayout stats={stats} panel={stats && publish ? <PublishSlot stats={stats} /> : null} />
}

/**
 * With a publish panel, the panel comes first so Publish is on screen without scrolling: above the card on phones,
 * beside it (the card on the left, held in view) from `lg`. Without one, the card stands alone as before.
 */
export function ShareLayout({ stats, panel }: { stats: SharedStats | null | undefined; panel: React.ReactNode }) {
  const note = stats ? "These numbers were in the link itself; this page sends nothing unless you press Publish." : stats === null ? "This link had no stats in it, so here is the short version." : null
  return (
    <div className={cn("relative mx-auto flex max-w-6xl flex-col items-center gap-10 px-4 pb-20 md:px-8", panel ? "pt-6 md:pt-10" : "pt-8 md:pt-14")}>
      {panel ? (
        <div className="grid w-full max-w-[40rem] gap-6 lg:max-w-none lg:grid-cols-[34rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">{panel}</div>
          <div className="flex justify-center lg:sticky lg:top-16 lg:col-start-1 lg:row-start-1">
            <StatsCard stats={stats} />
          </div>
        </div>
      ) : (
        <StatsCard stats={stats} />
      )}
      <FindOutYours note={note} />
    </div>
  )
}

/** The card itself. `undefined` stats means "not read yet" and renders invisible, so the layout does not jump. */
export function StatsCard({ stats, headingLevel = 1 }: { stats: SharedStats | null | undefined; headingLevel?: 1 | 2 }) {
  const who = stats?.name ? stats.name : stats ? "Someone" : null
  const Heading = headingLevel === 1 ? "h1" : "h2"
  return (
      <article
        aria-label={who ? `${who}'s AI Insights` : "AI Insights"}
        className={cn("on-dark w-full max-w-[34rem] overflow-hidden rounded-[1.6rem] bg-[#17140f] text-[#f3f0e8] shadow-2xl ring-1 ring-black/10 transition-opacity duration-300 dark:ring-white/10", stats === undefined && "opacity-0")}
      >
        <div className="relative flex flex-col gap-6 p-6 sm:p-8">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-[#ff6a1a]/25 blur-3xl" />
          <div className="relative flex items-center justify-between gap-3 font-mono text-[11px] tracking-wide text-[#f3f0e8]/60 uppercase">
            <span>AI Insights</span>
            {stats && <span>{formatPeriod(stats.from, stats.to)}</span>}
          </div>
          <Heading className="relative text-[2.2rem] leading-[1] font-semibold tracking-[-0.04em] break-words sm:text-[2.8rem]">
            {who ? (
              <>
                {who}&rsquo;s <span className="text-[#ff6a1a]">AI Insights</span>
              </>
            ) : (
              <>
                Your AI coding, <span className="text-[#ff6a1a]">recapped.</span>
              </>
            )}
          </Heading>

          {stats ? (
            <>
              <dl className="relative grid grid-cols-2 gap-x-4 gap-y-5">
                <Stat label="sessions" value={formatInt(stats.sessions)} />
                <Stat label={tokensMeasured(stats) ? "tokens" : "tokens, not measured"} value={tokensMeasured(stats) ? formatCompact(stats.tokens) : "n/a"} />
                <Stat label="active days" value={formatInt(stats.activeDays)} />
                <Stat label="longest streak" value={`${formatInt(stats.streak)} ${stats.streak === 1 ? "day" : "days"}`} />
                {stats.usd !== null && <Stat label="estimated spend" value={`$${formatInt(stats.usd)}`} wide />}
              </dl>
              {stats.agents.length > 0 && (
                <div className="relative flex flex-col gap-2.5">
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
                    {stats.agents.map((a, i) => (
                      <span key={`${a.k}-${i}`} style={{ width: `${a.p}%`, background: AGENT_COLORS[i % AGENT_COLORS.length] }} />
                    ))}
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#f3f0e8]/80">
                    {stats.agents.map((a, i) => (
                      <li key={`${a.k}-${i}`} className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="size-2 rounded-full" style={{ background: AGENT_COLORS[i % AGENT_COLORS.length] }} />
                        {agentName(a.k)} <span className="font-mono text-[#f3f0e8]/55">{a.p}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {stats.fact && <p className="relative rounded-2xl bg-white/[0.06] px-4 py-3 text-[17px] leading-snug font-medium break-words">{stats.fact}</p>}
            </>
          ) : (
            <p className="relative text-[17px] leading-relaxed text-[#f3f0e8]/75">
              Sessions, tokens, streaks, your persona and the agents you lean on, made from your own local Claude Code, Codex, Cursor, OpenCode, Pi and Gemini CLI history.
            </p>
          )}

          <div className="relative flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-[#f3f0e8]/55">
            <span className="font-mono text-[11px]">{HASHTAG}</span>
            <Wordmark className="h-4 text-[#f3f0e8]/70" />
          </div>
        </div>
      </article>

  )
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", wide && "col-span-2")}>
      <dt className="order-2 font-mono text-[11px] tracking-wide text-[#f3f0e8]/55 uppercase">{label}</dt>
      <dd className="order-1 text-[2rem] leading-none font-semibold tracking-[-0.03em] tabular-nums sm:text-[2.4rem]">{value}</dd>
    </div>
  )
}
