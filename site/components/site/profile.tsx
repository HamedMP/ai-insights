import type { Badge, BadgeTone } from "@/lib/arena-format"
import { initials, safeAvatarUrl } from "@/lib/avatar"
import { agentName, CARD_TITLES, EARNED_TITLES, formatInt, formatPeriod, RATIOS, ratioText, tokensText, type CardKey, type SharedCard, type SharedStats } from "@/lib/share"
import { boardHref } from "@/lib/leaderboard"
import { BASE } from "@/lib/site"
import { cn } from "@/lib/utils"

/**
 * The public profile's pieces. Every string shown comes from validated database columns and is rendered as React
 * text, never as HTML. Colours follow the report's "Pop" card style so a profile reads as the person's recap.
 */

export const AGENT_COLORS = ["#ff7a2f", "#3d1bb3", "#8ff0c3", "#ffe14a", "#ff6b57", "#8ad3ff", "#ffb6d9", "#d6f25c"]

/** Card colours from the report's Pop style (src/render/client/card.css swatches), per card key. */
export const CARD_STYLE: Record<CardKey, { bg: string; fg: string; dark?: boolean }> = {
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

/**
 * The person's chosen Clerk photo (an img.clerk.com URL, checked on write and on read), or their initials. Decorative:
 * the name beside it says who it is.
 */
export function Avatar({ url, name, handle, className }: { url: string | null; name: string; handle: string; className?: string }) {
  const safe = safeAvatarUrl(url)
  return (
    <span aria-hidden className={cn("on-dark grid shrink-0 place-items-center overflow-hidden bg-[#141210] font-semibold tracking-[-0.04em] text-[#ffe14a]", className)}>
      {safe ? (
        // eslint-disable-next-line @next/next/no-img-element -- a Clerk-hosted photo; next/image would proxy it through the site
        <img src={safe} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        initials(name, handle)
      )}
    </span>
  )
}

export function ProfileHeader({ name, handle, avatarUrl, joined, stats, badge, referrals, share, devices = 1 }: { name: string; handle: string; avatarUrl: string | null; joined: string; stats: SharedStats; badge: Badge | null; referrals: number; share: React.ReactNode; devices?: number }) {
  return (
    <header className="relative overflow-hidden rounded-[1.6rem] border bg-card shadow-sm">
      <div aria-hidden className="h-24 bg-[linear-gradient(110deg,#ff7a2f_0%,#ff6b57_38%,#c9b8ff_72%,#8ad3ff_100%)] sm:h-28" />
      <div className="flex flex-col gap-5 px-5 pb-6 sm:px-8 sm:pb-8">
        <div className="-mt-12 flex flex-wrap items-end justify-between gap-4 sm:-mt-14">
          <Avatar url={avatarUrl} name={name} handle={handle} className="size-24 rounded-[1.4rem] border-4 border-card text-[2.2rem] shadow-md sm:size-28 sm:text-[2.6rem]" />
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
            {devices > 1 && (
              <>
                <span aria-hidden>·</span>
                <a href="#devices" className="underline-offset-4 hover:underline">{devices} devices</a>
              </>
            )}
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
      href={boardHref(BASE, badge.arena)}
      className={cn("inline-flex items-center gap-2 rounded-full font-semibold ring-1 transition-transform outline-none hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/50", TONE[badge.tone], big ? "h-8 px-3.5 text-[14px]" : "h-7 px-3 text-[13px]")}
    >
      {badge.tone !== "plain" && <span aria-hidden className="size-2 rounded-full bg-[#141210]/70" />}
      {badge.label}
    </a>
  )
}

/** `atLeast`: active days and streak are lower bounds (some computer did not send its active days). */
export function StatStrip({ stats, atLeast = false }: { stats: SharedStats; atLeast?: boolean }) {
  const items: Array<[string, string]> = [
    ["sessions", formatInt(stats.sessions)],
    ["tokens", tokensText(stats)],
    [atLeast ? "active days, at least" : "active days", formatInt(stats.activeDays)],
    [atLeast ? "longest streak, at least" : "longest streak", `${formatInt(stats.streak)} ${stats.streak === 1 ? "day" : "days"}`],
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
        <p className="on-dark flex items-center rounded-2xl bg-[#141210] px-5 py-4 text-[17px] leading-snug font-medium text-[#f7f3ea] break-words sm:max-w-[18rem]">
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
export const WIDE = new Set<CardKey>(["persona"])

/** `small`: the same card as a tile, for the publish preview, where a whole recap has to fit beside the form. */
export function RecapCard({ card, span, note, small = false }: { card: SharedCard; span?: string; note?: string | null; small?: boolean }) {
  const style = CARD_STYLE[card.k]
  const long = Array.from(card.b).length > 9
  return (
    <li
      className={cn(
        "relative flex flex-col justify-between overflow-hidden shadow-[0_1px_0_rgb(0_0_0/0.04)] ring-1 ring-black/10",
        small ? "min-h-[6.75rem] gap-2.5 rounded-2xl p-3" : "min-h-[10.5rem] gap-4 rounded-[1.4rem] p-4 sm:min-h-[12.5rem] sm:p-5",
        WIDE.has(card.k) && "col-span-2",
        span,
        card.k === "danger" && "ring-2 ring-[#141210]",
      )}
      style={{ background: style.bg, color: style.fg }}
    >
      <div aria-hidden className={cn("pointer-events-none absolute rounded-full", small ? "-right-8 -bottom-8 size-20" : "-right-10 -bottom-10 size-32", style.dark ? "bg-white/10" : "bg-white/35")} />
      <h3 className={cn("relative font-mono font-medium uppercase opacity-70", small ? "text-[9.5px] tracking-[0.07em]" : "text-[10.5px] tracking-[0.08em]")}>{CARD_TITLES[card.k]}</h3>
      <div className={cn("relative flex flex-col", small ? "gap-1" : "gap-1.5")}>
        <p className={cn("leading-[0.95] font-semibold tracking-[-0.045em] break-words tabular-nums", small ? (long ? "text-[1.05rem]" : "text-[1.5rem]") : long ? "text-[1.4rem] sm:text-[1.9rem]" : "text-[2.1rem] sm:text-[2.7rem]")}>{card.b}</p>
        {card.c && <p className={cn("leading-snug font-medium opacity-75", small ? "text-[11px]" : "text-[12.5px] sm:text-[13.5px]")}>{card.c}</p>}
        {note && <p className="mt-1 font-mono text-[10px] tracking-[0.06em] uppercase opacity-55">{note}</p>}
      </div>
    </li>
  )
}

/** Widen the last card when it would sit alone in its row: two columns on phones, three from `sm`. */
export function lastSpan(cards: SharedCard[]): string | undefined {
  const wide = cards.filter((c) => WIDE.has(c.k)).length
  const narrow = cards.length - wide
  const phone = narrow % 2 === 1 ? "col-span-2" : ""
  const desktop = (cards.length + wide) % 3 === 1 ? "sm:col-span-3" : (cards.length + wide) % 3 === 2 ? "sm:col-span-2" : "sm:col-span-1"
  return cn(phone, desktop) || undefined
}

export function CardGallery({ cards, handle, notes, toolbar, empty }: { cards: SharedCard[] | undefined; handle: string; notes?: Array<string | null>; toolbar?: React.ReactNode; empty?: string }) {
  return (
    <section aria-labelledby="cards" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="cards" className="text-[1.5rem] font-semibold tracking-[-0.03em]">Recap cards</h2>
        {cards && cards.length > 0 && <span className="font-mono text-[11px] text-muted-foreground">{cards.length} cards</span>}
      </div>
      {toolbar}
      {cards && cards.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {cards.map((card, i) => (
            <RecapCard key={card.k} card={card} note={notes?.[i]} span={i === cards.length - 1 && !WIDE.has(card.k) ? lastSpan(cards) : undefined} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center">
          <p className="text-lg font-semibold">No recap cards yet</p>
          <p className="max-w-md text-[14px] text-muted-foreground">
            {empty ?? `@${handle} published from an older report, which carried only the numbers above. Cards appear here when they publish again from AI Insights 0.4 or newer.`}
          </p>
        </div>
      )}
    </section>
  )
}

/** The person's computers, publicly: a label (the name only if they chose to show it) and each one's own numbers. */
export function DevicesStrip({ devices }: { devices: Array<{ label: string; stats: SharedStats; updatedAt: string; duplicate: boolean }> }) {
  if (devices.length <= 1) return null
  return (
    <section aria-labelledby="devices" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="devices" className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">devices · {devices.length}</h2>
        <span className="font-mono text-[10.5px] text-muted-foreground">the numbers above add these up</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {devices.map((d, i) => (
          <li key={`${d.label}-${i}`} className={cn("flex flex-col gap-2 rounded-2xl border bg-card px-4 py-3.5", d.duplicate && "border-dashed opacity-70")}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: AGENT_COLORS[i % AGENT_COLORS.length] }} />
                <span className="truncate font-semibold">{d.label}</span>
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">{formatPeriod(d.stats.from, d.stats.to)}</span>
            </div>
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] tabular-nums">
              <span><b className="font-semibold">{formatInt(d.stats.sessions)}</b> <span className="text-muted-foreground">sessions</span></span>
              <span><b className="font-semibold">{tokensText(d.stats)}</b> <span className="text-muted-foreground">tokens</span></span>
              <span><b className="font-semibold">{formatInt(d.stats.activeDays)}</b> <span className="text-muted-foreground">active days</span></span>
            </p>
            {d.duplicate && <p className="text-[12px] text-muted-foreground">Same history as another device, counted once.</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Titles earned from the work ratios: fixed wording, each with the rule and number that earned it. */
export function EarnedTitles({ stats }: { stats: SharedStats }) {
  const titles = stats.titles ?? []
  if (!titles.length) return null
  return (
    <section aria-labelledby="titles" className="flex flex-col gap-3">
      <h2 id="titles" className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">earned titles</h2>
      <ul className={cn("grid gap-3", titles.length > 1 && "sm:grid-cols-2", titles.length > 2 && "lg:grid-cols-3")}>
        {titles.map((t) => {
          const def = EARNED_TITLES[t.k]
          return (
            <li key={t.k} className="on-dark relative flex flex-col gap-1.5 overflow-hidden rounded-2xl bg-[#3d1bb3] px-5 py-4 text-[#f7f3ea]">
              <div aria-hidden className="pointer-events-none absolute -top-8 -right-8 size-24 rounded-full bg-[#c9b8ff]/25" />
              <p className="relative text-[1.25rem] leading-tight font-semibold tracking-[-0.03em]">{def.title}</p>
              <p className="relative text-[12.5px] leading-snug text-[#f7f3ea]/75">{def.rule(t.v)}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The five work ratios: habits, not volume. Labels and formats are fixed; only the values were published. */
export function WorkRatios({ stats, id = "ratios" }: { stats: SharedStats; id?: string }) {
  const ratios = stats.ratios ?? []
  if (!ratios.length) return null
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">how they work</h2>
        <span className="font-mono text-[10.5px] text-muted-foreground">ratios of counts, not volume</span>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-5">
        {ratios.map((r, i) => (
          <div key={r.k} className={cn("flex flex-col gap-1 bg-card px-4 py-3.5", ratios.length % 2 === 1 && i === ratios.length - 1 && "max-sm:col-span-2")}>
            <dt className="order-2 text-[12px] leading-snug text-muted-foreground">{RATIOS[r.k].label}</dt>
            <dd className="order-1 text-[1.35rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">{ratioText(r.k, r.v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
