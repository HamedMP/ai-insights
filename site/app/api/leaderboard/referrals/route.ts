import { NextResponse, type NextRequest } from "next/server"

import { databaseConfigured, referralsFor } from "@/lib/db"
import { REF_COOKIE } from "@/lib/referral"
import { currentUserId, logError, readLimiter } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

/**
 * The signed-in person's own referrals: who published through their links, and when. Only ever about the caller:
 * there is no parameter to ask about anyone else. Visitors see a public count on the profile page instead.
 */
export async function GET(request: NextRequest) {
  if (!databaseConfigured()) return NextResponse.json({ ok: false }, { status: 503, headers })
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ ok: false }, { status: 401, headers })
  if (!readLimiter(`referrals:${userId}`)) return NextResponse.json({ ok: false }, { status: 429, headers })
  try {
    const mine = await referralsFor(userId)
    if (!mine) return NextResponse.json({ ok: false }, { status: 404, headers })
    const res = NextResponse.json({ ok: true, ...mine }, { headers })
    // A person who visited their own profile signed out may hold their own handle as a referral claim: drop it.
    if (request.cookies.get(REF_COOKIE)?.value === mine.handle) res.cookies.delete(REF_COOKIE)
    return res
  } catch (error) {
    logError("referrals read failed", error)
    return NextResponse.json({ ok: false }, { status: 500, headers })
  }
}
