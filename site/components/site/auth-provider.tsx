import { ClerkProvider } from "@clerk/nextjs"

import { clerkEnabled, satelliteOptions } from "@/lib/auth-config"

/**
 * Mounts Clerk only on the pages with sign-in flows (/share, /leaderboard and profiles under /u), and only when configured, so the
 * home page never loads clerk-js. Telemetry is off.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!clerkEnabled) return <>{children}</>
  return (
    <ClerkProvider {...satelliteOptions()} telemetry={false}>
      {children}
    </ClerkProvider>
  )
}
