import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"

import { CopyButton } from "@/components/site/copy-button"
import { CountUp } from "@/components/site/count-up"
import { Reveal } from "@/components/site/reveal"
import demo from "@/lib/demo.json"
import { SAMPLE } from "@/lib/site"

/** Three changes exactly as the sample report's "What to improve" chapter gives them (see scripts/demo-report.mjs). */
export function Tips() {
  return (
    <ol className="flex flex-col">
      {demo.payoff.map((tip, index) => {
        const kind = tip.paste.into.endsWith(".json") ? "Allow rule" : "Instruction"
        return (
          <li key={tip.anchor} className="border-t first:border-t-0 lg:first:border-t">
            <Reveal variant="left" delay={index * 80} className="grid grid-cols-1 gap-6 py-10 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10 lg:py-12">
              <div className="flex items-end gap-4 lg:flex-col lg:items-start lg:gap-2">
                <span className="text-6xl leading-none font-semibold tracking-[-0.04em] text-primary tabular-nums lg:text-7xl">
                  {tip.metric ? <CountUp value={tip.metric.value} duration={1200} /> : "·"}
                </span>
                <span className="pb-1 font-mono text-xs leading-snug text-muted-foreground lg:max-w-[12rem]">{tip.metric?.label}</span>
              </div>

              <div className="flex flex-col gap-3">
                <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                  <span className="text-primary">0{index + 1}</span> · {kind}
                </span>
                <h3 className="text-2xl leading-tight font-semibold tracking-tight">{tip.title}</h3>
                <p className="border-l-2 border-primary/50 pl-3 font-mono text-[12.5px] leading-relaxed text-ink-soft">
                  <span className="text-muted-foreground">evidence: </span>
                  {tip.evidence}
                </p>
                <p className="leading-relaxed text-muted-foreground">{tip.action}</p>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_18px_40px_-28px_rgb(0_0_0/0.35)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
                  <div className="flex items-center justify-between gap-3 border-b px-3.5 py-1.5">
                    <span className="mono-comment truncate text-[11.5px]">paste into {tip.paste.into}</span>
                    <CopyButton text={tip.paste.text} ariaLabel={`Copy: ${tip.title}`} />
                  </div>
                  <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap text-foreground">{tip.paste.text}</pre>
                </div>
                <a href={`${SAMPLE}#${tip.anchor}`} className="group/see inline-flex min-h-10 w-fit items-center gap-1 font-mono text-[11.5px] text-muted-foreground outline-none hover:text-primary focus-visible:text-primary">
                  see it in the sample report
                  <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-3.5 transition-transform group-hover/see:translate-x-0.5 group-hover/see:-translate-y-0.5" />
                </a>
              </div>
            </Reveal>
          </li>
        )
      })}
    </ol>
  )
}
