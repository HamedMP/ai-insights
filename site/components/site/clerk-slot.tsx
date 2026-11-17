"use client"

import { AccountMenu } from "@/components/site/account-menu"
import { AuthProvider } from "@/components/site/auth-provider"

/**
 * The account menu for a page that does not mount Clerk (the landing page, the docs). session-account.tsx imports this
 * module only on demand, and only in a browser that has signed in here before, so anonymous visitors never download
 * Clerk code or contact a Clerk host. No satellite auto-sync: that browser already holds this site's session.
 */
export default function ClerkSlot({ signIn }: { signIn: React.ReactNode }) {
  return (
    <AuthProvider autoSync={false}>
      <AccountMenu signIn={signIn} />
    </AuthProvider>
  )
}
