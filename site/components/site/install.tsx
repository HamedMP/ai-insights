"use client"

import * as React from "react"

import { CommandBlock, CopyButton } from "@/components/site/copy-button"
import { Segmented } from "@/components/site/segmented"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { COMMAND, REPO, SKILL } from "@/lib/site"
import { cn } from "@/lib/utils"

/** Copied straight from the README; the site tests hold them to it. */
const HARNESSES = {
  claude: { name: "Claude Code", where: "in a Claude Code session", lines: ["/plugin marketplace add hamedmp/ai-insights", "/plugin install ai-insights@ai-insights"] },
  codex: { name: "Codex", where: "in a terminal", lines: ["codex plugin marketplace add hamedmp/ai-insights", "codex plugin add ai-insights@ai-insights"] },
} as const
type Harness = keyof typeof HARNESSES

const OTHERS = [
  { name: "Cursor", where: "from a clone of the repository", line: "scripts/install.sh --harness cursor" },
  { name: "Pi", where: "in a terminal", line: "pi install git:github.com/hamedmp/ai-insights" },
  { name: "OpenCode", where: "from a clone of the repository", line: "scripts/install.sh --harness opencode" },
]

/** The first-screen call to action: the one command, with the agent route one click away. */
export function GetIt({ className }: { className?: string }) {
  const [harness, setHarness] = React.useState<Harness>("claude")
  const current = HARNESSES[harness]
  return (
    <Tabs defaultValue="cli" className={cn("gap-0", className)}>
      <TabsList className="mb-2 h-9! rounded-full p-0.5">
        <TabsTrigger value="cli" className="rounded-full px-3 text-[13px]">Terminal</TabsTrigger>
        <TabsTrigger value="agent" className="rounded-full px-3 text-[13px]">In your agent</TabsTrigger>
      </TabsList>
      <TabsContent value="cli" className="animate-in fade-in-0 duration-300 motion-reduce:animate-none">
        <div data-hero-command="" className="flex items-center gap-3 rounded-2xl border border-foreground/90 bg-foreground py-2 pr-2 pl-4 text-background shadow-[0_14px_34px_-16px_rgb(0_0_0/0.55)] dark:border-white/15 dark:bg-[#1b1b1f] dark:text-foreground">
          <code className="min-w-0 flex-1 truncate font-mono text-[17px] font-medium sm:text-lg">
            <span aria-hidden className="mr-2.5 select-none text-[#ff7a2f]">$</span>
            {COMMAND}
          </code>
          <CopyButton text={COMMAND} trackAs="hero" ariaLabel={`Copy: ${COMMAND}`} className="h-10 border-white/15 bg-white/10 px-3 text-[12px] text-white/80 hover:border-white/30 hover:text-white dark:bg-white/5" />
        </div>
        <p className="mt-2.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
          Node.js 20+ · writes one HTML page · add <span className="text-foreground">--open</span> to open it
        </p>
      </TabsContent>
      <TabsContent value="agent" className="animate-in fade-in-0 duration-300 motion-reduce:animate-none">
        <div className="overflow-hidden rounded-2xl border bg-card/90 shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:bg-card/70">
          <div className="flex items-center justify-between gap-2 border-b p-1.5">
            <Segmented label="Your agent" value={harness} onChange={setHarness} className="border-0 bg-transparent" options={(Object.keys(HARNESSES) as Harness[]).map((key) => ({ value: key, label: HARNESSES[key].name }))} />
            <a href="#install" className="px-2 text-[12.5px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline">
              others
            </a>
          </div>
          <pre key={harness} className="overflow-x-auto px-3.5 py-3 font-mono text-[12px] leading-6 sm:text-[13px]">
            <div className="mono-comment text-[11.5px]">1. {current.where}</div>
            {current.lines.map((line) => (
              <div key={line} className="whitespace-pre">
                <span aria-hidden className="mr-2 select-none text-primary">›</span>
                {line}
              </div>
            ))}
            <div className="mono-comment mt-1 text-[11.5px]">2. then, in a new session</div>
            <div className="whitespace-pre">
              <span aria-hidden className="mr-2 select-none text-primary">›</span>
              {SKILL}
            </div>
          </pre>
          <div className="flex justify-end border-t px-2 py-1.5">
            <CopyButton text={current.lines.join("\n")} label="Copy install" ariaLabel={`Copy the ${current.name} install commands`} />
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}

/** Every way in, copied straight from the README. */
export function Install() {
  return (
    <div className="beam rounded-2xl border bg-card p-2 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_20px_50px_-24px_rgb(0_0_0/0.25)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_20px_50px_-24px_rgb(0_0_0/0.8)]">
      <Tabs defaultValue="cli" className="gap-0">
        <div className="flex items-center justify-between gap-3 overflow-x-auto px-1 pt-1 pb-3 sm:px-2">
          <TabsList className="h-10! shrink-0 rounded-full p-1">
            <TabsTrigger value="cli" className="rounded-full px-3">Terminal</TabsTrigger>
            <TabsTrigger value="claude" className="rounded-full px-3">Claude Code</TabsTrigger>
            <TabsTrigger value="codex" className="rounded-full px-3">Codex</TabsTrigger>
            <TabsTrigger value="others" className="rounded-full px-3">Others</TabsTrigger>
          </TabsList>
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">Node.js 20+</span>
        </div>
        <TabsContent value="cli" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
          <CommandBlock where="any terminal: the cards and the analysis, no agent needed" lines={[COMMAND, "npx ai-insights doctor"]} />
          <p className="px-2 pt-3 text-sm text-muted-foreground">
            The first writes the report; <code className="font-mono text-foreground">doctor</code> shows which history it found and where.
          </p>
        </TabsContent>
        {(Object.keys(HARNESSES) as Harness[]).map((key) => (
          <TabsContent key={key} value={key} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <CommandBlock where={HARNESSES[key].where} lines={[...HARNESSES[key].lines]} />
            <p className="px-2 pt-3 text-sm text-muted-foreground">
              Then, in a new session, run <code className="font-mono text-foreground">{SKILL}</code> or ask it to analyze your AI usage.
            </p>
          </TabsContent>
        ))}
        <TabsContent value="others" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
          <div className="flex flex-col gap-2 rounded-xl border bg-background/60 p-4">
            <p className="text-sm text-muted-foreground">AI Insights reads these agents&apos; history either way. These installs add the skill inside them, and are untested.</p>
            <ul className="flex flex-col divide-y">
              {OTHERS.map((other) => (
                <li key={other.name} className="flex flex-col gap-1.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{other.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">untested</Badge>
                    <span className="mono-comment truncate text-[11px] max-sm:hidden">{other.where}</span>
                    <CopyButton text={other.line} className="ml-auto" ariaLabel={`Copy the ${other.name} install command`} />
                  </div>
                  <code className="overflow-x-auto font-mono text-[12px] whitespace-nowrap sm:text-[13px]">
                    <span aria-hidden className="mr-2 select-none text-primary">›</span>
                    {other.line}
                  </code>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Several at once: clone the repository and run <code className="font-mono text-foreground">scripts/install.sh</code> (add <code className="font-mono text-foreground">--dry-run</code> to see what it would do). Details in the{" "}
              <a className="link-underline text-foreground" href={`${REPO}#install`}>README</a>.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
