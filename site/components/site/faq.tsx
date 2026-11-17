import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { REPO } from "@/lib/site"

const QUESTIONS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Does anything leave my machine?",
    a: "No. AI Insights makes no network calls and has no telemetry or account. Your recap is one HTML file on your disk that loads nothing from the network. Sharing is up to you: the share buttons open X or LinkedIn in a new tab, or save a file for you to post.",
  },
  {
    q: "Does this website track me?",
    a: "This website, not the tool or the report, counts visits with first-party PostHog analytics sent through ai-insights.app itself: page views and a few clicks such as copying the install command or pressing Publish. It never sends the #part of a share link (where your name and numbers live), records no sessions, captures nothing you type, and sends nothing if your browser asks not to be tracked.",
  },
  {
    q: "What can a shared card show?",
    a: "Counts, times and percentages, words from a fixed list of everyday coding words, public program, model and agent names, and a persona from a fixed set of titles. Never your prompts, the agent's replies, file or project names, paths or session ids. The private analysis never goes on a card.",
  },
  {
    q: "How do I get on the leaderboard?",
    a: "Only by choice, on this website. Make a share link from your report, open it, sign in with a Matrix account and press Publish. You see exactly what becomes public first: your name and handle, the period, sessions, tokens, estimated spend, active days, streak, agent shares and the fun fact. The numbers are self-reported and not verified. Remove my entry deletes it.",
  },
  {
    q: "I use agents on more than one computer. Can I publish them all?",
    a: "Yes. Run AI Insights on each computer and publish from each report while signed in to the same account. Each computer keeps its own numbers and your profile adds them up: sessions, tokens and spend are summed, active days and streaks are combined day by day, and the leaderboard ranks the total. Computers are told apart by a random id AI Insights makes once per installation, never by the computer's name or hardware. You can name a computer in the report; the name is public only if you tick that box when you publish, otherwise visitors see Device 1, Device 2. Publishing again from a computer replaces only its numbers. To remove one computer, open your profile while signed in and press Remove device; Remove everything deletes your whole entry.",
  },
  {
    q: "Which agents does it read?",
    a: "Claude Code, Codex, OpenCode, Pi, Cursor and Gemini CLI, from where each keeps its history. Cursor's local transcripts hold no token counts, so its sessions add no tokens or cost. Gemini CLI support follows its published format but has not been tried on real history yet.",
  },
  {
    q: "Do I need the plugin, or is npx enough?",
    a: "npx is enough for the cards, the video and the analysis, all counted without a model. The plugin adds a skill that has your own agent read short, redacted excerpts from a sample of sessions, label them and write a short narrative (that is where lines like \"77% of sessions hit their goal\" come from), plus a coach that turns findings into edits you approve.",
  },
  {
    q: "Does AI Insights call a model?",
    a: "No. The judgement part runs in the agent you already use, under your existing account and settings, and counts towards your normal usage there.",
  },
  {
    q: "How do I make the video?",
    a: "Open your report, pick the cards, the style, the shape and where you will post, then press Download video. The MP4 is made in the page, in Chromium browsers today. In other browsers the page gives you a short terminal recipe that renders the same frames with headless Chrome and ffmpeg.",
  },
  {
    q: "How far back can it look?",
    a: "As far back as your agents keep their files. Claude Code keeps local transcripts for 30 days by default (the cleanupPeriodDays setting changes that), so older sessions may already be gone. Run it now, and raise that setting if you want a longer look back next time.",
  },
  {
    q: "What does it keep?",
    a: "Numbers (tokens, durations, tool calls, errors, lines changed) and the prompts you typed, with secrets redacted, in ~/.ai-insights/ where only you can read them. It does not store the agent's replies or tool output. Redaction is pattern-based, so it can miss an unusual secret.",
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Nothing. AI Insights is free and MIT licensed; the source is on <a href={REPO}>GitHub</a>. It was called Hindsight before version 0.2.
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
            <p className="max-w-[65ch] pb-2 text-[15px] leading-relaxed text-muted-foreground [&_a]:underline [&_a]:underline-offset-4">{item.a}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
