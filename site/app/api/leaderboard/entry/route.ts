import { after, NextResponse, type NextRequest } from "next/server"

import { boardChanged } from "@/lib/board-cache"
import { databaseConfigured, removeEntry, saveEntry } from "@/lib/db"
import { handlePublish, handleRemove, type HandlerDeps, type Reply } from "@/lib/publish"
import { REF_COOKIE } from "@/lib/referral"
import { allowedOrigins, clerkAvatar, currentUserId, logError, recordReferral, recordSignupSource, writeLimiter } from "@/lib/server-auth"

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
  const reply = await handlePublish({
    ...(await deps(request)),
    referrer: request.cookies.get(REF_COOKIE)?.value ?? null,
    save: saveEntry,
    avatarFor: clerkAvatar,
    onCredited: (userId, handle) => after(() => recordReferral(userId, handle)),
  })
  // The cached board and profiles must show the new numbers on the publisher's next load, not an hour later.
  if (reply.status === 200) boardChanged(reply.body.ok ? reply.body.handle : null)
  const res = json(reply)
  // Published: a person has one referrer at most, set on their first publish, so the claim has done its job.
  if (reply.status === 200) res.cookies.delete(REF_COOKIE)
  return res
}

export async function DELETE(request: NextRequest) {
  if (!databaseConfigured()) return unavailable()
  const reply = await handleRemove({ ...(await deps(request)), remove: removeEntry })
  if (reply.status === 200) boardChanged()
  return json(reply)
}
