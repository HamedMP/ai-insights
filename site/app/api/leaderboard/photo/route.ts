import { NextResponse, type NextRequest } from "next/server"

import { databaseConfigured, setOwnAvatar } from "@/lib/db"
import { handlePhoto } from "@/lib/photo-route"
import { allowedOrigins, clerkPhoto, currentUserId, logError, writeLimiter } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

/** The signed-in owner's "Show my photo" switch: {show: boolean}. Acts only on the caller's own entry. */
export async function POST(request: NextRequest) {
  if (!databaseConfigured()) return NextResponse.json({ ok: false, error: "The leaderboard is not available right now." }, { status: 503, headers })
  const reply = await handlePhoto({
    userId: await currentUserId(),
    origin: request.headers.get("origin"),
    allowedOrigins: allowedOrigins(),
    contentType: request.headers.get("content-type"),
    body: request.body,
    allow: (userId) => writeLimiter(`photo:${userId}`),
    log: logError,
    avatarFor: clerkPhoto,
    setAvatar: setOwnAvatar,
  })
  return NextResponse.json(reply.body, { status: reply.status, headers })
}
