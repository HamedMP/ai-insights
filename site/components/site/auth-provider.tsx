import { ClerkProvider } from "@clerk/nextjs"

import { clerkEnabled, satelliteOptions } from "@/lib/auth-config"

/**
 * Mounts Clerk only on the pages with sign-in flows (/share and /leaderboard), and only when it is configured, so the
 * home page and public profiles never load clerk-js. Telemetry is off.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!clerkEnabled) return <>{children}</>
  return (
    <ClerkProvider {...satelliteOptions()} telemetry={false}>
      {children}
    </ClerkProvider>
  )
}
