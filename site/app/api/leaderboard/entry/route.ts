import { after, NextResponse, type NextRequest } from "next/server"

import { databaseConfigured, removeEntry, saveEntry } from "@/lib/db"
import { handlePublish, handleRemove, type HandlerDeps, type Reply } from "@/lib/publish"
import { allowedOrigins, currentUserId, logError, recordSignupSource, writeLimiter } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const json = (reply: Reply) => NextResponse.json(reply.body, { status: reply.status, headers: { "Cache-Control": "no-store" } })
const unavailable = () => json({ status: 503, body: { ok: false, error: "The leaderboard is not available right now." } })

async function deps(request: NextRequest): Promise<HandlerDeps> {
  const userId = await currentUserId()
  if (userId) after(() => recordSignupSource(userId))
  return {
    userId,
    origin: request.headers.get("origin"),
    allowedOrigins: allowedOrigins(),
    contentType: request.headers.get("content-type"),
    body: request.body,
    allow: writeLimiter,
    log: logError,
  }
}

export async function POST(request: NextRequest) {
  if (!databaseConfigured()) return unavailable()
  return json(await handlePublish({ ...(await deps(request)), save: saveEntry }))
}

export async function DELETE(request: NextRequest) {
  if (!databaseConfigured()) return unavailable()
  return json(await handleRemove({ ...(await deps(request)), remove: removeEntry }))
}
