import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown02Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons"

import { CountUp } from "@/components/site/count-up"
import { Faq } from "@/components/site/faq"
import { FindingTicker } from "@/components/site/finding-ticker"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { HowItWorks } from "@/components/site/how-it-works"
import { HeroInstall, Install } from "@/components/site/install"
import { ReportTour } from "@/components/site/report-tour"
import { Reveal } from "@/components/site/reveal"
import { Timeline, TimelineLegend } from "@/components/site/timeline"
import { Tips } from "@/components/site/tips"
import { Button } from "@/components/ui/button"
import demo from "@/lib/demo.json"
import { REPO, SAMPLE } from "@/lib/site"
import { cn } from "@/lib/utils"

/** A section's opening: index and comment in mono, a firm headline, and an optional lede (beside it when `split`). */
function SectionHead({ index, comment, title, children, split, className }: { index: string; comment: string; title: React.ReactNode; children?: React.ReactNode; split?: boolean; className?: string }) {
  return (
    <Reveal className={cn("flex flex-col gap-4", split ? "lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end lg:gap-x-16" : "max-w-2xl", className)}>
      <div className="flex flex-col gap-4">
        <span className="font-mono text-xs tracking-wide text-muted-foreground">
          <span className="text-primary">{index}</span> <span className="text-primary">//</span> {comment}
        </span>
        <h2 className="text-[2rem] leading-[1.06] font-semibold tracking-[-0.03em] md:text-5xl md:leading-[1.02]">{title}</h2>
      </div>
      {children && <p className={cn("max-w-xl text-lg leading-relaxed text-muted-foreground", split && "lg:pb-1.5 lg:text-[17px]")}>{children}</p>}
    </Reveal>
  )
}

const PRIVACY = [
  { value: "0", unit: "network calls", title: "Nothing is sent", body: "No telemetry, no account, no uploads. The report is one HTML file on your disk and loads nothing from the network." },
  { value: "0", unit: "model API calls", title: "Your agent does the judging", body: "The review runs in the agent you already use, under your existing account and settings. Hindsight never calls a model API." },
  { value: "***", unit: "secrets, before storing", title: "Secrets are redacted", body: "Keys, tokens, private keys, PASSWORD= assignments and email addresses are removed first. It is pattern-based, so an unusual secret can slip through." },
  { value: "1", unit: "folder: ~/.hindsight/", title: "Numbers, not replies", body: "It keeps numbers and the prompts you typed, not your agent's replies or tool output, in a folder readable only by you." },
]

function Stat({ value, prefix, suffix, label, delay }: { value: number; prefix?: string; suffix?: string; label: string; delay: number }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3.5">
      <span className="text-2xl font-semibold tracking-tight">
        <CountUp value={value} prefix={prefix} suffix={suffix} delay={delay} />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

export default function Page() {
  const n = demo.numbers
  return (
    <>
      <Header />
      <main id="top">
        {/* ---------- hero ---------- */}
        <section className="relative">
          <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[44rem]" />
          <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pt-8 pb-20 md:px-8 md:pt-14 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14 lg:pt-16 lg:pb-28">
            <div className="flex flex-col gap-6">
              <Reveal>
                <span className="mono-comment text-xs tracking-wide">local insights from your coding agents</span>
              </Reveal>
              <Reveal delay={60}>
                <h1 className="text-[2.7rem] leading-[1] font-semibold tracking-[-0.045em] sm:text-6xl lg:text-[4rem]">
                  Look back at how you work with <span className="text-primary">your agents</span>.
                </h1>
              </Reveal>
              <Reveal delay={120}>
                <p className="max-w-[33rem] text-lg leading-relaxed text-ink-soft md:text-[1.2rem] md:leading-relaxed">
                  Hindsight reads your Claude Code and Codex history and turns it into one private report: where your time and tokens go, what keeps going wrong, and what to change. Nothing leaves your machine.
                </p>
              </Reveal>
              <Reveal delay={180} className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <Button size="lg" className="group/cta h-11 gap-2 rounded-full px-5 text-[15px] shadow-[0_8px_24px_-10px_var(--primary)]" nativeButton={false} render={<a href={SAMPLE} />}>
                  See a sample report
                  <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} data-icon="inline-end" className="transition-transform duration-300 group-hover/cta:translate-x-1" />
                </Button>
                <a href="#report" className="group/tour inline-flex h-11 items-center gap-1.5 text-[15px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
                  or scroll through it here
                  <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} className="size-4 transition-transform group-hover/tour:translate-y-0.5" />
                </a>
              </Reveal>
              <Reveal delay={240} className="flex max-w-[31rem] flex-col gap-2.5">
                <HeroInstall />
                <p className="font-mono text-[11.5px] leading-relaxed text-muted-foreground">
                  then ask it to <span className="text-foreground">run hindsight</span> · reads Claude Code, Codex ·{" "}
                  <a href="#install" className="link-underline text-foreground">
                    other agents
                  </a>
                </p>
              </Reveal>
            </div>

            <Reveal delay={150} variant="rise">
              <div className="rounded-2xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_30px_80px_-36px_rgb(0_0_0/0.4)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_30px_90px_-30px_rgb(0_0_0/0.9)]">
                <div className="flex items-center gap-1.5 border-b px-4 py-3">
                  <span className="size-2.5 rounded-full bg-input" />
                  <span className="size-2.5 rounded-full bg-input" />
                  <span className="size-2.5 rounded-full bg-input" />
                  <span className="ml-2 truncate font-mono text-[11px] text-muted-foreground">sample report · busiest afternoon, Nov 11</span>
                </div>
                <div className="flex flex-col gap-4 px-4 pt-4 pb-3 sm:px-5">
                  <p className="text-[15px] leading-snug">
                    On its busiest afternoon, <b className="font-semibold text-primary">{demo.peak.open} sessions were open at once</b>. The agents logged {n.agentHours} h of work in {n.hoursWithAi} h.
                  </p>
                  <Timeline />
                  <TimelineLegend />
                </div>
                <div className="grid grid-cols-2 border-t sm:grid-cols-4 [&>*]:border-border [&>*:not(:first-child)]:sm:border-l [&>*:nth-child(2)]:border-l [&>*:nth-child(3)]:max-sm:border-t [&>*:nth-child(4)]:max-sm:border-t [&>*:nth-child(4)]:border-l">
                  <Stat value={n.sessions} label="sessions" delay={500} />
                  <Stat value={n.hoursWithAi} suffix=" h" label="with AI at work" delay={600} />
                  <Stat value={n.mostAtOnce} label="working at once" delay={700} />
                  <Stat value={n.usd} prefix="≈ $" label="at API list prices" delay={800} />
                </div>
                <div className="border-t px-4 py-3 sm:px-5">
                  <FindingTicker />
                </div>
              </div>
              <p className="mono-comment mt-3 text-[11px]">every number here comes from the sample report, built from invented sessions</p>
            </Reveal>
          </div>
        </section>

        {/* ---------- the report, live ---------- */}
        <section id="report" className="border-t bg-background/40">
          <div className="mx-auto flex max-w-[84rem] flex-col gap-10 px-4 py-20 md:px-8 md:py-28">
            <div className="mx-auto w-full max-w-6xl">
              <SectionHead split index="01" comment="the report" title="One page that reads like a story, backed by numbers you can check.">
                Your sessions in order: when you work, how much runs in parallel, what it costs and what keeps going wrong. This is the real report, on invented sessions.
              </SectionHead>
            </div>
            <Reveal variant="rise">
              <ReportTour />
            </Reveal>
          </div>
        </section>

        {/* ---------- the payoff ---------- */}
        <section id="tips" className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-20 pb-12 md:px-8 md:pt-28 md:pb-16">
            <SectionHead split index="02" comment="what you take away" title={<>Not just charts. Changes, <span className="text-primary">ready to paste</span>.</>}>
              Every finding ends in something to do: a line for CLAUDE.md or AGENTS.md, an allow rule, a habit. Three of them, exactly as the sample report gives them.
            </SectionHead>
            <Tips />
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section id="how" className="border-t bg-background/40">
          <div className="mx-auto flex max-w-6xl flex-col gap-14 px-4 py-20 md:px-8 md:py-28">
            <SectionHead index="03" comment="how it works" title="From your history to a report, all on your machine." />
            <HowItWorks />
          </div>
        </section>

        {/* ---------- install ---------- */}
        <section id="install" className="border-t">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <SectionHead index="04" comment="install" title="Add it to your agent, then ask it to run hindsight.">
              Each install adds the same MCP server and three skills: one builds the report, one turns findings into edits you approve, one checks the setup.
            </SectionHead>
            <Reveal delay={100}>
              <Install />
            </Reveal>
          </div>
        </section>

        {/* ---------- privacy ---------- */}
        <section id="privacy" className="border-t bg-background/40">
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 md:px-8 md:py-28">
            <SectionHead index="05" comment="privacy" title="Your history stays yours." />
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {PRIVACY.map((item, index) => (
                <li key={item.title} className="bg-background">
                  <Reveal delay={index * 70} className="glyph-host flex h-full flex-col gap-3 p-6">
                    <span className="flex items-baseline gap-2">
                      <span className="text-4xl font-semibold tracking-[-0.04em] text-primary">{item.value}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{item.unit}</span>
                    </span>
                    <h3 className="mt-2 text-base font-semibold tracking-tight">{item.title}</h3>
                    <p className="text-[14.5px] leading-relaxed text-muted-foreground">{item.body}</p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- faq ---------- */}
        <section id="faq" className="border-t">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <div className="flex flex-col gap-6">
              <SectionHead index="06" comment="questions" title="Before you install." />
              <Reveal delay={80}>
                <p className="max-w-sm leading-relaxed text-muted-foreground">
                  Something not covered here? Ask in{" "}
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

        {/* ---------- closing call to action ---------- */}
        <section className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-8 md:py-24">
            <Reveal variant="rise" className="closing dark relative overflow-hidden rounded-[1.75rem] border bg-background px-5 text-foreground shadow-[0_40px_100px_-50px_rgb(60_30_10/0.6)] py-12 sm:px-10 md:py-16 lg:px-14">
              <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="flex flex-col gap-5">
                  <span className="mono-comment text-xs">two lines, then one sentence to your agent</span>
                  <h2 className="text-[2.2rem] leading-[1.02] font-semibold tracking-[-0.04em] md:text-[3.4rem]">
                    See where your last month <br className="max-md:hidden" />
                    of agent work <span className="text-primary">went</span>.
                  </h2>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="lg" className="group/cta h-11 gap-2 rounded-full px-5 text-[15px]" nativeButton={false} render={<a href={SAMPLE} />}>
                      See a sample report
                      <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} data-icon="inline-end" className="transition-transform duration-300 group-hover/cta:translate-x-1" />
                    </Button>
                    <Button size="lg" variant="outline" className="h-11 rounded-full bg-background/60 px-5 text-[15px]" nativeButton={false} render={<a href={REPO} />}>
                      Read the source
                    </Button>
                  </div>
                </div>
                <HeroInstall />
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
