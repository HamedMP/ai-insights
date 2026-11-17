"use client"

import * as React from "react"

import { CopyButton } from "@/components/site/copy-button"
import { callEntryApi } from "@/components/site/publish-panel"
import { Button } from "@/components/ui/button"
import { intents } from "@/lib/site"

/** Share links for one rank: they open the person's own post; the site sends nothing. */
export function RankShare({ post, url }: { post: string; url: string }) {
  const share = intents(post)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" nativeButton={false} render={<a href={share.x} target="_blank" rel="noopener noreferrer" />}>Post on X</Button>
      <Button size="sm" variant="outline" nativeButton={false} render={<a href={share.linkedin} target="_blank" rel="noopener noreferrer" />}>LinkedIn</Button>
      <CopyButton text={url} label="Copy link" ariaLabel="Copy your profile link" />
    </div>
  )
}

export function RemoveEntry() {
  const [state, setState] = React.useState<"idle" | "busy" | "removed" | string>("idle")
  if (state === "removed") return <p className="text-sm">Your entry is removed. Reload to see the board without it.</p>
  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="destructive"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy")
          const result = await callEntryApi("DELETE")
          setState(result.ok ? "removed" : result.error)
        }}
      >
        Remove my entry
      </Button>
      {state !== "idle" && state !== "busy" && <span role="alert" className="text-sm text-destructive">{state}</span>}
    </div>
  )
}
