"use client"

import { CommandBlock, CopyButton } from "@/components/site/copy-button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { REPO } from "@/lib/site"

const OTHERS = [
  { name: "Cursor", where: "from a clone of the repository", line: "scripts/install.sh --harness cursor" },
  { name: "Pi", where: "in a terminal", line: "pi install git:github.com/hamedmp/hindsight" },
  { name: "OpenCode", where: "from a clone of the repository", line: "scripts/install.sh --harness opencode" },
]

/** Install commands per harness, copied straight from the README. */
export function Install() {
  return (
    <div className="flex flex-col gap-5">
      <div className="beam rounded-2xl border bg-card p-2 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_20px_50px_-24px_rgb(0_0_0/0.25)]">
        <Tabs defaultValue="claude" className="gap-0">
          <div className="flex items-center justify-between gap-3 px-2 pt-1 pb-3">
            <TabsList className="h-9 rounded-full p-1">
              <TabsTrigger value="claude" className="rounded-full px-3">Claude Code</TabsTrigger>
              <TabsTrigger value="codex" className="rounded-full px-3">Codex</TabsTrigger>
              <TabsTrigger value="others" className="rounded-full px-3">Others</TabsTrigger>
            </TabsList>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">Node.js 20+</span>
          </div>
          <TabsContent value="claude" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <CommandBlock where="in a Claude Code session" lines={["/plugin marketplace add hamedmp/hindsight", "/plugin install hindsight@hindsight"]} />
          </TabsContent>
          <TabsContent value="codex" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <CommandBlock where="in a terminal" lines={["codex plugin marketplace add hamedmp/hindsight", "codex plugin add hindsight@hindsight"]} />
          </TabsContent>
          <TabsContent value="others" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <div className="flex flex-col gap-2 rounded-xl border bg-background/60 p-4">
              <p className="text-sm text-muted-foreground">
                These run the skills, but Hindsight does not read their own history yet, and the installs are untested.
              </p>
              <ul className="flex flex-col divide-y">
                {OTHERS.map((other) => (
                  <li key={other.name} className="flex flex-col gap-1.5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{other.name}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">untested</Badge>
                      <span className="mono-comment truncate text-[11px]">{other.where}</span>
                      <CopyButton text={other.line} className="ml-auto" />
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

      <div className="grid grid-cols-1 gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card/60 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="mono-comment text-xs">then, in a new session</span>
            <span className="truncate font-medium">run hindsight</span>
          </div>
          <CopyButton text="run hindsight" />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card/60 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="mono-comment text-xs">no agent? numbers only</span>
            <code className="truncate font-mono text-[13px]">npx @matrix-os/hindsight</code>
          </div>
          <CopyButton text="npx @matrix-os/hindsight" />
        </div>
      </div>
    </div>
  )
}
