import { Rabbit } from "@/components/site/rabbit"
import { BASE, HASHTAG, MATRIX, NPM, REPO, SAMPLE, asset } from "@/lib/site"

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-14 md:flex-row md:items-end md:justify-between md:px-8">
        <div className="flex max-w-md flex-col gap-2 text-[14px]">
          <span className="mb-2 inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <Rabbit className="h-7 text-primary" /> AI Insights <span className="text-sm font-medium text-muted-foreground">by Matrix OS</span>
          </span>
          <p className="leading-relaxed text-muted-foreground">
            Built by the{" "}
            <a className="link-underline text-foreground" href={MATRIX}>
              Matrix OS
            </a>{" "}
            team. Matrix OS is the AI operating system we are building; AI Insights is free, open source and works without it. Formerly Hindsight.
          </p>
          <p className="font-mono text-[12px] text-muted-foreground">
            {HASHTAG} · are you an agent? read{" "}
            <a className="link-underline text-foreground" href={asset("llms.txt")}>
              llms.txt
            </a>
          </p>
        </div>
        <nav aria-label="Links" className="flex flex-wrap gap-x-6 text-sm [&>a]:inline-flex [&>a]:min-h-10 [&>a]:items-center md:[&>a]:min-h-0">
          <a className="link-underline" href={`${BASE}/leaderboard/`}>Leaderboard</a>
          <a className="link-underline" href={REPO}>GitHub</a>
          <a className="link-underline" href={NPM}>npm</a>
          <a className="link-underline" href={SAMPLE}>Sample recap</a>
          <a className="link-underline" href={`${REPO}/blob/main/LICENSE`}>MIT license</a>
        </nav>
      </div>
    </footer>
  )
}
