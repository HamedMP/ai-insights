"use client"

import * as React from "react"

import { CardGallery, WorkRatios } from "@/components/site/profile"
import { Segmented } from "@/components/site/segmented"
import type { SharedCard, SharedStats } from "@/lib/share"

export interface GalleryDevice {
  label: string
  cards: SharedCard[] | undefined
  stats: SharedStats
}

/**
 * The recap cards with a switch: "All devices" shows the highlights across the person's computers (each card says
 * which computer it came from), and each computer shows its own cards. With one computer it is the plain gallery.
 */
export function DeviceGallery({ handle, highlights, devices }: { handle: string; highlights: Array<{ card: SharedCard; from: string | null }>; devices: GalleryDevice[] }) {
  const [view, setView] = React.useState("all")
  if (devices.length <= 1) return <CardGallery cards={highlights.map((h) => h.card)} handle={handle} />
  const options = [{ value: "all", label: "All devices" }, ...devices.map((d, i) => ({ value: String(i), label: d.label }))]
  const chosen = view === "all" ? null : devices[Number(view)]
  const switcher = (
    <Segmented label="Show cards from" options={options} value={view} onChange={setView} className="max-w-full overflow-x-auto" />
  )
  return chosen ? (
    <CardGallery
      cards={chosen.cards}
      handle={handle}
      toolbar={
        <>
          {switcher}
          <WorkRatios stats={chosen.stats} />
        </>
      }
      empty={`${chosen.label} was published from an older report, which carried only the numbers. Cards appear when it publishes again from AI Insights 0.4 or newer.`}
    />
  ) : (
    <CardGallery cards={highlights.map((h) => h.card)} notes={highlights.map((h) => (h.from ? `from ${h.from}` : "all devices"))} handle={handle} toolbar={switcher} />
  )
}
