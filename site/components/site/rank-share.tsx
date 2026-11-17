"use client"

import * as React from "react"

import { callEntryApi } from "@/lib/entry-api"
import { ShareButtons } from "@/components/site/share-buttons"
import { Button } from "@/components/ui/button"

/** Share links for one rank: they open the person's own post; the site sends nothing. */
export const RankShare = ShareButtons

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
