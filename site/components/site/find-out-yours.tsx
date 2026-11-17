import { CopyButton } from "@/components/site/copy-button"
import { COMMAND, HASHTAG, SITE_URL, intents } from "@/lib/site"

// Its own module so a profile can show it without loading the share page's publish panel (and Clerk with it).
/** The call to action under every card: run it yourself. */
export function FindOutYours({ note }: { note?: React.ReactNode }) {
  const post = `Find out how you work with AI coding agents: ${COMMAND}\n${SITE_URL}\n${HASHTAG}`
  const share = intents(post)
  return (
      <section aria-labelledby="yours" className="flex w-full max-w-[34rem] flex-col items-center gap-4 text-center">
        <h2 id="yours" className="text-[1.9rem] leading-tight font-semibold tracking-[-0.03em]">
          Find out <span className="text-primary">yours.</span>
        </h2>
        <p className="text-muted-foreground">One command in your terminal. It reads your history on your machine and makes the recap there. Nothing is uploaded.</p>
        <div className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left">
          <code className="font-mono text-[15px]">
            <span className="text-muted-foreground select-none">$ </span>
            {COMMAND}
          </code>
          <CopyButton text={COMMAND} trackAs="card" ariaLabel="Copy the command" />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-[14px]">
          <a className="underline-offset-4 hover:underline" href={SITE_URL}>What it shows</a>
          <span aria-hidden className="text-muted-foreground">·</span>
          <a className="underline-offset-4 hover:underline" href={share.x} target="_blank" rel="noopener noreferrer">Post on X</a>
          <span aria-hidden className="text-muted-foreground">·</span>
          <a className="underline-offset-4 hover:underline" href={share.linkedin} target="_blank" rel="noopener noreferrer">Post on LinkedIn</a>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          {note}
        </p>
      </section>
      )
}
