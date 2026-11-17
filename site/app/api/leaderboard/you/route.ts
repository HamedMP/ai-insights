import { after, NextResponse, type NextRequest } from "next/server"

import { boardPosition, databaseConfigured, entryByUser, ranksFor } from "@/lib/db"
import { DEFAULT_SORT, isSort } from "@/lib/leaderboard"
import { currentUserId, logError, readLimiter, recordSignupSource } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

/**
 * The signed-in person's strip above the leaderboard: their public name and photo, their rank in each arena, and where
 * they sit under the sort being viewed (for "jump to me"). Only ever about the caller. It is fetched by the browser so
 * the board itself can be one cached page for everyone.
 */
export async function GET(request: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ ok: false }, { status: 401, headers })
  if (!readLimiter(`you:${userId}`)) return NextResponse.json({ ok: false }, { status: 429, headers })
  after(() => recordSignupSource(userId))
  if (!databaseConfigured()) return NextResponse.json({ ok: true, entry: null }, { headers })
  const raw = request.nextUrl.searchParams.get("sort")
  const sort = isSort(raw) ? raw : DEFAULT_SORT
  try {
    const [entry, ranks, position] = await Promise.all([entryByUser(userId), ranksFor(userId), boardPosition(userId, sort)])
    if (!entry) return NextResponse.json({ ok: true, entry: null }, { headers })
    return NextResponse.json({ ok: true, sort, entry: { handle: entry.handle, displayName: entry.displayName, avatarUrl: entry.avatarUrl }, ranks, position }, { headers })
  } catch (error) {
    logError("own standing read failed", error)
    return NextResponse.json({ ok: false }, { status: 500, headers })
  }
}
