import type { Badge, BadgeTone } from "@/lib/arena-format"
import { agentName, CARD_TITLES, formatCompact, formatInt, formatPeriod, type CardKey, type SharedCard, type SharedStats } from "@/lib/share"
import { BASE } from "@/lib/site"
import { cn } from "@/lib/utils"

/**
 * The public profile's pieces. Every string shown comes from validated database columns and is rendered as React
 * text, never as HTML. Colours follow the report's "Pop" card style so a profile reads as the person's recap.
 */

const AGENT_COLORS = ["#ff7a2f", "#3d1bb3", "#8ff0c3", "#ffe14a", "#ff6b57", "#8ad3ff", "#ffb6d9", "#d6f25c"]

/** Card colours from the report's Pop style (src/render/client/card.css swatches), per card key. */
const CARD_STYLE: Record<CardKey, { bg: string; fg: string; dark?: boolean }> = {
  persona: { bg: "#3d1bb3", fg: "#f7f3ea", dark: true },
  parallel: { bg: "#ff7a2f", fg: "#141210" },
  tokens: { bg: "#c9b8ff", fg: "#141210" },
  streak: { bg: "#ff6b57", fg: "#141210" },
  marathon: { bg: "#8ad3ff", fg: "#141210" },
  clock: { bg: "#ffe14a", fg: "#141210" },
  manners: { bg: "#ffb6d9", fg: "#141210" },
  danger: { bg: "#f7f3ea", fg: "#141210" },
  hours: { bg: "#c9b8ff", fg: "#141210" },
  model: { bg: "#ffe14a", fg: "#141210" },
  weekday: { bg: "#8ff0c3", fg: "#141210" },
  tests: { bg: "#d6f25c", fg: "#141210" },
  shell: { bg: "#141210", fg: "#f7f3ea", dark: true },
  failures: { bg: "#8ff0c3", fg: "#141210" },
  words: { bg: "#f7f3ea", fg: "#141210" },
  slash: { bg: "#8ad3ff", fg: "#141210" },
  thinking: { bg: "#3d1bb3", fg: "#f7f3ea", dark: true },
  approvals: { bg: "#d6f25c", fg: "#141210" },
  history: { bg: "#ffb6d9", fg: "#141210" },
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
export const joinedLabel = (iso: string) => `Joined ${MONTH_YEAR.format(new Date(iso))}`

/** Initials for the avatar: first letters of up to two words, or the handle's first letter. */
function initials(name: string, handle: string): string {
  const words = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w))
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join("")
  return letters || handle.slice(0, 1).toUpperCase()
}

export function ProfileHeader({ name, handle, joined, stats, badge, referrals, share }: { name: string; handle: string; joined: string; stats: SharedStats; badge: Badge | null; referrals: number; share: React.ReactNode }) {
  return (
    <header className="relative overflow-hidden rounded-[1.6rem] border bg-card shadow-sm">
      <div aria-hidden className="h-24 bg-[linear-gradient(110deg,#ff7a2f_0%,#ff6b57_38%,#c9b8ff_72%,#8ad3ff_100%)] sm:h-28" />
      <div className="flex flex-col gap-5 px-5 pb-6 sm:px-8 sm:pb-8">
        <div className="-mt-12 flex flex-wrap items-end justify-between gap-4 sm:-mt-14">
          <div aria-hidden className="grid size-24 place-items-center rounded-[1.4rem] border-4 border-card bg-[#141210] text-[2.2rem] font-semibold tracking-[-0.04em] text-[#ffe14a] shadow-md sm:size-28 sm:text-[2.6rem]">
            {initials(name, handle)}
          </div>
          <div className="max-sm:hidden">{share}</div>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-[2.1rem] leading-[1.02] font-semibold tracking-[-0.04em] break-words sm:text-[2.8rem]">{name}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12.5px] text-muted-foreground">
            <span className="text-foreground">@{handle}</span>
            <span aria-hidden>·</span>
            <span>{joined}</span>
            <span aria-hidden>·</span>
            <span>covers {formatPeriod(stats.from, stats.to)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {badge && <BadgePill badge={badge} big />}
          {referrals > 0 && (
            <span className="inline-flex h-8 items-center rounded-full border bg-background px-3 text-[13px] font-medium">
              Brought {formatInt(referrals)} {referrals === 1 ? "person" : "people"} to AI Insights
            </span>
          )}
          <span className="inline-flex h-8 items-center rounded-full border border-dashed px-3 font-mono text-[11px] text-muted-foreground">self-reported</span>
        </div>
        <div className="sm:hidden">{share}</div>
      </div>
    </header>
  )
}

const TONE: Record<BadgeTone, string> = {
  gold: "bg-[#ffe14a] text-[#141210] ring-[#141210]/15",
  silver: "bg-[#e7e5df] text-[#141210] ring-[#141210]/15",
  bronze: "bg-[#f0a26c] text-[#141210] ring-[#141210]/15",
  hot: "bg-[#ff7a2f] text-[#141210] ring-[#141210]/15",
  plain: "bg-background text-foreground ring-border",
}

export function BadgePill({ badge, big = false }: { badge: Badge; big?: boolean }) {
  return (
    <a
      href={`${BASE}/leaderboard?arena=${badge.arena}`}
      className={cn("inline-flex items-center gap-2 rounded-full font-semibold ring-1 transition-transform outline-none hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/50", TONE[badge.tone], big ? "h-8 px-3.5 text-[14px]" : "h-7 px-3 text-[13px]")}
    >
      {badge.tone !== "plain" && <span aria-hidden className="size-2 rounded-full bg-[#141210]/70" />}
      {badge.label}
    </a>
  )
}

export function StatStrip({ stats }: { stats: SharedStats }) {
  const items: Array<[string, string]> = [
    ["sessions", formatInt(stats.sessions)],
    ["tokens", formatCompact(stats.tokens)],
    ["active days", formatInt(stats.activeDays)],
    ["longest streak", `${formatInt(stats.streak)} ${stats.streak === 1 ? "day" : "days"}`],
  ]
  if (stats.usd !== null) items.push(["estimated spend", `$${formatInt(stats.usd)}`])
  return (
    <dl className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border", items.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
      {items.map(([label, value], i) => (
        <div key={label} className={cn("flex flex-col gap-1 bg-card px-4 py-4 sm:px-5", items.length === 5 && i === 4 && "max-sm:col-span-2")}>
          <dt className="order-2 font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">{label}</dt>
          <dd className="order-1 text-[1.65rem] leading-none font-semibold tracking-[-0.03em] tabular-nums sm:text-[1.9rem]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function AgentsAndFact({ stats }: { stats: SharedStats }) {
  if (!stats.agents.length && !stats.fact) return null
  return (
    <section aria-label="Agents" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-stretch">
      {stats.agents.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border bg-card px-5 py-4">
          <h2 className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">agents, by share of sessions</h2>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            {stats.agents.map((a, i) => (
              <span key={`${a.k}-${i}`} style={{ width: `${a.p}%`, background: AGENT_COLORS[i % AGENT_COLORS.length] }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
            {stats.agents.map((a, i) => (
              <li key={`${a.k}-${i}`} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full ring-1 ring-black/10" style={{ background: AGENT_COLORS[i % AGENT_COLORS.length] }} />
                {agentName(a.k)} <span className="font-mono text-muted-foreground">{a.p}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {stats.fact && (
        <p className="flex items-center rounded-2xl bg-[#141210] px-5 py-4 text-[17px] leading-snug font-medium text-[#f7f3ea] break-words sm:max-w-[18rem]">
          <span>
            <span className="mb-1 block font-mono text-[10.5px] tracking-wide text-[#ffe14a] uppercase">fun fact</span>
            {stats.fact}
          </span>
        </p>
      )}
    </section>
  )
}

/** Wide cards: the persona headline is a phrase, not a number, so it gets two columns. */
const WIDE = new Set<CardKey>(["persona"])

export function RecapCard({ card, span }: { card: SharedCard; span?: string }) {
  const style = CARD_STYLE[card.k]
  const long = Array.from(card.b).length > 9
  return (
    <li
      className={cn("relative flex min-h-[10.5rem] flex-col justify-between gap-4 overflow-hidden rounded-[1.4rem] p-4 shadow-[0_1px_0_rgb(0_0_0/0.04)] ring-1 ring-black/10 sm:min-h-[12.5rem] sm:p-5", WIDE.has(card.k) && "col-span-2", span, card.k === "danger" && "ring-2 ring-[#141210]")}
      style={{ background: style.bg, color: style.fg }}
    >
      <div aria-hidden className={cn("pointer-events-none absolute -right-10 -bottom-10 size-32 rounded-full", style.dark ? "bg-white/10" : "bg-white/35")} />
      <h3 className="relative font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase opacity-70">{CARD_TITLES[card.k]}</h3>
      <div className="relative flex flex-col gap-1.5">
        <p className={cn("leading-[0.95] font-semibold tracking-[-0.045em] break-words tabular-nums", long ? "text-[1.4rem] sm:text-[1.9rem]" : "text-[2.1rem] sm:text-[2.7rem]")}>{card.b}</p>
        {card.c && <p className="text-[12.5px] leading-snug font-medium opacity-75 sm:text-[13.5px]">{card.c}</p>}
      </div>
    </li>
  )
}

/** Widen the last card when it would sit alone in its row: two columns on phones, three from `sm`. */
function lastSpan(cards: SharedCard[]): string | undefined {
  const wide = cards.filter((c) => WIDE.has(c.k)).length
  const narrow = cards.length - wide
  const phone = narrow % 2 === 1 ? "col-span-2" : ""
  const desktop = (cards.length + wide) % 3 === 1 ? "sm:col-span-3" : (cards.length + wide) % 3 === 2 ? "sm:col-span-2" : "sm:col-span-1"
  return cn(phone, desktop) || undefined
}

export function CardGallery({ cards, handle }: { cards: SharedCard[] | undefined; handle: string }) {
  return (
    <section aria-labelledby="cards" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="cards" className="text-[1.5rem] font-semibold tracking-[-0.03em]">Recap cards</h2>
        {cards && cards.length > 0 && <span className="font-mono text-[11px] text-muted-foreground">{cards.length} cards</span>}
      </div>
      {cards && cards.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {cards.map((card, i) => (
            <RecapCard key={card.k} card={card} span={i === cards.length - 1 && !WIDE.has(card.k) ? lastSpan(cards) : undefined} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center">
          <p className="text-lg font-semibold">No recap cards yet</p>
          <p className="max-w-md text-[14px] text-muted-foreground">
            @{handle} published from an older report, which carried only the numbers above. Cards appear here when they publish again from AI Insights 0.4 or newer.
          </p>
        </div>
      )}
    </section>
  )
}
