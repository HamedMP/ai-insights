"use client"

import * as React from "react"
import { ActivityGrid } from "@/components/site/activity-grid"
import { CountUp } from "@/components/site/count-up"
import { Reveal } from "@/components/site/reveal"
import { useInView } from "@/hooks/use-in-view"
import demo from "@/lib/demo.json"
import { cn } from "@/lib/utils"

const LABELS = [
  ["goal", "feature"],
  ["outcome", "mostly achieved"],
  ["friction", "wrong approach"],
  ["went well", "good debugging"],
  ["driven by", "person"],
]

function Labels() {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className={cn("flex flex-wrap gap-1.5", inView ? "chip-run" : "chip-idle")}>
      {LABELS.map(([key, value], index) => (
        <span
          key={key}
          className="chip inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-1 font-mono text-[11px]"
          style={{ "--d": `${index * 110}ms` } as React.CSSProperties}
        >
          <span className="text-muted-foreground">{key}</span>
          <span className="text-foreground">{value}</span>
        </span>
      ))}
    </div>
  )
}

function Findings() {
  return (
    <ul className="flex flex-col divide-y text-sm">
      {demo.findings.map((finding) => (
        <li key={finding.title} className="flex items-baseline justify-between gap-3 py-2">
          <span className="min-w-0 truncate">{finding.title}</span>
          {finding.value !== null && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              <b className="font-medium text-foreground">
                <CountUp value={finding.value} duration={1100} />
              </b>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

const STEPS = [
  {
    title: "Scan",
    body: "Hindsight parses your Claude Code and Codex transcripts on your machine into numbers: sessions, tokens, tool calls, errors, lines changed. Findings come with evidence you can check. No model is involved, so the same history gives the same result.",
    note: `${demo.numbers.sessions} sessions over ${demo.daily.length} days, in the sample`,
    visual: <ActivityGrid />,
  },
  {
    title: "Your own agent reviews",
    body: "The hindsight skill has the agent you already use read short, redacted excerpts and label each session from a fixed set: goal, outcome, friction, what went well. It then writes a short narrative. Hindsight never calls a model API.",
    note: "labels are checked against the set before they are saved",
    visual: <Labels />,
  },
  {
    title: "One story report",
    body: "Both layers become one HTML file on your disk: how you work, what it cost, where time is lost and a ranked list of changes, each with text you can paste. It loads nothing from the network.",
    note: "the sample's top findings",
    visual: <Findings />,
  },
]

export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {STEPS.map((step, index) => (
        <li key={step.title}>
          <Reveal delay={index * 90} className="h-full">
            <div className="flex h-full flex-col gap-5 rounded-2xl border bg-card/70 p-6 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-input motion-reduce:hover:translate-y-0">
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-full bg-brand-soft font-mono text-xs font-semibold text-primary">{index + 1}</span>
                <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
              </div>
              <div className="min-h-[7.5rem]">{step.visual}</div>
              <p className="text-[15px] leading-relaxed text-muted-foreground">{step.body}</p>
              <p className="mono-comment mt-auto text-xs">{step.note}</p>
            </div>
          </Reveal>
        </li>
      ))}
    </ol>
  )
}
