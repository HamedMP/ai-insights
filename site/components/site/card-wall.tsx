"use client"

import { useInView } from "@/hooks/use-in-view"
import media from "@/lib/media.json"
import { asset } from "@/lib/site"

/** Rows of real cards, one row per style, drifting past. Stills of each card's last frame, from the sample recap. */
export function CardWall() {
  // The stills load when the wall nears the screen, all at once, so cards drifting in are never blank.
  const [ref, near] = useInView<HTMLDivElement>("300px 0px 300px 0px")
  const rows = Object.entries(media.wall) as Array<[keyof typeof media.titles, string[]]>
  return (
    <div ref={ref} className="flex flex-col gap-4 md:gap-5">
      {rows.map(([style, cards], row) => {
        const name = media.styles.find((item) => item.id === style)?.name ?? style
        const titles = media.titles[style] as Record<string, string>
        return (
          <div key={style} className="marquee relative" data-dir={row % 2 ? "rev" : undefined} style={{ "--dur": `${70 + row * 12}s` } as React.CSSProperties}>
            <span className="absolute top-3 left-4 z-10 rounded-full border bg-background/90 px-2.5 py-1 font-mono text-[11px] shadow-sm backdrop-blur md:left-8">{name}</span>
            <ul className="marquee-track" aria-label={`${name} cards`}>
              {[0, 1].map((copy) =>
                cards.map((card) => (
                  <li key={`${copy}-${card}`} aria-hidden={copy === 1 || undefined} className="marquee-item">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={near ? asset(`media/card-${style}-${card}.webp`) : undefined}
                      alt={copy ? "" : `${name} style: ${titles[card] ?? card} card`}
                      width={560}
                      height={560}
                      decoding="async"
                      className="size-[168px] bg-card rounded-[14px] shadow-[0_1px_2px_rgb(0_0_0/0.08),0_18px_36px_-22px_rgb(40_20_0/0.5)] ring-1 ring-black/5 sm:size-[220px] md:size-[248px] dark:ring-white/10"
                    />
                  </li>
                )),
              )}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
