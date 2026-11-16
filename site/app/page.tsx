import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight02Icon } from "@hugeicons/core-free-icons"

import { CountUp } from "@/components/site/count-up"
import { Faq } from "@/components/site/faq"
import { FindingTicker } from "@/components/site/finding-ticker"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { HowItWorks } from "@/components/site/how-it-works"
import { Install } from "@/components/site/install"
import { ReportShots } from "@/components/site/report-shots"
import { Reveal } from "@/components/site/reveal"
import { Timeline, TimelineLegend } from "@/components/site/timeline"
import { Button } from "@/components/ui/button"
import demo from "@/lib/demo.json"
import { REPO, SAMPLE } from "@/lib/site"

function SectionHead({ id, comment, title, children }: { id: string; comment: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Reveal className="flex max-w-2xl flex-col gap-4">
      <span className="mono-comment text-xs tracking-wide">{comment}</span>
      <h2 id={id} className="text-3xl font-semibold tracking-tight md:text-[2.6rem] md:leading-[1.08]">
        {title}
      </h2>
      {children && <p className="text-lg leading-relaxed text-muted-foreground">{children}</p>}
    </Reveal>
  )
}

const PRIVACY = [
  { title: "No network calls", body: "No telemetry, no account, no uploads. The report is one HTML file on your disk and loads nothing from the network." },
  { title: "Your agent does the judging", body: "The review runs in the agent you already use, under your existing account and settings. Hindsight never calls a model API." },
  { title: "Secrets are redacted", body: "Keys, tokens, private keys, PASSWORD= assignments and email addresses are removed before anything is stored or shown. It is pattern-based, so an unusual secret can slip through." },
  { title: "Numbers, not replies", body: "Hindsight keeps numbers and the prompts you typed, not your agent's replies or tool output. It writes only to ~/.hindsight/, readable only by you." },
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
        <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pt-10 pb-20 md:px-8 md:pt-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14 lg:pt-20 lg:pb-28">
          <div className="flex flex-col gap-7">
            <Reveal>
              <span className="mono-comment text-xs tracking-wide">local insights from your coding agents</span>
            </Reveal>
            <Reveal delay={60}>
              <h1 className="text-[2.6rem] leading-[1.03] font-semibold tracking-[-0.035em] sm:text-6xl lg:text-[3.55rem]">
                Look back at how you work with <span className="text-primary">your agents</span>.
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="max-w-[34rem] text-lg leading-relaxed text-ink-soft md:text-xl md:leading-relaxed">
                Hindsight reads your Claude Code and Codex history and turns it into one private report: where your time and tokens go, what keeps going wrong, and what to change. Nothing leaves your machine.
              </p>
            </Reveal>
            <Reveal delay={180} className="flex flex-wrap gap-3">
              <Button size="lg" className="group/cta h-11 gap-2 rounded-full px-5 text-[15px]" nativeButton={false} render={<a href={SAMPLE} />}>
                See a sample report
                <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} data-icon="inline-end" className="transition-transform duration-300 group-hover/cta:translate-x-1" />
              </Button>
              <Button size="lg" variant="outline" className="h-11 rounded-full bg-background/60 px-5 text-[15px]" nativeButton={false} render={<a href="#install" />}>
                Install
              </Button>
            </Reveal>
            <Reveal delay={240}>
              <dl className="grid max-w-[30rem] grid-cols-2 border-y text-sm">
                <div className="flex flex-col gap-1 py-3 pr-4">
                  <dt className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Reads history from</dt>
                  <dd className="flex items-center gap-2">
                    <span className="size-1.5 rounded-[2px] bg-primary" />Claude Code, Codex
                  </dd>
                </div>
                <div className="flex flex-col gap-1 border-l py-3 pl-4">
                  <dt className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Network calls</dt>
                  <dd className="flex items-center gap-2">
                    <span className="size-1.5 rounded-[2px] bg-primary" />None
                  </dd>
                </div>
              </dl>
            </Reveal>
          </div>

          <Reveal delay={150}>
            <div className="rounded-2xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_30px_80px_-36px_rgb(0_0_0/0.4)]">
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
        </section>

        {/* ---------- what the report shows ---------- */}
        <section className="border-t bg-background/40">
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-24 md:px-8">
            <SectionHead id="report" comment="what the report shows" title="One page that reads like a story, backed by numbers you can check.">
              The report puts your own sessions in order: when you work, how much runs in parallel, what it costs and what keeps going wrong.
            </SectionHead>
            <Reveal>
              <ReportShots />
            </Reveal>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-24 md:px-8">
            <SectionHead id="how" comment="how it works" title="Three steps, all on your machine." />
            <HowItWorks />
          </div>
        </section>

        {/* ---------- install ---------- */}
        <section className="border-t bg-background/40">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-24 md:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <SectionHead id="install" comment="install" title="Add it to your agent, then ask it to run hindsight.">
              Each install adds the same MCP server and three skills: one builds the report, one turns findings into edits you approve, one checks the setup.
            </SectionHead>
            <Reveal delay={100}>
              <Install />
            </Reveal>
          </div>
        </section>

        {/* ---------- privacy ---------- */}
        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-24 md:px-8">
            <SectionHead id="privacy" comment="privacy" title="Your history stays yours." />
            <ul className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
              {PRIVACY.map((item, index) => (
                <li key={item.title}>
                  <Reveal delay={index * 70} className="glyph-host flex flex-col gap-2">
                    <h3 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
                      <span className="glyph text-sm" aria-hidden />
                      {item.title}
                    </h3>
                    <p className="max-w-[34rem] leading-relaxed text-muted-foreground">{item.body}</p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- faq ---------- */}
        <section className="border-t bg-background/40">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-24 md:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <div className="flex flex-col gap-6">
              <SectionHead id="faq" comment="questions" title="Before you install." />
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
      </main>
      <Footer />
    </>
  )
}
