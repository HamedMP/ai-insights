import { AGENT_COLORS, Avatar, lastSpan, RecapCard, WIDE } from "@/components/site/profile"
import { agentName, EARNED_TITLES, formatInt, formatPeriod, RATIOS, ratioText, tokensText, type SharedStats } from "@/lib/share"
import { cn } from "@/lib/utils"

/**
 * What the profile will look like, drawn from the validated payload only, with the same pieces and colours as /u/[handle]
 * (profile.tsx). It is a picture of the publish; the exact list of published lines is the disclosure under it.
 */
export function PublishPreview({ stats, name, handle, avatarUrl }: { stats: SharedStats; name: string; handle: string | null; avatarUrl: string | null }) {
  const totals: Array<[string, string]> = [
    ["sessions", formatInt(stats.sessions)],
    ["tokens", tokensText(stats)],
    ...(stats.usd !== null ? [["est. spend", `$${formatInt(stats.usd)}`] as [string, string]] : []),
    ["active days", formatInt(stats.activeDays)],
    ["longest streak", `${formatInt(stats.streak)} ${stats.streak === 1 ? "day" : "days"}`],
  ]
  const cards = stats.cards ?? []
  const titles = stats.titles ?? []
  return (
    <div className="flex flex-col gap-4" data-testid="publish-preview">
      <div className="flex items-center gap-3">
        <Avatar url={avatarUrl} name={name} handle={handle ?? name} className="size-11 rounded-xl text-[1.05rem]" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[1.05rem] leading-tight font-semibold tracking-[-0.02em]">{name}</span>
          <span className="flex flex-wrap gap-x-2 font-mono text-[11.5px] text-muted-foreground">
            <span className="break-all">@{handle ?? "…"}</span>
            <span>{formatPeriod(stats.from, stats.to)}</span>
          </span>
        </div>
        <span className="ml-auto inline-flex h-6 shrink-0 self-start items-center rounded-full border border-dashed px-2.5 font-mono text-[10.5px] text-muted-foreground">self-reported</span>
      </div>

      <dl className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border", totals.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4")} aria-label="Totals">
        {totals.map(([label, value], i) => (
          <div key={label} className={cn("flex flex-col gap-0.5 bg-card px-3 py-2.5", totals.length % 2 === 1 && i === totals.length - 1 && "max-sm:col-span-2")}>
            <dt className="order-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="order-1 text-[1.2rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {stats.agents.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            {stats.agents.map((a, i) => (
              <span key={`${a.k}-${i}`} style={{ width: `${a.p}%`, background: AGENT_COLORS[i % AGENT_COLORS.length] }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px]" aria-label="Agents, by share of sessions">
            {stats.agents.map((a, i) => (
              <li key={`${a.k}-${i}`} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full ring-1 ring-black/10" style={{ background: AGENT_COLORS[i % AGENT_COLORS.length] }} />
                {agentName(a.k)} <span className="font-mono text-muted-foreground">{a.p}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(titles.length > 0 || stats.fact) && (
        <div className="flex flex-wrap gap-2">
          {titles.map((t) => (
            <span key={t.k} className="inline-flex h-7 items-center rounded-full bg-[#3d1bb3] px-3 text-[12.5px] font-semibold text-[#f7f3ea]">{EARNED_TITLES[t.k].title}</span>
          ))}
          {stats.fact && <span className="inline-flex min-h-7 items-center rounded-2xl bg-[#141210] px-3 py-1 text-[12.5px] leading-snug font-medium text-[#f7f3ea] break-words">{stats.fact}</span>}
        </div>
      )}

      {stats.ratios && stats.ratios.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]" aria-label="How they work">
          {stats.ratios.map((r) => (
            <div key={r.k} className="inline-flex gap-1.5">
              <dt className="text-muted-foreground">{RATIOS[r.k].label}</dt>
              <dd className="font-semibold tabular-nums">{ratioText(r.k, r.v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {cards.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={`${cards.length} recap cards`}>
          {cards.map((card, i) => (
            <RecapCard key={card.k} card={card} small span={i === cards.length - 1 && !WIDE.has(card.k) ? lastSpan(cards) : undefined} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-3 py-2.5 text-[12.5px] text-muted-foreground">
          {stats.cards ? "No recap cards in this link." : "This link is from an older report, so your profile will show these numbers without recap cards. Run the command again for a link with cards."}
        </p>
      )}
    </div>
  )
}
