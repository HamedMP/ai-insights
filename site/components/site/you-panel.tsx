import { PhotoSwitch } from "@/components/site/photo-switch"
import { Avatar } from "@/components/site/profile"
import { ShareButtons } from "@/components/site/share-buttons"
import { rankPost, standings } from "@/lib/arena-format"
import type { PublicEntry, Ranks } from "@/lib/db"
import { boardHref } from "@/lib/leaderboard"
import { referralLink } from "@/lib/referral"
import { BASE, SITE_URL } from "@/lib/site"

const link = "inline-flex h-8 items-center rounded-md px-2.5 font-mono text-[11.5px] text-ink-soft outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * The signed-in person's slim strip above the table: their rank in each arena as chips, one share for their best
 * standing (the link carries ?ref=<handle>), links to their profile and devices, and the photo switch. Removing the
 * entry lives in the profile's owner area.
 */
export function YouPanel({ entry, ranks, jump }: { entry: PublicEntry; ranks: Ranks; jump: string | null }) {
  const list = standings(ranks)
  const best = list[0] ?? null
  const url = referralLink(SITE_URL, entry.handle)
  return (
    <section aria-labelledby="you" className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 lg:flex-row lg:items-center lg:gap-5">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar url={entry.avatarUrl} name={entry.displayName} handle={entry.handle} className="size-9 rounded-[10px] text-[13px]" />
        <h2 id="you" className="flex min-w-0 flex-col leading-tight">
          <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">You</span>
          <a href={`${BASE}/u/${entry.handle}`} className="truncate font-medium underline-offset-4 hover:underline">{entry.displayName}</a>
        </h2>
      </div>

      <ul aria-label="Your ranks" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {list.length === 0 && <li className="font-mono text-[11.5px] text-muted-foreground">Not ranked yet</li>}
        {list.map((s, i) => (
          // Phones show the best three; the rest are one sort away.
          <li key={s.arena} className={i >= 3 ? "max-sm:hidden" : undefined}>
            <a
              href={boardHref(BASE, s.arena)}
              className="inline-flex h-7 items-center rounded-md border bg-background px-2 font-mono text-[11.5px] whitespace-nowrap tabular-nums outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50 data-[best=true]:border-primary/50 data-[best=true]:bg-primary/[0.07] data-[best=true]:text-primary"
              data-best={s === best}
            >
              {s.chip}
            </a>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {best && (
          <details className="group relative">
            <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md bg-foreground px-3 font-mono text-[11.5px] text-background outline-none hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              Share {best.chip}
              <span aria-hidden className="transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div className="absolute top-10 left-0 z-20 flex w-max max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg lg:right-0 lg:left-auto">
              <p className="max-w-72 text-[12.5px] text-muted-foreground">&ldquo;{best.label} on the AI Insights leaderboard&rdquo;, with a link to your profile.</p>
              <ShareButtons post={rankPost(best.label, url)} url={url} />
            </div>
          </details>
        )}
        <a className={link} href={`${BASE}/u/${entry.handle}`}>Profile</a>
        <a className={link} href={`${BASE}/u/${entry.handle}#my-devices`}>Devices</a>
        {jump && <a className={`${link} lg:hidden`} href={`${jump}#m-${entry.handle}`}>Jump to me</a>}
        <PhotoSwitch initial={entry.avatarUrl !== null} className="ml-1.5 border-l pl-3" />
      </div>
    </section>
  )
}
