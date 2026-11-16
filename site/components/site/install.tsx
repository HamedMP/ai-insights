"use client"

import * as React from "react"

import { CommandBlock, CopyButton } from "@/components/site/copy-button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { REPO } from "@/lib/site"
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

/** The first-screen install: pick Claude Code or Codex, copy two lines. */
export function HeroInstall({ className }: { className?: string }) {
  const [harness, setHarness] = React.useState<Harness>("claude")
  const current = HARNESSES[harness]
  return (
    <div data-hero-install="" className={cn("overflow-hidden rounded-xl border bg-card/80 shadow-[0_1px_2px_rgb(0_0_0/0.04)] backdrop-blur-sm dark:bg-card/70 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]", className)}>
      <div className="flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-1.5">
        <div role="radiogroup" aria-label="Your agent" className="flex items-center gap-0.5">
          {(Object.keys(HARNESSES) as Harness[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={harness === key}
              onClick={() => setHarness(key)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
                event.preventDefault()
                const next: Harness = key === "claude" ? "codex" : "claude"
                setHarness(next)
                ;(event.currentTarget.parentElement?.querySelector(`[data-key="${next}"]`) as HTMLElement | null)?.focus()
              }}
              tabIndex={harness === key ? 0 : -1}
              data-key={key}
              className={cn(
                "relative h-8 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:h-10",
                harness === key && "bg-secondary text-foreground",
              )}
            >
              {HARNESSES[key].name}
            </button>
          ))}
        </div>
        <CopyButton text={current.lines.join("\n")} ariaLabel={`Copy the ${current.name} install commands`} />
      </div>
      <pre key={harness} className="overflow-x-auto px-3 py-3 font-mono text-[11.5px] leading-6 sm:px-3.5 animate-in fade-in-0 duration-300 motion-reduce:animate-none sm:text-[13px]">
        <div className="mono-comment text-[11.5px] leading-6">{current.where}</div>
        {current.lines.map((line) => (
          <div key={line} className="whitespace-pre">
            <span aria-hidden className="mr-2 select-none text-primary sm:mr-2.5">›</span>
            {line}
          </div>
        ))}
      </pre>
    </div>
  )
}

/** Install commands per harness, copied straight from the README. */
export function Install() {
  return (
    <div className="flex flex-col gap-4">
      <div className="beam rounded-2xl border bg-card p-2 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_20px_50px_-24px_rgb(0_0_0/0.25)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_20px_50px_-24px_rgb(0_0_0/0.8)]">
        <Tabs defaultValue="claude" className="gap-0">
          <div className="flex items-center justify-between gap-3 px-2 pt-1 pb-3">
            <TabsList className="h-10! rounded-full p-1">
              <TabsTrigger value="claude" className="rounded-full px-3">Claude Code</TabsTrigger>
              <TabsTrigger value="codex" className="rounded-full px-3">Codex</TabsTrigger>
              <TabsTrigger value="others" className="rounded-full px-3">Others</TabsTrigger>
            </TabsList>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">Node.js 20+</span>
          </div>
          <TabsContent value="claude" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <CommandBlock where={HARNESSES.claude.where} lines={[...HARNESSES.claude.lines]} />
          </TabsContent>
          <TabsContent value="codex" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <CommandBlock where={HARNESSES.codex.where} lines={[...HARNESSES.codex.lines]} />
          </TabsContent>
          <TabsContent value="others" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <div className="flex flex-col gap-2 rounded-xl border bg-background/60 p-4">
              <p className="text-sm text-muted-foreground">
                These run the skills, but AI Insights does not read their own history yet, and the installs are untested.
              </p>
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
                Several at once: clone the repository and run <code className="font-mono text-foreground">scripts/install.sh</code> (add{" "}
                <code className="font-mono text-foreground">--dry-run</code> to see what it would do). Details in the{" "}
                <a className="link-underline text-foreground" href={`${REPO}#install`}>README</a>.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <li className="flex items-center justify-between gap-3 rounded-xl border bg-card/60 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="mono-comment text-xs">then, in a new session</span>
            <span className="truncate font-medium">analyze my AI usage</span>
          </div>
          <CopyButton text="analyze my AI usage" ariaLabel="Copy: analyze my AI usage" />
        </li>
        <li className="flex items-center justify-between gap-3 rounded-xl border bg-card/60 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="mono-comment text-xs">no agent? numbers only</span>
            <code className="truncate font-mono text-[13px]">npx ai-insights</code>
          </div>
          <CopyButton text="npx ai-insights" ariaLabel="Copy: npx ai-insights" />
        </li>
      </ol>
    </div>
  )
}
