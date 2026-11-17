import { notFound } from "next/navigation"

import { BoardView, boardMetadata } from "@/app/leaderboard/board-view"
import { boardView } from "@/lib/leaderboard"

// Each view is rendered on its first visit and then served from the cache; a publish or change expires it at once
// (lib/board-cache.ts). The number is the safety net, kept equal to BOARD_REVALIDATE_SECONDS (Next reads it statically).
export const revalidate = 3600

/** No view is built ahead (the build needs no database): each one is rendered when it is first opened. */
export function generateStaticParams(): Array<{ sort: string; page: string }> {
  return []
}

export const metadata = boardMetadata

/** Reached through proxy.ts, which maps /leaderboard?sort=&page= here; the address bar keeps the public URL. */
export default async function BoardViewPage({ params }: { params: Promise<{ sort: string; page: string }> }) {
  const { sort, page } = await params
  const view = boardView(sort, page)
  if (!view) notFound()
  return <BoardView sort={view.sort} page={view.page} />
}
