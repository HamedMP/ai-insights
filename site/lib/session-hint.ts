/**
 * Whether a request or a page's cookies say this browser has signed in on this site before: Clerk's `__client_uat`
 * cookie ("client updated at", possibly suffixed per instance) holds a positive timestamp only after a sign-in reached
 * this domain. It is a hint, never proof of identity: it only decides whether a page that does not mount Clerk may load
 * the account menu (and allow Clerk hosts in its CSP) for this one browser. Anonymous visitors never carry it, so they
 * get no Clerk code, no Clerk host and no round trip. Pure, for the package tests.
 */

const CLIENT_UAT = /(?:^|;\s*)__client_uat(?:_[A-Za-z0-9_-]{1,64})?=(\d{1,16})(?=;|$)/g

export function hasSessionHint(cookies: string | null | undefined): boolean {
  if (!cookies || cookies.length > 16_384) return false
  for (const match of cookies.matchAll(CLIENT_UAT)) if (Number(match[1]) > 0) return true
  return false
}

/**
 * Where the landing page's "Sign in" link may send someone back to: a same-site path only, never another host and
 * never a protocol-relative URL. Anything else falls back to the home page.
 */
export function returnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/"
  if (!/^\/(?!\/|\\)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/.test(value)) return "/"
  return value
}
