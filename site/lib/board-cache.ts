import "server-only"

import { revalidatePath, revalidateTag, unstable_cache } from "next/cache"

import { boardPage, entryByHandle, ranksForHandle, referralCount } from "@/lib/db"

/**
 * The public leaderboard and profiles are rendered once and served from the cache (Vercel's ISR cache, and Next's data
 * cache for these reads), instead of opening a database connection on every visit. Only public data is cached here:
 * the same rows every visitor sees, never anything about the person asking. Signed-in pieces are fetched by the
 * browser from no-store route handlers.
 *
 * Every read carries one tag, and every write that changes what a public page shows (publish, remove, a device renamed
 * or removed, the photo switch) expires it at once with boardChanged(), so the person who changed it sees the change
 * on their next load. A rank on any profile moves when anyone publishes, so one tag for all of it is the honest scope.
 */
export const BOARD_TAG = "leaderboard"
/** A safety net only (for example a row changed by a migration): writes expire the tag directly. */
export const BOARD_REVALIDATE_SECONDS = 3600

const options = { tags: [BOARD_TAG], revalidate: BOARD_REVALIDATE_SECONDS }

/** A failed read throws and is not cached, so a database hiccup never sticks as an empty board. */
export const cachedBoardPage = unstable_cache(boardPage, ["board-page-v1"], options)
export const cachedProfile = unstable_cache(entryByHandle, ["profile-v1"], options)
export const cachedProfileExtras = unstable_cache(
  async (handle: string) => {
    const [ranks, referrals] = await Promise.all([ranksForHandle(handle), referralCount(handle)])
    return { ranks, referrals }
  },
  ["profile-extras-v1"],
  options,
)

/**
 * Expire every cached board view and profile now: the next request renders fresh instead of being served the old page.
 * The handle's own path is expired by name too, for a profile that was a cached "not found" before its first publish.
 */
export function boardChanged(handle?: string | null) {
  revalidateTag(BOARD_TAG, { expire: 0 })
  if (handle) revalidatePath(`/u/${handle}`)
}
