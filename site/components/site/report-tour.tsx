"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"

import { ReportShots } from "@/components/site/report-shots"
import { prefersReducedMotion, useInView } from "@/hooks/use-in-view"
import { SAMPLE } from "@/lib/site"
import { cn } from "@/lib/utils"

/** Sections of the sample report, by the ids it renders. */
const CHAPTERS = [
  { id: "overview", label: "Overview", line: "The headline, in your numbers: sessions, hours with AI at work, lines changed, cost." },
  { id: "rhythm", label: "Rhythm", line: "When you work: hour by hour, weekday by weekday, every active day." },
  { id: "delegation", label: "Delegation", line: "How much each message sets off, and where the tool calls go." },
  { id: "parallel", label: "Parallel", line: "Your busiest day, one bar per session, with agent-driven sessions dashed." },
  { id: "usage", label: "Cost", line: "Where the tokens went: cache reads, fresh input, writes, output, at API list prices." },
  { id: "story", label: "Agent's read", line: "What your own agent made of the sessions: areas of work, style, wins." },
  { id: "friction", label: "Friction", line: "Where time is lost: failed commands, compactions, blocked tool calls." },
  { id: "improve", label: "Improve", line: "Ranked changes, each with evidence and text to paste." },
] as const
type ChapterId = (typeof CHAPTERS)[number]["id"]

/**
 * The report follows prefers-color-scheme only. Its own stylesheet carries both palettes: the dark one on
 * :root, the light one in a prefers-color-scheme media block. To follow the site's theme instead, copy the
 * palette the site wants out of that stylesheet and pin it with one more :root rule. Nothing in the report
 * changes; if the stylesheet ever looks different, the frame keeps following the system.
 */
function pinTheme(doc: Document, theme: "light" | "dark") {
  const palettes: Partial<Record<"light" | "dark", string>> = {}
  const declarations = (style: CSSStyleDeclaration) =>
    Array.from(style)
      .filter((name) => name.startsWith("--"))
      .map((name) => `${name}:${style.getPropertyValue(name)}`)
      .join(";")
  try {
    for (const sheet of Array.from(doc.styleSheets)) {
      if (sheet.ownerNode instanceof Element && sheet.ownerNode.id === "site-theme") continue
      for (const rule of Array.from(sheet.cssRules)) {
        if ("selectorText" in rule && (rule as CSSStyleRule).selectorText === ":root" && !palettes.dark) palettes.dark = declarations((rule as CSSStyleRule).style)
        if ("conditionText" in rule && /prefers-color-scheme:\s*light/.test((rule as CSSMediaRule).conditionText)) {
          for (const inner of Array.from((rule as CSSMediaRule).cssRules)) {
            if ("selectorText" in inner && (inner as CSSStyleRule).selectorText === ":root") palettes.light = declarations((inner as CSSStyleRule).style)
          }
        }
      }
    }
  } catch (error) {
    console.warn("hindsight: could not read the sample report's palette", error)
    return
  }
  const palette = palettes[theme]
  if (!palette) return
  let style = doc.getElementById("site-theme")
  if (!style) {
    style = doc.createElement("style")
    style.id = "site-theme"
    doc.head.append(style)
  }
  style.textContent = `:root{${palette};color-scheme:${theme}}`
}

function LiveReport() {
  const { resolvedTheme } = useTheme()
  const [ref, near] = useInView<HTMLDivElement>("600px 0px 600px 0px")
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [active, setActive] = React.useState<ChapterId>("overview")
  const jumping = React.useRef<number | undefined>(undefined)
  const theme = resolvedTheme === "dark" ? "dark" : "light"

  React.useEffect(() => {
    const doc = frame.current?.contentDocument
    if (loaded && doc) pinTheme(doc, theme)
  }, [loaded, theme])

  // The tab follows the reader's scroll inside the frame.
  React.useEffect(() => {
    const win = frame.current?.contentWindow
    if (!loaded || !win) return
    const onScroll = () => {
      if (jumping.current) return
      const doc = win.document
      let current: ChapterId = "overview"
      for (const chapter of CHAPTERS) {
        const section = doc.getElementById(chapter.id)
        if (section && section.getBoundingClientRect().top <= win.innerHeight * 0.35) current = chapter.id
      }
      setActive(current)
    }
    win.addEventListener("scroll", onScroll, { passive: true })
    return () => win.removeEventListener("scroll", onScroll)
  }, [loaded])

  function jump(id: ChapterId) {
    setActive(id)
    const win = frame.current?.contentWindow
    const section = win?.document.getElementById(id)
    if (!win || !section) return
    const target = section.querySelector("header") ?? section
    // scrollIntoView would scroll this page too; scroll only the frame.
    const top = id === "overview" ? 0 : target.getBoundingClientRect().top + win.scrollY - 28
    win.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" })
    window.clearTimeout(jumping.current)
    jumping.current = window.setTimeout(() => (jumping.current = undefined), 900)
  }

  const chapter = CHAPTERS.find((entry) => entry.id === active)!
  return (
    <div ref={ref} className="flex flex-col gap-4">
      <div className="report-frame overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05),0_40px_100px_-40px_rgb(60_30_10/0.45)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_40px_120px_-40px_rgb(0_0_0/0.9)]">
        <div className="flex items-center gap-4 border-b bg-secondary/50 px-4 py-2.5">
          <div className="flex shrink-0 items-center gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-input" />
            <span className="size-2.5 rounded-full bg-input" />
            <span className="size-2.5 rounded-full bg-input" />
          </div>
          <div role="tablist" aria-label="Jump to a chapter of the sample report" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {CHAPTERS.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                data-chapter={entry.id}
                aria-selected={active === entry.id}
                aria-controls="sample-report-frame"
                tabIndex={active === entry.id ? 0 : -1}
                onClick={() => jump(entry.id)}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
                  if (!step) return
                  event.preventDefault()
                  const next = CHAPTERS[(index + step + CHAPTERS.length) % CHAPTERS.length]!
                  jump(next.id)
                  event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-chapter="${next.id}"]`)?.focus()
                }}
                className={cn(
                  "group/ch relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  active === entry.id && "bg-background text-foreground shadow-sm dark:bg-input/40",
                )}
              >
                <span className={cn("font-mono text-[10px] text-muted-foreground/70 transition-colors", active === entry.id && "text-primary")}>0{index + 1}</span>
                {entry.label}
              </button>
            ))}
          </div>
          <a
            href={SAMPLE}
            target="_blank"
            rel="noopener"
            className="group/open inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background/70 px-2.5 text-[13px] font-medium outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Open full screen
            <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-3.5 transition-transform group-hover/open:translate-x-0.5 group-hover/open:-translate-y-0.5" />
          </a>
        </div>
        <div className="relative h-[min(78vh,820px)] min-h-[560px] bg-background">
          {near && (
            <iframe
              ref={frame}
              id="sample-report-frame"
              src={SAMPLE}
              title="The sample report, live: scroll inside to read it"
              allow="clipboard-write"
              onLoad={() => setLoaded(true)}
              className={cn("absolute inset-0 size-full transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0")}
            />
          )}
          {!loaded && (
            <div aria-hidden className="absolute inset-0 grid place-items-center">
              <span className="mono-comment text-xs">loading the sample report</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-6 px-1">
        <p key={chapter.id} className="text-[15px] text-muted-foreground animate-in fade-in-0 duration-300 motion-reduce:animate-none">
          <span className="font-medium text-foreground">{chapter.label}.</span> {chapter.line}
        </p>
        <p className="mono-comment shrink-0 text-[11px]">the real report, on invented sessions · scroll inside</p>
      </div>
    </div>
  )
}

/** The sample report itself, live in a frame on wide screens; screenshots on small ones. */
export function ReportTour() {
  return (
    <>
      <div className="hidden lg:block">
        <LiveReport />
      </div>
      <div className="lg:hidden">
        <ReportShots />
      </div>
    </>
  )
}
