"use client"

import * as React from "react"
import { ActivityGrid } from "@/components/site/activity-grid"
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

function History() {
  return (
    <ul className="flex flex-col gap-1.5 font-mono text-[11.5px]">
      {[
        ["~/.claude/projects/", "*.jsonl"],
        ["~/.codex/sessions/", "*.jsonl"],
      ].map(([dir, file]) => (
        <li key={dir} className="flex items-center gap-2 rounded-md border bg-background/70 px-2.5 py-1.5">
          <span className="size-1.5 shrink-0 rounded-[2px] bg-primary" aria-hidden />
          <span className="truncate text-foreground">{dir}</span>
          <span className="ml-auto text-muted-foreground">{file}</span>
        </li>
      ))}
      <li className="flex items-center gap-2 px-2.5 pt-1 text-muted-foreground">
        <span aria-hidden>↳</span>
        <span>
          writes only to <span className="text-foreground">~/.hindsight/</span>
        </span>
      </li>
    </ul>
  )
}

function Labels() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LABELS.map(([key, value], index) => (
        <span
          key={key}
          className="flow-chip inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-1 font-mono text-[11px]"
          style={{ "--d": `${1500 + index * 110}ms` } as React.CSSProperties}
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
    <ul className="flex flex-col divide-y rounded-lg border bg-background/70 px-3 text-[13px]">
      {demo.findings.map((finding, index) => (
        <li key={finding.title} className="flow-chip flex items-baseline justify-between gap-3 py-2" style={{ "--d": `${2300 + index * 120}ms` } as React.CSSProperties}>
          <span className="min-w-0 truncate">{finding.title}</span>
          {finding.value !== null && <b className="shrink-0 font-mono text-xs font-medium text-primary tabular-nums">{finding.value}</b>}
        </li>
      ))}
    </ul>
  )
}

const STEPS = [
  {
    title: "Your history",
    body: "Claude Code and Codex already keep a transcript of every session on your disk. Hindsight reads them where they are.",
    note: `${demo.numbers.sessions} sessions in the sample`,
    visual: <History />,
  },
  {
    title: "Scan",
    body: "Parsed into numbers: sessions, tokens, tool calls, errors, lines changed. Findings carry evidence. No model is involved, so the same history gives the same result.",
    note: `${demo.daily.length} days, ${demo.numbers.findings} findings`,
    visual: <ActivityGrid />,
  },
  {
    title: "Your agent reviews",
    body: "The skill has the agent you already use read short, redacted excerpts, label each session from a fixed set and write a narrative. Hindsight never calls a model API.",
    note: "labels are checked against the set",
    visual: <Labels />,
  },
  {
    title: "Your report",
    body: "One HTML file on your disk: the story, the numbers and a ranked list of changes with text to paste. It loads nothing from the network.",
    note: "the sample's top findings",
    visual: <Findings />,
  },
]

/** History → scan → your agent → report, drawn as one flow inside a boundary marked "your machine". */
export function HowItWorks() {
  const [ref, inView] = useInView<HTMLDivElement>("0px 0px -20% 0px")
  return (
    <div ref={ref} className={cn("relative rounded-[1.75rem] border border-dashed border-input p-5 pt-10 sm:p-8 sm:pt-12 lg:p-10 lg:pt-14", inView ? "flow-run" : "flow-idle")}>
      <span className="absolute -top-2.5 left-5 bg-background px-2 font-mono text-[11px] text-muted-foreground sm:left-8">
        <span className="text-primary">//</span> your machine
      </span>
      <span className="absolute -top-2.5 right-5 hidden bg-background px-2 font-mono text-[11px] text-muted-foreground sm:right-8 sm:block">
        nothing crosses this line <span className="text-primary">·</span> 0 network calls
      </span>

      <ol className="relative grid grid-cols-1 gap-10 lg:grid-cols-4 lg:gap-8">
        {/* the rail and the packet that runs along it: across on wide screens, down on narrow ones */}
        <span aria-hidden className="absolute top-[18px] right-[calc(12.5%-1rem)] left-[18px] hidden h-px bg-border lg:block">
          <span className="flow-packet-x absolute inset-0">
            <span className="absolute top-1/2 left-0 size-2 -translate-1/2 rounded-full bg-primary shadow-[0_0_0_4px_var(--brand-soft)]" />
          </span>
        </span>
        <span aria-hidden className="absolute top-[18px] bottom-8 left-[18px] w-px bg-border lg:hidden">
          <span className="flow-packet-y absolute inset-0">
            <span className="absolute top-0 left-1/2 size-2 -translate-1/2 rounded-full bg-primary shadow-[0_0_0_4px_var(--brand-soft)]" />
          </span>
        </span>

        {STEPS.map((step, index) => (
          <li key={step.title} className="relative flex flex-col gap-4 pl-14 lg:pl-0" style={{ "--d": `${index * 700}ms` } as React.CSSProperties}>
            <span className="absolute top-0 left-0 grid size-9 place-items-center rounded-full border bg-background font-mono text-xs font-semibold lg:relative">
              <span aria-hidden className="flow-node absolute inset-0 rounded-full bg-primary" />
              <span className="flow-num relative">{index + 1}</span>
            </span>
            <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
            <div className="flow-visual lg:h-[9.5rem]">{step.visual}</div>
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">{step.body}</p>
            <p className="mono-comment mt-auto text-[11px]">{step.note}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
