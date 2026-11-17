import { docSlugFromPath } from "./docs.ts"

/**
 * Whether a link from the page at `fromPath` to `href` may switch pages in place (next/link) instead of loading a new
 * document. Only between pages that get the same Content-Security-Policy: proxy.ts sets the policy per document, and a
 * client-side navigation keeps the first document's policy. The landing page and the docs get the same-origin-only
 * policy for anonymous visitors; pages that mount Clerk (lib/auth-config.ts mountsClerk: /share, /leaderboard, /u,
 * /account) get one that allows Clerk's hosts. Moving from the docs to /leaderboard in place would leave Clerk blocked,
 * so every link across that line must stay a plain <a> and load a full document, in both directions.
 *
 * Pure, with no Next or Clerk imports, so the client bundle of the docs stays Clerk-free and the tests can load it.
 */
export function clientNavigable(href: string, fromPath: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false
  const to = href.split(/[?#]/, 1)[0] ?? ""
  return plainPolicyPage(to) && plainPolicyPage(fromPath.split(/[?#]/, 1)[0] ?? "")
}

/** The landing page and every docs page: the app routes served with the same-origin-only policy. */
function plainPolicyPage(path: string): boolean {
  return path === "/" || path === "" || docSlugFromPath(path) !== null
}
