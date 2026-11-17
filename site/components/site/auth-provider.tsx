import { ClerkProvider } from "@clerk/nextjs"

import { clerkEnabled, satelliteOptions } from "@/lib/auth-config"

/**
 * Mounts Clerk only on the pages with sign-in flows (/share, /leaderboard, profiles under /u, /account), and only when
 * configured, so the home page never loads clerk-js for anonymous visitors. Telemetry is off.
 */
export function AuthProvider({ children, autoSync = true }: { children: React.ReactNode; autoSync?: boolean }) {
  if (!clerkEnabled) return <>{children}</>
  // autoSync false: the account menu loaded on demand on a page that does not mount Clerk (components/site/clerk-slot.tsx).
  // That browser already holds this site's session, so it never needs the redirect through the primary domain.
  return (
    <ClerkProvider {...satelliteOptions()} {...(autoSync ? {} : { satelliteAutoSync: false })} telemetry={false}>
      {children}
    </ClerkProvider>
  )
}
