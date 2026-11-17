import { NextResponse } from "next/server"

import { databaseConfigured, entryByUser } from "@/lib/db"
import { currentUserId, logError, readLimiter } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

/** The signed-in person's own public handle, or null if they have not published. Used by the account menu. */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ ok: false }, { status: 401, headers })
  if (!readLimiter(`me:${userId}`)) return NextResponse.json({ ok: false }, { status: 429, headers })
  if (!databaseConfigured()) return NextResponse.json({ ok: true, handle: null }, { headers })
  try {
    const mine = await entryByUser(userId)
    return NextResponse.json({ ok: true, handle: mine?.handle ?? null }, { headers })
  } catch (error) {
    logError("own entry read failed", error)
    return NextResponse.json({ ok: false }, { status: 500, headers })
  }
}
