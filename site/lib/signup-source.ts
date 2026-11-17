/**
 * Records where a Matrix account first met AI Insights, in Clerk public metadata. Pure: it decides the patch, and the
 * caller sends it through Clerk's merge endpoint (users.updateUserMetadata), which deep-merges into the existing
 * object, so keys other apps set are kept.
 */

export const SIGNUP_SOURCE = "ai-insights"
/** An account created this recently, and seen here with no source yet, is counted as signed up from AI Insights. */
export const NEW_ACCOUNT_MS = 15 * 60 * 1000

export interface ClerkUserLike {
  createdAt: number
  publicMetadata: Record<string, unknown> | null | undefined
}

export function metadataPatch(user: ClerkUserLike, now: number): Record<string, unknown> | null {
  const meta = user.publicMetadata ?? {}
  const patch: Record<string, unknown> = {}
  const existing = meta.aiInsights
  const seen = existing && typeof existing === "object" && !Array.isArray(existing) && typeof (existing as Record<string, unknown>).firstSeenAt === "string"
  if (!seen) {
    // Merge into any other aiInsights keys rather than replace them.
    const base = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {}
    patch.aiInsights = { ...base, firstSeenAt: new Date(now).toISOString() }
  }
  const hasSource = typeof meta.signupSource === "string" && meta.signupSource.length > 0
  if (!hasSource && Number.isFinite(user.createdAt) && now - user.createdAt >= 0 && now - user.createdAt <= NEW_ACCOUNT_MS) patch.signupSource = SIGNUP_SOURCE
  return Object.keys(patch).length ? patch : null
}

/**
 * The Clerk patch recording who referred this account: `referredBy` is set once, to the handle credited on their
 * first publish, and never replaced. Sent through the same merge endpoint as metadataPatch.
 */
export function referralPatch(publicMetadata: Record<string, unknown> | null | undefined, handle: string): Record<string, unknown> | null {
  const existing = (publicMetadata ?? {}).referredBy
  if (typeof existing === "string" && existing.length > 0) return null
  return { referredBy: handle }
}
