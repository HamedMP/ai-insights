import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { MATRIX, REPO } from "@/lib/site"

const QUESTIONS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Does anything leave my machine?",
    a: "No. Hindsight makes no network calls and has no telemetry or account. The report is one HTML file on your disk and loads nothing from the network. It links to Matrix OS and to the docs for tools it suggests; nothing else points off your machine.",
  },
  {
    q: "Which agents does it read?",
    a: "Claude Code (~/.claude/projects) and Codex (~/.codex/sessions and archived sessions). Cursor, Pi and OpenCode can run the skills, but their own history is not read yet, and those installs are untested.",
  },
  {
    q: "Does Hindsight call a model?",
    a: "No. The numbers and findings are computed without a model. The judgement part, labelling sessions and writing the narrative, runs in the agent you already use, under your existing account and settings.",
  },
  {
    q: "What does it keep from my transcripts?",
    a: "Numbers (tokens, durations, tool calls, errors, lines changed) and the prompts you typed, with secrets redacted. It does not store the agent's replies or tool output. Everything goes to ~/.hindsight/, readable only by you; set HINDSIGHT_HOME to move it.",
  },
  {
    q: "How are secrets handled?",
    a: "API keys, bearer tokens, private keys, PASSWORD= style assignments and email addresses are redacted from prompts, commands and excerpts before anything is stored or shown, and home-folder paths are shortened to ~. Redaction is pattern-based, so it can miss an unusual secret; the skills tell your agent never to copy one into its notes.",
  },
  {
    q: "How far back can it look?",
    a: (
      <>
        As far as your agents keep their transcripts. Claude Code deletes them after 30 days by default. <a href={MATRIX}>Matrix OS</a> keeps agent history long-term if you want to look back further.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Hindsight is free and MIT licensed. The review step uses your own agent, so it counts towards your normal usage. Source on <a href={REPO}>GitHub</a>.
      </>
    ),
  },
]

export function Faq() {
  return (
    <Accordion className="rounded-2xl border bg-card/60 px-5">
      {QUESTIONS.map((item) => (
        <AccordionItem key={item.q} value={item.q}>
          <AccordionTrigger className="py-4 text-base hover:no-underline [&:hover>span]:text-primary">
            <span className="transition-colors">{item.q}</span>
          </AccordionTrigger>
          <AccordionContent>
            <p className="max-w-[65ch] pb-2 text-[15px] leading-relaxed text-muted-foreground">{item.a}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
