"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SAMPLE, asset } from "@/lib/site"

const SHOTS = [
  {
    id: "overview",
    tab: "Overview",
    title: "The headline, in your numbers",
    body: "How many sessions ran at once, hours with AI at work, lines changed and what it would cost at API list prices, over a calendar of active days.",
    width: 1200,
    height: 760,
  },
  {
    id: "timeline",
    tab: "Side by side",
    title: "Your busiest day, session by session",
    body: "One bar per session, coloured by tool, with the sessions another agent was driving drawn dashed. Wall-clock hours stay apart from agent-hours.",
    width: 1200,
    height: 1074,
  },
  {
    id: "cost",
    tab: "Cost",
    title: "Where the tokens went",
    body: "Cache reads, fresh input, cache writes and output, with an estimate at API list prices and the share it could not price.",
    width: 1200,
    height: 760,
  },
  {
    id: "improve",
    tab: "What to fix",
    title: "Ranked changes, with text to paste",
    body: "Each finding carries evidence from your sessions and a concrete change: a line for CLAUDE.md or AGENTS.md, an allow rule, a habit.",
    width: 1200,
    height: 1100,
  },
] as const

/** Screens from the sample report, shown in the page's own theme: the small-screen stand-in for the live frame. */
export function ReportShots() {
  return (
    <Tabs defaultValue="overview" className="gap-5">
      <TabsList variant="line" className="h-auto w-full justify-start gap-1 overflow-x-auto border-b pb-1">
        {SHOTS.map((shot) => (
          <TabsTrigger key={shot.id} value={shot.id} className="h-10 flex-none px-3 text-[13px] after:bg-primary data-active:text-foreground sm:text-sm">
            {shot.tab}
          </TabsTrigger>
        ))}
      </TabsList>
      {SHOTS.map((shot) => (
        <TabsContent key={shot.id} value={shot.id} className="flex flex-col gap-4 animate-in fade-in-0 duration-300 motion-reduce:animate-none">
          <a href={SAMPLE} className="shot-frame block overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05),0_24px_60px_-28px_rgb(0_0_0/0.35)] outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset(`assets/shot-${shot.id}-light.png`)} width={shot.width} height={shot.height} loading="lazy" alt={`${shot.title}: a screen from the sample report.`} className="block h-auto w-full dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset(`assets/shot-${shot.id}-dark.png`)} width={shot.width} height={shot.height} loading="lazy" alt={`${shot.title}: a screen from the sample report.`} className="hidden h-auto w-full dark:block" />
          </a>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-lg font-semibold tracking-tight">{shot.title}</h3>
            <p className="text-[15px] leading-relaxed text-muted-foreground">{shot.body}</p>
          </div>
        </TabsContent>
      ))}
      <a href={SAMPLE} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border bg-card text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        Open the full sample report
        <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-4" />
      </a>
    </Tabs>
  )
}
