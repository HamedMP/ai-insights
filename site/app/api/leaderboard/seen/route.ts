import { NextResponse, type NextRequest } from "next/server"

import { readLimited } from "@/lib/publish"
import { allowedOrigins, currentUserId, recordSignupSource, writeLimiter } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

/** Called once by the publish panel after sign-in: records the sign-up source in Clerk metadata. No body, no data back. */
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" }
  const origin = request.headers.get("origin")
  if (!origin || !allowedOrigins().includes(origin)) return NextResponse.json({ ok: false }, { status: 403, headers })
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ ok: false }, { status: 401, headers })
  if (!writeLimiter(`seen:${userId}`)) return NextResponse.json({ ok: false }, { status: 429, headers })
  if ((await readLimited(request.body, 0)) === null) return NextResponse.json({ ok: false }, { status: 413, headers })
  await recordSignupSource(userId)
  return NextResponse.json({ ok: true }, { headers })
}
