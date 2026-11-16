import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight02Icon, ArrowUpRight01Icon, Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { CardWall } from "@/components/site/card-wall"
import { Faq } from "@/components/site/faq"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { GetIt, Install } from "@/components/site/install"
import { LiveCard } from "@/components/site/live-card"
import { Reveal } from "@/components/site/reveal"
import { ExamplePost, TellPeople } from "@/components/site/share-strip"
import { Button } from "@/components/ui/button"
import media from "@/lib/media.json"
import { COMMAND, HASHTAG, REPO, SAMPLE, SKILL, asset } from "@/lib/site"
import { cn } from "@/lib/utils"

/** A section's opening: a mono kicker, a firm headline, and an optional lede. */
function SectionHead({ kicker, title, children, className, inverse }: { kicker: string; title: React.ReactNode; children?: React.ReactNode; className?: string; inverse?: boolean }) {
  return (
    <Reveal className={cn("flex max-w-2xl flex-col gap-4", className)}>
      <span className={cn("font-mono text-xs tracking-wide", inverse ? "text-[#ff9a5c]" : "text-primary")}>{kicker}</span>
      <h2 className="text-[2.1rem] leading-[1.04] font-semibold tracking-[-0.035em] md:text-[3.2rem] md:leading-[1]">{title}</h2>
      {children && <p className={cn("text-lg leading-relaxed", inverse ? "text-white/70" : "text-muted-foreground")}>{children}</p>}
    </Reveal>
  )
}

/** The 21 cards, by what they say. A card only appears when a history has the data for it. */
const CARDS = [
  "Your persona",
  "Most agents at once",
  "Living dangerously",
  "Manners",
  "Your favourite word",
  "Night owl or early bird",
  "Your favourite day",
  "Longest streak",
  "Bash hall of fame",
  "Tests",
  "Your agent's nemesis",
  "Top model",
  "Slash commands",
  "Where things broke",
  "Longest session",
  "Tokens",
  "Time with your agents",
  "Your last days with AI",
  "Three things to try next",
  "Summary",
  "How to make your own",
]

const AGENTS: Array<{ name: string; history: string; tokens: string; install: string; note?: string }> = [
  { name: "Claude Code", history: "Read", tokens: "Yes", install: "Plugin" },
  { name: "Codex", history: "Read", tokens: "Yes", install: "Plugin" },
  { name: "OpenCode", history: "Read", tokens: "Yes", install: "Untested", note: "Its database needs Node 22.5 or later." },
  { name: "Pi", history: "Read", tokens: "Yes", install: "Untested" },
  { name: "Cursor", history: "Read", tokens: "No", install: "Untested", note: "Cursor's local transcripts hold no token counts." },
  { name: "Gemini CLI", history: "Untested", tokens: "Yes", install: "None yet", note: "Built from Gemini CLI's own format; not yet tried on real history. Use npx." },
]

const CAN = ["Counts, hours, streaks and percentages", "Words from a fixed list of everyday coding words", "Public program, model and agent names", "A persona built from a fixed set of titles"]
const CANNOT = ["Your prompts, or anything the agent said", "File, folder or project names", "Session ids, paths or secrets", "Anything from the private analysis"]

export default function Page() {
  return (
    <>
      <Header />
      <main id="top">
        {/* ---------- hero ---------- */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[48rem]" />
          <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-x-12 gap-y-8 px-4 pt-6 pb-16 md:px-8 md:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-y-7 lg:pt-14 lg:pb-24">
            <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-1 lg:self-end">
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border bg-card/70 py-1 pr-3 pl-2 font-mono text-[11.5px] text-muted-foreground backdrop-blur">
                  <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" /> free and open source · runs on your machine
                </span>
              </Reveal>
              <Reveal delay={60}>
                <h1 className="text-[3rem] leading-[0.96] font-semibold tracking-[-0.05em] sm:text-[4rem] lg:text-[4.6rem]">
                  Your AI coding, <span className="text-primary">recapped.</span>
                </h1>
              </Reveal>
            </div>
            <Reveal delay={120} variant="rise" className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
              <LiveCard />
              <p className="mt-3 text-center font-mono text-[11px] text-muted-foreground">live from the sample recap, built from invented sessions</p>
            </Reveal>
            <div id="get" className="flex scroll-mt-24 flex-col gap-6 lg:col-start-1 lg:row-start-2 lg:self-start">
              <Reveal delay={120}>
                <p className="max-w-[34rem] text-lg leading-relaxed text-ink-soft md:text-[1.2rem] md:leading-relaxed">
                  One command turns your local agent history into animated cards you can post, and a private analysis of what to change. Claude Code, Codex, Cursor, OpenCode, Pi and Gemini CLI. Nothing leaves your machine.
                </p>
              </Reveal>
              <Reveal delay={180} className="w-full max-w-[30rem]">
                <GetIt />
              </Reveal>
              <Reveal delay={240} className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Button size="lg" variant="outline" className="group/cta h-11 gap-2 rounded-full bg-card/70 px-5 text-[15px]" nativeButton={false} render={<a href={SAMPLE} />}>
                  See a sample recap
                  <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} data-icon="inline-end" className="transition-transform duration-300 group-hover/cta:translate-x-1" />
                </Button>
                <a href="#video" className="inline-flex h-11 items-center text-[15px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline">
                  Watch a {media.video.seconds} s recap video
                </a>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------- the wall ---------- */}
        <section id="cards" className="border-t bg-background/40 py-16 md:py-24">
          <div className="mx-auto mb-10 flex max-w-6xl flex-col gap-6 px-4 md:mb-14 md:px-8 lg:flex-row lg:items-end lg:justify-between">
            <SectionHead kicker="the recap" title={<>21 cards about how you <span className="text-primary">actually</span> work.</>}>
              Your persona, how many agents you ran at once, your manners, your favourite word, when you prompt, your streak, your bash hall of fame. Three styles, each laid out again for every shape.
            </SectionHead>
            <Reveal delay={100} className="flex flex-wrap gap-1.5 lg:max-w-sm lg:justify-end">
              {CARDS.slice(0, 12).map((card) => (
                <span key={card} className="rounded-full border bg-card/70 px-2.5 py-1 text-[12.5px] text-muted-foreground">{card}</span>
              ))}
              <span className="px-2.5 py-1 text-[12.5px] text-muted-foreground">and {CARDS.length - 12} more</span>
            </Reveal>
          </div>
          <CardWall />
          <p className="mx-auto mt-8 max-w-6xl px-4 font-mono text-[11px] text-muted-foreground md:px-8">cards from the sample recap, built from invented sessions. A card appears only when your history has the data for it.</p>
        </section>

        {/* ---------- what you get ---------- */}
        <section id="what" className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 md:px-8 md:py-28">
            <SectionHead kicker="what you get" title="Show it off. Fix what slows you down. Watch it change.">
              One HTML page on your disk, in three parts. The recap is made to be shared; the rest stays with you.
            </SectionHead>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <Part step="01" label="Recap cards" verb="share" title="Your last weeks with agents, as a story" body="Play it in the page, or export it. Cards hold counts and a few allowlisted words, never your prompts or project names." img="media/card-pop-parallel.webp" imgAlt="The most-agents-at-once card" square />
              <Part step="02" label="Private analysis" verb="fix" title="Where your time and tokens go" body="Your rhythm, parallel sessions on a timeline, cost at API list prices, and findings with the evidence behind them. Then the changes, ranked, with text to paste into CLAUDE.md or AGENTS.md." img="media/report-change.webp" imgAlt="Ranked changes from the sample report, each with text to copy" />
              <Part step="03" label="Over time" verb="improve" title="Every run keeps a snapshot" body="Run it again next week and the page shows what changed since last time: which findings look resolved, which are still open, which are new." img="media/report-time.webp" imgAlt="Numbers from the sample report compared with its previous run" />
            </div>
          </div>
        </section>

        {/* ---------- video ---------- */}
        <section id="video" className="border-t bg-background/40">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div className="flex flex-col gap-8">
              <SectionHead kicker="make a video" title={<>Pick the cards. Pick the shape. <span className="text-primary">Export.</span></>}>
                The card studio in your report puts the recap together for wherever you post it.
              </SectionHead>
              <Reveal delay={80}>
                <ul className="flex flex-col gap-3 text-[15.5px] leading-relaxed">
                  <Point>Choose and order the cards. The maker&apos;s mark is on by default; you can turn it off.</Point>
                  <Point>Four shapes: 1:1, 9:16, 4:5 and 16:9. Every card is laid out again, so nothing is cropped.</Point>
                  <Point>Length presets for X, Instagram feed, Reels and Stories, TikTok, LinkedIn and YouTube Shorts.</Point>
                  <Point>Download an MP4 or PNG images, made in the page. In-page video works in Chromium browsers today; in other browsers the page gives you a terminal recipe instead.</Point>
                </ul>
              </Reveal>
            </div>
            <Reveal variant="rise" className="flex flex-col gap-3">
              <div className="mx-auto w-full max-w-[34rem] overflow-hidden rounded-[18px] bg-[#141210] shadow-[0_40px_80px_-36px_rgb(60_30_10/0.55)] ring-1 ring-black/5 dark:ring-white/10">
                <video className="block aspect-square w-full" controls muted playsInline preload="none" poster={asset(media.video.poster)} aria-label="A sample recap video, exported from the sample report">
                  <source src={asset(media.video.file)} type="video/mp4" />
                </video>
              </div>
              <p className="text-center font-mono text-[11px] text-muted-foreground">
                the sample report&apos;s own export: {media.video.cards.length} cards, {media.video.seconds} s, silent · scaled to 720 px for this page
              </p>
            </Reveal>
          </div>
          <div className="mx-auto max-w-6xl px-4 pb-20 md:px-8 md:pb-28">
            <Reveal variant="rise">
              <figure className="overflow-hidden rounded-2xl border bg-card shadow-[0_30px_80px_-40px_rgb(0_0_0/0.35)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset("media/report-studio.webp")} alt="The card studio in the sample report: shape, style, where you will post, pace, and the cards to include" width={1400} height={1050} loading="lazy" decoding="async" className="w-full" />
              </figure>
            </Reveal>
          </div>
        </section>

        {/* ---------- share ---------- */}
        <section id="share" className="relative overflow-hidden border-t bg-[#0e0d0c] text-white dark:bg-[#17130f]">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_24rem_at_90%_0%,rgb(255_122_47/0.16),transparent_70%)]" />
          <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-20 md:px-8 md:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
            <div className="flex flex-col gap-8">
              <SectionHead inverse kicker="share your recap" title={<>Post it with <span className="text-[#ff9a5c]">{HASHTAG}</span></>}>
                The share sheet in your report opens X and LinkedIn with a caption ready, saves the file for Instagram and TikTok or Shorts, uses your system share sheet where the browser has one, and copies the caption.
              </SectionHead>
              <Reveal delay={80} className="flex flex-col gap-4">
                <p className="text-[15px] leading-relaxed text-white/70">Every recap ends with how to make your own, so whoever sees yours knows how to get theirs.</p>
                <TellPeople />
              </Reveal>
            </div>
            <Reveal delay={60} className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)] sm:items-start">
              <ExamplePost />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset("media/card-pop-outro.webp")} alt="The last card of every recap: made with AI Insights by Matrix OS, with the command to make your own" width={560} height={560} loading="lazy" decoding="async" className="w-full rounded-[16px] ring-1 ring-white/10" />
            </Reveal>
          </div>
        </section>

        {/* ---------- privacy ---------- */}
        <section id="privacy" className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 md:px-8 md:py-28">
            <SectionHead kicker="privacy" title="Your history never leaves your machine.">
              AI Insights reads files on your disk and writes one page next to them. No account, no telemetry, no network calls, and it never calls a model API.
            </SectionHead>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Reveal className="rounded-2xl border bg-card p-6">
                <h3 className="mb-4 text-lg font-semibold tracking-tight">A card can show</h3>
                <ul className="flex flex-col gap-2.5">
                  {CAN.map((item) => (
                    <li key={item} className="flex gap-3 text-[15px]">
                      <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.4} className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal delay={80} className="rounded-2xl border bg-card p-6">
                <h3 className="mb-4 text-lg font-semibold tracking-tight">A card never shows</h3>
                <ul className="flex flex-col gap-2.5">
                  {CANNOT.map((item) => (
                    <li key={item} className="flex gap-3 text-[15px]">
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.4} className="mt-0.5 size-4 shrink-0 text-destructive" />
                      {item}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
            <Reveal className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-3">
              <Verify title="Read the code" body={<>MIT licensed. The repository&apos;s first rule: no network calls anywhere in the source. <a className="link-underline text-foreground" href={REPO}>On GitHub</a>.</>} />
              <Verify title="Check the page" body={<>The report&apos;s Content-Security-Policy starts with <code className="font-mono text-[13px] text-foreground">default-src &apos;none&apos;</code>, so the page cannot load or send anything by itself.</>} />
              <Verify title="See what it read" body={<><code className="font-mono text-[13px] text-foreground">npx ai-insights doctor</code> lists each history it found and where. Secrets are redacted before anything is stored.</>} />
            </Reveal>
          </div>
        </section>

        {/* ---------- agents ---------- */}
        <section id="agents" className="border-t bg-background/40">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <SectionHead kicker="which agents" title="Six agents, read where they keep their history.">
              Some of these are newer than others. Here is where each one stands today.
            </SectionHead>
            <Reveal delay={80} className="overflow-x-auto rounded-2xl border bg-card">
              <table className="w-full text-left text-[13.5px] sm:text-[14.5px]">
                <thead>
                  <tr className="border-b font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th scope="col" className="px-2.5 py-3 sm:px-4 font-medium">Agent</th>
                    <th scope="col" className="px-2.5 py-3 sm:px-4 font-medium">History</th>
                    <th scope="col" className="px-2.5 py-3 sm:px-4 font-medium">Tokens</th>
                    <th scope="col" className="px-2.5 py-3 sm:px-4 font-medium">Install</th>
                  </tr>
                </thead>
                <tbody>
                  {AGENTS.map((agent) => (
                    <tr key={agent.name} className="border-b align-top last:border-b-0">
                      <th scope="row" className="px-2.5 py-3 sm:px-4 font-medium">
                        {agent.name}
                        {agent.note && <span className="mt-0.5 block max-w-[15rem] text-[12.5px] font-normal text-muted-foreground">{agent.note}</span>}
                      </th>
                      <td className="px-2.5 py-3 sm:px-4"><Status value={agent.history} /></td>
                      <td className="px-2.5 py-3 sm:px-4"><Status value={agent.tokens} /></td>
                      <td className="px-2.5 py-3 sm:px-4"><Status value={agent.install} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Reveal>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section id="how" className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 md:px-8 md:py-28">
            <SectionHead kicker="how it works" title="Three steps, all on your machine." />
            <ol className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <Step n="1" title="Run it" body={<>Type <code className="font-mono text-[13.5px] text-foreground">{COMMAND}</code> in a terminal, or <code className="font-mono text-[13.5px] text-foreground">{SKILL}</code> in Claude Code or Codex once the plugin is in.</>} />
              <Step n="2" title="It reads your history" body="Sessions, prompts, tool calls, tokens and timing, counted with no model involved. Run from your agent, it also has the agent read short redacted excerpts to label a sample of sessions and write a short narrative." />
              <Step n="3" title="Open your page" body="Play the recap, make the video, share it. Then read the private analysis and paste in the changes worth making." />
            </ol>
          </div>
        </section>

        {/* ---------- install ---------- */}
        <section id="install" className="border-t bg-background/40">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <SectionHead kicker="install" title="One command, or add it to your agent.">
              The plugin gives your agent the same report, plus a skill that labels a sample of your sessions and one that turns findings into edits you approve.
            </SectionHead>
            <Reveal delay={100}>
              <Install />
            </Reveal>
          </div>
        </section>

        {/* ---------- faq ---------- */}
        <section id="faq" className="border-t">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <div className="flex flex-col gap-6">
              <SectionHead kicker="questions" title="Before you run it." />
              <Reveal delay={80}>
                <p className="max-w-sm leading-relaxed text-muted-foreground">
                  Something not covered? Ask in{" "}
                  <a className="link-underline text-foreground" href={`${REPO}/issues`}>
                    GitHub issues
                  </a>
                  , or read the{" "}
                  <a className="link-underline text-foreground" href={`${REPO}#readme`}>
                    README
                  </a>
                  .
                </p>
              </Reveal>
            </div>
            <Reveal delay={100}>
              <Faq />
            </Reveal>
          </div>
        </section>

        {/* ---------- closing ---------- */}
        <section className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-8 md:py-24">
            <Reveal variant="rise" className="closing dark relative overflow-hidden rounded-[1.75rem] border bg-background px-5 py-12 text-foreground shadow-[0_40px_100px_-50px_rgb(60_30_10/0.6)] sm:px-10 md:py-16 lg:px-14">
              <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="flex flex-col gap-5">
                  <span className="font-mono text-xs text-primary">one command</span>
                  <h2 className="text-[2.2rem] leading-[1.02] font-semibold tracking-[-0.04em] md:text-[3.4rem]">
                    See yours. <span className="text-primary">Then post it.</span>
                  </h2>
                  <Button size="lg" variant="outline" className="h-11 w-fit gap-2 rounded-full bg-background/60 px-5 text-[15px]" nativeButton={false} render={<a href={SAMPLE} />}>
                    See a sample recap
                    <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} data-icon="inline-end" />
                  </Button>
                </div>
                <GetIt />
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}

function Part({ step, label, verb, title, body, img, imgAlt, square }: { step: string; label: string; verb: string; title: string; body: string; img: string; imgAlt: string; square?: boolean }) {
  return (
    <Reveal variant="rise" className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className={cn("relative h-64 overflow-hidden border-b bg-[#f3f0e8]", square && "grid place-items-center")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset(img)} alt={imgAlt} loading="lazy" decoding="async" width={square ? 560 : 1400} height={square ? 560 : 900} className={square ? "size-52 rounded-xl shadow-[0_24px_40px_-24px_rgb(40_20_0/0.6)]" : "w-full object-cover object-top"} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-6">
        <span className="font-mono text-[11.5px] text-muted-foreground">
          <span className="text-primary">{step}</span> {label} <span className="text-primary">→</span> {verb}
        </span>
        <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </Reveal>
  )
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
      <span>{children}</span>
    </li>
  )
}

function Verify({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 bg-card p-6">
      <h3 className="font-semibold tracking-tight">{title}</h3>
      <p className="text-[14.5px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

function Step({ n, title, body }: { n: string; title: string; body: React.ReactNode }) {
  return (
    <li>
      <Reveal className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-6">
        <span className="grid size-9 place-items-center rounded-full bg-primary font-mono text-sm font-semibold text-primary-foreground">{n}</span>
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      </Reveal>
    </li>
  )
}

function Status({ value }: { value: string }) {
  const good = value === "Read" || value === "Yes" || value === "Plugin"
  const none = value === "No" || value === "None yet"
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11.5px] whitespace-nowrap", good ? "border-emerald-700/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300" : none ? "text-muted-foreground" : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200")}>
      {value}
    </span>
  )
}
