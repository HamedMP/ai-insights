"use client"

import { CopyButton } from "@/components/site/copy-button"
import { Button } from "@/components/ui/button"
import { intents } from "@/lib/site"

/**
 * Post on X, LinkedIn, or copy the link. The links open the person's own post; the site sends nothing. Every `url`
 * passed here for a published person carries `?ref=<their handle>` (lib/referral.ts referralLink).
 */
export function ShareButtons({ post, url, label = "Copy link" }: { post: string; url: string; label?: string }) {
  const share = intents(post)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" nativeButton={false} render={<a href={share.x} target="_blank" rel="noopener noreferrer" />}>Post on X</Button>
      <Button size="sm" variant="outline" nativeButton={false} render={<a href={share.linkedin} target="_blank" rel="noopener noreferrer" />}>LinkedIn</Button>
      <CopyButton text={url} label={label} ariaLabel="Copy the profile link" />
    </div>
  )
}
