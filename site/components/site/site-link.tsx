import Link from "next/link"

import { clientNavigable } from "@/lib/navigation"

type SiteLinkProps = Omit<React.ComponentPropsWithoutRef<"a">, "href"> & {
  href: string
  /** The page this link sits on. Decides, with `href`, whether the switch can happen in place (lib/navigation.ts). */
  from: string
}

/**
 * A link to a page on this site. Between pages that share a Content-Security-Policy it is a next/link (prefetched,
 * switches in place); to or from a page that mounts Clerk it stays a plain <a>, so that page loads as a new document
 * with the policy that lets Clerk run. Use this instead of picking next/link by hand.
 */
export function SiteLink({ href, from, ...props }: SiteLinkProps) {
  return clientNavigable(href, from) ? <Link href={href} {...props} /> : <a href={href} {...props} />
}
