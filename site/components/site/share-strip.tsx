"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Linkedin01Icon, NewTwitterIcon } from "@hugeicons/core-free-icons"

import { CopyButton } from "@/components/site/copy-button"
import media from "@/lib/media.json"
import { HASHTAG, SITE_POST, intents } from "@/lib/site"

/** The sample recap's own caption, with the site's hashtag: what a post made from the report looks like. */
export const EXAMPLE_POST = media.caption
  .split("\n")
  .map((line) => (line.startsWith("#") ? HASHTAG : line))
  .join("\n")

export function ExamplePost() {
  const lines = EXAMPLE_POST.split("\n")
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <span className="font-mono text-[11px] text-white/60">the sample recap&apos;s caption, as the report writes it</span>
        <CopyButton text={EXAMPLE_POST} ariaLabel="Copy the example post" className="border-white/15 bg-white/5 text-white/70 hover:text-white" />
      </figcaption>
      <blockquote className="px-4 py-4 text-[15px] leading-relaxed text-white/90">
        {lines.map((line, at) => (
          <p key={at} className={line.startsWith("#") || line.startsWith("http") ? "text-[#ff9a5c]" : undefined}>
            {line}
          </p>
        ))}
      </blockquote>
    </figure>
  )
}

/** Links that open a prefilled post about AI Insights. Plain links: the site sends nothing itself. */
export function TellPeople() {
  const links = intents(SITE_POST)
  const item = "inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 text-[14px] font-medium text-white transition-colors outline-none hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40"
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a className={item} href={links.x} target="_blank" rel="noopener noreferrer">
        <HugeiconsIcon icon={NewTwitterIcon} strokeWidth={2} className="size-4" /> Post about it on X
      </a>
      <a className={item} href={links.linkedin} target="_blank" rel="noopener noreferrer">
        <HugeiconsIcon icon={Linkedin01Icon} strokeWidth={2} className="size-4" /> LinkedIn
      </a>
      <CopyButton text={SITE_POST} label="Copy the post" ariaLabel="Copy a post about AI Insights" className="h-10 rounded-full border-white/15 bg-white/5 px-4 text-[12px] text-white/80 hover:text-white" />
    </div>
  )
}
