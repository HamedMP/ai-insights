import { LogoMark } from "@/components/site/logo"
import { MATRIX, NPM, REPO, SAMPLE, asset } from "@/lib/site"

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-14 md:flex-row md:items-end md:justify-between md:px-8">
        <div className="flex flex-col gap-1.5 font-mono text-[13px]">
          <span className="group/logo mb-3 inline-flex items-center gap-2.5 font-sans text-base font-semibold tracking-tight">
            <LogoMark className="size-6" /> hindsight
          </span>
          <span className="mono-comment">look back at how you work with AI coding agents</span>
          <span className="mono-comment">
            built by the{" "}
            <a className="link-underline text-foreground" href={MATRIX}>
              Matrix OS
            </a>{" "}
            team
          </span>
          <span className="mono-comment">
            are you an agent? read{" "}
            <a className="link-underline text-foreground" href={asset("llms.txt")}>
              llms.txt
            </a>
          </span>
        </div>
        <nav aria-label="Links" className="flex flex-wrap gap-x-6 text-sm [&>a]:inline-flex [&>a]:min-h-10 [&>a]:items-center md:[&>a]:min-h-0">
          <a className="link-underline" href={REPO}>GitHub</a>
          <a className="link-underline" href={NPM}>npm</a>
          <a className="link-underline" href={SAMPLE}>Sample report</a>
          <a className="link-underline" href={`${REPO}/blob/main/LICENSE`}>MIT license</a>
        </nav>
      </div>
    </footer>
  )
}
