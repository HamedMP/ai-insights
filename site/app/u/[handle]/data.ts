import "server-only"

import { cache } from "react"

import { databaseConfigured, entryByHandle, type PublicEntry } from "@/lib/db"
import { checkHandle } from "@/lib/leaderboard"
import { logError } from "@/lib/server-auth"

/** One lookup per request, shared by the page, its metadata and its OG image. Bad handles never reach the database. */
export const loadProfile = cache(async (raw: string): Promise<PublicEntry | null | "error"> => {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch (error) {
    if (error instanceof URIError) return null
    throw error
  }
  const checked = checkHandle(decoded)
  if (!checked.ok || !databaseConfigured()) return null
  try {
    return await entryByHandle(checked.handle)
  } catch (error) {
    logError("profile read failed", error)
    return "error"
  }
})
