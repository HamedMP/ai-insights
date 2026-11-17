import { NextResponse, type NextRequest } from "next/server"

import { boardChanged } from "@/lib/board-cache"
import { databaseConfigured, ownDevices, removeOwnDevice, renameOwnDevice } from "@/lib/db"
import { handleDeviceList, handleDeviceRemove, handleDeviceRename } from "@/lib/device-routes"
import type { HandlerDeps, Reply } from "@/lib/publish"
import { allowedOrigins, currentUserId, logError, readLimiter, writeLimiter } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }
const json = (reply: { status: number; body: unknown }) => NextResponse.json(reply.body, { status: reply.status, headers })
/** A rename or removal changes the public profile and the totals the board ranks: expire the cached pages. */
const changed = (reply: { status: number; body: unknown }) => {
  if (reply.status === 200) boardChanged()
  return json(reply)
}
const unavailable = () => json({ status: 503, body: { ok: false, error: "The leaderboard is not available right now." } } satisfies Reply)

async function deps(request: NextRequest): Promise<HandlerDeps> {
  return {
    userId: await currentUserId(),
    origin: request.headers.get("origin"),
    allowedOrigins: allowedOrigins(),
    contentType: request.headers.get("content-type"),
    body: request.body,
    allow: writeLimiter,
    log: logError,
  }
}

/** The signed-in person's own computers. Only ever about the caller: there is no parameter to ask about anyone else. */
export async function GET() {
  if (!databaseConfigured()) return unavailable()
  return json(await handleDeviceList({ userId: await currentUserId(), allow: readLimiter, list: ownDevices, log: logError }))
}

/** Rename one of the caller's computers, and choose whether its name shows on the public profile. */
export async function PATCH(request: NextRequest) {
  if (!databaseConfigured()) return unavailable()
  return changed(await handleDeviceRename({ ...(await deps(request)), rename: renameOwnDevice }))
}

/** Remove one of the caller's computers: its numbers leave the total. */
export async function DELETE(request: NextRequest) {
  if (!databaseConfigured()) return unavailable()
  return changed(await handleDeviceRemove({ ...(await deps(request)), device: request.nextUrl.searchParams.get("device"), remove: removeOwnDevice }))
}
