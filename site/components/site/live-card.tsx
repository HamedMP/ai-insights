"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons"

import { Segmented } from "@/components/site/segmented"
import media from "@/lib/media.json"
import { asset } from "@/lib/site"
import { cn } from "@/lib/utils"

export const RATIOS = [
  { value: "1:1", w: 1, h: 1, name: "Square" },
  { value: "9:16", w: 9, h: 16, name: "Story" },
  { value: "4:5", w: 4, h: 5, name: "Portrait" },
  { value: "16:9", w: 16, h: 9, name: "Wide" },
] as const
export type Ratio = (typeof RATIOS)[number]["value"]
type StyleId = (typeof media.styles)[number]["id"]

interface EmbedState {
  ready: boolean
  index: number
  count: number
  card: string
  title: string
  playing: boolean
}

function RatioIcon({ w, h }: { w: number; h: number }) {
  const scale = 12 / Math.max(w, h)
  return <i aria-hidden className="inline-block rounded-[2px] border-[1.5px] border-current" style={{ width: Math.round(w * scale) + "px", height: Math.round(h * scale) + "px" }} />
}

/**
 * A live card from the sample recap: public/demo/cards.html runs the report's own card engine in a frame and
 * plays the cards; the switches here restyle and reshape the card in place. Until the frame is ready (it is
 * fetched once the page has loaded), a still of the first card stands in.
 */
export function LiveCard({ cards = media.defaults, initialStyle = "pop", className, boxClassName }: { cards?: string[]; initialStyle?: StyleId; className?: string; boxClassName?: string }) {
  const frame = React.useRef<HTMLIFrameElement>(null)
  const wrap = React.useRef<HTMLDivElement>(null)
  const [style, setStyle] = React.useState<StyleId>(initialStyle)
  const [ratio, setRatio] = React.useState<Ratio>("1:1")
  const [load, setLoad] = React.useState(false)
  const [embed, setEmbed] = React.useState<EmbedState>({ ready: false, index: 0, count: cards.length, card: cards[0]!, title: "", playing: true })
  const [reduced, setReduced] = React.useState(false)
  const [src] = React.useState(() => asset(`demo/cards.html?style=${initialStyle}&ratio=1:1&cards=${cards.join(",")}`))

  const send = React.useCallback((set: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ aii: 1, set }, window.location.origin)
  }, [])

  // Fetch the engine only after the page itself has loaded, so the first screen never waits on it.
  React.useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    const go = () => {
      const idle = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback
      if (idle) idle(() => setLoad(true), { timeout: 1200 })
      else window.setTimeout(() => setLoad(true), 300)
    }
    if (document.readyState === "complete") go()
    else window.addEventListener("load", go, { once: true })
    return () => window.removeEventListener("load", go)
  }, [])

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return
      const data = event.data as Partial<EmbedState> & { aii?: number }
      if (data?.aii !== 1) return
      setEmbed((prev) => ({ ...prev, ...data, ready: true }))
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  // Pause the frame while it is off screen.
  React.useEffect(() => {
    const element = wrap.current
    if (!element || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(([entry]) => send({ visible: !!entry?.isIntersecting }), { threshold: 0.05 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [send, embed.ready])

  const pick = (next: StyleId) => {
    setStyle(next)
    setLoad(true)
    send({ style: next })
  }
  const shape = (next: Ratio) => {
    setRatio(next)
    setLoad(true)
    send({ ratio: next })
  }
  const go = (step: number) => send({ index: embed.index + step })
  const r = RATIOS.find((item) => item.value === ratio)!
  const poster = asset(`media/card-${initialStyle}-${cards[0]}.webp`)
  const showPoster = !embed.ready
  const titles = media.titles[style as keyof typeof media.titles] as Record<string, string> | undefined
  const title = embed.ready ? embed.title || titles?.[embed.card] || "" : titles?.[cards[0]!] || ""

  return (
    <div ref={wrap} className={cn("flex flex-col items-center gap-4", className)}>
      <div className={cn("flex w-full items-center justify-center [--box-h:min(88vw,440px)] sm:[--box-h:500px] lg:[--box-h:540px]", boxClassName)} style={{ height: "var(--box-h)" }}>
        <div
          className="on-dark relative overflow-hidden rounded-[18px] bg-[#141210] shadow-[0_2px_4px_rgb(0_0_0/0.08),0_40px_80px_-36px_rgb(60_30_10/0.55)] ring-1 ring-black/5 transition-[width] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none dark:shadow-[0_40px_90px_-30px_rgb(0_0_0/0.9)] dark:ring-white/10"
          style={{ aspectRatio: `${r.w} / ${r.h}`, width: `min(100%, calc(var(--box-h) * ${r.w / r.h}))` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={poster} alt="" width={560} height={560} fetchPriority="high" className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", (!showPoster || ratio !== "1:1" || style !== initialStyle) && "opacity-0")} />
          {load && (
            <iframe
              ref={frame}
              src={src}
              title="A live card from the sample recap"
              tabIndex={-1}
              aria-hidden
              className={cn("absolute inset-0 size-full border-0 transition-opacity duration-500", embed.ready ? "opacity-100" : "opacity-0")}
            />
          )}
          {!embed.ready && (ratio !== "1:1" || style !== initialStyle) && (
            <span className="absolute inset-0 grid place-items-center font-mono text-xs text-white/70">loading the card engine…</span>
          )}
        </div>
      </div>

      <p className="flex min-h-5 items-center gap-2 font-mono text-[11.5px] text-muted-foreground" aria-hidden={!embed.ready}>
        <span className="text-primary tabular-nums">{String(embed.index + 1).padStart(2, "0")} / {String(embed.count).padStart(2, "0")}</span>
        <span className="truncate">{title}</span>
      </p>

      <div className="flex w-full flex-col items-center gap-2.5">
        <Segmented
          label="Card style"
          value={style}
          onChange={pick}
          className="max-w-full overflow-x-auto"
          options={media.styles.map((item) => ({
            value: item.id as StyleId,
            label: (
              <>
                <span aria-hidden className="size-3 rounded-full ring-1 ring-black/10" style={{ background: item.swatch }} />
                {item.name}
              </>
            ),
          }))}
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Segmented
            label="Card shape"
            value={ratio}
            onChange={shape}
            options={RATIOS.map((item) => ({ value: item.value, name: `${item.name} ${item.value}`, label: (<><RatioIcon w={item.w} h={item.h} /><span className="font-mono text-[12px]">{item.value}</span></>) }))}
            itemClassName="px-2.5"
          />
          <div className="inline-flex items-center gap-0.5 rounded-full border bg-secondary/60 p-0.5">
            <IconButton label="Previous card" onClick={() => go(-1)} icon={ArrowLeft01Icon} />
            <IconButton label={embed.playing && !reduced ? "Pause" : "Play"} onClick={() => send({ playing: !(embed.playing && embed.ready) })} icon={embed.playing && embed.ready ? PauseIcon : PlayIcon} />
            <IconButton label="Next card" onClick={() => go(1)} icon={ArrowRight01Icon} />
          </div>
        </div>
      </div>
    </div>
  )
}

function IconButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: typeof PlayIcon }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:size-9">
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
    </button>
  )
}
