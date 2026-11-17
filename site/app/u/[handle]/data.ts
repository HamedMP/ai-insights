import "server-only"

import { cache } from "react"

import { cachedProfile, cachedProfileExtras } from "@/lib/board-cache"
import { databaseConfigured, type PublicProfile, type Ranks } from "@/lib/db"
import { checkHandle } from "@/lib/leaderboard"
import { logError } from "@/lib/server-auth"

/**
 * One lookup per render, shared by the page, its metadata and its OG image, read through the board cache
 * (lib/board-cache.ts). Bad handles never reach the database.
 */
export const loadProfile = cache(async (raw: string): Promise<PublicProfile | null | "error"> => {
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
    return await cachedProfile(checked.handle)
  } catch (error) {
    logError("profile read failed", error)
    return "error"
  }
})

/** Ranks and the public referral count for a profile. Secondary: if they fail, the profile still renders without them. */
export const loadProfileExtras = cache(async (handle: string): Promise<{ ranks: Ranks; referrals: number }> => {
  try {
    return await cachedProfileExtras(handle)
  } catch (error) {
    logError("profile extras read failed", error)
    return { ranks: {}, referrals: 0 }
  }
})
