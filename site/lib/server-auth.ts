import "server-only"

import { auth, clerkClient } from "@clerk/nextjs/server"

import { serverAuthEnabled } from "@/lib/auth-config"
import { createLimiter } from "@/lib/publish"
import { avatarFromClerkUser } from "@/lib/avatar"
import { metadataPatch, referralPatch } from "@/lib/signup-source"
import { SITE_URL } from "@/lib/site"

/** The signed-in Clerk user id, or null when signed out or when sign-in is not configured. */
export async function currentUserId(): Promise<string | null> {
  if (!serverAuthEnabled()) return null
  const { userId } = await auth()
  return userId ?? null
}

/** Origins a mutating request may come from: the production site, plus this deployment's own URL for previews. */
export function allowedOrigins(): string[] {
  const out = new Set([new URL(SITE_URL).origin])
  const extra = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter((v): v is string => Boolean(v) && /^[a-z0-9.-]+$/i.test(v!))
  for (const host of extra) out.add(`https://${host}`)
  if (process.env.NODE_ENV !== "production") out.add("http://localhost:3000")
  return [...out]
}

export const writeLimiter = createLimiter({ limit: 6, windowMs: 60_000, maxKeys: 10_000 })
/** Reads of a person's own data (their referrals): more generous than writes, still bounded per person. */
export const readLimiter = createLimiter({ limit: 30, windowMs: 60_000, maxKeys: 10_000 })

const recorded = new Set<string>()
const MAX_RECORDED = 10_000

/** Once per user per server instance: merge the sign-up source into the user's Clerk public metadata. */
export async function recordSignupSource(userId: string): Promise<void> {
  if (recorded.has(userId)) return
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    const patch = metadataPatch({ createdAt: user.createdAt, publicMetadata: user.publicMetadata as Record<string, unknown> }, Date.now())
    // updateUserMetadata is Clerk's merge endpoint: it deep-merges, so other apps' metadata keys are kept.
    if (patch) await client.users.updateUserMetadata(userId, { publicMetadata: patch })
    if (recorded.size >= MAX_RECORDED) recorded.clear()
    recorded.add(userId)
  } catch (error) {
    // Best effort: a Clerk outage must not block reading or publishing. Logged without the error body.
    console.error("ai-insights: signup source not recorded", error instanceof Error ? error.name : "unknown")
  }
}

/** After a publish credited a referrer: mirror it into the publisher's Clerk public metadata, once, never replaced. */
export async function recordReferral(userId: string, handle: string): Promise<void> {
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    const patch = referralPatch(user.publicMetadata as Record<string, unknown>, handle)
    if (patch) await client.users.updateUserMetadata(userId, { publicMetadata: patch })
  } catch (error) {
    // Best effort, like the sign-up source: the database already holds the credit.
    console.error("ai-insights: referral not recorded in Clerk", error instanceof Error ? error.name : "unknown")
  }
}

/** The signed-in person's uploaded Clerk photo, read on the server. A Clerk failure means "no photo", never a failed publish. */
export async function clerkAvatar(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient()
    return avatarFromClerkUser(await client.users.getUser(userId))
  } catch (error) {
    console.error("ai-insights: avatar not read from Clerk", error instanceof Error ? error.name : "unknown")
    return null
  }
}

/**
 * The same photo for the photo switch, where a Clerk failure must surface as an error rather than read as "you have no
 * photo". Throws on a Clerk failure; the caller logs it and answers with the generic message.
 */
export async function clerkPhoto(userId: string): Promise<string | null> {
  const client = await clerkClient()
  return avatarFromClerkUser(await client.users.getUser(userId))
}

export const logError = (message: string, error?: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code).slice(0, 16) : ""
  console.error(`ai-insights: ${message}`, error instanceof Error ? error.name : "unknown", code)
}
